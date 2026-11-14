# Step 5: city-action entry, imports, City response

Built 2026-11-13. Admin hub: `/admin/city`. Public page: `/city`.

## What admins can do

- **Council agenda quick entry** (`/admin/agenda`): meeting date, what the council did (adjudicated,
  demolition ordered, etc.), one address or parcel ID per line, and the agenda PDF (public, linked from
  each parcel's history). Every line is matched and reviewed before anything is recorded.
- **CSV imports** (`/admin/imports`): city demolition lists, code-enforcement case logs, and the
  Secretary of State tax-forfeited list.
  - Upload: the file is stored **privately**, since records-request data can hold personal details.
  - Map: pick the parcel ID, address, date and note columns (guessed from the headers), a date for rows
    without one, and what the records show.
  - Review, then apply.
- **Matching**, cheapest first:
  - Exact parcel ID, the same ID with dashes dropped, an 18-digit DPIN, or an exact address (house
    number + normalized street): accepted automatically when exactly one parcel matches.
  - Ambiguous addresses (two parcels share it) list the candidates. Typos get a trigram "similar
    address" suggestion with a % score. Both wait for an admin, who can also search for the right parcel
    or skip the row.
  - A batch can't be applied while any row is undecided. Actions can be changed per row.
- **Re-importing is safe:** a row whose parcel already has the same status + sub-status on the same
  date is recorded as "already on record", not duplicated.
- **SOS list** imports write `app.state_inventory`, not status events. The parcel panel and admin page
  show "on the Secretary of State's tax-forfeited list (date)".
- **One parcel** (`/admin/parcels`): record a verification, city action or resolution with date,
  source and an optional document. History is never edited: mistakes are **voided** with a reason,
  stay visible to admins (struck through), and drop out of every public figure.
- **Land roll suggestions** (`/admin/suggestions`): the nightly rebuild flags ownership transfers and
  improvement values dropping to $0 on verified / city-action parcels. Admins dismiss them, or record
  e.g. "demolished" (source: land roll). They are never applied automatically.

## Definitions added in this step (for the methodology page)

- **Blighted requires newsroom verification.** A parcel the City acted on (cited, adjudicated, ...) that
  the newsroom never verified is **City-flagged**:
  - It is never counted as verified blight.
  - It has its own headline counter ("City-flagged, not yet checked by the newsroom").
  - It has its own map color and status label.
  - It appears in a "+N City-flagged" note beside owner, street and area rankings. This doesn't change the order.
  - It goes on the staff list at `/verify` ("Needs a check"): strongest City findings first, with "Submit
    photos" (preselects the parcel) and directions.
- **Lifecycle rule:** a verification recorded while City action is open (no resolution or reset since) marks
  the parcel verified but **doesn't reset its status**; the City action stays current. After a
  resolution, a new verification applies normally (re-blight). Photos of a City-flagged parcel are a new
  report (not a follow-up) and don't write a "submitted" marker over the City status.
- **Demolition counters count City records as City facts.** "Demolished this week" and "resolved to date"
  include demolitions from City lists whether or not the newsroom verified the parcel. The methodology
  page should say so.
- **The City-response medians use verification first.** They count only City action after verification.
  Parcels where the City acted first are excluded from "days to action".
- **City response:**
  - Demolitions this week / month / year: first demolition entry in the period (Central time).
  - Parcels at each city-action stage: current status.
  - Median days from first verification to first later city action, and to first later resolution
    (excluding "rejected on re-check").
  - "Verified more than N days ago with no city action": N defaults to 90 and is adjustable on the page.
  - Recent changes: with source and public source documents.
- **Notes stay internal:** event notes (admin notes, case numbers from imported files) are never in the
  public API or panel.

## Not done / later

- Per-row actions come from the batch default or an admin's choice. Mapping a city "case status"
  column to actions automatically waits until we see the real file formats.
- No fixed CSV formats yet. The mapping screen handles whatever columns the records request returns.
- `npm run build` writes to `.next`, which the dev server also uses. For a check-build while dev is
  running, use `NEXT_DIST_DIR=.next-check npx next build`. Two stale-module errors this session came
  from builds clobbering the dev server.
- Deploy: model files and `onnxruntime-web`'s `.wasm` must be bundled explicitly (Netlify
  `included_files`). Their paths are excluded from bundler tracing on purpose.
