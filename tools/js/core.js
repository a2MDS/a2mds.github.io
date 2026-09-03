/* =========================================================================
   GLOBAL CONFIGURATION & USER AUTHENTICATION (Central Auth & Single Session)
   ========================================================================= */
const URL_CENTRAL_AUTH = 'https://script.google.com/macros/s/AKfycbyYrUpZ7XyjsNiLzctU-f2jzEKaDPcfbaR4GBScNmHKQdZU7C_p1dD5c88B-ATdpep_/exec';
const AUTH_TOKEN_KEY = 'a2mds_unified_auth_key';
const USER_PROFILE_KEY = 'a2mds_user_profile';
const SESSION_ID_KEY = 'a2mds_session_id';
const PALETTE = ['#16a34a', '#0284c7', '#ea580c', '#dc2626', '#7c3aed', '#059669', '#d97706', '#2563eb', '#db2777', '#4b5563', '#0d9488', '#e11d48'];

let sessionValidationTimer = null;

// KST 타임스탬프 상세 포맷터 (YYYY-MM-DD HH:mm:ss KST)
function formatKstTimestampDetailed(rawTs) {
  let dateObj = !rawTs ? new Date() : (rawTs instanceof Date ? rawTs : new Date(String(rawTs).trim()));
  if (isNaN(dateObj.getTime())) dateObj = new Date();
  if (typeof rawTs === 'string' && /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+KST$/i.test(rawTs.trim())) return rawTs.trim();

  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(dateObj);
  const p = t => parts.find(x => x.type === t)?.value || '00';
  return `${p('year')}-${p('month')}-${p('day')} ${p('hour')}:${p('minute')}:${p('second')} KST`;
}

// 스토리지 통합 매니저
const AuthStore = {
  get: k => { try { return sessionStorage.getItem(k) || ''; } catch(e) { return ''; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch(e) {} },
  getJSON: k => { try { const r = sessionStorage.getItem(k); return r ? JSON.parse(r) : null; } catch(e) { return null; } },
  clear: () => {
    [AUTH_TOKEN_KEY, USER_PROFILE_KEY, SESSION_ID_KEY, 'a2mds_auth_key'].forEach(k => {
      try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch(e) {}
    });
  }
};

const getStoredAuthKey = () => AuthStore.get(AUTH_TOKEN_KEY);
const setStoredAuthKey = k => AuthStore.set(AUTH_TOKEN_KEY, k);
const getStoredSessionId = () => AuthStore.get(SESSION_ID_KEY);
const setStoredSessionId = sid => AuthStore.set(SESSION_ID_KEY, sid);
const getStoredUserProfile = () => AuthStore.getJSON(USER_PROFILE_KEY);
const setStoredUserProfile = p => AuthStore.set(USER_PROFILE_KEY, JSON.stringify(p));
const clearStoredAuthKey = () => AuthStore.clear();

// 권한 목록 정규화 헬퍼
function getNormalizedAllowedTabs(user) {
  if (!user?.allowedTabs) return [];
  return (Array.isArray(user.allowedTabs) ? user.allowedTabs : String(user.allowedTabs).split(','))
    .map(t => String(t).trim().toLowerCase()).filter(Boolean);
}

// Workspace 관리자 권한 확인
function isWorkspaceAdmin() {
  const user = getStoredUserProfile();
  return Boolean(user && ((user.role && String(user.role).toLowerCase() === 'admin') || user.userId === 'jpahn'));
}

// 단일 세션 검증 폴링 (Heartbeat)
function startSessionValidationMonitor(userId, sessionId) {
  if (sessionValidationTimer) clearInterval(sessionValidationTimer);
  if (!userId || !sessionId) return;

  sessionValidationTimer = setInterval(async () => {
    try {
      const resp = await fetch(URL_CENTRAL_AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'validate_session', userId, sessionId })
      });
      const res = await resp.json();
      if (res?.status === 'session_expired') {
        clearInterval(sessionValidationTimer);
        alert('Another login was detected on this account. Your session has been terminated.');
        executeLogout();
      }
    } catch(e) {
      console.warn("Session ping warning:", e);
    }
  }, 60000);
}

// 명시적 로그아웃
async function executeLogout() {
  if (sessionValidationTimer) clearInterval(sessionValidationTimer);

  const user = getStoredUserProfile();
  const sessionId = getStoredSessionId();

  if (user?.userId && sessionId) {
    try {
      await fetch(URL_CENTRAL_AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'logout', userId: user.userId, sessionId }),
        keepalive: true
      });
    } catch(e) {
      console.warn("Logout session clear warning:", e);
    }
  }

  clearStoredAuthKey();

  const dbs = ['clearCompIndexedDB', 'clearSubstIndexedDB', 'clearAppIndexedDB', 'clearSmelterIndexedDB', 'clearGadslIndexedDB', 'clearInsightIndexedDB'];
  await Promise.allSettled(dbs.filter(fn => typeof window[fn] === 'function').map(fn => window[fn]()));
  window.location.reload();
}

