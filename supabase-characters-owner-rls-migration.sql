-- Kiora Characters: precise OWNER policies for direct Supabase Auth writes
-- Run once in Supabase Dashboard > SQL Editor.
-- EDITOR writes continue through editor-api/service role and bypass these client RLS policies.

begin;

-- This site has one real Supabase Auth OWNER. EDITOR identities are not Auth users.
-- Keep the OWNER UUID in a private registry instead of duplicating owner_id on every character.
create table if not exists public.site_owners (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table public.site_owners enable row level security;
revoke all on table public.site_owners from anon, authenticated;

-- Seed safely only when the Auth project contains exactly one user. If there are
-- multiple Auth users, the transaction stops instead of granting the wrong account.
do $$
declare
    auth_user_count integer;
    sole_auth_user_id uuid;
begin
    if not exists (select 1 from public.site_owners) then
        select count(*)
        into auth_user_count
        from auth.users;

        if auth_user_count <> 1 then
            raise exception
                'Expected exactly one Supabase Auth OWNER, found %. Insert the OWNER UUID into public.site_owners explicitly.',
                auth_user_count;
        end if;

        select id
        into sole_auth_user_id
        from auth.users
        limit 1;

        insert into public.site_owners (user_id)
        values (sole_auth_user_id)
        on conflict (user_id) do nothing;
    end if;
end;
$$;

create or replace function public.is_site_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select exists (
        select 1
        from public.site_owners owner
        where owner.user_id = (select auth.uid())
    );
$$;

create or replace function public.site_owner_can_manage_game(target_game_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
    select public.is_site_owner()
       and exists (
           select 1
           from public.games game_record
           where game_record.id = target_game_id
       );
$$;

revoke all on function public.is_site_owner() from public;
revoke all on function public.site_owner_can_manage_game(bigint) from public;
grant execute on function public.is_site_owner() to authenticated;
grant execute on function public.site_owner_can_manage_game(bigint) to authenticated;

alter table public.characters enable row level security;

-- Replace the characters policy set so an unknown restrictive legacy policy
-- cannot continue blocking the correctly authenticated OWNER.
do $$
declare
    existing_policy record;
begin
    for existing_policy in
        select policyname
        from pg_policies
        where schemaname = 'public'
          and tablename = 'characters'
    loop
        execute format(
            'drop policy %I on public.characters',
            existing_policy.policyname
        );
    end loop;
end;
$$;

drop policy if exists "Public reads character archive" on public.characters;
create policy "Public reads character archive"
on public.characters
for select
to anon, authenticated
using (true);

create policy "Site owner inserts characters"
on public.characters
for insert
to authenticated
with check (public.site_owner_can_manage_game(game_id));

create policy "Site owner updates characters"
on public.characters
for update
to authenticated
using (public.site_owner_can_manage_game(game_id))
with check (public.site_owner_can_manage_game(game_id));

create policy "Site owner deletes characters"
on public.characters
for delete
to authenticated
using (public.site_owner_can_manage_game(game_id));

grant select on table public.characters to anon, authenticated;
grant insert, update, delete on table public.characters to authenticated;

commit;
