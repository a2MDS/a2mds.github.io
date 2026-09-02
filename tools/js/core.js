/* =========================================================================
   GLOBAL CONFIGURATION & USER AUTHENTICATION (Central Auth & Single Session Integration)
   ========================================================================= */
const URL_CENTRAL_AUTH = 'https://script.google.com/macros/s/AKfycbyYrUpZ7XyjsNiLzctU-f2jzEKaDPcfbaR4GBScNmHKQdZU7C_p1dD5c88B-ATdpep_/exec';
const AUTH_TOKEN_KEY = 'a2mds_unified_auth_key';
const USER_PROFILE_KEY = 'a2mds_user_profile';
const SESSION_ID_KEY = 'a2mds_session_id';
const PALETTE = ['#16a34a', '#0284c7', '#ea580c', '#dc2626', '#7c3aed', '#059669', '#d97706', '#2563eb', '#db2777', '#4b5563', '#0d9488', '#e11d48'];

let sessionValidationTimer = null;

// KST 타임스탬프 상세 포맷터 (YYYY-MM-DD HH:mm:ss KST)
function formatKstTimestampDetailed(rawTs) {
  let dateObj;
  if (!rawTs) {
    dateObj = new Date();
  } else if (rawTs instanceof Date) {
    dateObj = rawTs;
  } else {
    const s = String(rawTs).trim();
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\s+KST$/i.test(s)) {
      return s;
    }
    dateObj = new Date(s);
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(dateObj);
  const findPart = t => parts.find(p => p.type === t)?.value || '00';
  return `${findPart('year')}-${findPart('month')}-${findPart('day')} ${findPart('hour')}:${findPart('minute')}:${findPart('second')} KST`;
}

// 브라우저 탭/세션 단위 토큰 및 세션 ID 관리
const getStoredAuthKey = () => { 
  try { 
    return sessionStorage.getItem(AUTH_TOKEN_KEY) || ''; 
  } catch(e) { 
    return ''; 
  } 
};

const setStoredAuthKey = k => { 
  try { 
    sessionStorage.setItem(AUTH_TOKEN_KEY, k); 
  } catch(e) {} 
};

const getStoredSessionId = () => {
  try {
    return sessionStorage.getItem(SESSION_ID_KEY) || '';
  } catch(e) {
    return '';
  }
};

const setStoredSessionId = sid => {
  try {
    sessionStorage.setItem(SESSION_ID_KEY, sid);
  } catch(e) {}
};

const clearStoredAuthKey = () => { 
  try { 
    sessionStorage.removeItem(AUTH_TOKEN_KEY); 
    sessionStorage.removeItem(USER_PROFILE_KEY); 
    sessionStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY); 
    localStorage.removeItem(USER_PROFILE_KEY); 
    localStorage.removeItem(SESSION_ID_KEY);
    localStorage.removeItem('a2mds_auth_key');
  } catch(e) {} 
};

const getStoredUserProfile = () => {
  try {
    const raw = sessionStorage.getItem(USER_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch(e) { 
    return null; 
  }
};

const setStoredUserProfile = p => { 
  try { 
    sessionStorage.setItem(USER_PROFILE_KEY, JSON.stringify(p)); 
  } catch(e) {} 
};

// 권한 목록 정규화 헬퍼 (배열/문자열 호환 및 소문자 정렬)
function getNormalizedAllowedTabs(user) {
  if (!user || !user.allowedTabs) return [];
  if (Array.isArray(user.allowedTabs)) {
    return user.allowedTabs.map(t => String(t).trim().toLowerCase());
  }
  if (typeof user.allowedTabs === 'string') {
    return user.allowedTabs.split(',').map(t => t.trim().toLowerCase());
  }
  return [];
}

// Workspace 관리자 권한 확인 헬퍼
function isWorkspaceAdmin() {
  const user = getStoredUserProfile();
  if (!user) return false;
  return (user.role && String(user.role).toLowerCase() === 'admin') || user.userId === 'jpahn';
}

// 명시적 로그아웃 (백엔드 시트의 Session ID 비우기 포함)
async function executeLogout() {
  if (sessionValidationTimer) clearInterval(sessionValidationTimer);

  const token = getStoredAuthKey();
  const user = getStoredUserProfile();
  const sessionId = getStoredSessionId();

  if (user?.userId && sessionId) {
    try {
      await fetch(URL_CENTRAL_AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'logout',
          userId: user.userId,
          sessionId: sessionId
        }),
        keepalive: true
      });
    } catch(e) {
      console.warn("Logout session clear request failed:", e);
    }
  }

  clearStoredAuthKey();

  try {
    const clearTasks = [];
    if (typeof clearCompIndexedDB === 'function') clearTasks.push(clearCompIndexedDB());
    if (typeof clearSubstIndexedDB === 'function') clearTasks.push(clearSubstIndexedDB());
    if (typeof clearAppIndexedDB === 'function') clearTasks.push(clearAppIndexedDB());
    if (typeof clearSmelterIndexedDB === 'function') clearTasks.push(clearSmelterIndexedDB());
    if (typeof clearGadslIndexedDB === 'function') clearTasks.push(clearGadslIndexedDB());
    if (typeof clearInsightIndexedDB === 'function') clearTasks.push(clearInsightIndexedDB());

    await Promise.allSettled(clearTasks);
  } catch(e) {
    console.warn("Logout cache clear settled with warning:", e);
  } finally {
    window.location.reload();
  }
}

