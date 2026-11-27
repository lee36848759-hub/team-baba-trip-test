import postgres from 'npm:postgres@3.4.5';
import push from 'npm:web-push@3.6.7';

const sql = postgres(Deno.env.get('SUPABASE_DB_URL')!, {prepare:false,max:2});
const origin = 'https://lee36848759-hub.github.io';
const site = origin+'/team-baba-trip-test/';
const headers = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type','Cache-Control':'no-store'};
const reply = (value:unknown,status=200)=>Response.json(value,{status,headers});

async function keys(){
  return await sql.begin(async tx=>{
    const [row]=await tx`select vapid from baba_migration.push_config for update`;
    if(row.vapid)return row.vapid;
    const pair=push.generateVAPIDKeys();
    await tx`update baba_migration.push_config set vapid=${tx.json(pair)}`;
    return pair;
  });
}

async function deliver(){
  const pair=await keys();
  const jobs=await sql`with batch as (
    select id from baba_migration.push_jobs where due<=now() order by id limit 30 for update skip locked
  ) update baba_migration.push_jobs j set due=now()+interval '2 minutes',attempts=attempts+1
    from batch,baba_migration.push_devices d where j.id=batch.id and j.device_id=d.id
    returning j.*,d.subscription,d.member_id`;
  await Promise.all(jobs.map(async j=>{
    try{
      const [eligible]=await sql`select 1 from baba_migration.club_state s,
        jsonb_array_elements(s.tables->'Trips') t,jsonb_array_elements(s.tables->'Members') m
        where t->>'id'=${j.trip_id} and baba_migration.trip_creator(t,s.tables)=${j.member_id} and t->>'status'<>'deleted'
        and m->>'id'=${j.member_id} and m->>'status'='active'`;
      if(eligible)await push.sendNotification(j.subscription,JSON.stringify({id:String(j.id),trip:j.trip_id,title:j.title,body:j.body}),{
        TTL:3600,timeout:8000,vapidDetails:{subject:site,...pair}
      });
      await sql`delete from baba_migration.push_jobs where id=${j.id}`;
    }catch(e){
      if([404,410].includes(e.statusCode))await sql`delete from baba_migration.push_devices where id=${j.device_id}`;
      else if(j.attempts>=8)await sql`delete from baba_migration.push_jobs where id=${j.id}`;
    }
  }));
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS')return new Response(null,{headers});
  if(req.method!=='POST')return reply({},405);
  try{
    const {action,subscription,endpoint}=await req.json();
    if(action==='deliver'){
      const secret=req.headers.get('x-baba-worker');
      if(!secret || !(await sql`select 1 from baba_migration.push_config where worker_secret=${secret}`).length)return reply({},403);
      await deliver();return reply({ok:true});
    }
    const authorization=req.headers.get('authorization')||'';
    if(!authorization.startsWith('Bearer '))return reply({},401);
    const auth=await fetch(Deno.env.get('SUPABASE_URL')+'/auth/v1/user',{headers:{authorization,apikey:Deno.env.get('SUPABASE_ANON_KEY')!}});
    if(!auth.ok)return reply({},401);
    const {id}=await auth.json();
    const [member]=await sql`select m->>'id' id from auth.identities i,baba_migration.club_state s,
      jsonb_array_elements(s.tables->'Members') m where i.user_id=${id}::uuid and i.provider='kakao'
      and i.provider_id=m->>'kakaoId' and m->>'status'='active'`;
    if(!member)return reply({},403);
    if(action==='key')return reply({key:(await keys()).publicKey});
    if(action==='off'){
      await sql`delete from baba_migration.push_devices where member_id=${member.id} and endpoint=${endpoint}`;
      return reply({ok:true});
    }
    if(action==='status')return reply({enabled:!!(await sql`select 1 from baba_migration.push_devices where member_id=${member.id} and endpoint=${endpoint}`).length});
    if(action!=='on')return reply({},400);
    const url=new URL(subscription.endpoint);
    if(url.protocol!=='https:' || url.port || url.username || url.password || !/^(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com|([a-z0-9-]+\.)*notify\.windows\.com)$/.test(url.hostname)
      || !/^[\w-]{87}$/.test(subscription.keys?.p256dh) || !/^[\w-]{22}$/.test(subscription.keys?.auth))return reply({error:'지원하지 않는 알림 구독입니다.'},400);
    const sub={endpoint:url.href,keys:{p256dh:subscription.keys.p256dh,auth:subscription.keys.auth}};
    const saved=await sql`insert into baba_migration.push_devices(member_id,endpoint,subscription) values(${member.id},${url.href},${sql.json(sub)})
      on conflict(endpoint) do update set subscription=excluded.subscription where push_devices.member_id=excluded.member_id returning id`;
    return saved.length?reply({ok:true}):reply({error:'기존 알림 구독을 해제하고 다시 켜 주세요.'},409);
  }catch{return reply({error:'알림 처리 중 오류가 발생했습니다.'},500)}
});
