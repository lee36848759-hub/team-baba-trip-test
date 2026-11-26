const $ = id => document.getElementById(id);
const message = text => { $('msg').textContent = text; };
const cacheKey = 'baba-test-schedule-v1';
const authKey = 'baba-test-auth';

const labels = {
  pending: '승인 대기',
  confirmed: '확정',
  waitlist: '자리 대기',
  cancel_requested: '취소 승인 대기',
  cancelled: '취소',
  canceled: '취소',
  rejected: '반려'
};

let db;
let user;
let profile;
let legacyPanel;

function element(tag, text = '') {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function button(parent, label, action) {
  const node = element('button', label);
  parent.append(node);

  node.onclick = async () => {
    node.disabled = true;
    try {
      await action();
    } catch (error) {
      message(error.message || '처리 중 오류가 발생했습니다.');
    } finally {
      node.disabled = false;
    }
  };
  return node;
}

function koreaDate(date = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul'
  }).format(date);
}

function dateRange(start, end) {
  return end && end !== start ? `${start} ~ ${end}` : start;
}

function seatInput(parent, capacity, label) {
  const input = element('input');
  input.type = 'number';
  input.min = '1';
  input.max = String(capacity);
  input.step = '1';
  input.value = '1';
  input.setAttribute('aria-label', label);
  parent.append(input);
  return input;
}