// 단일 세션 검증 폴링 (Heartbeat)
function startSessionValidationMonitor(userId, sessionId) {
  if (sessionValidationTimer) clearInterval(sessionValidationTimer);
  
  // 60초마다 세션 유효성 확인
  sessionValidationTimer = setInterval(async () => {
    try {
      const resp = await fetch(URL_CENTRAL_AUTH, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'validate_session',
          userId: userId,
          sessionId: sessionId
        })
      });
      const res = await resp.json();
      if (res.status === 'session_expired') {
        clearInterval(sessionValidationTimer);
        alert('Another login was detected on this account. Your session has been terminated.');
        executeLogout();
      }
    } catch(e) {
      console.warn("Session check temporary ping error:", e);
    }
  }, 60000);
}

// 사용자 로그인 실행 (forceLogin 지원)
async function executeAuth(forceLogin = false) {
  const idInput = document.getElementById('authUserIdInput');
  const pwInput = document.getElementById('authPasswordInput');
  const userId = idInput ? idInput.value.trim() : '';
  const password = pwInput ? pwInput.value.trim() : '';
  const errBox = document.getElementById('authErrorMsg');

  if (!userId || !password) {
    if (errBox) { 
      errBox.textContent = 'Please enter both User ID and Password.'; 
      errBox.style.display = 'block'; 
    }
    return;
  }

  const btn = document.getElementById('authBtnSubmit');
  btn.textContent = forceLogin ? 'Terminating other session...' : 'Authenticating...'; 
  btn.disabled = true;
  if (errBox) {
    errBox.style.display = 'none';
    errBox.innerHTML = '';
  }

  // 기존 생성된 Force Login 버튼이 있다면 제거
  document.getElementById('authBtnForceLogin')?.remove();

  try {
    const resp = await fetch(URL_CENTRAL_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'authenticate',
        userId: userId,
        password: password,
        forceLogin: forceLogin
      })
    });
    const res = await resp.json();

    if (res.status === 'success' && res.user) {
      const apiToken = res.token || password;
      setStoredAuthKey(apiToken);
      setStoredUserProfile(res.user);
      if (res.sessionId) setStoredSessionId(res.sessionId);
      
      const lockOverlay = document.getElementById('authLockOverlay');
      if (lockOverlay) lockOverlay.style.display = 'none';
      applyUserTabPermissions(res.user);
      synchronizeAuthorizedData(apiToken, res.user);

      // 세션 모니터링 활성화
      if (res.sessionId) {
        startSessionValidationMonitor(res.user.userId, res.sessionId);
      }
    } else if (res.status === 'already_logged_in') {
      if (errBox) {
        errBox.innerHTML = `⚠️ <strong>User Already Logged In</strong><br>This account is currently active on another device.`;
        errBox.style.display = 'block';
      }

      // 강제 접속(Force Login) 버튼 동적 렌더링
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
      if (errBox) {
        errBox.textContent = res.message || 'Incorrect ID or Password.';
        errBox.style.display = 'block';
      }
      pwInput.value = '';
    }
  } catch(e) {
    if (errBox) {
      errBox.textContent = 'Authentication server connection error. Please retry.';
      errBox.style.display = 'block';
    }
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
  const tabButtons = document.querySelectorAll('.gnb-tab-btn');
  let firstVisibleTab = '';

  tabButtons.forEach(btn => {
    const tabKey = (btn.getAttribute('data-tab') || '').toLowerCase();
    
    if (isAll || allowed.includes(tabKey)) {
      btn.style.display = 'inline-flex';
      if (!firstVisibleTab) firstVisibleTab = tabKey;
    } else {
      btn.style.display = 'none';
    }
  });

  const userBadge = document.getElementById('gnbUserInfoBadge');
  if (userBadge) {
    const roleTag = user.role ? ` [${user.role}]` : '';
    userBadge.textContent = `${user.name || user.userId} (${user.company || 'a2MDS'})${roleTag}`;
    userBadge.style.display = 'inline-flex';
  }

  if (typeof updateCompAdminUI === 'function') {
    updateCompAdminUI();
  }

  if (firstVisibleTab) {
    switchView(firstVisibleTab);
  }
}

