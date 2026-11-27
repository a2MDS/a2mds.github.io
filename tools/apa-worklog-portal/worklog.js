/* =========================================================================
   a2MDS Consulting - APA Collaboration Portal Frontend (worklog.js)
   Features: RBAC Auth, Monthly Status & Annual-Week Calendar, On-Demand
             Gemini AI Summary, Word Annex I Copy, Activity Log & Minutes CRUD
   ========================================================================= */

// [필수] 배포된 GAS Web App URL로 교체하십시오.
const URL_APA_BACKEND = 'https://script.google.com/macros/s/AKfycbwSN633OVqxmy-cdT65Xr8hQEMNiGrN5Ghqn2Lm5JRng96uLnZ7sxzwYFayNyoSk6-w/exec';
const CONTRACT_TARGET_HOURS = 50.0;

const STORAGE_KEY_TOKEN = 'apa_portal_token';
const STORAGE_KEY_ROLE = 'apa_portal_role';
const STORAGE_KEY_USER = 'apa_portal_user';

// Global State
let apaState = {
  token: '',
  role: 'viewer',
  userId: '',
  sheetUrl: '',
  logs: [],
  minutes: [],
  lastUpdated: '',
  selectedMonth: '',
  logSelectedCategories: new Set(),
  minSelectedStatuses: new Set()
};

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

let logFilterDebounceTimer = null;
let minutesFilterDebounceTimer = null;
let pendingApaDeleteCallback = null;

// =========================================================================
// 1. INITIALIZATION, EVENT DELEGATION & AUTHENTICATION
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  bindDelegatedEvents();

  const savedToken = sessionStorage.getItem(STORAGE_KEY_TOKEN) || '';
  const savedRole = sessionStorage.getItem(STORAGE_KEY_ROLE) || 'viewer';
  const savedUser = sessionStorage.getItem(STORAGE_KEY_USER) || '';

  if (savedToken) {
    apaState.token = savedToken;
    apaState.role = savedRole;
    apaState.userId = savedUser;
    applyRoleUiState();
    document.getElementById('apaAuthOverlay').style.display = 'none';
    syncApaData(false);
  }
});

function closeAllApaDropdowns() {
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
}

function bindDelegatedEvents() {
  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.multiselect-container') && !e.target.closest('.multiselect-dropdown')) {
      closeAllApaDropdowns();
    }
  });

  // Close fixed dropdowns on page/table scroll (ignore scrolling inside dropdown itself) & resize
  document.addEventListener('scroll', (e) => {
    if (e.target && typeof e.target.closest === 'function' && e.target.closest('.multiselect-dropdown')) {
      return;
    }
    if (document.querySelector('.multiselect-dropdown.show')) {
      closeAllApaDropdowns();
    }
  }, true);

  window.addEventListener('resize', closeAllApaDropdowns);

  // Multi-select dropdown checkbox delegation (works even after moving to document.body)
  document.addEventListener('change', (e) => {
    const chk = e.target.closest('.multiselect-dropdown input[type="checkbox"]');
    if (!chk) return;
    const type = chk.dataset.ddType;
    const role = chk.dataset.ddRole;
    if (!type) return;

    if (role === 'select-all') {
      selectAllApaDropdown(type);
    } else if (role === 'option') {
      toggleApaDropdownOption(type, chk);
    }
  });

  // Calendar day click -> jump to Activity Log / Annual month row click -> switch to Monthly view
  document.getElementById('apaCalendarBody')?.addEventListener('click', (e) => {
    const monthRow = e.target.closest('tr.cal-month-clickable');
    if (monthRow && monthRow.dataset.month) {
      apaState.selectedMonth = monthRow.dataset.month;
      populateMonthSelector();
      const editor = document.getElementById('apaSummaryEditor');
      if (editor) editor.value = '';
      renderMonthlyStatusView();
      return;
    }

    const td = e.target.closest('td.cal-day-clickable');
    if (!td || !td.dataset.date) return;
    jumpToLogByDate(td.dataset.date);
  });

  // Category Breakdown click -> jump to Activity Log
  document.getElementById('apaCategoryBreakdownList')?.addEventListener('click', (e) => {
    const item = e.target.closest('.cat-item');
    if (!item || !item.dataset.category) return;
    jumpToLogByCategory(item.dataset.category);
  });

  // Activity Log table actions delegation
  document.getElementById('apaLogTableBody')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const id = btn.dataset.id;
    if (!id) return;

    if (btn.dataset.action === 'edit-log') {
      openApaLogModal(id);
    } else if (btn.dataset.action === 'delete-log') {
      deleteApaLog(id);
    }
  });

  // Meeting Minutes table actions & inline textarea delegation
  const minTbody = document.getElementById('apaMinutesTableBody');
  if (minTbody) {
    minTbody.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (isNaN(idx)) return;

      if (btn.dataset.action === 'edit-minute') {
        openApaMinuteModalByIdx(idx);
      } else if (btn.dataset.action === 'delete-minute') {
        deleteApaMinuteByIdx(idx);
      }
    });

    minTbody.addEventListener('focusin', (e) => {
      if (e.target.classList.contains('apa-inline-details')) {
        autoResizeInlineTextarea(e.target);
      }
    });

    minTbody.addEventListener('input', (e) => {
      if (e.target.classList.contains('apa-inline-details')) {
        autoResizeInlineTextarea(e.target);
      }
    });

    minTbody.addEventListener('focusout', (e) => {
      if (e.target.classList.contains('apa-inline-details')) {
        saveInlineMinuteDetails(e.target);
      }
    });

    minTbody.addEventListener('keydown', (e) => {
      if (e.target.classList.contains('apa-inline-details')) {
        handleInlineDetailsKeydown(e, e.target);
      }
    });
  }
}

async function executeApaLogin() {
  const idInput = document.getElementById('apaLoginId');
  const pwInput = document.getElementById('apaLoginPw');
  const errEl = document.getElementById('apaLoginError');
  const btn = document.getElementById('btnApaLoginSubmit');

  const userId = (idInput?.value || '').trim();
  const password = pwInput?.value || '';

  if (!userId || !password) {
    showLoginError('Please enter both User ID and Password.');
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Authenticating...';

  try {
    const res = await callApaApi({ action: 'login', userId, password }, false);
    if (res && res.status === 'success' && res.token) {
      apaState.token = res.token;
      apaState.role = res.role || 'viewer';
      apaState.userId = res.userId || userId;

      sessionStorage.setItem(STORAGE_KEY_TOKEN, apaState.token);
      sessionStorage.setItem(STORAGE_KEY_ROLE, apaState.role);
      sessionStorage.setItem(STORAGE_KEY_USER, apaState.userId);

      pwInput.value = '';
      applyRoleUiState();
      document.getElementById('apaAuthOverlay').style.display = 'none';
      await syncApaData(true);
    } else {
      showLoginError(res?.message || 'Invalid credentials.');
    }
  } catch (err) {
    showLoginError('Connection error. Please verify backend deployment.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign In & Sync';
  }
}

function showLoginError(msg) {
  const errEl = document.getElementById('apaLoginError');
  if (errEl) {
    errEl.textContent = msg;
    errEl.style.display = 'block';
  }
}

function clearSensitiveApaData() {
  sessionStorage.removeItem(STORAGE_KEY_TOKEN);
  sessionStorage.removeItem(STORAGE_KEY_ROLE);
  sessionStorage.removeItem(STORAGE_KEY_USER);

  apaState.token = '';
  apaState.role = 'viewer';
  apaState.userId = '';
  apaState.sheetUrl = '';
  apaState.logs = [];
  apaState.minutes = [];
  apaState.lastUpdated = '';
  apaState.selectedMonth = '';
  apaState.logSelectedCategories.clear();
  apaState.minSelectedStatuses.clear();
  pendingApaDeleteCallback = null;

  closeAllApaDropdowns();
  closeApaLogModal();
  closeApaMinuteModal();
  closeApaDeleteModal();

  ['apaCalendarBody', 'apaCategoryBreakdownList', 'apaLogTableBody', 'apaMinutesTableBody'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });

  const editor = document.getElementById('apaSummaryEditor');
  if (editor) editor.value = '';

  const textResets = {
    kpiTotalHours: '0.0 hrs',
    kpiRemainingHours: '50.0 hrs',
    kpiEntryCount: '0 items',
    kpiActiveDaysSub: '0 active working days',
    kpiAvgDailySub: 'Avg 0.0 hrs / active day',
    apaCatTotalLabel: '0.0 hrs',
    apaCalMonthBadge: '-',
    apaLastSyncedBadge: 'Last Synced: -',
    apaLogCountBadge: '0 records',
    apaMinutesCountBadge: '0 items'
  };
  Object.entries(textResets).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  });

  const viewSheetBtn = document.getElementById('btnViewSheetData');
  if (viewSheetBtn) viewSheetBtn.style.display = 'none';

  applyRoleUiState();
}

