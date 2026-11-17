# Design — Archive

## Context

The archive is read-only. It reads `items` + `records` + `item_entities` + `places`, never writes. Publication and search-index maintenance belong to `src/review/`.

## Components

```
src/archive/items.ts       getPublishedItem, listPublished, recentPublished
src/archive/search.ts      searchItems: ranking, filters, facets, pagination
src/archive/citation.ts    buildCitation
src/archive/geo.ts         geocodePlace, cached lookups
src/archive/export.ts      toDublinCoreCsv, parseDublinCoreCsv
src/app/page.tsx           landing + recent
src/app/search/page.tsx    query, facets, results
src/app/items/[id]/page.tsx
src/app/map/page.tsx
src/app/api/search/route.ts
src/app/api/export/route.ts
scripts/geocode.ts         backfill
```

## Rendering

Cache Components is enabled. Public pages are server components; the static shell renders immediately and each data-reading section sits inside its own `<Suspense>` boundary with a skeleton. No `use cache` in v1: SQLite is local, the queries are indexed, and a stale archive after a review decision is a worse failure than a 3 ms query. If profiling later justifies caching, add `use cache` + `cacheTag("archive")` and call `updateTag("archive")` from the review server action.

`/items/[id]` uses `generateStaticParams`? No: publication changes at runtime, and a static params list would freeze the archive at build time. Dynamic rendering with streaming is correct here.

## Read model

```ts
export interface PublishedItem {
  id: string;
  identifier: string;        // RVN-0001
  title: string;
  description: string | null;
  transcription: string | null;
  dateDisplay: string;
  dateStart: string | null;
  dateEnd: string | null;
  datePrecision: Precision;
  people: EntityRef[];
  places: (EntityRef & { lat: number | null; lng: number | null })[];
  subjects: EntityRef[];
  rights: string;
  sha256: string;
  fileName: string;
  model: string;
  promptVersion: string;
  extractedAt: string;
  reviewedBy: string;
  publishedAt: string;
}

export function getPublishedItem(id: string): PublishedItem | null;
export function listPublished(opts?: { limit?: number; offset?: number }): PublishedItem[];
```

`identifier` is derived from a stored sequence column (`items.public_id`), not from the row order at render time. The item page maps `null` to `notFound()`.

## Search

FTS5 table:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  item_id UNINDEXED,
  title,
  description,
  transcription,
  people,
  places,
  tokenize = 'unicode61 remove_diacritics 0'
);
```

- Rebuild per item on publish and on edit: `DELETE FROM search_fts WHERE item_id = ?` then insert one row with people/places joined by spaces.
- Query: `search_fts MATCH ?` with the user input escaped as a quoted phrase per token. Never interpolate raw input into `MATCH`.
- Ranking in SQL: exact title (case-insensitive, trimmed) = 0, title prefix = 1, otherwise 2 ordered by `bm25(search_fts)` ascending, then `published_at DESC`.
- Facets are computed in three `GROUP BY` queries over the same filtered id set: decade (`substr(date_start,1,3) || '0s'`), person and place (`item_entities` joined to the filtered ids).
- Pagination: 24 per page; total from `COUNT(*)` over the filtered set.
- Empty query + facets is valid: browsing by decade/person/place is a first-class path.

## Geocoding

`geocodePlace(name)` calls Nominatim `/search` with `format=jsonv2&limit=1&countrycodes=us` only when the place looks like a settlement (no street address, no personal name). Cache in `places` with `source` and `cached_at`; cache misses too, so a failed lookup is not retried on every page view. One request per second, descriptive User-Agent from `NOMINATIM_USER_AGENT`. Ambiguous or country-less results return `null`; a pin is never guessed.

The map renders Leaflet with OSM tiles, `attributionControl` on, and a text list of places beside it for keyboard and no-JS use. Leaflet is loaded client-side only (`dynamic(..., { ssr: false })`) so it does not enter the server bundle or the initial HTML.

## Citation

```
buildCitation(item, baseUrl = APP_BASE_URL):
  [title, dateDisplay].join(", ") + ". " + institution + ", " + identifier + ". " + `${baseUrl}/items/${id}`
```

Missing title or date drops that element and the following comma. Tested with fixtures that omit each element.

## Export

`toDublinCoreCsv` maps one row per published item using the headers in the steering file. `papaparse.unparse` handles quoting. The route returns `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="revenant-dublin-core-YYYY-MM-DD.csv"` and streams in pages of 500 so a large collection does not buffer in memory.

## Testing

- Unit: citation cases, search ranking, facet counts over filtered sets, FTS escaping, export round-trip property with `fast-check`.
- Integration: publish an item through `reviewItem`, then assert it appears in search, item page and export; reject it and assert it disappears from all three.
- E2E: search by a person's name, open the item, copy the citation; axe on all four public pages.
- Performance: Lighthouse on a production build against the seeded database.