function requestIdFor(key) {
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

async function rpc(name, args = {}) {
  const {data, error} = await db.rpc('baba_' + name, args);
  if (error) throw error;
  return data;
}

function draw(rows, time, live) {
  const panel = $('trips');
  panel.replaceChildren();
  $('stamp').textContent =
    '마지막 확인 ' + new Date(time).toLocaleString('ko-KR');

  const today = koreaDate();
  const upcoming = rows.filter(row => row.ends >= today);

  for (const row of upcoming) {
    const card = element('article');
    card.append(
      element('h3', row.title),
      element('p', dateRange(row.starts, row.ends)),
      element('p', `잔여 ${row.free}석 / 정원 ${row.capacity}명`)
    );

    if (live && profile?.state === 'active') {
      const input = seatInput(card, row.capacity, row.title + ' 신청 인원');

      button(card, '신청', async () => {
        const seats = input.valueAsNumber;
        if (!input.reportValidity() || !Number.isInteger(seats)) return;

        const key = `baba-request:${user.id}:${row.id}:${seats}`;
        await rpc('apply', {
          p_trip: row.id,
          p_seats: seats,
          p_request: requestIdFor(key)
        });

        sessionStorage.removeItem(key);
        message('신청을 접수했습니다. 아래에서 결과를 확인하세요.');
        await refresh();
      });
    }

    panel.append(card);
  }

  if (!upcoming.length) {
    panel.append(element('p', '예정된 출조가 없습니다.'));
  }
}

async function refresh() {
  const rows = await rpc('schedule');
  const time = Date.now();
  draw(rows, time, true);

  localStorage.setItem(cacheKey, JSON.stringify({
    rows, time, owner: user.id
  }));

  const entries = await rpc('entries');
  const panel = $('entries');
  panel.replaceChildren(element('h2', '신청 내역'));

  for (const entry of entries) {
    const status = labels[entry.status] || entry.status;
    const card = element('article',
      `${entry.title} · ${entry.nickname} · ${entry.seats}명 · ${status}`
    );

    if (profile.state === 'active' && entry.can_approve) {
      button(card, '승인', async () => {
        await rpc('approve', {p_id: entry.id});
        await refresh();
      });
    }

    panel.append(card);
  }
}

function addLegacyTestButton(card, row) {
  const input = seatInput(card, row.capacity, row.title + ' 테스트 신청 인원');
  const result = element('p');
  result.setAttribute('role', 'status');

  button(card, '새 앱에서 테스트 신청', async () => {
    const seats = input.valueAsNumber;
    if (!input.reportValidity() || !Number.isInteger(seats)) return;

    const key = [
      'baba-legacy-test', user.id, row.exported_at, row.id, seats
    ].join(':');

    result.textContent = '좌석을 확인하고 있습니다.';

    try {
      const receipt = await rpc('apply_legacy_test', {
        p_trip: String(row.id),
        p_seats: seats,
        p_request: requestIdFor(key),
        p_snapshot_time: row.exported_at
      });

      const parts = [];
      if (receipt.pending > 0) {
        parts.push(`승인 대기 ${receipt.pending}명`);
      }
      if (receipt.waiting > 0) {
        parts.push(`자리 대기 ${receipt.waiting}명`);
        parts.push(`앞선 대기 인원 ${receipt.waiting_ahead}명`);
      }
      parts.push(`접수 후 잔여 ${receipt.free_after}석`);
      result.textContent = '테스트 접수 완료 · ' + parts.join(' · ');
    } catch (error) {
      result.textContent = '신청 결과 · ' + error.message;
    }
  });

  card.append(result);
}

async function showLegacySchedule() {
  if (profile.state !== 'active' && profile.state !== 'pending') return;

  legacyPanel.replaceChildren(element('h2', '기존 출조 일정'));

  try {
    const rows = await rpc('legacy_schedule');

    if (!rows.length) {
      legacyPanel.append(element('p', '예정된 기존 출조가 없습니다.'));
      return;
    }

    const snapshotTime = new Date(rows[0].exported_at).toLocaleString('ko-KR', {
      timeZone: 'Asia/Seoul'
    });
    legacyPanel.append(element('small', '원본 사본 기준 ' + snapshotTime));

    const today = koreaDate();

    for (const row of rows) {
      const card = element('article');
      card.append(
        element('h3', row.title),
        element('p', dateRange(row.starts, row.ends)),
        element('p',
          `잔여 ${row.free}석 / 정원 ${row.capacity}명 · 자리 대기 ${row.waiting}명`
        )
      );

      const open = row.status === 'open' && row.starts >= today;
      if (open && profile.state === 'active' && profile.role === 'admin') {
        addLegacyTestButton(card, row);
      } else if (!open) {
        card.append(element('small', '신청 마감'));
      } else {
        card.append(element('small', '정식 전환 전 · 일정 조회 가능'));
      }

      legacyPanel.append(card);
    }
  } catch (error) {
    legacyPanel.append(element('p', '기존 일정 조회 실패 · ' + error.message));
  }
}

function addHistoryButton() {
  const panel = element('section');
  $('entries').after(panel);

  button($('actions'), '기존 내 신청', async () => {
    const rows = await rpc('my_legacy_entries');
    panel.replaceChildren(element('h2', `기존 내 신청 · ${rows.length}건`));

    if (!rows.length) {
      panel.append(element('p', '조회할 기존 신청 내역이 없습니다.'));
    }

    for (const row of rows) {
      const card = element('article');
      const status = labels[row.status] || row.status || '상태 미기록';
      card.append(
        element('h3', row.trip_title),
        element('p', dateRange(row.starts_on, row.ends_on) || '날짜 미기록'),
        element('p', `${row.seats}명 · ${status}`)
      );
      panel.append(card);
    }

    panel.scrollIntoView({block: 'start'});
  });
}

function showProfile() {
  if (profile.state === 'new') {
    button($('actions'), '가입 신청', async () => {
      const nickname = prompt('팀바바에서 사용할 닉네임');
      if (!nickname || !nickname.trim()) return;
      await rpc('join', {p_nickname: nickname.trim()});
      location.reload();
    });
    return;
  }

  const roles = {admin: '최고관리자', staff: '운영진', member: '일반회원'};
  let label = roles[profile.role] || '회원';
  if (profile.state === 'pending') label = '가입 승인 대기';
  if (profile.state === 'inactive') label = '비활성 회원';

  const details = [profile.nickname, label];
  if (profile.joined_at) {
    let day = String(profile.joined_at);
    if (day.includes('T')) {
      const date = new Date(day);
      if (!Number.isNaN(date.getTime())) day = koreaDate(date);
    }
    details.push('가입일 ' + day);
  }
  $('actions').prepend(element('p', details.join(' · ')));
}

async function start() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  if (!window.BABA?.url || !window.BABA?.key) {
    message('테스트 서버 연결 전입니다. config.js의 프로젝트 주소와 공개 키를 확인해 주세요.');
    return;
  }

  try {
    const session = JSON.parse(localStorage.getItem(authKey) || 'null');
    const cached = JSON.parse(localStorage.getItem(cacheKey) || 'null');
    if (cached && Array.isArray(cached.rows) &&
        session?.user?.id === cached.owner &&
        session?.expires_at * 1000 > Date.now()) {
      draw(cached.rows, cached.time, false);
    }
  } catch {
    localStorage.removeItem(cacheKey);
  }

  const {createClient} = await import('https://esm.sh/@supabase/supabase-js@2.49.4');
  const url = new URL(location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const field = name => url.searchParams.get(name) || fragment.get(name);
  const authCode = field('code');
  const failure = field('error_code') || field('error');
  const description = field('error_description') || '';

  if (authCode || failure) {
    history.replaceState(history.state, '', location.pathname);
  }

  db = createClient(BABA.url, BABA.key, {
    auth: {
      storageKey: authKey,
      flowType: 'pkce',
      detectSessionInUrl: false
    }
  });

  const pendingKey = 'baba-kakao-login-started';
  const returning = sessionStorage.getItem(pendingKey);
  sessionStorage.removeItem(pendingKey);
  let notice = '';

  if (failure) {
    const code = /^[a-zA-Z0-9_-]{1,64}$/.test(failure)
      ? failure : 'provider_error';
    notice = `카카오 인증 실패 (${code}). `;
    if (/external.*token|provider.*token/i.test(description)) {
      notice += 'Supabase의 Kakao REST API Key와 Client Secret Code를 확인해 주세요.';
    } else if (/email/i.test(description)) {
      notice += '카카오 이메일 동의와 Supabase 이메일 설정을 확인해 주세요.';
    } else {
      notice += 'Supabase 인증 로그에서 같은 시각의 오류를 확인해 주세요.';
    }
  } else if (authCode) {
    const {error} = await db.auth.exchangeCodeForSession(authCode);
    if (error) {
      notice = `로그인 세션 교환 실패 (${error.code || 'exchange_failed'}). ` +
        '로그인을 시작한 브라우저에서 다시 시도해 주세요.';
    }
  }

  const {data, error} = await db.auth.getSession();
  if (error) throw error;
  user = data.session?.user;

  if (!notice && returning && !user) {
    notice = '로그인 세션을 확인할 수 없습니다. Supabase 인증 로그를 확인해 주세요.';
  }
  if (notice) message(notice);

  db.auth.onAuthStateChange((event, session) => {
    if ((session?.user?.id || null) !== (user?.id || null)) {
      localStorage.removeItem(cacheKey);
      location.reload();
    }
  });

  if (!user) {
    localStorage.removeItem(cacheKey);
    button($('actions'), '카카오 로그인', async () => {
      sessionStorage.setItem(pendingKey, '1');
      const {error} = await db.auth.signInWithOAuth({
        provider: 'kakao',
        options: {redirectTo: location.origin + location.pathname}
      });
      if (error) {
        sessionStorage.removeItem(pendingKey);
        throw error;
      }
    });
    return;
  }

  button($('actions'), '로그아웃', async () => {
    localStorage.removeItem(cacheKey);
    const {error} = await db.auth.signOut({scope: 'local'});
    if (error) throw error;
    location.reload();
  });

  profile = await rpc('my_profile');
  legacyPanel = element('section');
  $('trips').after(legacyPanel);

  button($('actions'), '새로고침', async () => {
    await Promise.all([refresh(), showLegacySchedule()]);
  });

  if (profile.state === 'active') addHistoryButton();
  showProfile();

  await Promise.all([refresh(), showLegacySchedule()]);
}

start().catch(error => {
  message('연결을 확인해 주세요. ' + error.message);
});
