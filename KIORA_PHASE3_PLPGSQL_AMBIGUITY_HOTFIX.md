# Phase 3 PL/pgSQL ambiguity hotfix

This database-only hotfix replaces three functions and changes only local PL/pgSQL variable names. It does not change tables, Source identity, deduplication, Unicode sanitization, providers, data, or permissions.

Run the local static regression check:

```powershell
node --experimental-strip-types kiora/evals/phase3-plpgsql-ambiguity.test.mjs
```

Then open Supabase Dashboard → SQL Editor → New query and run the complete contents of:

`supabase-kiora-phase3-plpgsql-ambiguity-hotfix.sql`

The SQL is safe to run repeatedly. No Edge Function deployment or full migration rerun is required.
