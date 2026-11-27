import { createHmac } from 'node:crypto';
import { Buffer } from 'node:buffer';

export async function runClub(tables, kakaoId, action, args) {
 const Logger=console;
 const PropertiesService={getScriptProperties:()=>({getProperty:key=>Deno.env.get(key)})};
 const Utilities={
   getUuid:()=>crypto.randomUUID(),
   formatDate:(date,zone)=>new Intl.DateTimeFormat('sv-SE',{timeZone:zone}).format(date),
   Charset:{UTF_8:'utf8'},
   base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url'),
   computeHmacSha256Signature:(value,key)=>createHmac('sha256',key).update(value).digest()
 };
 const SpreadsheetApp={flush(){}};
 const uid_=()=>crypto.randomUUID();
 const locked_=fn=>fn(); // The caller holds the PostgreSQL transaction lock.
 const rows_=name=>(tables[name]||[]).map((r,i)=>({...r,_row:i+2}));
 const add_=(name,obj)=>{tables[name].push({...obj});return obj};
 const patch_=(name,row,obj)=>Object.assign(tables[name][row-2],obj);
 const ss_=()=>({getSheetByName:sheet_});
 function sheet_(name){
   const fields=DB[name], rows=tables[name];
   return {
     getLastRow:()=>rows.length+1,getLastColumn:()=>fields.length,getMaxColumns:()=>fields.length,
     deleteRow:r=>rows.splice(r-2,1),
     getRange(r,c,h=1,w=1){
       const read=(i,j)=>i===1?fields[j-1]:rows[i-2]?.[fields[j-1]]??'';
       const write=(i,j,value)=>{
         if(i===1){if(fields[j-1]!==value)throw Error('열 구성 오류');return}
         if(i===rows.length+2)rows.push({});
         rows[i-2][fields[j-1]]=value;
       };
       return {getValue:()=>read(r,c),getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>read(r+i,c+j))),
         setValue:v=>write(r,c,v),setValues:matrix=>matrix.forEach((line,i)=>line.forEach((v,j)=>write(r+i,c+j,v)))};
     }
   };
 }
 function auth_(){
   const hits=rows_('Members').filter(m=>String(m.kakaoId)===kakaoId);
   if(hits.length>1)throw Error('회원 식별값이 중복되었습니다.');
   let m=hits[0];
   if(!m&&['data','babaQuickStart'].includes(action)){
     const id=uid_();
     add_('Members',{id,nickname:'가입대기_'+id.slice(0,6),role:'member',status:'pending',createdAt:now_(),unpaidCount:0,kakaoId});
     audit_(id,'KAKAO_SIGNUP','Members',id,'승인 대기');
     m=rows_('Members').at(-1);
   }
   if(m && ['data','babaQuickStart'].includes(action) && ['deleted','inactive'].includes(m.status)){
     patch_('Members',m._row,{role:'member',status:'pending'});
     audit_(m.id,'KAKAO_REAPPLY','Members',m.id,'재가입 승인 대기');
     m=rows_('Members')[m._row-2];
   }
   if(!m||!['active','pending'].includes(m.status))throw Error('회원 상태를 확인해 주세요.');
   return m;
 }
 const authWithBook_=auth_;
 async function kakaoPortSearch_(keyword){
   const key=Deno.env.get('KAKAO_REST_API_KEY');
   if(!key)return [];
   async function lookup(kind){
     const res=await fetch('https://dapi.kakao.com/v2/local/search/'+kind+'.json?size=15&query='+encodeURIComponent(keyword),{headers:{Authorization:'KakaoAK '+key},signal:AbortSignal.timeout(3500)});
     if(!res.ok)return [];
     return (await res.json()).documents.map(p=>kind==='keyword'
       ? {name:p.place_name,address:p.road_address_name||p.address_name,placeId:p.id,source:'kakao',lat:Number(p.y),lng:Number(p.x),query:keyword}
       : {name:p.road_address?.address_name||p.address_name,address:p.address_name,source:'address',lat:Number(p.y),lng:Number(p.x),query:keyword});
   }
   const responses=await Promise.allSettled([lookup('keyword'),lookup('address')]);
   return responses.flatMap(r=>r.status==='fulfilled'?r.value:[]).filter(p=>p.name&&p.address);

 }

const DB = {
 Members:['id','nickname','phoneLast4','role','status','salt','passwordHash','failed','lockedUntil','createdAt','unpaidCount','restrictedUntil','kakaoId'],
 Trips:['id','date','title','boat','fee','capacity','status','notes','paymentNoticeAt','createdAt','creatorId','creatorNickname','tide','departurePort','portAddress','portLat','portLng','endDate'],
 Registrations:['id','tripId','memberId','displayName','seats','status','createdAt','updatedAt','legacyNote'],
 Payments:['id','registrationId','expected','received','status','confirmedAt','confirmedBy','note'],
 Transfers:['id','registrationId','toMemberId','status','requestedAt','decidedAt','decidedBy','note','seats'],
 Sessions:['tokenHash','memberId','expiresAt','createdAt'],
 Audit:['timestamp','actorId','action','entity','entityId','detail']
};

const TZ='Asia/Seoul', SESSION_DAYS=7;

const BABA_PORTS_ = [["인천항","인천"],["연안부두","인천"],["남항","인천"],["소래포구","인천"],["영흥도 진두항","인천"],["선재항","인천"],["장봉항","인천"],["덕적도 진리항","인천"],["백령도 용기포항","인천"],["대청도 선진포항","인천"],["대명항","경기"],["전곡항","경기"],["궁평항","경기"],["탄도항","경기"],["제부항","경기"],["오이도항","경기"],["방아머리항","경기"],["풍도항","경기"],["오천항","충남"],["대천항","충남"],["무창포항","충남"],["홍원항","충남"],["서천 마량항","충남"],["안흥항","충남"],["신진항","충남"],["모항","충남"],["백사장항","충남"],["남당항","충남"],["장고항","충남"],["왜목항","충남"],["삼길포항","충남"],["격렬비열도","충남"],["군산항","전북"],["비응항","전북"],["야미도항","전북"],["선유도항","전북"],["격포항","전북"],["위도항","전북"],["곰소항","전북"],["구시포항","전북"],["목포항","전남"],["북항","전남"],["진도 서망항","전남"],["진도 팽목항","전남"],["진도 쉬미항","전남"],["완도항","전남"],["화흥포항","전남"],["청산도 도청항","전남"],["고금항","전남"],["마량항","전남"],["녹동항","전남"],["나로도항","전남"],["축정항","전남"],["여수 국동항","전남"],["여수 신월항","전남"],["돌산항","전남"],["소호항","전남"],["백야항","전남"],["광양항","전남"],["율촌항","전남"],["고흥 풍남항","전남"],["고흥 발포항","전남"],["고흥 용동항","전남"],["해남 땅끝항","전남"],["해남 어란진항","전남"],["강진 마량항","전남"],["보성 회천항","전남"],["신안 송공항","전남"],["신안 지도항","전남"],["흑산도 예리항","전남"],["통영항","경남"],["통영 삼덕항","경남"],["통영 중화항","경남"],["통영 미수항","경남"],["통영 산양항","경남"],["거제 장승포항","경남"],["거제 지세포항","경남"],["거제 구조라항","경남"],["거제 대포항","경남"],["거제 능포항","경남"],["거제 옥포항","경남"],["거제 외포항","경남"],["거제 가배항","경남"],["거제 다대항","경남"],["남해 미조항","경남"],["남해 물건항","경남"],["남해 노량항","경남"],["남해 창선항","경남"],["사천 삼천포항","경남"],["사천 팔포항","경남"],["사천 신수항","경남"],["고성 맥전포항","경남"],["고성 당항포항","경남"],["창원 진해항","경남"],["창원 속천항","경남"],["창원 명동항","경남"],["창원 구산항","경남"],["부산항","부산"],["부산 남항","부산"],["다대포항","부산"],["감천항","부산"],["기장 대변항","부산"],["기장 학리항","부산"],["기장 칠암항","부산"],["기장 월내항","부산"],["송정항","부산"],["청사포항","부산"],["울산항","울산"],["방어진항","울산"],["정자항","울산"],["주전항","울산"],["당사항","울산"],["강동항","울산"],["포항 구룡포항","경북"],["포항 영일만항","경북"],["포항 양포항","경북"],["포항 호미곶항","경북"],["포항 신항","경북"],["경주 감포항","경북"],["경주 전촌항","경북"],["영덕 강구항","경북"],["영덕 축산항","경북"],["영덕 대진항","경북"],["울진 후포항","경북"],["울진 죽변항","경북"],["울진 오산항","경북"],["삼척항","강원"],["장호항","강원"],["임원항","강원"],["덕산항","강원"],["동해 묵호항","강원"],["동해항","강원"],["강릉항","강원"],["강릉 주문진항","강원"],["사천진항","강원"],["양양 수산항","강원"],["양양 남애항","강원"],["속초항","강원"],["속초 대포항","강원"],["고성 거진항","강원"],["고성 아야진항","강원"],["고성 공현진항","강원"],["고성 대진항","강원"],["제주항","제주"],["도두항","제주"],["애월항","제주"],["한림항","제주"],["협재항","제주"],["모슬포항","제주"],["화순항","제주"],["서귀포항","제주"],["위미항","제주"],["성산포항","제주"],["종달항","제주"],["김녕항","제주"],["세화항","제주"],["조천항","제주"],["추자항","제주"],["우도 천진항","제주"],["우도 하우목동항","제주"]];

