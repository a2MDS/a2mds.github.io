/* =========================================================================
   APPLICATION LOG MODULE (Dynamic Cascading Filters & Pure Master Engine)
   - Columns A~J (0~9): Lightweight Index in-memory loaded
   - Columns K~Q (10+): Proprietary Regulatory Conditions On-Demand per Click
   - Typography: Plain text only (No bolding in data cells, font-weight: 400)
   - Blank Handling: Table cells strictly display empty strings ("")
   - Styles: Active (#16a34a), High (#dc2626), Medium (#d97706), Low (#16a34a)
   - Drawer Table: 270px Label, Vertical Middle, Left-aligned, Dynamic Heights
   ========================================================================= */
const URL_APPLICATION = 'https://script.google.com/macros/s/AKfycbx1taySthB4Wf1X-hdkC77szE05MTY86x9Kc2w-kcYGP7CynC1j3qgaGDvqZiIYDthS/exec';
const APP_DB_NAME = 'a2MDS_ApplicationLog_DB';

let appRawHeaders = [], appDisplayHeaders = [], applicationDataset = [];
let appTableFilters = [], appMultiSelectFilters = {}, appSelectedInsightCodes = new Set();
let appShiftGroupsMap = {}, appKelvDiffList = [];
let appCurrentPage = 1, appPageSize = 100, appFilteredIndices = [];
let appCurrentLastUpdated = '', appFilterDebounceTimer = null;

// On-demand Detail Session Cache
const appDetailCache = new Map();

// Helpers & Cleaners (공란은 항상 빈 문자열 반환)
const formatAppBlank = v => (v === undefined || v === null ? '' : String(v).trim());
const cleanStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const getAppHeaderIdx = kw => appRawHeaders.findIndex(h => cleanStr(h).includes(kw));
const getAppAuthKey = () => (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : (localStorage.getItem('a2mds_auth_token') || ''));

