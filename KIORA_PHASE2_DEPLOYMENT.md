# Kiora Phase 2 deployment

Phase 2 adds evidence-backed memory, feedback, relationship/self history, low-frequency reflection and memory retrieval. It also changes the desktop Dock into a persistent floating companion window. Apply these steps after the already-working Phase 1 deployment.

## 1. Apply the database migration

Open **Supabase Dashboard → SQL Editor → New query**, paste the complete contents of:

```text
supabase-kiora-phase2-migration.sql
```

and select **Run** once.

The migration is additive. It does not rebuild a Life table, change the OWNER/EDITOR/VIEWER architecture, or grant browser writes. It adds Phase 2 state columns, transactional reflection RPCs, privacy cleanup and indexes.

Verify that authenticated browsers still have zero write grants:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'kiora_%'
  and grantee = 'authenticated'
  and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
```

Expected result: **zero rows**.

## 2. Redeploy the existing Runtime

From the linked Supabase project directory:

```bash
supabase functions deploy kiora-runtime --no-verify-jwt
```

`--no-verify-jwt` is still intentional because `kiora-runtime` performs its own two-step OWNER verification on every request: real Supabase JWT validation through `auth.getUser(token)`, followed by `public.is_site_owner()` using that same JWT. Only after both succeed does it create a service-role database client.

Phase 2 creates no second Edge Function.

## 3. Secrets

No new Secret is required. Reflection uses the active Daily Brain from `kiora_models`, so the already-working DeepSeek Secret and model-specific `cost_config` continue to apply. Do not put provider or service-role secrets in browser files.

## 4. Enable Phase 2 explicitly

After the migration and Runtime deployment, enable the Phase 2 Life features for the registered site OWNER:

```sql
select public.kiora_enable_phase2(user_id)
from public.site_owners;
```

This enables only:

- `memory_enabled`
- `feedback_enabled`
- `relationship_enabled`
- `self_state_enabled`
- `growth_collection_enabled`

Research, agency, training, automatic promotion and voice remain disabled.

You do **not** need to run `kiora_first_boot()` again. Phase 1 already created Kiora and the active conversation.

## 5. Publish the frontend

Publish these changed browser assets:

- `kiora/kiora-dock.js`
- `kiora/kiora-dock.css`
- all 17 HTML files whose Kiora asset URLs now use `v=20260920-2`

The HTML edits are cache-version updates for the existing shared Kiora assets. Games, Writing, Repo and the other page data logic were not redesigned.

The Runtime deployment must also contain these files:

- `supabase/functions/kiora-runtime/index.ts`
- `supabase/functions/kiora-runtime/core.ts`
- `supabase/functions/kiora-runtime/budget-manager.ts`
- `supabase/functions/kiora-runtime/feedback-signals.ts`
- `supabase/functions/kiora-runtime/memory-retrieval.ts`
- `supabase/functions/kiora-runtime/reflection.ts`

## 6. Configure reflection budget if desired

Reflection uses provider pricing from the active model's `cost_config`; no provider price is hardcoded. `background_budget` is the monthly cap for reflection calls. A null value means no separate background cap, while the overall hard/monthly budget still applies.

Example:

```sql
update public.kiora_settings
set budget_config = jsonb_set(budget_config, '{background_budget}', '2.00'::jsonb, true),
    updated_at = now()
where owner_id = (select user_id from public.site_owners limit 1);
```

When the background or hard budget cannot cover a reflection, daily chat still completes. The reflection is recorded as a queued `kiora_tasks` row and a `REFLECTION_DEFERRED` event for later processing.

## 7. Verify the Companion Window

1. Log in as OWNER and open `✦`.
2. Drag the desktop window by `✦ Kiora / LIFE 01`.
3. Resize from the right edge, bottom edge and lower-right corner.
4. Click and use page controls outside Kiora. The window must stay open and the site must remain interactive.
5. Navigate Games → Writing → Repo. The new page must restore open/minimized state, position and size, clamp it to the viewport, and load the same database-backed active conversation.
6. Select page text. The selection option must appear unchecked; only checking it includes the selected text in the next request.
7. On mobile, drag the header. It must snap to 40%, 70% or 95% height instead of becoming a desktop-style floating window.

Window geometry lives only in `localStorage` under `kiora_ui_state_v1`. It does not create Life events, memories or relationship changes.

## 8. Verify immediate learning

Tell Kiora:

```text
以后我只是在吐槽的时候，不要立刻给解决方案。
```

This explicit preference should trigger a reflection immediately after the reply. Verify:

```sql
select id, feedback_type, message_id, structured_feedback, created_at
from public.kiora_feedback
order by created_at desc
limit 5;

select id, memory_type, status, confidence, summary, created_at
from public.kiora_memories
where memory_type in ('procedural', 'self')
order by created_at desc
limit 10;

select memory_id, message_id, feedback_id, evidence_type, excerpt
from public.kiora_memory_evidence
order by created_at desc
limit 20;
```

On a later similar complaint, the pre-chat Context Builder retrieves the supported procedural memory. No LoRA or Phase 4 training is involved.

## 9. Inspect one memory and its evidence through Runtime

The authenticated OWNER can call `kiora-runtime` with:

```json
{
  "action": "memory_evidence",
  "memory_id": "MEMORY_UUID"
}
```

The Runtime returns the memory, evidence rows and graph links only after server-side OWNER verification. The ordinary chat UI intentionally does not display confidence values or background metrics.

## 10. Run the full evaluation

Follow [`kiora/evals/phase2.md`](kiora/evals/phase2.md) for scenarios A–M. In particular, verify uncertainty wording, supersession, hallucinated-history refusal, EDITOR/VIEWER isolation and cross-page UI continuity.