function data(token, deferRanking){
 const started=Date.now(), marks=[];
 const mark=(name)=>marks.push(name+'='+((Date.now()-started)/1000).toFixed(3)+'s');
 const m=auth_(token),isAdmin=['admin','staff'].includes(m.role);mark('auth');
 // 한 요청에서 시트별 조회를 한 번으로 통합합니다. 신청/승인 데이터는 서버 캐시하지 않습니다.
 const book=ss_();mark('openSheet');
 const tripRows=rows_('Trips',book);mark('trips');
 const all=rows_('Registrations',book);mark('registrations');
 const transferRows=rows_('Transfers',book);mark('transfers');
 const membersRows=rows_('Members',book);mark('members');
 // 등록자 정보가 없는 과거 출조가 있을 때만 감사 기록을 읽습니다.
 const needsLegacyCreator=tripRows.some(t=>t.status!=='deleted'&&(!String(t.creatorId||'').trim()||!String(t.creatorNickname||'').trim()));
 const audits=needsLegacyCreator?rows_('Audit',book):[];mark('audit');
 const creatorAudit=new Map();
 for(const a of audits){if(a.action!=='CREATE_TRIP'||a.entity!=='Trips')continue;
  const match=String(a.detail||'').match(/^등록자:\s*(.*?)\s*\//);
  creatorAudit.set(String(a.entityId),{id:String(a.actorId||''),nickname:match?match[1].trim():''});}
 const counts=new Map(),regById=new Map(),memberById=new Map();
 for(const x of membersRows)memberById.set(String(x.id),x);
 for(const r of all){regById.set(String(r.id),r);const key=String(r.tripId);let c=counts.get(key);if(!c){c={filled:0,waiting:0};counts.set(key,c)}
  if(['confirmed','pending','cancel_requested'].includes(r.status))c.filled+=Number(r.seats||1);
  if(r.status==='waitlist')c.waiting++;}
 const trips=tripRows.filter(t=>t.status!=='deleted').map(t=>{const legacy=creatorAudit.get(String(t.id))||{},c=counts.get(String(t.id))||{filled:0,waiting:0};return {
  id:t.id,date:date_(t.date),endDate:date_(t.endDate||t.date),title:t.title,boat:t.boat,fee:Number(t.fee||0),capacity:Number(t.capacity||0),status:t.status,notes:t.notes,
  creatorId:String(t.creatorId||legacy.id||''),creatorNickname:String(t.creatorNickname||legacy.nickname||''),tide:String(t.tide||''),departurePort:String(t.departurePort||''),portAddress:String(t.portAddress||''),portLat:t.portLat===''?'':Number(t.portLat),portLng:t.portLng===''?'':Number(t.portLng),filled:c.filled,waiting:c.waiting};});
 const tripIds=new Set(trips.map(t=>String(t.id)));
 const regs=all.filter(r=>isAdmin||r.memberId===m.id||(tripIds.has(String(r.tripId))&&['confirmed','pending','cancel_requested','waitlist','cancelled'].includes(r.status)))
  .map(r=>({id:r.id,tripId:r.tripId,memberId:r.memberId,displayName:r.displayName,seats:Number(r.seats||1),status:r.status,createdAt:date_(r.createdAt),queueOrder:r._row,legacyNote:r.legacyNote}));
 if(m.status==='pending')regs.length=0;
 const transferHistory=transferRows.filter(x=>x.status==='approved').map(x=>{const source=regById.get(String(x.registrationId)),receiver=memberById.get(String(x.toMemberId));return {id:x.id,tripId:source?String(source.tripId):'',registrationId:String(x.registrationId),fromNickname:source?String(source.displayName):'',toNickname:receiver?String(receiver.nickname):'회원 확인 필요',seats:Number(x.seats)||0,decidedAt:date_(x.decidedAt)}}).filter(x=>tripIds.has(x.tripId));
 const today=babaTodayKst_(),rankingYear=Number(today.slice(0,4));
 const ranking=deferRanking?null:babaRanking_(rankingYear,{trips:tripRows,registrations:all,members:membersRows});
 const myRanking=ranking?ranking.find(x=>x.id===String(m.id)):null;mark(deferRanking?'rankingDeferred':'ranking');
 mark('response');console.log('[BABA_INITIAL_DATA] '+marks.join(' | '));
 return JSON.parse(JSON.stringify({profile:profile_(m),todayKst:today,trips,regs,payments:[],rankingYear,transferHistory,rankingTop:ranking?ranking.slice(0,10).map(({nickname,count,rank})=>({nickname,count,rank})):null,myRanking:myRanking?{rank:myRanking.rank,count:myRanking.count}:null,members:isAdmin?membersRows.map(x=>({id:x.id,nickname:x.nickname,role:x.role,status:x.status,unpaidCount:Number(x.unpaidCount||0),restrictedUntil:x.restrictedUntil||''})):[]}));
}

function date_(v){if(v instanceof Date)return Utilities.formatDate(v,TZ,'yyyy-MM-dd');return String(v||'').slice(0,10)}

function babaTodayKst_(){return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd')}

function babaRanking_(year,preloaded){
  year=Number(year||babaTodayKst_().slice(0,4));
  if(!Number.isInteger(year)||year<2000||year>2100)fail_('조회 연도가 올바르지 않습니다.');
  const yearStart=Date.UTC(year,0,1),yearEnd=Date.UTC(year+1,0,1);
  const daysByTrip=new Map();
  // 출조왕은 승인된 실제 참가 좌석이 3명 이상인 일정만 인정합니다.
  // 취소 승인 대기는 아직 좌석이 유지되므로 포함하며, 승인 대기/대기/취소는 제외합니다.
  const actualSeatsByTrip=new Map();
  (preloaded?.registrations||rows_('Registrations')).forEach(r=>{
    if(!['confirmed','cancel_requested'].includes(String(r.status)))return;
    const key=String(r.tripId);
    actualSeatsByTrip.set(key,(actualSeatsByTrip.get(key)||0)+Number(r.seats||1));
  });
  (preloaded?.trips||rows_('Trips')).forEach(t=>{
    if((actualSeatsByTrip.get(String(t.id))||0)<=2)return;
    if(t.status==='deleted')return;
    const start=date_(t.date),end=date_(t.endDate||t.date);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end))return;
    const from=Date.parse(start+'T00:00:00Z'),to=Date.parse(end+'T00:00:00Z');
    if(!Number.isFinite(from)||!Number.isFinite(to)||to<from)return;
    const overlapStart=Math.max(from,yearStart),overlapEnd=Math.min(to+86400000,yearEnd);
    const days=Math.max(0,Math.round((overlapEnd-overlapStart)/86400000));
    if(days)daysByTrip.set(String(t.id),days);
  });
  const members=(preloaded?.members||rows_('Members')).filter(m=>m.status==='active');
  const counted=new Map(), firstApplied=new Map();
  (preloaded?.registrations||rows_('Registrations')).forEach(r=>{
    const tripId=String(r.tripId),id=String(r.memberId||'');
    if(!id||!daysByTrip.has(tripId)||!['pending','confirmed','cancel_requested'].includes(String(r.status)))return;
    if(!counted.has(id))counted.set(id,new Set());
    counted.get(id).add(tripId);
    // 동점자는 집계 대상 출조에 가장 먼저 신청한 순서로 표시합니다.
    // 날짜가 같은 경우 시트의 원본 행 순서를 사용합니다.
    const raw=r.createdAt instanceof Date?r.createdAt.getTime():Date.parse(String(r.createdAt||''));
    const appliedAt=Number.isFinite(raw)?raw:Number.MAX_SAFE_INTEGER;
    const order=Number(r._row||Number.MAX_SAFE_INTEGER);
    const prev=firstApplied.get(id);
    if(!prev||appliedAt<prev.at||(appliedAt===prev.at&&order<prev.order))firstApplied.set(id,{at:appliedAt,order});
  });
  const ranked=members.map(m=>({id:String(m.id),nickname:String(m.nickname||''),count:[...(counted.get(String(m.id))||[])].reduce((sum,id)=>sum+daysByTrip.get(id),0)}))
    .filter(x=>x.count>0).sort((a,b)=>b.count-a.count||(firstApplied.get(a.id)?.at??Number.MAX_SAFE_INTEGER)-(firstApplied.get(b.id)?.at??Number.MAX_SAFE_INTEGER)||(firstApplied.get(a.id)?.order??Number.MAX_SAFE_INTEGER)-(firstApplied.get(b.id)?.order??Number.MAX_SAFE_INTEGER)||a.nickname.localeCompare(b.nickname,'ko')||a.id.localeCompare(b.id));
  let previous=-1,rank=0;
  ranked.forEach((x,i)=>{if(x.count!==previous){rank=i+1;previous=x.count;}x.rank=rank;});
  return ranked;
}

