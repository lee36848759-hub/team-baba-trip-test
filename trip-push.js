let tripPushBusy = false;

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
  button.onclick = null;
  const blocked = '알림이 차단돼 있습니다. 휴대폰 알림 권한 설정에서 허용 방법을 확인해 주세요.';
  bindTripPushPermissions(button, hint);
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
    let applicationServerKey;
    if (!enabled && !sub) {
      const {key} = await pushStep(tripPushApi('key'), '알림 서버 연결');
      const binary = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
      applicationServerKey = Uint8Array.from(binary, char => char.charCodeAt(0));
    }
    function renderButton() {
      button.disabled = false;
      button.textContent = enabled ? '이 기기 알림 끄기' : '내 출조 알림 받기';
      hint.textContent = enabled ? '이 기기로 내 출조의 신청과 인원 변동을 알려드립니다.' :
        Notification.permission === 'denied' ? blocked : '버튼을 누르고 알림 권한을 허용해 주세요.';
    }
    renderButton();
    button.onclick = async () => {
      if (tripPushBusy) {
        hint.textContent = '이전 알림 작업이 진행 중입니다. 잠시 뒤 다시 눌러 주세요.';
        return;
      }
      tripPushBusy = true;
      button.disabled = true;
      button.textContent = enabled ? '해제 중…' : '등록 중…';
      try {
        if (enabled) {
          await pushStep(clearTripPush(), '알림 해제');
          enabled = false;
          sub = null;
          button.textContent = '알림 설정 확인 중…';
          await showTripPushSettings();
          return;
        } else {
          if (Notification.permission === 'denied') throw Error(blocked);
          if (Notification.permission === 'default') {
            button.textContent = '권한 확인 중…';
            hint.textContent = '휴대폰에 권한 창이 뜨면 알림을 허용해 주세요.';
            const permission = await pushStep(Notification.requestPermission(), '알림 권한 확인', 20000);
            if (permission !== 'granted') throw Error(permission === 'denied' ? blocked : '알림 권한 창에서 허용을 선택해 주세요.');
            renderButton();
            button.textContent = '이 기기 등록하기';
            hint.textContent = '알림을 허용했습니다. 아래 버튼을 눌러 기기 등록을 마쳐 주세요.';
            return;
          }
          hint.textContent = '휴대폰의 알림 권한과 푸시 서비스 응답을 기다리고 있습니다.';
          if (!sub) {
            button.textContent = '브라우저 푸시 연결 중…';
            sub = await pushStep(registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey
            }), '브라우저 푸시 등록', 12000);
          }
          button.textContent = '기기 저장 중…';
          hint.textContent = '이 기기를 팀바바에 등록하고 있습니다.';
          await pushStep(tripPushApi('on',{subscription:sub.toJSON()}), '팀바바 기기 등록');
          enabled = true;
        }
        renderButton();
      } catch(error) {
        renderButton();
        if (error.name === 'NotAllowedError') {
          hint.textContent = blocked;
        } else if (error.name === 'AbortError' || error.name === 'NetworkError') {
          hint.textContent = '휴대폰 브라우저가 푸시 서비스에 연결하지 못했습니다. 네트워크 연결을 확인한 뒤 다시 시도해 주세요.';
        } else {
          hint.textContent = error.message || '알림 설정을 확인해 주세요.';
        }
      } finally {
        tripPushBusy = false;
      }
    };
  } catch(error) {
    hint.textContent = error.message;
    button.textContent = '알림 설정 다시 불러오기';
    button.disabled = false;
    button.onclick = ()=>{button.disabled=true;showTripPushSettings()};
  }
}

function bindTripPushPermissions(button, hint) {
  const settings = document.getElementById('tripPushPermissions');
  const guide = document.getElementById('tripPushPermissionGuide');
  if (settings.onclick) return;

  const android = /Android/i.test(navigator.userAgent);
  const installed = matchMedia('(display-mode: standalone)').matches;
  const steps = document.createElement('p');
  steps.className = 'muted';
  if (android && installed) {
    steps.textContent = '홈 화면에서 팀바바 아이콘을 길게 누르고 ⓘ 앱 정보 → 알림 → 알림 허용을 켜세요. 앱 정보가 없으면 설정 → 애플리케이션 → Chrome → 알림을 확인하세요.';
  } else if (android) {
    steps.textContent = 'Chrome 주소창 왼쪽의 사이트 정보 → 권한 → 알림을 허용하세요. 휴대폰 설정 → 애플리케이션 → Chrome → 알림도 확인하세요.';
  } else {
    steps.textContent = '브라우저의 사이트 권한에서 알림을 허용하세요. 아이폰은 홈 화면에 추가한 팀바바 앱과 설정 → 알림을 확인하세요.';
  }
  const recheck = document.createElement('button');
  recheck.className = 'secondary';
  recheck.textContent = '권한 다시 확인';
  recheck.onclick = () => {
    if (tripPushBusy || button.disabled) return;
    button.disabled = true;
    hint.textContent = '이 기기의 알림 설정을 확인하고 있습니다.';
    showTripPushSettings();
  };
  guide.append(steps, recheck);

  settings.onclick = async () => {
    guide.hidden = !guide.hidden;
    settings.setAttribute('aria-expanded', String(!guide.hidden));
    if (guide.hidden || tripPushBusy || !('Notification' in window) ||
        Notification.permission !== 'default' || !('PushManager' in window)) return;
    tripPushBusy = true;
    try {
      const permission = await pushStep(Notification.requestPermission(), '알림 권한 확인', 20000);
      if (!button.isConnected) return;
      hint.textContent = permission === 'granted'
        ? '알림을 허용했습니다. 내 출조 알림 받기를 눌러 기기 등록을 마쳐 주세요.'
        : '위 경로에서 알림 권한을 확인한 뒤 권한 다시 확인을 눌러 주세요.';
    } catch (error) {
      if (button.isConnected) hint.textContent = error.message;
    } finally {
      tripPushBusy = false;
    }
  };
}
