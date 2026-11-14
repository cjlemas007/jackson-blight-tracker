# Step 3 decisions (2026-11-13)

| Decision | Choice | What it means for the build |
|---|---|---|
| Hosting | **Netlify + Supabase** (already paid for) | Netlify runs the Next.js site and its functions. Supabase provides Postgres/PostGIS, photo storage and auth. Local dev stays on Docker PostGIS. |
| Staff sign-in | **Password accounts** | Supabase Auth email + password, **public sign-up turned off**. An admin creates each coworker's account with a temporary password, which they change on first sign-in. Roles in `app.staff`: **contributor** (submit photos, survey mode) and **admin** (also approve, city-action entry, account management). Every approval is logged with who made it. Password resets are done by an admin, not by email. |
| Face/plate blurring | **Automatic on our server + manual fix** | Open-source face and plate detector (ONNX) runs in a Netlify **background function** after upload (15-min / 1 GB limit, so no request timeout). The admin queue lets staff add or adjust blur boxes before approving. Originals stay in a private bucket; only blurred, EXIF-stripped copies are ever public. |
| Who submits | **Coworkers only** (revised 2026-11-13; replaces "verified email") | Submitting requires a signed-in staff account. The public can browse the map, rankings and pages but can't submit. **Departs from the spec**, which had viewers submitting. "Request a better photo" shows as an in-app notice to the submitter, not an email. |

## Why not GitHub Pages

Pages only serves static files. The map tiles, parcel lookups, photo uploads, blurring, staff
sign-in and the admin side all need server code with database access. Moving all of that
into Supabase Edge Functions would be a large rework with no benefit when Netlify is already paid for.

## Consequences and limits (Netlify docs, checked 2026-11-13)

- Function limits: synchronous 60 s, **scheduled 30 s**, background 15 min, 1 GB memory by default.
- **Nightly sync:** too long for a scheduled function (about 4 min now). Plan: a scheduled function
  triggers a background function that runs the sync. The checkpoint/resume runner covers any
  retry. Fallback if bundle or runtime limits bite: a scheduled GitHub Action.
- The detector model must fit Netlify's function bundle limits. Verify while building. Fallback: run
  detection in a Supabase Edge Function or a small worker.
- **Email: none needed.** With staff-only submitting and admin-set passwords, the site sends no email.
  (Supabase's built-in sender, 2 emails/hour to team addresses only, couldn't do it anyway. If email is ever
  wanted, for example self-service password resets or public submissions, it needs a custom SMTP provider.)
