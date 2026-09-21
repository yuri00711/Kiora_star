# Kiora Phase 3 deployment

Phase 3 adds OWNER-only external research and keeps Memory separate from Knowledge. All World writes remain inside `kiora-runtime` service-role RPCs. It does not enable background research or external write tools.

## Apply

1. Supabase Dashboard → SQL Editor → New query: run all of `supabase-kiora-phase3-migration.sql`.
2. Redeploy: `supabase functions deploy kiora-runtime --no-verify-jwt`.
3. The migration does **not** enable Phase 3. After the migration and Runtime deploy have succeeded, enable the four foreground flags:

```sql
select public.kiora_enable_phase3(user_id) from public.site_owners;
```

4. Publish `kiora/kiora-dock.js`, `kiora/kiora-dock.css`, and all 17 HTML files using `v=20260921-3`.

## Provider

Direct OWNER-provided public HTTP(S) URLs work without a Search provider. General web search defaults to `unconfigured`. Configure a replaceable `generic-json` adapter in `kiora_settings.research_config`; store only the Secret name in the database.

```bash
supabase secrets set KIORA_PROVIDER_SEARCH_API_KEY="YOUR_KEY"
```

Example config keys: `search_adapter`, `search_provider`, `search_endpoint`, `api_key_env`, `auth_header`, `auth_prefix`, `query_param`, `count_param`, `results_path`, `url_field`, `title_field`, `snippet_field`, `cost_per_query`, `search_currency`, and conservative limits. `search_currency` must match the active Research Brain currency because Phase 3 performs no implicit FX conversion. No real key belongs in SQL.

Example provider-neutral configuration shape (replace endpoint and JSON paths with those from the provider you choose):

```sql
update public.kiora_settings
set research_config = research_config || jsonb_build_object(
  'search_adapter', 'generic-json',
  'search_provider', 'YOUR_PROVIDER_NAME',
  'search_endpoint', 'https://api.example.com/search',
  'api_key_env', 'KIORA_PROVIDER_SEARCH_API_KEY',
  'results_path', 'results',
  'url_field', 'url',
  'title_field', 'title',
  'snippet_field', 'snippet',
  'cost_per_query', 0,
  'search_currency', 'JPY'
)
where owner_id = (select user_id from public.site_owners limit 1);
```

The Research Brain uses `research_brain_model_id` when set, otherwise the Daily Brain.

## Verify

```sql
select id,status,trigger_type,depth,provider,sources_inspected,knowledge_created,error_code from public.kiora_research_runs order by created_at desc;
select id,title,domain,source_type,fetch_status,retrieved_at,reliability from public.kiora_sources order by retrieved_at desc;
select id,statement,status,entity_type,entity_id,freshness_class,corroboration_count,last_verified_at from public.kiora_knowledge order by updated_at desc;
select * from public.kiora_knowledge_sources order by created_at desc;
select id,question,status,attempt_count,next_eligible_at from public.kiora_open_questions order by updated_at desc;
select category,quantity,amount,currency from public.kiora_usage_ledger where category in ('search','knowledge_extraction','research_reflection') order by occurred_at desc;

select feature_flags->>'research_enabled' as research_enabled,
       feature_flags->>'knowledge_enabled' as knowledge_enabled,
       feature_flags->>'open_questions_enabled' as open_questions_enabled,
       feature_flags->>'curiosity_enabled' as curiosity_enabled,
       feature_flags->>'background_research_enabled' as background_research_enabled
from public.kiora_settings;
```

Authenticated browser write grants must still return zero rows using the Phase 2 grant audit query.

Run `kiora/evals/phase3.md` before treating Phase 3 as production-ready. The current local environment has no deployed Supabase instance, Search Secret, or Supabase CLI, so cloud integration tests must be run after these steps. Direct-URL tests can run before a Search provider is configured.