function fail_(msg){throw Error(msg)}

function profile_(m){return {id:m.id,nickname:m.nickname,role:m.role,status:m.status,unpaidCount:Number(m.unpaidCount||0),restrictedUntil:m.restrictedUntil||''}}

function babaQuickStart(token){
 const m=auth_(token);
 return {profile:profile_(m),todayKst:babaTodayKst_()};
}

function getBabaRankingByYear(token,year){
  const member=auth_(token);
  const y=Number(year);
  const ranked=babaRanking_(y);
  const own=ranked.find(x=>x.id===String(member.id));
  return {year:y,top:ranked.slice(0,10).map(({nickname,count,rank})=>({nickname,count,rank})),myRanking:own?{rank:own.rank,count:own.count}:null};
}

function searchBabaRanking(token,keyword,year){
  auth_(token);
  keyword=String(keyword||'').trim().toLocaleLowerCase('ko-KR');
  if(keyword.length<1||keyword.length>30)fail_('닉네임을 1~30자로 입력해 주세요.');
  return babaRanking_(year).filter(x=>x.nickname.toLocaleLowerCase('ko-KR').includes(keyword))
    .slice(0,30).map(({nickname,count,rank})=>({nickname,count,rank}));
}

async function searchDeparturePorts(token,keyword){
  auth_(token);
  keyword=String(keyword||'').trim();
  if(keyword.length<1||keyword.length>40)fail_('출항지 검색어는 1~40자로 입력하세요.');
  try{
    const results=await kakaoPortSearch_(keyword);
    if(results.length)return [...results,...fallbackPortSearch_(keyword).filter(p=>!results.some(r=>r.name===p.name))];
  }catch(e){Logger.log('Kakao Local search failed: '+e.message)}
  return fallbackPortSearch_(keyword);
}

function fallbackPortSearch_(keyword){
  const normalized=String(keyword).toLowerCase().replace(/\s+/g,'');
  return BABA_PORTS_.filter(([name,region])=>(name+region).toLowerCase().replace(/\s+/g,'').includes(normalized) || keyword.trim().split(/\s+/).every(word=>(region+name).includes(word)))
    .slice(0,40).map(([name,region])=>({name,address:region+' · 등록된 출항지',lat:'',lng:'',source:'legacy'}));
}

function createTrip(token,item){active_(auth_(token));return locked_(async()=>{
  const m=auth_(token);active_(m);
  const date=String(item.date||'');
  if(!/^20\d\d-\d\d-\d\d$/.test(date)||isNaN(Date.parse(date))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)fail_('날짜 형식 오류');
  if(date<babaTodayKst_())fail_('지난 날짜로 출조를 등록할 수 없습니다.');
  const endDate=String(item.endDate||date).trim();
  if(!babaValidTripDate_(endDate)||endDate<date)fail_('종료일은 출조 시작일과 같거나 이후여야 합니다.');
  const title=String(item.title||'').trim().slice(0,100),boat=String(item.boat||'').trim().slice(0,100);
  const capacity=Number(item.capacity),fee=Number(item.fee);
  // 이전 화면에서는 extraSeats가 전달되지 않으므로 기본값 0명으로 처리합니다.
  const extraSeats=item.extraSeats===undefined?0:Number(item.extraSeats);
  if(!title||!Number.isInteger(capacity)||capacity<2||capacity>100||!Number.isInteger(fee)||fee<0)fail_('일정 정보를 확인하세요.');
  if(!Number.isInteger(extraSeats)||extraSeats<0||extraSeats>=capacity)fail_('추가 인원은 0명부터 모집 정원에서 본인을 제외한 인원까지 입력하세요.');
  const totalSeats=1+extraSeats;
  if(totalSeats>capacity)fail_('본인과 동반 인원이 모집 정원을 초과합니다.');
  ensureTripCreatorColumns_();ensureTripTideColumn_();ensureTripPortColumns_();ensureTripEndDateColumn_();
  const port=await validatePort_(item.port);
  const id=uid_();
  add_('Trips',{id,date,endDate,title,boat,fee,capacity,status:'open',notes:String(item.notes||'').slice(0,500),createdAt:now_(),creatorId:m.id,creatorNickname:m.nickname,tide:'',...port});
  const registrationId=uid_(),created=now_();
  add_('Registrations',{id:registrationId,tripId:id,memberId:m.id,displayName:m.nickname,seats:totalSeats,status:'confirmed',createdAt:created,updatedAt:created});
  audit_(m.id,'CREATE_TRIP','Trips',id,'등록자: '+m.nickname+' / '+title);
  audit_(m.id,'REGISTER','Registrations',registrationId,'출조 등록자 및 동반 인원 자동 확정 '+totalSeats+'명');
  return id;
})}

function active_(m){if(m.status!=='active')fail_('운영진 가입 승인 후 이용할 수 있습니다.')}

function babaValidTripDate_(value){const d=String(value||'').trim();return /^20\d{2}-\d{2}-\d{2}$/.test(d)&&!isNaN(Date.parse(d))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d}

function ensureTripCreatorColumns_(){
  const sh=sheet_('Trips');
  const headers=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  const expected=DB.Trips;
  for(let i=0;i<expected.indexOf('creatorId');i++){
    if(headers[i]!==expected[i])fail_('Trips 시트 열 구성이 예상과 다릅니다. 기존 데이터 보호를 위해 등록을 중단합니다.');
  }
  for(const field of ['creatorId','creatorNickname']){
    const col=expected.indexOf(field)+1;
    if(headers[col-1] && headers[col-1]!==field)fail_('Trips 등록자 열 위치가 다릅니다.');
    if(sh.getMaxColumns()<col)sh.insertColumnsAfter(sh.getMaxColumns(),col-sh.getMaxColumns());
    sh.getRange(1,col).setValue(field);
  }
}

function ensureTripTideColumn_(){
  const sh=sheet_('Trips');
  const headers=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),1)).getValues()[0].map(String);
  const col=DB.Trips.indexOf('tide')+1;
  if(headers[col-1] && headers[col-1]!=='tide')fail_('Trips 물때 열 위치가 예상과 다릅니다.');
  if(sh.getMaxColumns()<col)sh.insertColumnsAfter(sh.getMaxColumns(),col-sh.getMaxColumns());
  sh.getRange(1,col).setValue('tide');
}

function ensureTripPortColumns_(){
  const sh=sheet_('Trips');
  const header=sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(String);
  for(const field of ['departurePort','portAddress','portLat','portLng']){
    const i=DB.Trips.indexOf(field);
    if(header[i]&&header[i]!==field)fail_('Trips 시트 '+field+' 열 위치가 예상과 달라 작업을 중단했습니다.');
    if(sh.getMaxColumns()<i+1)sh.insertColumnsAfter(sh.getMaxColumns(),i+1-sh.getMaxColumns());
    sh.getRange(1,i+1).setValue(field);
  }
}

function ensureTripEndDateColumn_(){const sh=sheet_('Trips'),h=sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];if(!h.includes('endDate'))sh.getRange(1,h.length+1).setValue('endDate')}