async function executeApaLogout() {
  const token = apaState.token;
  clearSensitiveApaData();

  document.getElementById('apaAuthOverlay').style.display = 'flex';
  document.getElementById('apaLoginId')?.focus();

  if (token) {
    callApaApi({ action: 'logout', token }, false).catch(() => {});
  }
}

function applyRoleUiState() {
  const isAdmin = apaState.role === 'admin';
  document.body.classList.toggle('role-admin', isAdmin);
  document.body.classList.toggle('role-viewer', !isAdmin);

  const badge = document.getElementById('apaUserBadge');
  if (badge) {
    if (apaState.userId) {
      badge.style.display = 'inline-flex';
      badge.innerHTML = `${escapeHtml(apaState.userId)} <span class="apa-role-pill ${isAdmin ? 'admin' : 'viewer'}">${isAdmin ? 'Admin' : 'Viewer'}</span>`;
    } else {
      badge.style.display = 'none';
    }
  }
}

// =========================================================================
// 2. API HELPER & DATA SYNCHRONIZATION
// =========================================================================
async function callApaApi(payload, requireAuth = true) {
  if (requireAuth) {
    if (!apaState.token) {
      handleUnauthorizedSession();
      throw new Error('No active session.');
    }
    payload.token = apaState.token;
  }

  const resp = await fetch(URL_APA_BACKEND, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });

  const data = await resp.json();
  if (data && data.status === 'unauthorized') {
    handleUnauthorizedSession();
    throw new Error(data.message || 'Session expired.');
  }
  return data;
}

function handleUnauthorizedSession() {
  clearSensitiveApaData();
  document.getElementById('apaAuthOverlay').style.display = 'flex';
  showLoginError('Session expired. Please sign in again.');
}

async function syncApaData(showAlertOnErr = false) {
  const syncBadge = document.getElementById('apaLastSyncedBadge');
  if (syncBadge) syncBadge.textContent = 'Syncing...';

  try {
    const res = await callApaApi({ action: 'fetch_data' }, true);
    if (res && res.status === 'success') {
      apaState.logs = Array.isArray(res.logs) ? res.logs : [];
      apaState.minutes = Array.isArray(res.minutes) ? res.minutes : [];
      apaState.lastUpdated = res.lastUpdated || '';
      apaState.sheetUrl = res.sheetUrl || '';

      if (res.role && res.role !== apaState.role) {
        apaState.role = res.role;
        sessionStorage.setItem(STORAGE_KEY_ROLE, res.role);
        applyRoleUiState();
      }

      const viewSheetBtn = document.getElementById('btnViewSheetData');
      if (viewSheetBtn) {
        viewSheetBtn.style.display = apaState.sheetUrl ? 'inline-flex' : 'none';
      }

      if (syncBadge) {
        syncBadge.textContent = `Last Synced: ${apaState.lastUpdated} KST`;
      }

      populateMonthSelector();
      populateCategorySelectOptions();
      renderMonthlyStatusView();
      renderApaLogTable();
      renderApaMinutesTable();
    } else if (showAlertOnErr) {
      alert(res?.message || 'Failed to sync data.');
    }
  } catch (err) {
    if (syncBadge) syncBadge.textContent = 'Sync Failed';
    if (showAlertOnErr) alert(err.message || 'Network error during sync.');
  }
}

function openApaSourceSheet() {
  if (!apaState.sheetUrl) return;
  window.open(apaState.sheetUrl, '_blank', 'noopener,noreferrer');
}

function switchApaSubTab(tabKey, btnElem) {
  closeAllApaDropdowns();
  document.querySelectorAll('.gnb-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-view-panel').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const btnMap = {
      monthly: 'btnApaTabMonthly',
      log: 'btnApaTabLog',
      minutes: 'btnApaTabMinutes'
    };
    document.getElementById(btnMap[tabKey])?.classList.add('active');
  }

  const paneMap = {
    monthly: 'apaPaneMonthly',
    log: 'apaPaneLog',
    minutes: 'apaPaneMinutes'
  };
  const targetPane = document.getElementById(paneMap[tabKey]);
  if (targetPane) targetPane.classList.add('active');

  if (tabKey === 'minutes') {
    requestAnimationFrame(resizeAllInlineMinuteTextareas);
  }
}

// =========================================================================
// 3. MONTHLY STATUS ENGINE (KPI, ANNUAL-WEEK CALENDAR, CATEGORY, AI SUMMARY)
// =========================================================================
function getLoggedMonthsSorted() {
  const monthSet = new Set();
  apaState.logs.forEach(l => {
    if (l.date && /^\d{4}-\d{2}/.test(l.date)) {
      monthSet.add(l.date.slice(0, 7));
    }
  });

  // Fallback only when no logs exist at all
  if (monthSet.size === 0) {
    monthSet.add(getTodayKst().slice(0, 7));
  }

  return Array.from(monthSet).sort((a, b) => b.localeCompare(a));
}

function populateMonthSelector() {
  const yearSelect = document.getElementById('apaYearSelect');
  const monthSelect = document.getElementById('apaMonthSelect');
  if (!monthSelect) return;

  const sortedMonths = getLoggedMonthsSorted();
  const sortedYears = Array.from(new Set(sortedMonths.map(ym => ym.slice(0, 4))))
    .sort((a, b) => b.localeCompare(a));

  const isCurrentAnnual = apaState.selectedMonth && apaState.selectedMonth.endsWith('-ALL');
  const currentYearPart = apaState.selectedMonth ? apaState.selectedMonth.slice(0, 4) : '';

  if (
    !apaState.selectedMonth ||
    (isCurrentAnnual && !sortedYears.includes(currentYearPart)) ||
    (!isCurrentAnnual && !sortedMonths.includes(apaState.selectedMonth))
  ) {
    apaState.selectedMonth = sortedMonths[0];
  }

  const selectedYear = apaState.selectedMonth.slice(0, 4);

  if (yearSelect) {
    yearSelect.innerHTML = sortedYears.map(y =>
      `<option value="${y}" ${y === selectedYear ? 'selected' : ''}>${y}</option>`
    ).join('');
  }

  const allVal = `${selectedYear}-ALL`;
  const monthsInYear = sortedMonths.filter(ym => ym.startsWith(`${selectedYear}-`));
  const optionsHtml = [
    `<option value="${allVal}" ${apaState.selectedMonth === allVal ? 'selected' : ''}>All (${selectedYear} Annual)</option>`,
    ...monthsInYear.map(ym => {
      const [, m] = ym.split('-');
      const label = `${MONTH_NAMES_FULL[parseInt(m, 10) - 1]} (${m})`;
      return `<option value="${ym}" ${ym === apaState.selectedMonth ? 'selected' : ''}>${label}</option>`;
    })
  ];

  monthSelect.innerHTML = optionsHtml.join('');
}

function onApaYearChange(year) {
  if (!year) return;
  apaState.selectedMonth = `${year}-ALL`;

  populateMonthSelector();
  const editor = document.getElementById('apaSummaryEditor');
  if (editor) editor.value = '';
  renderMonthlyStatusView();
}

function onApaMonthChange(ym) {
  apaState.selectedMonth = ym;
  const editor = document.getElementById('apaSummaryEditor');
  if (editor) editor.value = '';
  renderMonthlyStatusView();
}

