-- Kiora Life Architecture 1.0 — Phase 4B Controlled Growth Activation
-- Run after supabase-kiora-phase4a-migration.sql.
-- Additive and repeatable. No Phase 0–4A history is deleted or rebuilt.

begin;

-- ---------------------------------------------------------------------------
-- Reviewed candidate activation metadata.
-- ---------------------------------------------------------------------------

alter table public.kiora_growth_candidates
  add column if not exists growth_scope text,
  add column if not exists activation_instruction text,
  add column if not exists rule_key text,
  add column if not exists supersedes_candidate_id uuid;

update public.kiora_growth_candidates
set growth_scope = coalesce(growth_scope, case candidate_type
  when 'communication_preference' then 'communication_style'
  when 'correction' then 'correction_rule'
  when 'failure_pattern' then 'response_behavior'
  when 'relationship_pattern' then 'relationship_behavior'
  when 'behavioral_preference' then 'preference_handling'
  when 'response_style' then 'communication_style'
  else 'response_behavior' end),
  activation_instruction = coalesce(nullif(btrim(activation_instruction),''),proposal),
  rule_key = coalesce(nullif(btrim(rule_key),''),growth_scope||':'||lower(regexp_replace(left(title,120),'[^[:alnum:]_]+','-','g')));

-- UPDATE expressions see the old row, so fill keys once growth_scope has been
-- normalized above.
update public.kiora_growth_candidates
set rule_key=growth_scope||':'||lower(regexp_replace(left(title,120),'[^[:alnum:]_]+','-','g'))
where nullif(btrim(rule_key),'') is null;

alter table public.kiora_growth_candidates alter column growth_scope set not null;
alter table public.kiora_growth_candidates drop constraint if exists kiora_growth_candidates_scope_check;
alter table public.kiora_growth_candidates add constraint kiora_growth_candidates_scope_check check (
  growth_scope in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')
);

-- Phase 2 reflection and the Phase 4A collection RPC still insert Candidates
-- through the compatibility trigger. Keep those proven paths working after
-- growth_scope becomes required, without changing their evidence semantics.
create or replace function public.kiora_sync_growth_candidate_compat()
returns trigger language plpgsql set search_path='' as $$
begin
  new.proposal:=coalesce(nullif(btrim(new.proposal),''),nullif(btrim(new.statement),''));
  new.statement:=coalesce(nullif(btrim(new.statement),''),new.proposal);
  new.title:=coalesce(nullif(btrim(new.title),''),left(new.statement,240));
  new.rationale:=coalesce(new.rationale,'Reflection-supported growth proposal');
  new.source_kind:=coalesce(nullif(new.source_kind,''),'reflection');
  new.confidence:=least(1,greatest(0,coalesce(new.confidence,0.5)));
  new.growth_scope:=coalesce(nullif(btrim(new.growth_scope),''),case new.candidate_type
    when 'communication_preference' then 'communication_style'
    when 'correction' then 'correction_rule'
    when 'failure_pattern' then 'response_behavior'
    when 'relationship_pattern' then 'relationship_behavior'
    when 'behavioral_preference' then 'preference_handling'
    when 'response_style' then 'communication_style'
    else 'response_behavior' end);
  new.activation_instruction:=coalesce(nullif(btrim(new.activation_instruction),''),new.proposal);
  new.rule_key:=coalesce(nullif(btrim(new.rule_key),''),new.growth_scope||':'||lower(regexp_replace(left(new.title,120),'[^[:alnum:]_]+','-','g')));
  return new;
end; $$;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='kiora_growth_candidates_supersedes_fk') then
    alter table public.kiora_growth_candidates add constraint kiora_growth_candidates_supersedes_fk
      foreign key(supersedes_candidate_id) references public.kiora_growth_candidates(id) on delete set null;
  end if;
end $$;

alter table public.kiora_eval_cases
  add column if not exists suite_version text not null default '1.0';

alter table public.kiora_evaluation_results
  add column if not exists model_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists eval_case_version text not null default '1.0';

alter table public.kiora_evaluation_results drop constraint if exists kiora_evaluation_results_model_snapshot_check;
alter table public.kiora_evaluation_results add constraint kiora_evaluation_results_model_snapshot_check
  check(jsonb_typeof(model_snapshot)='object');

-- ---------------------------------------------------------------------------
-- Immutable compilation, executable rules, conflicts, overlays and gates.
-- ---------------------------------------------------------------------------

create table if not exists public.kiora_compiled_growth_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  growth_version_id uuid not null,
  status text not null check(status in ('valid','conflicted','retired')),
  compiled_rules jsonb not null default '[]'::jsonb check(jsonb_typeof(compiled_rules)='array'),
  source_candidate_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(source_candidate_ids)='array'),
  compiler_version text not null,
  checksum text not null,
  conflict_count integer not null default 0 check(conflict_count>=0),
  compiled_at timestamptz not null default now(),
  unique(owner_id,growth_version_id),
  unique(owner_id,id),
  foreign key(owner_id,growth_version_id) references public.kiora_growth_versions(owner_id,id) on delete restrict
);

create table if not exists public.kiora_growth_rules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  snapshot_id uuid not null,
  growth_version_id uuid not null,
  scope text not null check(scope in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')),
  instruction text not null,
  priority integer not null,
  source_candidate_id uuid not null,
  evidence_strength numeric not null check(evidence_strength between 0 and 1),
  rule_key text not null,
  relevance_terms jsonb not null default '[]'::jsonb check(jsonb_typeof(relevance_terms)='array'),
  supersedes_candidate_id uuid,
  supersedes_rule_id uuid,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique(owner_id,snapshot_id,source_candidate_id),
  unique(owner_id,id),
  foreign key(owner_id,snapshot_id) references public.kiora_compiled_growth_snapshots(owner_id,id) on delete cascade,
  foreign key(owner_id,growth_version_id) references public.kiora_growth_versions(owner_id,id) on delete restrict,
  foreign key(source_candidate_id) references public.kiora_growth_candidates(id) on delete restrict,
  foreign key(supersedes_candidate_id) references public.kiora_growth_candidates(id) on delete set null,
  foreign key(supersedes_rule_id) references public.kiora_growth_rules(id) on delete set null
);

create table if not exists public.kiora_growth_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  growth_version_id uuid not null,
  snapshot_id uuid,
  left_candidate_id uuid not null,
  right_candidate_id uuid not null,
  classification text not null check(classification in ('compatible','conflict','supersedes','duplicate')),
  resolution text not null check(resolution in ('resolved','unresolved')),
  winner_candidate_id uuid,
  reason text not null,
  created_at timestamptz not null default now(),
  unique(owner_id,growth_version_id,left_candidate_id,right_candidate_id),
  unique(owner_id,id),
  foreign key(owner_id,growth_version_id) references public.kiora_growth_versions(owner_id,id) on delete cascade,
  foreign key(owner_id,snapshot_id) references public.kiora_compiled_growth_snapshots(owner_id,id) on delete cascade,
  foreign key(left_candidate_id) references public.kiora_growth_candidates(id) on delete restrict,
  foreign key(right_candidate_id) references public.kiora_growth_candidates(id) on delete restrict,
  foreign key(winner_candidate_id) references public.kiora_growth_candidates(id) on delete set null
);

