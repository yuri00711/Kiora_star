-- Kiora Writing <-> Games linkage.
-- Safe additive migration: existing writings and games are preserved.

begin;

alter table public.writings
    add column if not exists game_id bigint;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'writings_game_id_fkey'
          and conrelid = 'public.writings'::regclass
    ) then
        alter table public.writings
            add constraint writings_game_id_fkey
            foreign key (game_id)
            references public.games(id)
            on delete set null;
    end if;
end $$;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'writings_game_review_link_check'
          and conrelid = 'public.writings'::regclass
    ) then
        alter table public.writings
            add constraint writings_game_review_link_check
            check (game_id is null or category = 'game_review')
            not valid;
    end if;
end $$;

create index if not exists writings_game_public_idx
    on public.writings(game_id, is_public, published_at desc)
    where game_id is not null;

commit;