async function validatePort_(obj){
  const name=String(obj?.name||'').trim();
  if(!name||name.length>100)fail_('출항지를 검색하여 선택해 주세요.');
  if(obj?.source==='manual'){
    const address=String(obj.address||'').trim();
    if(address.length>200)fail_('주소는 200자 이내로 입력해 주세요.');
    return {departurePort:name,portAddress:address,portLat:'',portLng:''};
  }
  if((obj?.source==='kakao'&&obj?.placeId)||obj?.source==='address'){
    // 브라우저에서 전달한 장소 정보는 신뢰하지 않고 카카오 API에서 다시 확인합니다.
    const found=await kakaoPortSearch_(String(obj.query||name).slice(0,100));
    if(!found)fail_('카카오 장소 확인에 실패했습니다. API 설정을 확인해 주세요.');
    const match=found.find(p=>obj.source==='address'?p.source==='address'&&p.address===obj.address:p.source==='kakao'&&p.placeId===String(obj.placeId));
    if(!match)fail_('선택한 장소를 다시 확인할 수 없습니다. 출항지를 재검색해 주세요.');
    return {departurePort:match.name,portAddress:match.address,portLat:match.lat,portLng:match.lng};
  }
  const match=BABA_PORTS_.find(([n,region])=>n===name&&(!obj?.address||String(obj.address).startsWith(region+' ·')));
  if(!match)fail_('출항지 검색 결과에서 장소를 선택해 주세요.');
  return {departurePort:name,portAddress:match[1]+' · 등록된 출항지',portLat:'',portLng:''};
}

function now_(){return new Date().toISOString()}

function audit_(actor,action,entity,id,detail){add_('Audit',{timestamp:now_(),actorId:actor,action,entity,entityId:id,detail:String(detail||'').slice(0,300)})}

function approve(token,registrationId){active_(auth_(token));return locked_(()=>{const m=auth_(token);const reg=rows_('Registrations').find(x=>String(x.id)===String(registrationId));const trip=reg&&rows_('Trips').find(x=>String(x.id)===String(reg.tripId));if(!canManageTripRegistrations_(m,trip))fail_('해당 출조의 신청 승인 권한이 없습니다.');if(!tripIsCurrent_(trip))fail_('지난 출조는 변경할 수 없습니다.');const r=rows_('Registrations').find(x=>x.id===registrationId);if(!r||r.status!=='pending')fail_('승인 가능한 신청이 아닙니다.');patch_('Registrations',r._row,{status:'confirmed',updatedAt:now_()});audit_(m.id,'APPROVE','Registrations',r.id,'');return true})}

function canManageTripRegistrations_(member,trip){
  return !!trip && trip.status!=='deleted' &&
    (['admin','staff'].includes(member.role) ||
    (!!String(trip.creatorId||'').trim() && String(trip.creatorId)===String(member.id)));
}

function tripIsCurrent_(trip){
  return !!trip && date_(trip.endDate||trip.date)>=Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd');
}

function decideCancellation(token, registrationId, accept) {active_(auth_(token));
  return locked_(() => {
    const m = auth_(token);
    if (typeof accept !== 'boolean') fail_('승인 여부가 올바르지 않습니다.');
    const r = rows_('Registrations').find(x => String(x.id) === String(registrationId));
    if (!r || r.status !== 'cancel_requested') fail_('처리 가능한 취소 요청이 없습니다.');
    const trip = rows_('Trips').find(t => String(t.id) === String(r.tripId));
    if (!canDecideCancellation_(m, trip)) fail_('해당 출조의 취소 요청 처리 권한이 없습니다.');
    const status = accept ? 'cancelled' : 'confirmed';
    patch_('Registrations', r._row, {status, updatedAt:now_()});
    audit_(m.id, accept?'CANCEL_APPROVE':'CANCEL_REJECT', 'Registrations', r.id,
      (['admin','staff'].includes(m.role)?'운영진':'출조 등록자') + (accept?' 취소 승인':' 취소 반려: 신청 확정 유지'));
    return {status, message:accept?'취소가 승인되었습니다.':'취소 요청이 반려되어 출조 확정이 유지됩니다.'};
  });
}

function canDecideCancellation_(m, trip) {
  if (['admin','staff'].includes(m.role)) return true;
  if (!trip || trip.status === 'deleted') return false;
  // 등록자 ID가 없거나 일치하지 않으면 권한을 부여하지 않습니다.
  return !!String(trip.creatorId || '').trim() && String(trip.creatorId) === String(m.id);
}

function promoteWaitlist(token, registrationId) {active_(auth_(token));
  return locked_(() => {
    const m = auth_(token);
    // 출조 등록자도 본인 출조의 대기자를 승인할 수 있습니다.

    const all = rows_('Registrations');
    const r = all.find(x =>
      String(x.id) === String(registrationId)
    );

    if (!r || r.status !== 'waitlist') {
      fail_('대기 상태의 신청만 확정할 수 있습니다.');
    }

    const t = rows_('Trips').find(x =>
      String(x.id) === String(r.tripId)
    );

    if (!t) fail_('출조 일정을 찾을 수 없습니다.');
    if (!canManageTripRegistrations_(m,t)) fail_('해당 출조의 대기 승인 권한이 없습니다.');
    if (!tripIsCurrent_(t)) fail_('지난 출조는 변경할 수 없습니다.');
    if (t.status === 'deleted') fail_('삭제된 출조는 대기자를 확정할 수 없습니다.');

    const seats = Number(r.seats || 1);

    if (!Number.isInteger(seats) || seats < 1) {
      fail_('신청 인원이 올바르지 않습니다.');
    }

    const booked = all
      .filter(x =>
        String(x.tripId) === String(t.id) &&
        ['confirmed', 'pending', 'cancel_requested'].includes(x.status)
      )
      .reduce((sum, x) =>
        sum + Number(x.seats || 1), 0
      );

    const available = Number(t.capacity) - booked;

    if (available < 1) fail_('확정 가능한 빈자리가 없습니다.');
    const promotedSeats = Math.min(seats, available);

    const queue = all
      .filter(x =>
        String(x.tripId) === String(t.id) &&
        x.status === 'waitlist'
      )
      .sort((a, b) => a._row - b._row);

    if (!queue.length ||
        String(queue[0].id) !== String(r.id)) {
      fail_('대기 순서가 앞선 신청자가 있습니다. 먼저 처리해 주세요.');
    }

    const now=now_();
    if(promotedSeats<seats){
      // 1순위의 일부만 확정하고 원래 대기 행을 그대로 남겨 순위를 유지합니다.
      const remaining=seats-promotedSeats;
      patch_('Registrations',r._row,{seats:remaining,updatedAt:now,legacyNote:(String(r.legacyNote||'').trim()?String(r.legacyNote).trim()+' | ':'')+'빈자리 '+promotedSeats+'명 부분 확정 / 잔여 대기 '+remaining+'명'});
      const newId=uid_();
      add_('Registrations',{id:newId,tripId:r.tripId,memberId:r.memberId,displayName:r.displayName,seats:promotedSeats,status:'confirmed',createdAt:now,updatedAt:now,legacyNote:'1순위 대기 '+promotedSeats+'명 부분 확정 / 원 대기 신청번호: '+r.id});
    }else{
      patch_('Registrations',r._row,{status:'confirmed',updatedAt:now});
    }
    audit_(m.id,'PROMOTE_WAITLIST','Registrations',r.id,'출조: '+t.id+', 확정: '+promotedSeats+'명, 잔여 대기: '+(seats-promotedSeats)+'명, 빈자리: '+available);
    return true;
  });
}

function creatorCancelRegistration(token,registrationId){active_(auth_(token));
  return locked_(()=>{
    const m=auth_(token);
    const r=rows_('Registrations').find(x=>String(x.id)===String(registrationId));
    if(!r)fail_('신청 내역을 찾을 수 없습니다.');
    const t=rows_('Trips').find(x=>String(x.id)===String(r.tripId));
    if(!canManageTripRegistrations_(m,t))fail_('해당 출조의 신청 취소 권한이 없습니다.');
    if(!tripIsCurrent_(t))fail_('지난 출조는 변경할 수 없습니다.');
    if(!['pending','confirmed','waitlist','cancel_requested'].includes(r.status))fail_('취소할 수 없는 신청 상태입니다.');
    patch_('Registrations',r._row,{status:'cancelled',updatedAt:now_()});
    audit_(m.id,'CREATOR_CANCEL','Registrations',r.id,'출조: '+t.id+' / 이전 상태: '+r.status);
    return true;
  });
}

