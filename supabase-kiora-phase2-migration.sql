-- Kiora Life Architecture 1.0 — Phase 2 Life / Memory
-- Run after supabase-kiora-phase1-migration.sql.

begin;

alter table public.kiora_memories
    drop constraint if exists kiora_memories_status_check;

alter table public.kiora_memories
    add constraint kiora_memories_status_check
    check (status in ('candidate', 'active', 'uncertain', 'superseded', 'contradicted', 'forgotten'));

alter table public.kiora_memories
    add column if not exists context_tags jsonb not null default '{}'::jsonb
        check (jsonb_typeof(context_tags) = 'object'),
    add column if not exists confirmed_at timestamptz,
    add column if not exists forgotten_at timestamptz;

alter table public.kiora_self_state
    add column if not exists active_relationship_threads jsonb not null default '[]'::jsonb
        check (jsonb_typeof(active_relationship_threads) = 'array');

alter table public.kiora_habits
    add column if not exists confidence numeric not null default 0.5
        check (confidence between 0 and 1),
    add column if not exists first_seen_at timestamptz not null default now(),
    add column if not exists last_seen_at timestamptz not null default now(),
    add column if not exists state text not null default 'emerging'
        check (state in ('emerging', 'active', 'fading', 'inactive'));

alter table public.kiora_settings
    add column if not exists reflection_config jsonb not null default '{
        "message_threshold": 12,
        "max_memories_per_reflection": 4,
        "minimum_memory_confidence": 0.55,
        "retrieval_limit": 8,
        "retrieval_candidate_limit": 160,
        "max_output_tokens": 1400
    }'::jsonb check (jsonb_typeof(reflection_config) = 'object');

create index if not exists kiora_memories_retrieval_idx
    on public.kiora_memories(owner_id, status, memory_type, importance desc, updated_at desc);
create index if not exists kiora_memory_evidence_memory_idx
    on public.kiora_memory_evidence(owner_id, memory_id, created_at desc);
create index if not exists kiora_relationship_latest_idx
    on public.kiora_relationship_snapshots(owner_id, created_at desc);
create index if not exists kiora_self_state_latest_idx
    on public.kiora_self_state(owner_id, version desc);


