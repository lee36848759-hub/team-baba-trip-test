begin;
create schema baba;
revoke all on schema baba from public;
create table baba.members(id uuid primary key references auth.users, nickname text not null, role text not null default 'waiting' check(role in ('waiting','member','staff','admin')));
create table baba.trips(id bigint generated always as identity primary key, title text not null, starts date not null, ends date not null check(ends>=starts), capacity int not null check(capacity>=2), owner_id uuid not null references baba.members);
create index on baba.trips(ends,starts);
create table baba.entries(id bigint generated always as identity primary key, trip bigint not null references baba.trips, member uuid not null references baba.members, seats int not null check(seats>0), status text not null check(status in ('pending','confirmed','waitlist')), request_id uuid not null, unique(member,request_id,status));
create index on baba.entries(trip,status,id);
create function public.baba_schedule() returns jsonb language sql security definer set search_path='' as $$
select coalesce(jsonb_agg(to_jsonb(s) order by starts,id),'[]') from (
select t.id,t.title,t.starts,t.ends,t.capacity,t.capacity-coalesce((select sum(e.seats) from baba.entries e where e.trip=t.id and status in ('confirmed','pending')),0) as free
from baba.trips t where auth.uid() is not null and ends >= (now() at time zone 'Asia/Seoul')::date
) s
$$;
create function public.baba_join(p_nickname text) returns void language plpgsql security definer set search_path='' as $$
begin
if length(trim(p_nickname)) between 1 and 30 then
insert into baba.members(id,nickname) values(auth.uid(),trim(p_nickname)) on conflict(id) do nothing;
else raise exception '닉네임은 1~30자로 입력해 주세요.'; end if;
end $$;
create function public.baba_apply(p_trip bigint,p_seats int,p_request uuid) returns void language plpgsql security definer set search_path='' as $$
declare t baba.trips; available int;
begin
if not exists(select 1 from baba.members where id=auth.uid() and role<>'waiting') then raise exception '가입 승인 후 신청할 수 있습니다.'; end if;
select * into strict t from baba.trips where id=p_trip for update;
if exists(select 1 from baba.entries where member=auth.uid() and request_id=p_request) then return; end if;
if t.ends < (now() at time zone 'Asia/Seoul')::date or p_seats is null or p_seats not between 1 and t.capacity then raise exception '신청 기간 또는 인원을 확인해 주세요.'; end if;
select greatest(0,t.capacity-coalesce(sum(seats),0)) into available from baba.entries where trip=p_trip and status in ('pending','confirmed');
if exists(select 1 from baba.entries where trip=p_trip and status='waitlist') then available:=0; end if;
if available>0 then insert into baba.entries(trip,member,seats,status,request_id) values(p_trip,auth.uid(),least(available,p_seats),'pending',p_request); end if;
if p_seats>available then insert into baba.entries(trip,member,seats,status,request_id) values(p_trip,auth.uid(),p_seats-available,'waitlist',p_request); end if;
end $$;
create function public.baba_entries() returns table(id bigint,title text,nickname text,seats int,status text,can_approve boolean) language sql security definer set search_path='' as $$
select e.id,t.title,m.nickname,e.seats,e.status,(viewer.role in ('staff','admin') or t.owner_id=viewer.id) and e.status='pending'
from baba.entries e join baba.trips t on t.id=e.trip join baba.members m on m.id=e.member join baba.members viewer on viewer.id=auth.uid()
where t.ends >= (now() at time zone 'Asia/Seoul')::date and (e.member=viewer.id or viewer.role in ('staff','admin') or t.owner_id=viewer.id) order by e.id
$$;
create function public.baba_approve(p_id bigint) returns void language plpgsql security definer set search_path='' as $$
begin
update baba.entries e set status='confirmed' from baba.trips t,baba.members m where e.id=p_id and e.trip=t.id and m.id=auth.uid() and (m.role in ('staff','admin') or (m.role='member' and t.owner_id=m.id)) and e.status='pending';
if not found then raise exception '승인 권한과 신청 상태를 확인해 주세요.'; end if;
end $$;
do $$ declare f regprocedure; begin
foreach f in array array['public.baba_schedule()'::regprocedure,'public.baba_join(text)'::regprocedure,'public.baba_entries()'::regprocedure,'public.baba_apply(bigint,integer,uuid)'::regprocedure,'public.baba_approve(bigint)'::regprocedure] loop
execute format('revoke all on function %s from public,anon',f);
execute format('grant execute on function %s to authenticated',f);
end loop; end $$;
commit;
