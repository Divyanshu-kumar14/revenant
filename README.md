# Revenant

**A volunteer with a phone turns a box of unidentified photographs into a reviewed, searchable, citable archive — no cataloguer, no vendor, no metadata training.**

Built for [Kiroween 2026](https://kiroween.devpost.com/) in the **Resurrection** category, using Kiro.

> **Status: build in progress.** The specification and the Kiro build harness are committed. The application, the extraction spike and the accuracy evaluation are being built in public. This README will not claim a capability before a test or an eval run proves it.

---

## The problem

Small libraries, historical societies and volunteer-run museums hold photographic collections they cannot catalogue. Scanning happens; description does not. Items become unfindable, undated and unprotected, and the institution cannot answer the question it exists to answer: *"do you have anything on X?"*

| Evidence | Source |
|---|---|
| 35,144 museums in the US | [IMLS, 2014](https://www.imls.gov/news/government-doubles-official-estimate-there-are-35000-active-museums-us) |
| 125,211 libraries of all kinds in the US | [ALA LibGuide](https://libguides.ala.org/c.php?g=751692&p=9132142) |
| European museums average 43.6% of collections digitised | [NEMO, 2020](https://www.ne-mo.org/fileadmin/Dateien/public/Publications/NEMO_Final_Report_Digitisation_and_IPR_in_European_Museums_WG_07.2020.pdf) |
| One volunteer digitisation project covered 60,000 negatives and ~1M photographs | [CultureHive](https://culturehive.co.uk/resources/case-study-the-courtaulds-digitisation-volunteer-project/) |

## The flow

1. **Ingest** — drop in front/back photographs. Each file is sha256-hashed, EXIF-rotated, downscaled and queued. Re-ingesting identical bytes returns the same item.
2. **Extract** — a vision model transcribes handwriting and proposes title, description, date range, people, places, subjects and per-field confidence.
3. **Review** — the volunteer accepts, edits or rejects with the keyboard. Every decision writes an audit event. Nothing publishes unreviewed.
4. **Publish** — public item pages with full-text search, facets, a map pin, a formatted citation and full provenance (source file, model, timestamp, hash).
5. **Export** — Dublin Core CSV for the institution's existing catalogue.

## The rule

Extraction proposes; a person decides. The UI never hides uncertainty: confidence is visible per field, and low-confidence fields are highlighted rather than smoothed over. Every accuracy number in this repository will come from a recorded run in `eval-runs/`; the evaluation set is frozen before tuning and any later tuning is disclosed.

## Built with Kiro

The `.kiro/` directory is committed, not ignored. It contains the actual working configuration used to build this project:

- **`.kiro/specs/`** — feature specs for `ingest`, `review` and `archive`, each with requirements, design and a tracked task list.
- **`.kiro/steering/`** — product, tech, structure and archive-convention rules that shape every agent response.
- **`.kiro/hooks/`** — typecheck on TypeScript save, unit tests on source save, evaluation on fixture change.
- **`.kiro/agents/cataloger.md`** — a custom agent that checks proposed records against the archive conventions and flags invented fields.
- **`.kiro/settings/mcp.json`** — a project-local MCP server (`tools/loc-mcp`) that searches Library of Congress photographs for fixtures and related items.

Daily evidence — which spec task, which hook fired, which MCP tool was called, which property-based test failed and what it caught — is logged in [`docs/kiro-log.md`](docs/kiro-log.md).

## Stack

Node 26 · Next.js 16 (App Router, Cache Components) · React 19 · TypeScript strict · Tailwind 4 · `node:sqlite` · `sharp` · `zod` · `fast-check` for property-based tests · Vitest · Playwright · one container with a persistent disk.

## Run it locally

```bash
pnpm install
cp .env.example .env.local   # fill in what you need; the fixture extractor needs no key
pnpm dev                     # http://localhost:3000
```

| Command | What it does |
|---|---|
| `pnpm typecheck` | TypeScript, strict, no emit |
| `pnpm lint` | ESLint |
| `pnpm test` | Unit tests and properties (Vitest) |
| `pnpm e2e` | Browser tests (Playwright) |
| `pnpm eval` | Score the extractor against the frozen ground-truth set |
| `pnpm spike` | The 20-item accuracy gate that decides the product promise |
| `pnpm fixtures` | Download public-domain fixture images from the Library of Congress |
| `pnpm loc-mcp` | Run the LOC MCP server over stdio |

## Documents

- [Product spec](docs/specs/revenant.md) — problem, persona, scope, data model, accuracy policy, judging map.
- [Implementation plan](docs/superpowers/plans/2026-11-18-revenant.md) — 14 tasks, tests, commands, calendar.
- [Kiro log](docs/kiro-log.md) — evidence of how Kiro was used.
- [Extraction promise](docs/decisions/0001-extraction-promise.md) — the gate result that sets the claim.

## License

MIT. See [LICENSE](LICENSE).