create or replace function public.kiora_enable_phase2(target_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    enabled_flags jsonb;
begin
    if target_owner is null or not exists (
        select 1 from public.site_owners where user_id = target_owner
    ) then
        raise exception 'KIORA_OWNER_REQUIRED';
    end if;

    update public.kiora_settings
    set feature_flags = feature_flags
        || jsonb_build_object(
            'memory_enabled', true,
            'feedback_enabled', true,
            'relationship_enabled', true,
            'self_state_enabled', true,
            'growth_collection_enabled', true
        ),
        updated_at = now()
    where owner_id = target_owner
    returning feature_flags into enabled_flags;

    if enabled_flags is null then raise exception 'KIORA_NOT_STARTED'; end if;

    insert into public.kiora_events (owner_id, event_key, event_type, subject_type, payload)
    values (
        target_owner,
        'phase-2-enabled',
        'PHASE_ENABLED',
        'runtime',
        jsonb_build_object('phase', 2, 'life_memory_enabled', true)
    )
    on conflict (owner_id, event_key) do nothing;

    return enabled_flags;
end;
$$;


create or replace function public.kiora_begin_reflection(
    target_owner uuid,
    target_conversation_id uuid,
    selected_model_id uuid,
    source_message_id uuid,
    reflection_key text,
    reflection_trigger text,
    model_cost_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    run_record public.kiora_model_runs%rowtype;
    flags jsonb;
    clean_key text := left(btrim(coalesce(reflection_key, '')), 160);
begin
    select feature_flags into flags
    from public.kiora_settings
    where owner_id = target_owner;
    if flags is null or coalesce((flags ->> 'memory_enabled')::boolean, false) is not true then
        raise exception 'PHASE2_NOT_ENABLED';
    end if;
    if not exists (
        select 1 from public.kiora_conversations
        where owner_id = target_owner and id = target_conversation_id
    ) then raise exception 'CONVERSATION_NOT_FOUND'; end if;
    if not exists (
        select 1 from public.kiora_models where owner_id = target_owner and id = selected_model_id
    ) then raise exception 'MODEL_NOT_FOUND'; end if;
    if char_length(clean_key) < 8 then raise exception 'INVALID_REFLECTION_KEY'; end if;

    perform pg_advisory_xact_lock(hashtextextended('kiora-reflection:' || target_owner::text || ':' || clean_key, 0));

    select * into run_record
    from public.kiora_model_runs
    where owner_id = target_owner and turn_key = clean_key;
    if found then
        return jsonb_build_object('model_run_id', run_record.id, 'status', run_record.status, 'duplicate', true);
    end if;

    insert into public.kiora_model_runs (
        owner_id, model_id, conversation_id, request_message_id, turn_key,
        run_kind, status, cost_snapshot, usage_metadata
    ) values (
        target_owner, selected_model_id, target_conversation_id, source_message_id, clean_key,
        'reflection', 'started', coalesce(model_cost_snapshot, '{}'::jsonb),
        jsonb_build_object('trigger', left(coalesce(reflection_trigger, 'unknown'), 80))
    ) returning * into run_record;

    return jsonb_build_object('model_run_id', run_record.id, 'status', run_record.status, 'duplicate', false);
end;
$$;


create or replace function public.kiora_complete_reflection(
    target_owner uuid,
    target_model_run_id uuid,
    reflection_payload jsonb,
    provider_request text,
    used_input_tokens bigint,
    used_output_tokens bigint,
    used_input_cost numeric,
    used_output_cost numeric,
    used_currency text,
    used_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    run_record public.kiora_model_runs%rowtype;
    feedback_data jsonb;
    feedback_id uuid;
    item jsonb;
    evidence_item jsonb;
    link_item jsonb;
    memory_id uuid;
    old_memory_id uuid;
    relationship_id uuid;
    self_id uuid;
    previous_self public.kiora_self_state%rowtype;
    next_self_version bigint;
    interest_id uuid;
    interest_was_existing boolean;
    habit_id uuid;
    growth_id uuid;
    existing_habit_count integer;
    total_amount numeric := greatest(coalesce(used_input_cost, 0) + coalesce(used_output_cost, 0), 0);
    memory_count integer := 0;
    confirmation_count integer := 0;
    trigger_name text;
begin
    if jsonb_typeof(coalesce(reflection_payload, '{}'::jsonb)) <> 'object' then
        raise exception 'INVALID_REFLECTION';
    end if;

    select * into run_record
    from public.kiora_model_runs
    where owner_id = target_owner and id = target_model_run_id
    for update;
    if not found or run_record.run_kind <> 'reflection' then raise exception 'REFLECTION_RUN_NOT_FOUND'; end if;
    if run_record.status = 'completed' then
        return jsonb_build_object('model_run_id', run_record.id, 'duplicate', true);
    end if;
    trigger_name := coalesce(reflection_payload ->> 'trigger', run_record.usage_metadata ->> 'trigger', 'unknown');

    feedback_data := reflection_payload -> 'feedback';
    if feedback_data is not null and jsonb_typeof(feedback_data) = 'object'
       and nullif(btrim(feedback_data ->> 'content'), '') is not null then
        insert into public.kiora_feedback (
            owner_id, conversation_id, message_id, feedback_type, content, structured_feedback
        ) values (
            target_owner,
            run_record.conversation_id,
            nullif(feedback_data ->> 'source_message_id', '')::uuid,
            case when feedback_data ->> 'type' in ('accepted', 'rejected', 'correction', 'preference', 'other')
                then feedback_data ->> 'type' else 'other' end,
            left(feedback_data ->> 'content', 6000),
            jsonb_build_object(
                'assistant_message_id', feedback_data ->> 'assistant_message_id',
                'explicit', coalesce((feedback_data ->> 'explicit')::boolean, false),
                'reflection_model_run_id', run_record.id
            )
        ) returning id into feedback_id;

        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id,
            conversation_id, feedback_id, payload
        ) values (
            target_owner, 'feedback-created:' || feedback_id::text, 'FEEDBACK_CREATED',
            'feedback', feedback_id::text, run_record.conversation_id, feedback_id,
            jsonb_build_object('feedback_type', feedback_data ->> 'type', 'explicit', feedback_data -> 'explicit')
        );
    end if;

    for item in select value from jsonb_array_elements(coalesce(reflection_payload -> 'confirmed_memory_ids', '[]'::jsonb))
    loop
        update public.kiora_memories
        set confidence = least(1, confidence + 0.12),
            status = case when status = 'uncertain' then 'active' else status end,
            confirmed_at = now(),
            updated_at = now()
        where owner_id = target_owner
          and id = trim(both '"' from item::text)::uuid
          and status not in ('forgotten', 'superseded')
        returning id into memory_id;
        if memory_id is not null then
            confirmation_count := confirmation_count + 1;
            insert into public.kiora_memory_evidence (
                owner_id, memory_id, conversation_id, message_id, feedback_id,
                evidence_type, excerpt, weight
            )
            select target_owner, memory_id, run_record.conversation_id, run_record.request_message_id,
                   feedback_id, 'reflection_confirmation', left(message.content, 1000), 1
            from public.kiora_messages message
            where message.owner_id = target_owner and message.id = run_record.request_message_id;
            insert into public.kiora_events (
                owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
            ) values (
                target_owner, 'memory-confirmed:' || run_record.id::text || ':' || memory_id::text,
                'MEMORY_CONFIRMED', 'memory', memory_id::text, run_record.conversation_id,
                jsonb_build_object('reflection_model_run_id', run_record.id)
            ) on conflict (owner_id, event_key) do nothing;
        end if;
        memory_id := null;
    end loop;

    for item in select value from jsonb_array_elements(coalesce(reflection_payload -> 'memories', '[]'::jsonb))
    loop
        if nullif(btrim(item ->> 'content'), '') is null then continue; end if;
        insert into public.kiora_memories (
            owner_id, memory_type, content, summary, confidence, status,
            importance, context_tags, valid_from
        ) values (
            target_owner,
            case when item ->> 'memory_type' in ('episodic','semantic','relational','procedural','self','project','promise')
                then item ->> 'memory_type' else 'episodic' end,
            left(item ->> 'content', 12000),
            nullif(left(coalesce(item ->> 'summary', ''), 1000), ''),
            least(1, greatest(0, coalesce((item ->> 'confidence')::numeric, 0.55))),
            case when coalesce((item ->> 'confidence')::numeric, 0.55) >= 0.72 then 'active' else 'uncertain' end,
            least(1, greatest(0, coalesce((item ->> 'importance')::numeric, 0.5))),
            case when jsonb_typeof(item -> 'context_tags') = 'object' then item -> 'context_tags' else '{}'::jsonb end,
            now()
        ) returning id into memory_id;
        memory_count := memory_count + 1;

        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'memory-candidate:' || memory_id::text, 'MEMORY_CANDIDATE_CREATED',
            'memory', memory_id::text, run_record.conversation_id,
            jsonb_build_object('memory_type', item ->> 'memory_type', 'confidence', item -> 'confidence')
        );
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'memory-created:' || memory_id::text, 'MEMORY_CREATED',
            'memory', memory_id::text, run_record.conversation_id,
            jsonb_build_object('status', case when coalesce((item ->> 'confidence')::numeric, 0.55) >= 0.72 then 'active' else 'uncertain' end)
        );

        for evidence_item in select value from jsonb_array_elements(coalesce(item -> 'evidence', '[]'::jsonb))
        loop
            insert into public.kiora_memory_evidence (
                owner_id, memory_id, conversation_id, message_id, feedback_id,
                evidence_type, excerpt, weight
            ) values (
                target_owner,
                memory_id,
                run_record.conversation_id,
                nullif(evidence_item ->> 'message_id', '')::uuid,
                feedback_id,
                left(coalesce(evidence_item ->> 'evidence_type', 'conversation'), 80),
                nullif(left(coalesce(evidence_item ->> 'excerpt', ''), 1000), ''),
                least(1, greatest(0, coalesce((evidence_item ->> 'weight')::numeric, 1)))
            );
        end loop;

        old_memory_id := nullif(item ->> 'supersedes_memory_id', '')::uuid;
        if old_memory_id is not null and exists (
            select 1 from public.kiora_memories where owner_id = target_owner and id = old_memory_id
        ) then
            insert into public.kiora_memory_links (owner_id, from_memory_id, to_memory_id, relation, note)
            values (target_owner, memory_id, old_memory_id, 'supersedes', 'Reflection-supported supersession')
            on conflict (owner_id, from_memory_id, to_memory_id, relation) do nothing;
            update public.kiora_memories
            set status = 'superseded', superseded_by_id = memory_id, updated_at = now()
            where owner_id = target_owner and id = old_memory_id and status <> 'forgotten';
            insert into public.kiora_events (
                owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
            ) values (
                target_owner, 'memory-superseded:' || old_memory_id::text || ':' || memory_id::text,
                'MEMORY_SUPERSEDED', 'memory', old_memory_id::text, run_record.conversation_id,
                jsonb_build_object('superseded_by_id', memory_id)
            ) on conflict (owner_id, event_key) do nothing;
        end if;

        for link_item in select value from jsonb_array_elements(coalesce(item -> 'links', '[]'::jsonb))
        loop
            old_memory_id := nullif(link_item ->> 'target_memory_id', '')::uuid;
            if old_memory_id is not null
               and old_memory_id <> memory_id
               and link_item ->> 'relation' in ('related_to','supports','contradicts','caused_by','supersedes','part_of')
               and exists (select 1 from public.kiora_memories where owner_id = target_owner and id = old_memory_id)
            then
                insert into public.kiora_memory_links (owner_id, from_memory_id, to_memory_id, relation, note)
                values (
                    target_owner, memory_id, old_memory_id, link_item ->> 'relation',
                    nullif(left(coalesce(link_item ->> 'note', ''), 500), '')
                ) on conflict (owner_id, from_memory_id, to_memory_id, relation) do nothing;
                if link_item ->> 'relation' = 'supersedes' then
                    update public.kiora_memories
                    set status = 'superseded', superseded_by_id = memory_id, updated_at = now()
                    where owner_id = target_owner and id = old_memory_id and status <> 'forgotten';
                    insert into public.kiora_events (
                        owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
                    ) values (
                        target_owner, 'memory-superseded:' || old_memory_id::text || ':' || memory_id::text,
                        'MEMORY_SUPERSEDED', 'memory', old_memory_id::text, run_record.conversation_id,
                        jsonb_build_object('superseded_by_id', memory_id)
                    ) on conflict (owner_id, event_key) do nothing;
                elsif link_item ->> 'relation' = 'contradicts' then
                    update public.kiora_memories
                    set status = 'contradicted', updated_at = now()
                    where owner_id = target_owner and id = old_memory_id
                      and status not in ('forgotten', 'superseded');
                end if;
            end if;
        end loop;
    end loop;

    if jsonb_typeof(reflection_payload -> 'relationship_update') = 'object' then
        item := reflection_payload -> 'relationship_update';
        insert into public.kiora_relationship_snapshots (
            owner_id, snapshot_key, relationship_definition, interaction_patterns,
            shared_threads, important_history, unresolved_threads
        ) values (
            target_owner,
            'reflection:' || run_record.id::text,
            left(coalesce(nullif(item ->> 'relationship_definition', ''), 'long-term private AI companion'), 2000),
            case when jsonb_typeof(item -> 'interaction_patterns') = 'array' then item -> 'interaction_patterns' else '[]'::jsonb end,
            case when jsonb_typeof(item -> 'shared_threads') = 'array' then item -> 'shared_threads' else '[]'::jsonb end,
            case when jsonb_typeof(item -> 'important_history') = 'array' then item -> 'important_history' else '[]'::jsonb end,
            case when jsonb_typeof(item -> 'unresolved_threads') = 'array' then item -> 'unresolved_threads' else '[]'::jsonb end
        ) returning id into relationship_id;
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'relationship-snapshot:' || relationship_id::text,
            'RELATIONSHIP_SNAPSHOT_CREATED', 'relationship_snapshot', relationship_id::text,
            run_record.conversation_id, jsonb_build_object('reflection_model_run_id', run_record.id)
        );
    end if;

    if jsonb_typeof(reflection_payload -> 'self_update') = 'object' then
        item := reflection_payload -> 'self_update';
        perform pg_advisory_xact_lock(hashtextextended('kiora-self-state:' || target_owner::text, 0));
        select * into previous_self
        from public.kiora_self_state
        where owner_id = target_owner
        order by version desc limit 1;
        select coalesce(max(version), 0) + 1 into next_self_version
        from public.kiora_self_state where owner_id = target_owner;
        insert into public.kiora_self_state (
            owner_id, version, current_interests, open_questions, research_threads,
            recent_reflections, active_relationship_threads,
            current_growth_version_id, current_brain_model_id
        ) values (
            target_owner,
            next_self_version,
            case when jsonb_typeof(item -> 'current_interests') = 'array' then item -> 'current_interests' else coalesce(previous_self.current_interests, '[]'::jsonb) end,
            case when jsonb_typeof(item -> 'open_questions') = 'array' then item -> 'open_questions' else coalesce(previous_self.open_questions, '[]'::jsonb) end,
            coalesce(previous_self.research_threads, '[]'::jsonb),
            case when jsonb_typeof(item -> 'recent_reflections') = 'array'
                then coalesce(previous_self.recent_reflections, '[]'::jsonb) || (item -> 'recent_reflections')
                else coalesce(previous_self.recent_reflections, '[]'::jsonb) end,
            case when jsonb_typeof(item -> 'active_relationship_threads') = 'array' then item -> 'active_relationship_threads' else coalesce(previous_self.active_relationship_threads, '[]'::jsonb) end,
            previous_self.current_growth_version_id,
            run_record.model_id
        ) returning id into self_id;
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'self-state:' || self_id::text, 'SELF_STATE_UPDATED',
            'self_state', self_id::text, run_record.conversation_id,
            jsonb_build_object('version', next_self_version, 'reflection_model_run_id', run_record.id)
        );
    end if;

    for item in select value from jsonb_array_elements(coalesce(reflection_payload -> 'interests', '[]'::jsonb))
    loop
        if nullif(btrim(item ->> 'name'), '') is null then continue; end if;
        interest_id := null;
        select id into interest_id from public.kiora_interests
        where owner_id = target_owner and name = left(item ->> 'name', 240);
        interest_was_existing := interest_id is not null;
        insert into public.kiora_interests (
            owner_id, name, state, origin, description, confidence, last_observed_at
        ) values (
            target_owner, left(item ->> 'name', 240),
            case when item ->> 'state' in ('emerging','active','fading','inactive') then item ->> 'state' else 'emerging' end,
            left(coalesce(item ->> 'origin', 'reflection'), 500),
            nullif(left(coalesce(item ->> 'description', ''), 2000), ''),
            least(1, greatest(0, coalesce((item ->> 'confidence')::numeric, 0.5))), now()
        ) on conflict (owner_id, name) do update
        set state = excluded.state,
            description = coalesce(excluded.description, public.kiora_interests.description),
            confidence = greatest(public.kiora_interests.confidence, excluded.confidence),
            last_observed_at = now()
        returning id into interest_id;
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'interest:' || run_record.id::text || ':' || interest_id::text,
            case when interest_was_existing then 'INTEREST_UPDATED' else 'INTEREST_CREATED' end,
            'interest', interest_id::text, run_record.conversation_id,
            jsonb_build_object('state', item ->> 'state')
        ) on conflict (owner_id, event_key) do nothing;
    end loop;

    for item in select value from jsonb_array_elements(coalesce(reflection_payload -> 'habits', '[]'::jsonb))
    loop
        if nullif(btrim(item ->> 'name'), '') is null then continue; end if;
        select evidence_count into existing_habit_count from public.kiora_habits
        where owner_id = target_owner and name = left(item ->> 'name', 240);
        insert into public.kiora_habits (
            owner_id, name, description, status, evidence_count,
            confidence, first_seen_at, last_seen_at, state
        ) values (
            target_owner, left(item ->> 'name', 240), left(coalesce(item ->> 'description', ''), 3000),
            'candidate', 1,
            least(1, greatest(0, coalesce((item ->> 'confidence')::numeric, 0.5))), now(), now(), 'emerging'
        ) on conflict (owner_id, name) do update
        set description = excluded.description,
            evidence_count = public.kiora_habits.evidence_count + 1,
            confidence = least(1, greatest(public.kiora_habits.confidence, excluded.confidence)),
            last_seen_at = now(),
            updated_at = now(),
            status = case
                when item ->> 'state' = 'inactive' then 'retired'
                when public.kiora_habits.evidence_count + 1 >= 3 then 'active'
                else 'candidate' end,
            state = case
                when item ->> 'state' in ('fading','inactive') then item ->> 'state'
                when public.kiora_habits.evidence_count + 1 >= 3 then 'active'
                else 'emerging' end
        returning id, evidence_count into habit_id, existing_habit_count;
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'habit:' || run_record.id::text || ':' || habit_id::text,
            case when existing_habit_count > 1 then 'HABIT_UPDATED' else 'HABIT_CREATED' end,
            'habit', habit_id::text, run_record.conversation_id,
            jsonb_build_object('evidence_count', existing_habit_count)
        ) on conflict (owner_id, event_key) do nothing;
    end loop;

    for item in select value from jsonb_array_elements(coalesce(reflection_payload -> 'growth_candidates', '[]'::jsonb))
    loop
        if nullif(btrim(item ->> 'statement'), '') is null then continue; end if;
        insert into public.kiora_growth_candidates (
            owner_id, candidate_type, statement, provenance, evidence_count, priority, status
        ) values (
            target_owner,
            left(coalesce(item ->> 'candidate_type', 'interaction_pattern'), 120),
            left(item ->> 'statement', 6000),
            jsonb_build_object('reflection_model_run_id', run_record.id, 'conversation_id', run_record.conversation_id),
            1,
            coalesce((item ->> 'priority')::integer, 0),
            'candidate'
        ) returning id into growth_id;
        insert into public.kiora_events (
            owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
        ) values (
            target_owner, 'growth-candidate:' || growth_id::text, 'GROWTH_CANDIDATE_CREATED',
            'growth_candidate', growth_id::text, run_record.conversation_id,
            jsonb_build_object('candidate_type', item ->> 'candidate_type', 'reflection_model_run_id', run_record.id)
        );
    end loop;

    update public.kiora_model_runs
    set status = 'completed', provider_request_id = nullif(provider_request, ''),
        input_tokens = greatest(coalesce(used_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(used_output_tokens, 0), 0),
        usage_metadata = coalesce(used_metadata, '{}'::jsonb) || jsonb_build_object(
            'trigger', trigger_name,
            'purposes', jsonb_build_array('reflection','memory','relationship','self')
        ),
        input_cost = greatest(coalesce(used_input_cost, 0), 0),
        output_cost = greatest(coalesce(used_output_cost, 0), 0),
        total_cost = total_amount, currency = nullif(used_currency, ''), completed_at = now(), error_code = null
    where id = run_record.id;

    insert into public.kiora_usage_ledger (
        owner_id, model_run_id, category, quantity, unit, amount,
        currency, cost_config_snapshot, occurred_at
    ) values (
        target_owner, run_record.id, 'reflection',
        greatest(coalesce(used_input_tokens, 0) + coalesce(used_output_tokens, 0), 0),
        'tokens', total_amount, nullif(used_currency, ''), run_record.cost_snapshot, now()
    ) on conflict (model_run_id, category) where model_run_id is not null do update
    set quantity = excluded.quantity, amount = excluded.amount, currency = excluded.currency,
        cost_config_snapshot = excluded.cost_config_snapshot, occurred_at = excluded.occurred_at;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id, conversation_id, payload
    ) values (
        target_owner, 'reflection-completed:' || run_record.id::text, 'REFLECTION_COMPLETED',
        'model_run', run_record.id::text, run_record.conversation_id,
        jsonb_build_object(
            'trigger', trigger_name, 'memory_count', memory_count,
            'confirmation_count', confirmation_count,
            'relationship_snapshot_id', relationship_id, 'self_state_id', self_id
        )
    );

    return jsonb_build_object(
        'model_run_id', run_record.id, 'memory_count', memory_count,
        'confirmation_count', confirmation_count,
        'relationship_snapshot_id', relationship_id, 'self_state_id', self_id,
        'duplicate', false
    );
