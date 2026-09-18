# Kiora Study deployment

The Study UI is static frontend code, while its records, private files, editor writes, and Kiora Review depend on Supabase.

1. Open **Supabase Dashboard → SQL Editor → New query**.
2. Paste and run the complete contents of `supabase-study-migration.sql` once.
3. Open **Project Settings → Edge Functions → Secrets** and confirm these existing values are present:
   - `OWNER_USER_ID`
   - `EDITOR_SESSION_SECRET`
   - `EDITOR_LOGIN_ID`
   - the server credential already used by `editor-api` (`SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEYS`)
4. Add `OPENAI_API_KEY` for Kiora Review. Optionally add `STUDY_REVIEW_MODEL`; the default is `gpt-5-mini`.
5. Deploy the updated editor endpoint and the new review endpoint:

   ```text
   supabase functions deploy editor-api
   supabase functions deploy study-review
   ```

6. Deploy the website frontend, including `study.html`, `study.css`, `study.js`, the updated navigation/auth files, and their versioned references.

The SQL migration creates the private `study-private` bucket. Do not change it to public. OWNER uploads are restricted to the authenticated user's UUID folder; EDITOR uploads are validated and prefixed server-side.

Answer-key and reference extraction use deterministic DOCX/PDF parsing first. OCR is loaded only when an image or scanned document needs it. Kiora Review is the only model-backed feature and calls the model exclusively from `study-review`; the API key never enters the browser.
