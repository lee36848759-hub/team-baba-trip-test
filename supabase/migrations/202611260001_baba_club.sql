begin;
create table if not exists baba_migration.club_state (
  singleton boolean primary key check (singleton),
  source_time timestamptz not null,
  tables jsonb not null
);
revoke all on baba_migration.club_state from public, anon, authenticated;
insert into baba_migration.club_state
select true, exported_at, (payload->'tables') || jsonb_build_object('Sessions','[]'::jsonb,'Audit',coalesce(payload->'tables'->'Audit','[]'::jsonb))
from baba_migration.snapshots order by exported_at desc limit 1
on conflict (singleton) do nothing;
do $$
declare doc jsonb; k text;
begin
 select tables into strict doc from baba_migration.club_state where singleton;
 foreach k in array array['Members','Trips','Registrations','Payments','Transfers'] loop
   if jsonb_typeof(doc->k) is distinct from 'array' then raise exception 'Missing table %',k; end if;
 end loop;
 if not exists(select 1 from jsonb_array_elements(doc->'Members') m where m->>'role'='admin' and m->>'status'='active')
 or exists(select 1 from jsonb_array_elements(doc->'Members') m group by m->>'kakaoId' having count(*)>1 or coalesce(m->>'kakaoId','') !~ '^[0-9]+$')
 then raise exception 'Check member identity data'; end if;
end $$;
commit;
