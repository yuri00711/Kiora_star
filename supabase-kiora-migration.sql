-- Kiora Life Architecture 1.0 / Phase 0
--
-- This migration creates Kiora's durable, model-independent life store.
-- It does not add chat UI, call a model, or enable any runtime feature.
--
-- Security invariants:
--   * OWNER identity is sourced from auth.uid() + public.is_site_owner().
--   * anon and EDITOR receive no access to Kiora private data.
--   * authenticated browsers receive read-only access to their own Kiora rows.
--   * core life writes are reserved for the service-side Kiora Runtime.
--   * events are append-oriented, but deletion triggers redact private payloads.

begin;

create extension if not exists pgcrypto;


-- =========================================================
-- OWNER REGISTRY
-- =========================================================

create table if not exists public.site_owners (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.site_owners enable row level security;
revoke all on table public.site_owners from anon, authenticated;

create or replace function public.is_site_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.site_owners owner_record
        where owner_record.user_id = (select auth.uid())
    );
$$;

revoke all on function public.is_site_owner() from public;
grant execute on function public.is_site_owner() to authenticated;


-- =========================================================
-- VERSIONED CORE / BRAIN / GROWTH FOUNDATIONS
-- =========================================================

create table public.kiora_core_versions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    version text not null,
    status text not null default 'draft'
        check (status in ('draft', 'active', 'retired')),
    definition jsonb not null default '{}'::jsonb
        check (jsonb_typeof(definition) = 'object'),
    change_note text,
    checksum text,
    created_at timestamptz not null default now(),
    promoted_at timestamptz,
    retired_at timestamptz,
    unique (owner_id, version),
    unique (owner_id, id)
);

create table public.kiora_models (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    brain_role text not null
        check (brain_role in ('daily', 'deep', 'research', 'embedding', 'reranker')),
    provider text not null,
    model_key text not null,
    runtime text not null default 'remote',
    adapter text not null,
    version text not null default 'unspecified',
    status text not null default 'inactive'
        check (status in ('unconfigured', 'candidate', 'active', 'inactive', 'retired')),
    is_local boolean not null default false,
    -- Provider-neutral pricing contract. A configured model records its own
    -- input_cost, output_cost, currency and billing_unit here. Extra provider
    -- dimensions (for example cached input) remain model data, not budget code.
    cost_config jsonb not null default '{}'::jsonb
        check (jsonb_typeof(cost_config) = 'object'),
    capabilities jsonb not null default '{}'::jsonb
        check (jsonb_typeof(capabilities) = 'object'),
    config jsonb not null default '{}'::jsonb
        check (jsonb_typeof(config) = 'object'),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    retired_at timestamptz,
    unique (owner_id, brain_role, provider, model_key, version),
    unique (owner_id, id)
);

create table public.kiora_datasets (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    version text not null,
    status text not null default 'draft'
        check (status in ('draft', 'review', 'frozen', 'retired')),
    manifest jsonb not null default '{}'::jsonb
        check (jsonb_typeof(manifest) = 'object'),
    created_at timestamptz not null default now(),
    frozen_at timestamptz,
    unique (owner_id, name, version),
    unique (owner_id, id)
);

create table public.kiora_growth_versions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    version text not null,
    status text not null default 'draft'
        check (status in ('draft', 'candidate', 'active', 'rolled_back', 'retired')),
    dataset_id uuid,
    model_id uuid,
    adapter_ref text,
    summary text,
    evaluation_summary jsonb not null default '{}'::jsonb
        check (jsonb_typeof(evaluation_summary) = 'object'),
    created_at timestamptz not null default now(),
    promoted_at timestamptz,
    retired_at timestamptz,
    unique (owner_id, version),
    unique (owner_id, id),
    foreign key (dataset_id)
        references public.kiora_datasets(id) on delete set null,
    foreign key (model_id)
        references public.kiora_models(id) on delete set null
);


-- =========================================================
-- CONVERSATION / MESSAGE / EVENT LIFE HISTORY
-- =========================================================

