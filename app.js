const $=id=>document.getElementById(id);
const message=t=>$('msg').textContent=t;
const labels={pending:'승인 대기',waitlist:'자리 대기',confirmed:'확정'};
const cacheKey='baba-test-schedule-v1';
let db,user;
function element(tag,value){const n=document.createElement(tag);n.textContent=value;return n}
function button(parent,label,fn){
 const b=element('button',label);parent.append(b);
 b.onclick=async()=>{b.disabled=true;try{await fn()}catch(e){message(e.message)}finally{b.disabled=false}};
}
function draw(rows,time,live){
 $('trips').replaceChildren();$('stamp').textContent='마지막 확인 '+new Date(time).toLocaleString('ko-KR');
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul'}).format(new Date());
 const upcoming=rows.filter(r=>r.ends>=today);
 for(const r of upcoming){
  const box=element('article','');box.append(element('h3',r.title),element('p',r.starts+' ~ '+r.ends),element('p','잔여 '+r.free+'석 / 정원 '+r.capacity+'명'));
  if(live){const count=element('input','');count.type='number';count.min=1;count.max=r.capacity;count.value=1;count.setAttribute('aria-label','신청 인원');box.append(count);
   button(box,'신청',async()=>{const seats=count.valueAsNumber;if(!count.reportValidity()||!Number.isInteger(seats))return;
   const k='baba-request:'+user.id+':'+r.id+':'+seats;
   const req=sessionStorage.getItem(k)||crypto.randomUUID();sessionStorage.setItem(k,req);
   await rpc('apply',{p_trip:r.id,p_seats:seats,p_request:req});sessionStorage.removeItem(k);message('신청을 접수했습니다. 아래에서 결과를 확인하세요.');await refresh()})}
  $('trips').append(box)
 }
 if(!upcoming.length)$('trips').append(element('p','예정된 출조가 없습니다.'));
}
async function rpc(name,args={}){const {data,error}=await db.rpc('baba_'+name,args);if(error)throw error;return data}
async function refresh(){
 const rows=await rpc('schedule');const time=Date.now();draw(rows,time,true);
 localStorage.setItem(cacheKey,JSON.stringify({rows,time,owner:user.id}));
 const entries=await rpc('entries');$('entries').replaceChildren(element('h2','신청 내역'));
 for(const e of entries){const box=element('article',e.title+' · '+e.nickname+' · '+e.seats+'명 · '+labels[e.status]);
 if(e.can_approve)button(box,'승인',async()=>{await rpc('approve',{p_id:e.id});await refresh()});$('entries').append(box)}
}
async function start(){
 if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 if(!BABA.url||!BABA.key){message('테스트 서버 연결 전입니다. config.js에 테스트 프로젝트 주소와 공개 키를 설정해 주세요.');return}
 const authKey='baba-test-auth';const session=JSON.parse(localStorage.getItem(authKey)||'null');
 const cached=JSON.parse(localStorage.getItem(cacheKey)||'null');
 if(cached&&session?.user.id===cached.owner&&session.expires_at*1000>Date.now())draw(cached.rows,cached.time,false);
 const {createClient}=await import('https://esm.sh/@supabase/supabase-js@2.49.4');
 const url=new URL(location.href);
 const fragment=new URLSearchParams(url.hash.slice(1));
 const field=name=>url.searchParams.get(name)||fragment.get(name);
 const authCode=field('code');
 const failure=field('error_code')||field('error');
 const description=field('error_description')||'';
 if(authCode||failure)history.replaceState(history.state,'',location.pathname);
 db=createClient(BABA.url,BABA.key,{auth:{storageKey:authKey,flowType:'pkce',detectSessionInUrl:false}});
 const pendingKey='baba-kakao-login-started';
 const returning=sessionStorage.getItem(pendingKey);
 sessionStorage.removeItem(pendingKey);
 let notice='';
 if(failure){
  const safeCode=/^[a-zA-Z0-9_-]{1,64}$/.test(failure)?failure:'provider_error';
  notice='카카오 인증 실패 ('+safeCode+'). ';
  if(/external.*token|provider.*token/i.test(description))notice+='Supabase의 Kakao REST API Key와 Client Secret Code를 확인해 주세요.';
  else if(/email/i.test(description))notice+='카카오 이메일 동의와 Supabase 이메일 설정을 확인해 주세요.';
  else notice+='Supabase 인증 로그에서 같은 시각의 오류를 확인해 주세요.';
 }else if(authCode){
  const result=await db.auth.exchangeCodeForSession(authCode);
  if(result.error)notice='로그인 세션 교환 실패 ('+(result.error.code||'exchange_failed')+'). 로그인을 시작한 브라우저에서 다시 시도해 주세요.';
 }
 const {data,error}=await db.auth.getSession();if(error)throw error;user=data.session?.user;
 if(!notice&&returning&&!user)notice='로그인 세션을 확인할 수 없습니다. 인증 결과가 이 주소로 돌아왔는지 Supabase 인증 로그를 확인해 주세요.';
 if(notice)message(notice);
 db.auth.onAuthStateChange((event,s)=>{if((s?.user?.id||null)!==(user?.id||null)){localStorage.removeItem(cacheKey);location.reload()}});
 if(!user){
  localStorage.removeItem(cacheKey);
  button($('actions'),'카카오 로그인',async()=>{
   sessionStorage.setItem(pendingKey,'1');
   const {error}=await db.auth.signInWithOAuth({provider:'kakao',options:{redirectTo:location.origin+location.pathname}});
   if(error){sessionStorage.removeItem(pendingKey);throw error}
  });
  return;
 }
 button($('actions'),'새로고침',refresh);
 button($('actions'),'로그아웃',async()=>{localStorage.removeItem(cacheKey);const {error}=await db.auth.signOut({scope:'local'});if(error)throw error;location.reload()});
 button($('actions'),'가입 신청',async()=>{const name=prompt('팀바바에서 사용할 닉네임');if(name){await rpc('join',{p_nickname:name});message('가입 정보를 접수했습니다. 운영진 승인 후 신청할 수 있습니다.')}});
 await refresh()
}
start().catch(e=>message('연결을 확인해 주세요. '+e.message));
