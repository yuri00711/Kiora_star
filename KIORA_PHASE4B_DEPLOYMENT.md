# Kiora Phase 4B — Controlled Growth Activation

Phase 4B compiles reviewed Phase 4A candidates into an immutable, model-independent behavior snapshot. Daily Chat reads only the active snapshot and short-lived reviewed overlays. It does not train a model, rewrite Core, grant tool authority, or enable Agency.

## Apply

1. Supabase Dashboard → SQL Editor → New query: run the complete `supabase-kiora-phase4b-migration.sql` after Phase 4A.
2. Enable the deterministic runtime, temporary overlays and regression gate for the site OWNER:

```sql
select public.kiora_enable_phase4b(user_id) from public.site_owners;
```

This keeps `auto_promote_enabled=false`. Shadow testing keeps its existing Phase 4A value and can still only be changed explicitly:

```sql
select public.kiora_set_shadow_testing(user_id, true) from public.site_owners;
```

3. Deploy the two changed server functions:

```bash
npx supabase functions deploy kiora-runtime --no-verify-jwt
npx supabase functions deploy kiora-growth --no-verify-jwt
```

No website frontend publish and no new Secret are required.

## Deploy from this local checkout

Run these commands from the repository root. `login` and `link` are only needed on a new computer; never commit the access token or function Secrets.

```powershell
cd C:\Users\mxuu3\OneDrive\Desktop\yuri-site
npx --yes supabase login
npx --yes supabase link --project-ref sqgzlaunnmwkulboyems

node --experimental-strip-types kiora/evals/phase4a-growth-foundation.test.mjs
node --experimental-strip-types kiora/evals/phase4b-controlled-growth.test.mjs

# Only for a project that has not received these migrations yet:
npx --yes supabase db query --remote --file supabase-kiora-phase4a-migration.sql --yes
npx --yes supabase db query --remote --yes "select public.kiora_enable_phase4a(user_id) from public.site_owners;"
npx --yes supabase db query --remote --file supabase-kiora-phase4b-migration.sql --yes
npx --yes supabase db query --remote --yes "select public.kiora_enable_phase4b(user_id) from public.site_owners;"

npx --yes supabase functions deploy kiora-runtime --no-verify-jwt --remote=sqgzlaunnmwkulboyems --yes
npx --yes supabase functions deploy kiora-growth --no-verify-jwt --remote=sqgzlaunnmwkulboyems --yes
```

For a fully local Supabase stack, Docker Desktop must be running. Start it with `npx --yes supabase start`, run the two SQL files without `--remote`, then serve both functions with `npx --yes supabase functions serve --no-verify-jwt --env-file <your-local-function-env-file>`. Keep provider keys and service-role credentials only in that ignored local environment file.

## Controlled lifecycle

1. Review a Candidate and, when needed, use `prepare_candidate` to set its allowlisted scope, short activation instruction, conflict key and explicit supersedes link.
2. Build the frozen Dataset/Growth Version through the Phase 4A actions.
3. Call `compile_growth_version`. The deterministic compiler writes one immutable snapshot, executable rules and conflict records. An unresolved conflict produces a `conflicted` snapshot and cannot be tested or activated.
4. Call `run_shadow_test`, then `create_regression_gate`. All six suites must be present. Any critical failure blocks activation; non-critical failures produce a warning that requires an explicit OWNER override.
5. Call `promote_growth_version` with `growth_version_id`, `regression_gate_id`, a non-empty reason, and optionally `allow_warnings=true`. There is no automatic promotion path.
6. Use `rollback_growth_version` with a reason to restore the previous active version, or `retire_growth_version` for a non-active version.

An explicit correction detected during Daily Chat can create a 14-day temporary overlay before permanent promotion. `promote_temporary_overlay` converts it into a reviewable Candidate; it never edits the active snapshot in place.

## Verify

```sql
select id,version,status,activated_at,retired_at
from public.kiora_growth_versions order by created_at desc;

select id,growth_version_id,status,compiler_version,checksum,conflict_count,compiled_at
from public.kiora_compiled_growth_snapshots order by compiled_at desc;

select id,scope,instruction,priority,source_candidate_id,evidence_strength,enabled
from public.kiora_growth_rules order by created_at desc;

select growth_version_id,classification,resolution,winner_candidate_id,reason
from public.kiora_growth_conflicts order by created_at desc;

select id,scope,source_kind,status,created_at,expires_at,promoted_candidate_id
from public.kiora_temporary_growth_overlays order by created_at desc;

select growth_version_id,model_id,gate_result,blocked_reasons,warning_case_ids,created_at
from public.kiora_regression_gates order by created_at desc;

select from_version_id,to_version_id,action,activation_reason,regression_gate_id,created_at
from public.kiora_growth_activations order by created_at desc;
```

Run local regression checks before deployment:

```bash
node --experimental-strip-types kiora/evals/phase4b-controlled-growth.test.mjs
node --experimental-strip-types kiora/evals/phase4a-growth-foundation.test.mjs
```