function deleteTripSafely(token, tripId) {active_(auth_(token));
  return locked_(() => {
    const m = auth_(token);
    admin_(m); // 최고관리자(admin) 및 운영진(staff)
    const t = rows_('Trips').find(x => String(x.id) === String(tripId));
    if (!t) fail_('출조 일정을 찾을 수 없습니다.');
    if (!canManageTripRegistrations_(m,t)) fail_('해당 출조의 대기 승인 권한이 없습니다.');
    if (!tripIsCurrent_(t)) fail_('지난 출조는 변경할 수 없습니다.');
    if (t.status === 'deleted') fail_('이미 삭제 처리된 출조입니다.');

    const regs = rows_('Registrations').filter(r => String(r.tripId) === String(t.id));
    const active = regs.filter(r => ['pending', 'confirmed', 'waitlist', 'cancel_requested'].includes(r.status));
    if (active.length) {
      fail_('현재 신청 또는 대기 중인 기록이 ' + active.length + '건 있어 삭제할 수 없습니다.');
    }
    // 취소된 과거 신청 및 입금 기록은 변경하지 않고 보관합니다.
    patch_('Trips', t._row, {status:'deleted'});
    audit_(m.id, 'DELETE_TRIP', 'Trips', t.id,
      '안전 삭제: ' + t.title + ', 과거 신청 기록: ' + regs.length + '건');
    return true;
  });
}

function admin_(m){active_(m);if(!['admin','staff'].includes(m.role))fail_('운영진 권한이 필요합니다.')}

function register(token, tripId, seats) {
  return locked_(() => {
    const started=Date.now();
    const book=ss_();
    // 잠금 안에서 인증하므로 대기 중 계정이 비활성화된 경우도 차단합니다.
    const m=authWithBook_(token,book);active_(m);
    seats=Number(seats);
    if(m.restrictedUntil && new Date(m.restrictedUntil)>new Date())fail_('출조 제한 기간입니다.');
    const t=rows_('Trips',book).find(x=>String(x.id)===String(tripId));
    if(!t||t.status!=='open')fail_('신청할 수 없는 일정입니다.');
    if(date_(t.date)<babaTodayKst_())fail_('이미 시작한 출조는 새로 신청할 수 없습니다.');
    const capacity=Number(t.capacity);
    if(!Number.isInteger(seats)||seats<1||seats>capacity)fail_('신청 인원은 1명부터 모집 정원('+capacity+'명)까지입니다.');
    const all=rows_('Registrations',book);
    let filled=0,existingWaitlist=false,ownBlocked=false;
    for(const r of all){
      if(String(r.tripId)!==String(tripId))continue;
      if(String(r.memberId)===String(m.id)&&['pending','waitlist','cancel_requested'].includes(r.status))ownBlocked=true;
      if(['confirmed','pending','cancel_requested'].includes(r.status))filled+=Number(r.seats||1);
      if(r.status==='waitlist')existingWaitlist=true;
    }
    if(ownBlocked)fail_('승인 대기, 대기 또는 취소 승인 대기 중인 신청이 있습니다. 해당 신청 처리 후 추가 신청해 주세요.');
    const available=Math.max(0,capacity-filled);
    const pendingSeats=existingWaitlist?0:Math.min(seats,available);
    const waitlistSeats=seats-pendingSeats;
    const created=now_();
    const newRegs=[],auditRows=[];
    const queue=(count,status)=>{
      if(count<=0)return;
      const id=uid_();
      newRegs.push({id,tripId,memberId:m.id,displayName:m.nickname,seats:count,status,createdAt:created,updatedAt:created});
      auditRows.push({timestamp:created,actorId:m.id,action:'REGISTER',entity:'Registrations',entityId:id,detail:status+' '+count+'명'});
    };
    queue(pendingSeats,'pending');
    queue(waitlistSeats,'waitlist');
    // 두 좌석 유형은 기존과 동일하게 별도 신청 행으로 저장합니다.
    // 행 번호가 신청/대기 순서를 결정하므로 잠금 안에서 연속 기록합니다.
    const regSheet=book.getSheetByName('Registrations');
    if(!regSheet)fail_('Registrations 시트 없음. setupDatabase 실행');
    const regStart=regSheet.getLastRow()+1;
    regSheet.getRange(regStart,1,newRegs.length,DB.Registrations.length)
      .setValues(newRegs.map(r=>DB.Registrations.map(k=>r[k]??'')));
    const auditSheet=book.getSheetByName('Audit');
    if(!auditSheet)fail_('Audit 시트 없음. setupDatabase 실행');
    const auditStart=auditSheet.getLastRow()+1;
    auditSheet.getRange(auditStart,1,auditRows.length,DB.Audit.length)
      .setValues(auditRows.map(r=>DB.Audit.map(k=>r[k]??'')));
    SpreadsheetApp.flush();
    console.log('[BABA_REGISTER] '+(Date.now()-started)+'ms; rows='+newRegs.length);
    return {status:pendingSeats>0?'pending':'waitlist',pendingSeats,waitlistSeats};
  });
}

function changeRegistrationSeats(token,registrationId,newSeats){active_(auth_(token));
  return locked_(()=>{
    const m=auth_(token);active_(m);
    const r=rows_('Registrations').find(x=>String(x.id)===String(registrationId));
    if(!r||String(r.memberId)!==String(m.id))fail_('본인의 신청만 변경할 수 있습니다.');
    if(!['pending','waitlist'].includes(r.status))fail_('승인 대기 또는 대기 중인 신청만 인원을 변경할 수 있습니다.');
    const t=rows_('Trips').find(x=>String(x.id)===String(r.tripId));
    if(!t||t.status!=='open'||isPastTrip_(t))fail_('모집 중인 출조만 변경할 수 있습니다.');
    newSeats=Number(newSeats);
    const capacity=Number(t.capacity);
    if(!Number.isInteger(newSeats)||newSeats<1||newSeats>capacity)fail_('변경 인원이 모집 정원을 벗어났습니다.');
    const oldSeats=Number(r.seats||1);
    if(newSeats===oldSeats)return true;
    const all=rows_('Registrations');
    if(r.status==='pending'&&newSeats>oldSeats){
      const occupied=all.filter(x=>String(x.tripId)===String(r.tripId)&&['confirmed','pending','cancel_requested'].includes(x.status)).reduce((n,x)=>n+Number(x.seats||1),0);
      if(occupied+(newSeats-oldSeats)>capacity)fail_('잔여 정원이 부족합니다. 인원을 줄이거나 별도로 대기 신청해 주세요.');
      if(all.some(x=>String(x.tripId)===String(r.tripId)&&x.status==='waitlist'))fail_('대기자가 있어 인원을 늘릴 수 없습니다.');
    }
    // 대기 신청 인원 변경은 대기 순서를 유지하며, 확정 좌석에 영향을 주지 않습니다.
    patch_('Registrations',r._row,{seats:newSeats,updatedAt:now_()});
    if(r.status==='pending'){
    }
    audit_(m.id,'CHANGE_REGISTRATION_SEATS','Registrations',r.id,oldSeats+'명 → '+newSeats+'명');
    return true;
  });
}

function isPastTrip_(t){return date_(t.endDate||t.date)<babaTodayKst_()}

function searchTransferMembers(token,keyword){
  const me=auth_(token);active_(me);
  keyword=String(keyword||'').trim().toLowerCase();
  if(keyword.length<2||keyword.length>30)fail_('닉네임은 2~30자로 검색해 주세요.');
  return rows_('Members').filter(x=>x.status==='active'&&String(x.id)!==String(me.id)&&String(x.nickname||'').toLowerCase().includes(keyword))
    .slice(0,20).map(x=>({id:String(x.id),nickname:String(x.nickname)}));
}

