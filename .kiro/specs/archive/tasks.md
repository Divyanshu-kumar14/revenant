# Implementation Tasks — Archive

- [ ] 1. Add the public read model (`src/archive/items.ts`): `getPublishedItem`, `listPublished`, `recentPublished`, including provenance joins. Verify: unpublished and unknown ids return `null`.
- [ ] 2. Add `public_id` to the schema with a `RVN-0001` sequence; backfill seeded items. Verify: identifiers are stable across reads and unique.
- [ ] 3. Implement `buildCitation` (`src/archive/citation.ts`) with omission rules. Verify: table tests for full, missing date, missing title, missing both.
- [ ] 4. Build the item page (`src/app/items/[id]/page.tsx`): image, fields, entities, map link, provenance panel, rights, citation with copy button, `notFound()` for unpublished.
- [ ] 5. Build the landing page (`src/app/page.tsx`): institution, search field, recent items, honest empty state.
- [ ] 6. Create the FTS5 table and rebuild function (`src/archive/search.ts` + publish hook in `src/review/actions.ts`). Verify: publishing inserts exactly one row; rejecting deletes it.
- [ ] 7. Implement `searchItems` ranking, escaping and pagination. Verify: exact-title first, FTS metacharacters do not throw, unpublished excluded.
- [ ] 8. Implement decade, person and place facets over the filtered set. Verify: counts change correctly when a facet is applied.
- [ ] 9. Build `/search` with a form, result list, facet links and an empty state that suggests removing a facet first.
- [ ] 10. Implement `geocodePlace` with caching, rate limit and User-Agent (`src/archive/geo.ts`), plus `scripts/geocode.ts` backfill.
- [ ] 11. Build `/map` with Leaflet, OSM attribution, pins only for cached coordinates, and a keyboard-usable place list.
- [ ] 12. Implement `toDublinCoreCsv` / `parseDublinCoreCsv` and the streaming `/api/export` route. Verify: round-trip property and header-exact output for an empty archive.
- [ ] 13. Add `@a11y` Playwright tests for `/`, `/search`, `/items/[id]`, `/map`; run Lighthouse on a production build and record the scores in `docs/kiro-log.md`.
