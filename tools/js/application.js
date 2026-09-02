/* =========================================================================
   APPLICATION LOG MODULE (Dynamic Cascading Filters)
   ========================================================================= */
const URL_APPLICATION = 'https://script.google.com/macros/s/AKfycbx1taySthB4Wf1X-hdkC77szE05MTY86x9Kc2w-kcYGP7CynC1j3qgaGDvqZiIYDthS/exec';
const APP_DB_NAME = 'a2MDS_ApplicationLog_DB';

let appRawHeaders = [], appDisplayHeaders = [], applicationDataset = [];
let appTableFilters = [], appMultiSelectFilters = {}, appSelectedInsightCodes = new Set();
let appShiftGroupsMap = {}, appAiInsightsCache = {};
let appCurrentPage = 1, appPageSize = 100, appFilteredIndices = [];
let appCurrentLastUpdated = '', appFilterDebounceTimer = null;

// Helpers & Formatters
const formatAppBlank = v => (!v || String(v).trim() === '-' ? '' : String(v).trim());
const parseAppMarkdownBold = s => String(s || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
const cleanStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const getAppHeaderIdx = kw => appRawHeaders.findIndex(h => cleanStr(h).includes(kw));

function toggleAppSummarySection() {
  const body = document.getElementById('appSummaryBody');
  const icon = document.getElementById('appSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function formatAppDateStr(val) {
  const s = formatAppBlank(val);
  if (!s || s === 'null') return '';
  const m = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  const d = new Date(s);
  return !isNaN(d.getTime()) && s.length >= 8 ? d.toISOString().slice(0, 10) : s;
}

function formatAppLimitStr(val) {
  const s = formatAppBlank(val);
  if (!s || s.includes('%')) return s;
  const num = parseFloat(s);
  return !isNaN(num) ? `${num > 0 && num < 1 ? Number((num * 100).toFixed(4)) : num}%` : s;
}

const STATUS_MAP = { active: { cls: 'status-badge-active', chipCls: 'status-chip-active', style: 'color:#16a34a; font-weight:500;' } };
const getStatusStyleInfo = v => STATUS_MAP[String(v || '').toLowerCase().trim()] || { cls: 'status-badge-normal', chipCls: 'tag', style: 'color:var(--text-body); font-weight:400;' };

const RISK_MAP = {
  high: { cls: 'risk-badge-high', chipCls: 'risk-chip-high', style: 'color:#dc2626; font-weight:500;' },
  medium: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  med: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  low: { cls: 'risk-badge-low', chipCls: 'risk-chip-low', style: 'color:#16a34a; font-weight:400;' }
};
const getRiskStyleInfo = v => RISK_MAP[String(v || '').toLowerCase().trim()] || { cls: 'risk-badge-muted', chipCls: 'risk-chip-muted', style: 'color:#64748b; font-weight:400;' };
const renderClickableContent = v => (!v || v === '-' ? '-' : String(v).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'));

// IndexedDB Operations
const openAppDB = () => new Promise(res => {
  try {
    const req = indexedDB.open(APP_DB_NAME, 3);
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
  try { const db = await openAppDB(); if (db) db.transaction('applications', 'readwrite').objectStore('applications').clear(); } catch(e) {}
}

// Initialization & Sync
async function initApplicationModule() {
  const cached = await loadAppFromDB();
  if (cached?.rows?.length) {
    appRawHeaders = cached.headers || [];
    applicationDataset = cached.rows || [];
    appCurrentLastUpdated = cached.lastUpdated || '';
    setupAppHeadersAndBuildTable();
    if (appCurrentLastUpdated) document.getElementById('appLastModifiedBadge').textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
    filterAppTableRows();
  }
}

async function fetchApplicationData(authOverride = '', forceReload = false) {
  const key = authOverride || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
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
      if (appCurrentLastUpdated) document.getElementById('appLastModifiedBadge').textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
      filterAppTableRows();
    }
  } catch(e) { console.error("fetchApplicationData Error:", e); }
  finally { if (btnSync) { btnSync.textContent = '🔄 Reload'; btnSync.disabled = false; } }
}

function getAppColumnClass(colName, idx) {
  const c = cleanStr(colName);
  if (idx === 0 || c.includes('appid') || c === 'id') return 'col-app-id';
  if (c.includes('name') || c === 'application') return 'col-app-name';
  if (c.includes('status')) return 'col-app-status';
  if (c.includes('substan') || c.includes('group')) return 'col-app-group';
  if (c.includes('after')) return 'col-app-after';
  if (c.includes('before')) return 'col-app-before';
  if (c.includes('limit')) return 'col-app-limit';
  if (c.includes('risk')) return 'col-app-risk';
  return 'col-app-elvr';
}

function setupAppHeadersAndBuildTable() {
  if (!appRawHeaders?.length) return;
  appDisplayHeaders = appRawHeaders.slice(0, 9);
  appTableFilters = Array(appDisplayHeaders.length).fill('');
  appMultiSelectFilters = {};
  appSelectedInsightCodes.clear();

  const [table, headRow, filterRow] = ['appDataTable', 'appTableHeadRow', 'appTableFilterRow'].map(id => document.getElementById(id));
  if (!table || !headRow || !filterRow) return;

  table.querySelector('colgroup')?.remove();
  const colgroup = document.createElement('colgroup');
  headRow.innerHTML = ''; filterRow.innerHTML = '';

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

// ⭐️ 타 필터를 통과하는 유효 행 도출
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
      if (!selectedSet.has(formatAppBlank(row[i]))) return false;
    }
    return true;
  });
}

