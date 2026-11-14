# Step 6: survey mode, exports, embeds, methodology, corrections, dashboard

Built 2026-11-13.

## Survey mode (`/survey`, staff)

- **Starting a survey:** pick a street (recommended) or a ward, neighborhood or tract. Each parcel
  gets three big buttons: **Not blighted**, **Blighted: photo**, **Can't see**.
- **Blighted: photo** opens the normal submit form with the parcel preselected. The survey records
  "blighted" only after the photo is sent, and links the mark to that submission. The photo still goes
  through the review queue; verification comes from approval, not from the survey mark.
- **Ordering:** "Still to do" / "All parcels", and street order (odd side, then even) or "Nearest first" (GPS).
  Progress is shown as marked of total and by result. Finishing a survey closes it to new marks.
- **Coverage:** marks are rows in `app.parcel_surveys` (append-only; the latest mark wins). A survey
  counts toward coverage for 365 days. "Can't see" does **not** count as surveyed.
- **Mobile header:** on phones, the header nav collapses behind a Menu button so survey mode gets the screen.

## Exports and share links

- A "Download CSV" link on owners (per tab), each owner page (all parcels), streets, areas, City
  response (waiting list, recent changes) and the staff "Needs a check" list (staff-only).
- Exports use the same filters as the page, include only public fields, and add a UTF-8 BOM for Excel.
- Ranking pages already keep filters in the URL. The map now does too
  (`?ward=3&st=verified_blighted,city_action&color=status`, view in `#zoom/lat/lon`), with
  "Copy link to this view".

## Embeds (`/embeds` builder, staff)

- `/embed/counters?items=blighted,demolished_week,state_owned,share,resolved,city_flagged&title=…`
- `/embed/chart?type=areas&kind=ward|neighborhood|tract` · `type=trend&weeks=12` · `type=stages`
  (plain SVG, no chart library).
- `/embed/map?ward=3&status=…&parcel=…`: cooperative gestures so it doesn't hijack page scrolling,
  and a legend linking back to the site.
- Every embed has a source line: site, as-of date, "how this works".
- **Framing:** only `/embed/*` may be framed by other sites (`frame-ancestors *`). Every other page sends
  `X-Frame-Options: SAMEORIGIN` and `frame-ancestors 'self'` (clickjacking protection for admin pages).

## Methodology (`/methodology`) and corrections

- The methodology page covers data sources, how a parcel becomes verified (including the approval
  standard, rendered from `src/lib/approval.ts`), what each number means, coverage and "reported so
  far", City-flagged parcels, sources and voids, and how to request a correction. Thresholds and counts
  come from config and the database, so they can't drift.
- "Request a correction" sits on every parcel panel and owner page. Fields: category, details (10–2,000
  characters), optional name and email (visible only to admins). Spam protection is a honeypot field
  plus 5 requests an hour per requester (a salted, daily-rotating hash of IP and user agent; no IP is stored).
- The admin queue is `/admin/corrections`: mark corrected or decline, with a required internal note. Audit logged.

## Admin dashboard (`/admin/dashboard`)

- Open work: review queue, photos requested, corrections, land roll suggestions, unfinished imports.
- This week vs last week: newly verified, City actions, demolitions, resolutions, submissions
  (sent / approved / rejected), parcels surveyed, corrections.
- Biggest movers: change in verified blighted parcels over 7 days by owner (ranking rules), street,
  ward and neighborhood.

## Left for the design pass

- The header nav is long: there are many staff links. It needs grouping.
- Chart text gets small when embeds are narrow.
- Status colors need a colorblind-safe palette (red/green today).
