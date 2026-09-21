# Kiora Phase 3 hotfix deployment

This hotfix repairs the Source identity mismatch without rerunning or reverting the Phase 0–3 migrations.

## 1. Apply the database hotfix

Open Supabase Dashboard → SQL Editor → New query, paste the complete contents of `supabase-kiora-phase3-hotfix-migration.sql`, and run it once. The migration is repeatable and does not delete Source, Knowledge, Memory, Event, or Conversation rows.

The final Source identity is `(owner_id, url, content_hash)`. `canonical_url` remains searchable metadata. The helper serializes identical upserts with a transaction advisory lock, reuses the same row for the same URL/hash, and creates a new row when the content hash changes.

Every research use is stored separately in `kiora_research_run_sources`. Reusing a Source no longer overwrites `kiora_sources.research_run_id`; that legacy column remains the Source's original/previous discovery reference. The migration backfills per-run links from existing `SOURCE_FETCHED` / `SOURCE_REJECTED` events, then uses the legacy Source reference only when no event link exists. The helper also rejects any `target_research_run_id` that does not belong to `target_owner`.

Do not rerun `supabase-kiora-migration.sql`, `supabase-kiora-phase2-migration.sql`, or `supabase-kiora-phase3-migration.sql` on the deployed project.

## 2. Deploy the Runtime

From the project directory, after the SQL succeeds:

```powershell
supabase functions deploy kiora-runtime --no-verify-jwt
```

`--no-verify-jwt` keeps the existing architecture in which `kiora-runtime` verifies the bearer token and `public.is_site_owner()` itself. No new Secret is required by this hotfix.

## 3. Verify

Run the local checks:

```powershell
node --experimental-strip-types kiora/evals/phase3-hotfix.test.mjs
```

Then repeat one identical research request twice and inspect `kiora_sources`, `kiora_research_run_sources`, `kiora_research_runs`, `kiora_model_runs`, and `kiora_usage_ledger`. The second request must reuse the same Source for an unchanged URL/hash while creating a separate `kiora_research_run_sources` row for each Research Run. A changed hash must create a new Source version. A changed canonical URL with the same original URL/hash must update metadata without creating a duplicate.

Useful verification query after repeating the same research twice:

```sql
select s.url, s.content_hash, count(distinct rs.research_run_id) as research_runs,
       count(distinct rs.source_id) as source_rows
from public.kiora_research_run_sources rs
join public.kiora_sources s
  on s.owner_id = rs.owner_id and s.id = rs.source_id
group by s.url, s.content_hash
order by research_runs desc, s.url;
```

For an unchanged URL/hash used by two runs, expect `research_runs = 2` and `source_rows = 1`.

If a request produces readable sources but no grounded claims, the run should finish as a no-grounded-claims result. If no readable source exists, it should finish as a no-reliable-sources result. The user-facing answer should describe the condition without showing either internal code.
