# Phase 3 Unicode RPC hotfix

This hotfix changes only `kiora-runtime`. It does not change Source identity, deduplication, tables, migrations, authentication, or provider Secrets.

Run the local regression check:

```powershell
node --experimental-strip-types kiora/evals/phase3-postgres-unicode.test.mjs
```

Deploy only the Runtime:

```powershell
supabase functions deploy kiora-runtime --no-verify-jwt
```

Do not rerun any SQL migration for this Unicode fix.
