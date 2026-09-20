-- Kiora Life Architecture 1.0 — Phase 1 transactional runtime operations
-- Run after supabase-kiora-migration.sql.

begin;

alter table public.kiora_messages
    add column if not exists client_message_key text;

create unique index if not exists kiora_messages_client_key_uidx
    on public.kiora_messages(owner_id, conversation_id, client_message_key)
    where client_message_key is not null;

alter table public.kiora_model_runs
    add column if not exists turn_key text;

create unique index if not exists kiora_model_runs_turn_key_uidx
    on public.kiora_model_runs(owner_id, turn_key)
    where turn_key is not null;

create unique index if not exists kiora_usage_model_run_category_uidx
    on public.kiora_usage_ledger(model_run_id, category)
    where model_run_id is not null;


create or replace function public.kiora_start_phase1(target_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    boot jsonb;
begin
    if target_owner is null or not exists (
        select 1 from public.site_owners where user_id = target_owner
    ) then
        raise exception 'KIORA_OWNER_REQUIRED';
    end if;

    boot := public.kiora_first_boot(target_owner);

    update public.kiora_settings
    set feature_flags = jsonb_set(feature_flags, '{chat_enabled}', 'true'::jsonb, true),
        updated_at = now()
    where owner_id = target_owner;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, payload
    ) values (
        target_owner,
        'phase-1-enabled',
        'PHASE_ENABLED',
        'runtime',
        jsonb_build_object('phase', 1, 'chat_enabled', true)
    )
    on conflict (owner_id, event_key) do nothing;

    return boot || jsonb_build_object('chat_enabled', true);
end;
$$;


create or replace function public.kiora_create_conversation(
    target_owner uuid,
    conversation_title text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    settings_row public.kiora_settings%rowtype;
    new_conversation public.kiora_conversations%rowtype;
begin
    select * into settings_row
    from public.kiora_settings
    where owner_id = target_owner
    for update;

    if not found or coalesce((settings_row.feature_flags ->> 'chat_enabled')::boolean, false) is not true then
        raise exception 'KIORA_NOT_STARTED';
    end if;

    insert into public.kiora_conversations (owner_id, title, status)
    values (
        target_owner,
        nullif(left(btrim(coalesce(conversation_title, '')), 160), ''),
        'active'
    )
    returning * into new_conversation;

    update public.kiora_settings
    set active_conversation_id = new_conversation.id,
        updated_at = now()
    where owner_id = target_owner;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id,
        conversation_id, payload
    ) values (
        target_owner,
        'conversation-created:' || new_conversation.id::text,
        'CONVERSATION_CREATED',
        'conversation',
        new_conversation.id::text,
        new_conversation.id,
        jsonb_build_object('title', new_conversation.title)
    );

    return jsonb_build_object(
        'id', new_conversation.id,
        'title', new_conversation.title,
        'status', new_conversation.status,
        'started_at', new_conversation.started_at
    );
end;
$$;


create or replace function public.kiora_begin_turn(
    target_owner uuid,
    message_content text,
    message_page_context jsonb,
    message_client_key text,
    selected_model_id uuid,
    model_cost_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    settings_row public.kiora_settings%rowtype;
    owner_message public.kiora_messages%rowtype;
    run_record public.kiora_model_runs%rowtype;
    clean_content text := btrim(coalesce(message_content, ''));
    clean_key text := btrim(coalesce(message_client_key, ''));
begin
    if char_length(clean_content) < 1 or char_length(clean_content) > 6000 then
        raise exception 'INVALID_MESSAGE';
    end if;
    if char_length(clean_key) < 8 or char_length(clean_key) > 160 then
        raise exception 'INVALID_TURN_KEY';
    end if;
    if jsonb_typeof(coalesce(message_page_context, '{}'::jsonb)) <> 'object'
       or jsonb_typeof(coalesce(model_cost_snapshot, '{}'::jsonb)) <> 'object' then
        raise exception 'INVALID_CONTEXT';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('kiora-turn:' || target_owner::text || ':' || clean_key, 0));

    select * into settings_row
    from public.kiora_settings
    where owner_id = target_owner
    for update;

    if not found or coalesce((settings_row.feature_flags ->> 'chat_enabled')::boolean, false) is not true then
        raise exception 'KIORA_NOT_STARTED';
    end if;
    if settings_row.active_conversation_id is null then
        raise exception 'ACTIVE_CONVERSATION_MISSING';
    end if;
    if not exists (
        select 1 from public.kiora_models
        where owner_id = target_owner and id = selected_model_id
    ) then
        raise exception 'MODEL_NOT_FOUND';
    end if;

    select * into owner_message
    from public.kiora_messages
    where owner_id = target_owner
      and conversation_id = settings_row.active_conversation_id
      and client_message_key = clean_key;

    if found then
        select * into run_record
        from public.kiora_model_runs
        where owner_id = target_owner and turn_key = clean_key;
        return jsonb_build_object(
            'message_id', owner_message.id,
            'conversation_id', owner_message.conversation_id,
            'model_run_id', run_record.id,
            'duplicate', true
        );
    end if;

    insert into public.kiora_messages (
        owner_id, conversation_id, role, content, page_context, client_message_key
    ) values (
        target_owner,
        settings_row.active_conversation_id,
        'owner',
        clean_content,
        coalesce(message_page_context, '{}'::jsonb),
        clean_key
    )
    returning * into owner_message;

    insert into public.kiora_model_runs (
        owner_id, model_id, conversation_id, request_message_id,
        turn_key, run_kind, status, cost_snapshot
    ) values (
        target_owner,
        selected_model_id,
        owner_message.conversation_id,
        owner_message.id,
        clean_key,
        'chat',
        'started',
        coalesce(model_cost_snapshot, '{}'::jsonb)
    )
    returning * into run_record;

    update public.kiora_messages
    set model_run_id = run_record.id
    where id = owner_message.id;

    update public.kiora_conversations
    set last_message_at = owner_message.created_at,
        updated_at = now()
    where owner_id = target_owner and id = owner_message.conversation_id;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id,
        conversation_id, message_id, payload
    ) values (
        target_owner,
        'owner-message:' || owner_message.id::text,
        'USER_MESSAGE',
        'message',
        owner_message.id::text,
        owner_message.conversation_id,
        owner_message.id,
        jsonb_build_object(
            'content_length', char_length(clean_content),
            'page', message_page_context ->> 'page'
        )
    );

    return jsonb_build_object(
        'message_id', owner_message.id,
        'conversation_id', owner_message.conversation_id,
        'model_run_id', run_record.id,
        'duplicate', false
    );