function requestTransfer(token,registrationId,toMemberId,note,transferSeats){active_(auth_(token));return locked_(()=>{
  const m=auth_(token),all=rows_('Registrations');
  const r=all.find(x=>String(x.id)===String(registrationId));
  if(!r||String(r.memberId)!==String(m.id)||r.status!=='confirmed')fail_('본인의 확정 신청만 양도 요청할 수 있습니다.');
  const trip=rows_('Trips').find(x=>String(x.id)===String(r.tripId));
  if(!trip||trip.status==='deleted'||isPastTrip_(trip))fail_('지난 출조 또는 삭제된 일정은 양도할 수 없습니다.');
  const totalSeats=Number(r.seats),requestedSeats=Number(transferSeats);
  if(!Number.isInteger(totalSeats)||totalSeats<1||!Number.isInteger(requestedSeats)||requestedSeats<1||requestedSeats>totalSeats)fail_('양도할 자리는 1명 이상, 현재 확정 인원 이하여야 합니다.');
  const to=rows_('Members').find(x=>String(x.id)===String(toMemberId)&&x.status==='active');
  if(!to)fail_('가입된 활성 회원만 양도받을 수 있습니다.');
  if(String(to.id)===String(m.id))fail_('본인에게 양도할 수 없습니다.');
  if(all.some(x=>String(x.tripId)===String(r.tripId)&&String(x.memberId)===String(to.id)&&x.status==='cancel_requested'))fail_('양수자가 취소 승인 대기 중입니다. 처리 후 양도해 주세요.');
  const waiting=all.filter(x=>String(x.tripId)===String(r.tripId)&&x.status==='waitlist');
  if(waiting.length){
    const recipient=waiting.find(x=>String(x.memberId)===String(to.id));
    if(!recipient)fail_('대기자가 있는 출조는 대기 신청자에게만 양도할 수 있습니다.');
    if(String(waiting.slice().sort((a,b)=>a._row-b._row)[0].id)!==String(recipient.id))fail_('1순위 대기자에게만 양도할 수 있습니다.');
    if(requestedSeats>Number(recipient.seats))fail_('대기자가 신청한 인원 '+recipient.seats+'명을 초과하여 양도할 수 없습니다.');
  }
  if(rows_('Transfers').some(x=>String(x.registrationId)===String(registrationId)&&x.status==='requested'))fail_('이미 처리 대기 중인 양도 요청이 있습니다.');
  const transfersSheet=sheet_('Transfers');
  if(String(transfersSheet.getRange(1,9).getValue()||'')!=='seats')transfersSheet.getRange(1,9).setValue('seats');
  const id=uid_();add_('Transfers',{id,registrationId,toMemberId,status:'requested',requestedAt:now_(),note:String(note||'').slice(0,200),seats:requestedSeats});
  audit_(m.id,'TRANSFER_REQUEST','Transfers',id,'');return id;
})}

function archiveAllTrips(token, confirmation) {
  return locked_(() => {
    const actor = auth_(token);
    if (actor.role !== 'admin') fail_('최고관리자만 전체 일정을 초기화할 수 있습니다.');
    if (confirmation !== '전체일정초기화') fail_('확인 문구가 올바르지 않습니다.');
    const trips = rows_('Trips').filter(t => t.status !== 'deleted');
    if (!trips.length) return {count:0, message:'초기화할 출조 일정이 없습니다.'};
    // Registrations, Payments, Transfers, Audit 등의 기존 행은 삭제하지 않습니다.
    const sh = sheet_('Trips');
    const col = DB.Trips.indexOf('status') + 1;
    const ranges = trips.map(t => 'R' + t._row + 'C' + col);
    // 단일 잠금 범위 안에서 기존 상태만 deleted로 변경합니다.
    trips.forEach(t => sh.getRange(t._row, col).setValue('deleted'));
    audit_(actor.id, 'ARCHIVE_ALL_TRIPS', 'Trips', 'ALL', '전체 일정 논리 삭제: ' + trips.length + '건 / 신청·입금·양도 기록 보존');
    return {count:trips.length, message:trips.length + '건의 출조 일정을 화면에서 숨겼습니다.'};
  });
}

function changeMemberRole(token, memberId, newRole){active_(auth_(token));return locked_(()=>{
  const actor=auth_(token);
  if(actor.role!=='admin')fail_('최고관리자만 회원 권한을 변경할 수 있습니다.');
  if(!['member','staff'].includes(newRole))fail_('변경 가능한 권한은 일반회원 또는 운영진입니다.');
  const target=rows_('Members').find(x=>String(x.id)===String(memberId));
  if(!target)fail_('회원을 찾을 수 없습니다.');
  if(target.status!=='active')fail_('활성 회원의 권한만 변경할 수 있습니다.');
  if(String(target.id)===String(actor.id)||target.role==='admin')fail_('최고관리자 계정의 권한은 변경할 수 없습니다.');
  if(target.role===newRole)fail_('이미 선택한 권한으로 설정되어 있습니다.');
  const previous=target.role;
  patch_('Members',target._row,{role:newRole});
  // 권한 변경 직후 이전 세션을 폐기해 새 권한으로 재로그인하도록 합니다.
  rows_('Sessions').filter(x=>String(x.memberId)===String(target.id)).sort((a,b)=>b._row-a._row)
    .forEach(x=>sheet_('Sessions').deleteRow(x._row));
  audit_(actor.id,'MEMBER_ROLE_CHANGE','Members',target.id,
    '닉네임: '+target.nickname+' / '+previous+' → '+newRole);
  return {id:String(target.id),role:newRole,nickname:String(target.nickname)};
})}

function manageMemberStatus(token,memberId,action){active_(auth_(token));return locked_(()=>{
  const actor=auth_(token);
  if(actor.role!=='admin')fail_('최고관리자만 회원 계정을 관리할 수 있습니다.');
  if(!['deactivate','reactivate','delete'].includes(action))fail_('올바르지 않은 회원 관리 작업입니다.');
  const target=rows_('Members').find(x=>String(x.id)===String(memberId));
  if(!target)fail_('회원 계정을 찾을 수 없습니다.');
  if(String(target.id)===String(actor.id))fail_('본인 계정은 변경할 수 없습니다.');
  if(target.role==='admin')fail_('최고관리자 계정은 이 화면에서 변경할 수 없습니다.');
  if(target.status==='deleted')fail_('삭제 처리된 계정은 복구하거나 변경할 수 없습니다.');
  if(action==='reactivate'){
    if(target.status!=='inactive')fail_('비활성화된 계정만 재활성화할 수 있습니다.');
  }else{
    if(action==='deactivate'&&target.status!=='active')fail_('활성 회원만 비활성화할 수 있습니다.');
    // 회원의 진행 중인 출조와 양도는 운영진이 먼저 정리해야 합니다.
    const activeRegs=rows_('Registrations').filter(r=>String(r.memberId)===String(target.id)&&['confirmed','pending','waitlist','cancel_requested'].includes(r.status));
    if(activeRegs.length)fail_('진행 중인 출조 신청 '+activeRegs.length+'건이 있습니다. 취소 또는 양도 처리 후 다시 시도하세요.');
    const regs=rows_('Registrations');
    const regIds=new Set(regs.filter(r=>String(r.memberId)===String(target.id)).map(r=>String(r.id)));
    const pendingTransfers=rows_('Transfers').filter(t=>t.status==='requested'&&(String(t.toMemberId)===String(target.id)||regIds.has(String(t.registrationId))));
    if(pendingTransfers.length)fail_('처리 대기 중인 양도 요청 '+pendingTransfers.length+'건이 있습니다. 먼저 승인 또는 거절하세요.');
  }
  const next=action==='deactivate'?'inactive':action==='reactivate'?'active':'deleted';
  patch_('Members',target._row,{status:next});
  // 이전 로그인 세션을 무효화합니다. 뒤에서부터 삭제하여 행 이동을 방지합니다.
  rows_('Sessions').filter(x=>String(x.memberId)===String(target.id)).sort((a,b)=>b._row-a._row)
    .forEach(x=>sheet_('Sessions').deleteRow(x._row));
  audit_(actor.id,'MEMBER_'+action.toUpperCase(),'Members',target.id,'닉네임: '+target.nickname+' / '+target.status+' → '+next);
  return {id:String(target.id),status:next};
})}

function searchManagedMembers(token, keyword){
  const actor=auth_(token);
  if(actor.role!=='admin')fail_('최고관리자만 회원 계정을 관리할 수 있습니다.');
  keyword=String(keyword||'').trim().toLowerCase();
  if(keyword.length<1||keyword.length>30)fail_('검색어는 1~30자로 입력하세요.');
  return rows_('Members').filter(x=>String(x.nickname||'').toLowerCase().includes(keyword))
    .slice(0,40).map(x=>({id:String(x.id),nickname:String(x.nickname),role:String(x.role),status:String(x.status)}));
}

function cancellationRequests(token) {
  const m = auth_(token);
  const allowedTrips = new Set(rows_('Trips').filter(t => canDecideCancellation_(m, t)).map(t => String(t.id)));
  return rows_('Registrations').filter(r => r.status === 'cancel_requested' && allowedTrips.has(String(r.tripId))).map(r => ({
    id:r.id, tripId:r.tripId, memberId:r.memberId, displayName:r.displayName,
    seats:Number(r.seats||1), requestedAt:date_(r.updatedAt)
  }));
}