create table public.kiora_conversations (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    conversation_key text,
    title text,
    status text not null default 'active'
        check (status in ('active', 'archived')),
    summary text,
    started_at timestamptz not null default now(),
    last_message_at timestamptz,
    archived_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, conversation_key),
    unique (owner_id, id)
);

create table public.kiora_messages (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    conversation_id uuid not null,
    role text not null
        check (role in ('owner', 'kiora', 'system', 'tool')),
    content text not null,
    content_format text not null default 'text',
    page_context jsonb not null default '{}'::jsonb
        check (jsonb_typeof(page_context) = 'object'),
    reply_to_message_id uuid,
    model_run_id uuid,
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (owner_id, conversation_id)
        references public.kiora_conversations(owner_id, id) on delete cascade,
    foreign key (reply_to_message_id)
        references public.kiora_messages(id) on delete set null
);

create table public.kiora_feedback (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    conversation_id uuid,
    message_id uuid,
    feedback_type text not null
        check (feedback_type in ('accepted', 'rejected', 'correction', 'preference', 'other')),
    content text,
    structured_feedback jsonb not null default '{}'::jsonb
        check (jsonb_typeof(structured_feedback) = 'object'),
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (owner_id, conversation_id)
        references public.kiora_conversations(owner_id, id) on delete cascade,
    foreign key (message_id)
        references public.kiora_messages(id) on delete set null
);

create table public.kiora_events (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    event_key text,
    event_type text not null check (char_length(event_type) between 1 and 120),
    subject_type text,
    subject_id text,
    conversation_id uuid,
    message_id uuid,
    feedback_id uuid,
    payload jsonb not null default '{}'::jsonb
        check (jsonb_typeof(payload) = 'object'),
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    redacted_at timestamptz,
    redaction_reason text,
    unique (owner_id, event_key),
    unique (owner_id, id),
    foreign key (conversation_id)
        references public.kiora_conversations(id) on delete set null,
    foreign key (message_id)
        references public.kiora_messages(id) on delete set null,
    foreign key (feedback_id)
        references public.kiora_feedback(id) on delete set null
);


-- =========================================================
-- MEMORY / RELATIONSHIP / SELF
-- =========================================================

create table public.kiora_memories (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    memory_type text not null
        check (memory_type in ('episodic', 'semantic', 'relational', 'procedural', 'self', 'project', 'promise')),
    content text not null,
    summary text,
    confidence numeric not null default 0.5
        check (confidence between 0 and 1),
    status text not null default 'active'
        check (status in ('candidate', 'active', 'superseded', 'contradicted', 'forgotten')),
    importance numeric not null default 0.5
        check (importance between 0 and 1),
    valid_from timestamptz,
    valid_until timestamptz,
    superseded_by_id uuid,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (superseded_by_id)
        references public.kiora_memories(id) on delete set null
);

create table public.kiora_memory_evidence (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    memory_id uuid not null,
    conversation_id uuid,
    message_id uuid,
    feedback_id uuid,
    event_id uuid,
    evidence_type text not null default 'conversation',
    excerpt text,
    weight numeric not null default 1 check (weight between 0 and 1),
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (owner_id, memory_id)
        references public.kiora_memories(owner_id, id) on delete cascade,
    foreign key (owner_id, conversation_id)
        references public.kiora_conversations(owner_id, id) on delete cascade,
    foreign key (message_id)
        references public.kiora_messages(id) on delete set null,
    foreign key (feedback_id)
        references public.kiora_feedback(id) on delete set null,
    foreign key (event_id)
        references public.kiora_events(id) on delete set null
);

create table public.kiora_memory_links (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    from_memory_id uuid not null,
    to_memory_id uuid not null,
    relation text not null
        check (relation in ('related_to', 'supports', 'contradicts', 'caused_by', 'supersedes', 'part_of')),
    note text,
    created_at timestamptz not null default now(),
    unique (owner_id, from_memory_id, to_memory_id, relation),
    foreign key (owner_id, from_memory_id)
        references public.kiora_memories(owner_id, id) on delete cascade,
    foreign key (owner_id, to_memory_id)
        references public.kiora_memories(owner_id, id) on delete cascade,
    check (from_memory_id <> to_memory_id)
);