end;
$$;


create or replace function public.kiora_complete_turn(
    target_owner uuid,
    target_model_run_id uuid,
    assistant_content text,
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
    assistant_message public.kiora_messages%rowtype;
    clean_content text := btrim(coalesce(assistant_content, ''));
    total_amount numeric := coalesce(used_input_cost, 0) + coalesce(used_output_cost, 0);
begin
    if char_length(clean_content) < 1 or char_length(clean_content) > 20000 then
        raise exception 'INVALID_ASSISTANT_MESSAGE';
    end if;
    if coalesce(used_input_tokens, 0) < 0 or coalesce(used_output_tokens, 0) < 0
       or coalesce(used_input_cost, 0) < 0 or coalesce(used_output_cost, 0) < 0 then
        raise exception 'INVALID_USAGE';
    end if;

    select * into run_record
    from public.kiora_model_runs
    where owner_id = target_owner and id = target_model_run_id
    for update;

    if not found then raise exception 'MODEL_RUN_NOT_FOUND'; end if;

    if run_record.status = 'completed' and run_record.response_message_id is not null then
        select * into assistant_message
        from public.kiora_messages
        where owner_id = target_owner and id = run_record.response_message_id;
        return jsonb_build_object(
            'message_id', assistant_message.id,
            'content', assistant_message.content,
            'created_at', assistant_message.created_at,
            'duplicate', true
        );
    end if;

    insert into public.kiora_messages (
        owner_id, conversation_id, role, content, reply_to_message_id,
        model_run_id, page_context
    ) values (
        target_owner,
        run_record.conversation_id,
        'kiora',
        clean_content,
        run_record.request_message_id,
        run_record.id,
        '{}'::jsonb
    )
    returning * into assistant_message;

    update public.kiora_model_runs
    set response_message_id = assistant_message.id,
        status = 'completed',
        provider_request_id = nullif(provider_request, ''),
        input_tokens = coalesce(used_input_tokens, 0),
        output_tokens = coalesce(used_output_tokens, 0),
        usage_metadata = coalesce(used_metadata, '{}'::jsonb),
        input_cost = coalesce(used_input_cost, 0),
        output_cost = coalesce(used_output_cost, 0),
        total_cost = total_amount,
        currency = nullif(used_currency, ''),
        completed_at = now(),
        error_code = null
    where id = run_record.id;

    insert into public.kiora_usage_ledger (
        owner_id, model_run_id, category, quantity, unit, amount,
        currency, cost_config_snapshot, occurred_at
    ) values (
        target_owner,
        run_record.id,
        'chat',
        coalesce(used_input_tokens, 0) + coalesce(used_output_tokens, 0),
        'tokens',
        total_amount,
        nullif(used_currency, ''),
        run_record.cost_snapshot,
        now()
    )
    on conflict (model_run_id, category) where model_run_id is not null
    do update set
        quantity = excluded.quantity,
        amount = excluded.amount,
        currency = excluded.currency,
        cost_config_snapshot = excluded.cost_config_snapshot,
        occurred_at = excluded.occurred_at;

    update public.kiora_conversations
    set last_message_at = assistant_message.created_at,
        updated_at = now()
    where owner_id = target_owner and id = assistant_message.conversation_id;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id,
        conversation_id, message_id, payload
    ) values (
        target_owner,
        'kiora-message:' || assistant_message.id::text,
        'KIORA_MESSAGE',
        'message',
        assistant_message.id::text,
        assistant_message.conversation_id,
        assistant_message.id,
        jsonb_build_object('content_length', char_length(clean_content), 'model_run_id', run_record.id)
    );

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id,
        conversation_id, payload
    ) values (
        target_owner,
        'model-run-completed:' || run_record.id::text,
        'MODEL_RUN_COMPLETED',
        'model_run',
        run_record.id::text,
        run_record.conversation_id,
        jsonb_build_object(
            'input_tokens', coalesce(used_input_tokens, 0),
            'output_tokens', coalesce(used_output_tokens, 0),
            'total_cost', total_amount,
            'currency', nullif(used_currency, '')
        )
    );

    return jsonb_build_object(
        'message_id', assistant_message.id,
        'content', assistant_message.content,
        'created_at', assistant_message.created_at,
        'duplicate', false
    );