function synchronizeAuthorizedData(apiToken, userOrTabs) {
  const token = apiToken || getStoredAuthKey();
  if (!token) return;

  const user = typeof userOrTabs === 'object' && !Array.isArray(userOrTabs) ? userOrTabs : { allowedTabs: userOrTabs };
  const allowed = getNormalizedAllowedTabs(user);
  const isAll = allowed.includes('all');

  const isAllowed = k => isAll || allowed.includes(k.toLowerCase());

  if (isAllowed('compliance') && typeof fetchComplianceData === 'function') fetchComplianceData(token);
  if (isAllowed('substance') && typeof syncSubstanceData === 'function') syncSubstanceData(token);
  if (isAllowed('application') && typeof fetchApplicationData === 'function') fetchApplicationData(token);
  if (isAllowed('smelter') && typeof fetchSmelterData === 'function') fetchSmelterData(token);
  if (isAllowed('gadsl') && typeof fetchGadslData === 'function') fetchGadslData(token);
  if (isAllowed('insight') && typeof initQaCategories === 'function') initQaCategories();
}

function switchView(tabKey) {
  const user = getStoredUserProfile();
  const allowed = getNormalizedAllowedTabs(user);
  const normalizedKey = (tabKey || '').toLowerCase();
  
  if (!allowed.includes('all') && !allowed.includes(normalizedKey)) {
    return;
  }

  document.querySelectorAll('.gnb-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view-panel').forEach(p => p.classList.remove('active'));

  const capitalizedKey = normalizedKey.charAt(0).toUpperCase() + normalizedKey.slice(1);
  const targetBtn = document.getElementById(`btnTabCapitalizedKey`);
  const targetView = document.getElementById(`view${capitalizedKey}`);

  if (targetBtn) targetBtn.classList.add('active');
  if (targetView) targetView.classList.add('active');

  const token = getStoredAuthKey();

  if (normalizedKey === 'compliance') {
    if (typeof updateCompAdminUI === 'function') updateCompAdminUI();
    if ((!window.compDataset || !window.compDataset.length) && typeof fetchComplianceData === 'function') {
      fetchComplianceData(token);
    }
  }
  if (normalizedKey === 'substance' && (!window.substanceDataset || !window.substanceDataset.length) && typeof syncSubstanceData === 'function') {
    syncSubstanceData(token);
  }
  if (normalizedKey === 'application' && (!window.applicationDataset || !window.applicationDataset.length)) {
    if (typeof initApplicationModule === 'function') {
      initApplicationModule().then(() => {
        if ((!window.applicationDataset || !window.applicationDataset.length) && token && typeof fetchApplicationData === 'function') {
          fetchApplicationData(token);
        }
      });
    }
  }
  if (normalizedKey === 'smelter' && (!window.consolidatedDataStore || !window.consolidatedDataStore.length)) {
    if (typeof initSmelterModule === 'function') {
      initSmelterModule().then(() => {
        if ((!window.consolidatedDataStore || !window.consolidatedDataStore.length) && token && typeof fetchSmelterData === 'function') {
          fetchSmelterData(token);
        }
      });
    }
  }
  if (normalizedKey === 'gadsl' && (!window.gadslCasData || !window.gadslCasData.length)) {
    if (typeof initGadslModule === 'function') {
      initGadslModule().then(() => {
        if ((!window.gadslCasData || !window.gadslCasData.length) && token && typeof fetchGadslData === 'function') {
          fetchGadslData(token);
        }
      });
    }
  }
  if (normalizedKey === 'insight') {
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
      tip.style.top = top + 'px'; 
      tip.style.left = left + 'px';
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

  try {
    const initTasks = [];
    if (typeof initComplianceModule === 'function') initTasks.push(initComplianceModule());
    if (typeof initSubstanceModule === 'function') initTasks.push(initSubstanceModule());
    if (typeof initApplicationModule === 'function') initTasks.push(initApplicationModule());
    if (typeof initSmelterModule === 'function') initTasks.push(initSmelterModule());
    if (typeof initGadslModule === 'function') initTasks.push(initGadslModule());
    if (typeof initInsightModule === 'function') initTasks.push(initInsightModule());

    await Promise.allSettled(initTasks);
  } catch(e) {
    console.warn("Module init warning:", e);
  }

  const savedToken = getStoredAuthKey();
  const savedProfile = getStoredUserProfile();
  const savedSessionId = getStoredSessionId();

  if (savedToken && savedProfile && savedSessionId) {
    const lockEl = document.getElementById('authLockOverlay');
    if (lockEl) lockEl.style.display = 'none';
    applyUserTabPermissions(savedProfile);
    synchronizeAuthorizedData(savedToken, savedProfile);
    startSessionValidationMonitor(savedProfile.userId, savedSessionId);
  } else {
    const lockEl = document.getElementById('authLockOverlay');
    if (lockEl) lockEl.style.display = 'flex';
    setTimeout(() => document.getElementById('authUserIdInput')?.focus(), 50);
  }
});
