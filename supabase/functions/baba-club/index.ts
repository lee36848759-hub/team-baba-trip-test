import postgres from 'npm:postgres@3.4.5';
import { runClub } from './club.js';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, { prepare: false, max: 2 });
const headers = {
  'Access-Control-Allow-Origin': 'https://lee36848759-hub.github.io',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store'
};
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, {headers});
  if (req.method !== 'POST') return reply({},405);
  if (new URL(req.url).pathname.endsWith('/redeem-game-ticket')) {
    const {ticket} = await req.json().catch(()=>({}));
    if(typeof ticket!=='string'||!/^club1_[0-9a-f]{64}$/.test(ticket)) return reply({},401);
    const [member]=await sql`
      with redeemed as (
        delete from baba_migration.game_launch_tickets
        where ticket_hash=sha256(convert_to(${ticket},'UTF8')) and expires_at>now()
        returning member_id
      )
      select m->>'id' as id,m->>'nickname' as nickname,(m->>'role'='admin') as "canResetQuota"
      from redeemed, baba_migration.club_state s, lateral jsonb_array_elements(s.tables->'Members') m
      where s.singleton and m->>'id'=redeemed.member_id and m->>'status'='active'`;
    return member ? reply(member) : reply({},401);
  }
  const authorization=req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply({error:'카카오 로그인이 필요합니다.'},401);
  try {
    const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{
      headers:{authorization,apikey:Deno.env.get('SUPABASE_ANON_KEY')!}
    });
    if (!auth.ok) return reply({error:'카카오 로그인이 필요합니다.'},401);
    const {id}=await auth.json();
    const {action,args}=await req.json();
    if(typeof action!=='string'||!Array.isArray(args)||args.length>8) return reply({},400);
    const result=await sql.begin(async tx=>{
      const [identity]=await tx`select provider_id from auth.identities where provider='kakao' and user_id=${id}::uuid`;
      if(!identity || !/^\d+$/.test(identity.provider_id)) throw Error('카카오 계정 연결을 확인해 주세요.');
      if(action==='searchDeparturePorts'){
        const [state]=await tx`select tables from baba_migration.club_state where singleton`;
        return await runClub(state.tables,identity.provider_id,action,args);
      }
      const [state]=await tx`select tables from baba_migration.club_state where singleton for update`;
      if(!state)throw Error('운영 사본을 준비해 주세요.');
      if(action==='babaGameLaunch'){
        const member=state.tables.Members.find(m=>String(m.kakaoId)===identity.provider_id);
        if(!member||member.status!=='active') throw Error('운영진 가입 승인 후 이용할 수 있습니다.');
        const ticket='club1_'+(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-','');
        await tx`delete from baba_migration.game_launch_tickets where expires_at<=now()`;
        await tx`insert into baba_migration.game_launch_tickets(ticket_hash,member_id,expires_at)
          values(sha256(convert_to(${ticket},'UTF8')),${String(member.id)},now()+interval '5 minutes')`;
        return {url:'https://lee36848759-hub.github.io/baba-fishing-game/#launch='+ticket};
      }
      const previous=JSON.stringify(state.tables);
      const result=await runClub(state.tables,identity.provider_id,action,args);
      if(JSON.stringify(state.tables)!==previous) await tx`update baba_migration.club_state set tables=${tx.json(state.tables)} where singleton`;
      return result??null;
    });
    return reply({result});
  } catch(e) {
    return reply({error:e.code?'데이터베이스 연결과 이전 상태를 확인해 주세요.':String(e.message||e)},400);
  }
});