create table public.kiora_relationship_snapshots (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    snapshot_key text,
    relationship_definition text not null,
    interaction_patterns jsonb not null default '[]'::jsonb
        check (jsonb_typeof(interaction_patterns) = 'array'),
    shared_threads jsonb not null default '[]'::jsonb
        check (jsonb_typeof(shared_threads) = 'array'),
    important_history jsonb not null default '[]'::jsonb
        check (jsonb_typeof(important_history) = 'array'),
    unresolved_threads jsonb not null default '[]'::jsonb
        check (jsonb_typeof(unresolved_threads) = 'array'),
    created_at timestamptz not null default now(),
    unique (owner_id, snapshot_key),
    unique (owner_id, id)
);

create table public.kiora_self_state (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    version bigint not null,
    current_interests jsonb not null default '[]'::jsonb
        check (jsonb_typeof(current_interests) = 'array'),
    open_questions jsonb not null default '[]'::jsonb
        check (jsonb_typeof(open_questions) = 'array'),
    research_threads jsonb not null default '[]'::jsonb
        check (jsonb_typeof(research_threads) = 'array'),
    recent_reflections jsonb not null default '[]'::jsonb
        check (jsonb_typeof(recent_reflections) = 'array'),
    current_growth_version_id uuid,
    current_brain_model_id uuid,
    created_at timestamptz not null default now(),
    unique (owner_id, version),
    unique (owner_id, id),
    foreign key (current_growth_version_id)
        references public.kiora_growth_versions(id) on delete set null,
    foreign key (current_brain_model_id)
        references public.kiora_models(id) on delete set null
);

create table public.kiora_interests (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    state text not null default 'emerging'
        check (state in ('emerging', 'active', 'fading', 'inactive')),
    origin text,
    description text,
    confidence numeric not null default 0.5 check (confidence between 0 and 1),
    first_observed_at timestamptz not null default now(),
    last_observed_at timestamptz not null default now(),
    unique (owner_id, name),
    unique (owner_id, id)
);

create table public.kiora_habits (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    name text not null,
    description text not null,
    status text not null default 'candidate'
        check (status in ('candidate', 'active', 'retired')),
    evidence_count integer not null default 0 check (evidence_count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, name),
    unique (owner_id, id)
);


-- =========================================================
-- GROWTH / TRAINING / EVALUATION
-- =========================================================

create table public.kiora_growth_candidates (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    candidate_type text not null,
    statement text not null,
    provenance jsonb not null default '{}'::jsonb
        check (jsonb_typeof(provenance) = 'object'),
    evidence_count integer not null default 1 check (evidence_count > 0),
    priority integer not null default 0,
    status text not null default 'candidate'
        check (status in ('candidate', 'accepted', 'rejected', 'promoted')),
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    unique (owner_id, id)
);

create table public.kiora_training_examples (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    dataset_id uuid,
    growth_candidate_id uuid,
    source_message_id uuid,
    source_feedback_id uuid,
    context jsonb not null default '{}'::jsonb
        check (jsonb_typeof(context) = 'object'),
    user_input text not null,
    preferred_output text not null,
    rejected_output text,
    rationale text,
    provenance jsonb not null default '{}'::jsonb
        check (jsonb_typeof(provenance) = 'object'),
    status text not null default 'draft'
        check (status in ('draft', 'reviewed', 'included', 'rejected')),
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (dataset_id)
        references public.kiora_datasets(id) on delete set null,
    foreign key (growth_candidate_id)
        references public.kiora_growth_candidates(id) on delete set null,
    foreign key (source_message_id)
        references public.kiora_messages(id) on delete set null,
    foreign key (source_feedback_id)
        references public.kiora_feedback(id) on delete set null
);