function transferRequests(token){const m=auth_(token);admin_(m);return rows_('Transfers').filter(x=>x.status==='requested').map(x=>({id:x.id,registrationId:x.registrationId,tripId:String(rows_('Registrations').find(r=>String(r.id)===String(x.registrationId))?.tripId||''),toMemberId:x.toMemberId,toNickname:String(rows_('Members').find(m=>String(m.id)===String(x.toMemberId))?.nickname||'회원 확인 필요'),fromNickname:String(rows_('Registrations').find(r=>String(r.id)===String(x.registrationId))?.displayName||'신청자 확인 필요'),note:x.note,seats:Number(x.seats)||Number(rows_('Registrations').find(r=>String(r.id)===String(x.registrationId))?.seats||1)}))}

function decideTransfer(token,transferId,accept){active_(auth_(token));return locked_(()=>{
  const m=auth_(token);admin_(m);
  const tr=rows_('Transfers').find(x=>String(x.id)===String(transferId)&&x.status==='requested');
  if(!tr)fail_('대기 중인 양도 요청 없음');
  const all=rows_('Registrations'),r=all.find(x=>String(x.id)===String(tr.registrationId));
  if(!r||r.status!=='confirmed')fail_('원본 신청이 확정 상태가 아닙니다.');
  const trip=rows_('Trips').find(x=>String(x.id)===String(r.tripId));
  if(!trip||trip.status==='deleted'||isPastTrip_(trip))fail_('지난 출조 또는 삭제된 일정은 양도할 수 없습니다.');
  if(accept){
    const to=rows_('Members').find(x=>String(x.id)===String(tr.toMemberId)&&x.status==='active');
    if(!to)fail_('양수자 계정 없음');
    if(String(to.id)===String(r.memberId))fail_('본인에게 양도할 수 없습니다.');
    const recipient=all.filter(x=>String(x.tripId)===String(r.tripId)&&String(x.memberId)===String(to.id)&&['confirmed','pending','waitlist','cancel_requested'].includes(x.status));
    if(recipient.some(x=>x.status==='cancel_requested'))fail_('양수자의 취소 승인 요청을 먼저 처리해 주세요.');
    const originalSeats=Number(r.seats),seats=tr.seats===''||tr.seats==null?originalSeats:Number(tr.seats),now=now_();
    if(!Number.isInteger(originalSeats)||originalSeats<1||!Number.isInteger(seats)||seats<1||seats>originalSeats)fail_('양도 인원이 현재 보유 인원을 초과합니다.');
    const waiting=all.filter(x=>String(x.tripId)===String(r.tripId)&&x.status==='waitlist');
    if(waiting.length){
      const waitRecipient=waiting.find(x=>String(x.memberId)===String(to.id));
      if(!waitRecipient)fail_('대기자가 있는 출조는 대기 신청자에게만 양도할 수 있습니다.');
      if(String(waiting.slice().sort((a,b)=>a._row-b._row)[0].id)!==String(waitRecipient.id))fail_('1순위 대기자가 남아 있어 차순위에게 양도할 수 없습니다.');
      if(seats>Number(waitRecipient.seats))fail_('대기 신청 인원 '+waitRecipient.seats+'명을 초과하여 양도할 수 없습니다.');
    }
    // 정원 무결성 검증: 양도는 좌석의 이동일 뿐 총 점유 인원을 늘릴 수 없습니다.
    const occupiedBefore=all.filter(x=>String(x.tripId)===String(r.tripId)&&['confirmed','pending','cancel_requested'].includes(x.status)).reduce((n,x)=>n+Number(x.seats||0),0);
    const targetForCheck=waiting.length?recipient.find(x=>x.status==='waitlist'):(recipient.find(x=>x.status==='confirmed')||recipient.find(x=>x.status==='pending')||recipient.find(x=>x.status==='waitlist'));
    const incomingOccupied=seats; // 기존 확정·승인대기 신청에 합산하거나 대기에서 확정으로 이동
    const occupiedAfter=occupiedBefore-seats+incomingOccupied;
    if(occupiedAfter>Number(trip.capacity))fail_('정원 초과 위험: 양도 승인 후 '+occupiedAfter+'/'+trip.capacity+'명입니다. 현재 신청 명단을 확인해 주세요.');
    if(occupiedAfter>occupiedBefore)fail_('양도로 인해 확정 인원이 증가할 수 없습니다.');
    const remaining=originalSeats-seats;
    // 부분 양도 시 원 신청을 유지하고, 전부 양도 시 취소 이력으로 남깁니다.
    patch_('Registrations',r._row,{seats:remaining||originalSeats,status:remaining?'confirmed':'cancelled',updatedAt:now,legacyNote:(String(r.legacyNote||'').trim()?String(r.legacyNote).trim()+' | ':'')+(remaining?'양도 승인 → ':'양도 전체 취소 → ')+to.nickname+' / '+seats+'명'+(remaining?' / 잔여 '+remaining+'명':'')});
    // 확정 신청이 있으면 그 신청에 합산, 없으면 승인대기/대기 신청에 합산합니다.
    // 대기자가 양도받은 좌석은 양도 승인 시 확정됩니다.
    const target=waiting.length?recipient.find(x=>x.status==='waitlist'):(recipient.find(x=>x.status==='confirmed')||recipient.find(x=>x.status==='pending')||recipient.find(x=>x.status==='waitlist'));
    if(target && target.status==='waitlist' && seats<Number(target.seats)){
      // 대기 신청 인원의 일부만 양도: 기존 대기 신청은 남은 인원으로 유지하고
      // 양도받은 인원은 별도 확정 신청으로 기록하여 대기 인원이 소실되지 않게 합니다.
      const remainingWaiting=Number(target.seats)-seats;
      patch_('Registrations',target._row,{seats:remainingWaiting,updatedAt:now,legacyNote:(String(target.legacyNote||'').trim()?String(target.legacyNote).trim()+' | ':'')+'양도 '+seats+'명 확정 / 잔여 대기 '+remainingWaiting+'명'});
      const confirmedId=uid_();
      add_('Registrations',{id:confirmedId,tripId:r.tripId,memberId:to.id,displayName:to.nickname,seats,status:'confirmed',createdAt:now,updatedAt:now,legacyNote:'대기 중 부분 양도 '+seats+'명 확정 / 원 신청번호: '+r.id});
    }else if(target){
      const nextSeats=target.status==='waitlist'?seats:Number(target.seats||1)+seats;
      patch_('Registrations',target._row,{seats:nextSeats,status:'confirmed',updatedAt:now});
    }else{
      const id=uid_();add_('Registrations',{id,tripId:r.tripId,memberId:to.id,displayName:to.nickname,seats,status:'confirmed',createdAt:now,updatedAt:now,legacyNote:'양도 수령 / 원 신청번호: '+r.id});
    }
    audit_(m.id,'TRANSFER_APPROVED','Registrations',r.id,'수령: '+to.id+' / '+seats+'명');
  }
  patch_('Transfers',tr._row,{status:accept?'approved':'rejected',decidedAt:now_(),decidedBy:m.id});
  audit_(m.id,'TRANSFER_DECISION','Transfers',tr.id,String(accept));return true;
})}

