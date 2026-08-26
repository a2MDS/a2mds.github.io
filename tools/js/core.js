/* =========================================================================
   GLOBAL CONFIGURATION & AUTH
   ========================================================================= */
const AUTH_KEY = 'a2mds_unified_auth_key';
const PALETTE = ['#16a34a', '#0284c7', '#ea580c', '#dc2626', '#7c3aed', '#059669', '#d97706', '#2563eb', '#db2777', '#4b5563', '#0d9488', '#e11d48'];

const getStoredAuthKey = () => { try { return localStorage.getItem(AUTH_KEY) || ''; } catch(e) { return ''; } };
const setStoredAuthKey = k => { try { localStorage.setItem(AUTH_KEY, k); } catch(e) {} };
const clearStoredAuthKey = () => { try { localStorage.removeItem(AUTH_KEY); } catch(e) {} };

async function executeLogout() {
  clearStoredAuthKey();
  await Promise.all([
    clearCompIndexedDB(),
    clearSubstIndexedDB(),
    clearSmelterIndexedDB(),
    clearGadslIndexedDB()
  ]);
  window.location.reload();
}

async function executeAuth() {
  const input = document.getElementById('authPasswordInput');
  const val = input.value.trim();
  if (!val) return;
  const btn = document.getElementById('authBtnSubmit');
  btn.textContent = 'Verifying...'; btn.disabled = true;

  try {
    const res = await fetchComplianceData(val);
    if (res?.status === 'auth_failed') {
      document.getElementById('authErrorMsg').style.display = 'block';
      input.value = '';
    } else {
      setStoredAuthKey(val);
      document.getElementById('authLockOverlay').style.display = 'none';
      syncSubstanceData(val);
      fetchSmelterData(val);
      fetchGadslData(val); // 로그인 시 GADSL 클라우드 데이터 자동 조회
    }
  } catch(e) {
    document.getElementById('authErrorMsg').style.display = 'block';
  } finally {
    btn.textContent = 'Unlock & Synchronize'; btn.disabled = false;
  }
}

/* =========================================================================
   SPA TAB SWITCHING
   ========================================================================= */
function switchView(tabKey) {
  document.querySelectorAll('.gnb-tab-btn').forEach(btn => btn.classList.remove('active'));
  document.querySelectorAll('.tab-view-panel').forEach(p => p.classList.remove('active'));

  if (tabKey === 'compliance') {
    document.getElementById('btnTabCompliance').classList.add('active');
    document.getElementById('viewCompliance').classList.add('active');
  } else if (tabKey === 'substance') {
    document.getElementById('btnTabSubstance').classList.add('active');
    document.getElementById('viewSubstance').classList.add('active');
  } else if (tabKey === 'smelter') {
    document.getElementById('btnTabSmelter').classList.add('active');
    document.getElementById('viewSmelter').classList.add('active');
  } else if (tabKey === 'gadsl') {
    document.getElementById('btnTabGadsl').classList.add('active');
    document.getElementById('viewGadsl').classList.add('active');
    if (!gadslCasData.length) {
      initGadslModule();
    }
  }
}

/* =========================================================================
   GLOBAL INITIALIZATION & EVENT LISTENERS
   ========================================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  // Tooltip Handler
  const tip = document.getElementById('globalLogTooltip');
  document.addEventListener('mouseover', e => {
    const t = e.target.closest('[data-tooltip]');
    if (t) {
      tip.textContent = t.getAttribute('data-tooltip');
      tip.style.display = 'block'; tip.style.opacity = '1';
      const r = t.getBoundingClientRect(), tr = tip.getBoundingClientRect();
      let top = r.top - tr.height - 8, left = r.left + (r.width / 2) - (tr.width / 2);
      if (top < 10) top = r.bottom + 8;
      if (left < 10) left = 10;
      if (left + tr.width > window.innerWidth - 10) left = window.innerWidth - tr.width - 10;
      tip.style.top = top + 'px'; tip.style.left = left + 'px';
    }
  });
  document.addEventListener('mouseout', e => { if (e.target.closest('[data-tooltip]')) { tip.style.opacity = '0'; tip.style.display = 'none'; } });

  // Dropdown Auto-Close on Click Outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.multiselect-container')) {
      document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
    }
  });

  // 1. IndexedDB 캐시 즉시 복원 (새로고침 즉시 화면 렌더링)
  await Promise.all([
    initComplianceModule(),
    initSubstanceModule(),
    initSmelterModule(),
    initGadslModule()
  ]);

  // 2. 인증 키가 있으면 클라우드(구글 시트) 최신 데이터 자동 동기화
  const savedKey = getStoredAuthKey();
  if (savedKey) {
    document.getElementById('authLockOverlay').style.display = 'none';
    fetchComplianceData(savedKey);
    syncSubstanceData(savedKey);
    fetchSmelterData(savedKey);
    fetchGadslData(savedKey); // GADSL 클라우드 최신 변경점 확인
  } else {
    setTimeout(() => document.getElementById('authPasswordInput')?.focus(), 50);
  }
});