create table public.kiora_evaluations (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    model_id uuid,
    growth_version_id uuid,
    evaluation_type text not null
        check (evaluation_type in ('personality', 'relationship', 'memory', 'hallucination', 'research', 'tool', 'shadow', 'other')),
    status text not null default 'pending'
        check (status in ('pending', 'running', 'passed', 'failed', 'critical_fail')),
    score numeric,
    result jsonb not null default '{}'::jsonb
        check (jsonb_typeof(result) = 'object'),
    critical_failures jsonb not null default '[]'::jsonb
        check (jsonb_typeof(critical_failures) = 'array'),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (model_id)
        references public.kiora_models(id) on delete set null,
    foreign key (growth_version_id)
        references public.kiora_growth_versions(id) on delete set null
);


-- =========================================================
-- WORLD KNOWLEDGE / RESEARCH
-- =========================================================

create table public.kiora_sources (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    url text not null,
    title text,
    domain text,
    author text,
    published_at timestamptz,
    retrieved_at timestamptz not null default now(),
    confidence numeric not null default 0.5 check (confidence between 0 and 1),
    content_hash text,
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    unique (owner_id, url, content_hash),
    unique (owner_id, id)
);

create table public.kiora_knowledge (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    statement text not null,
    summary text,
    status text not null default 'candidate'
        check (status in ('candidate', 'verified', 'disputed', 'outdated', 'retracted')),
    confidence numeric not null default 0.5 check (confidence between 0 and 1),
    valid_from timestamptz,
    valid_until timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (owner_id, id)
);

create table public.kiora_knowledge_sources (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    knowledge_id uuid not null,
    source_id uuid not null,
    relation text not null default 'supports'
        check (relation in ('supports', 'contradicts', 'mentions', 'supersedes')),
    note text,
    created_at timestamptz not null default now(),
    unique (owner_id, knowledge_id, source_id, relation),
    foreign key (owner_id, knowledge_id)
        references public.kiora_knowledge(owner_id, id) on delete cascade,
    foreign key (owner_id, source_id)
        references public.kiora_sources(owner_id, id) on delete cascade
);

create table public.kiora_open_questions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    question text not null,
    status text not null default 'open'
        check (status in ('open', 'researching', 'partially_answered', 'answered', 'retired')),
    origin text,
    current_understanding text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique (owner_id, id)
);

create table public.kiora_research_runs (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    open_question_id uuid,
    requested_by text not null default 'owner'
        check (requested_by in ('owner', 'kiora', 'system')),
    query text not null,
    status text not null default 'queued'
        check (status in ('queued', 'running', 'completed', 'partial', 'failed', 'cancelled')),
    notes text,
    result_summary text,
    provenance jsonb not null default '{}'::jsonb
        check (jsonb_typeof(provenance) = 'object'),
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (open_question_id)
        references public.kiora_open_questions(id) on delete set null
);


-- =========================================================
-- TASKS / NOTIFICATIONS / MODEL RUNS / USAGE
-- =========================================================

create table public.kiora_tasks (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    task_type text not null,
    status text not null default 'queued'
        check (status in ('queued', 'running', 'waiting_confirmation', 'completed', 'failed', 'cancelled')),
    priority integer not null default 0,
    payload jsonb not null default '{}'::jsonb
        check (jsonb_typeof(payload) = 'object'),
    not_before timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz not null default now(),
    unique (owner_id, id)
);

create table public.kiora_notifications (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    task_id uuid,
    notification_type text not null,
    title text,
    body text not null,
    status text not null default 'unread'
        check (status in ('unread', 'read', 'dismissed')),
    created_at timestamptz not null default now(),
    read_at timestamptz,
    unique (owner_id, id),
    foreign key (task_id)
        references public.kiora_tasks(id) on delete set null
);

