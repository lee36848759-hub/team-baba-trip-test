async function tripPushApi(action, fields = {}) {
  const {data} = await clubClient.auth.getSession();
  if (!data.session) throw Error('로그인이 필요합니다.');
  const response = await fetch(BABA.url + '/functions/v1/baba-trip-push', {
    method: 'POST',
    headers: {Authorization: 'Bearer ' + data.session.access_token, apikey: BABA.key, 'Content-Type':'application/json'},
    body: JSON.stringify({action, ...fields})
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '알림 설정을 저장하지 못했습니다.');
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
  if (!('PushManager' in window) || !('Notification' in window) || !('serviceWorker' in navigator)) {
    hint.textContent = '아이폰은 iOS 16.4 이상에서 Safari 공유 → 홈 화면에 추가 후, 홈 화면의 팀바바를 열어 주세요.';
    return;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    let sub = await registration.pushManager.getSubscription();
    let enabled = !!sub && (await tripPushApi('status',{endpoint:sub.endpoint})).enabled;
    function renderButton() {
      button.disabled = false;
      button.textContent = enabled ? '이 기기 알림 끄기' : '내 출조 알림 받기';
      hint.textContent = enabled ? '내가 등록한 출조의 신청과 인원 변동을 이 기기로 알려드립니다.' : '이 기기에서 내가 등록한 출조의 알림을 받을 수 있습니다.';
    }
    renderButton();
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (enabled) {
          await clearTripPush();
          enabled = false;
          sub = null;
        } else {
          if (await Notification.requestPermission() !== 'granted') throw Error('기기 또는 브라우저 설정에서 팀바바 알림을 허용해 주세요.');
          if (sub) await sub.unsubscribe();
          const {key} = await tripPushApi('key');
          const binary = atob(key.replace(/-/g,'+').replace(/_/g,'/'));
          sub = await registration.pushManager.subscribe({userVisibleOnly:true, applicationServerKey:Uint8Array.from(binary,c=>c.charCodeAt(0))});
          await tripPushApi('on',{subscription:sub.toJSON()});
          enabled = true;
        }
        renderButton();
      } catch(error) {
        button.disabled = false;
        hint.textContent = error.message || '알림 설정을 확인해 주세요.';
      }
    };
  } catch(error) { hint.textContent = error.message; }
}
