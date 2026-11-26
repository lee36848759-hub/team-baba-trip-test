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
      const [state]=await tx`select tables from baba_migration.club_state where singleton for update`;
      if(!state)throw Error('운영 사본을 준비해 주세요.');
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
