-- Kiora Life Architecture Phase 3 hotfix.
-- Safe to run after supabase-kiora-phase3-migration.sql.
-- Source identity remains the Phase 0 UNIQUE(owner_id,url,content_hash) identity.

begin;

create table if not exists public.kiora_research_run_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  research_run_id uuid not null,
  source_id uuid not null,
  source_ref text,
  fetch_status text not null default 'discovered'
    check (fetch_status in ('discovered','fetched','blocked','failed','rejected')),
  relevant_excerpt text,
  reliability jsonb not null default '{}'::jsonb check (jsonb_typeof(reliability)='object'),
  http_status integer,
  content_type text,
  fetch_error text,
  source_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(source_snapshot)='object'),
  observed_at timestamptz not null default now(),
  unique(owner_id,research_run_id,source_id),
  foreign key(owner_id,research_run_id) references public.kiora_research_runs(owner_id,id) on delete cascade,
  foreign key(owner_id,source_id) references public.kiora_sources(owner_id,id) on delete cascade
);
create index if not exists kiora_research_run_sources_run_idx
  on public.kiora_research_run_sources(owner_id,research_run_id,observed_at);
create index if not exists kiora_research_run_sources_source_idx
  on public.kiora_research_run_sources(owner_id,source_id,observed_at desc);
alter table public.kiora_research_run_sources enable row level security;
revoke all on table public.kiora_research_run_sources from anon,authenticated;
grant select on table public.kiora_research_run_sources to authenticated;
grant all on table public.kiora_research_run_sources to service_role;
drop policy if exists "Kiora OWNER reads own kiora_research_run_sources" on public.kiora_research_run_sources;
create policy "Kiora OWNER reads own kiora_research_run_sources"
  on public.kiora_research_run_sources for select to authenticated
  using(owner_id=(select auth.uid()) and public.is_site_owner());

-- Recover per-run provenance already present in Phase 3 source lifecycle events.
insert into public.kiora_research_run_sources(
  owner_id,research_run_id,source_id,fetch_status,relevant_excerpt,reliability,http_status,content_type,fetch_error,source_snapshot,observed_at
)
select e.owner_id,(e.payload->>'research_run_id')::uuid,s.id,
  case when e.payload->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then e.payload->>'fetch_status' else s.fetch_status end,
  s.relevant_excerpt,s.reliability,s.http_status,s.content_type,s.fetch_error,
  jsonb_build_object('url',s.url,'canonical_url',s.canonical_url,'title',s.title,'domain',s.domain,'source_type',s.source_type,'content_hash',s.content_hash),
  e.created_at