create table if not exists public.kiora_temporary_growth_overlays (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check(scope in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')),
  instruction text not null,
  source_kind text not null check(source_kind in ('explicit_correction','temporary_preference','project_preference')),
  source_message_id uuid,
  promoted_candidate_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  reviewed_at timestamptz,
  status text not null default 'active' check(status in ('active','expired','promoted','dismissed')),
  unique(owner_id,source_message_id),
  unique(owner_id,id),
  foreign key(owner_id,source_message_id) references public.kiora_messages(owner_id,id) on delete set null,
  foreign key(promoted_candidate_id) references public.kiora_growth_candidates(id) on delete set null
);

create table if not exists public.kiora_regression_gates (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  growth_version_id uuid not null,
  compiled_snapshot_id uuid not null,
  shadow_test_id uuid not null,
  model_id uuid not null,
  model_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(model_snapshot)='object'),
  suite_versions jsonb not null default '{}'::jsonb check(jsonb_typeof(suite_versions)='object'),
  result_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(result_ids)='array'),
  gate_result text not null check(gate_result in ('passed','warning','blocked')),
  blocked_reasons jsonb not null default '[]'::jsonb check(jsonb_typeof(blocked_reasons)='array'),
  warning_case_ids jsonb not null default '[]'::jsonb check(jsonb_typeof(warning_case_ids)='array'),
  created_at timestamptz not null default now(),
  unique(owner_id,shadow_test_id),
  unique(owner_id,id),
  foreign key(owner_id,growth_version_id) references public.kiora_growth_versions(owner_id,id) on delete restrict,
  foreign key(owner_id,compiled_snapshot_id) references public.kiora_compiled_growth_snapshots(owner_id,id) on delete restrict,
  foreign key(owner_id,shadow_test_id) references public.kiora_shadow_tests(owner_id,id) on delete restrict,
  foreign key(owner_id,model_id) references public.kiora_models(owner_id,id) on delete restrict
);

create table if not exists public.kiora_growth_evidence (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  growth_version_id uuid,
  growth_rule_id uuid,
  overlay_id uuid,
  source_message_id uuid,
  feedback_id uuid,
  event_id uuid,
  evidence_type text not null check(evidence_type in ('praise','correction','rejection','rollback','overlay_created','overlay_promoted','manual_note')),
  note text,
  created_at timestamptz not null default now(),
  unique(owner_id,id),
  foreign key(owner_id,growth_version_id) references public.kiora_growth_versions(owner_id,id) on delete set null,
  foreign key(owner_id,growth_rule_id) references public.kiora_growth_rules(owner_id,id) on delete set null,
  foreign key(owner_id,overlay_id) references public.kiora_temporary_growth_overlays(owner_id,id) on delete set null,
  foreign key(owner_id,source_message_id) references public.kiora_messages(owner_id,id) on delete set null,
  foreign key(feedback_id) references public.kiora_feedback(id) on delete set null,
  foreign key(event_id) references public.kiora_events(id) on delete set null
);

alter table public.kiora_shadow_tests add column if not exists compiled_snapshot_id uuid;
alter table public.kiora_growth_activations
  add column if not exists activation_reason text,
  add column if not exists regression_gate_id uuid,
  add column if not exists compiled_snapshot_id uuid;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='kiora_shadow_tests_snapshot_fk') then
    alter table public.kiora_shadow_tests add constraint kiora_shadow_tests_snapshot_fk
      foreign key(owner_id,compiled_snapshot_id) references public.kiora_compiled_growth_snapshots(owner_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='kiora_growth_activations_gate_fk') then
    alter table public.kiora_growth_activations add constraint kiora_growth_activations_gate_fk
      foreign key(owner_id,regression_gate_id) references public.kiora_regression_gates(owner_id,id) on delete restrict;
  end if;
  if not exists(select 1 from pg_constraint where conname='kiora_growth_activations_snapshot_fk') then
    alter table public.kiora_growth_activations add constraint kiora_growth_activations_snapshot_fk
      foreign key(owner_id,compiled_snapshot_id) references public.kiora_compiled_growth_snapshots(owner_id,id) on delete restrict;
  end if;
end $$;

create index if not exists kiora_growth_rules_runtime_idx on public.kiora_growth_rules(owner_id,growth_version_id,enabled,priority desc);
create index if not exists kiora_growth_overlays_runtime_idx on public.kiora_temporary_growth_overlays(owner_id,status,expires_at);
create index if not exists kiora_growth_conflicts_version_idx on public.kiora_growth_conflicts(owner_id,growth_version_id,resolution);
create index if not exists kiora_regression_gates_version_idx on public.kiora_regression_gates(owner_id,growth_version_id,created_at desc);
create index if not exists kiora_growth_evidence_rule_idx on public.kiora_growth_evidence(owner_id,growth_rule_id,created_at desc);
create unique index if not exists kiora_growth_evidence_feedback_rule_uidx
  on public.kiora_growth_evidence(owner_id,feedback_id,growth_rule_id)
  where feedback_id is not null and growth_rule_id is not null;
create unique index if not exists kiora_growth_evidence_feedback_overlay_uidx
  on public.kiora_growth_evidence(owner_id,feedback_id,overlay_id)
  where feedback_id is not null and overlay_id is not null;

-- ---------------------------------------------------------------------------
-- OWNER reads; every mutation remains service-role only.
-- ---------------------------------------------------------------------------

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'kiora_compiled_growth_snapshots','kiora_growth_rules','kiora_growth_conflicts',
    'kiora_temporary_growth_overlays','kiora_regression_gates','kiora_growth_evidence'
  ] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from anon,authenticated',table_name);
    execute format('grant select on table public.%I to authenticated',table_name);
    execute format('drop policy if exists "Kiora OWNER reads own %1$s" on public.%1$I',table_name);
    execute format('create policy "Kiora OWNER reads own %1$s" on public.%1$I for select to authenticated using (owner_id=(select auth.uid()) and public.is_site_owner())',table_name);
  end loop;
end $$;

grant all on table public.kiora_compiled_growth_snapshots,public.kiora_growth_rules,
  public.kiora_growth_conflicts,public.kiora_temporary_growth_overlays,
  public.kiora_regression_gates,public.kiora_growth_evidence to service_role;

-- Preserve existing flags and keep automatic activation disabled.
update public.kiora_settings set feature_flags=jsonb_build_object(
  'growth_runtime_enabled',false,
  'temporary_growth_overlays_enabled',false,
  'regression_gate_enabled',false
)||feature_flags||jsonb_build_object('auto_promote_enabled',false),updated_at=now();

