# Step 4: rankings, headline counters, coverage

Built 2026-11-13. Everything is Jackson city parcels only, computed live from the dated status
history (`app.ranking_base(date, survey_valid_days)` in `db/migrations/logic/1005_rankings.sql`).

## Definitions (these belong in the methodology page, step 6)

- **Blighted:** status is *verified blighted* or *city action pending* on the date asked about.
  Resolved parcels drop out. Pending (unapproved) submissions never count.
- **Surveyed:** staff recorded blighted / not blighted for the parcel in survey mode within the last
  `SURVEY_VALID_DAYS` (365) days. "Inaccessible" doesn't count. Survey mode is step 6, so until then
  every coverage figure is 0%.
- **Fully surveyed:** at least `FULLY_SURVEYED_SHARE` (95%) of an area's parcels are surveyed. Only
  then is a share shown as a rate. Otherwise it reads "at least X% (reported so far)", a floor.
  Both settings are in `src/config.ts` and are **editorial calls to confirm**.
- **Headline counters:**
  - **Verified blighted parcels:** blighted today.
  - **Demolished this week:** parcels that *first* reached resolved/demolished this Monday–Sunday
    (Central). Re-recording an old demolition doesn't count again.
  - **State-owned blighted:** blighted today, with the owner of record the State of Mississippi.
  - **% of Jackson parcels:** blighted ÷ all city parcels, labeled "reported so far" until the city
    is fully surveyed.
  - **Resolved to date:** parcels ever demolished, repaired or lot-cleared. *Rejected on re-check*
    is excluded, since that means it wasn't blighted after all.

## Rankings

- **Owners** (`/owners`): portfolios ranked by blighted parcels, with total parcels in Jackson, share
  blighted, known unpaid current taxes, and coverage. Three tabs: private, State (tax-forfeited),
  City and public bodies.
  - Homestead and heirs/estate parcels are left out of an owner's ranked count. The ranking shows
    them as "excluded"; they still count on streets and in areas.
  - Owner pages (`/owners/<portfolio>`) list every blighted parcel, plus up to 300 others.
  - **Caution:** automatic portfolios (`MK:` mailing-key groups) can merge unrelated owners who use the
    same agent, lawyer or management company (one group has 23 owner names). These are labeled
    "grouped automatically… not yet verified", and owner pages warn before anyone reports on them.
    Curating portfolios is admin work (step 6 tooling).
- **Streets** (`/streets`): blighted ÷ all parcels on the street, with a minimum of 10 parcels
  (adjustable on the page). Sort by count or share. Toggle "fully surveyed only".
- **Areas** (`/areas`): wards, neighborhoods (unofficial) and census tracts.
  - A choropleth uses quantile breaks over areas with reports.
  - The table shows count, share, change over 30 and 90 days (from the dated history), and coverage.
  - The "fully surveyed only" toggle applies here too.
- **Map:** below zoom 14, reported parcels show as dots colored by status. Every parcel appears
  from zoom 14.

## Demo data (local only)

`npm run dev:demo` adds about 400 fake verified parcels (and a few fully surveyed streets) to the
**local** database so the pages have something to show. `npm run dev:demo -- --clear` removes them. While
any demo rows exist, every page shows a red "DEMO DATA" banner, because demo statuses sit on real
owners' names. The script refuses to run against anything but localhost.
