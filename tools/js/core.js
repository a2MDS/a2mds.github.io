/* =========================================================================
   GLOBAL CONFIGURATION & USER AUTHENTICATION (Central Auth Integration)
   ========================================================================= */
const URL_CENTRAL_AUTH = 'https://script.google.com/macros/s/AKfycbyYrUpZ7XyjsNiLzctU-f2jzEKaDPcfbaR4GBScNmHKQdZU7C_p1dD5c88B-ATdpep_/exec';
const AUTH_TOKEN_KEY = 'a2mds_unified_auth_key';
const USER_PROFILE_KEY = 'a2mds_user_profile';
const PALETTE = ['#16a34a', '#0284c7', '#ea580c', '#dc2626', '#7c3aed', '#059669', '#d97706', '#2563eb', '#db2777', '#4b5563', '#0d9488', '#e11d48'];

// 브라우저 탭/세션 단위 격리 (보안 강화)
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

const clearStoredAuthKey = () => { 
  try { 
    sessionStorage.removeItem(AUTH_TOKEN_KEY); 
    sessionStorage.removeItem(USER_PROFILE_KEY); 
    // 로컬스토리지 잔여물까지 완전 제거
    localStorage.removeItem(AUTH_TOKEN_KEY); 
    localStorage.removeItem(USER_PROFILE_KEY); 
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

// Workspace 관리자 권한 확인 헬퍼
function isWorkspaceAdmin() {
  const user = getStoredUserProfile();
  if (!user) return false;
  return (user.role && String(user.role).toLowerCase() === 'admin') || user.userId === 'jpahn';
}

async function executeLogout() {
  clearStoredAuthKey();
  try {
    const clearTasks = [];
    if (typeof clearCompIndexedDB === 'function') clearTasks.push(clearCompIndexedDB());
    if (typeof clearSubstIndexedDB === 'function') clearTasks.push(clearSubstIndexedDB());
    if (typeof clearAppIndexedDB === 'function') clearTasks.push(clearAppIndexedDB());
    if (typeof clearSmelterIndexedDB === 'function') clearTasks.push(clearSmelterIndexedDB());
    if (typeof clearGadslIndexedDB === 'function') clearTasks.push(clearGadslIndexedDB());

    await Promise.allSettled(clearTasks);
  } catch(e) {
    console.warn("Logout cache clear settled with warning:", e);
  } finally {
    window.location.reload();
  }
}

async function executeAuth() {
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
  btn.textContent = 'Authenticating...'; 
  btn.disabled = true;
  if (errBox) errBox.style.display = 'none';

  try {
    const resp = await fetch(URL_CENTRAL_AUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'authenticate',
        userId: userId,
        password: password
      })
    });
    const res = await resp.json();

    if (res.status === 'success' && res.user) {
      const apiToken = res.token || password;
      setStoredAuthKey(apiToken);
      setStoredUserProfile(res.user);
      
      const lockOverlay = document.getElementById('authLockOverlay');
      if (lockOverlay) lockOverlay.style.display = 'none';
      applyUserTabPermissions(res.user);
      synchronizeAuthorizedData(apiToken, res.user.allowedTabs);
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
  const allowed = (user && Array.isArray(user.allowedTabs)) ? user.allowedTabs : [];
  const tabButtons = document.querySelectorAll('.gnb-tab-btn');
  let firstVisibleTab = '';

  tabButtons.forEach(btn => {
    const tabKey = btn.getAttribute('data-tab');
    if (allowed.includes('all') || allowed.includes(tabKey)) {
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

  // Compliance Save 버튼 등 권한 기반 UI 초기화
  if (typeof updateCompAdminUI === 'function') {
    updateCompAdminUI();
  }

  if (firstVisibleTab) {
    switchView(firstVisibleTab);
  }
}

function synchronizeAuthorizedData(apiToken, allowedTabs = []) {
  const token = apiToken || getStoredAuthKey();
  if (!token) return;

  const isAllowed = k => allowedTabs.includes('all') || allowedTabs.includes(k) || allowedTabs.length === 0;

  if (isAllowed('compliance') && typeof fetchComplianceData === 'function') fetchComplianceData(token);
  if (isAllowed('substance') && typeof syncSubstanceData === 'function') syncSubstanceData(token);
  if (isAllowed('application') && typeof fetchApplicationData === 'function') fetchApplicationData(token);
  if (isAllowed('smelter') && typeof fetchSmelterData === 'function') fetchSmelterData(token);
  if (isAllowed('gadsl') && typeof fetchGadslData === 'function') fetchGadslData(token);
}

function switchView(tabKey) {
  const user = getStoredUserProfile();
  const allowed = user?.allowedTabs || [];
  if (allowed.length && !allowed.includes('all') && !allowed.includes(tabKey)) {
    return;
  }

  document.querySelectorAll('.gnb-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view-panel').forEach(p => p.classList.remove('active'));

  const targetBtn = document.getElementById(`btnTab${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`);
  const targetView = document.getElementById(`view${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`);

  if (targetBtn) targetBtn.classList.add('active');
  if (targetView) targetView.classList.add('active');

  const token = getStoredAuthKey();

  if (tabKey === 'compliance') {
    if (typeof updateCompAdminUI === 'function') updateCompAdminUI();
    if ((!window.compDataset || !window.compDataset.length) && typeof fetchComplianceData === 'function') {
      fetchComplianceData(token);
    }
  }
  if (tabKey === 'substance' && (!window.substanceDataset || !window.substanceDataset.length) && typeof syncSubstanceData === 'function') {
    syncSubstanceData(token);
  }
  if (tabKey === 'application' && (!window.applicationDataset || !window.applicationDataset.length)) {
    if (typeof initApplicationModule === 'function') {
      initApplicationModule().then(() => {
        if ((!window.applicationDataset || !window.applicationDataset.length) && token && typeof fetchApplicationData === 'function') {
          fetchApplicationData(token);
        }
      });
    }
  }
  if (tabKey === 'smelter' && (!window.consolidatedDataStore || !window.consolidatedDataStore.length)) {
    if (typeof initSmelterModule === 'function') {
      initSmelterModule().then(() => {
        if ((!window.consolidatedDataStore || !window.consolidatedDataStore.length) && token && typeof fetchSmelterData === 'function') {
          fetchSmelterData(token);
        }
      });
    }
  }
  if (tabKey === 'gadsl' && (!window.gadslCasData || !window.gadslCasData.length)) {
    if (typeof initGadslModule === 'function') {
      initGadslModule().then(() => {
        if ((!window.gadslCasData || !window.gadslCasData.length) && token && typeof fetchGadslData === 'function') {
          fetchGadslData(token);
        }
      });
    }
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

    await Promise.allSettled(initTasks);
  } catch(e) {
    console.warn("Module init warning:", e);
  }

  const savedToken = getStoredAuthKey();
  const savedProfile = getStoredUserProfile();

  if (savedToken && savedProfile) {
    const lockEl = document.getElementById('authLockOverlay');
    if (lockEl) lockEl.style.display = 'none';
    applyUserTabPermissions(savedProfile);
    synchronizeAuthorizedData(savedToken, savedProfile.allowedTabs);
  } else {
    const lockEl = document.getElementById('authLockOverlay');
    if (lockEl) lockEl.style.display = 'flex';
    setTimeout(() => document.getElementById('authUserIdInput')?.focus(), 50);
  }
});