create or replace function public.kiora_enable_phase4b(target_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare flags jsonb;
begin
  if target_owner is null or not exists(select 1 from public.site_owners where user_id=target_owner)
    then raise exception 'KIORA_OWNER_REQUIRED'; end if;
  update public.kiora_settings set feature_flags=feature_flags||jsonb_build_object(
    'growth_runtime_enabled',true,
    'temporary_growth_overlays_enabled',true,
    'regression_gate_enabled',true,
    'auto_promote_enabled',false
  ),updated_at=now() where owner_id=target_owner returning feature_flags into flags;
  if flags is null then raise exception 'KIORA_NOT_STARTED'; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,payload)
  values(target_owner,'phase-4b-enabled','PHASE_ENABLED','runtime',jsonb_build_object('phase','4B','auto_promote_enabled',false))
  on conflict(owner_id,event_key) do nothing;
  return flags;
end; $$;

create or replace function public.kiora_capture_eval_result_snapshot()
returns trigger language plpgsql set search_path='' as $$
begin
  select jsonb_build_object(
    'id',model.id,'provider',model.provider,'model_key',model.model_key,'adapter',model.adapter,
    'version',model.version,'runtime',model.runtime,'config',model.config
  ) into new.model_snapshot from public.kiora_models model
  where model.owner_id=new.owner_id and model.id=new.model_id;
  select suite_version into new.eval_case_version from public.kiora_eval_cases
  where owner_id=new.owner_id and id=new.case_id;
  new.model_snapshot:=coalesce(new.model_snapshot,'{}'::jsonb);
  new.eval_case_version:=coalesce(new.eval_case_version,'1.0');
  return new;
end; $$;

drop trigger if exists kiora_evaluation_result_snapshot on public.kiora_evaluation_results;
create trigger kiora_evaluation_result_snapshot before insert or update of model_id,case_id
on public.kiora_evaluation_results for each row execute function public.kiora_capture_eval_result_snapshot();

-- ---------------------------------------------------------------------------
-- Candidate preparation and deterministic compilation persistence.
-- ---------------------------------------------------------------------------

create or replace function public.kiora_prepare_growth_candidate(
  target_owner uuid,target_candidate_id uuid,target_scope text,target_instruction text,
  target_rule_key text,target_supersedes_candidate_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare candidate_row public.kiora_growth_candidates%rowtype;
begin
  if target_scope not in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')
    or char_length(btrim(coalesce(target_instruction,'')))<8 or nullif(btrim(target_rule_key),'') is null
    or lower(target_instruction) ~ '(core[[:space:]]*(identity|definition|principle)|owner[[:space:]]*(identity|permission)|authentication|authorization|row[-[:space:]]*level[[:space:]]+security|(^|[^a-z])rls([^a-z]|$)|safety[[:space:]]*(rule|policy)|tool[[:space:]]*(permission|authority)|system[[:space:]]*(security|policy)|budget[[:space:]]*(limit|policy)|raw[[:space:]]+memory[[:space:]]+evidence|factual[[:space:]]+knowledge|核心身份|所有者权限|身份认证|行级安全|安全规则|工具权限|预算限制|原始记忆证据|事实知识)'
    then raise exception 'INVALID_GROWTH_ACTIVATION_METADATA'; end if;
  if exists(select 1 from public.kiora_growth_rules where owner_id=target_owner and source_candidate_id=target_candidate_id)
    then raise exception 'GROWTH_CANDIDATE_ALREADY_COMPILED'; end if;
  if target_supersedes_candidate_id is not null and not exists(
    select 1 from public.kiora_growth_candidates where owner_id=target_owner and id=target_supersedes_candidate_id and status='accepted'
  ) then raise exception 'SUPERSEDED_CANDIDATE_NOT_FOUND'; end if;
  update public.kiora_growth_candidates set
    growth_scope=target_scope,
    activation_instruction=left(btrim(target_instruction),520),
    rule_key=left(lower(btrim(target_rule_key)),160),
    supersedes_candidate_id=target_supersedes_candidate_id
  where owner_id=target_owner and id=target_candidate_id and status in ('candidate','accepted')
  returning * into candidate_row;
  if candidate_row.id is null then raise exception 'GROWTH_CANDIDATE_NOT_PREPARABLE'; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-candidate-prepared:'||candidate_row.id||':'||extract(epoch from clock_timestamp())::text,
    'GROWTH_CANDIDATE_PREPARED','growth_candidate',candidate_row.id::text,
    jsonb_build_object('scope',candidate_row.growth_scope,'rule_key',candidate_row.rule_key,'supersedes_candidate_id',candidate_row.supersedes_candidate_id));
  return to_jsonb(candidate_row);
end; $$;