end;
$$;


create or replace function public.kiora_fail_turn(
    target_owner uuid,
    target_model_run_id uuid,
    failure_code text,
    provider_request text default null,
    used_input_tokens bigint default 0,
    used_output_tokens bigint default 0,
    used_input_cost numeric default 0,
    used_output_cost numeric default 0,
    used_currency text default null,
    used_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    run_record public.kiora_model_runs%rowtype;
    total_amount numeric := coalesce(used_input_cost, 0) + coalesce(used_output_cost, 0);
    clean_code text := left(coalesce(nullif(btrim(failure_code), ''), 'MODEL_RUN_FAILED'), 120);
begin
    select * into run_record
    from public.kiora_model_runs
    where owner_id = target_owner and id = target_model_run_id
    for update;

    if not found then raise exception 'MODEL_RUN_NOT_FOUND'; end if;
    if run_record.status = 'completed' then
        return jsonb_build_object('status', 'completed', 'model_run_id', run_record.id);
    end if;

    update public.kiora_model_runs
    set status = 'failed',
        provider_request_id = coalesce(nullif(provider_request, ''), provider_request_id),
        input_tokens = greatest(coalesce(used_input_tokens, 0), 0),
        output_tokens = greatest(coalesce(used_output_tokens, 0), 0),
        usage_metadata = coalesce(used_metadata, '{}'::jsonb),
        input_cost = greatest(coalesce(used_input_cost, 0), 0),
        output_cost = greatest(coalesce(used_output_cost, 0), 0),
        total_cost = greatest(total_amount, 0),
        currency = nullif(used_currency, ''),
        completed_at = now(),
        error_code = clean_code
    where id = run_record.id;

    insert into public.kiora_usage_ledger (
        owner_id, model_run_id, category, quantity, unit, amount,
        currency, cost_config_snapshot, occurred_at
    ) values (
        target_owner,
        run_record.id,
        'chat',
        greatest(coalesce(used_input_tokens, 0) + coalesce(used_output_tokens, 0), 0),
        'tokens',
        greatest(total_amount, 0),
        nullif(used_currency, ''),
        run_record.cost_snapshot,
        now()
    )
    on conflict (model_run_id, category) where model_run_id is not null
    do update set
        quantity = excluded.quantity,
        amount = excluded.amount,
        currency = excluded.currency,
        cost_config_snapshot = excluded.cost_config_snapshot,
        occurred_at = excluded.occurred_at;

    insert into public.kiora_events (
        owner_id, event_key, event_type, subject_type, subject_id,
        conversation_id, payload
    ) values (
        target_owner,
        'model-run-failed:' || run_record.id::text,
        'MODEL_RUN_FAILED',
        'model_run',
        run_record.id::text,
        run_record.conversation_id,
        jsonb_build_object('code', clean_code, 'usage_recorded', true)
    )
    on conflict (owner_id, event_key) do update
    set payload = excluded.payload;

    return jsonb_build_object('status', 'failed', 'model_run_id', run_record.id, 'code', clean_code);
end;
$$;


revoke all on function public.kiora_start_phase1(uuid) from public, anon, authenticated;
revoke all on function public.kiora_create_conversation(uuid, text) from public, anon, authenticated;
revoke all on function public.kiora_begin_turn(uuid, text, jsonb, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.kiora_complete_turn(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) from public, anon, authenticated;
revoke all on function public.kiora_fail_turn(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) from public, anon, authenticated;

grant execute on function public.kiora_start_phase1(uuid) to service_role;
grant execute on function public.kiora_create_conversation(uuid, text) to service_role;
grant execute on function public.kiora_begin_turn(uuid, text, jsonb, text, uuid, jsonb) to service_role;
grant execute on function public.kiora_complete_turn(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) to service_role;
grant execute on function public.kiora_fail_turn(uuid, uuid, text, text, bigint, bigint, numeric, numeric, text, jsonb) to service_role;

commit;
