create extension if not exists pg_cron;
create extension if not exists pg_net;
create table baba_migration.push_config (
 singleton boolean primary key default true check(singleton),
 worker_secret text not null default (gen_random_uuid()::text || gen_random_uuid()::text),
 vapid jsonb
);
insert into baba_migration.push_config(singleton) values(true);
create table baba_migration.push_devices (
 id uuid primary key default gen_random_uuid(), member_id text not null,
 endpoint text unique not null, subscription jsonb not null
);
create index on baba_migration.push_devices(member_id);
create table baba_migration.push_jobs (
 id bigint generated always as identity primary key,
 device_id uuid not null references baba_migration.push_devices on delete cascade,
 trip_id text not null, title text not null, body text not null,
 due timestamptz not null default now(), attempts int not null default 0
);
create index on baba_migration.push_jobs(due);
revoke all on baba_migration.push_config,baba_migration.push_devices,baba_migration.push_jobs from public,anon,authenticated;

create function baba_migration.trip_creator(t jsonb, doc jsonb) returns text language sql immutable set search_path='' as $$
 select coalesce(nullif(t->>'creatorId',''),(select a->>'actorId' from jsonb_array_elements(doc->'Audit') with ordinality e(a,n)
 where a->>'action'='CREATE_TRIP' and a->>'entity'='Trips' and a->>'entityId'=t->>'id' order by n desc limit 1))
$$;
create function baba_migration.queue_trip_push() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select from baba_migration.push_devices) or
 (old.tables->'Registrations'=new.tables->'Registrations' and old.tables->'Transfers'=new.tables->'Transfers') then return new; end if;
 with regs as (select r from jsonb_array_elements(new.tables->'Registrations') r),
 changes as (
 select r->>'tripId' trip, coalesce(nullif(r->>'displayName',''),'회원') || ' · ' || coalesce(r->>'seats','1') || '명 · ' ||
 case r->>'status' when 'pending' then '승인 대기' when 'waitlist' then '자리 대기' when 'confirmed' then '확정' when 'cancel_requested' then '취소 요청' when 'cancelled' then '취소' else '신청 변경' end as detail
 from regs left join jsonb_array_elements(old.tables->'Registrations') o on o->>'id'=r->>'id'
 where (r->'status',r->'seats',r->'memberId') is distinct from (o->'status',o->'seats',o->'memberId')
 union all
 select r->>'tripId', case tr->>'status' when 'approved' then '양도 완료' when 'requested' then '양도 요청' else '양도 처리' end
 from jsonb_array_elements(new.tables->'Transfers') tr join regs on r->>'id'=tr->>'registrationId'
 left join jsonb_array_elements(old.tables->'Transfers') orig on orig->>'id'=tr->>'id'
 where tr->'status' is distinct from orig->'status'
 ), summaries as (select trip,left(string_agg(distinct detail,' / '),240) body from changes group by trip)
 insert into baba_migration.push_jobs(device_id,trip_id,title,body)
 select d.id,trip,t->>'title',body from summaries
 join jsonb_array_elements(new.tables->'Trips') t on t->>'id'=trip and t->>'status'<>'deleted'
 join baba_migration.push_devices d on d.member_id=baba_migration.trip_creator(t,new.tables)
 join jsonb_array_elements(new.tables->'Members') m on m->>'id'=d.member_id and m->>'status'='active';
 return new;
end $$;
create trigger trip_push_saved after update of tables on baba_migration.club_state
for each row execute function baba_migration.queue_trip_push();

select cron.schedule('baba-deliver-trip-push','* * * * *',$job$
 select net.http_post(url:='https://tzcuagoxfydrbtdqorlp.supabase.co/functions/v1/baba-trip-push',
 headers:=jsonb_build_object('Content-Type','application/json','x-baba-worker',worker_secret),
 body:='{"action":"deliver"}'::jsonb,timeout_milliseconds:=45000)
 from baba_migration.push_config where exists(select from baba_migration.push_jobs where due<=now())
$job$);
