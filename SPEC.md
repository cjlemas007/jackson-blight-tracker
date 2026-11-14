# Claude Code prompt: Jackson blight tracker (newsroom tool with a public view)

Working name: **Jackson Blight Tracker** (one config constant; may change).

## What this is

A map-and-stats site built on the Hinds County land roll. Viewers and newsroom staff submit photos of a property they believe is blighted. An admin approves or rejects each submission. Approved parcels become the dataset, and the site turns that dataset into rankings and running statistics: who owns the most blighted property, which streets and areas are worst, how much the state holds, and what the city is doing about it week by week.

Two audiences, one codebase: the public browses and submits; the newsroom gets an admin side for verification, data entry on city action, and exports for stories.

## Data foundation

Reuse my existing pipeline; do not rebuild scraping.

- BigQuery project `wlbt-projects`, dataset `property_tax`: `properties` (one row per parcel), `tax_history` (parcel per tax year), joined on `county + parcel_id`. Hinds only, Jackson city limits only for v1. Keep `county` in keys.
- Owner grouping already exists in the editorial Sheet (`owner_groups`, `portfolio_id`, `owner_overrides`) along with `entity_status` from Secretary of State lookups. Owner rankings must use `portfolio_id`, not raw name strings.
- Current tax delinquency = `tCurDue > 0`.
- Start by inspecting the real schemas and reporting what's there. Then build a nightly sync into the site's own Postgres/PostGIS database, with checkpoint/resume. Ship data-layer changes separately from logic-layer changes.
- Every parcel needs: a normalized street name (for street rankings), a point or polygon (investigate what parcel geometry Hinds County publishes; fall back to geocoded situs addresses), and area assignments by spatial join: ward, neighborhood, zip, census tract. Find boundary files and tell me what you found before loading.
- Flag state-owned tax-forfeited parcels (owner of record is the State of Mississippi / Secretary of State) as their own category.

## The parcel lifecycle (this drives every statistic)

Each parcel has a status with a dated history, never overwritten:

`unreported → submitted → verified blighted → city action → resolved`

- **City action** sub-states: cited, hearing set, adjudicated by council, demolition ordered, lot cleanup ordered, lien filed.
- **Resolved** sub-states: demolished, repaired, lot cleared, rejected on re-check.
- Every status change stores date, source (user photo, admin entry, city record, council agenda), and an optional document or photo.

Weekly and cumulative stats are computed from this history, so "demolished this week" is a query, not a number someone types.

## Submission and approval

- Submitter finds the parcel by address search, map tap, or "near me." They never type an owner name; ownership comes from the land roll.
- Upload 1 to 5 photos, tick a condition checklist (vacant and open, fire damage, roof or structural collapse, overgrown, dumping, boarded, vacant lot overgrown/dumping), optional 300-character note.
- Photos must be taken from the street, sidewalk, or the submitter's own property (checkbox). Read EXIF GPS and time to compare against the parcel, then strip EXIF. Blur faces and plates.
- Nothing is public until an admin approves. Admin queue shows photos, EXIF distance from the parcel, checklist, prior submissions for that parcel, and land roll facts. Actions: approve, reject with reason, request better photo, reassign to the correct parcel.
- Write the approval standard into the admin screen as a checklist so verification is consistent across staff. Log who approved what and when.
- Follow-up photos on an already-verified parcel go through the same queue and build a dated photo timeline (this is how repairs and demolitions get documented).

## Public views

**Map.** Verified parcels colored by status (blighted, city action pending, resolved, state-owned). Filters for ward, neighborhood, status, owner type. Parcel popup: photos, checklist, owner of record with land roll date, status history.

**Top owners.** Ranked by number of verified blighted parcels, with total parcels owned in Jackson, percent of their holdings that are blighted, and taxes owed. Separate tabs: private owners/LLCs, State of Mississippi, City of Jackson and other public bodies. Exclude homestead-exempt and heirs/estate parcels from the ranked list (they still count in street and area totals). Each owner links to a page with all their parcels.

**Top streets.** Verified blighted parcels divided by total parcels on that street, shown as both count and percentage. Minimum parcel threshold (default 10) so a three-lot street can't top the list. Sort by either number.

**Areas.** Choropleth and table by ward, neighborhood, and census tract: count, percentage of parcels, change over 30/90 days.

**City response.** The accountability page: demolitions this week / month / year; parcels at each city-action stage; median days from verification to city action and to resolution; list of parcels verified more than N days ago with no city action; a timeline of recent status changes with source documents.

**Headline counters.** Verified blighted parcels, demolished this week, state-owned blighted parcels, percent of Jackson parcels verified blighted, parcels resolved to date.

## The coverage problem (build this in, don't skip it)

Percentages are only meaningful where someone has actually looked. A neighborhood with three eager submitters will otherwise look worse than one nobody has photographed.

- Add a **survey mode** for staff: pick a street or area, walk or drive it, and mark every parcel as blighted (with photo) or not blighted. Store "surveyed on {date}" per parcel.
- Show coverage on every ranking: "62% of parcels on this street surveyed." Offer a toggle between "all areas" and "fully surveyed areas only."
- Label unsurveyed-area figures as "reported so far," not as a rate.

## City remediation data entry

Sources are documents, so the admin side needs fast entry plus bulk import:

- CSV import for city demolition lists and code enforcement case logs obtained by records request, matched to parcels by parcel ID or address, with an unmatched-rows review screen.
- Quick entry from council agendas: paste a list of addresses adjudicated at a meeting, attach the agenda PDF, set the date.
- State inventory import: match the Secretary of State's tax-forfeited list to parcels.
- Land roll changes (ownership transfer, improvement value dropping to zero) surface as suggestions for admin review, never auto-applied.

## Newsroom side

- Admin dashboard: queue, weekly digest of changes, biggest movers among owners/streets/areas.
- CSV export of any table; a shareable link for any filtered view.
- Embeddable counters, charts, and parcel maps for web stories.
- A methodology page stating exactly how a parcel becomes "verified," how percentages and coverage are calculated, and how to request a correction. Corrections queue on every parcel and owner page.

## Stack and build order

Next.js + TypeScript, Postgres/PostGIS (Supabase is fine), MapLibre, object storage for photos. Mobile-first for submission and survey mode.

1. Schema inspection, geometry and boundary options (stop and show me).
2. Sync, parcel lifecycle tables, area and street assignment; read-only map with land roll data.
3. Submission, photo pipeline, admin approval queue.
4. Rankings: owners, streets, areas, headline counters, with coverage.
5. City-action entry, imports, City response page.
6. Survey mode, exports, embeds, methodology and corrections.

Tests that matter most: street/area percentage math including the minimum threshold, lifecycle date queries behind the weekly stats, owner ranking exclusions, EXIF stripping. Use the Mattiace Development portfolio to verify owner grouping.
