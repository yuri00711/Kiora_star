-- Site-wide UPDATED date settings.
-- Safe to run more than once in Supabase Dashboard > SQL Editor.
-- Existing content tables, rows, authentication and policies are not removed.

begin;

create table if not exists public.site_settings (
    id smallint primary key default 1 check (id = 1),
    manual_updated_at date,
    content_updated_at timestamptz,
    currently_playing jsonb,
    export_profile_settings jsonb,
    updated_at timestamptz not null default now()
);

alter table public.site_settings
    add column if not exists manual_updated_at date,
    add column if not exists content_updated_at timestamptz,
    add column if not exists currently_playing jsonb,
    add column if not exists export_profile_settings jsonb,
    add column if not exists updated_at timestamptz not null default now();

insert into public.site_settings (id)
values (1)
on conflict (id) do nothing;

create or replace function public.set_site_settings_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists site_settings_set_updated_at on public.site_settings;
create trigger site_settings_set_updated_at
before update on public.site_settings
for each row execute function public.set_site_settings_updated_at();

create or replace function public.touch_site_content_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.site_settings (id, content_updated_at)
    values (1, clock_timestamp())
    on conflict (id) do update
    set content_updated_at = excluded.content_updated_at,
        updated_at = clock_timestamp();
    return null;
end;
$$;

revoke all on function public.touch_site_content_updated_at() from public;

do $$
declare
    current_table text;
    timestamp_column text;
    table_latest timestamptz;
    latest_content timestamptz;
    tracked_tables text[] := array[
        'site_profile', 'profile_fandoms', 'profile_favorites', 'profile_boundaries',
        'otome_profile', 'writings', 'games', 'characters', 'music',
        'tier_boards', 'tier_sections', 'tier_items'
    ];
begin
    foreach current_table in array tracked_tables loop
        select columns.column_name into timestamp_column
        from information_schema.columns as columns
        where columns.table_schema = 'public'
          and columns.table_name = current_table
          and columns.column_name in ('updated_at', 'created_at', 'published_at')
        order by case columns.column_name when 'updated_at' then 1 when 'created_at' then 2 else 3 end
        limit 1;

        if timestamp_column is not null then
            execute format('select max(%I) from public.%I', timestamp_column, current_table) into table_latest;
            latest_content := greatest(latest_content, table_latest);
        end if;
        timestamp_column := null;
    end loop;

    update public.site_settings
    set content_updated_at = latest_content
    where id = 1 and content_updated_at is null;
end;
$$;

do $$
declare
    table_name text;
    tracked_tables text[] := array[
        'site_profile',
        'profile_fandoms',
        'profile_favorites',
        'profile_boundaries',
        'otome_profile',
        'writings',
        'games',
        'characters',
        'music',
        'tier_boards',
        'tier_sections',
        'tier_items'
    ];
begin
    foreach table_name in array tracked_tables loop
        if to_regclass(format('public.%I', table_name)) is not null then
            execute format('drop trigger if exists %I on public.%I', 'site_updated_from_' || table_name, table_name);
            execute format(
                'create trigger %I after insert or update or delete on public.%I for each statement execute function public.touch_site_content_updated_at()',
                'site_updated_from_' || table_name,
                table_name
            );
        end if;
    end loop;
end;
$$;

alter table public.site_settings enable row level security;

drop policy if exists "Public can read site settings" on public.site_settings;
create policy "Public can read site settings"
on public.site_settings for select
to anon, authenticated
using (true);

drop policy if exists "Authenticated users manage site settings" on public.site_settings;
create policy "Authenticated users manage site settings"
on public.site_settings for all
to authenticated
using (true)
with check (true);

grant select on public.site_settings to anon, authenticated;
grant insert, update on public.site_settings to authenticated;

commit;