function renderMonthlyStatusView() {
  const ym = apaState.selectedMonth || getTodayKst().slice(0, 7);
  const isAnnual = ym.endsWith('-ALL');
  const yearStr = ym.slice(0, 4);

  const btnCopy = document.getElementById('btnCopyAnnex');
  if (btnCopy) {
    btnCopy.disabled = isAnnual;
    btnCopy.style.opacity = isAnnual ? '0.45' : '';
    btnCopy.style.cursor = isAnnual ? 'not-allowed' : '';
    btnCopy.title = isAnnual ? 'Select a specific month to copy Invoice Annex I' : 'Copy monthly summary for Invoice';
  }
  const btnAi = document.getElementById('btnAiSummarize');
  if (btnAi) {
    btnAi.disabled = isAnnual;
    btnAi.style.opacity = isAnnual ? '0.45' : '';
    btnAi.style.cursor = isAnnual ? 'not-allowed' : '';
    btnAi.title = isAnnual ? 'Select a specific month to run AI Summarize' : 'Generate monthly AI summary';
  }

  const targetLogs = isAnnual
    ? apaState.logs.filter(l => l.date && l.date.startsWith(`${yearStr}-`))
    : apaState.logs.filter(l => l.date && l.date.startsWith(ym));

  const dailyMap = {};
  const catMap = {};
  const activeMonthsSet = new Set();
  let totalHours = 0;

  targetLogs.forEach(l => {
    const h = Number(l.hours) || 0;
    totalHours += h;
    dailyMap[l.date] = (dailyMap[l.date] || 0) + h;
    if (l.date && l.date.length >= 7) activeMonthsSet.add(l.date.slice(0, 7));
    const cat = l.category || 'Others';
    catMap[cat] = (catMap[cat] || 0) + h;
  });

  totalHours = Math.round(totalHours * 100) / 100;
  const activeDaysCount = Object.keys(dailyMap).filter(d => dailyMap[d] > 0).length;

  const totalTitleEl = document.getElementById('kpiTotalTitle');
  const remTitleEl = document.getElementById('kpiRemainingTitle');
  const remEl = document.getElementById('kpiRemainingHours');
  const bar = document.getElementById('kpiProgressBar');

  document.getElementById('kpiTotalHours').textContent = `${totalHours.toFixed(1)} hrs`;

  if (isAnnual) {
    const activeMonthsCount = activeMonthsSet.size;
    const annualTarget = activeMonthsCount * CONTRACT_TARGET_HOURS;
    const pct = annualTarget > 0 ? Math.round((totalHours / annualTarget) * 100) : 0;
    const avgMonthly = activeMonthsCount > 0 ? (totalHours / activeMonthsCount) : 0;

    if (totalTitleEl) totalTitleEl.textContent = `Logged Hours (${yearStr} Annual)`;
    if (bar) {
      bar.style.width = `${Math.min(pct, 100)}%`;
      bar.classList.toggle('over', annualTarget > 0 && totalHours > annualTarget);
    }

    if (remTitleEl) remTitleEl.textContent = 'Monthly Average';
    if (remEl) {
      remEl.textContent = `${avgMonthly.toFixed(1)} hrs`;
      remEl.className = 'kpi-card-value kpi-val-main';
    }
    document.getElementById('kpiActiveDaysSub').textContent = `${activeMonthsCount} active months · ${activeDaysCount} days`;
  } else {
    const remaining = Math.round((CONTRACT_TARGET_HOURS - totalHours) * 100) / 100;
    const pct = Math.round((totalHours / CONTRACT_TARGET_HOURS) * 100);

    if (totalTitleEl) totalTitleEl.textContent = 'Logged Hours (Target: 50.0h)';
    if (bar) {
      bar.style.width = `${Math.min(pct, 100)}%`;
      bar.classList.toggle('over', totalHours > CONTRACT_TARGET_HOURS);
    }

    if (remTitleEl) remTitleEl.textContent = 'Remaining Allocation';
    if (remEl) {
      if (remaining >= 0) {
        remEl.textContent = `${remaining.toFixed(1)} hrs`;
        remEl.className = 'kpi-card-value kpi-val-main';
      } else {
        remEl.textContent = `+${Math.abs(remaining).toFixed(1)} hrs`;
        remEl.className = 'kpi-card-value kpi-val-amber';
      }
    }
    document.getElementById('kpiActiveDaysSub').textContent = `${activeDaysCount} active working days`;
  }

  document.getElementById('kpiEntryCount').textContent = `${targetLogs.length} items`;
  const avgDaily = activeDaysCount > 0 ? (totalHours / activeDaysCount) : 0;
  document.getElementById('kpiAvgDailySub').textContent = `Avg ${avgDaily.toFixed(1)} hrs / active day`;

  const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);

  if (isAnnual) {
    renderAnnualSummaryGrid(yearStr, targetLogs, totalHours);
  } else {
    const year = parseInt(yearStr, 10);
    const monthIdx = parseInt(ym.slice(5, 7), 10) - 1;
    renderMonthlyCalendarGrid(year, monthIdx, dailyMap, totalHours);
  }

  renderCategoryBreakdown(sortedCats, totalHours);
}

/**
 * Calculates Sunday-start annual week number (Excel WEEKNUM(date, 1) standard)
 * e.g., 2026-11-01 (Sun) -> Week 45
 */
function getAnnualWeekNumberSun(weekSundayDate, targetYear) {
  const jan1 = new Date(Date.UTC(targetYear, 0, 1));
  const firstSundayUtc = Date.UTC(targetYear, 0, 1 - jan1.getUTCDay());
  const currentSundayUtc = Date.UTC(
    weekSundayDate.getFullYear(),
    weekSundayDate.getMonth(),
    weekSundayDate.getDate()
  );
  const diffDays = Math.round((currentSundayUtc - firstSundayUtc) / 86400000);
  return Math.floor(diffDays / 7) + 1;
}

function buildWeeklyCalendarMatrix(year, monthIdx, dailyMap) {
  const firstDayOfMonth = new Date(year, monthIdx, 1);
  const lastDayOfMonth = new Date(year, monthIdx + 1, 0);

  const startDate = new Date(year, monthIdx, 1 - firstDayOfMonth.getDay());
  const endDate = new Date(year, monthIdx, lastDayOfMonth.getDate() + (6 - lastDayOfMonth.getDay()));

  const weeks = [];
  let cursor = new Date(startDate);

  while (cursor <= endDate) {
    const weekSunday = new Date(cursor);
    const annualWeekNum = getAnnualWeekNumberSun(weekSunday, year);
    const days = [];
    let weekSubtotal = 0;

    for (let d = 0; d < 7; d++) {
      const y = cursor.getFullYear();
      const m = cursor.getMonth();
      const dayNum = cursor.getDate();
      const iso = `${y}-${String(m + 1).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
      const isCurrentMonth = (m === monthIdx);
      const hrs = isCurrentMonth ? (Math.round((dailyMap[iso] || 0) * 100) / 100) : 0;

      if (isCurrentMonth) weekSubtotal += hrs;

      days.push({
        iso,
        label: `${dayNum}-${MONTH_NAMES_SHORT[m]}`,
        isCurrentMonth,
        hours: hrs
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    weeks.push({
      weekLabel: `Week ${annualWeekNum}`,
      days,
      subtotal: Math.round(weekSubtotal * 100) / 100
    });
  }
  return weeks;
}

function renderMonthlyCalendarGrid(year, monthIdx, dailyMap, totalHours) {
  const tbody = document.getElementById('apaCalendarBody');
  const badge = document.getElementById('apaCalMonthBadge');
  const titleEl = document.getElementById('apaCalTitleText');
  const colgroup = document.getElementById('apaCalColgroup');
  const thead = document.getElementById('apaCalHead');
  if (!tbody) return;

  if (titleEl) titleEl.textContent = '📅 Weekly Hours Breakdown';
  if (badge) badge.textContent = `${MONTH_NAMES_FULL[monthIdx]} ${year}`;

  if (colgroup) {
    colgroup.innerHTML = `
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 11%;">
      <col style="width: 12%;">`;
  }
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th>Week</th>
        <th>Sun</th>
        <th>Mon</th>
        <th>Tue</th>
        <th>Wed</th>
        <th>Thu</th>
        <th>Fri</th>
        <th>Sat</th>
        <th>Subtotal</th>
      </tr>`;
  }

  const weeks = buildWeeklyCalendarMatrix(year, monthIdx, dailyMap);

  let html = weeks.map(w => {
    const dayCells = w.days.map(d => {
      if (!d.isCurrentMonth) {
        return `<td style="background:#f8fafc; color:#cbd5e1;"><div class="text-xs">${d.label}</div><div class="text-sm">-</div></td>`;
      }
      const hasHours = d.hours > 0;
      const hrsText = hasHours ? d.hours.toFixed(1) : '-';
      const hrsStyle = hasHours
        ? 'color:var(--primary-green); font-weight:700; margin-top:2px;'
        : 'color:var(--text-muted); margin-top:2px;';
      const cellAttrs = hasHours
        ? `class="cal-day-clickable" data-date="${escapeHtmlAttr(d.iso)}" title="Click to view logs on ${escapeHtmlAttr(d.iso)}"`
        : '';
      return `
        <td ${cellAttrs}>
          <div class="text-xs text-muted">${d.label}</div>
          <div class="text-sm" style="${hrsStyle}">${hrsText}</div>
        </td>`;
    }).join('');

    return `
      <tr>
        <td class="text-main">${w.weekLabel}</td>
        ${dayCells}
        <td class="text-main">${w.subtotal > 0 ? w.subtotal.toFixed(1) : '0.0'}</td>
      </tr>`;
  }).join('');

  html += `
    <tr class="cal-total-row">
      <td colspan="8" style="text-align:right !important; padding-right:16px !important;">Total Logged Hours (${MONTH_NAMES_SHORT[monthIdx]} ${year})</td>
      <td style="color:var(--primary-green);">${totalHours.toFixed(1)} hrs</td>
    </tr>`;

  tbody.innerHTML = html;
}

function renderAnnualSummaryGrid(yearStr, yearLogs, totalHours) {
  const tbody = document.getElementById('apaCalendarBody');
  const badge = document.getElementById('apaCalMonthBadge');
  const titleEl = document.getElementById('apaCalTitleText');
  const colgroup = document.getElementById('apaCalColgroup');
  const thead = document.getElementById('apaCalHead');
  if (!tbody) return;

  if (titleEl) titleEl.textContent = '📅 Monthly Hours Summary';
  if (badge) badge.textContent = `${yearStr} Annual`;

  if (colgroup) {
    colgroup.innerHTML = `
      <col style="width: 26%;">
      <col style="width: 18%;">
      <col style="width: 18%;">
      <col style="width: 19%;">
      <col style="width: 19%;">`;
  }
  if (thead) {
    thead.innerHTML = `
      <tr>
        <th>Month</th>
        <th>Active Days</th>
        <th>Entries</th>
        <th>Logged Hours</th>
        <th>Target (50.0h)</th>
      </tr>`;
  }

  const monthMap = {};
  yearLogs.forEach(l => {
    const mKey = l.date.slice(0, 7);
    if (!monthMap[mKey]) {
      monthMap[mKey] = { hours: 0, entries: 0, days: new Set() };
    }
    const h = Number(l.hours) || 0;
    monthMap[mKey].hours += h;
    monthMap[mKey].entries += 1;
    if (h > 0) monthMap[mKey].days.add(l.date);
  });

  const sortedMonthKeys = Object.keys(monthMap).sort((a, b) => b.localeCompare(a));

  if (!sortedMonthKeys.length) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-state-row text-sm">No logs recorded for ${escapeHtml(yearStr)}.</td></tr>`;
    return;
  }

  let totalActiveDays = 0;
  let html = sortedMonthKeys.map(mKey => {
    const info = monthMap[mKey];
    const mIdx = parseInt(mKey.slice(5, 7), 10) - 1;
    const monthLabel = `${yearStr} ${MONTH_NAMES_FULL[mIdx]}`;
    const hrs = Math.round(info.hours * 100) / 100;
    const pct = Math.round((hrs / CONTRACT_TARGET_HOURS) * 100);
    const activeDays = info.days.size;
    totalActiveDays += activeDays;

    return `
      <tr class="cal-month-clickable" data-month="${escapeHtmlAttr(mKey)}" title="Click to view ${escapeHtmlAttr(monthLabel)} weekly breakdown">
        <td class="text-main">${escapeHtml(monthLabel)}</td>
        <td class="text-sm">${activeDays} days</td>
        <td class="text-sm">${info.entries} items</td>
        <td class="text-sm" style="color:var(--primary-green);">${hrs.toFixed(1)} hrs</td>
        <td class="text-sm">${pct}%</td>
      </tr>`;
  }).join('');

  const avgMonthly = sortedMonthKeys.length > 0 ? (totalHours / sortedMonthKeys.length) : 0;
  html += `
    <tr class="cal-total-row">
      <td>Total (${escapeHtml(yearStr)})</td>
      <td>${totalActiveDays} days</td>
      <td>${yearLogs.length} items</td>
      <td style="color:var(--primary-green);">${totalHours.toFixed(1)} hrs</td>
      <td>Avg ${avgMonthly.toFixed(1)} hrs/mo</td>
    </tr>`;

  tbody.innerHTML = html;
}