create table public.kiora_model_runs (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    model_id uuid not null,
    conversation_id uuid,
    request_message_id uuid,
    response_message_id uuid,
    run_kind text not null default 'chat',
    status text not null default 'started'
        check (status in ('started', 'completed', 'failed', 'cancelled')),
    provider_request_id text,
    input_tokens bigint not null default 0 check (input_tokens >= 0),
    output_tokens bigint not null default 0 check (output_tokens >= 0),
    usage_metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(usage_metadata) = 'object'),
    cost_snapshot jsonb not null default '{}'::jsonb
        check (jsonb_typeof(cost_snapshot) = 'object'),
    input_cost numeric not null default 0 check (input_cost >= 0),
    output_cost numeric not null default 0 check (output_cost >= 0),
    total_cost numeric not null default 0 check (total_cost >= 0),
    currency text,
    started_at timestamptz not null default now(),
    completed_at timestamptz,
    error_code text,
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (owner_id, model_id)
        references public.kiora_models(owner_id, id) on delete restrict,
    foreign key (conversation_id)
        references public.kiora_conversations(id) on delete set null,
    foreign key (request_message_id)
        references public.kiora_messages(id) on delete set null,
    foreign key (response_message_id)
        references public.kiora_messages(id) on delete set null
);

alter table public.kiora_messages
    add constraint kiora_messages_model_run_fk
    foreign key (model_run_id)
    references public.kiora_model_runs(id)
    on delete set null;

create table public.kiora_usage_ledger (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    model_run_id uuid,
    category text not null
        check (category in ('chat', 'deep', 'research', 'embedding', 'reranker', 'reflection', 'training', 'other')),
    quantity numeric not null default 0 check (quantity >= 0),
    unit text,
    amount numeric not null default 0 check (amount >= 0),
    currency text,
    cost_config_snapshot jsonb not null default '{}'::jsonb
        check (jsonb_typeof(cost_config_snapshot) = 'object'),
    period_start date not null default date_trunc('month', now())::date,
    occurred_at timestamptz not null default now(),
    created_at timestamptz not null default now(),
    unique (owner_id, id),
    foreign key (model_run_id)
        references public.kiora_model_runs(id) on delete set null
);


-- =========================================================
-- REPLACEABLE RETRIEVAL INDEX / SETTINGS / ARCHIVES
-- =========================================================

create table public.kiora_retrieval_index (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    source_type text not null,
    source_id text not null,
    chunk_key text not null,
    chunk_text text,
    embedding jsonb
        check (embedding is null or jsonb_typeof(embedding) = 'array'),
    embedding_model_id uuid,
    dimensions integer check (dimensions is null or dimensions > 0),
    metadata jsonb not null default '{}'::jsonb
        check (jsonb_typeof(metadata) = 'object'),
    indexed_at timestamptz not null default now(),
    unique (owner_id, source_type, source_id, chunk_key),
    foreign key (embedding_model_id)
        references public.kiora_models(id) on delete set null
);

create table public.kiora_settings (
    owner_id uuid primary key references auth.users(id) on delete cascade,
    active_conversation_id uuid,
    active_core_version_id uuid,
    active_growth_version_id uuid,
    daily_brain_model_id uuid,
    feature_flags jsonb not null default '{
        "chat_enabled": false,
        "memory_enabled": false,
        "feedback_enabled": false,
        "relationship_enabled": false,
        "self_state_enabled": false,
        "research_enabled": false,
        "background_research_enabled": false,
        "agency_enabled": false,
        "growth_collection_enabled": false,
        "training_enabled": false,
        "auto_promote_enabled": false,
        "voice_enabled": false
    }'::jsonb check (jsonb_typeof(feature_flags) = 'object'),
    budget_config jsonb not null default '{
        "currency": "JPY",
        "monthly_budget": null,
        "soft_limit": null,
        "hard_limit": null,
        "chat_budget": null,
        "background_budget": null,
        "research_budget": null,
        "training_reserve": null
    }'::jsonb check (jsonb_typeof(budget_config) = 'object'),
    quiet_hours jsonb not null default '{}'::jsonb
        check (jsonb_typeof(quiet_hours) = 'object'),
    daily_proactive_cap integer not null default 0 check (daily_proactive_cap >= 0),
    topic_cooldown_minutes integer not null default 1440 check (topic_cooldown_minutes >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    foreign key (active_conversation_id)
        references public.kiora_conversations(id) on delete set null,
    foreign key (active_core_version_id)
        references public.kiora_core_versions(id) on delete set null,
    foreign key (active_growth_version_id)
        references public.kiora_growth_versions(id) on delete set null,
    foreign key (daily_brain_model_id)
        references public.kiora_models(id) on delete set null
);

