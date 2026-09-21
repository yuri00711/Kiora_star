-- Kiora Life Architecture 1.0 — Phase 3 World / Research
-- Run after supabase-kiora-phase2-migration.sql.

begin;

alter table public.kiora_sources
    add column if not exists canonical_url text,
    add column if not exists publisher text,
    add column if not exists source_type text not null default 'unknown'
        check (source_type in ('official','primary','documentation','news','reference','community','social','unknown')),
    add column if not exists fetch_status text not null default 'discovered'
        check (fetch_status in ('discovered','fetched','blocked','failed','rejected')),
    add column if not exists research_run_id uuid references public.kiora_research_runs(id) on delete set null,
    add column if not exists relevant_excerpt text,
    add column if not exists reliability jsonb not null default '{}'::jsonb check (jsonb_typeof(reliability) = 'object'),
    add column if not exists last_verified_at timestamptz,
    add column if not exists http_status integer,
    add column if not exists content_type text,
    add column if not exists fetch_error text;

alter table public.kiora_knowledge drop constraint if exists kiora_knowledge_status_check;
update public.kiora_knowledge set status = case status
    when 'verified' then 'active' when 'disputed' then 'contested'
    when 'outdated' then 'stale' else status end;
alter table public.kiora_knowledge
    add constraint kiora_knowledge_status_check
        check (status in ('candidate','active','uncertain','contested','superseded','stale','retracted','forgotten')),
    add column if not exists claim_key text,
    add column if not exists entity_type text,
    add column if not exists entity_id text,
    add column if not exists canonical_name text,
    add column if not exists freshness_class text not null default 'slow-changing'
        check (freshness_class in ('stable','slow-changing','time-sensitive','breaking')),
    add column if not exists retrieved_at timestamptz not null default now(),
    add column if not exists last_verified_at timestamptz not null default now(),
    add column if not exists corroboration_count integer not null default 1 check (corroboration_count >= 0),
    add column if not exists conflict_state text not null default 'none'
        check (conflict_state in ('none','possible','confirmed','resolved')),
    add column if not exists research_run_id uuid references public.kiora_research_runs(id) on delete set null,
    add column if not exists superseded_by_id uuid references public.kiora_knowledge(id) on delete set null,
    add column if not exists forgotten_at timestamptz;

create unique index if not exists kiora_knowledge_claim_key_uidx
    on public.kiora_knowledge(owner_id, claim_key) where claim_key is not null;
create index if not exists kiora_knowledge_entity_retrieval_idx
    on public.kiora_knowledge(owner_id, entity_type, entity_id, status, freshness_class, last_verified_at desc);
create index if not exists kiora_sources_canonical_idx
    on public.kiora_sources(owner_id, canonical_url, retrieved_at desc);

alter table public.kiora_knowledge_sources
    add column if not exists research_run_id uuid references public.kiora_research_runs(id) on delete set null,
    add column if not exists relevant_excerpt text,
    add column if not exists claim_relevance text,
    add column if not exists primary_or_secondary text
        check (primary_or_secondary is null or primary_or_secondary in ('primary','secondary','community')),
    add column if not exists metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');

alter table public.kiora_open_questions drop constraint if exists kiora_open_questions_status_check;
update public.kiora_open_questions set status = case status
    when 'partially_answered' then 'partially_resolved'
    when 'answered' then 'resolved'
    when 'retired' then 'abandoned' else status end;
alter table public.kiora_open_questions
    add constraint kiora_open_questions_status_check
        check (status in ('open','researching','partially_resolved','resolved','abandoned','superseded')),
    add column if not exists entity_type text,
    add column if not exists entity_id text,
    add column if not exists evidence jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence) = 'array'),
    add column if not exists last_researched_at timestamptz,
    add column if not exists attempt_count integer not null default 0 check (attempt_count >= 0),
    add column if not exists next_eligible_at timestamptz,
    add column if not exists superseded_by_id uuid references public.kiora_open_questions(id) on delete set null;

