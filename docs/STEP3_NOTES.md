# Step 3: staff submissions, photo pipeline, approval queue

Built 2026-11-13. Decisions are in STEP3_DECISIONS.md.

## How it works

1. **Sign in** (`/login`). Accounts are created by an admin with a temporary password that must be
   changed on first sign-in. Passwords are scrypt-hashed. Sessions are random tokens stored as SHA-256,
   14 days, httpOnly, SameSite=Lax, with an Origin check on every write. 5 failed sign-ins in 15 min
   lock the email for 15 min.
2. **Submit** (`/submit`, mobile-first). Find the parcel by address/parcel-id search, "near me"
   (closest Jackson parcels), or tapping the map. Add 1–5 JPEG/PNG/WebP photos; they upload
   straight to storage (signed URLs in production, so large photos stay out of function payloads). Tick
   conditions, confirm the vantage point, and add an optional 300-char note.
3. **Processing** (after the response, or a Netlify background function in production). Reads EXIF
   GPS/time/camera from the private original, auto-orients, caps at 2000 px, runs the face/plate
   detector, pixelates and blurs every box, and writes a JPEG with **all metadata dropped**.
4. **Review** (`/admin`). The queue shows camera distance from the parcel. The review screen shows each
   photo (published version, with "compare with original"), warnings (detector missing, >75 m away,
   no GPS, >90 days old, processing failed), conditions and note, land roll facts, earlier
   submissions, and an audit trail. Actions:
   - **Approve:** requires every item of the approval standard (`src/lib/approval.ts`, draft
     wording for the newsroom to edit).
   - **Reject** or **request a better photo:** a reason is required and is shown to the submitter.
   - **Reassign** to another parcel.
   Admins can draw blur boxes, and the server re-renders.
5. **Public** once approved: the parcel shows "Verified blighted" (dated the approval day) and the
   photo timeline. Before that, the public sees nothing: no status change and no photos.

Status history written by the workflow:
- **First submission on an unreported parcel:** `submitted` (never shown publicly).
- **Approval:** `verified_blighted`.
- **Rejection that leaves nothing else open on the parcel:** back to `unreported`.
- **Follow-up photos on a verified parcel:** no status change; they join the photo timeline.

## Not done yet / needs a decision

- **Automatic face and plate detection is not installed.** The detector interface is in place
  (`src/lib/photos/detect.ts`). Until models are added, the review screen warns admins to box every
  face and plate by hand. Adding detection needs approval to download the model files.
- **Production wiring is untested:** Supabase Storage adapter (`src/lib/storage.ts`), the Netlify background
  function that calls `processSubmission`, and the scheduled sync. They get built and tested when the
  Supabase project and Netlify site are set up.
- **HEIC:** iPhones convert to JPEG when the page asks for JPEG/PNG/WebP. Some iOS settings strip GPS
  on upload, so those photos show "no camera location" in the queue.
- **Abandoned drafts** (photos uploaded but never sent) are kept; a cleanup job comes later.
