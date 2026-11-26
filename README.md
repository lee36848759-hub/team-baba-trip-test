# 팀바바 출조 관리 전환 테스트
1. 별도 Supabase 테스트 프로젝트의 SQL Editor에서 setup.sql을 한 번 실행합니다.
2. Supabase Auth에서 Kakao 공급자를 켜고, 카카오 개발자 콘솔의 Redirect URI에 Supabase가 안내하는 콜백 주소를 등록합니다. Kakao 클라이언트 시크릿은 공급자 설정에만 입력합니다.
3. 웹 파일(index.html, config.js, app.js, sw.js, manifest.json, PNG 두 개)을 별도 GitHub Pages 저장소의 배포 폴더에 둡니다. config.js에는 테스트 프로젝트 URL과 publishable 또는 anon 공개 키만 입력합니다. 변경 배포 시 sw.js의 캐시 버전을 올립니다.
4. Supabase Auth의 허용 리디렉션 URL에 실제 Pages 주소(하위 경로 및 마지막 슬래시 포함)를 추가합니다. 이 주소에서 로그인한 뒤 ‘가입 신청’으로 닉네임을 등록합니다.
5. 아래 SQL에서 실제 테스트 계정 UUID를 넣어 운영진·일반회원 권한을 부여합니다. 운영진을 정원에 포함한 테스트 출조 예시입니다. 본인 확인 후 UUID로 지정하세요.

```sql
select id,nickname,role from baba.members;
update baba.members set role='staff' where id='<운영진 UUID>';
update baba.members set role='member' where id='<회원 UUID>';
with t as (
 insert into baba.trips(title,starts,ends,capacity,owner_id)
 values('테스트 출조',current_date+1,current_date+1,2,'<운영진 UUID>')
 returning id,owner_id
)
insert into baba.entries(trip,member,seats,status,request_id)
select id,owner_id,1,'confirmed',gen_random_uuid() from t;
```

6. 회원 계정으로 신청하고, 운영진 계정에서 새로고침 후 승인합니다. 빈자리는 승인 대기부터 차감하며 초과 인원은 대기로 분리합니다. 이 버전은 출조 생성 및 회원 승인을 SQL로 수행합니다. 기존 회원·일정 자동 이전, 대기 승격·양도·취소·랭킹은 후속 범위입니다.
7. 휴대폰에서 한 번 로그인해 실제 일정을 불러온 뒤 홈 화면에 추가합니다. 앱을 닫고 다시 열어 아이콘 터치부터 출조명·날짜 표시까지 화면 녹화로 측정합니다. 첫 방문·재로그인은 따로 기록합니다. 마지막 한 자리 동시 신청은 별도 계정으로 검증합니다.