// ⭐️ 개별 드롭다운 옵션 즉시 재구성 (smelter.js와 동일한 표시 형식)
function populateSingleAppDropdown(targetIdx) {
  const dd = document.getElementById(`appMsDropdown_${targetIdx}`);
  if (!dd) return;

  const availableRows = getAppAvailableRows(targetIdx);
  const uniqueSet = new Set();

  availableRows.forEach(row => {
    const val = formatAppBlank(row[targetIdx]);
    if (val) uniqueSet.add(val);
  });

  const unique = Array.from(uniqueSet).sort();
  const currentSet = appMultiSelectFilters[targetIdx] || new Set();

  for (const v of currentSet) {
    if (!uniqueSet.has(v)) currentSet.delete(v);
  }

  const txt = document.getElementById(`appMsText_${targetIdx}`);
  if (txt) txt.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="appChkAll_${targetIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAppDropdown(${targetIdx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `<label class="multiselect-item"><input type="checkbox" value="${val}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleAppDropdownItem(${targetIdx}, '${val}', this.checked)"> <span>${val}</span></label>`).join('');
}

function populateAppDropdownFiltersAndWatchlist() {
  const multiIndices = Object.keys(appMultiSelectFilters).map(k => parseInt(k, 10));
  const uniqueCounts = Object.fromEntries(multiIndices.map(i => [i, {}]));

  multiIndices.forEach(targetIdx => {
    populateSingleAppDropdown(targetIdx);
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

  if (!keys.length) { container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No records</span>'; return; }
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
  const [fContainer, sContainer] = ['appFutureTagsContainer', 'appShiftTagsContainer'].map(id => document.getElementById(id));
  if (!fContainer || !sContainer) return;

  const beforeIdx = getAppHeaderIdx('before');
  const appIdIdx = Math.max(0, getAppHeaderIdx('appid'));
  const refColIdx = getAppHeaderIdx('elvr') !== -1 ? getAppHeaderIdx('elvr') : 8;

  const todayStr = new Date().toISOString().slice(0, 10);
  const futureCodes = [];
  appShiftGroupsMap = {};
  let totalShiftCount = 0;
  const recordedShiftIds = new Set();

  applicationDataset.forEach(row => {
    const appId = formatAppBlank(row[appIdIdx]);
    if (!appId) return;
    if (beforeIdx !== -1) {
      const bDate = formatAppDateStr(row[beforeIdx]);
      if (bDate && bDate > todayStr && !futureCodes.some(f => f.id === appId)) futureCodes.push({ id: appId, date: bDate });
    }
    const catKey = classifyShiftCategory(formatAppBlank(row[refColIdx]), appId);
    if (catKey) {
      if (!appShiftGroupsMap[catKey]) appShiftGroupsMap[catKey] = [];
      if (!appShiftGroupsMap[catKey].includes(appId)) appShiftGroupsMap[catKey].push(appId);
      if (!recordedShiftIds.has(appId)) { recordedShiftIds.add(appId); totalShiftCount++; }
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
}

function toggleAppKeywordGroupFilter(grp) {
  const ids = appShiftGroupsMap[grp] || [], isAll = ids.length && ids.every(id => appSelectedInsightCodes.has(id));
  ids.forEach(id => isAll ? appSelectedInsightCodes.delete(id) : appSelectedInsightCodes.add(id));
  syncAllInsightUIStates(); appCurrentPage = 1; filterAppTableRows();
}

function toggleAppSingleInsightCode(id) {
  appSelectedInsightCodes.has(id) ? appSelectedInsightCodes.delete(id) : appSelectedInsightCodes.add(id);
  syncAllInsightUIStates(); appCurrentPage = 1; filterAppTableRows();
}

function syncAllInsightUIStates() {
  document.querySelectorAll('.insight-chip[data-appid]').forEach(c => c.classList.toggle('active', appSelectedInsightCodes.has(c.getAttribute('data-appid'))));
  document.querySelectorAll('.insight-chip[data-shift-group]').forEach(c => {
    const ids = appShiftGroupsMap[c.getAttribute('data-shift-group')] || [];
    c.classList.toggle('active', ids.length > 0 && ids.every(id => appSelectedInsightCodes.has(id)));
  });
}

// ⭐️ 드롭다운 버튼 클릭 시 최신 옵션 목록 갱신 후 팝업 표시
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

function syncAppDropdownUI(idx) {
  const cnt = appMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`appChkAll_${idx}`);
  if (chkAll) chkAll.checked = !cnt;
  const txt = document.getElementById(`appMsText_${idx}`);
  if (txt) txt.textContent = !cnt ? 'All' : `${cnt} selected`;
  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(c => c.classList.toggle('active', Boolean(appMultiSelectFilters[idx]?.has(c.getAttribute('data-tag')))));
}

function selectAllAppDropdown(idx, chk) {
  appMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#appMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  syncAppDropdownUI(idx); appCurrentPage = 1; filterAppTableRows();
}

function toggleAppDropdownItem(idx, val, checked) {
  checked ? appMultiSelectFilters[idx].add(val) : appMultiSelectFilters[idx].delete(val);
  syncAppDropdownUI(idx); appCurrentPage = 1; filterAppTableRows();
}

function applyAppSingleTagFilter(colIdx, val) {
  if (!appMultiSelectFilters[colIdx]) return;
  appMultiSelectFilters[colIdx].has(val) ? appMultiSelectFilters[colIdx].delete(val) : appMultiSelectFilters[colIdx].add(val);
  document.querySelectorAll(`#appMsDropdown_${colIdx} input[type="checkbox"]`).forEach(c => { if (c.value) c.checked = appMultiSelectFilters[colIdx].has(c.value); });
  syncAppDropdownUI(colIdx); appCurrentPage = 1; filterAppTableRows();
}

function onAppFilterChange(idx, val) {
  appTableFilters[idx] = val.toLowerCase().trim();
  appCurrentPage = 1;
  clearTimeout(appFilterDebounceTimer);
  appFilterDebounceTimer = setTimeout(filterAppTableRows, 150);
}

function filterAppTableRows() {
  appFilteredIndices = [];
  const appIdIdx = Math.max(0, getAppHeaderIdx('appid'));

  applicationDataset.forEach((row, rIdx) => {
    if (appSelectedInsightCodes.size > 0 && !appSelectedInsightCodes.has(formatAppBlank(row[appIdIdx]))) return;
    for (let i = 0; i < appTableFilters.length; i++) {
      if (appTableFilters[i] && !formatAppBlank(row[i]).toLowerCase().includes(appTableFilters[i])) return;
    }
    for (const [idxStr, selectedSet] of Object.entries(appMultiSelectFilters)) {
      if (selectedSet.size > 0 && !selectedSet.has(formatAppBlank(row[parseInt(idxStr, 10)]))) return;
    }
    appFilteredIndices.push(rIdx);
  });

  populateAppDropdownFiltersAndWatchlist();
  renderAppCurrentPage();
}

function renderAppCurrentPage() {
  const tbody = document.getElementById('appTableDataBody');
  if (!tbody) return;
  const total = appFilteredIndices.length, pages = Math.ceil(total / appPageSize) || 1;
  appCurrentPage = Math.max(1, Math.min(appCurrentPage, pages));

  const start = (appCurrentPage - 1) * appPageSize, end = Math.min(start + appPageSize, total);
  let html = '';

  for (let i = start; i < end; i++) {
    const realIdx = appFilteredIndices[i], row = applicationDataset[realIdx];
    html += '<tr>' + appDisplayHeaders.map((colName, cIdx) => {
      let val = formatAppBlank(row[cIdx]);
      const cls = getAppColumnClass(colName, cIdx), c = cleanStr(colName);
      if (c.includes('after') || c.includes('before')) val = formatAppDateStr(val);
      else if (c.includes('limit')) val = formatAppLimitStr(val);

      if (cIdx === 0 || c.includes('appid') || c === 'id') return `<td class="${cls}"><button type="button" class="cas-trigger-btn" onclick="openAppDetailsDrawer(${realIdx})" title="View Details">${val}</button></td>`;
      if (c.includes('status')) { const s = getStatusStyleInfo(val); return `<td class="${cls} ${s.cls}" style="${s.style}" title="${val}">${val}</td>`; }
      if (c.includes('risk')) { const r = getRiskStyleInfo(val); return `<td class="${cls} ${r.cls}" style="${r.style}" title="${val}">${val}</td>`; }
      return `<td class="${cls}" title="${val}">${val}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  document.getElementById('appViewerBadgeCount')?.replaceChildren(document.createTextNode(`Showing ${total.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`));
  document.getElementById('appPageInfoDisplay')?.replaceChildren(document.createTextNode(`Page ${appCurrentPage} of ${pages}`));
  const prev = document.getElementById('btnAppPrevPage'), next = document.getElementById('btnAppNextPage');
  if (prev) prev.disabled = appCurrentPage <= 1;
  if (next) next.disabled = appCurrentPage >= pages;
}

const goToAppPage = p => { appCurrentPage = p; renderAppCurrentPage(); };
const changeAppPageSize = s => { appPageSize = parseInt(s, 10); appCurrentPage = 1; renderAppCurrentPage(); };

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
  filterAppTableRows();
}

async function requestGeminiInsightsFromGAS(params, forceRefresh = false) {
  const { appId } = params;
  if (!forceRefresh && appAiInsightsCache[appId]) return appAiInsightsCache[appId];
  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!key) return null;

  try {
    const resp = await fetch(URL_APPLICATION, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'get_ai_insights', ...params, forceRefresh })
    });
    const res = await resp.json();
    if (res?.status === 'success' && res.insights) {
      appAiInsightsCache[appId] = res.insights;
      return res.insights;
    }
  } catch(e) {}
  return null;
}

function buildAppBilingualSectionHtml(titleIcon, titleText, dataObj, fallbackEn, fallbackKr) {
  const enList = (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) ? (dataObj.en?.length ? dataObj.en : fallbackEn) : (Array.isArray(dataObj) ? dataObj : fallbackEn);
  const krList = (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) ? (dataObj.kr?.length ? dataObj.kr : fallbackKr) : fallbackKr;

  return `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px;">
      <div style="font-weight:700; color:#0f172a; font-size:0.92rem; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
        <span>${titleIcon}</span> ${titleText}
      </div>
      <ul style="margin:0; padding-left:18px; font-size:0.88rem; color:#334155; line-height:1.65;">
        ${enList.map(item => `<li>${parseAppMarkdownBold(item)}</li>`).join('')}
      </ul>
      ${krList.length ? `
        <div style="margin:12px 0 10px; border-top:1px dashed #cbd5e1;"></div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#475569; line-height:1.65;">
          ${krList.map(item => `<li>${parseAppMarkdownBold(item)}</li>`).join('')}
        </ul>` : ''}
    </div>`;
}

async function renderRealtimeAIInsights(params, forceRefresh = false) {
  const container = document.getElementById('appDrawerAiContentWrap');
  const metaBadge = document.getElementById('appAiGeneratedMeta');
  if (!container) return;

  if (forceRefresh) {
    container.innerHTML = `<div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;"><span style="font-size:1.15rem;">⏳</span> Force refreshing insights from Gemini AI...</div>`;
    if (metaBadge) metaBadge.textContent = 'Refreshing...';
  }

  const insights = await requestGeminiInsightsFromGAS(params, forceRefresh);
  if (metaBadge) {
    const rawTime = insights?.generatedAt;
    metaBadge.textContent = `🕒 Generated: ${(typeof formatKstTimestampDetailed === 'function' ? formatKstTimestampDetailed(rawTime) : rawTime) || new Date().toISOString()}`;
  }

  const riskCard = buildAppBilingualSectionHtml('🛡️', 'Risk Level & OEM Approval', insights?.riskOemApproval, ["**Timeline**: Evaluated under EU ELV Annex II thresholds.", "**OEM Impact**: Requires OEM compliance approval."], ["**적용 일정 및 규제 현황**: EU ELV 부속서 II 기준치 및 면제 조건에 따라 평가됨.", "**OEM 승인 및 리스크**: 완성차 IMDS 규제 준수 승인 및 검증 필수."]);
  const whereCard = buildAppBilingualSectionHtml('🎯', 'Where Used & Target Parts', insights?.whereUsed, ["**Target Parts**: Functional metal alloys and electrical components.", "**Sub-systems**: Chassis, powertrain, and body modules."], ["**적용 대상 부품**: 기능성 금속 합금 및 전기·전자 구성품.", "**하위 시스템**: 섀시, 파워트레인 및 차체 모듈."]);

  container.innerHTML = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-top:6px;">${riskCard}${whereCard}</div>`;
}

function refreshCurrentAppAi(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContext) {
  delete appAiInsightsCache[appId];
  renderRealtimeAIInsights({ appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContext }, true);
}

function openAppDetailsDrawer(realIdx) {
  const row = applicationDataset[realIdx];
  if (!row) return;

  const findVal = (str, isDate = false, isLimit = false) => {
    const idx = getAppHeaderIdx(str);
    if (idx === -1) return '-';
    const v = formatAppBlank(row[idx]);
    return isDate ? (formatAppDateStr(v) || '-') : (isLimit ? (formatAppLimitStr(v) || '-') : (v || '-'));
  };

  const appId = formatAppBlank(row[0]) || '-';
  const appName = findVal('name'), statusVal = findVal('status'), substanceGroup = findVal('substan');
  const afterDate = findVal('after', true), beforeDate = findVal('before', true), limitVal = findVal('limit', false, true);
  const riskLevel = findVal('risk'), regRef = findVal('elvr');

  const sInfo = getStatusStyleInfo(statusVal), rInfo = getRiskStyleInfo(riskLevel);
  const titleEl = document.getElementById('appDrawerTitle');
  if (titleEl) {
    titleEl.innerHTML = `📑 App ID: <strong>${appId}</strong>
      ${statusVal !== '-' ? `<span class="badge-tag-dp ${sInfo.cls}" style="margin-left:8px; font-size:0.8rem; padding:2px 8px; ${sInfo.style}">Status: ${statusVal}</span>` : ''}
      ${riskLevel !== '-' ? `<span class="badge-tag-dp ${rInfo.cls}" style="margin-left:6px; font-size:0.8rem; padding:2px 8px; ${rInfo.style}">Risk: ${riskLevel}</span>` : ''}`;
  }

  const metaFields = [
    { label: 'Application', val: appName }, { label: 'Substance Group', val: substanceGroup },
    { label: 'Limit', val: limitVal }, { label: 'After', val: afterDate },
    { label: 'Before', val: beforeDate }, { label: 'Reg. Reference', val: regRef }
  ];
  document.getElementById('appDrawerInfoCard')?.replaceChildren(
    document.createRange().createContextualFragment(metaFields.map(f => `<div class="drawer-info-row"><span class="drawer-info-label">${f.label}</span><span class="drawer-info-val" title="${f.val}">${f.val}</span></div>`).join(''))
  );

  let tableRowsHtml = '', fullContextArray = [];
  for (let idx = 9; idx < appRawHeaders.length; idx++) {
    const h = appRawHeaders[idx] || `Col ${idx + 1}`;
    let val = formatAppBlank(row[idx]);
    if (val) fullContextArray.push(`[${h}] ${val}`);
    if (/date|oj|after|before/i.test(h)) val = formatAppDateStr(val);
    tableRowsHtml += `<tr><td class="drawer-matrix-label">📝 ${h}</td><td class="drawer-matrix-val">${renderClickableContent(val)}</td></tr>`;
  }

  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  const escapeArg = s => String(s || '').replace(/'/g, "\\'");
  const fullCtxStr = fullContextArray.join('\n');

  const extContainer = document.getElementById('appDrawerExtendedContainer');
  if (extContainer) {
    extContainer.innerHTML = `
      ${tableRowsHtml ? `<div class="drawer-matrix-table-wrap"><table class="drawer-matrix-table"><tbody>${tableRowsHtml}</tbody></table></div>` : ''}
      <div class="ai-insights-box">
        <div class="ai-insights-header">
          <div class="ai-insights-title"><span style="font-size:1.25rem;">🧠</span><span>AI-Powered Insights</span></div>
          <div style="font-size:0.78rem; color:#64748b; margin:-2px 0 2px; display:flex; align-items:center; justify-content:center; gap:5px;"><span>ℹ️</span><span>AI can make mistakes. Always verify important information.</span></div>
          <div class="ai-insights-meta-bar">
            <span id="appAiGeneratedMeta" class="ai-timestamp-badge">🕒 Checking...</span>
            ${isAdmin ? `<button type="button" class="btn-ai-refresh" onclick="refreshCurrentAppAi('${escapeArg(appId)}', '${escapeArg(appName)}', '${escapeArg(substanceGroup)}', '${escapeArg(riskLevel)}', '${escapeArg(beforeDate)}', '${escapeArg(afterDate)}', '${escapeArg(limitVal)}', '${escapeArg(regRef)}', '${escapeArg(fullCtxStr)}')" title="Force refresh and overwrite server AI cache">🔄 Refresh</button>` : ''}
          </div>
        </div>
        <div class="ai-insights-content" id="appDrawerAiContentWrap">
          <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;"><span>⏳</span> Generating real-time regulatory & engineering insights via Gemini AI...</div>
        </div>
      </div>`;
  }

  document.getElementById('appDrawerOverlay')?.style.setProperty('display', 'flex');
  renderRealtimeAIInsights({ appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal: regRef, fullContext: fullCtxStr }, false);
}

const closeAppDrawer = () => document.getElementById('appDrawerOverlay')?.style.setProperty('display', 'none');

async function exportAppExcel() {
  if (!applicationDataset.length || !window.ExcelJS) return;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Applications", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  const headers = appRawHeaders.length ? appRawHeaders : appDisplayHeaders;

  ws.columns = headers.map((h, idx) => ({ header: h, key: `col_${idx}`, width: idx === 0 ? 10 : (idx === 1 ? 30 : 20) }));
  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  appFilteredIndices.forEach(rIdx => ws.addRow(applicationDataset[rIdx]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `a2MDS_Application_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
}
