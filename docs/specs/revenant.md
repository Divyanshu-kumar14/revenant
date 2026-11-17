# Revenant — Product Spec

**Status:** Draft for build
**Owner:** solo builder
**Event:** Kiroween 2026 (Kiro / AWS)
**Submission deadline:** 2026-12-04, 14:00 Pacific
**Category:** Resurrection

---

## 1. One-liner

A volunteer with a phone turns a box of unidentified photographs into a searchable, citable archive in an afternoon — no cataloguer, no vendor, no metadata training.

## 2. Problem

Small libraries, historical societies and volunteer-run museums hold photographic collections they cannot catalogue. Scanning happens; description does not. The result is a permanent backlog: items are unfindable, undated and unprotected, and the institution cannot answer the one question it exists to answer — "do you have anything on X?"

**Evidence (verified):**

| Claim | Source |
|---|---|
| 35,144 museums in the US | [IMLS, 2014](https://www.imls.gov/news/government-doubles-official-estimate-there-are-35000-active-museums-us) |
| 125,211 libraries of all kinds in the US | [ALA LibGuide](https://libguides.ala.org/c.php?g=751692&p=9132142) |
| European museums average 43.6% of collections digitised | [NEMO, 2020](https://www.ne-mo.org/fileadmin/Dateien/public/Publications/NEMO_Final_Report_Digitisation_and_IPR_in_European_Museums_WG_07.2020.pdf) |
| The Courtauld's volunteer project covered 60,000 negatives and ~1M photographs | [CultureHive](https://culturehive.co.uk/resources/case-study-the-courtaulds-digitisation-volunteer-project/) |

**Open item:** a US-specific "uncatalogued items per small institution" figure. Obtain from two phone calls to historical societies before any pitch claim.

**If 50 images from a real collection cannot be described accurately enough, the promise changes from "catalogue" to "assisted catalogue with mandatory human review".** That is a scope decision, not a failure.

## 3. Persona

A retired teacher volunteering two days a week at a county historical society. 8,000 photographs in archival boxes; 300 catalogued. She can scan, but does not know Dublin Core, date normalisation or name authority files, and there is no budget for a vendor. The pain hits when a family visits with a 1940s photograph and asks who the people are.

## 4. Scope

**In:**

- Ingest a photograph (front and back) with an optional typed caption.
- Extract: transcription of handwriting, title, description, date range + display string, people, places, subjects, per-field confidence.
- Human review with keyboard-first accept/edit/reject.
- Publish to a public archive: full-text search, facets (decade, person, place), item page with citation and provenance.
- Map of geocoded places.
- Dublin Core CSV export.
- Batch ingest of a folder with idempotent re-runs.
- Accuracy harness that measures the extractor against a hand-labelled set.

**Out (explicit non-goals):**

- Accounts, billing, multi-tenancy, roles.
- Microfilm OCR; video/audio; 3D objects.
- Crowdsourced transcription.
- Native mobile app.
- Archival-grade preservation (fixity, backups) — this is access, not preservation.
- Any claim of legal title or copyright clearance.

## 5. Magic moment

She photographs the back of a 1938 postcard. The archive returns a named person, a street that no longer exists, a confidence score and a citation — and pins it to a public map. Ninety seconds, one item, no metadata training.

## 6. User journeys

1. **Ingest** — drop 1–200 images into the tray. Each gets a sha256, a queued job and a provenance row.
2. **Extract** — a multimodal model transcribes handwriting and proposes fields; failures land in `needs_review` with an error, never disappear.
3. **Review** — the volunteer sees the image and the proposed record side by side; low-confidence fields are highlighted; `J/K` move, `Enter` accepts, `E` edits, `X` rejects. Every decision writes an audit event.
4. **Publish** — accepted records become public immediately.
5. **Search** — full-text plus facets; results ranked by exact-title match, then recency of publication.
6. **Cite** — each item page shows a formatted citation, the source file, the model and the extraction timestamp.

## 7. Data model

SQLite (WAL), migrations idempotent.

- `items(id, sha256 UNIQUE, file_name, stored_path, caption, status, error, created_at, updated_at)`
  `status`: `queued | extracting | needs_review | published | rejected`
- `extractions(id, item_id, model, raw_json, latency_ms, created_at)`
- `records(item_id UNIQUE, title, description, transcription, date_start, date_end, date_display, date_precision, confidence_json, reviewed_by, published_at)`
- `entities(id, type, name, name_key)`, unique `(type, name_key)`; `type` ∈ `person | place | subject`
- `item_entities(item_id, entity_id, role, confidence)` primary key `(item_id, entity_id, role)`
- `places(entity_id PRIMARY KEY, lat, lng, source, cached_at)`
- `audit_events(id, item_id, actor, action, before_json, after_json, created_at)`
- `eval_runs(id, fixture_set, model, metrics_json, created_at)`

**Invariants:** an item is public only if `status='published'`; `date_start <= date_end` when both exist; `items.sha256` is unique; re-ingest of identical bytes never creates a second item.

## 8. Accuracy and honesty policy

- Every number shown in the README, video or submission comes from `eval-runs/*.json`.
- The eval set is frozen before tuning; tuning after seeing it is disclosed.
- The UI never hides uncertainty: confidence is visible per field and review is mandatory before publish.
- No claim that the system "identifies people" — it proposes names found in captions and metadata; the human confirms.

## 9. Design direction

"The archive at night." Deep ink and oxblood, lamp-warm highlights, paper grain, a serif display face, monospace for catalog codes. Atmosphere serves function: low-confidence fields glow like faded ink; unresolved items persist visually across sessions. No cartoon ghosts, no jumpscares, no motion that blocks reading. Respect `prefers-reduced-motion`; contrast ≥ 4.5:1; full keyboard operation.

## 10. Kiro usage (the scored 20%)

| Surface | Real use in this build |
|---|---|
| **Specs** | Three feature specs: `ingest`, `review`, `archive`, each with requirements/design/tasks |
| **Steering** | `product.md`, `tech.md`, `structure.md`, `archive-conventions.md` (Dublin Core map, date rules, name authority) |
| **Hooks** | typecheck on TS save; unit tests on `src/**` save; eval on fixture change; full test before commit |
| **Custom agent** | `cataloger` — reviews extraction output against the archive conventions and flags invented fields |
| **MCP** | Custom `loc` server (search + item fetch) used for fixture acquisition and related-item lookups |
| **PBT** | Date parser, name key, hash stability, CSV export round-trip |
| **IDE / CLI / Web** | IDE for build; CLI headless for a batch run if the shim is repaired; Web cloud session for one PR |
| **Crew** | Stretch: nightly batch + digest, only if core is complete by Nov 28 |
| **Powers** | One relevant power installed and evaluated; if none fits, say so in the write-up |

Evidence is logged daily in `docs/kiro-log.md`; that file is the source for the submission write-up.

## 11. Judging map

| Criterion (20% each) | What proves it |
|---|---|
| Potential Impact | A named institution, a measured backlog, a live before/after ingest |
| Technological Implementation | Real specs, hooks, steering, MCP server, PBT failures caught, CLI/Web use |
| Design | A coherent "archive at night" system; review screen faster than a spreadsheet |
| Innovation | Dead medium + multimodal extraction + provenance, not a chatbot wrapper |
| Presentation | 3-minute video that opens on a real box and ends on a measured number |

Tie-break is the first criterion (Impact), so the video must establish the user in the first 15 seconds.

## 12. Demo outline (under 3:00)

1. `0:00` A real box of photographs. One sentence: "8,000 items, 300 catalogued."
2. `0:15` The volunteer photographs a caption; the record appears with confidence.
3. `0:45` Review: one keystroke accepts; the audit trail records it.
4. `1:10` Publish; search finds the person; the map pin lands on a vanished street.
5. `1:45` Batch: 120 items processed; the eval panel shows measured accuracy.
6. `2:15` How Kiro built it: one spec, one hook firing, one PBT failure caught (screen recording).
7. `2:45` The ask: what two pilot institutions would do with it.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Handwriting accuracy too low | Gate on 20 real items in the first hours; fall back to "assisted", or restrict to typed captions |
| Model provider unavailable or costly | `Extractor` adapter; fixture replay for tests and demo; local VLM fallback |
| Deploy instability during judging | Single container + persistent disk; health endpoint; seeded demo data |
| Legal/privacy | Public-domain or institution-owned material only; rights line on every item; no living-person inference |
| Scope creep | The Out list is binding; anything not listed is a "later" |
| Kiro evidence looks theatrical | Daily log with real hook hits, spec tasks, MCP calls, PBT failures |

## 14. Submission checklist

- [ ] Public GitHub repo, MIT license visible in About
- [ ] `.kiro/` committed, not gitignored
- [ ] Working URL; admin credentials in the private submission field
- [ ] Video < 3:00, public on YouTube
- [ ] Text description mapped to the five criteria
- [ ] Kiro write-up covering all eight prompts
- [ ] Category: Resurrection
- [ ] Bonus: Best Kiro Crew App (if Crew landed), Social Blitz post, Blog post (optional)
- [ ] Credits form submitted by 2026-12-01 12:00 PT
- [ ] Submission completed by 2026-12-03 (one day buffer)