function renderCategoryBreakdown(sortedCats, totalHours) {
  const listEl = document.getElementById('apaCategoryBreakdownList');
  const totalEl = document.getElementById('apaCatTotalLabel');
  if (!listEl) return;

  if (totalEl) totalEl.textContent = `${totalHours.toFixed(1)} hrs`;

  if (!sortedCats.length || totalHours <= 0) {
    listEl.innerHTML = '<div class="text-sm text-muted">No logs recorded for this month.</div>';
    return;
  }

  const colors = ['#16a34a', '#0284c7', '#d97706', '#7c3aed', '#475569'];

  listEl.innerHTML = sortedCats.map(([cat, hrs], idx) => {
    const pct = Math.round((hrs / totalHours) * 100);
    const color = colors[idx % colors.length];
    const safeCatAttr = escapeHtmlAttr(cat);
    return `
      <div class="cat-item" data-category="${safeCatAttr}" title="Click to view ${safeCatAttr} logs in ${escapeHtmlAttr(apaState.selectedMonth)}">
        <div class="cat-item-top">
          <span class="cat-item-name">${escapeHtml(cat)}</span>
          <span class="cat-item-val">${hrs.toFixed(1)} hrs (${pct}%)</span>
        </div>
        <div class="cat-bar-bg">
          <div class="cat-bar-fill" style="width:${pct}%; background:${color};"></div>
        </div>
      </div>`;
  }).join('');
}

function jumpToLogByDate(isoDate) {
  if (!isoDate) return;
  resetApaLogFilters();
  const dateFilter = document.getElementById('filterLogDate');
  if (dateFilter) dateFilter.value = isoDate;
  renderApaLogTable();
  switchApaSubTab('log');
}

function jumpToLogByCategory(categoryName) {
  if (!categoryName) return;
  resetApaLogFilters();
  const dateFilter = document.getElementById('filterLogDate');
  if (dateFilter && apaState.selectedMonth) {
    dateFilter.value = apaState.selectedMonth.endsWith('-ALL')
      ? apaState.selectedMonth.slice(0, 4)
      : apaState.selectedMonth;
  }
  apaState.logSelectedCategories.add(categoryName);
  updateApaDropdownButtonText('logCat');
  renderApaLogTable();
  switchApaSubTab('log');
}

async function runApaAiSummarize() {
  const ym = apaState.selectedMonth;
  if (!ym || ym.endsWith('-ALL')) return;

  const btn = document.getElementById('btnAiSummarize');
  const origText = btn.innerHTML;

  btn.disabled = true;
  btn.innerHTML = '⏳ Summarizing...';

  try {
    const res = await callApaApi({ action: 'ai_summarize', monthKey: ym }, true);
    if (res && res.status === 'success' && res.summary) {
      const editor = document.getElementById('apaSummaryEditor');
      if (editor) editor.value = res.summary;
    } else {
      alert(res?.message || 'AI summarization failed.');
    }
  } catch (err) {
    alert(err.message || 'Error calling Gemini API.');
  } finally {
    btn.disabled = false;
    btn.innerHTML = origText;
  }
}