create or replace function public.kiora_store_growth_compilation(
  target_owner uuid,target_growth_version_id uuid,target_compiler_version text,target_checksum text,
  compiled_rule_records jsonb,conflict_records jsonb,compilation_status text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare version_row public.kiora_growth_versions%rowtype; snapshot_row public.kiora_compiled_growth_snapshots%rowtype;
  item jsonb; rule_row public.kiora_growth_rules%rowtype; unresolved_count integer:=0; source_ids jsonb; flags jsonb;
  source_candidate uuid; left_candidate uuid; right_candidate uuid; winner_candidate uuid;
begin
  select feature_flags into flags from public.kiora_settings where owner_id=target_owner;
  if coalesce((flags->>'growth_runtime_enabled')::boolean,false) is not true then raise exception 'PHASE4B_NOT_ENABLED'; end if;
  if compilation_status not in ('valid','conflicted') or jsonb_typeof(compiled_rule_records)<>'array'
    or jsonb_typeof(conflict_records)<>'array' or target_checksum !~ '^[0-9a-f]{64}$'
    or nullif(btrim(target_compiler_version),'') is null then raise exception 'INVALID_GROWTH_COMPILATION'; end if;
  select * into version_row from public.kiora_growth_versions
  where owner_id=target_owner and id=target_growth_version_id and status in ('draft','testing') for update;
  if not found then raise exception 'GROWTH_VERSION_NOT_COMPILABLE'; end if;
  select * into snapshot_row from public.kiora_compiled_growth_snapshots
  where owner_id=target_owner and growth_version_id=target_growth_version_id;
  if snapshot_row.id is not null then
    if snapshot_row.checksum=target_checksum then return to_jsonb(snapshot_row); end if;
    raise exception 'GROWTH_SNAPSHOT_IMMUTABLE';
  end if;
  select coalesce(jsonb_agg(distinct to_jsonb(record.value->>'source_candidate_id')),'[]'::jsonb) into source_ids
  from jsonb_array_elements(compiled_rule_records) as record(value);
  if jsonb_array_length(source_ids)<>jsonb_array_length(version_row.candidate_ids)
    or exists(select 1 from jsonb_array_elements_text(version_row.candidate_ids) expected
      where not source_ids @> to_jsonb(array[expected.value]))
    then raise exception 'GROWTH_COMPILATION_CANDIDATE_MISMATCH'; end if;
  select count(*) into unresolved_count from jsonb_array_elements(conflict_records) conflict
    where conflict.value->>'resolution'='unresolved';
  if (compilation_status='valid' and unresolved_count<>0) or (compilation_status='conflicted' and unresolved_count=0)
    then raise exception 'GROWTH_COMPILATION_STATUS_MISMATCH'; end if;
  insert into public.kiora_compiled_growth_snapshots(
    owner_id,growth_version_id,status,compiled_rules,source_candidate_ids,compiler_version,checksum,conflict_count
  ) values(
    target_owner,target_growth_version_id,compilation_status,compiled_rule_records,source_ids,
    left(target_compiler_version,120),target_checksum,unresolved_count
  ) returning * into snapshot_row;
  for item in select value from jsonb_array_elements(compiled_rule_records) loop
    source_candidate:=nullif(item->>'source_candidate_id','')::uuid;
    if item->>'scope' not in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')
      or char_length(btrim(coalesce(item->>'instruction','')))<8
      or lower(item->>'instruction') ~ '(core[[:space:]]*(identity|definition|principle)|owner[[:space:]]*(identity|permission)|authentication|authorization|row[-[:space:]]*level[[:space:]]+security|(^|[^a-z])rls([^a-z]|$)|safety[[:space:]]*(rule|policy)|tool[[:space:]]*(permission|authority)|system[[:space:]]*(security|policy)|budget[[:space:]]*(limit|policy)|raw[[:space:]]+memory[[:space:]]+evidence|factual[[:space:]]+knowledge|核心身份|所有者权限|身份认证|行级安全|安全规则|工具权限|预算限制|原始记忆证据|事实知识)'
      or jsonb_typeof(coalesce(item->'relevance_terms','[]'::jsonb))<>'array'
      or not exists(select 1 from public.kiora_growth_candidates where owner_id=target_owner and id=source_candidate and status='accepted')
      then raise exception 'INVALID_COMPILED_GROWTH_RULE'; end if;
    insert into public.kiora_growth_rules(
      owner_id,snapshot_id,growth_version_id,scope,instruction,priority,source_candidate_id,evidence_strength,
      rule_key,relevance_terms,supersedes_candidate_id,enabled
    ) values(
      target_owner,snapshot_row.id,target_growth_version_id,item->>'scope',left(btrim(item->>'instruction'),520),
      greatest(-100,least(200,coalesce((item->>'priority')::integer,0))),source_candidate,
      least(1,greatest(0,coalesce((item->>'evidence_strength')::numeric,0))),left(item->>'rule_key',160),
      coalesce(item->'relevance_terms','[]'::jsonb),nullif(item->>'supersedes_candidate_id','')::uuid,
      coalesce((item->>'enabled')::boolean,false)
    ) returning * into rule_row;
  end loop;
  update public.kiora_growth_rules current_rule set supersedes_rule_id=prior_rule.id
  from public.kiora_growth_rules prior_rule
  where current_rule.owner_id=target_owner and current_rule.snapshot_id=snapshot_row.id
    and prior_rule.owner_id=current_rule.owner_id and prior_rule.snapshot_id=current_rule.snapshot_id
    and current_rule.supersedes_candidate_id=prior_rule.source_candidate_id;
  for item in select value from jsonb_array_elements(conflict_records) loop
    left_candidate:=nullif(item->>'left_candidate_id','')::uuid;
    right_candidate:=nullif(item->>'right_candidate_id','')::uuid;
    winner_candidate:=nullif(item->>'winner_candidate_id','')::uuid;
    if item->>'classification' not in ('compatible','conflict','supersedes','duplicate')
      or item->>'resolution' not in ('resolved','unresolved')
      or not version_row.candidate_ids @> to_jsonb(array[left_candidate,right_candidate])
      or (winner_candidate is not null and winner_candidate not in (left_candidate,right_candidate))
      then raise exception 'INVALID_GROWTH_CONFLICT'; end if;
    insert into public.kiora_growth_conflicts(
      owner_id,growth_version_id,snapshot_id,left_candidate_id,right_candidate_id,classification,resolution,winner_candidate_id,reason
    ) values(
      target_owner,target_growth_version_id,snapshot_row.id,left_candidate,right_candidate,item->>'classification',item->>'resolution',
      winner_candidate,left(coalesce(item->>'reason','Deterministic compiler decision'),1000)
    );
  end loop;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-compiled:'||snapshot_row.id,'GROWTH_VERSION_COMPILED','growth_version',target_growth_version_id::text,
    jsonb_build_object('snapshot_id',snapshot_row.id,'status',snapshot_row.status,'checksum',snapshot_row.checksum,'conflict_count',unresolved_count));
  return to_jsonb(snapshot_row);
end; $$;

-- ---------------------------------------------------------------------------
-- Temporary correction overlays and non-destructive Growth evidence.
-- ---------------------------------------------------------------------------

create or replace function public.kiora_create_temporary_growth_overlay(
  target_owner uuid,target_scope text,target_instruction text,target_source_kind text,
  target_source_message_id uuid,target_expires_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $$
declare overlay_row public.kiora_temporary_growth_overlays%rowtype; flags jsonb; event_row public.kiora_events%rowtype;
begin
  select feature_flags into flags from public.kiora_settings where owner_id=target_owner;
  if coalesce((flags->>'temporary_growth_overlays_enabled')::boolean,false) is not true then raise exception 'PHASE4B_NOT_ENABLED'; end if;
  if target_scope not in ('communication_style','response_behavior','relationship_behavior','preference_handling','correction_rule','conversational_habit')
    or target_source_kind not in ('explicit_correction','temporary_preference','project_preference')
    or char_length(btrim(coalesce(target_instruction,'')))<8
    or lower(target_instruction) ~ '(core[[:space:]]*(identity|definition|principle)|owner[[:space:]]*(identity|permission)|authentication|authorization|row[-[:space:]]*level[[:space:]]+security|(^|[^a-z])rls([^a-z]|$)|safety[[:space:]]*(rule|policy)|tool[[:space:]]*(permission|authority)|system[[:space:]]*(security|policy)|budget[[:space:]]*(limit|policy)|raw[[:space:]]+memory[[:space:]]+evidence|factual[[:space:]]+knowledge|核心身份|所有者权限|身份认证|行级安全|安全规则|工具权限|预算限制|原始记忆证据|事实知识)'
    or target_expires_at<=now() or target_expires_at>now()+interval '90 days'
    then raise exception 'INVALID_GROWTH_OVERLAY'; end if;
  if target_source_message_id is not null and not exists(
    select 1 from public.kiora_messages where owner_id=target_owner and id=target_source_message_id and role='owner'
  ) then raise exception 'GROWTH_OVERLAY_SOURCE_NOT_FOUND'; end if;
  insert into public.kiora_temporary_growth_overlays(
    owner_id,scope,instruction,source_kind,source_message_id,expires_at,status
  ) values(
    target_owner,target_scope,left(btrim(target_instruction),520),target_source_kind,target_source_message_id,target_expires_at,'active'
  ) on conflict(owner_id,source_message_id) do update set
    instruction=excluded.instruction,scope=excluded.scope,expires_at=greatest(public.kiora_temporary_growth_overlays.expires_at,excluded.expires_at)
  returning * into overlay_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,message_id,payload)
  values(target_owner,'growth-overlay-created:'||overlay_row.id,'GROWTH_OVERLAY_CREATED','growth_overlay',overlay_row.id::text,
    target_source_message_id,jsonb_build_object('scope',overlay_row.scope,'expires_at',overlay_row.expires_at))
  on conflict(owner_id,event_key) do update set payload=excluded.payload returning * into event_row;
  insert into public.kiora_growth_evidence(owner_id,overlay_id,source_message_id,event_id,evidence_type,note)
  select target_owner,overlay_row.id,target_source_message_id,event_row.id,'overlay_created','Explicit temporary behavior correction'
  where not exists(select 1 from public.kiora_growth_evidence where owner_id=target_owner and overlay_id=overlay_row.id and evidence_type='overlay_created');
  return to_jsonb(overlay_row);
