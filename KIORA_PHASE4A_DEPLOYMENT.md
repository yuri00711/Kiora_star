# Kiora Phase 4A deployment

Phase 4A adds reviewable Growth Candidates, Training Examples, immutable Dataset Versions, model-independent Growth Versions, six evaluation suites, isolated Shadow Tests, explicit promotion and rollback. It does not train a model, alter Core automatically, execute tools, or enable Agency.

## Apply

1. Supabase Dashboard → SQL Editor → New query: run all of `supabase-kiora-phase4a-migration.sql`.
2. Enable the Phase 4A data foundation and seed the six evaluation suites:

```sql
select public.kiora_enable_phase4a(user_id) from public.site_owners;
```

3. Deploy the two server functions:

```bash
npx supabase functions deploy kiora-runtime --no-verify-jwt
npx supabase functions deploy kiora-growth --no-verify-jwt
```

4. Shadow testing remains disabled. Enable it only when a reviewed draft Growth Version and budget are ready:

```sql
select public.kiora_set_shadow_testing(user_id, true) from public.site_owners;
```

`auto_promote_enabled` remains false. Promotion is only available through the explicit OWNER-only `promote_growth_version` action and requires a passing Shadow Test.

## Verify

```sql
select candidate_type,source_kind,status,confidence,created_at from public.kiora_growth_candidates order by created_at desc;
select example_type,status,source_candidate_id,created_at from public.kiora_training_examples order by created_at desc;
select name,version,status,frozen_at from public.kiora_datasets order by created_at desc;
select version,status,based_on_version_id,dataset_version_id,activated_at from public.kiora_growth_versions order by created_at desc;
select suite,name,severity,enabled from public.kiora_eval_cases order by suite,name;
select growth_version_id,status,reason,created_at from public.kiora_shadow_tests order by created_at desc;
select suite,case_id,passed,notes,created_at from public.kiora_evaluation_results order by created_at desc;
select category,quantity,amount,currency from public.kiora_usage_ledger where category in ('growth','evaluation','shadow_test','training') order by occurred_at desc;
```