if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
}
if (typeof window.escapeHtmlAttr !== 'function') {
  window.escapeHtmlAttr = s => window.escapeHtml(s).replace(/"/g, '&quot;');
}

// 1. Accordion Toggle
function toggleAppSummarySection() {
  const body = document.getElementById('appSummaryBody');
  const icon = document.getElementById('appSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}
window.toggleAppSummarySection = toggleAppSummarySection;

function formatAppDateStr(val) {
  const s = formatAppBlank(val);
  if (!s || s === 'null' || s === '-') return '';
  const m = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(s);
  return !isNaN(d.getTime()) && s.length >= 8 ? d.toISOString().slice(0, 10) : s;
}

function formatAppLimitStr(val) {
  const s = formatAppBlank(val);
  if (!s || s === '-') return '';
  if (s.includes('%')) return s;
  const num = parseFloat(s);
  return !isNaN(num) ? `${num > 0 && num < 1 ? Number((num * 100).toFixed(4)) : num}%` : s;
}

// Typography: 볼드 제거, 색상 토큰만 보존 (font-weight: 400)
const STATUS_MAP = { 
  active: { cls: 'status-badge-active', chipCls: 'status-chip-active', style: 'color:#16a34a; font-weight:400;' } 
};
const getStatusStyleInfo = v => STATUS_MAP[String(v || '').toLowerCase().trim()] || { cls: 'status-badge-normal', chipCls: 'tag', style: 'color:var(--text-body); font-weight:400;' };

const RISK_MAP = {
  high: { cls: 'risk-badge-high', chipCls: 'risk-chip-high', style: 'color:#dc2626; font-weight:400;' },
  medium: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  med: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  low: { cls: 'risk-badge-low', chipCls: 'risk-chip-low', style: 'color:#16a34a; font-weight:400;' }
};
const getRiskStyleInfo = v => RISK_MAP[String(v || '').toLowerCase().trim()] || { cls: 'risk-badge-muted', chipCls: 'risk-chip-muted', style: 'color:#64748b; font-weight:400;' };

// 전역 중복 선언 방지: 이미 선언되어 있으면 재사용
window.renderClickableContent = window.renderClickableContent || (v => (!v || v === '-' ? '' : String(v).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#0284c7; text-decoration:underline; font-weight:400;">$1</a>')));
var renderClickableContent = window.renderClickableContent;

// One-click Copy Handler
async function copyAppIdToClipboard(id, el, ev) {
  if (typeof window.copyTextToClipboard === 'function') {
    return window.copyTextToClipboard(id, el, ev);
  }
  if (ev) ev.stopPropagation();
  if (!id || id === '-') return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(id);
    } else {
      const temp = document.createElement('input');
      temp.value = id;
      document.body.appendChild(temp);
      temp.select();
      document.execCommand('copy');
      document.body.removeChild(temp);
    }
    if (el) {
      el.classList.add('copy-success');
      setTimeout(() => el.classList.remove('copy-success'), 900);
    }
  } catch (err) {
    console.warn("Copy error:", err);
  }
}

// 2. IndexedDB Operations (Version 4 to resolve VersionError)
const openAppDB = () => new Promise(res => {
  try {
    const req = indexedDB.open(APP_DB_NAME, 4);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('applications')) db.deleteObjectStore('applications');
      db.createObjectStore('applications', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  } catch(e) { res(null); }
});

async function saveAppToDB(headers, rows, lastUpdated) {
  try {
    const db = await openAppDB();
    if (!db) return;
    const tx = db.transaction('applications', 'readwrite');
    tx.objectStore('applications').clear();
    tx.objectStore('applications').put({ id: 'all_data', headers, rows, lastUpdated });
  } catch(e) {}
}

async function loadAppFromDB() {
  try {
    const db = await openAppDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('applications', 'readonly').objectStore('applications').get('all_data');
      req.onsuccess = () => res(req.result?.rows?.length ? req.result : null);
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearAppIndexedDB() {
  try { 
    const db = await openAppDB(); 
    if (db) db.transaction('applications', 'readwrite').objectStore('applications').clear(); 
  } catch(e) {}
}

// 3. Initialization & Sync
async function initApplicationModule() {
  const cached = await loadAppFromDB();
  if (cached?.rows?.length) {
    appRawHeaders = cached.headers || [];
    applicationDataset = cached.rows || [];
    appCurrentLastUpdated = cached.lastUpdated || '';
    setupAppHeadersAndBuildTable();
    if (appCurrentLastUpdated) {
      const badge = document.getElementById('appLastModifiedBadge');
      if (badge) badge.textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
    }
    filterAppTableRows();
  } else {
    await fetchApplicationData('', true);
  }
}

async function fetchApplicationData(authOverride = '', forceReload = false) {
  const key = authOverride || getAppAuthKey();
  if (!key) return;
  const btnSync = document.getElementById('btnSyncCloudApp');
  if (btnSync) { btnSync.textContent = '⏳ Syncing...'; btnSync.disabled = true; }

  try {
    const resp = await fetch(URL_APPLICATION, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data', clientLastUpdated: forceReload ? '' : appCurrentLastUpdated })
    });
    const res = await resp.json();
    if (res?.data?.length) {
      appRawHeaders = res.headers || [];
      applicationDataset = res.data || [];
      appCurrentLastUpdated = res.lastUpdated || '';
      await saveAppToDB(appRawHeaders, applicationDataset, appCurrentLastUpdated);
      setupAppHeadersAndBuildTable();
      if (appCurrentLastUpdated) {
        const badge = document.getElementById('appLastModifiedBadge');
        if (badge) badge.textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
      }
      filterAppTableRows();
    }
  } catch(e) { 
    console.error("fetchApplicationData Error:", e); 
  } finally { 
    if (btnSync) { btnSync.textContent = '🔄 Reload'; btnSync.disabled = false; } 
  }
}

// Column Classes Mapping (Columns A~J: 10 Columns)
function getAppColumnClass(colName, idx) {
  const c = cleanStr(colName);
  if (idx === 0 || c.includes('appid') || c === 'id') return 'col-app-id';
  if (c.includes('name') || c === 'application') return 'col-app-name';
  if (c.includes('status')) return 'col-app-status';
  if (c.includes('substan') || c.includes('group')) return 'col-app-group';
  if (c.includes('kelv') && c.includes('before')) return 'col-app-kelv-before';
  if (c.includes('after')) return 'col-app-after';
  if (c.includes('before')) return 'col-app-before';
  if (c.includes('limit')) return 'col-app-limit';
  if (c.includes('risk')) return 'col-app-risk';
  if (c.includes('reference') || c.includes('ref')) return 'col-app-ref';
  return 'col-app-elvr';
}

function setupAppHeadersAndBuildTable() {
  if (!appRawHeaders?.length) return;
  // Columns A~J (0~9)
  appDisplayHeaders = appRawHeaders.slice(0, 10);
  appTableFilters = Array(appDisplayHeaders.length).fill('');
  appMultiSelectFilters = {};
  appSelectedInsightCodes.clear();

  const [table, headRow, filterRow] = ['appDataTable', 'appTableHeadRow', 'appTableFilterRow'].map(id => document.getElementById(id));
  if (!table || !headRow || !filterRow) return;

  table.querySelector('colgroup')?.remove();
  const colgroup = document.createElement('colgroup');
  headRow.innerHTML = ''; 
  filterRow.innerHTML = '';

  appDisplayHeaders.forEach((colName, idx) => {
    const cls = getAppColumnClass(colName, idx);
    const isMulti = /status|substan|limit|risk/.test(cleanStr(colName));
    colgroup.innerHTML += `<col class="${cls}">`;
    headRow.innerHTML += `<th class="${cls}">${colName}</th>`;

    if (isMulti) {
      appMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th ${cls}">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="appMsBtn_${idx}" onclick="toggleAppDropdown(${idx})">
              <span class="multiselect-btn-text" id="appMsText_${idx}">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="appMsDropdown_${idx}"></div>
          </div>
        </th>`;
    } else {
      filterRow.innerHTML += `<th class="filter-th ${cls}"><input type="text" class="filter-input" placeholder="Filter..." oninput="onAppFilterChange(${idx}, this.value)"></th>`;
    }
  });

  table.insertBefore(colgroup, table.firstChild);
  renderAppDynamicInsights();
}

function getAppAvailableRows(targetIdx = -1) {
  const appIdIdx = Math.max(0, getAppHeaderIdx('appid'));
  return applicationDataset.filter(row => {
    if (appSelectedInsightCodes.size > 0 && !appSelectedInsightCodes.has(formatAppBlank(row[appIdIdx]))) return false;
    for (let i = 0; i < appTableFilters.length; i++) {
      if (appTableFilters[i] && !formatAppBlank(row[i]).toLowerCase().includes(appTableFilters[i])) return false;
    }
    for (const [idxStr, selectedSet] of Object.entries(appMultiSelectFilters)) {
      const i = parseInt(idxStr, 10);
      if (i === targetIdx || !selectedSet.size) continue;
      const cellVal = formatAppBlank(row[i]);
      if (!cellVal) {
        if (!selectedSet.has('(blank)')) return false;
      } else {
        if (!selectedSet.has(cellVal)) return false;
      }
    }
    return true;
  });
}

function populateSingleAppDropdown(targetIdx) {
  const dd = document.getElementById(`appMsDropdown_${targetIdx}`);
  if (!dd) return;

  const availableRows = getAppAvailableRows(targetIdx);
  const uniqueSet = new Set();
  let hasEmptyCell = false;

  availableRows.forEach(row => {
    const val = formatAppBlank(row[targetIdx]);
    if (!val) {
      hasEmptyCell = true;
    } else {
      uniqueSet.add(val);
    }
  });

  const unique = Array.from(uniqueSet).sort();
  if (hasEmptyCell) {
    unique.unshift('(blank)');
  }

  const currentSet = appMultiSelectFilters[targetIdx] || new Set();

  for (const v of currentSet) {
    if (v === '(blank)' && !hasEmptyCell) currentSet.delete(v);
    else if (v !== '(blank)' && !uniqueSet.has(v)) currentSet.delete(v);
  }

  const txt = document.getElementById(`appMsText_${targetIdx}`);
  if (txt) txt.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="appChkAll_${targetIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAppDropdown(${targetIdx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => {
      const displayLabel = val === '(blank)' ? '<span style="color:#94a3b8; font-weight:400;">(blank)</span>' : val;
      const safeVal = val.replace(/'/g, "\\'");
      return `<label class="multiselect-item"><input type="checkbox" value="${safeVal}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleAppDropdownItem(${targetIdx}, '${safeVal}', this.checked)"> <span>${displayLabel}</span></label>`;
    }).join('');
}

function populateAppDropdownFiltersAndWatchlist() {
  const multiIndices = Object.keys(appMultiSelectFilters).map(k => parseInt(k, 10));
  const uniqueCounts = Object.fromEntries(multiIndices.map(i => [i, {}]));

  multiIndices.forEach(targetIdx => {
    const availableRows = getAppAvailableRows(targetIdx);
    availableRows.forEach(row => {
      const val = formatAppBlank(row[targetIdx]);
      if (val) uniqueCounts[targetIdx][val] = (uniqueCounts[targetIdx][val] || 0) + 1;
    });
  });

  const findIdx = str => appDisplayHeaders.findIndex(h => h.toLowerCase().includes(str));
  renderAppChips(findIdx('status'), 'appStatusTagsContainer', 'appStatusCountBadge', 'status', uniqueCounts);
  renderAppChips(findIdx('limit'), 'appLimitTagsContainer', 'appLimitCountBadge', 'limit', uniqueCounts);
  renderAppChips(findIdx('risk'), 'appRiskTagsContainer', 'appRiskCountBadge', 'risk', uniqueCounts);
}

function renderAppChips(colIdx, containerId, badgeId, typeCategory, uniqueCounts) {
  const container = document.getElementById(containerId);
  if (!container || colIdx === -1) return;
  const counts = uniqueCounts[colIdx] || {};
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  document.getElementById(badgeId)?.replaceChildren(document.createTextNode(`${keys.length.toLocaleString()} types`));

  if (!keys.length) { 
    container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No records</span>'; 
    return; 
  }
  container.innerHTML = keys.map(k => {
    const chipCls = typeCategory === 'status' ? getStatusStyleInfo(k).chipCls : (typeCategory === 'risk' ? getRiskStyleInfo(k).chipCls : 'tag');
    return `<span class="insight-chip ${chipCls} ${appMultiSelectFilters[colIdx]?.has(k) ? 'active' : ''}" data-col="${colIdx}" data-tag="${k}" onclick="applyAppSingleTagFilter(${colIdx}, '${k.replace(/'/g, "\\'")}')">
      ${k} <span class="insight-chip-badge">${counts[k]}</span></span>`;
  }).join('');
}

function classifyShiftCategory(text, appId = '') {
  const raw = String(text || '').trim(), idStr = String(appId || '').trim().toLowerCase();
  if (!raw || /^https?:\/\//i.test(raw)) return null;
  const lines = raw.split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !/^https?:\/\//i.test(s));
  const isExempt = lines.every(s => /^(\d+(\([a-z0-9]+\))*[\s,\/-]*)+$/i.test(s));
  if (isExempt && idStr !== 'new') return null;

  const phrase = lines.map(s => s.replace(/^(\d+(\([a-z0-9]+\))*[\s\:\.\-–—]+)/i, '').trim()).filter(Boolean).join(' ');
  if (!phrase && idStr !== 'new') return null;

  const pLower = phrase.toLowerCase();
  if (pLower.includes('reach')) return 'REACH';
  if (idStr === 'new' || /\bnew\b|newly|added|신규/.test(pLower)) return 'New';
  if (/deleted|삭제/.test(pLower)) return 'Deleted';
  if (/date|changed|amend|extended/.test(pLower)) return 'Date Changed';
  if (pLower.includes('no longer')) return 'No Longer Exist';
  if (pLower.includes('imds')) return 'IMDS';
  return phrase.length <= 40 ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : null;
}

function renderAppDynamicInsights() {
  const [fContainer, sContainer, kContainer] = ['appFutureTagsContainer', 'appShiftTagsContainer', 'appKelvDiffTagsContainer'].map(id => document.getElementById(id));
  if (!fContainer || !sContainer) return;

  const appIdIdx = Math.max(0, getAppHeaderIdx('appid'));
  const beforeIdx = appRawHeaders.findIndex(h => cleanStr(h).includes('before') && !cleanStr(h).includes('kelv'));
  const kelvBeforeIdx = appRawHeaders.findIndex(h => cleanStr(h).includes('kelv') && cleanStr(h).includes('before'));
  const refColIdx = appRawHeaders.findIndex(h => cleanStr(h).includes('reference') || cleanStr(h).includes('ref'));

  const todayStr = new Date().toISOString().slice(0, 10);
  const futureCodes = [];
  const kelvDiffCodes = [];
  appShiftGroupsMap = {};
  let totalShiftCount = 0;
  const recordedShiftIds = new Set();

  applicationDataset.forEach(row => {
    const appId = formatAppBlank(row[appIdIdx]);
    if (!appId) return;

    // 1. Future Expiry Codes
    if (beforeIdx !== -1) {
      const bDate = formatAppDateStr(row[beforeIdx]);
      if (bDate && bDate > todayStr && !futureCodes.some(f => f.id === appId)) {
        futureCodes.push({ id: appId, date: bDate });
      }
    }

    // 2. Codes of Concern (Reg. Reference, Index 4)
    const effectiveRefIdx = refColIdx !== -1 ? refColIdx : 4;
    const refVal = formatAppBlank(row[effectiveRefIdx]);
    const catKey = classifyShiftCategory(refVal, appId);
    if (catKey) {
      if (!appShiftGroupsMap[catKey]) appShiftGroupsMap[catKey] = [];
      if (!appShiftGroupsMap[catKey].includes(appId)) appShiftGroupsMap[catKey].push(appId);
      if (!recordedShiftIds.has(appId)) { recordedShiftIds.add(appId); totalShiftCount++; }
    }

    // 3. K-ELV Differences
    if (beforeIdx !== -1 && kelvBeforeIdx !== -1) {
      const rawBefore = formatAppBlank(row[beforeIdx]);
      const rawKelvBefore = formatAppBlank(row[kelvBeforeIdx]);
      const normBefore = formatAppDateStr(rawBefore) || rawBefore;
      const normKelvBefore = formatAppDateStr(rawKelvBefore) || rawKelvBefore;

      const isBothEmpty = (!normBefore || normBefore === '-') && (!normKelvBefore || normKelvBefore === '-');
      if (!isBothEmpty && normBefore !== normKelvBefore) {
        const displayRef = refVal && refVal !== '-' ? refVal : `ID ${appId}`;
        if (!kelvDiffCodes.some(k => k.id === appId)) {
          kelvDiffCodes.push({
            id: appId,
            ref: displayRef,
            euDate: normBefore || '-',
            kelvDate: normKelvBefore || '-'
          });
        }
      }
    }
  });

  document.getElementById('appFutureCountBadge')?.replaceChildren(document.createTextNode(`${futureCodes.length.toLocaleString()} codes`));
  fContainer.innerHTML = futureCodes.length ? futureCodes.map(f => `
    <span class="insight-chip tag ${appSelectedInsightCodes.has(f.id) ? 'active' : ''}" data-appid="${f.id}" title="Expires Before: ${f.date}" onclick="toggleAppSingleInsightCode('${f.id}')">
      ID ${f.id} <span class="insight-chip-badge" style="background:#e0f2fe; color:#0369a1;">${f.date}</span></span>`).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No future expiring codes recorded.</span>';

  document.getElementById('appShiftCountBadge')?.replaceChildren(document.createTextNode(`${totalShiftCount.toLocaleString()} codes`));
  const fixedKeys = ['New', 'Deleted', 'Date Changed', 'REACH', 'IMDS', 'No Longer Exist'];
  const orderedKeys = [...fixedKeys, ...Object.keys(appShiftGroupsMap).filter(k => !fixedKeys.includes(k)).sort()].filter(k => appShiftGroupsMap[k]?.length);

  sContainer.innerHTML = orderedKeys.length ? orderedKeys.map(grp => {
    const list = appShiftGroupsMap[grp];
    const isAll = list.length && list.every(id => appSelectedInsightCodes.has(id));
    return `<span class="insight-chip tag ${isAll ? 'active' : ''}" data-shift-group="${grp}" title="Filter IDs: ${list.join(', ')}" onclick="toggleAppKeywordGroupFilter('${grp.replace(/'/g, "\\'")}')">
      ${grp} <span class="insight-chip-badge">${list.length}</span></span>`;
  }).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No regulatory changes recorded.</span>';

  appKelvDiffList = kelvDiffCodes;
  if (kContainer) {
    document.getElementById('appKelvDiffCountBadge')?.replaceChildren(document.createTextNode(`${kelvDiffCodes.length.toLocaleString()} codes`));
    kContainer.innerHTML = kelvDiffCodes.length ? kelvDiffCodes.map(k => `
      <span class="insight-chip tag ${appSelectedInsightCodes.has(k.id) ? 'active' : ''}" data-appid="${k.id}" title="EU: ${k.euDate} vs K-ELV: ${k.kelvDate}" onclick="toggleAppSingleInsightCode('${k.id}')">
        ${k.ref} <span class="insight-chip-badge" style="background:#fee2e2; color:#dc2626;">${k.kelvDate}</span></span>`).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No differences identified.</span>';
  }
}

function toggleAppKeywordGroupFilter(grp) {
  const ids = appShiftGroupsMap[grp] || [], isAll = ids.length && ids.every(id => appSelectedInsightCodes.has(id));
  ids.forEach(id => isAll ? appSelectedInsightCodes.delete(id) : appSelectedInsightCodes.add(id));
  syncAllInsightUIStates(); 
  appCurrentPage = 1; 
  filterAppTableRows();
}

function toggleAppSingleInsightCode(id) {
  appSelectedInsightCodes.has(id) ? appSelectedInsightCodes.delete(id) : appSelectedInsightCodes.add(id);
  syncAllInsightUIStates(); 
  appCurrentPage = 1; 
  filterAppTableRows();
}

function toggleKelvDiffAll() {
  if (!appKelvDiffList.length) return;
  const allIds = appKelvDiffList.map(k => k.id);
  const isAllSelected = allIds.every(id => appSelectedInsightCodes.has(id));

  allIds.forEach(id => {
    if (isAllSelected) {
      appSelectedInsightCodes.delete(id);
    } else {
      appSelectedInsightCodes.add(id);
    }
  });

  syncAllInsightUIStates();
  appCurrentPage = 1;
  filterAppTableRows();
}

function syncAllInsightUIStates() {
  document.querySelectorAll('.insight-chip[data-appid]').forEach(c => c.classList.toggle('active', appSelectedInsightCodes.has(c.getAttribute('data-appid'))));
  document.querySelectorAll('.insight-chip[data-shift-group]').forEach(c => {
    const ids = appShiftGroupsMap[c.getAttribute('data-shift-group')] || [];
    c.classList.toggle('active', ids.length > 0 && ids.every(id => appSelectedInsightCodes.has(id)));
  });

  const btnAll = document.getElementById('btnKelvDiffAll');
  if (btnAll) {
    const allIds = appKelvDiffList.map(k => k.id);
    const isAll = allIds.length > 0 && allIds.every(id => appSelectedInsightCodes.has(id));
    btnAll.classList.toggle('active', isAll);
    btnAll.style.background = isAll ? '#1e293b' : '';
    btnAll.style.color = isAll ? '#ffffff' : '';
    btnAll.style.borderColor = isAll ? '#0f172a' : '';
  }
}

// 4. Dropdown Multiselect & Table Filtering
function toggleAppDropdown(idx) {
  const [dd, btn] = [`appMsDropdown_${idx}`, `appMsBtn_${idx}`].map(id => document.getElementById(id));
  if (!dd || !btn) return;

  if (!dd.classList.contains('show')) {
    populateSingleAppDropdown(idx);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 230)}px`;
    dd.classList.add('show');
  } else {
    dd.classList.remove('show');
  }
}
window.toggleAppDropdown = toggleAppDropdown;

function syncAppDropdownUI(idx) {
  const cnt = appMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`appChkAll_${idx}`);
  if (chkAll) chkAll.checked = !cnt;
  const txt = document.getElementById(`appMsText_${idx}`);
  if (txt) txt.textContent = !cnt ? 'All' : `${cnt} selected`;
  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(c => {
    c.classList.toggle('active', Boolean(appMultiSelectFilters[idx]?.has(c.getAttribute('data-tag'))));
  });
}

function selectAllAppDropdown(idx, chk) {
  appMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#appMsDropdown_${idx} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });
  syncAppDropdownUI(idx);
  appCurrentPage = 1;
  filterAppTableRows();
}
window.selectAllAppDropdown = selectAllAppDropdown;

function toggleAppDropdownItem(idx, val, checked) {
  checked ? appMultiSelectFilters[idx].add(val) : appMultiSelectFilters[idx].delete(val);
  syncAppDropdownUI(idx);
  appCurrentPage = 1;
  filterAppTableRows();
}
window.toggleAppDropdownItem = toggleAppDropdownItem;

function applyAppSingleTagFilter(colIdx, val) {
  if (!appMultiSelectFilters[colIdx]) return;
  appMultiSelectFilters[colIdx].has(val)
    ? appMultiSelectFilters[colIdx].delete(val)
    : appMultiSelectFilters[colIdx].add(val);

  const dd = document.getElementById(`appMsDropdown_${colIdx}`);
  if (dd && dd.classList.contains('show')) {
    populateSingleAppDropdown(colIdx);
  }
  syncAppDropdownUI(colIdx);
  appCurrentPage = 1;
  filterAppTableRows();
}
window.applyAppSingleTagFilter = applyAppSingleTagFilter;

function onAppFilterChange(idx, val) {
  appTableFilters[idx] = val.toLowerCase().trim();
  appCurrentPage = 1;
  clearTimeout(appFilterDebounceTimer);
  appFilterDebounceTimer = setTimeout(filterAppTableRows, 120);
}
window.onAppFilterChange = onAppFilterChange;

function filterAppTableRows() {
  appFilteredIndices = [];
  const appIdIdx = Math.max(0, getAppHeaderIdx('appid'));

  applicationDataset.forEach((row, rIdx) => {
    if (appSelectedInsightCodes.size > 0 && !appSelectedInsightCodes.has(formatAppBlank(row[appIdIdx]))) return;

    for (let i = 0; i < appTableFilters.length; i++) {
      if (appTableFilters[i] && !formatAppBlank(row[i]).toLowerCase().includes(appTableFilters[i])) return;
    }

    for (const [idxStr, selectedSet] of Object.entries(appMultiSelectFilters)) {
      if (selectedSet.size > 0) {
        const cellVal = formatAppBlank(row[parseInt(idxStr, 10)]);
        if (!cellVal) {
          if (!selectedSet.has('(blank)')) return;
        } else {
          if (!selectedSet.has(cellVal)) return;
        }
      }
    }
    appFilteredIndices.push(rIdx);
  });

  populateAppDropdownFiltersAndWatchlist();
  renderAppCurrentPage();
}
window.filterAppTableRows = filterAppTableRows;

function renderAppCurrentPage() {
  const tbody = document.getElementById('appTableDataBody');
  if (!tbody) return;

  const total = appFilteredIndices.length;
  const pages = Math.ceil(total / appPageSize) || 1;
  appCurrentPage = Math.max(1, Math.min(appCurrentPage, pages));

  const start = (appCurrentPage - 1) * appPageSize;
  const end = Math.min(start + appPageSize, total);
  let html = '';

  for (let i = start; i < end; i++) {
    const realIdx = appFilteredIndices[i];
    const row = applicationDataset[realIdx];

    html += '<tr>' + appDisplayHeaders.map((colName, cIdx) => {
      let val = formatAppBlank(row[cIdx]);
      const cls = getAppColumnClass(colName, cIdx);
      const c = cleanStr(colName);

      if (c.includes('after') || c.includes('before')) val = formatAppDateStr(val);
      else if (c.includes('limit')) val = formatAppLimitStr(val);

      // App ID (A열: font-weight: normal 고정)
      if (cIdx === 0 || c.includes('appid') || c === 'id') {
        const safeVal = window.escapeHtml(val);
        const safeAttr = window.escapeHtmlAttr(val);
        return `
          <td class="${cls}" style="text-align:center; padding:5px 6px; font-weight:400;">
            <span class="clickable-cid" onclick="copyAppIdToClipboard('${safeAttr}', this, event)" title="Click to copy" style="font-weight:400;">${safeVal}</span>
          </td>`;
      }

      // Application (C열: 말줄임 + 툴팁 + 온디맨드 📑 서랍 버튼, font-weight: normal 고정)
      if (c.includes('name') || c === 'application') {
        const safeVal = window.escapeHtml(val);
        const safeAttr = window.escapeHtmlAttr(val);
        return `
          <td class="${cls}" style="padding:5px 8px; font-weight:400;">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; width:100%; min-width:0;">
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; font-weight:400;" title="${safeAttr}">${safeVal}</span>
              <button type="button" class="btn-view-drawer" onclick="openAppDetailsDrawer(${realIdx})" data-tooltip="Click to View Details">📑</button>
            </div>
          </td>`;
      }

      // Status (D열: Active만 초록색, font-weight: 400 고정)
      if (c.includes('status')) {
        if (!val) return `<td class="${cls}" style="text-align:center; font-weight:400;"></td>`;
        const s = getStatusStyleInfo(val);
        return `<td class="${cls}" style="${s.style} text-align:center; font-weight:400;" title="${window.escapeHtmlAttr(val)}">${window.escapeHtml(val)}</td>`;
      }

      // Risk Level (J열: High 빨강, Medium 호박색, Low 초록, font-weight: 400 고정)
      if (c.includes('risk')) {
        if (!val) return `<td class="${cls}" style="text-align:center; font-weight:400;"></td>`;
        const r = getRiskStyleInfo(val);
        return `<td class="${cls}" style="${r.style} text-align:center; font-weight:400;" title="${window.escapeHtmlAttr(val)}">${window.escapeHtml(val)}</td>`;
      }

      // 일반 데이터 셀 (공란은 완전한 빈칸 "" 처리, font-weight: 400 고정)
      const isSubstGroup = cls === 'col-app-group' || c.includes('substan');
      const alignStyle = isSubstGroup ? 'text-align:left; padding-left:8px;' : 'text-align:center;';
      const safeVal = window.escapeHtml(val);
      const safeAttr = window.escapeHtmlAttr(val);
      return `<td class="${cls}" style="${alignStyle} font-weight:400;" title="${safeAttr}">${safeVal}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="10" style="text-align:center; padding:20px; color:#94a3b8; font-weight:400;">No matching records found.</td></tr>';
  document.getElementById('appViewerBadgeCount')?.replaceChildren(document.createTextNode(`Showing ${total.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`));
  document.getElementById('appPageInfoDisplay')?.replaceChildren(document.createTextNode(`Page ${appCurrentPage} of ${pages}`));
  
  const prev = document.getElementById('btnAppPrevPage');
  const next = document.getElementById('btnAppNextPage');
  if (prev) prev.disabled = appCurrentPage <= 1;
  if (next) next.disabled = appCurrentPage >= pages;
}

const goToAppPage = p => { appCurrentPage = p; renderAppCurrentPage(); };
const changeAppPageSize = s => { appPageSize = parseInt(s, 10); appCurrentPage = 1; renderAppCurrentPage(); };
window.goToAppPage = goToAppPage;
window.changeAppPageSize = changeAppPageSize;

function resetAppFilters() {
  document.querySelectorAll('#appTableFilterRow .filter-input').forEach(i => i.value = '');
  appTableFilters = Array(appDisplayHeaders.length).fill('');
  appSelectedInsightCodes.clear();
  syncAllInsightUIStates();

  Object.keys(appMultiSelectFilters).forEach(idx => {
    appMultiSelectFilters[idx].clear();
    const txt = document.getElementById(`appMsText_${idx}`);
    if (txt) txt.textContent = 'All';
    const chkAll = document.getElementById(`appChkAll_${idx}`);
    if (chkAll) chkAll.checked = true;
    document.querySelectorAll(`#appMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { c.checked = false; });
  });

  appCurrentPage = 1;
  filterAppTableRows();
}
window.resetAppFilters = resetAppFilters;

// =========================================================================
// 5. ON-DEMAND APPLICATION DETAILS DRAWER (K열 이후 1건 서버 조회)
// =========================================================================
async function openAppDetailsDrawer(realIdx) {
  const row = applicationDataset[realIdx];
  if (!row) return;

  const findVal = (keywords, isDate = false, isLimit = false) => {
    const kwList = Array.isArray(keywords) ? keywords : [keywords];
    let idx = -1;
    for (const kw of kwList) {
      idx = getAppHeaderIdx(kw);
      if (idx !== -1) break;
    }
    if (idx === -1) return '';
    const v = formatAppBlank(row[idx]);
    return isDate ? (formatAppDateStr(v) || '') : (isLimit ? (formatAppLimitStr(v) || '') : (v || ''));
  };

  const appIdIdx = getAppHeaderIdx('appid');
  const appId = formatAppBlank(appIdIdx !== -1 ? row[appIdIdx] : row[0]) || '';

  const appName = findVal(['application', 'name']);
  const statusVal = findVal('status');
  const substanceGroup = findVal(['substan', 'group']);
  const afterDate = findVal('after', true);

  const beforeIdx = appRawHeaders.findIndex(h => cleanStr(h).includes('before') && !cleanStr(h).includes('kelv'));
  const kelvBeforeIdx = appRawHeaders.findIndex(h => cleanStr(h).includes('kelv') && cleanStr(h).includes('before'));
  const beforeDate = beforeIdx !== -1 ? (formatAppDateStr(formatAppBlank(row[beforeIdx])) || '') : '';
  const kelvBeforeDate = kelvBeforeIdx !== -1 ? (formatAppDateStr(formatAppBlank(row[kelvBeforeIdx])) || '') : '';

  const limitVal = findVal(['limit', 'mcv', 'threshold'], false, true);
  const riskLevel = findVal(['risk', 'risklevel']);
  const regRef = findVal(['reference', 'ref', 'elvr', 'regref']);

  const sInfo = getStatusStyleInfo(statusVal);
  const rInfo = getRiskStyleInfo(riskLevel);

  const titleEl = document.getElementById('appDrawerTitle');
  if (titleEl) {
    titleEl.innerHTML = `📑 App ID: <strong>${window.escapeHtml(appId)}</strong>
      ${statusVal ? `<span class="badge-tag-dp ${sInfo.cls}" style="margin-left:8px; font-size:0.8rem; padding:2px 8px; ${sInfo.style}">Status: ${window.escapeHtml(statusVal)}</span>` : ''}
      ${riskLevel ? `<span class="badge-tag-dp ${rInfo.cls}" style="margin-left:6px; font-size:0.8rem; padding:2px 8px; ${rInfo.style}">Risk: ${window.escapeHtml(riskLevel)}</span>` : ''}`;
  }

  // 1. 상단 인포 카드: 3열 2행 6개 메타 항목 온전히 보존 및 이중 콜론(::) 제거
  const metaFields = [
    { label: 'Substance Group', val: substanceGroup },
    { label: 'Limit', val: limitVal },
    { label: 'Reg. Reference', val: regRef },
    { label: 'After', val: afterDate },
    { label: 'Before', val: beforeDate },
    { label: 'K-ELV_Before', val: kelvBeforeDate }
  ];

  const appRowHtml = `
    <div class="drawer-info-row" style="grid-column: 1 / -1; align-items: flex-start; line-height: 1.45; border-bottom: 1px dashed var(--border-gray); padding-bottom: 8px; margin-bottom: 2px;">
      <span class="drawer-info-label" style="margin-top: 1px;">Application</span>
      <span class="drawer-info-val" style="white-space: normal; word-break: break-word; overflow: visible; font-weight: 600;" title="${window.escapeHtmlAttr(appName)}">${window.escapeHtml(appName)}</span>
    </div>`;

  const metaRowsHtml = metaFields.map(f => `
    <div class="drawer-info-row">
      <span class="drawer-info-label">${window.escapeHtml(f.label)}</span>
      <span class="drawer-info-val" title="${window.escapeHtmlAttr(f.val)}">${window.escapeHtml(f.val)}</span>
    </div>`).join('');

  const infoCard = document.getElementById('appDrawerInfoCard');
  if (infoCard) {
    infoCard.replaceChildren(document.createRange().createContextualFragment(appRowHtml + metaRowsHtml));
  }

  const extContainer = document.getElementById('appDrawerExtendedContainer');
  if (extContainer) {
    extContainer.style.display = 'block';
    extContainer.style.height = 'auto';
    extContainer.style.flex = 'none';
    extContainer.style.marginBottom = 'auto';
    extContainer.innerHTML = `
      <div style="text-align:center; padding:20px; color:#64748b; background:#f8fafc; border-radius:8px;">
        <span>Loading proprietary regulatory conditions on-demand...</span>
      </div>`;
  }

  document.getElementById('appDrawerOverlay')?.style.setProperty('display', 'flex');

  // 세션 캐시 확인
  let detailMap = appDetailCache.get(appId);

  // 온디맨드 서버 요청 (K열 이후 1건만 조회)
  if (!detailMap) {
    try {
      const resp = await fetch(URL_APPLICATION, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          auth: getAppAuthKey(),
          action: 'get_application_detail',
          appId: appId
        })
      });
      const res = await resp.json();
      if (res?.status === 'success' && res.extendedDetails) {
        detailMap = res.extendedDetails;
        appDetailCache.set(appId, detailMap);
      }
    } catch (e) {
      console.error("Failed to fetch application detail:", e);
    }
  }

  if (!detailMap) {
    if (extContainer) extContainer.innerHTML = '<div style="color:#ef4444; padding:16px; text-align:center;">Failed to load extended regulatory details.</div>';
    return;
  }

  // 2. K~Q열 7개 고정 항목: 테이블 대신 Grid-Row 구조로 전환하여 텍스트 길이에 맞춰 세로 높이 동적 밀착
  const targetHeaders = [
    'ELV Annex II (Conditions)',
    'K-ELV_Enforcement Decree Art. 9(2)',
    'K-ELV_Ref',
    'Typical Uses & Products',
    'Additional Notes',
    'ELV OJ date',
    'Amended by'
  ];

  let rowsHtml = '';
  targetHeaders.forEach((headerTitle, idx) => {
    let rawVal = detailMap[headerTitle] !== undefined ? detailMap[headerTitle] : '';
    let formattedVal = formatAppBlank(rawVal);
    if (/date|oj|after|before/i.test(headerTitle)) formattedVal = formatAppDateStr(formattedVal);

    const isLast = idx === targetHeaders.length - 1;
    rowsHtml += `
      <div style="display: grid; grid-template-columns: 300px 1fr; align-items: stretch; border-bottom: ${isLast ? 'none' : '1px solid #e2e8f0'}; min-height: 38px; box-sizing: border-box;">
        <div style="display: flex; align-items: center; padding: 8px 14px; font-size: 0.82rem; font-weight: 600; color: #334155; background: #f8fafc; border-right: 1px solid #e2e8f0; line-height: 1.35; word-break: keep-all; box-sizing: border-box;">
          📝 ${window.escapeHtml(headerTitle)}
        </div>
        <div style="display: flex; align-items: center; justify-content: flex-start; text-align: left !important; padding: 8px 16px; font-size: 0.83rem; line-height: 1.5; white-space: pre-wrap; word-break: break-word; color: #0f172a; box-sizing: border-box; font-weight: 400; min-height: 38px;">
          <div style="text-align: left !important; width: 100%; font-weight: 400;">${renderClickableContent(formattedVal)}</div>
        </div>
      </div>`;
  });

  if (extContainer) {
    extContainer.innerHTML = `
      <div style="border: 1px solid #cbd5e1; border-radius: 8px; overflow: hidden; background: #ffffff; height: auto !important; margin-bottom: 12px; box-sizing: border-box;">
        ${rowsHtml}
      </div>`;
  }
}
window.openAppDetailsDrawer = openAppDetailsDrawer;

const closeAppDrawer = () => document.getElementById('appDrawerOverlay')?.style.setProperty('display', 'none');
window.closeAppDrawer = closeAppDrawer;

// =========================================================================
// 6. EXCEL EXPORT & GLOBAL WINDOW EXPORTS
// =========================================================================
async function exportAppExcel() {
  if (!applicationDataset.length || !window.ExcelJS) return;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Applications", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  const headers = appDisplayHeaders;

  ws.columns = headers.map((h, idx) => ({ header: h, key: `col_${idx}`, width: idx === 0 ? 10 : (idx === 1 ? 25 : 20) }));
  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  appFilteredIndices.forEach(rIdx => ws.addRow(applicationDataset[rIdx].slice(0, 10)));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `a2MDS_Application_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
}
window.exportAppExcel = exportAppExcel;

// Global Window Exports
window.initApplicationModule = initApplicationModule;
window.fetchApplicationData = fetchApplicationData;
window.clearAppIndexedDB = clearAppIndexedDB;
window.copyAppIdToClipboard = copyAppIdToClipboard;
window.toggleAppSingleInsightCode = toggleAppSingleInsightCode;
window.toggleAppKeywordGroupFilter = toggleAppKeywordGroupFilter;
window.toggleKelvDiffAll = toggleKelvDiffAll;