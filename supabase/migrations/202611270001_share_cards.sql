-- Public card content for published trips only. Personal and booking data stay private.
create function public.baba_share_cards()
returns table(id text, title text, starts text, ends text, capacity text)
language sql stable security definer set search_path = ''
as $$
 select t->>'id', t->>'title', t->>'date', t->>'endDate', t->>'capacity'
 from baba_migration.club_state s cross join lateral jsonb_array_elements(s.tables->'Trips') t
 where s.singleton and t->>'status' in ('open','closed')
$$;
revoke all on function public.baba_share_cards() from public;
grant execute on function public.baba_share_cards() to anon, authenticated, service_role;