alter table public.kiora_research_runs
    add column if not exists trigger_type text not null default 'owner_explicit'
        check (trigger_type in ('owner_explicit','freshness_required','open_question','interest_candidate','manual_url')),
    add column if not exists intent text,
    add column if not exists depth text not null default 'quick' check (depth in ('quick','normal','deep')),
    add column if not exists provider text,
    add column if not exists model_run_id uuid references public.kiora_model_runs(id) on delete set null,
    add column if not exists conversation_id uuid references public.kiora_conversations(id) on delete set null,
    add column if not exists request_message_id uuid references public.kiora_messages(id) on delete set null,
    add column if not exists entity_type text,
    add column if not exists entity_id text,
    add column if not exists canonical_name text,
    add column if not exists sources_inspected integer not null default 0,
    add column if not exists knowledge_created integer not null default 0,
    add column if not exists open_questions_created integer not null default 0,
    add column if not exists limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
    add column if not exists usage jsonb not null default '{}'::jsonb check (jsonb_typeof(usage) = 'object'),
    add column if not exists error_code text;

alter table public.kiora_settings
    add column if not exists research_brain_model_id uuid references public.kiora_models(id) on delete set null,
    add column if not exists research_config jsonb not null default '{
      "search_adapter":"unconfigured","search_provider":"unconfigured","search_endpoint":null,
      "api_key_env":"KIORA_PROVIDER_SEARCH_API_KEY","max_search_queries":2,"max_sources":5,
      "max_fetch_bytes":750000,"max_source_chars":18000,"max_model_calls":1,
      "max_output_tokens":1800,"timeout_ms":12000,"max_redirects":3,
      "max_search_bytes":500000,"search_max_redirects":1,"cost_per_query":0,"search_currency":null,
      "knowledge_retrieval_limit":6,"knowledge_candidate_limit":120
    }'::jsonb check (jsonb_typeof(research_config) = 'object');

alter table public.kiora_usage_ledger drop constraint if exists kiora_usage_ledger_category_check;
alter table public.kiora_usage_ledger add constraint kiora_usage_ledger_category_check
    check (category in ('chat','deep','research','search','knowledge_extraction','research_reflection','embedding','reranker','reflection','training','other'));

create or replace function public.kiora_enable_phase3(target_owner uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare enabled_flags jsonb;
begin
  if target_owner is null or not exists (select 1 from public.site_owners where user_id = target_owner)
  then raise exception 'KIORA_OWNER_REQUIRED'; end if;
  update public.kiora_settings set
    feature_flags = feature_flags || jsonb_build_object(
      'research_enabled', true, 'knowledge_enabled', true,
      'open_questions_enabled', true, 'curiosity_enabled', true,
      'background_research_enabled', false
    ), updated_at = now()
  where owner_id = target_owner returning feature_flags into enabled_flags;
  if enabled_flags is null then raise exception 'KIORA_NOT_STARTED'; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,payload)
  values(target_owner,'phase-3-enabled','PHASE_ENABLED','runtime',jsonb_build_object('phase',3,'world_research_enabled',true))
  on conflict(owner_id,event_key) do nothing;
  return enabled_flags;
end; $$;

create or replace function public.kiora_begin_research(
  target_owner uuid, target_conversation_id uuid, source_message_id uuid,
  research_query text, research_intent text, research_trigger text, research_depth text,
  research_provider text, selected_model_id uuid, model_cost_snapshot jsonb,
  research_limits jsonb, entity_context jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare run_row public.kiora_research_runs%rowtype; model_row public.kiora_model_runs%rowtype;
  run_key text := 'research:' || source_message_id::text;
begin
  if not coalesce(((select feature_flags from public.kiora_settings where owner_id=target_owner)->>'research_enabled')::boolean,false)
  then raise exception 'PHASE3_NOT_ENABLED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(run_key,0));
  select * into run_row from public.kiora_research_runs where owner_id=target_owner and request_message_id=source_message_id order by created_at desc limit 1;
  if found then return jsonb_build_object('research_run_id',run_row.id,'model_run_id',run_row.model_run_id,'duplicate',true,'status',run_row.status); end if;
  insert into public.kiora_model_runs(owner_id,model_id,conversation_id,request_message_id,turn_key,run_kind,status,cost_snapshot)
  values(target_owner,selected_model_id,target_conversation_id,source_message_id,run_key,'research','started',coalesce(model_cost_snapshot,'{}'::jsonb)) returning * into model_row;
  insert into public.kiora_research_runs(owner_id,requested_by,query,status,trigger_type,intent,depth,provider,model_run_id,
    conversation_id,request_message_id,entity_type,entity_id,canonical_name,limits,started_at)
  values(target_owner,'owner',left(research_query,1000),'running',research_trigger,left(research_intent,1000),research_depth,
    left(research_provider,120),model_row.id,target_conversation_id,source_message_id,entity_context->>'entity_type',
    entity_context->>'entity_id',left(entity_context->>'canonical_name',500),coalesce(research_limits,'{}'::jsonb),now()) returning * into run_row;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,conversation_id,message_id,payload)
  values(target_owner,'research-started:'||run_row.id,'RESEARCH_STARTED','research_run',run_row.id::text,target_conversation_id,source_message_id,
    jsonb_build_object('trigger',research_trigger,'depth',research_depth,'provider',research_provider));
  return jsonb_build_object('research_run_id',run_row.id,'model_run_id',model_row.id,'duplicate',false,'status','running');
