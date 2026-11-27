async function pushStep(task, label, milliseconds = 15000) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error(label + ' 시간이 초과됐습니다. 다시 시도해 주세요.')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

async function tripPushApi(action, fields = {}) {
  const {data} = await clubClient.auth.getSession();
  if (!data.session) throw Error('로그인이 필요합니다.');
  const response = await fetch(BABA.url + '/functions/v1/baba-trip-push', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + data.session.access_token, apikey: BABA.key, 'Content-Type':'application/json'},
    body: JSON.stringify({action, ...fields})
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || (response.status === 401 ? '다시 로그인한 뒤 알림을 켜 주세요.' : '알림 서버 연결 실패 (' + response.status + ')'));
  return result;
}

async function clearTripPush() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const sub = await registration?.pushManager?.getSubscription();
  if (sub) {
    await sub.unsubscribe();
    await tripPushApi('off', {endpoint:sub.endpoint}).catch(()=>{});
  }
}

async function showTripPushSettings() {
  const button = document.getElementById('toggleTripPush');
  if (!button) return;
  const hint = document.getElementById('tripPushHint');
  const blocked = '알림이 차단돼 있습니다. 브라우저 사이트 설정과 휴대폰 설정에서 알림을 허용한 뒤 계정 메뉴를 다시 열어 주세요.';
  if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) {
    hint.textContent = /Android/i.test(navigator.userAgent)
      ? '이 화면에서는 푸시를 사용할 수 없습니다. 같은 바바 주소를 Chrome에서 열어 주세요.'
      : '아이폰은 Safari 공유 → 홈 화면에 추가 후 홈 화면의 팀바바를 열어 주세요. 다른 기기는 푸시 지원 브라우저에서 열어 주세요.';
    return;
  }
  try {
    const registration = await pushStep(navigator.serviceWorker.ready, '앱 알림 준비');
    let sub = await pushStep(registration.pushManager.getSubscription(), '기기 알림 상태 확인');
    let enabled = !!sub && (await pushStep(tripPushApi('status',{endpoint:sub.endpoint}), '등록 상태 확인')).enabled;
    const {key} = await pushStep(tripPushApi('key'), '알림 서버 연결');
    const binary = atob(key.replace(/-/g,'+').replace(/_/g,'/'));
    const applicationServerKey = Uint8Array.from(binary,c=>c.charCodeAt(0));
    function renderButton() {
      button.disabled = false;
      button.textContent = enabled ? '이 기기 알림 끄기' : '내 출조 알림 받기';
      hint.textContent = enabled ? '이 기기로 내 출조의 신청과 인원 변동을 알려드립니다.' :
        Notification.permission === 'denied' ? blocked : '버튼을 누르고 알림 권한을 허용해 주세요.';
    }
    renderButton();
    button.onclick = async () => {
      button.disabled = true;
      button.textContent = enabled ? '해제 중…' : '등록 중…';
      try {
        if (enabled) {
          await pushStep(clearTripPush(), '알림 해제');
          enabled = false;
          sub = null;
        } else {
          if (Notification.permission === 'denied') throw Error(blocked);
          // subscribe directly in this tap so mobile browsers can display their permission dialog.
          hint.textContent = '휴대폰의 알림 권한과 푸시 서비스 응답을 기다리고 있습니다.';
          sub = sub || await pushStep(registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey}), '휴대폰 알림 등록', 30000);
          hint.textContent = '이 기기를 팀바바에 등록하고 있습니다.';
          await pushStep(tripPushApi('on',{subscription:sub.toJSON()}), '팀바바 기기 등록');
          enabled = true;
        }
        renderButton();
      } catch(error) {
        renderButton();
        hint.textContent = error.name === 'NotAllowedError' ? blocked : (error.message || '알림 설정을 확인해 주세요.');
      }
    };
  } catch(error) {
    hint.textContent = error.message;
    button.textContent = '알림 설정 다시 불러오기';
    button.disabled = false;
    button.onclick = ()=>{button.disabled=true;showTripPushSettings()};
  }
}