from public.kiora_events e
join public.kiora_research_runs r on r.owner_id=e.owner_id and r.id=case
  when coalesce(e.payload->>'research_run_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then (e.payload->>'research_run_id')::uuid else null end
join public.kiora_sources s on s.owner_id=e.owner_id and s.id=case
  when coalesce(e.subject_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then e.subject_id::uuid else null end
where e.event_type in ('SOURCE_FETCHED','SOURCE_REJECTED') and e.subject_type='source'
  and coalesce(e.payload->>'research_run_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and coalesce(e.subject_id,'') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
on conflict(owner_id,research_run_id,source_id) do nothing;

-- Older rows without lifecycle events still retain their one known run link.
insert into public.kiora_research_run_sources(
  owner_id,research_run_id,source_id,fetch_status,relevant_excerpt,reliability,http_status,content_type,fetch_error,source_snapshot,observed_at
)
select s.owner_id,s.research_run_id,s.id,s.fetch_status,s.relevant_excerpt,s.reliability,s.http_status,s.content_type,s.fetch_error,
  jsonb_build_object('url',s.url,'canonical_url',s.canonical_url,'title',s.title,'domain',s.domain,'source_type',s.source_type,'content_hash',s.content_hash),
  coalesce(s.last_verified_at,s.retrieved_at)
from public.kiora_sources s
join public.kiora_research_runs r on r.owner_id=s.owner_id and r.id=s.research_run_id
where s.research_run_id is not null
on conflict(owner_id,research_run_id,source_id) do nothing;

create or replace function public.kiora_upsert_research_source(
  target_owner uuid,target_research_run_id uuid,source_item jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
declare source_id uuid; identity_url text:=nullif(btrim(source_item->>'url'),''); identity_hash text:=nullif(source_item->>'content_hash','');
begin
  perform 1 from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id;
  if not found then raise exception 'RESEARCH_RUN_NOT_FOUND'; end if;
  if identity_url is null then raise exception 'RESEARCH_SOURCE_URL_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended(target_owner::text||E'\n'||identity_url||E'\n'||coalesce(identity_hash,'<NULL>'),0));
  select id into source_id from public.kiora_sources
  where owner_id=target_owner and url=identity_url and content_hash is not distinct from identity_hash
  order by retrieved_at desc limit 1 for update;
  if source_id is null then
    begin
      insert into public.kiora_sources(owner_id,url,canonical_url,title,domain,author,publisher,published_at,retrieved_at,confidence,
        content_hash,metadata,source_type,fetch_status,research_run_id,relevant_excerpt,reliability,last_verified_at,http_status,content_type,fetch_error)
      values(target_owner,identity_url,nullif(source_item->>'canonical_url',''),left(source_item->>'title',1000),left(source_item->>'domain',300),
        left(source_item->>'author',500),left(source_item->>'publisher',500),nullif(source_item->>'published_at','')::timestamptz,now(),
        least(1,greatest(0,coalesce((source_item->>'confidence')::numeric,.5))),identity_hash,coalesce(source_item->'metadata','{}'::jsonb),
        case when source_item->>'source_type' in ('official','primary','documentation','news','reference','community','social','unknown') then source_item->>'source_type' else 'unknown' end,
        case when source_item->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then source_item->>'fetch_status' else 'rejected' end,
        target_research_run_id,left(source_item->>'relevant_excerpt',4000),coalesce(source_item->'reliability','{}'::jsonb),now(),
        nullif(source_item->>'http_status','')::integer,left(source_item->>'content_type',200),left(source_item->>'fetch_error',500))
      returning id into source_id;
    exception when unique_violation then
      select id into source_id from public.kiora_sources
      where owner_id=target_owner and url=identity_url and content_hash is not distinct from identity_hash
      order by retrieved_at desc limit 1 for update;
      if source_id is null then raise; end if;
    end;
    insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
    values(target_owner,'source-discovered:'||source_id,'SOURCE_DISCOVERED','source',source_id::text,
      jsonb_build_object('domain',source_item->>'domain','source_type',source_item->>'source_type'))
    on conflict(owner_id,event_key) do nothing;
  else
    update public.kiora_sources set
      canonical_url=coalesce(nullif(source_item->>'canonical_url',''),canonical_url),title=coalesce(left(source_item->>'title',1000),title),
      domain=coalesce(left(source_item->>'domain',300),domain),author=coalesce(left(source_item->>'author',500),author),
      publisher=coalesce(left(source_item->>'publisher',500),publisher),published_at=coalesce(nullif(source_item->>'published_at','')::timestamptz,published_at),
      confidence=least(1,greatest(0,coalesce((source_item->>'confidence')::numeric,confidence))),
      metadata=metadata||coalesce(source_item->'metadata','{}'::jsonb),source_type=case when source_item->>'source_type' in
        ('official','primary','documentation','news','reference','community','social','unknown') then source_item->>'source_type' else source_type end,
      fetch_status=case when source_item->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then source_item->>'fetch_status' else fetch_status end,
      relevant_excerpt=coalesce(left(source_item->>'relevant_excerpt',4000),relevant_excerpt),
      reliability=reliability||coalesce(source_item->'reliability','{}'::jsonb),last_verified_at=now(),
      http_status=coalesce(nullif(source_item->>'http_status','')::integer,http_status),content_type=coalesce(left(source_item->>'content_type',200),content_type),
      fetch_error=left(source_item->>'fetch_error',500)
    where id=source_id;
  end if;
  insert into public.kiora_research_run_sources(
    owner_id,research_run_id,source_id,source_ref,fetch_status,relevant_excerpt,reliability,http_status,content_type,fetch_error,source_snapshot,observed_at
  ) values(
    target_owner,target_research_run_id,source_id,left(source_item->>'ref',120),
    case when source_item->>'fetch_status' in ('discovered','fetched','blocked','failed','rejected') then source_item->>'fetch_status' else 'rejected' end,
    left(source_item->>'relevant_excerpt',4000),coalesce(source_item->'reliability','{}'::jsonb),nullif(source_item->>'http_status','')::integer,
    left(source_item->>'content_type',200),left(source_item->>'fetch_error',500),
    jsonb_build_object('url',identity_url,'canonical_url',source_item->>'canonical_url','title',left(source_item->>'title',1000),
      'domain',left(source_item->>'domain',300),'source_type',source_item->>'source_type','content_hash',identity_hash),now()
  ) on conflict(owner_id,research_run_id,source_id) do update set
    source_ref=coalesce(excluded.source_ref,public.kiora_research_run_sources.source_ref),fetch_status=excluded.fetch_status,
    relevant_excerpt=excluded.relevant_excerpt,reliability=excluded.reliability,http_status=excluded.http_status,
    content_type=excluded.content_type,fetch_error=excluded.fetch_error,source_snapshot=excluded.source_snapshot;
  return source_id;
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
    source_id:=public.kiora_upsert_research_source(target_owner,run_row.id,source_item);
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
  source_map jsonb := '{}'::jsonb; source_count int:=0; knowledge_count int:=0; knowledge_processed int:=0; question_count int:=0;
  total_model_cost numeric := greatest(coalesce(used_input_cost,0)+coalesce(used_output_cost,0),0);
begin
  select * into research_row from public.kiora_research_runs where owner_id=target_owner and id=target_research_run_id for update;
  if not found then raise exception 'RESEARCH_RUN_NOT_FOUND'; end if;
  if research_row.status in ('completed','partial') then return jsonb_build_object('research_run_id',research_row.id,'duplicate',true,'status',research_row.status); end if;
  select * into model_row from public.kiora_model_runs where owner_id=target_owner and id=research_row.model_run_id for update;

  for source_item in select value from jsonb_array_elements(coalesce(source_records,'[]'::jsonb)) loop
    source_id:=public.kiora_upsert_research_source(target_owner,research_row.id,source_item);
    source_map := source_map || jsonb_build_object(source_item->>'ref',source_id::text); source_count:=source_count+1;
    insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,payload)
    values(target_owner,'source-fetch:'||research_row.id||':'||source_id,
      case when source_item->>'fetch_status'='fetched' then 'SOURCE_FETCHED' else 'SOURCE_REJECTED' end,
      'source',source_id::text,jsonb_build_object('research_run_id',research_row.id,'fetch_status',source_item->>'fetch_status))
    on conflict(owner_id,event_key) do nothing;
  end loop;

  for item in select value from jsonb_array_elements(coalesce(knowledge_records,'[]'::jsonb)) loop
    knowledge_processed:=knowledge_processed+1;
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
  update public.kiora_research_runs set status=case when knowledge_processed=0 then 'partial' else 'completed' end,
    sources_inspected=source_count,knowledge_created=knowledge_count,
    open_questions_created=question_count,usage=jsonb_build_object('input_tokens',used_input_tokens,'output_tokens',used_output_tokens,
      'model_cost',total_model_cost,'search_cost',greatest(coalesce(search_cost,0),0))||coalesce(used_metadata,'{}'::jsonb),completed_at=now(),error_code=null where id=research_row.id;
  insert into public.kiora_events(owner_id,event_key,event_type,subject_type,subject_id,conversation_id,payload)
  values(target_owner,'research-completed:'||research_row.id,'RESEARCH_COMPLETED','research_run',research_row.id::text,research_row.conversation_id,
    jsonb_build_object('sources_inspected',source_count,'knowledge_created',knowledge_count,'grounded_claim_count',knowledge_processed,'open_questions_created',question_count));
  return jsonb_build_object('research_run_id',research_row.id,'status',case when knowledge_processed=0 then 'partial' else 'completed' end,
    'source_count',source_count,'knowledge_count',knowledge_count,'grounded_claim_count',knowledge_processed,'open_question_count',question_count,'duplicate',false);
end; $$;


revoke all on function public.kiora_upsert_research_source(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_stage_research_sources(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.kiora_complete_research(uuid,uuid,jsonb,jsonb,jsonb,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) from public,anon,authenticated;

grant execute on function public.kiora_upsert_research_source(uuid,uuid,jsonb) to service_role;
grant execute on function public.kiora_stage_research_sources(uuid,uuid,jsonb) to service_role;
grant execute on function public.kiora_complete_research(uuid,uuid,jsonb,jsonb,jsonb,text,bigint,bigint,numeric,numeric,text,numeric,jsonb) to service_role;

commit;