end; $$;

create or replace function public.kiora_stage_research_sources(
  target_owner uuid,target_research_run_id uuid,source_records jsonb
) returns integer language plpgsql security definer set search_path='' as $$
declare run_row public.kiora_research_runs%rowtype; source_item jsonb; source_id uuid; source_count integer:=0;
begin
  select * into run_row from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id for update;
  if not found then raise exception 'RESEARCH_RUN_NOT_FOUND'; end if;
  if run_row.status<>'running' then return run_row.sources_inspected; end if;
  for source_item in select value from jsonb_array_elements(coalesce(source_records,'[]'::jsonb)) loop
    source_id:=null;
    select id into source_id from public.kiora_sources where owner_id=target_owner
      and coalesce(canonical_url,url)=coalesce(source_item->>'canonical_url',source_item->>'url')
      and coalesce(content_hash,'')=coalesce(source_item->>'content_hash','')
      order by retrieved_at desc limit 1;
    if source_id is null then
      insert into public.kiora_sources(owner_id,url,canonical_url,title,domain,author,publisher,published_at,retrieved_at,confidence,
        content_hash,metadata,source_type,fetch_status,research_run_id,relevant_excerpt,reliability,last_verified_at,http_status,content_type,fetch_error)
      values(target_owner,source_item->>'url',source_item->>'canonical_url',left(source_item->>'title',1000),left(source_item->>'domain',300),
        left(source_item->>'author',500),left(source_item->>'publisher',500),nullif(source_item->>'published_at','')::timestamptz,now(),
        least(1,greatest(0,coalesce((source_item->>'confidence')::numeric,.5))),source_item->>'content_hash',
        coalesce(source_item->'metadata','{}'::jsonb),case when source_item->>'source_type' in ('official','primary','documentation','news','reference','community','social','unknown') then source_item->>'source_type' else 'unknown' end,
        case when source_item->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then source_item->>'fetch_status' else 'rejected' end,
        run_row.id,left(source_item->>'relevant_excerpt',4000),coalesce(source_item->'reliability','{}'::jsonb),now(),
        nullif(source_item->>'http_status','')::integer,left(source_item->>'content_type',200),left(source_item->>'fetch_error',500))
      returning id into source_id;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'source-discovered:'||source_id,'SOURCE_DISCOVERED','source',source_id::text,
        jsonb_build_object('domain',source_item->>'domain','source_type',source_item->>'source_type'))
      on conflict(owner_id,event_key) do nothing;
    else
      update public.kiora_sources set last_verified_at=now(),fetch_status=source_item->>'fetch_status',
        research_run_id=run_row.id,relevant_excerpt=left(source_item->>'relevant_excerpt',4000),
        fetch_error=left(source_item->>'fetch_error',500) where id=source_id;
    end if;
    source_count:=source_count+1;
    insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
    values(target_owner,'source-fetch:'||run_row.id||':'||source_id,
      case when source_item->>'fetch_status'='fetched' then 'SOURCE_FETCHED' else 'SOURCE_REJECTED' end,
      'source',source_id::text,jsonb_build_object('research_run_id',run_row.id,'fetch_status',source_item->>'fetch_status'))
    on conflict(owner_id,event_key) do nothing;
  end loop;
  update public.kiora_research_runs set sources_inspected=source_count where id=run_row.id;
  return source_count;
end; $$;

