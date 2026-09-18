-- Kiora Study / Learning Constellation
-- Run once in Supabase Dashboard > SQL Editor.
-- This migration only adds Study tables, functions, policies and a private bucket.

begin;

create extension if not exists pgcrypto;

create table if not exists public.study_practices (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_type text not null check (practice_type in ('aptitude', 'shenlun')),
    title text not null check (char_length(title) between 1 and 240),
    practice_date date not null default current_date,
    source text,
    subject text,
    note text,
    status text not null default 'draft' check (status in ('draft', 'ready', 'in_progress', 'completed')),
    total_questions integer check (total_questions is null or total_questions between 1 and 500),
    auto_advance boolean not null default true,
    is_public boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.study_files (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    -- Files survive practice deletion when a long-term Mistake still references them.
    practice_id uuid references public.study_practices(id) on delete set null,
    file_kind text not null check (file_kind in ('paper', 'answer_key', 'reference', 'mistake_image', 'material')),
    storage_path text not null unique,
    file_name text not null,
    mime_type text not null,
    file_size bigint not null default 0 check (file_size >= 0 and file_size <= 52428800),
    extracted_text text,
    created_at timestamptz not null default now()
);

create table if not exists public.study_aptitude_answers (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid not null references public.study_practices(id) on delete cascade,
    question_number integer not null check (question_number between 1 and 500),
    answer text,
    flagged boolean not null default false,
    updated_at timestamptz not null default now(),
    unique (practice_id, question_number)
);

create table if not exists public.study_answer_keys (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid not null references public.study_practices(id) on delete cascade,
    question_number integer not null check (question_number between 1 and 500),
    correct_answer text not null,
    source_file_id uuid references public.study_files(id) on delete set null,
    confirmed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (practice_id, question_number)
);

create table if not exists public.study_mistakes (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid references public.study_practices(id) on delete set null,
    question_number integer check (question_number is null or question_number between 1 and 500),
    source_type text not null default 'quick' check (source_type in ('practice', 'quick')),
    subject text not null,
    knowledge_tag text,
    image_path text,
    paper_file_id uuid references public.study_files(id) on delete set null,
    paper_page integer check (paper_page is null or paper_page > 0),
    crop_x numeric check (crop_x is null or crop_x between 0 and 1),
    crop_y numeric check (crop_y is null or crop_y between 0 and 1),
    crop_width numeric check (crop_width is null or crop_width > 0 and crop_width <= 1),
    crop_height numeric check (crop_height is null or crop_height > 0 and crop_height <= 1),
    question_snapshot text,
    my_answer text,
    correct_answer text not null,
    reason text,
    status text not null default 'learning' check (status in ('learning', 'review', 'mastered')),
    is_public boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.study_mistake_attempts (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    mistake_id uuid not null references public.study_mistakes(id) on delete cascade,
    answer text not null,
    is_correct boolean not null,
    attempted_at timestamptz not null default now()
);

create table if not exists public.study_shenlun_questions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid not null references public.study_practices(id) on delete cascade,
    question_number integer not null check (question_number between 1 and 100),
    title text not null,
    question_type text not null default 'other' check (question_type in ('summary','analysis','proposal','official_document','essay','other')),
    prompt text not null,
    material_scope text,
    max_characters integer check (max_characters is null or max_characters between 1 and 10000),
    points numeric check (points is null or points >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (practice_id, question_number)
);

create table if not exists public.study_shenlun_answers (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid not null references public.study_practices(id) on delete cascade,
    question_id uuid not null references public.study_shenlun_questions(id) on delete cascade,
    attempt_number integer not null default 1 check (attempt_number > 0),
    title text,
    thesis text,
    outline jsonb not null default '[]'::jsonb check (jsonb_typeof(outline) = 'array'),
    body text not null default '',
    submitted_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (question_id, attempt_number)
);

create table if not exists public.study_shenlun_references (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid not null references public.study_practices(id) on delete cascade,
    question_id uuid not null references public.study_shenlun_questions(id) on delete cascade,
    source_file_id uuid references public.study_files(id) on delete set null,
    body text not null,
    confirmed boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (question_id)
);

create table if not exists public.study_reviews (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid references public.study_practices(id) on delete set null,
    question_id uuid references public.study_shenlun_questions(id) on delete set null,
    answer_id uuid references public.study_shenlun_answers(id) on delete set null,
    content_coverage jsonb not null default '{}'::jsonb,
    material_evidence jsonb not null default '{}'::jsonb,
    task_analysis jsonb not null default '{}'::jsonb,
    expression_review jsonb not null default '{}'::jsonb,
    structure_review jsonb not null default '{}'::jsonb,
    assessment jsonb not null default '{}'::jsonb,
    model text,
    model_version text,
    created_at timestamptz not null default now()
);

create table if not exists public.study_revisions (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    practice_id uuid references public.study_practices(id) on delete set null,
    question_id uuid references public.study_shenlun_questions(id) on delete set null,
    answer_id uuid references public.study_shenlun_answers(id) on delete set null,
    review_id uuid references public.study_reviews(id) on delete set null,
    title text not null,
    category text,
    issue_tags text[] not null default '{}',
    source_snapshot jsonb not null default '{}'::jsonb,
    status text not null default 'pending' check (status in ('pending','rewriting','completed')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.study_notes (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    title text not null check (char_length(title) between 1 and 240),
    body text not null,
    subject text,
    tags text[] not null default '{}',
    note_date date not null default current_date,
    is_public boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.study_activities (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
    activity_type text not null,
    entity_type text not null,
    entity_id uuid,
    title text not null,
    detail jsonb not null default '{}'::jsonb,
    is_public boolean not null default false,
    activity_at timestamptz not null default now()
);

create index if not exists study_practices_owner_date_idx on public.study_practices(owner_id, practice_date desc);
create index if not exists study_files_practice_idx on public.study_files(practice_id, file_kind);
create index if not exists study_answers_practice_idx on public.study_aptitude_answers(practice_id, question_number);
create index if not exists study_keys_practice_idx on public.study_answer_keys(practice_id, question_number);
create index if not exists study_mistakes_browse_idx on public.study_mistakes(owner_id, subject, status, created_at desc);
create index if not exists study_attempts_mistake_idx on public.study_mistake_attempts(mistake_id, attempted_at);
create index if not exists study_questions_practice_idx on public.study_shenlun_questions(practice_id, question_number);
create index if not exists study_notes_browse_idx on public.study_notes(owner_id, note_date desc);
create index if not exists study_activities_calendar_idx on public.study_activities(owner_id, activity_at desc);

create or replace function public.study_set_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'study_practices','study_aptitude_answers','study_answer_keys','study_mistakes',
    'study_shenlun_questions','study_shenlun_answers','study_shenlun_references',
    'study_revisions','study_notes'
  ] loop
    execute format('drop trigger if exists %1$s_updated_at on public.%1$I', table_name);
    execute format('create trigger %1$s_updated_at before update on public.%1$I for each row execute function public.study_set_updated_at()', table_name);
  end loop;
end $$;

create or replace function public.study_create_activity()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  kind text := tg_argv[0];
  entity text := tg_argv[1];
  activity_title text;
  activity_owner uuid;
  activity_public boolean := false;
  activity_id uuid;
begin
  activity_owner := new.owner_id;
  activity_id := new.id;
  activity_title := coalesce(to_jsonb(new)->>'title', entity);
  activity_public := coalesce((to_jsonb(new)->>'is_public')::boolean, false);
  insert into public.study_activities(owner_id, activity_type, entity_type, entity_id, title, detail, is_public, activity_at)
  values (activity_owner, kind, entity, activity_id, activity_title, jsonb_build_object('status', to_jsonb(new)->>'status'), activity_public, coalesce((to_jsonb(new)->>'created_at')::timestamptz, now()));
  return new;
end;
$$;

create or replace function public.study_track_practice_completion()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.study_activities(owner_id, activity_type, entity_type, entity_id, title, detail, is_public)
    values (new.owner_id, 'practice_completed', 'practice', new.id, new.title, jsonb_build_object('practice_type', new.practice_type), new.is_public);
  end if;
  return new;
end;
$$;

create or replace function public.study_track_mistake_status()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    insert into public.study_activities(owner_id, activity_type, entity_type, entity_id, title, detail, is_public)
    values (new.owner_id, case when new.status = 'mastered' then 'mistake_mastered' else 'mistake_revisited' end,
      'mistake', new.id, coalesce(new.knowledge_tag, new.subject), jsonb_build_object('status', new.status), new.is_public);
  end if;
  return new;
end;
$$;

create or replace function public.study_track_revision_rewrite()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    insert into public.study_activities(owner_id, activity_type, entity_type, entity_id, title, detail)
    values (new.owner_id, 'revision_rewritten', 'revision', new.id, new.title, jsonb_build_object('status', new.status));
  end if;
  return new;
end;
$$;

drop trigger if exists study_practice_created_activity on public.study_practices;
create trigger study_practice_created_activity after insert on public.study_practices for each row execute function public.study_create_activity('practice_created','practice');
drop trigger if exists study_practice_completed_activity on public.study_practices;
create trigger study_practice_completed_activity after update on public.study_practices for each row execute function public.study_track_practice_completion();
drop trigger if exists study_mistake_created_activity on public.study_mistakes;
create trigger study_mistake_created_activity after insert on public.study_mistakes for each row execute function public.study_create_activity('mistake_created','mistake');
drop trigger if exists study_mistake_status_activity on public.study_mistakes;
create trigger study_mistake_status_activity after update on public.study_mistakes for each row execute function public.study_track_mistake_status();
drop trigger if exists study_attempt_activity on public.study_mistake_attempts;
create trigger study_attempt_activity after insert on public.study_mistake_attempts for each row execute function public.study_create_activity('mistake_revisited','mistake_attempt');
drop trigger if exists study_answer_activity on public.study_shenlun_answers;
create trigger study_answer_activity after insert on public.study_shenlun_answers for each row execute function public.study_create_activity('shenlun_submitted','shenlun_answer');
drop trigger if exists study_review_activity on public.study_reviews;
create trigger study_review_activity after insert on public.study_reviews for each row execute function public.study_create_activity('shenlun_reviewed','review');
drop trigger if exists study_revision_activity on public.study_revisions;
create trigger study_revision_activity after insert on public.study_revisions for each row execute function public.study_create_activity('revision_created','revision');
drop trigger if exists study_revision_rewrite_activity on public.study_revisions;
create trigger study_revision_rewrite_activity after update on public.study_revisions for each row execute function public.study_track_revision_rewrite();
drop trigger if exists study_note_activity on public.study_notes;
create trigger study_note_activity after insert on public.study_notes for each row execute function public.study_create_activity('note_created','note');

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'study_practices','study_files','study_aptitude_answers','study_answer_keys','study_mistakes',
    'study_mistake_attempts','study_shenlun_questions','study_shenlun_answers',
    'study_shenlun_references','study_reviews','study_revisions','study_notes','study_activities'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists "Study owner reads %1$s" on public.%1$I', table_name);
    execute format('create policy "Study owner reads %1$s" on public.%1$I for select to authenticated using (owner_id = auth.uid())', table_name);
    execute format('drop policy if exists "Study owner inserts %1$s" on public.%1$I', table_name);
    execute format('create policy "Study owner inserts %1$s" on public.%1$I for insert to authenticated with check (owner_id = auth.uid())', table_name);
    execute format('drop policy if exists "Study owner updates %1$s" on public.%1$I', table_name);
    execute format('create policy "Study owner updates %1$s" on public.%1$I for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())', table_name);
    execute format('drop policy if exists "Study owner deletes %1$s" on public.%1$I', table_name);
    execute format('create policy "Study owner deletes %1$s" on public.%1$I for delete to authenticated using (owner_id = auth.uid())', table_name);
  end loop;
end $$;

drop policy if exists "Public reads shared study practices" on public.study_practices;
create policy "Public reads shared study practices" on public.study_practices for select to anon using (is_public);
drop policy if exists "Public reads shared study mistakes" on public.study_mistakes;
create policy "Public reads shared study mistakes" on public.study_mistakes for select to anon using (is_public);
drop policy if exists "Public reads shared study notes" on public.study_notes;
create policy "Public reads shared study notes" on public.study_notes for select to anon using (is_public);
drop policy if exists "Public reads shared study activities" on public.study_activities;
create policy "Public reads shared study activities" on public.study_activities for select to anon using (is_public);

grant select on public.study_practices, public.study_mistakes, public.study_notes, public.study_activities to anon;
grant select, insert, update, delete on public.study_practices, public.study_files,
  public.study_aptitude_answers, public.study_answer_keys, public.study_mistakes,
  public.study_mistake_attempts, public.study_shenlun_questions, public.study_shenlun_answers,
  public.study_shenlun_references, public.study_reviews, public.study_revisions,
  public.study_notes, public.study_activities to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('study-private', 'study-private', false, 52428800,
  array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Study owner reads files" on storage.objects;
create policy "Study owner reads files" on storage.objects for select to authenticated
using (bucket_id = 'study-private' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Study owner uploads files" on storage.objects;
create policy "Study owner uploads files" on storage.objects for insert to authenticated
with check (bucket_id = 'study-private' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Study owner updates files" on storage.objects;
create policy "Study owner updates files" on storage.objects for update to authenticated
using (bucket_id = 'study-private' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'study-private' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Study owner deletes files" on storage.objects;
create policy "Study owner deletes files" on storage.objects for delete to authenticated
using (bucket_id = 'study-private' and (storage.foldername(name))[1] = auth.uid()::text);

commit;