function changeTrip(token, id, fields) {active_(auth_(token));
  return locked_(async () => {
    const m = auth_(token);active_(m);
    const t = rows_('Trips').find(x => String(x.id) === String(id));
    if (!t) fail_('출조 일정을 찾을 수 없습니다.');
    // 운영진은 전체 출조, 일반회원은 본인이 등록한 출조만 수정 가능.
    const isStaff = ['admin','staff'].includes(m.role);
    if (!isStaff && (!String(t.creatorId||'').trim() || String(t.creatorId) !== String(m.id))) {
      fail_('본인이 등록한 출조만 수정할 수 있습니다.');
    }
    if (t.status === 'deleted') fail_('삭제된 출조는 수정할 수 없습니다.');

    fields = fields || {};
    const allowed = {};

    if (fields.date !== undefined) {
      const date = String(fields.date).trim();
      if (!/^20\d{2}-\d{2}-\d{2}$/.test(date) ||
          isNaN(Date.parse(date)) ||
          new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
        fail_('올바른 출조 날짜를 입력하세요.');
      }
      allowed.date = date;
    }

    if (fields.endDate !== undefined || fields.date !== undefined) {
      const start=allowed.date||date_(t.date);
      const end=fields.endDate!==undefined?String(fields.endDate).trim():date_(t.endDate||t.date);
      if(!babaValidTripDate_(end)||end<start)fail_('종료일은 시작일과 같거나 이후여야 합니다.');
      allowed.endDate=end;
      ensureTripEndDateColumn_();
    }

    if (fields.title !== undefined) {
      const title = String(fields.title).trim();
      if (!title || title.length > 100) {
        fail_('출조명은 1~100자로 입력하세요.');
      }
      allowed.title = title;
    }

    if (fields.boat !== undefined) {
      const boat = String(fields.boat).trim();
      if (boat.length > 100) {
        fail_('선사 또는 선박명은 100자 이내로 입력하세요.');
      }
      allowed.boat = boat;
    }

    if (fields.fee !== undefined) {
      const fee = Number(fields.fee);
      if (!Number.isFinite(fee) || fee < 0 ||
          !Number.isInteger(fee)) {
        fail_('선비는 0 이상의 정수로 입력하세요.');
      }
      allowed.fee = fee;
    }

    if (fields.capacity !== undefined) {
      const capacity = Number(fields.capacity);
      if (!Number.isInteger(capacity) ||
          capacity < 2 || capacity > 100) {
        fail_('정원은 2~100명으로 입력하세요.');
      }

      const occupied = rows_('Registrations')
        .filter(r => r.tripId === id &&
          ['confirmed', 'pending', 'cancel_requested'].includes(r.status))
        .reduce((sum, r) => sum + Number(r.seats || 1), 0);

      if (capacity < occupied) {
        fail_('현재 신청 인원보다 정원을 줄일 수 없습니다.');
      }
      allowed.capacity = capacity;
    }

    if (fields.status !== undefined) {
      if (!['open', 'closed', 'draft'].includes(fields.status)) {
        fail_('올바르지 않은 모집 상태입니다.');
      }
      allowed.status = fields.status;
    }

    if (fields.notes !== undefined) {
      allowed.notes = String(fields.notes).slice(0, 500);
    }

    if (fields.port !== undefined) { const existingPort=String(t.departurePort||''); if(String(fields.port?.name||'')!==existingPort || (fields.port?.source && String(fields.port?.address||'')!==String(t.portAddress||''))){Object.assign(allowed,await validatePort_(fields.port)); ensureTripPortColumns_();} }

    if (fields.tide !== undefined) { allowed.tide = String(fields.tide || '').trim().slice(0,40); ensureTripTideColumn_(); }

    if (Object.keys(allowed).length === 0) {
      fail_('변경할 항목이 없습니다.');
    }

    patch_('Trips', t._row, allowed);

    audit_(
      m.id,
      'UPDATE_TRIP',
      'Trips',
      id,
      JSON.stringify(allowed)
    );

    return true;
  });
}

function setBabaNickname(token,nickname){return locked_(()=>{const m=auth_(token);nickname=String(nickname||'').trim();if(nickname.length<2||nickname.length>20||/[<>\r\n]/.test(nickname))fail_('닉네임은 2~20자로 입력하세요.');if(rows_('Members').some(x=>String(x.id)!==String(m.id)&&x.status!=='deleted'&&String(x.nickname).toLowerCase()===nickname.toLowerCase()))fail_('이미 사용 중인 닉네임입니다.');patch_('Members',m._row,{nickname});audit_(m.id,'SET_NICKNAME','Members',m.id,'닉네임 설정');return true})}

function pendingKakaoMembers(token){const m=auth_(token);admin_(m);return rows_('Members').filter(x=>x.status==='pending'&&x.kakaoId).map(x=>({id:String(x.id),nickname:String(x.nickname),createdAt:date_(x.createdAt)}))}

function decideKakaoMember(token,id,accept){return locked_(()=>{const m=auth_(token);admin_(m);const target=rows_('Members').find(x=>String(x.id)===String(id)&&x.status==='pending'&&x.kakaoId);if(!target)fail_('승인 대기 회원을 찾지 못했습니다.');if(typeof accept!=='boolean')fail_('승인 여부가 올바르지 않습니다.');patch_('Members',target._row,{status:accept?'active':'inactive'});audit_(m.id,accept?'MEMBER_APPROVE':'MEMBER_REJECT','Members',id,target.nickname);return true})}

function babaGameLaunch(token){
  const m=auth_(token);active_(m);
  const secret=PropertiesService.getScriptProperties().getProperty('BABA_GAME_SIGNING_KEY');
  if(!secret||secret.length<32)fail_('BABA_GAME_SIGNING_KEY를 스크립트 속성에 등록해 주세요.');
  const now=Math.floor(Date.now()/1000);
  const header={alg:'HS256',typ:'JWT'};
  const payload={
    iss:'team-baba-gas',aud:'baba-game',sub:String(m.id),
    nickname:String(m.nickname||'회원'),status:'active',
    canResetQuota:m.role==='admin',iat:now,exp:now+300
  };
  const b64=o=>Utilities.base64EncodeWebSafe(JSON.stringify(o),Utilities.Charset.UTF_8).replace(/=+$/,'');
  const unsigned=b64(header)+'.'+b64(payload);
  const sig=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(unsigned,secret)).replace(/=+$/,'');
  return {url:'https://lee36848759-hub.github.io/baba-fishing-game/#launch='+encodeURIComponent(unsigned+'.'+sig)};
}

function requestMyCancellation(token, registrationId) {active_(auth_(token));
  return locked_(() => {
    const m = auth_(token);active_(m);
    const r = rows_('Registrations').find(x => String(x.id) === String(registrationId));
    if (!r || String(r.memberId) !== String(m.id)) fail_('본인의 신청만 취소 요청할 수 있습니다.');
    if (r.status !== 'confirmed') fail_('확정된 신청만 취소 승인 요청할 수 있습니다.');
    patch_('Registrations', r._row, {status:'cancel_requested', updatedAt:now_()});
    audit_(m.id, 'CANCEL_REQUEST', 'Registrations', r.id, '내 신청: 취소 승인 대기');
    return {status:'cancel_requested'};
  });
}

function cancel(token, registrationId) {active_(auth_(token));
  return locked_(() => {
    const m = auth_(token);active_(m);
    const r = rows_('Registrations').find(x => String(x.id) === String(registrationId));
    if (!r) fail_('신청 내역이 없습니다.');
    const isAdmin = ['admin', 'staff'].includes(m.role);
    const isOwner = String(r.memberId) === String(m.id);
    if (!isAdmin && !isOwner) fail_('본인 신청만 취소할 수 있습니다.');
    if (r.status === 'cancelled') fail_('이미 취소된 신청입니다.');
    if (r.status === 'cancel_requested') fail_('이미 운영진 취소 승인을 기다리고 있습니다.');
    if (!['pending', 'confirmed', 'waitlist'].includes(r.status)) fail_('취소할 수 없는 신청 상태입니다.');

    // 확정된 일반회원 신청은 취소 요청으로만 전환합니다.
    if (r.status === 'confirmed' && !isAdmin) {
      patch_('Registrations', r._row, {status:'cancel_requested', updatedAt:now_()});
      audit_(m.id, 'CANCEL_REQUEST', 'Registrations', r.id, '운영진 승인 대기');
      return true;
    }

    patch_('Registrations', r._row, {status:'cancelled', updatedAt:now_()});
    audit_(m.id, isAdmin?'ADMIN_CANCEL':'CANCEL', 'Registrations', r.id, '이전 상태: '+r.status);
    return true;
  });
}

function listManagedMembers(token){
  const actor=auth_(token);
  if(actor.role!=='admin')fail_('최고관리자만 전체 회원 명부를 조회할 수 있습니다.');
  return rows_('Members').map(x=>({id:String(x.id),nickname:String(x.nickname||''),role:String(x.role||''),status:String(x.status||''),createdAt:date_(x.createdAt)}))
    .sort((a,b)=>a.nickname.localeCompare(b.nickname,'ko'));
}

function listBabaMemberRoster(token){
  auth_(token);
  return rows_('Members')
    .filter(x=>['active','pending'].includes(String(x.status)))
    .map(x=>({
      nickname:String(x.nickname||''),
      role:String(x.role||'member'),
      status:String(x.status||''),
      createdAt:date_(x.createdAt)
    }))
    .sort((a,b)=>a.nickname.localeCompare(b.nickname,'ko'));
}
const actions={data,babaQuickStart,getBabaRankingByYear,searchBabaRanking,searchDeparturePorts,createTrip,approve,decideCancellation,promoteWaitlist,creatorCancelRegistration,deleteTripSafely,register,changeRegistrationSeats,searchTransferMembers,requestTransfer,archiveAllTrips,changeMemberRole,manageMemberStatus,searchManagedMembers,cancellationRequests,transferRequests,decideTransfer,changeTrip,setBabaNickname,pendingKakaoMembers,decideKakaoMember,babaGameLaunch,requestMyCancellation,cancel,listManagedMembers,listBabaMemberRoster};
if(!Object.hasOwn(actions,action)) throw Error("지원하지 않는 작업입니다.");
return await actions[action](null,...args);
}