// 사용자 로그인 실행 (forceLogin 지원)
async function executeAuth(forceLogin = false) {
  const idInput = document.getElementById('authUserIdInput');
  const pwInput = document.getElementById('authPasswordInput');
  const userId = idInput ? idInput.value.trim() : '';
  const password = pwInput ? pwInput.value.trim() : '';
  const errBox = document.getElementById('authErrorMsg');

  if (!userId || !password) {
    if (errBox) { errBox.textContent = 'Please enter both User ID and Password.'; errBox.style.display = 'block'; }
    return;
  }

  const btn = document.getElementById('authBtnSubmit');
  btn.textContent = forceLogin ? 'Terminating other session...' : 'Authenticating...';
  btn.disabled = true;
  if (errBox) { errBox.style.display = 'none'; errBox.innerHTML = ''; }
  document.getElementById('authBtnForceLogin')?.remove();

  try {
    const resp = await fetch(URL_CENTRAL_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'authenticate', userId, password, forceLogin })
    });
    const res = await resp.json();

    if (res?.status === 'success' && res.user) {
      const apiToken = res.token || password;
      setStoredAuthKey(apiToken);
      setStoredUserProfile(res.user);
      if (res.sessionId) setStoredSessionId(res.sessionId);

      const lockOverlay = document.getElementById('authLockOverlay');
      if (lockOverlay) lockOverlay.style.display = 'none';
      applyUserTabPermissions(res.user);
      synchronizeAuthorizedData(apiToken, res.user);

      if (res.sessionId) startSessionValidationMonitor(res.user.userId, res.sessionId);
    } else if (res?.status === 'already_logged_in') {
      if (errBox) {
        errBox.innerHTML = '⚠️ <strong>User Already Logged In</strong><br>This account is currently active on another device.';
        errBox.style.display = 'block';
      }
      const card = document.querySelector('.auth-card');
      if (card && !document.getElementById('authBtnForceLogin')) {
        const forceBtn = document.createElement('button');
        forceBtn.type = 'button';
        forceBtn.id = 'authBtnForceLogin';
        forceBtn.className = 'auth-btn';
        forceBtn.style.backgroundColor = '#dc2626';
        forceBtn.style.marginTop = '8px';
        forceBtn.textContent = 'Force Login & Disconnect Other Session';
        forceBtn.onclick = () => executeAuth(true);
        card.appendChild(forceBtn);
      }
    } else {
      if (errBox) { errBox.textContent = res?.message || 'Incorrect ID or Password.'; errBox.style.display = 'block'; }
      if (pwInput) pwInput.value = '';
    }
  } catch(e) {
    if (errBox) { errBox.textContent = 'Authentication server connection error. Please retry.'; errBox.style.display = 'block'; }
  } finally {
    btn.textContent = 'Unlock & Synchronize';
    btn.disabled = false;
  }
}

/* =========================================================================
   TAB PERMISSIONS & VIEW SWITCHING
   ========================================================================= */
function applyUserTabPermissions(user) {
  const allowed = getNormalizedAllowedTabs(user);
  const isAll = allowed.includes('all');
  let firstVisibleTab = '';

  document.querySelectorAll('.gnb-tab-btn').forEach(btn => {
    const tabKey = (btn.getAttribute('data-tab') || '').toLowerCase();
    const canView = isAll || allowed.includes(tabKey);
    btn.style.display = canView ? 'inline-flex' : 'none';
    if (canView && !firstVisibleTab) firstVisibleTab = tabKey;
  });

  const userBadge = document.getElementById('gnbUserInfoBadge');
  if (userBadge) {
    const roleTag = user?.role ? ` [${user.role}]` : '';
    userBadge.textContent = `${user?.name || user?.userId || 'User'} (${user?.company || 'a2MDS'})${roleTag}`;
    userBadge.style.display = 'inline-flex';
  }

  if (typeof updateCompAdminUI === 'function') updateCompAdminUI();
  if (firstVisibleTab) switchView(firstVisibleTab);
}