end;
$$;


create or replace function public.kiora_defer_reflection(
    target_owner uuid,
    target_conversation_id uuid,
    source_message_id uuid,
    reflection_trigger text,
    defer_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    task_record public.kiora_tasks%rowtype;
    event_key_value text := 'reflection-deferred:' || target_conversation_id::text || ':' || source_message_id::text;
begin
    perform pg_advisory_xact_lock(hashtextextended(event_key_value, 0));
    if exists (
        select 1 from public.kiora_events
        where owner_id = target_owner and event_key = event_key_value
    ) then
        select * into task_record from public.kiora_tasks
        where owner_id = target_owner
          and task_type = 'reflection'
          and payload ->> 'source_message_id' = source_message_id::text
        order by created_at desc limit 1;
        return jsonb_build_object('task_id', task_record.id, 'duplicate', true);
    end if;

    insert into public.kiora_tasks (owner_id, task_type, status, priority, payload, not_before)
    values (
        target_owner, 'reflection', 'queued', 0,
        jsonb_build_object(
            'conversation_id', target_conversation_id,
            'source_message_id', source_message_id,
            'trigger', left(coalesce(reflection_trigger, 'unknown'), 80),
            'reason', left(coalesce(defer_reason, 'budget'), 120)
        ),
        date_trunc('month', now()) + interval '1 month'
    ) returning * into task_record;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id, conversation_id, message_id, payload
    ) values (
        target_owner, event_key_value, 'REFLECTION_DEFERRED', 'task', task_record.id::text,
        target_conversation_id, source_message_id,
        jsonb_build_object('trigger', reflection_trigger, 'reason', defer_reason)
    );
    return jsonb_build_object('task_id', task_record.id, 'duplicate', false);
