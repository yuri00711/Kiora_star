# Kiora Phase 1 deployment

Phase 1 adds the OWNER-only Dock, durable conversation flow and the authenticated `kiora-runtime`. Perform these steps in order.

## 1. Apply the Phase 1 database migration

Open **Supabase Dashboard → SQL Editor → New query**, paste the complete contents of:

```text
supabase-kiora-phase1-migration.sql
```

and select **Run**.

This migration adds idempotency keys and server-only transactional RPCs. It does not grant browser write access.

Verify that authenticated browsers still have no Kiora write grants:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'kiora_%'
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
```

Expected result: **zero rows**.

## 2. Deploy the Edge Function

From the project directory with the Supabase CLI linked to the correct project:

```bash
supabase functions deploy kiora-runtime --no-verify-jwt
```

`verify_jwt=false` is intentional. The function does not skip authentication: it validates the bearer token with `auth.getUser()`, then calls `public.is_site_owner()` using that same JWT before creating a service-role client.

Supabase provides these values automatically to Edge Functions:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Do not put the service role key in the website or browser configuration.

## 3. Publish the website files

Publish the changed HTML files plus:

- `auth.js`
- `kiora/context-broker.js`
- `kiora/page-adapters.js`
- `kiora/kiora-dock.js`
- `kiora/kiora-dock.css`

No existing Games, Writing, Repo or Study data migration is involved.

## 4. Perform First Boot

Do not call `kiora_first_boot()` manually. Log in with the real Supabase Auth OWNER, open the `✦` entry, and select **BEGIN KIORA** once.

The Dock calls `kiora_start_phase1()` through the OWNER-verified Runtime. That single database transaction creates or restores the Phase 0 birth records and enables only `chat_enabled`. Other feature flags remain off.

Verify:

```sql
select active_conversation_id, feature_flags
from public.kiora_settings;

select event_type, occurred_at
from public.kiora_events
where event_type in ('KIORA_INITIALIZED', 'PHASE_ENABLED')
order by occurred_at;
```

## 5. Provider configuration

The default Initial Brain remains `unconfigured`. The Dock and First Boot work in this state, but a sent message records a failed Model Run with `BRAIN_NOT_CONFIGURED` and does not fabricate an answer. Perform First Boot before the model update below so that the Initial Brain row exists.

For any OpenAI-compatible provider, configure the API key as an Edge Function Secret:

```bash
supabase secrets set KIORA_BRAIN_API_KEY="YOUR_PROVIDER_KEY"
```

For multiple providers, use a model-specific secret such as `KIORA_PROVIDER_DEEPSEEK_API_KEY` and put `"api_key_env": "KIORA_PROVIDER_DEEPSEEK_API_KEY"` in that model's non-secret `config`. Accepted secret references are restricted to `KIORA_BRAIN_API_KEY` or `KIORA_PROVIDER_*_API_KEY`.

Optionally configure a default API base URL:

```bash
supabase secrets set KIORA_BRAIN_BASE_URL="https://provider.example/v1"
```

The base URL may instead be stored in the model's non-secret `config`. Never store an API key in `kiora_models.config`.

Update the Initial Brain from **SQL Editor** after replacing the example model, URL and cost values with the provider's real values:

```sql
update public.kiora_models
set provider = 'YOUR_PROVIDER_NAME',
    model_key = 'YOUR_MODEL_NAME',
    adapter = 'openai-compatible',
    runtime = 'remote',
    status = 'active',
    is_local = false,
    cost_config = jsonb_build_object(
        'input_cost', YOUR_INPUT_COST,
        'output_cost', YOUR_OUTPUT_COST,
        'currency', 'YOUR_CURRENCY',
        'billing_unit', YOUR_TOKEN_BILLING_UNIT
    ),
    config = jsonb_build_object(
        'api_key_env', 'KIORA_BRAIN_API_KEY',
        'base_url', 'https://provider.example/v1',
        'endpoint', '/chat/completions',
        'temperature', 0.8,
        'max_output_tokens', 800,
        'timeout_ms', 60000
    ),
    updated_at = now()
where id = (
    select daily_brain_model_id
    from public.kiora_settings
    where owner_id = (select user_id from public.site_owners limit 1)
);
```

`billing_unit` is data, not code. Supported canonical values are a positive token count such as `1000000`, or `per_token`, `per_1k_tokens`, and `per_1m_tokens`. Local adapters may use input/output cost `0` while keeping a valid currency and billing unit.

An OpenAI-compatible local server can set `is_local = true`, use zero costs, and add `"requires_api_key": false` to `config`; in that case `KIORA_BRAIN_API_KEY` is not required.

## 6. Verify a conversation

1. Open any page while logged in as OWNER. Confirm the `✦` entry appears.
2. Open it and send a message.
3. With a configured Brain, confirm a Kiora reply appears.
4. Navigate from Games to Writing or Repo and reopen the Dock.
5. Confirm the same messages return.
6. Refresh, then repeat on mobile with the same OWNER account.
7. Select text on a page. Confirm **INCLUDE SELECTION** appears but is unchecked by default.
8. Check the database:

```sql
select role, content, created_at
from public.kiora_messages
order by created_at;

select event_type, redacted_at, occurred_at
from public.kiora_events
order by occurred_at;

select status, input_tokens, output_tokens, total_cost, currency, error_code
from public.kiora_model_runs
order by started_at;

select category, quantity, amount, currency, occurred_at
from public.kiora_usage_ledger
order by occurred_at;
```

The active conversation ID must remain unchanged until the OWNER explicitly selects **New conversation** (`＋`).
