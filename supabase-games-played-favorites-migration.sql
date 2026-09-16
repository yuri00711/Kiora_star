-- Kiora Games: played dates and expanded favorite levels
-- Additive migration. Run after supabase-games-migration.sql.

begin;

alter table public.games
    add column if not exists started_at date,
    add column if not exists completed_at date;

alter table public.games
    drop constraint if exists games_favorite_level_check;

alter table public.games
    add constraint games_favorite_level_check
    check (
        favorite_level is null
        or favorite_level = ''
        or favorite_level in (
            'FAVORITE',
            'BELOVED',
            'LOVE',
            'LIKE',
            'NEUTRAL',
            'NOT FOR ME'
        )
    ) not valid;

alter table public.games
    drop constraint if exists games_played_dates_check;

alter table public.games
    add constraint games_played_dates_check
    check (
        started_at is null
        or completed_at is null
        or completed_at >= started_at
    ) not valid;

commit;