// =========================================================================
// 4. WORD INVOICE ANNEX I CLIPBOARD COPY (HTML Table + Plain Text)
// =========================================================================
async function copyAnnexForInvoice() {
  const ym = apaState.selectedMonth || getTodayKst().slice(0, 7);
  if (ym.endsWith('-ALL')) return;
  const [yearStr, monthStr] = ym.split('-');
  const year = parseInt(yearStr, 10);
  const monthIdx = parseInt(monthStr, 10) - 1;

  const monthLogs = apaState.logs.filter(l => l.date && l.date.startsWith(ym));
  const dailyMap = {};
  const catMap = {};
  let totalHours = 0;

  monthLogs.forEach(l => {
    const h = Number(l.hours) || 0;
    totalHours += h;
    dailyMap[l.date] = (dailyMap[l.date] || 0) + h;
    const cat = (l.category || 'Others').trim();
    catMap[cat] = (catMap[cat] || 0) + h;
  });
  totalHours = Math.round(totalHours * 100) / 100;

  const weeks = buildWeeklyCalendarMatrix(year, monthIdx, dailyMap);
  const summaryText = (document.getElementById('apaSummaryEditor')?.value || '').trim();
  const sortedCats = Object.entries(catMap).sort((a, b) => b[1] - a[1]);
  const portalUrl = 'https://a2mds.com/tools/apa-worklog-portal/';

  // 1) Weekly Hours Table (Unified Pretendard 10pt + Word-safe <p align="center">)
  const baseFont = 'font-family:Pretendard,Calibri,Arial,sans-serif;';
  const thStyle = `border:1px solid #94a3b8; background-color:#f1f5f9; padding:7px 4px; ${baseFont} font-size:10pt; font-weight:bold; text-align:center; vertical-align:middle; color:#0f172a; white-space:nowrap;`;
  const tdStyle = `border:1px solid #94a3b8; padding:6px 4px; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; text-align:center; vertical-align:middle; color:#1e293b;`;
  const pCenterBold = `margin:0; padding:0; text-align:center; ${baseFont} font-size:10pt; font-weight:bold; color:#0f172a;`;
  const pCenterPlain = `margin:0; padding:0; text-align:center; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; color:#1e293b;`;

  let htmlRows = `
    <tr>
      <th align="center" valign="middle" nowrap style="${thStyle} width:14%;"><p align="center" style="${pCenterBold}">Week</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Sun</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Mon</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Tue</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Wed</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Thu</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Fri</p></th>
      <th align="center" valign="middle" style="${thStyle} width:10.5%;"><p align="center" style="${pCenterBold}">Sat</p></th>
      <th align="center" valign="middle" style="${thStyle} width:12.5%;"><p align="center" style="${pCenterBold}">Total</p></th>
    </tr>`;

  weeks.forEach(w => {
    const cells = w.days.map((d, dayIdx) => {
      if (dayIdx === 0 || dayIdx === 6) {
        // Sun & Sat: Show date label (all dates); show hours below only if current month & > 0 (Pretendard 10pt, unbolded)
        const weekendHrs = (d.isCurrentMonth && d.hours > 0)
          ? `<br><span style="${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; color:#1e293b;">${d.hours.toFixed(1)}</span>`
          : '';
        return `<td align="center" valign="middle" style="${tdStyle}"><p align="center" style="${pCenterPlain}"><span style="color:#64748b; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal;">${d.label}</span>${weekendHrs}</p></td>`;
      }
      // Mon ~ Fri: Show hours only (no date, no '-', Pretendard 10pt, unbolded & centered)
      const val = (d.isCurrentMonth && d.hours > 0)
        ? `<span style="${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal;">${d.hours.toFixed(1)}</span>`
        : '&nbsp;';
      return `<td align="center" valign="middle" style="${tdStyle}"><p align="center" style="${pCenterPlain}">${val}</p></td>`;
    }).join('');
    const subText = w.subtotal > 0
      ? `<span style="${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal;">${w.subtotal.toFixed(1)}</span>`
      : '&nbsp;';
    htmlRows += `
      <tr>
        <td align="center" valign="middle" nowrap style="${tdStyle} background-color:#f8fafc; white-space:nowrap;"><p align="center" style="${pCenterPlain}"><span style="${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal;">${w.weekLabel}</span></p></td>
        ${cells}
        <td align="center" valign="middle" style="${tdStyle} background-color:#f8fafc;"><p align="center" style="${pCenterPlain}">${subText}</p></td>
      </tr>`;
  });

  htmlRows += `
    <tr>
      <td colspan="8" align="center" valign="middle" style="${tdStyle} background-color:#f1f5f9; font-weight:bold;"><p align="center" style="${pCenterBold}">Total</p></td>
      <td align="center" valign="middle" style="${tdStyle} background-color:#f1f5f9; font-weight:bold;"><p align="center" style="${pCenterBold}">${totalHours.toFixed(1)}</p></td>
    </tr>`;

  const calendarTableHtml = `<table border="1" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%; table-layout:fixed;">${htmlRows}</table>`;

  // 2) Independent Key Activities Section (Pretendard 10pt, unified '•' bullet with hanging indent table)
  const summaryLines = summaryText
    ? summaryText.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    : [];

  const bodyTextStyle = `margin:0; text-align:left; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5; color:#1e293b;`;

  let keyActivitiesBodyHtml = '';
  if (summaryLines.length > 0) {
    const bulletRows = summaryLines.map(line => {
      const bulletMatch = line.match(/^[-*•]\s*(.+)$/);
      if (bulletMatch) {
        const cleanText = escapeHtml(bulletMatch[1]);
        return `
          <tr>
            <td align="left" valign="top" style="width:14px; padding:1px 0; vertical-align:top; text-align:left; border:none; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5; color:#1e293b;">
              <p align="left" style="${bodyTextStyle}">&#8226;</p>
            </td>
            <td align="left" valign="top" style="padding:1px 0; vertical-align:top; text-align:left; border:none; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5; color:#1e293b;">
              <p align="left" style="${bodyTextStyle}">${cleanText}</p>
            </td>
          </tr>`;
      }
      return `
        <tr>
          <td colspan="2" align="left" valign="top" style="padding:1px 0; vertical-align:top; text-align:left; border:none; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5; color:#1e293b;">
            <p align="left" style="${bodyTextStyle}">${escapeHtml(line)}</p>
          </td>
        </tr>`;
    }).join('');

    keyActivitiesBodyHtml = `<table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%;">${bulletRows}</table>`;
  } else {
    keyActivitiesBodyHtml = `<p align="left" style="margin:0; text-align:left; color:#94a3b8; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5;">No summary entered.</p>`;
  }

  const sectionHeaderStyle = `border-left:3px solid #16a34a; padding-left:8px; ${baseFont} font-size:10pt; font-weight:bold; color:#0f172a; margin:0 0 8px 0; text-align:left;`;
  const greenBullet = `<span style="color:#16a34a; font-weight:bold;">&#9642;</span>`;
  const sectionSpacerHtml = `<p style="${baseFont} font-size:10pt; line-height:1.5; margin:0;">&nbsp;</p><p style="${baseFont} font-size:10pt; line-height:1.5; margin:0;">&nbsp;</p>`;

  const keyActivitiesHtml = `
    ${sectionSpacerHtml}
    <p align="left" style="${sectionHeaderStyle}">${greenBullet} Key Activities</p>
    <table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%;">
      <tr>
        <td align="left" style="border:1px solid #e2e8f0; background-color:#f8fafc; padding:10px 12px; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; line-height:1.5; color:#1e293b; text-align:left;">
          ${keyActivitiesBodyHtml}
        </td>
      </tr>
    </table>`;

  // 3) Category Breakdown Horizontal Bar Chart (Pretendard 10pt, unbolded labels & values)
  const barColors = ['#16a34a', '#0284c7', '#d97706', '#7c3aed', '#475569'];
  let categorySectionHtml = '';

  if (sortedCats.length > 0 && totalHours > 0) {
    const catRows = sortedCats.map(([cat, hrs], idx) => {
      const rawPct = Math.round((hrs / totalHours) * 100);
      const barPct = Math.max(2, rawPct);
      const remPct = Math.max(0, 100 - barPct);
      const color = barColors[idx % barColors.length];

      const barCells = remPct > 0
        ? `<td style="width:${barPct}%; background-color:${color}; height:10px; font-size:1pt; line-height:1pt; padding:0; border:none;">&nbsp;</td><td style="width:${remPct}%; background-color:#e2e8f0; height:10px; font-size:1pt; line-height:1pt; padding:0; border:none;">&nbsp;</td>`
        : `<td style="width:100%; background-color:${color}; height:10px; font-size:1pt; line-height:1pt; padding:0; border:none;">&nbsp;</td>`;

      return `
        <tr>
          <td align="left" valign="middle" style="padding:5px 8px 5px 0; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; text-align:left; vertical-align:middle; color:#1e293b; width:28%; border:none;">
            <p align="left" style="margin:0; text-align:left; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; color:#1e293b;">${escapeHtml(cat)}</p>
          </td>
          <td valign="middle" style="padding:5px 8px; vertical-align:middle; width:48%; border:none;">
            <table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%; table-layout:fixed;">
              <tr>${barCells}</tr>
            </table>
          </td>
          <td align="right" valign="middle" nowrap style="padding:5px 0 5px 8px; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; text-align:right; vertical-align:middle; color:#334155; width:24%; white-space:nowrap; border:none;">
            <p align="right" style="margin:0; text-align:right; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; color:#334155;">${hrs.toFixed(1)} hrs (${rawPct}%)</p>
          </td>
        </tr>`;
    }).join('');

    categorySectionHtml = `
      ${sectionSpacerHtml}
      <p align="left" style="${sectionHeaderStyle}">${greenBullet} Category Breakdown</p>
      <table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%;">${catRows}</table>`;
  }

  // 4) Bottom Portal Reference Link (Pretendard 10pt, right-aligned, italic)
  const footerNoteHtml = `
    ${sectionSpacerHtml}
    <table border="0" cellspacing="0" cellpadding="0" style="border-collapse:collapse; width:100%;">
      <tr>
        <td align="right" style="border-top:1px solid #e2e8f0; padding-top:10px; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; font-style:italic; text-align:right; color:#64748b;">
          <p align="right" style="margin:0; text-align:right; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; font-style:italic; color:#64748b;">
            <i>For more detailed records, please visit the <a href="${portalUrl}" style="color:#16a34a; text-decoration:underline; font-style:italic; ${baseFont} font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal;">a2MDS x APA Portal</a>.</i>
          </p>
        </td>
      </tr>
    </table>`;

  const htmlPayload = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body, table, td, th, p, div, span { font-family: Pretendard, Calibri, Arial, sans-serif; font-size: 10pt; font-weight: normal; mso-bidi-font-weight: normal; }
</style>
</head>
<body style="font-family:Pretendard,Calibri,Arial,sans-serif; font-size:10pt; font-weight:normal; mso-bidi-font-weight:normal; color:#1e293b;">
  ${calendarTableHtml}
  ${keyActivitiesHtml}
  ${categorySectionHtml}
  ${footerNoteHtml}
</body>
</html>`;

  const catPlainLines = sortedCats.map(([cat, hrs]) => {
    const pct = totalHours > 0 ? Math.round((hrs / totalHours) * 100) : 0;
    return `- ${cat}: ${hrs.toFixed(1)} hrs (${pct}%)`;
  });

  const normalizedPlainSummary = summaryLines
    .map(line => line.replace(/^[-*•]\s*/, '• '))
    .join('\n');

  const plainPayload = [
    `Activity Log Summary - ${MONTH_NAMES_FULL[monthIdx]} ${year} (Total: ${totalHours.toFixed(1)} hrs)`,
    '',
    'Key Activities:',
    normalizedPlainSummary,
    '',
    'Category Breakdown:',
    ...catPlainLines,
    '',
    `For more detailed records, please visit the a2MDS x APA Portal (${portalUrl}).`
  ].join('\n');

  const btn = document.getElementById('btnCopyAnnex');
  const origHtml = btn.innerHTML;

  try {
    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/html': new Blob([htmlPayload], { type: 'text/html' }),
        'text/plain': new Blob([plainPayload], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
    } else {
      await navigator.clipboard.writeText(plainPayload);
    }

    btn.innerHTML = '✓ Copied for Word!';
    setTimeout(() => { btn.innerHTML = origHtml; }, 1800);
  } catch (err) {
    alert('Clipboard copy failed. Please check browser permissions.');
  }
}

// =========================================================================
// 5. ACTIVITY LOG TABLE (ID Hidden), MULTI-SELECT FILTER & ADMIN CRUD
// =========================================================================
function populateCategorySelectOptions(selectedValue = '') {
  const sel = document.getElementById('apaLogCategorySelect');
  if (!sel) return;

  const set = new Set();
  apaState.logs.forEach(l => {
    const c = (l.category || '').trim();
    if (c) set.add(c);
  });
  if (selectedValue && selectedValue.trim()) {
    set.add(selectedValue.trim());
  }

  const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = '<option value="">-- Select Category --</option>' +
    sorted.map(c => `<option value="${escapeHtmlAttr(c)}" ${c === selectedValue ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

function renderApaLogTable() {
  const tbody = document.getElementById('apaLogTableBody');
  const badge = document.getElementById('apaLogCountBadge');
  if (!tbody) return;

  const fDate = (document.getElementById('filterLogDate')?.value || '').trim().toLowerCase();
  const fHours = (document.getElementById('filterLogHours')?.value || '').trim().toLowerCase();
  const fDetail = (document.getElementById('filterLogDetail')?.value || '').trim().toLowerCase();
  const selCats = apaState.logSelectedCategories;

  const sorted = [...apaState.logs].sort((a, b) => {
    const cmpDate = (b.date || '').localeCompare(a.date || '');
    return cmpDate !== 0 ? cmpDate : (b.id || '').localeCompare(a.id || '');
  });

  const filtered = sorted.filter(r => {
    if (fDate && !(r.date || '').toLowerCase().includes(fDate)) return false;
    if (fHours && !String(r.hours ?? '').toLowerCase().includes(fHours)) return false;
    if (fDetail && !(r.detail || '').toLowerCase().includes(fDetail)) return false;

    if (selCats.size > 0) {
      const catVal = (r.category || '').trim();
      if (!catVal) {
        if (!selCats.has('(blank)')) return false;
      } else if (!selCats.has(catVal)) {
        return false;
      }
    }
    return true;
  });

  const totalFilteredHours = filtered.reduce((acc, r) => acc + (Number(r.hours) || 0), 0);
  if (badge) {
    badge.textContent = `${filtered.length} records (${totalFilteredHours.toFixed(1)} hrs)`;
  }

  const isAdmin = apaState.role === 'admin';
  const colSpan = isAdmin ? 5 : 4;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-state-row text-sm">No matching activity logs found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(r => {
    const safeIdAttr = escapeHtmlAttr(r.id);
    const actionCell = isAdmin
      ? `<td class="text-center admin-only" style="white-space:nowrap !important;">
           <button type="button" class="btn-row-action btn-edit" title="Edit" data-action="edit-log" data-id="${safeIdAttr}">✏️</button>
           <button type="button" class="btn-row-action btn-del" title="Delete" data-action="delete-log" data-id="${safeIdAttr}">🗑️</button>
         </td>`
      : '';

    return `
      <tr>
        <td class="text-center text-sm">${escapeHtml(r.date)}</td>
        <td class="text-center text-sm">${Number(r.hours || 0).toFixed(1)}</td>
        <td class="text-left text-sm">${escapeHtml(r.category)}</td>
        <td class="text-left text-sm">${escapeHtml(r.detail)}</td>
        ${actionCell}
      </tr>`;
  }).join('');
}

