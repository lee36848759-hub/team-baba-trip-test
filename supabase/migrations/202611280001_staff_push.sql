alter table baba_migration.push_jobs alter column trip_id drop not null;
create or replace function baba_migration.queue_trip_push() returns trigger language plpgsql set search_path='' as $$
begin
 if not exists(select from baba_migration.push_devices) then return new; end if;
 if old.tables->'Members' is distinct from new.tables->'Members' then
   insert into baba_migration.push_jobs(device_id,trip_id,title,body)
   select d.id,null,'팀바바 가입 신청',coalesce(nullif(applicant->>'nickname',''),'회원') || ' · 가입 승인 대기'
   from jsonb_array_elements(new.tables->'Members') applicant
   left join jsonb_array_elements(old.tables->'Members') previous on previous->>'id'=applicant->>'id'
   cross join jsonb_array_elements(new.tables->'Members') recipient
   join baba_migration.push_devices d on d.member_id=recipient->>'id'
   where applicant->>'status'='pending' and previous->>'status' is distinct from 'pending'
     and recipient->>'status'='active' and recipient->>'role' in ('admin','staff');
 end if;
 if (old.tables->'Registrations'=new.tables->'Registrations' and old.tables->'Transfers'=new.tables->'Transfers') then return new; end if;
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
 join jsonb_array_elements(new.tables->'Members') m on m->>'status'='active'
   and (m->>'role' in ('admin','staff') or m->>'id'=baba_migration.trip_creator(t,new.tables))
 join baba_migration.push_devices d on d.member_id=m->>'id';
 return new;
end $$;