create table public.kiora_archives (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    archive_version text not null default '1.0',
    status text not null default 'requested'
        check (status in ('requested', 'building', 'ready', 'failed', 'expired')),
    manifest jsonb not null default '{}'::jsonb
        check (jsonb_typeof(manifest) = 'object'),
    storage_path text,
    checksum text,
    requested_at timestamptz not null default now(),
    completed_at timestamptz,
    expires_at timestamptz,
    unique (owner_id, id)
);


-- =========================================================
-- INDEXES
-- =========================================================

create index kiora_events_owner_time_idx
    on public.kiora_events(owner_id, occurred_at desc);
create index kiora_messages_conversation_time_idx
    on public.kiora_messages(owner_id, conversation_id, created_at);
create index kiora_conversations_recent_idx
    on public.kiora_conversations(owner_id, last_message_at desc nulls last, started_at desc);
create index kiora_memories_retrieval_idx
    on public.kiora_memories(owner_id, status, memory_type, importance desc, updated_at desc);
create index kiora_memory_evidence_memory_idx
    on public.kiora_memory_evidence(owner_id, memory_id);
create index kiora_feedback_message_idx
    on public.kiora_feedback(owner_id, message_id, created_at desc);
create index kiora_sources_domain_idx
    on public.kiora_sources(owner_id, domain, retrieved_at desc);
create index kiora_knowledge_status_idx
    on public.kiora_knowledge(owner_id, status, updated_at desc);
create index kiora_research_status_idx
    on public.kiora_research_runs(owner_id, status, created_at desc);
create index kiora_tasks_ready_idx
    on public.kiora_tasks(owner_id, status, not_before, priority desc);
create index kiora_model_runs_time_idx
    on public.kiora_model_runs(owner_id, started_at desc);
create index kiora_usage_period_idx
    on public.kiora_usage_ledger(owner_id, period_start, category);
create index kiora_notifications_unread_idx
    on public.kiora_notifications(owner_id, status, created_at desc);


-- =========================================================
-- UPDATED_AT TRIGGERS
-- =========================================================

create or replace function public.kiora_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'kiora_models',
        'kiora_conversations',
        'kiora_memories',
        'kiora_habits',
        'kiora_knowledge',
        'kiora_open_questions',
        'kiora_settings'
    ] loop
        execute format(
            'create trigger %1$I_set_updated_at before update on public.%1$I for each row execute function public.kiora_set_updated_at()',
            table_name
        );
    end loop;
end;
$$;


-- =========================================================
-- PRIVACY-PRESERVING EVENT REDACTION
-- =========================================================

create or replace function public.kiora_redact_deleted_life_record()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    record_type text := tg_argv[0];
begin
    update public.kiora_events
    set payload = jsonb_build_object(
            'redacted', true,
            'record_type', record_type,
            'record_id', old.id::text
        ),
        subject_id = null,
        redacted_at = now(),
        redaction_reason = 'OWNER_DELETED_SOURCE'
    where owner_id = old.owner_id
      and redacted_at is null
      and (
          (subject_type = record_type and subject_id = old.id::text)
          or (record_type = 'conversation' and conversation_id = old.id)
          or (record_type = 'message' and message_id = old.id)
          or (record_type = 'feedback' and feedback_id = old.id)
      );

    return old;
end;
$$;

create trigger kiora_conversation_redact_events
before delete on public.kiora_conversations
for each row execute function public.kiora_redact_deleted_life_record('conversation');

create trigger kiora_message_redact_events
before delete on public.kiora_messages
for each row execute function public.kiora_redact_deleted_life_record('message');

create trigger kiora_feedback_redact_events
before delete on public.kiora_feedback
for each row execute function public.kiora_redact_deleted_life_record('feedback');