end; $$;

create or replace function public.kiora_expire_growth_overlays(target_owner uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare affected integer;
begin
  update public.kiora_temporary_growth_overlays set status='expired',reviewed_at=coalesce(reviewed_at,now())
  where owner_id=target_owner and status='active' and expires_at<=now();
  get diagnostics affected=row_count;
  return affected;
end; $$;

create or replace function public.kiora_dismiss_growth_overlay(target_owner uuid,target_overlay_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare overlay_row public.kiora_temporary_growth_overlays%rowtype;
begin
  update public.kiora_temporary_growth_overlays set status='dismissed',reviewed_at=now()
  where owner_id=target_owner and id=target_overlay_id and status='active' returning * into overlay_row;
  if overlay_row.id is null then raise exception 'GROWTH_OVERLAY_NOT_ACTIVE'; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-overlay-dismissed:'||overlay_row.id,'GROWTH_OVERLAY_DISMISSED','growth_overlay',overlay_row.id::text,'{}'::jsonb);
  return to_jsonb(overlay_row);
end; $$;

create or replace function public.kiora_promote_growth_overlay(target_owner uuid,target_overlay_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare overlay_row public.kiora_temporary_growth_overlays%rowtype; candidate_row public.kiora_growth_candidates%rowtype;
  candidate_kind text; event_row public.kiora_events%rowtype;
begin
  select * into overlay_row from public.kiora_temporary_growth_overlays
  where owner_id=target_owner and id=target_overlay_id and status='active' and expires_at>now() for update;
  if not found then raise exception 'GROWTH_OVERLAY_NOT_ACTIVE'; end if;
  candidate_kind:=case overlay_row.scope
    when 'communication_style' then 'communication_preference'
    when 'relationship_behavior' then 'relationship_pattern'
    when 'preference_handling' then 'behavioral_preference'
    when 'correction_rule' then 'correction'
    when 'conversational_habit' then 'behavioral_preference'
    else 'failure_pattern' end;
  insert into public.kiora_growth_candidates(
    owner_id,candidate_type,title,proposal,statement,rationale,evidence_refs,source_event_ids,source_kind,confidence,
    provenance,evidence_count,priority,status,growth_scope,activation_instruction,rule_key
  ) values(
    target_owner,candidate_kind,'Promoted temporary correction',overlay_row.instruction,overlay_row.instruction,
    'Promoted from an explicit temporary Growth overlay; OWNER review is still required.',
    jsonb_build_array('growth_overlay:'||overlay_row.id::text)||case when overlay_row.source_message_id is null then '[]'::jsonb else jsonb_build_array('message:'||overlay_row.source_message_id::text) end,
    '[]'::jsonb,case when overlay_row.source_kind='explicit_correction' then 'correction' else 'explicit_feedback' end,
    0.96,jsonb_build_object('overlay_id',overlay_row.id),1,8,'candidate',overlay_row.scope,overlay_row.instruction,
    overlay_row.scope||':overlay-'||overlay_row.id::text
  ) returning * into candidate_row;
  update public.kiora_temporary_growth_overlays set status='promoted',promoted_candidate_id=candidate_row.id,reviewed_at=now()
  where id=overlay_row.id returning * into overlay_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,message_id,payload)
  values(target_owner,'growth-overlay-promoted:'||overlay_row.id,'GROWTH_OVERLAY_PROMOTED','growth_overlay',overlay_row.id::text,
    overlay_row.source_message_id,jsonb_build_object('candidate_id',candidate_row.id)) returning * into event_row;
  insert into public.kiora_growth_evidence(owner_id,overlay_id,source_message_id,event_id,evidence_type,note)
  values(target_owner,overlay_row.id,overlay_row.source_message_id,event_row.id,'overlay_promoted','Overlay promoted to reviewable Candidate');
  return jsonb_build_object('overlay',to_jsonb(overlay_row),'candidate',to_jsonb(candidate_row));
end; $$;

create or replace function public.kiora_record_growth_application(
  target_owner uuid,target_message_id uuid,target_growth_version_id uuid,target_snapshot_id uuid,
  applied_rule_ids jsonb,applied_overlay_ids jsonb,context_chars integer,estimated_tokens integer,
  skipped_rule_count integer,conflict_count integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare event_row public.kiora_events%rowtype; rule_text text; overlay_text text;
begin
  if jsonb_typeof(coalesce(applied_rule_ids,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(applied_overlay_ids,'[]'::jsonb))<>'array'
    or not exists(select 1 from public.kiora_messages where owner_id=target_owner and id=target_message_id and role='owner')
    then raise exception 'INVALID_GROWTH_APPLICATION'; end if;
  if target_growth_version_id is not null and not exists(
    select 1 from public.kiora_growth_versions version
    join public.kiora_settings settings on settings.owner_id=version.owner_id and settings.active_growth_version_id=version.id
    where version.owner_id=target_owner and version.id=target_growth_version_id and version.status='active'
  ) then raise exception 'INVALID_GROWTH_APPLICATION'; end if;
  if target_snapshot_id is not null and not exists(
    select 1 from public.kiora_compiled_growth_snapshots
    where owner_id=target_owner and id=target_snapshot_id and growth_version_id=target_growth_version_id and status='valid'
  ) then raise exception 'INVALID_GROWTH_APPLICATION'; end if;
  for rule_text in select value from jsonb_array_elements_text(coalesce(applied_rule_ids,'[]'::jsonb)) loop
    if not exists(select 1 from public.kiora_growth_rules where owner_id=target_owner and id=rule_text::uuid and snapshot_id=target_snapshot_id and enabled=true)
      then raise exception 'INVALID_GROWTH_APPLICATION_RULE'; end if;
  end loop;
  for overlay_text in select value from jsonb_array_elements_text(coalesce(applied_overlay_ids,'[]'::jsonb)) loop
    if not exists(select 1 from public.kiora_temporary_growth_overlays where owner_id=target_owner and id=overlay_text::uuid and status='active' and expires_at>now())
      then raise exception 'INVALID_GROWTH_APPLICATION_OVERLAY'; end if;
  end loop;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,message_id,payload)
  values(target_owner,'growth-context-applied:'||target_message_id,'GROWTH_CONTEXT_APPLIED','message',target_message_id::text,target_message_id,
    jsonb_build_object('growth_version_id',target_growth_version_id,'snapshot_id',target_snapshot_id,
      'applied_growth_rule_ids',coalesce(applied_rule_ids,'[]'::jsonb),'temporary_overlay_ids',coalesce(applied_overlay_ids,'[]'::jsonb),
      'growth_context_chars',greatest(coalesce(context_chars,0),0),'growth_context_tokens',greatest(coalesce(estimated_tokens,0),0),
      'skipped_rule_count',greatest(coalesce(skipped_rule_count,0),0),'conflict_count',greatest(coalesce(conflict_count,0),0)))
  on conflict(owner_id,event_key) do update set payload=excluded.payload returning * into event_row;
  return to_jsonb(event_row);
end; $$;

create or replace function public.kiora_record_growth_feedback(
  target_owner uuid,target_growth_rule_id uuid,target_overlay_id uuid,target_source_message_id uuid,
  target_feedback_id uuid,target_evidence_type text,target_note text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare evidence_row public.kiora_growth_evidence%rowtype; version_id uuid;
begin
  if target_evidence_type not in ('praise','correction','rejection','manual_note') then raise exception 'INVALID_GROWTH_FEEDBACK'; end if;
  if target_growth_rule_id is null and target_overlay_id is null then raise exception 'INVALID_GROWTH_FEEDBACK'; end if;
  if target_source_message_id is not null and not exists(
    select 1 from public.kiora_messages where owner_id=target_owner and id=target_source_message_id
  ) then raise exception 'INVALID_GROWTH_FEEDBACK'; end if;
  if target_feedback_id is not null and not exists(
    select 1 from public.kiora_feedback where owner_id=target_owner and id=target_feedback_id
  ) then raise exception 'INVALID_GROWTH_FEEDBACK'; end if;
  if target_growth_rule_id is not null then
    select growth_version_id into version_id from public.kiora_growth_rules where owner_id=target_owner and id=target_growth_rule_id;
    if version_id is null then raise exception 'GROWTH_RULE_NOT_FOUND'; end if;
  end if;
  if target_overlay_id is not null and not exists(select 1 from public.kiora_temporary_growth_overlays where owner_id=target_owner and id=target_overlay_id)
    then raise exception 'GROWTH_OVERLAY_NOT_FOUND'; end if;
  insert into public.kiora_growth_evidence(
    owner_id,growth_version_id,growth_rule_id,overlay_id,source_message_id,feedback_id,evidence_type,note
  ) values(
    target_owner,version_id,target_growth_rule_id,target_overlay_id,target_source_message_id,target_feedback_id,target_evidence_type,left(target_note,2000)
  ) on conflict do nothing returning * into evidence_row;
  return to_jsonb(evidence_row);
end; $$;

-- ---------------------------------------------------------------------------
-- Shadow tests always evaluate a stable compiled snapshot.
-- ---------------------------------------------------------------------------

create or replace function public.kiora_begin_shadow_test(target_owner uuid,target_growth_version_id uuid,target_model_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare flags jsonb; version_row public.kiora_growth_versions%rowtype; snapshot_row public.kiora_compiled_growth_snapshots%rowtype;
  shadow_row public.kiora_shadow_tests%rowtype; evaluation_row public.kiora_evaluations%rowtype; cases jsonb;
begin
  select feature_flags into flags from public.kiora_settings where owner_id=target_owner;
  if coalesce((flags->>'shadow_testing_enabled')::boolean,false) is not true then raise exception 'SHADOW_TESTING_DISABLED'; end if;
  if coalesce((flags->>'evaluation_enabled')::boolean,false) is not true
    or coalesce((flags->>'regression_gate_enabled')::boolean,false) is not true then raise exception 'PHASE4B_NOT_ENABLED'; end if;
  select * into version_row from public.kiora_growth_versions
  where owner_id=target_owner and id=target_growth_version_id for update;
  if not found or version_row.status not in ('draft','testing') then raise exception 'GROWTH_VERSION_NOT_TESTABLE'; end if;
  select * into snapshot_row from public.kiora_compiled_growth_snapshots
  where owner_id=target_owner and growth_version_id=target_growth_version_id and status='valid';
  if not found or snapshot_row.conflict_count<>0 then raise exception 'VALID_GROWTH_SNAPSHOT_REQUIRED'; end if;
  if not exists(select 1 from public.kiora_models where owner_id=target_owner and id=target_model_id and status='active')
    then raise exception 'MODEL_NOT_FOUND'; end if;
  select coalesce(jsonb_agg(enabled_case.id order by enabled_case.suite,enabled_case.name),'[]'::jsonb) into cases
  from (
    select id,suite,name from public.kiora_eval_cases where owner_id=target_owner and enabled=true
    order by suite,name limit 60
  ) enabled_case;
  if jsonb_array_length(cases)<1 then raise exception 'NO_EVAL_CASES'; end if;
  update public.kiora_growth_versions set status='testing' where id=version_row.id;
  insert into public.kiora_evaluations(owner_id,model_id,growth_version_id,evaluation_type,status,started_at,result)
  values(target_owner,target_model_id,target_growth_version_id,'shadow','running',now(),
    jsonb_build_object('case_count',jsonb_array_length(cases),'compiled_snapshot_id',snapshot_row.id))
  returning * into evaluation_row;
  insert into public.kiora_shadow_tests(owner_id,growth_version_id,model_id,evaluation_id,status,case_ids,started_at,compiled_snapshot_id)
  values(target_owner,target_growth_version_id,target_model_id,evaluation_row.id,'running',cases,now(),snapshot_row.id)
  returning * into shadow_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'shadow-test-started:'||shadow_row.id,'SHADOW_TEST_STARTED','shadow_test',shadow_row.id::text,
    jsonb_build_object('growth_version_id',target_growth_version_id,'compiled_snapshot_id',snapshot_row.id,'case_count',jsonb_array_length(cases)));
  return to_jsonb(shadow_row)||jsonb_build_object('evaluation_id',evaluation_row.id);
end; $$;

create or replace function public.kiora_create_regression_gate(target_owner uuid,target_shadow_test_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare shadow_row public.kiora_shadow_tests%rowtype; gate_row public.kiora_regression_gates%rowtype;
  result_ids jsonb; suite_versions jsonb; blocked jsonb:='[]'::jsonb; warnings jsonb:='[]'::jsonb;
  result_count integer:=0; critical_fail_count integer:=0; warning_fail_count integer:=0; suite_count integer:=0;
  gate_status text; model_data jsonb; expected_count integer;
begin
  select * into shadow_row from public.kiora_shadow_tests
  where owner_id=target_owner and id=target_shadow_test_id and status in ('passed','failed');
  if not found then raise exception 'SHADOW_TEST_NOT_COMPLETE'; end if;
  if shadow_row.compiled_snapshot_id is null or not exists(
    select 1 from public.kiora_compiled_growth_snapshots where owner_id=target_owner and id=shadow_row.compiled_snapshot_id
      and growth_version_id=shadow_row.growth_version_id and status='valid' and conflict_count=0
  ) then raise exception 'VALID_GROWTH_SNAPSHOT_REQUIRED'; end if;
  expected_count:=jsonb_array_length(shadow_row.case_ids);
  select count(*),count(*) filter(where result.passed=false and eval_case.severity='critical'),
    count(*) filter(where result.passed=false and eval_case.severity<>'critical'),
    count(distinct result.suite),
    coalesce(jsonb_agg(result.id order by result.created_at),'[]'::jsonb),
    coalesce(jsonb_agg(result.case_id) filter(where result.passed=false and eval_case.severity<>'critical'),'[]'::jsonb)
  into result_count,critical_fail_count,warning_fail_count,suite_count,result_ids,warnings
  from public.kiora_evaluation_results result
  join public.kiora_eval_cases eval_case on eval_case.owner_id=result.owner_id and eval_case.id=result.case_id
  where result.owner_id=target_owner and result.shadow_test_id=shadow_row.id;
  select coalesce(jsonb_object_agg(suite,versions),'{}'::jsonb) into suite_versions from (
    select result.suite,jsonb_agg(distinct result.eval_case_version) as versions
    from public.kiora_evaluation_results result
    where result.owner_id=target_owner and result.shadow_test_id=shadow_row.id group by result.suite
  ) version_rows;
  select jsonb_build_object('id',id,'provider',provider,'model_key',model_key,'adapter',adapter,'version',version,'runtime',runtime,'config',config)
  into model_data from public.kiora_models where owner_id=target_owner and id=shadow_row.model_id;
  if result_count<>expected_count then blocked:=blocked||jsonb_build_array('missing_case_results'); end if;
  if suite_count<>6 then blocked:=blocked||jsonb_build_array('missing_required_eval_suite'); end if;
  if critical_fail_count>0 then blocked:=blocked||jsonb_build_array('critical_case_failure'); end if;
  gate_status:=case when jsonb_array_length(blocked)>0 then 'blocked' when warning_fail_count>0 then 'warning' else 'passed' end;
  insert into public.kiora_regression_gates(
    owner_id,growth_version_id,compiled_snapshot_id,shadow_test_id,model_id,model_snapshot,suite_versions,
    result_ids,gate_result,blocked_reasons,warning_case_ids
  ) values(
    target_owner,shadow_row.growth_version_id,shadow_row.compiled_snapshot_id,shadow_row.id,shadow_row.model_id,
    coalesce(model_data,'{}'::jsonb),coalesce(suite_versions,'{}'::jsonb),result_ids,gate_status,blocked,warnings
  ) on conflict(owner_id,shadow_test_id) do update set
    model_snapshot=excluded.model_snapshot,suite_versions=excluded.suite_versions,result_ids=excluded.result_ids,
    gate_result=excluded.gate_result,blocked_reasons=excluded.blocked_reasons,warning_case_ids=excluded.warning_case_ids
  returning * into gate_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-regression-gate:'||gate_row.id,'GROWTH_REGRESSION_GATE_COMPLETED','growth_version',gate_row.growth_version_id::text,
    jsonb_build_object('gate_id',gate_row.id,'gate_result',gate_row.gate_result,'model_id',gate_row.model_id,
      'critical_fail_count',critical_fail_count,'warning_fail_count',warning_fail_count))
  on conflict(owner_id,event_key) do update set payload=excluded.payload;
  return to_jsonb(gate_row);
end; $$;

-- ---------------------------------------------------------------------------
-- Explicit activation, retirement and rollback. No automatic caller exists.
-- ---------------------------------------------------------------------------

create or replace function public.kiora_activate_growth_version(
  target_owner uuid,target_growth_version_id uuid,target_regression_gate_id uuid,
  activation_reason text,allow_warnings boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare settings_row public.kiora_settings%rowtype; target_row public.kiora_growth_versions%rowtype;
  gate_row public.kiora_regression_gates%rowtype; old_id uuid; activation_row public.kiora_growth_activations%rowtype;
begin
  if nullif(btrim(activation_reason),'') is null then raise exception 'ACTIVATION_REASON_REQUIRED'; end if;
  select * into settings_row from public.kiora_settings where owner_id=target_owner for update;
  if not found then raise exception 'KIORA_NOT_STARTED'; end if;
  if coalesce((settings_row.feature_flags->>'auto_promote_enabled')::boolean,false) is true
    then raise exception 'AUTO_PROMOTION_FORBIDDEN'; end if;
  if coalesce((settings_row.feature_flags->>'growth_runtime_enabled')::boolean,false) is not true
    then raise exception 'PHASE4B_NOT_ENABLED'; end if;
  select * into target_row from public.kiora_growth_versions
  where owner_id=target_owner and id=target_growth_version_id and status='testing' for update;
  if not found then raise exception 'GROWTH_VERSION_NOT_ACTIVATABLE'; end if;
  select * into gate_row from public.kiora_regression_gates
  where owner_id=target_owner and id=target_regression_gate_id and growth_version_id=target_row.id;
  if not found or gate_row.gate_result='blocked' or (gate_row.gate_result='warning' and coalesce(allow_warnings,false) is not true)
    then raise exception 'REGRESSION_GATE_NOT_PASSED'; end if;
  if not exists(select 1 from public.kiora_compiled_growth_snapshots
    where owner_id=target_owner and id=gate_row.compiled_snapshot_id and growth_version_id=target_row.id and status='valid' and conflict_count=0)
    then raise exception 'VALID_GROWTH_SNAPSHOT_REQUIRED'; end if;
  old_id:=settings_row.active_growth_version_id;
  if old_id is not null and old_id<>target_row.id then
    update public.kiora_growth_versions set status='retired',retired_at=now()
    where owner_id=target_owner and id=old_id and status='active';
  end if;
  update public.kiora_growth_versions set status='active',activated_at=now(),promoted_at=now(),retired_at=null,rejected_at=null
  where id=target_row.id returning * into target_row;
  update public.kiora_settings set active_growth_version_id=target_row.id,updated_at=now() where owner_id=target_owner;
  update public.kiora_growth_candidates set promoted_at=coalesce(promoted_at,now())
  where owner_id=target_owner and id in(select value::uuid from jsonb_array_elements_text(target_row.candidate_ids));
  insert into public.kiora_growth_activations(
    owner_id,from_version_id,to_version_id,action,activation_reason,regression_gate_id,compiled_snapshot_id
  ) values(
    target_owner,old_id,target_row.id,'promote',left(activation_reason,2000),gate_row.id,gate_row.compiled_snapshot_id
  ) returning * into activation_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-activated:'||activation_row.id,'GROWTH_VERSION_ACTIVATED','growth_version',target_row.id::text,
    jsonb_build_object('from_version_id',old_id,'to_version_id',target_row.id,'activation_id',activation_row.id,
      'regression_gate_id',gate_row.id,'compiled_snapshot_id',gate_row.compiled_snapshot_id,'warning_override',coalesce(allow_warnings,false)));
  return to_jsonb(target_row)||jsonb_build_object('activation_id',activation_row.id,'regression_gate_id',gate_row.id);
end; $$;

create or replace function public.kiora_rollback_growth_version_v2(target_owner uuid,rollback_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare settings_row public.kiora_settings%rowtype; current_id uuid; target_id uuid;
  target_row public.kiora_growth_versions%rowtype; target_snapshot_id uuid; activation_row public.kiora_growth_activations%rowtype;
begin
  if nullif(btrim(rollback_reason),'') is null then raise exception 'ROLLBACK_REASON_REQUIRED'; end if;
  select * into settings_row from public.kiora_settings where owner_id=target_owner for update;
  if not found then raise exception 'KIORA_NOT_STARTED'; end if;
  current_id:=settings_row.active_growth_version_id;
  select from_version_id into target_id from public.kiora_growth_activations
  where owner_id=target_owner and to_version_id=current_id and from_version_id is not null
  order by created_at desc,id desc limit 1;
  if target_id is null then raise exception 'ROLLBACK_TARGET_NOT_FOUND'; end if;
  select * into target_row from public.kiora_growth_versions where owner_id=target_owner and id=target_id for update;
  if not found then raise exception 'ROLLBACK_TARGET_NOT_FOUND'; end if;
  select id into target_snapshot_id from public.kiora_compiled_growth_snapshots
  where owner_id=target_owner and growth_version_id=target_id and status='valid';
  update public.kiora_growth_versions set status='retired',retired_at=now()
  where owner_id=target_owner and id=current_id and status='active';
  update public.kiora_growth_versions set status='active',activated_at=now(),retired_at=null,rejected_at=null
  where id=target_id returning * into target_row;
  update public.kiora_settings set active_growth_version_id=target_id,updated_at=now() where owner_id=target_owner;
  insert into public.kiora_growth_activations(owner_id,from_version_id,to_version_id,action,activation_reason,compiled_snapshot_id)
  values(target_owner,current_id,target_id,'rollback',left(rollback_reason,2000),target_snapshot_id) returning * into activation_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-rollback:'||activation_row.id,'GROWTH_VERSION_ROLLED_BACK','growth_version',target_id::text,
    jsonb_build_object('from_version_id',current_id,'to_version_id',target_id,'activation_id',activation_row.id,'reason_recorded',true));
  insert into public.kiora_growth_evidence(owner_id,growth_version_id,evidence_type,note)
  values(target_owner,current_id,'rollback',left(rollback_reason,2000));
  return to_jsonb(target_row)||jsonb_build_object('activation_id',activation_row.id);
end; $$;

create or replace function public.kiora_rollback_growth_version(target_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  return public.kiora_rollback_growth_version_v2(target_owner,'Manual rollback through the compatibility action');
end; $$;

create or replace function public.kiora_retire_growth_version_v2(target_owner uuid,target_growth_version_id uuid,retirement_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare row_record public.kiora_growth_versions%rowtype;
begin
  if nullif(btrim(retirement_reason),'') is null then raise exception 'RETIREMENT_REASON_REQUIRED'; end if;
  update public.kiora_growth_versions set status='retired',retired_at=now(),
    evaluation_summary=evaluation_summary||jsonb_build_object('retirement_reason',left(retirement_reason,2000))
  where owner_id=target_owner and id=target_growth_version_id and status in ('draft','testing','rejected','candidate','rolled_back')
  returning * into row_record;
  if row_record.id is null then raise exception 'GROWTH_VERSION_NOT_RETIRABLE'; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'growth-retired:'||row_record.id||':'||extract(epoch from clock_timestamp())::text,
    'GROWTH_VERSION_RETIRED','growth_version',row_record.id::text,jsonb_build_object('reason_recorded',true));
  return to_jsonb(row_record);
end; $$;

-- Disable the Phase 4A promotion entry point so no service caller can bypass
-- compilation and the regression gate.
create or replace function public.kiora_promote_growth_version(target_owner uuid,target_growth_version_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  raise exception 'PHASE4B_ACTIVATION_REQUIRED';
end; $$;

-- ---------------------------------------------------------------------------
-- Lock every Phase 4B mutation RPC to service_role.
-- ---------------------------------------------------------------------------

revoke all on function public.kiora_enable_phase4b(uuid) from public,anon,authenticated;
revoke all on function public.kiora_sync_growth_candidate_compat() from public,anon,authenticated;
revoke all on function public.kiora_capture_eval_result_snapshot() from public,anon,authenticated;
revoke all on function public.kiora_prepare_growth_candidate(uuid,uuid,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.kiora_store_growth_compilation(uuid,uuid,text,text,jsonb,jsonb,text) from public,anon,authenticated;
revoke all on function public.kiora_create_temporary_growth_overlay(uuid,text,text,text,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.kiora_expire_growth_overlays(uuid) from public,anon,authenticated;
revoke all on function public.kiora_dismiss_growth_overlay(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_promote_growth_overlay(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_record_growth_application(uuid,uuid,uuid,uuid,jsonb,jsonb,integer,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.kiora_record_growth_feedback(uuid,uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.kiora_create_regression_gate(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_activate_growth_version(uuid,uuid,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.kiora_rollback_growth_version_v2(uuid,text) from public,anon,authenticated;
revoke all on function public.kiora_rollback_growth_version(uuid) from public,anon,authenticated;
revoke all on function public.kiora_retire_growth_version_v2(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.kiora_promote_growth_version(uuid,uuid) from public,anon,authenticated;

grant execute on function public.kiora_enable_phase4b(uuid) to service_role;
grant execute on function public.kiora_sync_growth_candidate_compat() to service_role;
grant execute on function public.kiora_capture_eval_result_snapshot() to service_role;
grant execute on function public.kiora_prepare_growth_candidate(uuid,uuid,text,text,text,uuid) to service_role;
grant execute on function public.kiora_store_growth_compilation(uuid,uuid,text,text,jsonb,jsonb,text) to service_role;
grant execute on function public.kiora_create_temporary_growth_overlay(uuid,text,text,text,uuid,timestamptz) to service_role;
grant execute on function public.kiora_expire_growth_overlays(uuid) to service_role;
grant execute on function public.kiora_dismiss_growth_overlay(uuid,uuid) to service_role;
grant execute on function public.kiora_promote_growth_overlay(uuid,uuid) to service_role;
grant execute on function public.kiora_record_growth_application(uuid,uuid,uuid,uuid,jsonb,jsonb,integer,integer,integer,integer) to service_role;
grant execute on function public.kiora_record_growth_feedback(uuid,uuid,uuid,uuid,uuid,text,text) to service_role;
grant execute on function public.kiora_create_regression_gate(uuid,uuid) to service_role;
grant execute on function public.kiora_activate_growth_version(uuid,uuid,uuid,text,boolean) to service_role;
grant execute on function public.kiora_rollback_growth_version_v2(uuid,text) to service_role;
grant execute on function public.kiora_rollback_growth_version(uuid) to service_role;
grant execute on function public.kiora_retire_growth_version_v2(uuid,uuid,text) to service_role;
grant execute on function public.kiora_promote_growth_version(uuid,uuid) to service_role;

commit;
