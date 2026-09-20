# Kiora Phase 0 deployment

Phase 0 creates only the Kiora Life database foundation. It does not deploy a Dock, an Edge Function or a model.

## 1. Confirm the OWNER registry

Open **Supabase Dashboard → SQL Editor → New query** and run:

```sql
select user_id, created_at
from public.site_owners;
```

The table should contain the real Supabase Auth UUID of the one OWNER account. Do not put an EDITOR identity in this table.

If `public.site_owners` or `public.is_site_owner()` does not exist, first execute the existing project file:

```text
supabase-characters-owner-rls-migration.sql
```

That migration stops instead of guessing when the Auth project contains more than one user.

## 2. Execute the Phase 0 migration

Copy the complete contents of:

```text
supabase-kiora-migration.sql
```

into **SQL Editor → New query**, then select **Run**. The migration is wrapped in one transaction; a failure rolls back the complete Phase 0 schema.

Do not run `kiora_first_boot` permanently yet. The real First Boot will be performed by the OWNER-verified Phase 1 Runtime, and that time becomes Kiora's birth time.

## 3. Verify tables, RLS and browser grants

Run:

```sql
select count(*) as kiora_table_count
from information_schema.tables
where table_schema = 'public'
  and table_name like 'kiora_%';
```

Expected result:

```text
30
```

Check that every Kiora table has RLS enabled:

```sql
select relname, relrowsecurity
from pg_class
where relnamespace = 'public'::regnamespace
  and relname like 'kiora_%'
order by relname;
```

Every row must show `relrowsecurity = true`.

Check the authenticated browser privileges:

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name like 'kiora_%'
  and grantee = 'authenticated'
order by table_name, privilege_type;
```

Only `SELECT` should be present. There must be no browser `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` privilege.

## 4. Verify First Boot without creating a birth record

The following validation creates First Boot rows and then rolls the transaction back:

```sql
begin;

select public.kiora_first_boot(user_id)
from public.site_owners;

select version, status
from public.kiora_core_versions;

select version, status
from public.kiora_growth_versions;

select event_type
from public.kiora_events;

select active_conversation_id, feature_flags
from public.kiora_settings;

rollback;
```

Expected values inside the transaction include:

- Core `1.0 / active`
- Growth `0.0 / active`
- `KIORA_INITIALIZED`
- one initial active conversation
- every Phase 0 feature flag set to `false`
- an unconfigured Brain record with no provider price

After `rollback`, the Kiora tables should still be empty.

## 5. No Edge Function deployment in Phase 0

Phase 0 does not add `kiora-runtime`, so there is no function deployment command and no new Supabase Secret to configure yet.