create trigger kiora_memory_redact_events
before delete on public.kiora_memories
for each row execute function public.kiora_redact_deleted_life_record('memory');

create trigger kiora_knowledge_redact_events
before delete on public.kiora_knowledge
for each row execute function public.kiora_redact_deleted_life_record('knowledge');


-- =========================================================
-- OWNER-ONLY READ POLICIES / SERVER-ONLY WRITES
-- =========================================================

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'kiora_core_versions',
        'kiora_models',
        'kiora_datasets',
        'kiora_growth_versions',
        'kiora_conversations',
        'kiora_messages',
        'kiora_feedback',
        'kiora_events',
        'kiora_memories',
        'kiora_memory_evidence',
        'kiora_memory_links',
        'kiora_relationship_snapshots',
        'kiora_self_state',
        'kiora_interests',
        'kiora_habits',
        'kiora_growth_candidates',
        'kiora_training_examples',
        'kiora_evaluations',
        'kiora_sources',
        'kiora_knowledge',
        'kiora_knowledge_sources',
        'kiora_open_questions',
        'kiora_research_runs',
        'kiora_tasks',
        'kiora_notifications',
        'kiora_model_runs',
        'kiora_usage_ledger',
        'kiora_retrieval_index',
        'kiora_settings',
        'kiora_archives'
    ] loop
        execute format('alter table public.%I enable row level security', table_name);
        execute format('revoke all on table public.%I from anon, authenticated', table_name);
        execute format('grant select on table public.%I to authenticated', table_name);
        execute format(
            'create policy "Kiora OWNER reads own %1$s" on public.%1$I for select to authenticated using (owner_id = (select auth.uid()) and public.is_site_owner())',
            table_name
        );
    end loop;
end;
$$;

grant all on table
    public.kiora_core_versions,
    public.kiora_models,
    public.kiora_datasets,
    public.kiora_growth_versions,
    public.kiora_conversations,
    public.kiora_messages,
    public.kiora_feedback,
    public.kiora_events,
    public.kiora_memories,
    public.kiora_memory_evidence,
    public.kiora_memory_links,
    public.kiora_relationship_snapshots,
    public.kiora_self_state,
    public.kiora_interests,
    public.kiora_habits,
    public.kiora_growth_candidates,
    public.kiora_training_examples,
    public.kiora_evaluations,
    public.kiora_sources,
    public.kiora_knowledge,
    public.kiora_knowledge_sources,
    public.kiora_open_questions,
    public.kiora_research_runs,
    public.kiora_tasks,
    public.kiora_notifications,
    public.kiora_model_runs,
    public.kiora_usage_ledger,
    public.kiora_retrieval_index,
    public.kiora_settings,
    public.kiora_archives
to service_role;


-- =========================================================
-- SERVER-ONLY, IDEMPOTENT FIRST BOOT
-- =========================================================