create or replace function public.kiora_complete_research(
  target_owner uuid, target_research_run_id uuid, source_records jsonb, knowledge_records jsonb,
  question_records jsonb, provider_request text, used_input_tokens bigint, used_output_tokens bigint,
  used_input_cost numeric, used_output_cost numeric, used_currency text, search_cost numeric, used_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare research_row public.kiora_research_runs%rowtype; model_row public.kiora_model_runs%rowtype;
  item jsonb; source_item jsonb; source_id uuid; knowledge_id uuid; existing_id uuid; old_id uuid; question_id uuid; task_id uuid;
  question_evidence jsonb;
  source_map jsonb := '{}'::jsonb; source_count int:=0; knowledge_count int:=0; question_count int:=0;
  total_model_cost numeric := greatest(coalesce(used_input_cost,0)+coalesce(used_output_cost,0),0);
begin
  select * into research_row from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id for update;
  if not found then raise exception 'RESEARCH_RUN_NOT_FOUND'; end if;
  if research_row.status in ('completed','partial') then return jsonb_build_object('research_run_id',research_row.id,'duplicate',true,'status',research_row.status); end if;
  select * into model_row from public.kiora_model_runs where owner_id=target_owner and id=research_row.model_run_id for update;

  for source_item in select value from jsonb_array_elements(coalesce(source_records,'[]'::jsonb)) loop
    source_id := null;
    select id into source_id from public.kiora_sources where owner_id=target_owner
      and coalesce(canonical_url,url)=coalesce(source_item->>'canonical_url',source_item->>'url')
      and coalesce(content_hash,'')=coalesce(source_item->>'content_hash','') order by retrieved_at desc limit 1;
    if source_id is null then
      insert into public.kiora_sources(owner_id,url,canonical_url,title,domain,author,publisher,published_at,retrieved_at,confidence,
        content_hash,metadata,source_type,fetch_status,research_run_id,relevant_excerpt,reliability,last_verified_at,http_status,content_type,fetch_error)
      values(target_owner,source_item->>'url',source_item->>'canonical_url',left(source_item->>'title',1000),left(source_item->>'domain',300),
        left(source_item->>'author',500),left(source_item->>'publisher',500),nullif(source_item->>'published_at','')::timestamptz,now(),
        least(1,greatest(0,coalesce((source_item->>'confidence')::numeric,.5))),source_item->>'content_hash',
        coalesce(source_item->'metadata','{}'::jsonb),case when source_item->>'source_type' in ('official','primary','documentation','news','reference','community','social','unknown') then source_item->>'source_type' else 'unknown' end,
        case when source_item->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then source_item->>'fetch_status' else 'rejected' end,research_row.id,
        left(source_item->>'relevant_excerpt',4000),coalesce(source_item->'reliability','{}'::jsonb),now(),
        nullif(source_item->>'http_status','')::integer,left(source_item->>'content_type',200),left(source_item->>'fetch_error',500)) returning id into source_id;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'source-discovered:'||source_id,'SOURCE_DISCOVERED','source',source_id::text,jsonb_build_object('domain',source_item->>'domain','source_type',source_item->>'source_type'));
    else
      update public.kiora_sources set last_verified_at=now(),fetch_status=source_item->>'fetch_status',
        research_run_id=research_row.id,source_type=case when source_item->>'source_type' in
          ('official','primary','documentation','news','reference','community','social','unknown')
          then source_item->>'source_type' else 'unknown' end,
        relevant_excerpt=left(source_item->>'relevant_excerpt',4000),
        reliability=coalesce(source_item->'reliability','{}'::jsonb),
        publisher=coalesce(left(source_item->>'publisher',500),publisher),
        published_at=coalesce(nullif(source_item->>'published_at','')::timestamptz,published_at),
        fetch_error=left(source_item->>'fetch_error',500) where id=source_id;
    end if;
    source_map := source_map || jsonb_build_object(source_item->>'ref',source_id::text); source_count:=source_count+1;
    insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
    values(target_owner,'source-fetch:'||research_row.id||':'||source_id,
      case when source_item->>'fetch_status'='fetched' then 'SOURCE_FETCHED' else 'SOURCE_REJECTED' end,
      'source',source_id::text,jsonb_build_object('research_run_id',research_row.id,'fetch_status',source_item->>'fetch_status))
    on conflict(owner_id,event_key) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(knowledge_records,'[]'::jsonb)) loop
    existing_id:=null; old_id:=null;
    select id into existing_id from public.kiora_knowledge where owner_id=target_owner and claim_key=item->>'claim_key';
    if existing_id is not null then
      update public.kiora_knowledge set last_verified_at=now(),corroboration_count=corroboration_count+1,
        confidence=greatest(confidence,coalesce((item->>'confidence')::numeric,.5)),
        status=case when item->>'contested'='true' then 'contested' when status in ('candidate','uncertain') then 'active' else status end,
        conflict_state=case when item->>'contested'='true' then 'confirmed' else conflict_state end,updated_at=now()
      where id=existing_id returning id into knowledge_id;
      if item->>'contested'='true' then
        insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
        values(target_owner,'knowledge-contested:'||research_row.id||':'||knowledge_id,'KNOWLEDGE_CONTESTED','knowledge',knowledge_id::text,
          jsonb_build_object('research_run_id',research_row.id)) on conflict(owner_id,event_key) do nothing;
      else
        insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
        values(target_owner,'knowledge-confirmed:'||research_row.id||':'||knowledge_id,'KNOWLEDGE_CONFIRMED','knowledge',knowledge_id::text,
          jsonb_build_object('research_run_id',research_row.id)) on conflict(owner_id,event_key) do nothing;
      end if;
    else
      insert into public.kiora_knowledge(owner_id,statement,summary,status,confidence,valid_from,valid_until,claim_key,entity_type,entity_id,
        canonical_name,freshness_class,retrieved_at,last_verified_at,corroboration_count,conflict_state,research_run_id)
      values(target_owner,left(item->>'claim',8000),left(item->>'summary',1200),case when item->>'contested'='true' then 'contested'
        when coalesce((item->>'confidence')::numeric,.5)>=.72 then 'active' else 'uncertain' end,
        least(1,greatest(0,coalesce((item->>'confidence')::numeric,.5))),nullif(item->>'valid_from','')::timestamptz,
        nullif(item->>'valid_until','')::timestamptz,item->>'claim_key',item->>'entity_type',item->>'entity_id',left(item->>'canonical_name',500),
        case when item->>'freshness_class' in ('stable','slow-changing','time-sensitive','breaking') then item->>'freshness_class' else 'slow-changing' end,
        now(),now(),greatest(1,coalesce((item->>'corroboration_count')::int,1)),
        case when item->>'contested'='true' then 'confirmed' else 'none' end,research_row.id) returning id into knowledge_id;
      knowledge_count:=knowledge_count+1;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'knowledge-candidate:'||knowledge_id,'KNOWLEDGE_CANDIDATE_CREATED','knowledge',knowledge_id::text,jsonb_build_object('research_run_id',research_row.id));
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'knowledge-created:'||knowledge_id,case when item->>'contested'='true' then 'KNOWLEDGE_CONTESTED' else 'KNOWLEDGE_CREATED' end,
        'knowledge',knowledge_id::text,jsonb_build_object('research_run_id',research_row.id,'freshness_class',item->>'freshness_class'));
    end if;
    for source_item in select value from jsonb_array_elements(coalesce(item->'source_support','[]'::jsonb)) loop
      source_id:=nullif(source_map->>(source_item->>'ref'),'')::uuid;
      if source_id is not null then
        insert into public.kiora_knowledge_sources(owner_id,knowledge_id,source_id,relation,note,research_run_id,relevant_excerpt,
          claim_relevance,primary_or_secondary,metadata)
        values(target_owner,knowledge_id,source_id,case when source_item->>'relation' in ('supports','contradicts','mentions','supersedes')
          then source_item->>'relation' else 'supports' end,left(source_item->>'note',1000),research_row.id,
          left(source_item->>'excerpt',3000),left(source_item->>'claim_relevance',500),
          case when source_item->>'primary_or_secondary' in ('primary','secondary','community') then source_item->>'primary_or_secondary' else 'secondary' end,'{}'::jsonb)
        on conflict(owner_id,knowledge_id,source_id,relation) do update set relevant_excerpt=excluded.relevant_excerpt,research_run_id=excluded.research_run_id;
      end if;
    end loop;
    if nullif(item->>'supersedes_claim_key','') is not null then
      select id into old_id from public.kiora_knowledge where owner_id=target_owner and claim_key=item->>'supersedes_claim_key';
      if old_id is not null and old_id<>knowledge_id then
        update public.kiora_knowledge set status='superseded',superseded_by_id=knowledge_id,updated_at=now() where id=old_id;
        insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
        values(target_owner,'knowledge-superseded:'||old_id||':'||knowledge_id,'KNOWLEDGE_SUPERSEDED','knowledge',old_id::text,
          jsonb_build_object('superseded_by_id',knowledge_id,'research_run_id',research_row.id)) on conflict(owner_id,event_key) do nothing;
      end if;
    end if;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(question_records,'[]'::jsonb)) loop
    question_id:=null;
    select coalesce(jsonb_agg(to_jsonb(source_map->>refs.ref)) filter (where source_map ? refs.ref),'[]'::jsonb)
      into question_evidence
      from jsonb_array_elements_text(coalesce(item->'evidence','[]'::jsonb)) as refs(ref);
    select id into question_id from public.kiora_open_questions where owner_id=target_owner
      and lower(question)=lower(left(item->>'question',4000)) and status in ('open','researching','partially_resolved') limit 1;
    if question_id is null then
      insert into public.kiora_open_questions(owner_id,question,status,origin,current_understanding,entity_type,entity_id,evidence,last_researched_at,
        attempt_count,next_eligible_at)
      values(target_owner,left(item->>'question',4000),case when item->>'status' in ('open','partially_resolved') then item->>'status' else 'open' end,
        left(coalesce(item->>'origin','research'),500),left(item->>'current_understanding',5000),item->>'entity_type',item->>'entity_id',
        question_evidence,now(),1,now()+interval '7 days') returning id into question_id;
      question_count:=question_count+1;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'open-question:'||question_id,'OPEN_QUESTION_CREATED','open_question',question_id::text,
        jsonb_build_object('research_run_id',research_row.id,'entity_type',item->>'entity_type','entity_id',item->>'entity_id'));
      insert into public.kiora_tasks(owner_id,task_type,status,priority,payload)
      values(target_owner,'curiosity_candidate','waiting_confirmation',0,jsonb_build_object('open_question_id',question_id,'research_run_id',research_row.id)) returning id into task_id;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'curiosity-candidate:'||task_id,'CURIOSITY_CANDIDATE_CREATED','task',task_id::text,jsonb_build_object('open_question_id',question_id,'auto_execute',false));
    else
      update public.kiora_open_questions set current_understanding=left(item->>'current_understanding',5000),
        evidence=case when jsonb_array_length(question_evidence)>0 then question_evidence else evidence end,
        last_researched_at=now(),attempt_count=attempt_count+1,next_eligible_at=now()+interval '7 days',updated_at=now()
      where id=question_id;
      insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
      values(target_owner,'open-question-update:'||research_row.id||':'||question_id,'OPEN_QUESTION_UPDATED','open_question',question_id::text,
        jsonb_build_object('research_run_id',research_row.id)) on conflict(owner_id,event_key) do nothing;
    end if;
  end loop;

  update public.kiora_model_runs set status='completed',provider_request_id=nullif(provider_request,''),
    input_tokens=greatest(coalesce(used_input_tokens,0),0),output_tokens=greatest(coalesce(used_output_tokens,0),0),
    input_cost=greatest(coalesce(used_input_cost,0),0),output_cost=greatest(coalesce(used_output_cost,0),0),total_cost=total_model_cost,
    currency=nullif(used_currency,''),usage_metadata=coalesce(used_metadata,'{}'::jsonb),completed_at=now(),error_code=null where id=model_row.id;
  insert into public.kiora_usage_ledger(owner_id,model_run_id,category,quantity,unit,amount,currency,cost_config_snapshot,occurred_at)
  values(target_owner,model_row.id,'knowledge_extraction',greatest(coalesce(used_input_tokens,0)+coalesce(used_output_tokens,0),0),'tokens',
    total_model_cost,nullif(used_currency,''),model_row.cost_snapshot,now())
  on conflict(model_run_id,category) where model_run_id is not null do update set quantity=excluded.quantity,amount=excluded.amount,currency=excluded.currency,occurred_at=excluded.occurred_at;
  insert into public.kiora_usage_ledger(owner_id,model_run_id,category,quantity,unit,amount,currency,cost_config_snapshot,occurred_at)
  values(target_owner,model_row.id,'search',case when research_row.trigger_type='manual_url' then 0 else 1 end,'queries',
    greatest(coalesce(search_cost,0),0),nullif(used_currency,''),
    jsonb_build_object('provider',research_row.provider),now())
  on conflict(model_run_id,category) where model_run_id is not null do update set quantity=excluded.quantity,amount=excluded.amount,currency=excluded.currency,occurred_at=excluded.occurred_at;
  update public.kiora_research_runs set status=case when knowledge_count=0 then 'partial' else 'completed' end,
    sources_inspected=source_count,knowledge_created=knowledge_count,
    open_questions_created=question_count,usage=jsonb_build_object('input_tokens',used_input_tokens,'output_tokens',used_output_tokens,
      'model_cost',total_model_cost,'search_cost',greatest(coalesce(search_cost,0),0)),completed_at=now(),error_code=null where id=research_row.id;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,conversation_id,payload)
  values(target_owner,'research-completed:'||research_row.id,'RESEARCH_COMPLETED','research_run',research_row.id::text,research_row.conversation_id,
    jsonb_build_object('sources_inspected',source_count,'knowledge_created',knowledge_count,'open_questions_created',question_count));
  return jsonb_build_object('research_run_id',research_row.id,'status',case when knowledge_count=0 then 'partial' else 'completed' end,
    'source_count',source_count,'knowledge_count',knowledge_count,'open_question_count',question_count,'duplicate',false);
