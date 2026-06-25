# Labs — Large-File Upload Fix + Mixed-Document Robustness — Build Spec

**Version:** 1.0
**Date:** 2026-06-25
**Status:** Fixes the labs upload failing (404 / error page) on larger PDFs, and improves extraction on mixed clinical documents (discharge summaries with embedded labs). Follow-on to Slice 6.
**Confirmed root cause:** the upload routes the PDF bytes through a Next.js **Server Action**, which has a **default 1 MB body limit** (no override in `next.config`). The failing file (`dischargesummary1_pdf.pdf`) is **2.05 MB** → rejected before extraction runs. The lab reports that worked are ~80 KB. (The discharge summary has a clean ~13 KB text layer — once uploaded, the existing hybrid text path handles it fine; the only failure is getting the 2 MB file past the upload.)

---

## Part 1 — Direct-to-Storage upload (the real fix)
Stop sending the file through the server action. Upload the PDF **directly from the browser to Supabase Storage**, then pass only the small Storage path to the extract action.

**Recommended (signed upload URL — keeps the bucket private, server controls the path):**
1. New server action `createLabUploadUrl(filename)` → service client `storage.from('lab-reports').createSignedUploadUrl(path)` where `path = <yyyy-mm-dd>/<epoch>-<safe-name>.pdf` (same scheme as today). Returns `{ path, token }`.
2. Client uploads the file via `supabase.storage.from('lab-reports').uploadToSignedUrl(path, token, file)` — direct to Storage, **never through the server action**. Validate client-side first: PDF only, a sane max (e.g. ≤ 25 MB).
3. Refactor `uploadAndExtract(formData)` → **`extractFromStorage(path)`**: server downloads the PDF from Storage (`storage.from('lab-reports').download(path)` → Buffer) → runs the existing `extractLabReport(bytes)` + `applyAliasesToDraft(...)` unchanged → returns `{ draft, rawFileRef: path }`. The file is already in Storage (it IS the `raw_file_ref` audit trail) — no double-store.
4. The review → `commitPanel` flow is unchanged (it already takes the draft + raw_file_ref).

This bypasses BOTH the 1 MB server-action limit AND Vercel's ~4.5 MB request ceiling — handles any realistic lab/discharge PDF.

*(Quick interim band-aid, if a same-day patch is wanted before the refactor: set `experimental.serverActions.bodySizeLimit: '6mb'` in `next.config` — fixes this 2 MB file but still caps at ~4.5 MB. Direct-to-Storage is the durable fix; don't ship only the band-aid.)*

## Part 2 — `maxDuration` on the extract path
The labs extract action has no `maxDuration` (the other heavy routes use 800 s). A big/vision extraction could time out. Add `export const maxDuration = 800` to the `/labs` route segment (`app/labs/page.tsx` or the route the action runs under — server actions inherit the segment's config).

## Part 3 — Mixed-document prompt robustness
The current `SYSTEM_PROMPT` (`app/labs/_lib/prompt.ts`) is tuned for clean "blood-panel lab reports." Irfan will keep uploading **discharge summaries and mixed clinical documents** where lab results sit among narrative, diagnoses, and meds (the test file is a STEMI cardiology discharge with the admission labs embedded). Broaden the prompt:
- "The document may be a clean lab report **or** a larger clinical document (discharge summary, consultation note, admission record) that contains lab/test results **embedded among other content**."
- "Extract **all** lab/blood/test results present, wherever they appear. **Ignore** non-lab narrative — diagnoses, medications, course-of-stay, plans — do not turn those into markers."
- Keep the existing guardrails: format-agnostic, never invent/alter values, preserve raw names/units/ref-ranges verbatim, leave absent fields null.
- `drawn_at` for a discharge doc: prefer the lab **collection/draw date** if present; else the document date — and surface ambiguity in review (don't silently use admission vs discharge date).

## Part 4 — `max_tokens` guard (minor)
`extract.ts` uses `max_tokens: 8192`. Fine for this file (modest text). For a very long multi-panel document the structured output could truncate → a malformed/partial draft. Low priority, but: bump to the model's max, or detect a truncated tool-call response and surface a clear "report too long — split it" error rather than a silent partial. Flag, don't over-engineer.

## Out of scope
- No change to the schema, the alias table, the commit flow, the markers registry, or the `/labs` trends. This is upload-path + prompt only.

## Implementation steps
1. `createLabUploadUrl(filename)` server action (signed upload URL) + client-side direct upload (PDF-only, size guard).
2. Refactor `uploadAndExtract` → `extractFromStorage(path)` (download from Storage → existing extraction). Update `LabsClient` to the two-step flow (get URL → upload → extract).
3. Add `maxDuration = 800` to the `/labs` segment.
4. Broaden `SYSTEM_PROMPT` for mixed/discharge documents.
5. (Minor) `max_tokens` bump / truncation guard.
6. `npm run build` clean.
7. (Irfan) re-test: upload `dischargesummary1_pdf.pdf` (2 MB) → it should now upload, extract the embedded labs, and reach review.

## Acceptance criteria
- [ ] The 2 MB discharge summary uploads successfully (direct-to-Storage, not via the server action) and reaches the review draft — no 404/error page
- [ ] Extract action takes a Storage path, downloads server-side, runs the existing hybrid extraction; `raw_file_ref` = the Storage path (no double-store)
- [ ] `maxDuration` set on the extract path
- [ ] Prompt extracts embedded labs from a mixed/discharge document and ignores non-lab narrative; guardrails (no invented/altered values) intact
- [ ] Clear error surfaced on failure (never a bare 404/error page); `npm run build` clean

---

*End of spec. Root cause confirmed (2.05 MB > 1 MB server-action limit). Direct-to-Storage is the durable fix; the band-aid (bodySizeLimit bump) is interim only.*