function onApaLogFilterChange() {
  clearTimeout(logFilterDebounceTimer);
  logFilterDebounceTimer = setTimeout(renderApaLogTable, 180);
}

function resetApaLogFilters() {
  clearTimeout(logFilterDebounceTimer);
  ['filterLogDate', 'filterLogHours', 'filterLogDetail'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  apaState.logSelectedCategories.clear();
  const txt = document.getElementById('apaLogCatMsText');
  if (txt) txt.textContent = 'All';
  renderApaLogTable();
}

function openApaLogModal(editId = '') {
  if (apaState.role !== 'admin') return;

  const modal = document.getElementById('apaLogModal');
  const titleEl = document.getElementById('apaLogModalTitle');
  const errEl = document.getElementById('apaLogModalErr');
  errEl.style.display = 'none';

  document.getElementById('apaLogEditId').value = editId;

  if (editId) {
    const rec = apaState.logs.find(l => l.id === editId);
    if (!rec) return;
    titleEl.textContent = '✏️ Edit Activity Log';
    document.getElementById('apaLogDateInput').value = rec.date || '';
    document.getElementById('apaLogHoursInput').value = rec.hours || '';
    populateCategorySelectOptions(rec.category || '');
    document.getElementById('apaLogCategorySelect').value = rec.category || '';
    document.getElementById('apaLogDetailInput').value = rec.detail || '';
  } else {
    titleEl.textContent = '+ Add Activity Log';
    document.getElementById('apaLogDateInput').value = getTodayKst();
    document.getElementById('apaLogHoursInput').value = '';
    populateCategorySelectOptions('');
    document.getElementById('apaLogCategorySelect').value = '';
    document.getElementById('apaLogDetailInput').value = '';
  }

  modal.style.display = 'flex';
}

function closeApaLogModal() {
  document.getElementById('apaLogModal').style.display = 'none';
}

async function submitApaLogForm() {
  if (apaState.role !== 'admin') return;

  const editId = document.getElementById('apaLogEditId').value.trim();
  const date = document.getElementById('apaLogDateInput').value.trim();
  const hours = parseFloat(document.getElementById('apaLogHoursInput').value);
  const category = (document.getElementById('apaLogCategorySelect')?.value || '').trim();
  const detail = document.getElementById('apaLogDetailInput').value.trim();
  const errEl = document.getElementById('apaLogModalErr');
  const btn = document.getElementById('btnSaveApaLog');

  if (!date || isNaN(hours) || hours <= 0 || !category || !detail) {
    errEl.textContent = 'Please fill in Date, valid Hours (> 0), Category, and Activity in detail.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const action = editId ? 'update_log' : 'add_log';
    const res = await callApaApi({
      action,
      id: editId,
      date,
      hours,
      category,
      detail
    }, true);

    if (res && res.status === 'success' && res.record) {
      if (editId) {
        const idx = apaState.logs.findIndex(l => l.id === editId);
        if (idx >= 0) apaState.logs[idx] = res.record;
      } else {
        apaState.logs.unshift(res.record);
      }

      populateMonthSelector();
      populateCategorySelectOptions();
      renderMonthlyStatusView();
      renderApaLogTable();
      closeApaLogModal();
    } else {
      errEl.textContent = res?.message || 'Failed to save activity log.';
      errEl.style.display = 'block';
    }
  } catch (err) {
    errEl.textContent = err.message || 'Network error while saving.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function deleteApaLog(id) {
  if (apaState.role !== 'admin' || !id) return;
  const target = apaState.logs.find(l => l.id === id);
  const label = target
    ? `${target.date} · ${target.category}${target.detail ? ' — ' + target.detail : ''}`
    : id;

  openApaDeleteModal({
    title: '🗑️ Delete Activity Log',
    message: 'Are you sure you want to delete this activity log entry?',
    targetText: label,
    onConfirm: async () => {
      const res = await callApaApi({ action: 'delete_log', id }, true);
      if (res && res.status === 'success') {
        apaState.logs = apaState.logs.filter(l => l.id !== id);
        populateMonthSelector();
        populateCategorySelectOptions();
        renderMonthlyStatusView();
        renderApaLogTable();
      } else {
        throw new Error(res?.message || 'Failed to delete log.');
      }
    }
  });
}

// =========================================================================
// 6. MEETING MINUTES TABLE, STATUS SORTING & ADMIN CRUD
// =========================================================================
function renderApaMinutesTable() {
  const tbody = document.getElementById('apaMinutesTableBody');
  const badge = document.getElementById('apaMinutesCountBadge');
  if (!tbody) return;

  const fItem = (document.getElementById('filterMinItem')?.value || '').trim().toLowerCase();
  const fDate = (document.getElementById('filterMinDate')?.value || '').trim().toLowerCase();
  const fDetails = (document.getElementById('filterMinDetails')?.value || '').trim().toLowerCase();
  const selStatuses = apaState.minSelectedStatuses;

  // Cache original indices once to avoid O(N^2) indexOf calls during sort & render
  const indexMap = new Map();
  apaState.minutes.forEach((m, i) => indexMap.set(m, i));

  const filtered = apaState.minutes.filter(m => {
    if (fItem && !(m.item || '').toLowerCase().includes(fItem)) return false;
    if (fDate && !(m.date || '').toLowerCase().includes(fDate)) return false;
    if (fDetails && !(m.details || '').toLowerCase().includes(fDetails)) return false;

    if (selStatuses.size > 0) {
      const stVal = (m.status || '').trim();
      if (!stVal) {
        if (!selStatuses.has('(blank)')) return false;
      } else if (!selStatuses.has(stVal)) {
        return false;
      }
    }
    return true;
  });

  const pinnedRank = {
    'notes': 1,
    'items to share/check': 2
  };

  const statusRank = {
    'in progress': 1,
    'pending': 2,
    'tbd': 3,
    'done': 4,
    'cancelled': 5
  };

  filtered.sort((a, b) => {
    const itemA = (a.item || '').trim().toLowerCase();
    const itemB = (b.item || '').trim().toLowerCase();
    const pinA = pinnedRank[itemA] || 99;
    const pinB = pinnedRank[itemB] || 99;
    if (pinA !== pinB) return pinA - pinB;

    const stA = (a.status || '').trim().toLowerCase();
    const stB = (b.status || '').trim().toLowerCase();
    const rA = statusRank[stA] || 99;
    const rB = statusRank[stB] || 99;
    if (rA !== rB) return rA - rB;
    if (stA === 'done') {
      const cmpDate = (b.date || '').localeCompare(a.date || '');
      if (cmpDate !== 0) return cmpDate;
    }
    return (indexMap.get(a) ?? 0) - (indexMap.get(b) ?? 0);
  });

  if (badge) {
    badge.textContent = `${filtered.length} of ${apaState.minutes.length} items`;
  }

  const isAdmin = apaState.role === 'admin';
  const colSpan = isAdmin ? 6 : 5;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${colSpan}" class="empty-state-row text-sm">No matching meeting minutes found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(m => {
    const rawIdx = indexMap.get(m);
    const safeIdAttr = escapeHtmlAttr(m.id);
    const statusText = (m.status || '').trim();
    // Color Rule: ONLY 'In progress' uses Primary Green (#16a34a)
    const statusClass = statusText.toLowerCase() === 'in progress' ? 'status-in-progress' : 'status-plain';
    const doneDateText = statusText === 'Done' ? (m.date || '') : '';

    const rawLink = (m.link || '').trim();
    const validLink = /^https?:\/\//i.test(rawLink) ? rawLink : '';
    const linkCellHtml = validLink
      ? `<td class="text-center text-sm"><a href="${escapeHtmlAttr(validLink)}" target="_blank" rel="noopener noreferrer" title="${escapeHtmlAttr(validLink)}" style="text-decoration:none; font-size:1rem;">🔗</a></td>`
      : `<td class="text-center text-sm text-muted">-</td>`;

    const detailsCellHtml = isAdmin
      ? `<td class="text-left text-sm col-min-details-edit"><textarea class="apa-inline-details" rows="1" spellcheck="false" data-idx="${rawIdx}" data-id="${safeIdAttr}" title="Click to edit directly (Auto-saves on blur or Ctrl+Enter)">${escapeHtml(m.details)}</textarea><span class="apa-inline-save-badge" id="minSaveBadge_${rawIdx}"></span></td>`
      : `<td class="text-left text-sm">${escapeHtml(m.details)}</td>`;

    const actionCell = isAdmin
      ? `<td class="text-center admin-only" style="white-space:nowrap !important;">
           <button type="button" class="btn-row-action btn-edit" title="Edit Item / Status" data-action="edit-minute" data-idx="${rawIdx}">✏️</button>
           <button type="button" class="btn-row-action btn-del" title="Delete" data-action="delete-minute" data-idx="${rawIdx}">🗑️</button>
         </td>`
      : '';

    return `
      <tr>
        <td class="text-left text-sm col-min-item">${escapeHtml(m.item)}</td>
        <td class="text-center text-sm"><span class="${statusClass}">${escapeHtml(statusText)}</span></td>
        <td class="text-center text-sm">${escapeHtml(doneDateText)}</td>
        ${linkCellHtml}
        ${detailsCellHtml}
        ${actionCell}
      </tr>`;
  }).join('');

  if (isAdmin) {
    requestAnimationFrame(resizeAllInlineMinuteTextareas);
  }
}

function autoResizeInlineTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

// Batch DOM writes/reads to avoid layout thrashing across multiple rows
function resizeAllInlineMinuteTextareas() {
  const els = Array.from(document.querySelectorAll('#apaMinutesTableBody .apa-inline-details'));
  if (!els.length) return;
  els.forEach(el => { el.style.height = 'auto'; });
  const heights = els.map(el => el.scrollHeight);
  els.forEach((el, i) => { el.style.height = `${heights[i]}px`; });
}

function handleInlineDetailsKeydown(ev, el) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
    ev.preventDefault();
    el.blur();
  }
}

async function saveInlineMinuteDetails(el) {
  if (apaState.role !== 'admin' || !el) return;
  const idx = parseInt(el.getAttribute('data-idx'), 10);
  const rec = !isNaN(idx) ? apaState.minutes[idx] : apaState.minutes.find(m => m.id === el.getAttribute('data-id'));
  if (!rec) return;

  const newDetails = el.value.trim();
  const oldDetails = (rec.details || '').trim();
  if (newDetails === oldDetails) return;

  const badge = document.getElementById(`minSaveBadge_${idx}`);
  if (badge) badge.textContent = 'Saving...';
  el.disabled = true;

  try {
    const res = await callApaApi({
      action: 'update_minute',
      id: rec.id,
      item: rec.item,
      status: rec.status,
      date: rec.status === 'Done' ? rec.date : '',
      details: newDetails,
      link: rec.link || ''
    }, true);

    if (res && res.status === 'success' && res.record) {
      rec.details = res.record.details;
      el.value = res.record.details;
      autoResizeInlineTextarea(el);
      if (badge) {
        badge.textContent = '✓ Saved';
      }
    } else {
      el.value = rec.details || '';
      autoResizeInlineTextarea(el);
      if (badge) badge.textContent = '';
      alert(res?.message || 'Failed to update details.');
    }
  } catch (err) {
    el.value = rec.details || '';
    autoResizeInlineTextarea(el);
    if (badge) badge.textContent = '';
    alert(err.message || 'Network error while saving details.');
  } finally {
    el.disabled = false;
  }
}

function onApaMinutesFilterChange() {
  clearTimeout(minutesFilterDebounceTimer);
  minutesFilterDebounceTimer = setTimeout(renderApaMinutesTable, 180);
}

