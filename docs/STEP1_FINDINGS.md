# Step 1 — Schema inspection, geometry and boundary options

Checked 2026-11-11 against `wlbt-projects.property_tax`, the `owner_groups` Sheet, and live GIS endpoints. Nothing has been built or loaded yet.

## 1. BigQuery: what's actually there

Only one dataset (`property_tax`) with two tables. Every column is `STRING`.

### `properties` — 755,069 rows (Hinds 333,633 / Rankin 247,353 / Madison 174,083)

`county, parcel_id, owner_name, mailing_street, mailing_city, mailing_state, mailing_zip, property_address, appraised_total, assessed_total, acreage, legal_description, deed_date, homestead_flag, year_built, source_file, loaded_at`

**Problems found:**

| Issue | Detail | Impact |
|---|---|---|
| **Triple-loaded** | Hinds has 111,211 parcels × exactly 3 identical rows (`hinds_landroll.csv` loaded 6/2, 6/3 20:55, 6/3 21:34). Content-distinct rows = 111,211. | Sync must dedupe. Worth fixing at the source too. |
| **`homestead_flag` is blank on 100% of rows** | — | The spec's homestead exclusion can't come from BQ. **Fix found:** GIS parcel field `he_1` (homestead exemption application #) is populated on 48,262 parcels. |
| **No `tCurDue` column** | The delinquency signal is in `tax_history` instead (see below). | — |
| **No improvement value** | Only `appraised_total`/`assessed_total`. | "Improvement value dropped to zero" needs GIS `tv_imp`/`ass_imp`. |
| **No city/jurisdiction field** | `property_address` is street only ("0 CEMETERY RD"). 27,847 parcels have house number 0 (vacant land). | City limits must be a spatial join. |
| **Mailing column shift** | When a mailing address has a C/O or ATTN line, the street shifts into `mailing_city` (2,353 rows) and state/zip go blank (7,220 rows blank state). | Breaks `mailing_key` grouping (see Mattiace). Needs a repair step. |
| Numbers as text | "3,800", "0000" for year_built (26,894). | Cast on sync. |

### `tax_history` — 5,607,608 rows, tax years through 2025

`county, parcel_id, owner_name, tax_year, amount_billed, amount_paid, balance_due, status, amount_still_owed, source_file, loaded_at`

- Also duplicated (6 loads per year for Hinds); dedupe on content.
- `status` ∈ {`Paid`, `Redeemed`, blank}. **Amounts are only populated on non-Paid rows**, and `amount_still_owed` is only populated for **2025**.
- **Proposed "current delinquency"** (stand-in for `tCurDue > 0`): latest tax year (2025) row with `amount_still_owed > 0` → ~22,700 Hinds parcels. Prior years only tell us "unpaid/redeemed" without amounts.
- 2,502 parcel IDs in `tax_history` aren't in `properties` (likely retired/split parcels).

## 2. Owner grouping Sheet (`owner_groups`, Drive)

Much smaller than the spec assumes:

- `owner_groups`: **6 rows**, keyed on `mailing_key` (`street|city|state`). Only one `portfolio_id` exists: `MATTIACE_DEV`. DMG has a blank `portfolio_id`.
- `owner_overrides`: 4 rows (Rankin, `group_id = Bridge1`; column is `group_id`, not `portfolio_id`).
- `entity_status` is present for these rows; the Roadmap tabs show "Unknown" for nearly everything else.
- Three "Roadmap" tabs (top 50 by `total_owed` per county) — a work queue, not a grouping table.

**Implication:** for v1 rankings, `portfolio_id` comes from the Sheet when present, else a **derived portfolio** = normalized `mailing_key`. The Sheet stays the editorial override layer.

### Mattiace test (Hinds)

Exact `mailing_key` match on the Sheet's three keys → **10 parcels**. Missed:

- `125 SOUTH CONGRESS ST STE 1800` (47-34, 47-32) and `125 SOUTH CONGRESS ST 18TH FLOOR` (590-89) — needs SOUTH→S, "18TH FLOOR"≈"STE 1800" normalization or overrides.
- Shifted rows `ATTN: T ANDREW MATTIACE|125 S CONGRESS...` (192-2 Lamar Life) and `ATTN: CHARLENE|...` (590-88) — needs shift repair.
- Correctly *excluded*: personal homes at 4230 Eastover Pl and 4624 Maurey Rd.

The target is **15 parcels**. That makes a good regression test once normalization exists.

## 3. Parcel geometry — found, and better than expected

**Primary: City of Jackson ArcGIS Online, `Zoning_Map_WFL1/FeatureServer/0`**
`https://services2.arcgis.com/n0wqzAPJddc1vROD/arcgis/rest/services/Zoning_Map_WFL1/FeatureServer/0`

- 127,880 polygons, **countywide**, WKID 3857, last edited 2026-03-17, max 2,000 per page (paged pull is about 64 requests).
- `PARCEL_F` matches our `parcel_id` (verified: 4970-371, 638-65-1, 192-2). Some don't match (e.g. 4854-104-6 → only 4854-104 exists; probably a split).
- Bonus fields BQ lacks: `tv_land`, `tv_imp`, `ass_land`, `ass_imp`, `he_1` (homestead), `tax_dist`, `lv_use_cod` (land use), `bm_cond`/`bm_year` (building condition/year), `sales_date`/`sales_amt`, situs `loc_num`/`loc_alpha`. All text-padded.
- `tax_dist` **does not equal** city limits: 01 has 70,919 parcels, but downtown 192-2 (315 E Capitol) is district 26. City membership will come from a spatial join.
- Mirrors: CMPDD `gis.cmpdd.org/.../Hinds_County_Map/FeatureServer/24` (128,056; about 4.7k blank attrs), "flowood" org `HINDS_PARCELS` (Feb 2024). Hinds County's own GIS server is currently down.
- No license terms are published on any of these. They're public agency layers, but worth a note in methodology.

**Fallback geocoding** for unmatched parcels: first match `loc_num + loc_alpha` against the parcel layer, then use the Census batch geocoder (10k/file, free).

## 4. Boundaries

| Layer | Source | Status |
|---|---|---|
| City limits | TIGER 2025 place 2836000 (`tl_2025_28_place.zip`); city's own `Zoning_Map_WFL1/1` | ✅ live |
| Wards (7) | `Zoning_Map_WFL1/FeatureServer/2` — populations sum to 153,701 (= 2020 census), so post-2020 lines | ✅ live; adoption date not confirmed. **Avoid** `Jackson_Ward_Boundary_WFL1` (2010-based) |
| Census tracts | TIGER 2020 `tl_2020_28_tract.zip`, 67 in Hinds | ✅ |
| ZIP | TIGER ZCTA520 via TIGERweb query (avoid the 528 MB national file) | ✅ (ZCTAs ≠ USPS ZIPs; note in methodology) |
| Neighborhoods | **No official layer.** Only option found: Zillow neighborhoods re-hosted by Reinvestment Fund (discontinued, unclear terms) | ⚠️ decision needed |

## 5. Bonus: existing blight and city-action data

- **CMPDD tax-forfeited layer** (`Hinds_County_Map/FeatureServer/23`): 2,614 records with `blighted` TRUE/FALSE, `status`, `municipali`. ID `parcel_no_` is undashed, so it needs a crosswalk. Seeds the state-owned category and the SOS import.
- City `JacksonSurplusMap_WFL1`: city-owned (968) and surplus (367) parcels keyed on `parcel_f`.
- City `Code_Enforcement_2023_WFL1`: 128 board-up/demo points plus code enforcement target areas. 2023 snapshot only.
- Live code cases are in OpenGov (`jacksonms.portal.opengov.com`), which has no public layer. Records requests stay the path.
- State ownership in BQ: `STATE OF MISS` (1,891) + `STATE OF MISSISSIPPI` (373) = ~2,400 countywide. City of Jackson owns ~105. About 5,450 owner names match estate or heirs patterns.

## 6. Decisions needed before step 2

1. **Parcel source of truth.** Proposal: BQ land roll for owner, mailing, and tax data. GIS layer for geometry, `tv_imp`, homestead (`he_1`), and land use. Join on `parcel_id = PARCEL_F`. The GIS pull runs in the nightly sync (it changes rarely).
2. **Fix the BQ duplication at the source** (your loader), or just dedupe in the sync? I'll dedupe either way.
3. **Delinquency definition:** 2025 `amount_still_owed > 0` OK as the stand-in for `tCurDue > 0`?
4. **Owner grouping fallback:** derived portfolio = normalized `mailing_key` when the Sheet has no `portfolio_id`. OK? Should I treat `owner_overrides.group_id` as a `portfolio_id`?
5. **Neighborhoods:** use the Zillow/Reinvestment Fund layer for now (labeled as unofficial), skip neighborhoods in v1, or do you have a newsroom or city planning-area file?
6. **City limits:** TIGER 2025 place, or the city's own layer? (I'd use the city's and compare.)
7. **Database:** Supabase (hosted) or local Postgres/PostGIS in Docker for dev? Docker is installed; `psql` isn't.

## 7. Decisions (approved 2026-11-13: "use defaults")

1. BQ land roll = owner, mailing, and tax. GIS parcel layer = geometry, improvement value, homestead (`he_1`), land use. Join `parcel_id = PARCEL_F`.
2. Dedupe in the sync. The loader fix is left to the pipeline owner.
3. Current delinquency = latest tax year (2025) `amount_still_owed > 0`.
4. Portfolio = Sheet `portfolio_id` (or `owner_overrides.group_id`), else derived from the normalized mailing key.
   **Revised 2026-11-13:** that Sheet belongs to another dashboard and is not used. Portfolios
   live in this site's own tables, seeded only with the Mattiace Development portfolio.
5. Neighborhoods = Reinvestment Fund re-host of Zillow neighborhoods, labeled **unofficial** everywhere it appears. Replaceable.
6. City limits = the city's own layer, compared against TIGER 2025 place 2836000.
7. Database = local PostGIS in Docker for dev (plain Postgres, Supabase-compatible).
8. **Added 2026-11-13:** parcel-map-only parcels with an owner of record join the parcel universe
   (see docs/STEP2_NOTES.md).