end; $$;

create or replace function public.kiora_record_failed_research_usage(
  target_owner uuid, target_research_run_id uuid, provider_request text,
  used_input_tokens bigint, used_output_tokens bigint, used_input_cost numeric,
  used_output_cost numeric, used_currency text, search_cost numeric, used_metadata jsonb
) returns boolean language plpgsql security definer set search_path='' as $$
declare run_row public.kiora_research_runs%rowtype; model_row public.kiora_model_runs%rowtype;
  model_cost numeric := greatest(coalesce(used_input_cost,0)+coalesce(used_output_cost,0),0);
begin
  select * into run_row from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id for update;
  if not found then return false; end if;
  select * into model_row from public.kiora_model_runs where owner_id=target_owner and id=run_row.model_run_id for update;
  if not found then return false; end if;
  update public.kiora_model_runs set provider_request_id=nullif(provider_request,''),
    input_tokens=greatest(coalesce(used_input_tokens,0),0),output_tokens=greatest(coalesce(used_output_tokens,0),0),
    input_cost=greatest(coalesce(used_input_cost,0),0),output_cost=greatest(coalesce(used_output_cost,0),0),
    total_cost=model_cost,currency=nullif(used_currency,''),usage_metadata=coalesce(used_metadata,'{}'::jsonb)
  where id=model_row.id;
  insert into public.kiora_usage_ledger(owner_id,model_run_id,category,quantity,unit,amount,currency,cost_config_snapshot,occurred_at)
  values(target_owner,model_row.id,'knowledge_extraction',
    greatest(coalesce(used_input_tokens,0)+coalesce(used_output_tokens,0),0),'tokens',model_cost,
    nullif(used_currency,''),model_row.cost_snapshot,now())
  on conflict(model_run_id,category) where model_run_id is not null
  do update set quantity=excluded.quantity,amount=excluded.amount,currency=excluded.currency,occurred_at=excluded.occurred_at;
  insert into public.kiora_usage_ledger(owner_id,model_run_id,category,quantity,unit,amount,currency,cost_config_snapshot,occurred_at)
  values(target_owner,model_row.id,'search',case when run_row.trigger_type='manual_url' then 0 else 1 end,'queries',
    greatest(coalesce(search_cost,0),0),
    nullif(used_currency,''),jsonb_build_object('provider',run_row.provider),now())
  on conflict(model_run_id,category) where model_run_id is not null
  do update set amount=excluded.amount,currency=excluded.currency,occurred_at=excluded.occurred_at;
  update public.kiora_research_runs set usage=jsonb_build_object(
    'input_tokens',used_input_tokens,'output_tokens',used_output_tokens,
    'model_cost',model_cost,'search_cost',greatest(coalesce(search_cost,0),0))
  where id=run_row.id;
  return true;
