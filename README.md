# Jackson Blight Tracker

Map-and-stats site for blighted property in Jackson, MS, built on the Hinds County land roll.
See [SPEC.md](SPEC.md) for the product spec and [docs/STEP1_FINDINGS.md](docs/STEP1_FINDINGS.md)
for what the source data actually looks like.

**Status:** build steps 1–2 done (schema inspection; sync, lifecycle tables, area/street
assignment, read-only map). Steps 3–6 (submissions, rankings, city action, survey mode) are next.

## Run it locally

```bash
cp .env.example .env.local          # then edit if needed
npm install
npm run db:up                       # PostGIS 17 in Docker on localhost:54329
npm run db:migrate
npm run models                      # face/plate detection models (~8 MB, checksum-verified)
npm run sync                        # full pull: ~5–10 min (BigQuery + ArcGIS + Census geocoder)
npm run dev                         # http://localhost:3000
npm test                            # unit + database tests (uses the blight_test database)
npm run staff -- dev-accounts       # local only: dev-admin@ / dev-contributor@example.test,
                                    # password = DEV_STAFF_PASSWORD in .env.local
```

### Staff accounts

Only coworkers submit; the public browses. Create the first admin from the command line, then
manage everyone else at `/admin/staff`:

```bash
npm run staff -- add you@newsroom.com "Your Name" admin   # prints a temporary password once
npm run staff -- reset someone@newsroom.com               # admin-side reset, no email involved
```

Google access uses Application Default Credentials: `gcloud auth application-default login`.
If `GOOGLE_APPLICATION_CREDENTIALS` points at a file that no longer exists, the sync ignores it.
Only BigQuery needs Google access.

### Owner portfolios

Portfolios live in this site's own database (`app.portfolios`, `app.portfolio_mailing_keys`,
`app.portfolio_owner_overrides`); no Sheet is read. The only seed is the Mattiace Development
portfolio (the spec's grouping check). Everything else groups automatically by normalized
mailing address until an admin groups it (admin screens come in a later step).

## Nightly sync

`npm run sync` runs every job in order; `npm run sync -- --list` shows them. Each job
checkpoints into `data.sync_state` in the same transaction as the data it writes, so a crash
resumes at the next unprocessed page on the next run (`--fresh` discards a partial run). Run
history is in `data.sync_runs`. Example crontab (2:30 a.m. Central):

```
30 2 * * * cd /path/to/BlightedSite && npm run sync >> logs/sync.log 2>&1
```

| Job | Source | Notes |
|---|---|---|
| `boundaries` | City of Jackson AGOL, Census TIGERweb, Reinvestment Fund | City limits (+TIGER copy for comparison), 7 wards, unofficial neighborhoods, ZCTAs, tracts |
| `gis_parcels` | City of Jackson AGOL parcel layer (countywide) | Paged by `FID`. Multi-part parcels merged. Logs improvement-value changes. |
| `landroll` | BigQuery `property_tax.properties` | Latest load per parcel (the table is triple-loaded). Repairs C/O column shifts, normalizes streets and mailing keys, classifies owners, logs owner/value changes. |
| `tax` | BigQuery `property_tax.tax_history` | Latest load per parcel-year. `current_due` = unpaid latest-year bills (estimated when `amount_still_owed` is missing). |
| `geocode` | GIS address match → parent parcel → Census batch geocoder | Only for land roll parcels with no polygon |
| `rebuild` | — | Parcel universe + registry, spatial joins (city, ward, neighborhood, ZIP, tract), street names, `app.parcel_facts` |

## Layout

```
db/migrations/data/    DATA LAYER: synced source tables (schema `data`)
db/migrations/logic/   LOGIC LAYER: lifecycle, assignment, portfolios (schema `app`)
sync/                  nightly sync jobs + checkpoint runner
src/lib/normalize/     address + owner normalization (shared by sync and app)
src/app/               Next.js app (map, tile + parcel APIs)
tests/                 vitest; *.test.ts touching the DB use TEST_DATABASE_URL
```

Data-layer and logic-layer migrations live in separate folders so each can ship on its own.

## Key rules (and where they live)

- **Parcel lifecycle** (`db/migrations/logic/1001_lifecycle.sql`): `app.status_events` (keyed to
  `app.parcel_registry`, so parcels from either source can take history) is
  append-only (UPDATE/DELETE raise). Mistakes are voided via `app.status_event_voids`.
  `app.status_as_of(date)` gives status on any date. `app.first_entries(status, substatus, from, to)`
  is the primitive for "demolished this week": a parcel counts once, in the week it first reached that state.
  Weeks start Monday, Central time (`app.week_start`).
- **Public visibility**: a pending submission never shows publicly (`src/lib/parcels.ts`).
- **Owner type** (`src/lib/normalize/owner.ts`): only the bare "STATE OF MISS(ISSIPPI)" owner is
  the tax-forfeited category. "STATE OF MISS HIGHWAY COMM", sixteenth-section school land, etc. are public bodies.
- **Ranking exclusions**: homestead (GIS `he_1`) and estate/heirs parcels get
  `ranking_excluded_reason`. They still count in street and area totals.
- **Parcel universe** (`app.parcel_universe`): every land roll parcel, plus parcel-map-only
  parcels with an owner of record, minus any that would double-count land already on the roll
  (a parent of roll parcels, or one used to locate a roll parcel by address). Parcel-map-only
  parcels have no tax data: `delinquent` is NULL (unknown), not false.
- **Portfolios** (`app.parcel_owner`): owner-name override → mailing key → mailing street line
  (only for column-shifted rows) → derived `MK:<mailing key>` (or `OWN:<owner>` with no mailing address).