end;
$$;


create or replace function public.kiora_fail_reflection(
    target_owner uuid,
    target_model_run_id uuid,
    failure_code text,
    provider_request text,
    used_input_tokens bigint,
    used_output_tokens bigint,
    used_input_cost numeric,
    used_output_cost numeric,
    used_currency text,
    used_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    run_record public.kiora_model_runs%rowtype;
    total_amount numeric := greatest(coalesce(used_input_cost, 0) + coalesce(used_output_cost, 0), 0);
begin
    select * into run_record from public.kiora_model_runs
    where owner_id = target_owner and id = target_model_run_id for update;
    if not found or run_record.run_kind <> 'reflection' then raise exception 'REFLECTION_RUN_NOT_FOUND'; end if;
    if run_record.status = 'completed' then return jsonb_build_object('status', 'completed'); end if;
    update public.kiora_model_runs
    set status = 'failed', completed_at = now(), error_code = left(coalesce(failure_code, 'REFLECTION_FAILED'), 120),
        provider_request_id = nullif(provider_request, ''),
        input_tokens = greatest(coalesce(used_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(used_output_tokens, 0), 0),
        input_cost = greatest(coalesce(used_input_cost, 0), 0),
        output_cost = greatest(coalesce(used_output_cost, 0), 0),
        total_cost = total_amount,
        currency = nullif(used_currency, ''),
        usage_metadata = coalesce(used_metadata, '{}'::jsonb)
    where id = run_record.id;
    insert into public.kiora_usage_ledger (
        owner_id, model_run_id, category, quantity, unit, amount, currency, cost_config_snapshot, occurred_at
    ) values (
        target_owner, run_record.id, 'reflection',
        greatest(coalesce(used_input_tokens, 0) + coalesce(used_output_tokens, 0), 0),
        'tokens', total_amount,
        coalesce(nullif(used_currency, ''), nullif(run_record.cost_snapshot ->> 'currency', '')),
        run_record.cost_snapshot, now()
    ) on conflict (model_run_id, category) where model_run_id is not null do update
    set quantity = excluded.quantity, amount = excluded.amount, currency = excluded.currency,
        cost_config_snapshot = excluded.cost_config_snapshot, occurred_at = excluded.occurred_at;
    return jsonb_build_object('status', 'failed', 'model_run_id', run_record.id);
end;
$$;


create or replace function public.kiora_forget_memory(target_owner uuid, target_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    update public.kiora_memories
    set status = 'forgotten', forgotten_at = now(), updated_at = now()
    where owner_id = target_owner and id = target_memory_id;
    if not found then return false; end if;
    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id, payload
    ) values (
        target_owner, 'memory-forgotten:' || target_memory_id::text,
        'MEMORY_FORGOTTEN', 'memory', target_memory_id::text,
        jsonb_build_object('retrieval_excluded', true)
    ) on conflict (owner_id, event_key) do nothing;
    return true;
end;
$$;


create or replace function public.kiora_delete_memory(target_owner uuid, target_memory_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
    delete from public.kiora_memories where owner_id = target_owner and id = target_memory_id;
    return found;
end;
$$;


-- Deleting a source message must not leave its private excerpt in evidence.
create or replace function public.kiora_redact_deleted_life_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    record_type text := tg_argv[0];
begin
    if record_type = 'conversation' then
        delete from public.kiora_memories memory
        where memory.owner_id = old.owner_id
          and exists (
              select 1 from public.kiora_memory_evidence evidence
              where evidence.owner_id = old.owner_id
                and evidence.memory_id = memory.id
                and evidence.conversation_id = old.id
          )
          and not exists (
              select 1 from public.kiora_memory_evidence other_evidence
              where other_evidence.owner_id = old.owner_id
                and other_evidence.memory_id = memory.id
                and other_evidence.conversation_id is distinct from old.id
          );
    elsif record_type = 'message' then
        delete from public.kiora_memories memory
        where memory.owner_id = old.owner_id
          and exists (
              select 1 from public.kiora_memory_evidence evidence
              where evidence.owner_id = old.owner_id
                and evidence.memory_id = memory.id
                and evidence.message_id = old.id
          )
          and not exists (
              select 1 from public.kiora_memory_evidence other_evidence
              where other_evidence.owner_id = old.owner_id
                and other_evidence.memory_id = memory.id
                and other_evidence.message_id is distinct from old.id
          );
        delete from public.kiora_memory_evidence
        where owner_id = old.owner_id and message_id = old.id;
        delete from public.kiora_feedback
        where owner_id = old.owner_id and message_id = old.id;
        delete from public.kiora_retrieval_index
        where owner_id = old.owner_id and source_type = 'message' and source_id = old.id::text;
    elsif record_type = 'memory' then
        delete from public.kiora_retrieval_index
        where owner_id = old.owner_id and source_type = 'memory' and source_id = old.id::text;
    end if;

    update public.kiora_events
    set payload = jsonb_build_object('redacted', true, 'record_type', record_type, 'record_id', old.id::text),
        subject_id = null, redacted_at = now(), redaction_reason = 'OWNER_DELETED_SOURCE'
    where owner_id = old.owner_id and redacted_at is null
      and (
          (subject_type = record_type and subject_id = old.id::text)
          or (record_type = 'conversation' and conversation_id = old.id)
          or (record_type = 'message' and message_id = old.id)
          or (record_type = 'feedback' and feedback_id = old.id)
      );
    return old;
end;
$$;


revoke all on function public.kiora_enable_phase2(uuid) from public, anon, authenticated;
revoke all on function public.kiora_begin_reflection(uuid, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.kiora_complete_reflection(uuid, uuid, jsonb, text, bigint, bigint, numeric, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.kiora_fail_reflection(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.kiora_defer_reflection(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.kiora_forget_memory(uuid, uuid) from public, anon, authenticated;
revoke all on function public.kiora_delete_memory(uuid, uuid) from public, anon, authenticated;

grant execute on function public.kiora_enable_phase2(uuid) to service_role;
grant execute on function public.kiora_begin_reflection(uuid, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.kiora_complete_reflection(uuid, uuid, jsonb, text, bigint, bigint, numeric, numeric, text, jsonb) to service_role;
grant execute on function public.kiora_fail_reflection(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) to service_role;
grant execute on function public.kiora_defer_reflection(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.kiora_forget_memory(uuid, uuid) to service_role;
grant execute on function public.kiora_delete_memory(uuid, uuid) to service_role;

commit;