function resetApaMinutesFilters() {
  clearTimeout(minutesFilterDebounceTimer);
  ['filterMinItem', 'filterMinDate', 'filterMinDetails'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  apaState.minSelectedStatuses.clear();
  const txt = document.getElementById('apaMinStatusMsText');
  if (txt) txt.textContent = 'All';
  renderApaMinutesTable();
}

function onApaMinuteStatusChange(statusVal) {
  const dateInput = document.getElementById('apaMinuteDateInput');
  if (!dateInput) return;

  if (statusVal === 'Done') {
    dateInput.disabled = false;
    if (!dateInput.value) {
      dateInput.value = getTodayKst();
    }
  } else {
    dateInput.value = '';
    dateInput.disabled = true;
  }
}

function openApaMinuteModalByIdx(idx) {
  if (apaState.role !== 'admin') return;
  const rec = apaState.minutes[idx];
  if (!rec) return;
  openApaMinuteModal(rec.id, rec);
}

function openApaMinuteModal(editId = '', recObj = null) {
  if (apaState.role !== 'admin') return;

  const modal = document.getElementById('apaMinuteModal');
  const titleEl = document.getElementById('apaMinuteModalTitle');
  const errEl = document.getElementById('apaMinuteModalErr');
  errEl.style.display = 'none';

  const rec = recObj || (editId ? apaState.minutes.find(m => String(m.id).trim() === String(editId).trim()) : null);
  document.getElementById('apaMinuteEditId').value = rec ? rec.id : '';

  if (rec) {
    titleEl.textContent = '✏️ Edit Meeting Item';
    document.getElementById('apaMinuteItemInput').value = rec.item || '';
    document.getElementById('apaMinuteStatusInput').value = rec.status || 'In progress';
    document.getElementById('apaMinuteDateInput').value = rec.status === 'Done' ? (rec.date || '') : '';
    document.getElementById('apaMinuteLinkInput').value = rec.link || '';
    onApaMinuteStatusChange(rec.status || 'In progress');
  } else {
    titleEl.textContent = '+ Add Meeting Item';
    document.getElementById('apaMinuteItemInput').value = '';
    document.getElementById('apaMinuteStatusInput').value = 'In progress';
    document.getElementById('apaMinuteDateInput').value = '';
    document.getElementById('apaMinuteLinkInput').value = '';
    onApaMinuteStatusChange('In progress');
  }

  modal.style.display = 'flex';
}

function deleteApaMinuteByIdx(idx) {
  if (apaState.role !== 'admin') return;
  const rec = apaState.minutes[idx];
  if (!rec) return;
  deleteApaMinute(rec.id);
}

function closeApaMinuteModal() {
  document.getElementById('apaMinuteModal').style.display = 'none';
}

async function submitApaMinuteForm() {
  if (apaState.role !== 'admin') return;

  const editId = document.getElementById('apaMinuteEditId').value.trim();
  const item = document.getElementById('apaMinuteItemInput').value.trim();
  const status = document.getElementById('apaMinuteStatusInput').value.trim();
  const date = status === 'Done' ? document.getElementById('apaMinuteDateInput').value.trim() : '';
  const link = (document.getElementById('apaMinuteLinkInput')?.value || '').trim();
  const existingRec = editId
    ? apaState.minutes.find(m => String(m.id).trim() === editId)
    : null;
  const details = existingRec ? (existingRec.details || '') : '';
  const errEl = document.getElementById('apaMinuteModalErr');
  const btn = document.getElementById('btnSaveApaMinute');

  if (!item) {
    errEl.textContent = 'Item / Agenda title is required.';
    errEl.style.display = 'block';
    return;
  }

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    const action = editId ? 'update_minute' : 'add_minute';
    const res = await callApaApi({
      action,
      id: editId,
      item,
      status,
      date,
      link,
      details
    }, true);

    if (res && res.status === 'success' && res.record) {
      if (editId) {
        const idx = apaState.minutes.findIndex(m => String(m.id).trim() === editId);
        if (idx >= 0) apaState.minutes[idx] = res.record;
      } else {
        apaState.minutes.unshift(res.record);
      }

      renderApaMinutesTable();
      closeApaMinuteModal();
    } else {
      errEl.textContent = res?.message || 'Failed to save meeting item.';
      errEl.style.display = 'block';
    }
  } catch (err) {
    errEl.textContent = err.message || 'Network error while saving.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

function openApaDeleteModal({ title, message, targetText, onConfirm }) {
  const modal = document.getElementById('apaDeleteConfirmModal');
  if (!modal) return;

  document.getElementById('apaDeleteModalTitle').textContent = title || '🗑️ Confirm Deletion';
  document.getElementById('apaDeleteModalMsg').textContent = message || 'Are you sure you want to delete this item?';
  document.getElementById('apaDeleteTargetBox').textContent = targetText || '';

  const confirmBtn = document.getElementById('btnConfirmApaDelete');
  const cancelBtn = document.getElementById('btnCancelApaDelete');
  confirmBtn.disabled = false;
  confirmBtn.textContent = 'Delete';
  cancelBtn.disabled = false;

  pendingApaDeleteCallback = onConfirm;
  modal.style.display = 'flex';
}

function closeApaDeleteModal() {
  const modal = document.getElementById('apaDeleteConfirmModal');
  if (modal) modal.style.display = 'none';
  pendingApaDeleteCallback = null;
}

async function executeApaConfirmedDelete() {
  if (typeof pendingApaDeleteCallback !== 'function') return;

  const confirmBtn = document.getElementById('btnConfirmApaDelete');
  const cancelBtn = document.getElementById('btnCancelApaDelete');
  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Deleting...';
  cancelBtn.disabled = true;

  try {
    await pendingApaDeleteCallback();
    closeApaDeleteModal();
  } catch (err) {
    alert(err.message || 'Network error during deletion.');
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Delete';
    cancelBtn.disabled = false;
  }
}

function deleteApaMinute(id) {
  if (apaState.role !== 'admin' || !id) return;
  const target = apaState.minutes.find(m => m.id === id);
  const label = target ? target.item : id;

  openApaDeleteModal({
    title: '🗑️ Delete Meeting Item',
    message: 'Are you sure you want to delete this meeting item?',
    targetText: label,
    onConfirm: async () => {
      const res = await callApaApi({ action: 'delete_minute', id }, true);
      if (res && res.status === 'success') {
        apaState.minutes = apaState.minutes.filter(m => m.id !== id);
        renderApaMinutesTable();
      } else {
        throw new Error(res?.message || 'Failed to delete meeting item.');
      }
    }
  });
}

// =========================================================================
// 7. DYNAMIC MULTI-SELECT DROPDOWNS (Category & Status)
// =========================================================================
function toggleApaDropdown(type) {
  const isLogCat = type === 'logCat';
  const dd = document.getElementById(isLogCat ? 'apaLogCatMsDropdown' : 'apaMinStatusMsDropdown');
  const btn = document.getElementById(isLogCat ? 'apaLogCatMsBtn' : 'apaMinStatusMsBtn');
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  closeAllApaDropdowns();

  if (!isShowing) {
    populateApaDropdown(type);
    if (dd.parentElement !== document.body) {
      document.body.appendChild(dd);
    }
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.bottom = 'auto';
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 240))}px`;
    dd.classList.add('show');
  }
}

function populateApaDropdown(type) {
  const isLogCat = type === 'logCat';
  const dd = document.getElementById(isLogCat ? 'apaLogCatMsDropdown' : 'apaMinStatusMsDropdown');
  const selectedSet = isLogCat ? apaState.logSelectedCategories : apaState.minSelectedStatuses;
  const sourceList = isLogCat ? apaState.logs : apaState.minutes;
  const fieldKey = isLogCat ? 'category' : 'status';

  const uniqueSet = new Set();
  let hasBlank = false;

  sourceList.forEach(item => {
    const val = (item[fieldKey] || '').trim();
    if (!val) hasBlank = true;
    else uniqueSet.add(val);
  });

  const sorted = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b));
  if (hasBlank) sorted.unshift('(blank)');

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" data-dd-type="${type}" data-dd-role="select-all" ${selectedSet.size === 0 ? 'checked' : ''}>
      <span>(Select All)</span>
    </label>
    <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    sorted.map(val => {
      const safeAttr = escapeHtmlAttr(val);
      const labelHtml = val === '(blank)'
        ? '<span style="color:#888888;">(blank)</span>'
        : escapeHtml(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" data-dd-type="${type}" data-dd-role="option" value="${safeAttr}" ${selectedSet.has(val) ? 'checked' : ''}>
          <span>${labelHtml}</span>
        </label>`;
    }).join('');
}

function selectAllApaDropdown(type) {
  const isLogCat = type === 'logCat';
  const selectedSet = isLogCat ? apaState.logSelectedCategories : apaState.minSelectedStatuses;
  selectedSet.clear();
  updateApaDropdownButtonText(type);
  populateApaDropdown(type);
  isLogCat ? renderApaLogTable() : renderApaMinutesTable();
}

function toggleApaDropdownOption(type, chk) {
  const isLogCat = type === 'logCat';
  const selectedSet = isLogCat ? apaState.logSelectedCategories : apaState.minSelectedStatuses;
  const val = chk.value;

  if (chk.checked) selectedSet.add(val);
  else selectedSet.delete(val);

  updateApaDropdownButtonText(type);
  populateApaDropdown(type);
  isLogCat ? renderApaLogTable() : renderApaMinutesTable();
}

function updateApaDropdownButtonText(type) {
  const isLogCat = type === 'logCat';
  const selectedSet = isLogCat ? apaState.logSelectedCategories : apaState.minSelectedStatuses;
  const txtEl = document.getElementById(isLogCat ? 'apaLogCatMsText' : 'apaMinStatusMsText');
  if (txtEl) {
    txtEl.textContent = selectedSet.size === 0 ? 'All' : `${selectedSet.size} selected`;
  }
}

// =========================================================================
// 8. UTILITIES
// =========================================================================
function getTodayKst() {
  const now = new Date();
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (9 * 3600000));
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeHtmlAttr(str) {
  return escapeHtml(str);
}