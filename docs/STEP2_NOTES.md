# Step 2: sync, lifecycle, assignment, read-only map

Built 2026-11-13. See README for how to run.

## What the first full sync produced

| | |
|---|---|
| Parcels counted (Hinds) | **116,091** = 111,211 land roll + 4,880 parcel map only |
| Inside Jackson city limits (spatial join) | **72,071** (68,692 land roll + 3,379 parcel map only) |
| With a GIS polygon | 105,451 countywide (65,485 in city) |
| Located by fallback | 340 address match · 1,350 parent parcel · 2,613 Census geocoder |
| Not locatable | 1,457 (mostly house number 0 / no situs) |
| In city, no ward | 22 (edge slivers between city and ward lines) |
| In city, no neighborhood | 14,296 (21%): the unofficial Zillow layer doesn't cover the whole city |
| State-forfeited (in city) | 2,478 |
| City of Jackson / other public (in city) | 666 / 921 |
| Unpaid 2025 taxes (in city) | 18,417 parcels, $24.7M; 5,562 with no tax record (unknown, not paid) |
| Homestead (in city) | 24,209 (excluded from owner rankings only, like estate/heirs) |
| Mattiace Development portfolio | 15 parcels (14 from the test fixture + 36-6, "633 NORTH STATE LLC", c/o The Mattiace Company as agent) |
| Status history parent | `app.parcel_registry` (both sources; rows never deleted) |

## Things found while building that change numbers

1. **The BigQuery land roll is incomplete.** The county parcel map has 8,585 parcels missing from
   it. Many are exempt public land, but ~1,400 are ordinary single-family homes, some with
   homestead exemptions. Those aren't in BigQuery's `properties` or `tax_history` at all, so this is
   a scrape coverage gap, worth fixing upstream. **Resolved:** 4,880 now join the parcel universe
   (`app.parcel_universe`) with owner and values from the parcel map (as of its last edit,
   Mar 17, 2026) and tax status unknown. Skipped: 3,371 shapes with no attributes, 369 parents of
   land roll parcels, and 51 already matched to a land roll parcel by address (both would double-count).
   No parcel-map parcel overlaps a land roll parcel's polygon by more than half.
   **Revised 2026-11-24 (migration 1009):** most of those "parents" were separate parcels (the
   children have their own shapes; 170-98 at 907 Union St is a foundation's lot, 170-98-1 is a
   neighbor's), often tax-exempt, and the newsroom wants every parcel on the map. Now only shapes that are
   the same property as a land roll parcel (same owner and house number, located on that shape)
   are left out: 6. The universe grew from 116,091 to 116,419 parcels.
2. **Tax amounts.** In the latest load, ~23k parcels have an unpaid 2025 bill, but the scraper
   captured `amount_still_owed` for only ~12k. For the rest, `current_due` falls back to
   `balance_due`, then `billed - paid`, and is flagged `current_due_estimated` (no interest). 189
   parcels have both a Paid and an owed row in the same load (`tax_conflict`).
3. **GIS layer ID.** Its object ID field is `FID`. `OBJECTID` is a duplicated attribute, and paging on it
   silently drops ~15k features.
4. **Impossible dates** exist in the land roll (`09/31/1990`). They're stored as null.
5. **City vs Census limits** differ by 3.5 sq mi (114.7 vs 113.8 sq mi). The city's layer is used.
   Both are loaded (`city_limits`, `city_limits_tiger`) if you want to compare.

## Environment notes

- The shell sets `GOOGLE_APPLICATION_CREDENTIALS=~/Desktop/ms-sos-filings.json`, which no longer
  exists. The sync ignores it and uses `gcloud auth application-default login` credentials.
- No Sheet is read. Owner portfolios live in `app.portfolios` and related tables, seeded with Mattiace only.
- PostGIS image: `imresamu/postgis:17-3.5` (official `postgis/postgis` has no arm64 build).

## Carry into step 3

- A follow-up photo on an already-verified parcel must **not** write a `submitted` status event.
  Keep submissions in their own table. The public view maps `submitted` → unreported.
- Parcel tiles start at zoom 14 (zoom 13 tiles were ~460 KB). Lower zooms need a points/cluster or
  aggregate layer once verified parcels exist.