function synchronizeAuthorizedData(apiToken, userOrTabs) {
  const token = apiToken || getStoredAuthKey();
  if (!token) return;

  const user = typeof userOrTabs === 'object' && !Array.isArray(userOrTabs) ? userOrTabs : { allowedTabs: userOrTabs };
  const allowed = getNormalizedAllowedTabs(user);
  const isAll = allowed.includes('all');
  const isAllowed = k => isAll || allowed.includes(k.toLowerCase());

  const syncMap = [
    { key: 'compliance', fn: 'fetchComplianceData' },
    { key: 'substance', fn: 'syncSubstanceData' },
    { key: 'application', fn: 'fetchApplicationData' },
    { key: 'smelter', fn: 'fetchSmelterData' },
    { key: 'gadsl', fn: 'fetchGadslData' },
    { key: 'insight', fn: 'initQaCategories', noToken: true }
  ];

  syncMap.forEach(m => {
    if (isAllowed(m.key) && typeof window[m.fn] === 'function') {
      m.noToken ? window[m.fn]() : window[m.fn](token);
    }
  });
}

function switchView(tabKey) {
  const user = getStoredUserProfile();
  const allowed = getNormalizedAllowedTabs(user);
  const normalizedKey = (tabKey || '').toLowerCase();

  if (!allowed.includes('all') && !allowed.includes(normalizedKey)) return;

  document.querySelectorAll('.gnb-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view-panel').forEach(p => p.classList.remove('active'));

  const capKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  document.getElementById(`btnTab${capKey}`)?.classList.add('active');
  document.getElementById(`view${capKey}`)?.classList.add('active');

  const token = getStoredAuthKey();

  if (normalizedKey === 'compliance') {
    if (typeof updateCompAdminUI === 'function') updateCompAdminUI();
    if (!window.compDataset?.length && typeof fetchComplianceData === 'function') fetchComplianceData(token);
  } else if (normalizedKey === 'substance' && !window.substanceDataset?.length && typeof syncSubstanceData === 'function') {
    syncSubstanceData(token);
  } else if (normalizedKey === 'application' && !window.applicationDataset?.length) {
    if (typeof initApplicationModule === 'function') {
      initApplicationModule().then(() => {
        if (!window.applicationDataset?.length && token && typeof fetchApplicationData === 'function') fetchApplicationData(token);
      });
    }
  } else if (normalizedKey === 'smelter' && !window.consolidatedDataStore?.length) {
    if (typeof initSmelterModule === 'function') {
      initSmelterModule().then(() => {
        if (!window.consolidatedDataStore?.length && token && typeof fetchSmelterData === 'function') fetchSmelterData(token);
      });
    }
  } else if (normalizedKey === 'gadsl' && !window.gadslCasData?.length) {
    if (typeof initGadslModule === 'function') {
      initGadslModule().then(() => {
        if (!window.gadslCasData?.length && token && typeof fetchGadslData === 'function') fetchGadslData(token);
      });
    }
  } else if (normalizedKey === 'insight') {
    if (typeof initQaCategories === 'function') initQaCategories();
  }
}

/* =========================================================================
   GLOBAL INITIALIZATION & EVENT LISTENERS
   ========================================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  const tip = document.getElementById('globalLogTooltip');

  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tooltip]');
    if (t && tip) {
      tip.textContent = t.getAttribute('data-tooltip');
      tip.style.display = 'block';
      tip.style.opacity = '1';
      const r = t.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let top = r.top - tr.height - 8, left = r.left + (r.width / 2) - (tr.width / 2);
      if (top < 10) top = r.bottom + 8;
      if (left < 10) left = 10;
      if (left + tr.width > window.innerWidth - 10) left = window.innerWidth - tr.width - 10;
      tip.style.top = `${top}px`;
      tip.style.left = `${left}px`;
    }
  });

  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tooltip]') && tip) {
      tip.style.opacity = '0';
      tip.style.display = 'none';
    }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.multiselect-container')) {
      document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
    }
  });

  const modules = ['initComplianceModule', 'initSubstanceModule', 'initApplicationModule', 'initSmelterModule', 'initGadslModule', 'initInsightModule'];
  await Promise.allSettled(modules.filter(fn => typeof window[fn] === 'function').map(fn => window[fn]()));

  const savedToken = getStoredAuthKey();
  const savedProfile = getStoredUserProfile();
  const savedSessionId = getStoredSessionId();

  const lockEl = document.getElementById('authLockOverlay');
  if (savedToken && savedProfile && savedSessionId) {
    if (lockEl) lockEl.style.display = 'none';
    applyUserTabPermissions(savedProfile);
    synchronizeAuthorizedData(savedToken, savedProfile);
    startSessionValidationMonitor(savedProfile.userId, savedSessionId);
  } else {
    if (lockEl) lockEl.style.display = 'flex';
    setTimeout(() => document.getElementById('authUserIdInput')?.focus(), 50);
  }
});