end; $$;

create or replace function public.kiora_fail_research(target_owner uuid,target_research_run_id uuid,failure_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare run_row public.kiora_research_runs%rowtype;
begin
  select * into run_row from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id for update;
  if not found then return false; end if;
  update public.kiora_research_runs set status='failed',error_code=left(failure_code,120),completed_at=now() where id=run_row.id;
  update public.kiora_model_runs set status='failed',error_code=left(failure_code,120),completed_at=now() where id=run_row.model_run_id and status='started';
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,conversation_id,payload)
  values(target_owner,'research-failed:'||run_row.id,'RESEARCH_FAILED','research_run',run_row.id::text,run_row.conversation_id,
    jsonb_build_object('error_code',left(failure_code,120))) on conflict(owner_id,event_key) do nothing;
  return true;
end; $$;

create or replace function public.kiora_forget_knowledge(target_owner uuid,target_knowledge_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.kiora_knowledge set status='forgotten',forgotten_at=now(),updated_at=now() where owner_id=target_owner and id=target_knowledge_id;
  if not found then return false; end if; return true;
end; $$;
create or replace function public.kiora_delete_knowledge(target_owner uuid,target_knowledge_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin delete from public.kiora_knowledge where owner_id=target_owner and id=target_knowledge_id; return found; end; $$;

create or replace function public.kiora_retract_knowledge(target_owner uuid,target_knowledge_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  update public.kiora_knowledge set status='retracted',updated_at=now()
    where owner_id=target_owner and id=target_knowledge_id;
  if not found then return false; end if;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'knowledge-retracted:'||target_knowledge_id,'KNOWLEDGE_RETRACTED','knowledge',target_knowledge_id::text,
    jsonb_build_object('reason','owner_action'))
  on conflict(owner_id,event_key) do nothing;
  return true;
end; $$;

create or replace function public.kiora_mark_stale_knowledge(target_owner uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare row_item record; changed integer:=0;
begin
  for row_item in
    select id from public.kiora_knowledge
    where owner_id=target_owner and status in ('active','uncertain','contested')
      and (
        (valid_until is not null and valid_until < now()) or
        (freshness_class='breaking' and last_verified_at < now()-interval '2 days') or
        (freshness_class='time-sensitive' and last_verified_at < now()-interval '30 days')
      )
    for update
  loop
    update public.kiora_knowledge set status='stale',updated_at=now() where id=row_item.id;
    insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
    values(target_owner,'knowledge-stale:'||row_item.id,'KNOWLEDGE_STALE','knowledge',row_item.id::text,
      jsonb_build_object('reason','freshness_policy'))
    on conflict(owner_id,event_key) do nothing;
    changed:=changed+1;
  end loop;
  return changed;
end; $$;

create or replace function public.kiora_update_open_question(
  target_owner uuid,target_question_id uuid,new_status text,new_understanding text
) returns boolean language plpgsql security definer set search_path='' as $$
declare old_status text;
begin
  if new_status not in ('open','researching','partially_resolved','resolved','abandoned','superseded')
  then raise exception 'OPEN_QUESTION_STATUS_INVALID'; end if;
  select status into old_status from public.kiora_open_questions
    where owner_id=target_owner and id=target_question_id for update;
  if not found then return false; end if;
  update public.kiora_open_questions set status=new_status,
    current_understanding=left(coalesce(new_understanding,current_understanding),5000),
    resolved_at=case when new_status in ('resolved','abandoned','superseded') then now() else null end,
    updated_at=now() where id=target_question_id;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
  values(target_owner,'open-question-status:'||target_question_id||':'||new_status,
    case when new_status='resolved' then 'OPEN_QUESTION_RESOLVED' else 'OPEN_QUESTION_UPDATED' end,
    'open_question',target_question_id::text,jsonb_build_object('old_status',old_status,'new_status',new_status))
  on conflict(owner_id,event_key) do nothing;
  return true;
end; $$;

revoke all on function public.kiora_enable_phase3(uuid) from public,anon,authenticated;
revoke all on function public.kiora_begin_research(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_stage_research_sources(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_complete_research(uuid,uuid,jsonb,jsonb,jsonb,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_record_failed_research_usage(uuid,uuid,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_fail_research(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.kiora_forget_knowledge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_delete_knowledge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_retract_knowledge(uuid,uuid) from public,anon,authenticated;
revoke all on function public.kiora_mark_stale_knowledge(uuid) from public,anon,authenticated;
revoke all on function public.kiora_update_open_question(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.kiora_enable_phase3(uuid) to service_role;
grant execute on function public.kiora_begin_research(uuid,uuid,uuid,text,text,text,text,text,uuid,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.kiora_stage_research_sources(uuid,uuid,jsonb) to service_role;
grant execute on function public.kiora_complete_research(uuid,uuid,jsonb,jsonb,jsonb,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) to service_role;
grant execute on function public.kiora_record_failed_research_usage(uuid,uuid,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) to service_role;
grant execute on function public.kiora_fail_research(uuid,uuid,text) to service_role;
grant execute on function public.kiora_forget_knowledge(uuid,uuid) to service_role;
grant execute on function public.kiora_delete_knowledge(uuid,uuid) to service_role;
grant execute on function public.kiora_retract_knowledge(uuid,uuid) to service_role;
grant execute on function public.kiora_mark_stale_knowledge(uuid) to service_role;
grant execute on function public.kiora_update_open_question(uuid,uuid,text,text) to service_role;

commit;
