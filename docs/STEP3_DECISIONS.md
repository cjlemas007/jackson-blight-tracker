# Step 3 decisions (2026-11-13)

| Decision | Choice | What it means for the build |
|---|---|---|
| Hosting | **Netlify + Supabase** (already paid for) | Netlify runs the Next.js site and its functions. Supabase provides Postgres/PostGIS, photo storage and auth. Local dev stays on Docker PostGIS. |
| Admin sign-in | **Password accounts** | Supabase Auth email + password, **public sign-up turned off**. An owner-admin creates staff accounts. An `app.admins` table holds roles. Every approval is logged with the admin's id. |
| Face/plate blurring | **Automatic on our server + manual fix** | Open-source face and plate detector (ONNX) runs in a Netlify **background function** after upload (15-min / 1 GB limit, so no request timeout). The admin queue lets staff add or adjust blur boxes before approving. Originals stay in a private bucket; only blurred, EXIF-stripped copies are ever public. |
| Public submitters | **Verified email required** | A submission is held as `unverified` until the submitter clicks an emailed link, then enters the admin queue. No submitter accounts or passwords. |

## Why not GitHub Pages

Pages only serves static files. The map tiles, parcel lookups, photo uploads, blurring, email
verification and the admin side all need server code with database access. Moving all of that
into Supabase Edge Functions would be a large rework with no benefit when Netlify is already paid for.

## Consequences and limits (Netlify docs, checked 2026-11-13)

- Function limits: synchronous 60 s, **scheduled 30 s**, background 15 min, 1 GB memory by default.
- **Nightly sync:** too long for a scheduled function (about 4 min now). Plan: a scheduled function
  triggers a background function that runs the sync. The checkpoint/resume runner covers any
  retry. Fallback if bundle or runtime limits bite: a scheduled GitHub Action.
- The detector model must fit Netlify's function bundle limits. Verify while building. Fallback: run
  detection in a Supabase Edge Function or a small worker.
- **Email:** Supabase's built-in sender allows 2 emails/hour and only to team addresses, so it's
  test-only. Verification links (and admin password resets) need a **custom SMTP provider**. Its
  default starts at 30 emails/hour in Supabase and can be raised. Turn off link tracking at the
  provider, since it breaks confirmation links. **Provider still to pick.**