create or replace function public.kiora_first_boot(target_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
    core_id uuid;
    growth_id uuid;
    relationship_id uuid;
    self_state_id uuid;
    brain_id uuid;
    conversation_id uuid;
begin
    if target_owner is null or not exists (
        select 1
        from public.site_owners
        where user_id = target_owner
    ) then
        raise exception 'KIORA_OWNER_REQUIRED';
    end if;

    perform pg_advisory_xact_lock(hashtextextended('kiora-first-boot:' || target_owner::text, 0));

    insert into public.kiora_core_versions (
        owner_id,
        version,
        status,
        definition,
        change_note,
        promoted_at
    ) values (
        target_owner,
        '1.0',
        'active',
        jsonb_build_object(
            'identity', 'Kiora',
            'home', 'kiora.space',
            'relationship_definition', 'long-term private AI companion',
            'principles', jsonb_build_array(
                'Base Model is not Kiora identity',
                'Allow purposeless conversation',
                'Do not fabricate memory',
                'May disagree and may say I do not know',
                'Growth must preserve identity continuity'
            )
        ),
        'Initial Core',
        now()
    )
    on conflict (owner_id, version) do nothing;

    select id into core_id
    from public.kiora_core_versions
    where owner_id = target_owner and version = '1.0';

    insert into public.kiora_models (
        owner_id,
        brain_role,
        provider,
        model_key,
        runtime,
        adapter,
        version,
        status,
        cost_config,
        config
    ) values (
        target_owner,
        'daily',
        'unconfigured',
        'initial-brain',
        'none',
        'none',
        '0',
        'unconfigured',
        jsonb_build_object(
            'input_cost', null,
            'output_cost', null,
            'currency', null,
            'billing_unit', null
        ),
        jsonb_build_object('phase', 0, 'calls_enabled', false)
    )
    on conflict (owner_id, brain_role, provider, model_key, version) do nothing;

    select id into brain_id
    from public.kiora_models
    where owner_id = target_owner
      and brain_role = 'daily'
      and provider = 'unconfigured'
      and model_key = 'initial-brain'
      and version = '0';

    insert into public.kiora_growth_versions (
        owner_id,
        version,
        status,
        summary,
        promoted_at
    ) values (
        target_owner,
        '0.0',
        'active',
        'Initial growth state',
        now()
    )
    on conflict (owner_id, version) do nothing;

    select id into growth_id
    from public.kiora_growth_versions
    where owner_id = target_owner and version = '0.0';

    insert into public.kiora_relationship_snapshots (
        owner_id,
        snapshot_key,
        relationship_definition
    ) values (
        target_owner,
        'initial',
        'long-term private AI companion'
    )
    on conflict (owner_id, snapshot_key) do nothing;

    select id into relationship_id
    from public.kiora_relationship_snapshots
    where owner_id = target_owner and snapshot_key = 'initial';

    insert into public.kiora_self_state (
        owner_id,
        version,
        current_growth_version_id,
        current_brain_model_id,
        recent_reflections
    ) values (
        target_owner,
        1,
        growth_id,
        brain_id,
        jsonb_build_array('Initial self state')
    )
    on conflict (owner_id, version) do nothing;

    select id into self_state_id
    from public.kiora_self_state
    where owner_id = target_owner and version = 1;

    insert into public.kiora_conversations (
        owner_id,
        conversation_key,
        title,
        status
    ) values (
        target_owner,
        'initial',
        'First Conversation',
        'active'
    )
    on conflict (owner_id, conversation_key) do nothing;

    select id into conversation_id
    from public.kiora_conversations
    where owner_id = target_owner and conversation_key = 'initial';

    insert into public.kiora_settings (
        owner_id,
        active_conversation_id,
        active_core_version_id,
        active_growth_version_id,
        daily_brain_model_id
    ) values (
        target_owner,
        conversation_id,
        core_id,
        growth_id,
        brain_id
    )
    on conflict (owner_id) do nothing;

    insert into public.kiora_events (
        owner_id,
        event_key,
        event_type,
        subject_type,
        payload
    ) values (
        target_owner,
        'first-boot',
        'KIORA_INITIALIZED',
        'kiora',
        jsonb_build_object(
            'core_version', '1.0',
            'growth_version', '0.0',
            'relationship_snapshot', 'initial',
            'self_state_version', 1,
            'brain_status', 'unconfigured'
        )
    )
    on conflict (owner_id, event_key) do nothing;

    return jsonb_build_object(
        'initialized', true,
        'owner_id', target_owner,
        'core_version_id', core_id,
        'growth_version_id', growth_id,
        'relationship_snapshot_id', relationship_id,
        'self_state_id', self_state_id,
        'brain_model_id', brain_id,
        'active_conversation_id', conversation_id
    );
end;
$$;

revoke all on function public.kiora_first_boot(uuid) from public, anon, authenticated;
grant execute on function public.kiora_first_boot(uuid) to service_role;

revoke all on function public.kiora_redact_deleted_life_record() from public, anon, authenticated;
grant execute on function public.kiora_redact_deleted_life_record() to service_role;

revoke all on function public.kiora_set_updated_at() from public;

commit;
