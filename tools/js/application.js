/* =========================================================================
   APPLICATION LOG MODULE (Bilingual EN/KR UI + Admin AI Refresh & Precise KST)
   ========================================================================= */
const URL_APPLICATION = 'https://script.google.com/macros/s/AKfycbx1taySthB4Wf1X-hdkC77szE05MTY86x9Kc2w-kcYGP7CynC1j3qgaGDvqZiIYDthS/exec';
const APP_DB_NAME = 'a2MDS_ApplicationLog_DB';

let appRawHeaders = [], appDisplayHeaders = [], applicationDataset = [];
let appTableFilters = [], appMultiSelectFilters = {}, appSelectedInsightCodes = new Set();
let appShiftGroupsMap = {}, appAiInsightsCache = {};
let appCurrentPage = 1, appPageSize = 100, appFilteredIndices = [];
let appCurrentLastUpdated = '', appFilterDebounceTimer = null;

const formatAppBlank = v => (!v || String(v).trim() === '-' ? '' : String(v).trim());
const parseAppMarkdownBold = s => String(s || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

// 1. 날짜 및 퍼센트 포맷터
function formatAppDateStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s || s === '-' || s === 'null') return '';
  const mIso = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (mIso) return `${mIso[1]}-${String(mIso[2]).padStart(2, '0')}-${String(mIso[3]).padStart(2, '0')}`;
  const d = new Date(s);
  return !isNaN(d.getTime()) && s.length >= 8 ? d.toISOString().slice(0, 10) : s;
}

function formatAppLimitStr(val) {
  if (!val || val === '-') return '';
  const s = String(val).trim();
  if (s.includes('%')) return s;
  const num = parseFloat(s);
  return !isNaN(num) ? `${num > 0 && num < 1 ? Number((num * 100).toFixed(4)) : num}%` : s;
}

// 2. 스타일 매핑
const STATUS_MAP = {
  active: { cls: 'status-badge-active', chipCls: 'status-chip-active', style: 'color:#16a34a; font-weight:500;' },
  default: { cls: 'status-badge-normal', chipCls: 'tag', style: 'color:var(--text-body); font-weight:400;' }
};
const getStatusStyleInfo = v => STATUS_MAP[String(v || '').toLowerCase().trim()] || STATUS_MAP.default;

const RISK_MAP = {
  high: { cls: 'risk-badge-high', chipCls: 'risk-chip-high', style: 'color:#dc2626; font-weight:500;' },
  medium: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  med: { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' },
  low: { cls: 'risk-badge-low', chipCls: 'risk-chip-low', style: 'color:#16a34a; font-weight:400;' },
  default: { cls: 'risk-badge-muted', chipCls: 'risk-chip-muted', style: 'color:#64748b; font-weight:400;' }
};
const getRiskStyleInfo = v => RISK_MAP[String(v || '').toLowerCase().trim()] || RISK_MAP.default;

const renderClickableContent = v => (!v || v === '-' ? '-' : String(v).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'));

// 3. INDEXED DB 캐시 로직
function openAppDB() {
  return new Promise(res => {
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
}

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
  const clean = String(colName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (idx === 0 || clean.includes('appid') || clean === 'id') return 'col-app-id';
  if (clean.includes('name') || clean === 'application') return 'col-app-name';
  if (clean.includes('status')) return 'col-app-status';
  if (clean.includes('substan') || clean.includes('group')) return 'col-app-group';
  if (clean.includes('after')) return 'col-app-after';
  if (clean.includes('before')) return 'col-app-before';
  if (clean.includes('limit')) return 'col-app-limit';
  if (clean.includes('risk')) return 'col-app-risk';
  return 'col-app-elvr';
}

// 4. 테이블 헤더 및 필터 빌드
function setupAppHeadersAndBuildTable() {
  if (!appRawHeaders?.length) return;
  appDisplayHeaders = appRawHeaders.slice(0, 9);
  appTableFilters = Array(appDisplayHeaders.length).fill('');
  appMultiSelectFilters = {};
  appSelectedInsightCodes.clear();

  const table = document.getElementById('appDataTable');
  const headRow = document.getElementById('appTableHeadRow');
  const filterRow = document.getElementById('appTableFilterRow');
  if (!table || !headRow || !filterRow) return;

  let colgroup = table.querySelector('colgroup');
  if (colgroup) colgroup.remove();
  colgroup = document.createElement('colgroup');
  headRow.innerHTML = ''; filterRow.innerHTML = '';

  appDisplayHeaders.forEach((colName, idx) => {
    const cls = getAppColumnClass(colName, idx);
    const clean = String(colName).toLowerCase().replace(/[^a-z0-9]/g, '');
    colgroup.innerHTML += `<col class="${cls}">`;
    headRow.innerHTML += `<th class="${cls}">${colName}</th>`;

    const isMulti = clean.includes('status') || clean.includes('substan') || clean.includes('limit') || clean.includes('risk');
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
  populateAppDropdownFiltersAndWatchlist();
  renderAppDynamicInsights();
}

function populateAppDropdownFiltersAndWatchlist() {
  const multiIndices = Object.keys(appMultiSelectFilters).map(k => parseInt(k, 10));
  const uniqueCounts = {};
  multiIndices.forEach(idx => { uniqueCounts[idx] = {}; });

  applicationDataset.forEach(row => {
    multiIndices.forEach(idx => {
      const val = formatAppBlank(row[idx]);
      if (val) uniqueCounts[idx][val] = (uniqueCounts[idx][val] || 0) + 1;
    });
  });

  multiIndices.forEach(idx => {
    const dd = document.getElementById(`appMsDropdown_${idx}`);
    if (!dd) return;
    const sorted = Object.keys(uniqueCounts[idx]).sort();
    let html = `<label class="multiselect-item"><input type="checkbox" id="appChkAll_${idx}" checked onchange="selectAllAppDropdown(${idx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
    sorted.forEach(val => {
      html += `<label class="multiselect-item"><input type="checkbox" value="${val}" onchange="toggleAppDropdownItem(${idx}, '${val}', this.checked)"> <span>${val}</span></label>`;
    });
    dd.innerHTML = html;
  });

  const getIdx = str => appDisplayHeaders.findIndex(h => h.toLowerCase().includes(str));
  renderAppChips(getIdx('status'), 'appStatusTagsContainer', 'appStatusCountBadge', 'status', uniqueCounts);
  renderAppChips(getIdx('limit'), 'appLimitTagsContainer', 'appLimitCountBadge', 'limit', uniqueCounts);
  renderAppChips(getIdx('risk'), 'appRiskTagsContainer', 'appRiskCountBadge', 'risk', uniqueCounts);
}

function renderAppChips(colIdx, containerId, badgeId, typeCategory, uniqueCounts) {
  const container = document.getElementById(containerId);
  if (!container || colIdx === -1) return;
  const counts = uniqueCounts[colIdx] || {};
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const badge = document.getElementById(badgeId);
  if (badge) badge.textContent = `${keys.length.toLocaleString()} types`;

  if (!keys.length) { container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No records</span>'; return; }

  container.innerHTML = keys.map(k => {
    const isSelected = appMultiSelectFilters[colIdx]?.has(k);
    let chipCls = 'tag';
    if (typeCategory === 'status') chipCls = getStatusStyleInfo(k).chipCls;
    if (typeCategory === 'risk') chipCls = getRiskStyleInfo(k).chipCls;

    return `<span class="insight-chip ${chipCls} ${isSelected ? 'active' : ''}" data-col="${colIdx}" data-tag="${k}" onclick="applyAppSingleTagFilter(${colIdx}, '${k.replace(/'/g, "\\'")}')">
      ${k} <span class="insight-chip-badge">${counts[k]}</span>
    </span>`;
  }).join('');
}

// 5. Codes of Concern
function isExemptionClauseOnly(text) {
  if (!text) return true;
  const lines = String(text).split(/[\r\n]+/);
  return lines.every(line => {
    const s = line.trim();
    if (!s || s === '-' || s === '.' || s === 'null') return true;
    return /^(\d+(\([a-z0-9]+\))*[\s,\/-]*)+$/i.test(s);
  });
}

function extractMeaningfulPhrase(text) {
  if (!text) return '';
  let lines = String(text).split(/[\r\n]+/);
  let meaningfulLines = [];

  lines.forEach(line => {
    let s = line.trim();
    if (!s || s === '-' || s === '.' || s === 'null') return;
    if (/^https?:\/\//i.test(s)) return;
    if (/^(\d+(\([a-z0-9]+\))*[\s,\/-]*)+$/i.test(s)) return;
    s = s.replace(/^(\d+(\([a-z0-9]+\))*[\s\:\.\-–—]+)/i, '').trim();
    if (s && !/^https?:\/\//i.test(s)) meaningfulLines.push(s);
  });

  return meaningfulLines.join(' ');
}

function classifyShiftCategory(text, appId = '') {
  const raw = String(text || '').trim();
  const idStr = String(appId || '').trim().toLowerCase();

  if (/^https?:\/\//i.test(raw)) return null;
  if (isExemptionClauseOnly(raw) && idStr !== 'new') return null;

  let phrase = extractMeaningfulPhrase(raw);
  if (!phrase && idStr !== 'new') return null;

  const pLower = phrase.toLowerCase();
  if (pLower.includes('reach')) return 'REACH';
  if (idStr === 'new' || pLower.includes('newly') || pLower.includes('added') || /\bnew\b/i.test(pLower) || pLower.includes('신규')) return 'New';
  if (pLower.includes('deleted') || pLower.includes('삭제')) return 'Deleted';
  if (pLower.includes('date') || pLower.includes('changed') || pLower.includes('amend') || pLower.includes('extended')) return 'Date Changed';
  if (pLower.includes('no longer exist') || pLower.includes('no longer')) return 'No Longer Exist';
  if (pLower === 'imds' || pLower.includes('imds')) return 'IMDS';

  if (phrase.length > 0 && phrase.length <= 40) {
    return phrase.charAt(0).toUpperCase() + phrase.slice(1);
  }
  return null;
}

function renderAppDynamicInsights() {
  const futureContainer = document.getElementById('appFutureTagsContainer');
  const futureBadge = document.getElementById('appFutureCountBadge');
  const shiftContainer = document.getElementById('appShiftTagsContainer');
  const shiftBadge = document.getElementById('appShiftCountBadge');
  if (!futureContainer || !shiftContainer) return;

  let beforeIdx = -1, appIdIdx = 0, refColIdx = 8;
  appRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('before')) beforeIdx = idx;
    if (idx === 0 || clean.includes('appid') || clean === 'id') appIdIdx = idx;
    if (idx === 8 || clean.includes('reg') || clean.includes('reference') || clean.includes('elvr')) refColIdx = idx;
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const futureCodes = [];
  appShiftGroupsMap = {};
  let totalShiftIdCount = 0;
  const recordedShiftIds = new Set();

  applicationDataset.forEach(row => {
    const appId = formatAppBlank(row[appIdIdx]);
    if (!appId) return;

    if (beforeIdx !== -1) {
      const beforeDate = formatAppDateStr(row[beforeIdx]);
      if (beforeDate && beforeDate > todayStr && !futureCodes.some(f => f.id === appId)) {
        futureCodes.push({ id: appId, date: beforeDate });
      }
    }

    const refVal = formatAppBlank(row[refColIdx]);
    const catKey = classifyShiftCategory(refVal, appId);
    if (catKey) {
      if (!appShiftGroupsMap[catKey]) appShiftGroupsMap[catKey] = [];
      if (!appShiftGroupsMap[catKey].includes(appId)) appShiftGroupsMap[catKey].push(appId);
      if (!recordedShiftIds.has(appId)) {
        recordedShiftIds.add(appId);
        totalShiftIdCount++;
      }
    }
  });

  if (futureBadge) futureBadge.textContent = `${futureCodes.length.toLocaleString()} codes`;
  futureContainer.innerHTML = futureCodes.length ? futureCodes.map(f => `
    <span class="insight-chip tag ${appSelectedInsightCodes.has(f.id) ? 'active' : ''}" data-appid="${f.id}" title="Expires Before: ${f.date}" onclick="toggleAppSingleInsightCode('${f.id}')">
      ID ${f.id} <span class="insight-chip-badge" style="background:#e0f2fe; color:#0369a1;">${f.date}</span>
    </span>`).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No future expiring codes recorded.</span>';

  if (shiftBadge) shiftBadge.textContent = `${totalShiftIdCount.toLocaleString()} codes`;
  const fixedOrderKeys = ['New', 'Deleted', 'Date Changed', 'REACH', 'IMDS', 'No Longer Exist'];
  const dynamicKeys = Object.keys(appShiftGroupsMap).filter(k => !fixedOrderKeys.includes(k)).sort();
  const orderedKeys = [...fixedOrderKeys, ...dynamicKeys].filter(k => appShiftGroupsMap[k] && appShiftGroupsMap[k].length > 0);

  shiftContainer.innerHTML = orderedKeys.length ? orderedKeys.map(grpName => {
    const idList = appShiftGroupsMap[grpName];
    const isAllSelected = idList.length > 0 && idList.every(id => appSelectedInsightCodes.has(id));
    return `
      <span class="insight-chip tag ${isAllSelected ? 'active' : ''}" data-shift-group="${grpName}" title="Filter IDs: ${idList.join(', ')}" onclick="toggleAppKeywordGroupFilter('${grpName.replace(/'/g, "\\'")}')">
        ${grpName} <span class="insight-chip-badge">${idList.length}</span>
      </span>`;
  }).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No regulatory changes recorded.</span>';
}

function toggleAppKeywordGroupFilter(grp) {
  const ids = appShiftGroupsMap[grp] || [];
  const isAll = ids.length && ids.every(id => appSelectedInsightCodes.has(id));
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

function toggleAppDropdown(idx) {
  const dd = document.getElementById(`appMsDropdown_${idx}`);
  const btn = document.getElementById(`appMsBtn_${idx}`);
  if (!dd || !btn) return;
  if (dd.classList.toggle('show')) {
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 230)}px`;
  }
}

function syncAppChipHighlight(colIdx) {
  document.querySelectorAll(`.insight-chip[data-col="${colIdx}"]`).forEach(c => {
    c.classList.toggle('active', Boolean(appMultiSelectFilters[colIdx]?.has(c.getAttribute('data-tag'))));
  });
}

function selectAllAppDropdown(idx, chk) {
  appMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#appMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`appMsText_${idx}`);
  if (msText) msText.textContent = 'All';
  syncAppChipHighlight(idx); appCurrentPage = 1; filterAppTableRows();
}

function toggleAppDropdownItem(idx, val, checked) {
  if (checked) appMultiSelectFilters[idx].add(val); else appMultiSelectFilters[idx].delete(val);
  const cnt = appMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`appChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  const msText = document.getElementById(`appMsText_${idx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  syncAppChipHighlight(idx); appCurrentPage = 1; filterAppTableRows();
}

function applyAppSingleTagFilter(colIdx, val) {
  if (!appMultiSelectFilters[colIdx]) return;
  appMultiSelectFilters[colIdx].has(val) ? appMultiSelectFilters[colIdx].delete(val) : appMultiSelectFilters[colIdx].add(val);
  const dd = document.getElementById(`appMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c.value) c.checked = appMultiSelectFilters[colIdx].has(c.value); });
    const chkAll = document.getElementById(`appChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = (appMultiSelectFilters[colIdx].size === 0);
  }
  const msText = document.getElementById(`appMsText_${colIdx}`);
  if (msText) msText.textContent = appMultiSelectFilters[colIdx].size === 0 ? 'All' : `${appMultiSelectFilters[colIdx].size} selected`;
  syncAppChipHighlight(colIdx); appCurrentPage = 1; filterAppTableRows();
}

function onAppFilterChange(idx, val) {
  appTableFilters[idx] = val.toLowerCase().trim();
  appCurrentPage = 1;
  clearTimeout(appFilterDebounceTimer);
  appFilterDebounceTimer = setTimeout(filterAppTableRows, 150);
}

function filterAppTableRows() {
  appFilteredIndices = [];
  let appIdIdx = 0;
  appRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (idx === 0 || clean.includes('appid') || clean === 'id') appIdIdx = idx;
  });

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
  renderAppCurrentPage();
}

// 6. 메인 테이블 렌더링
function renderAppCurrentPage() {
  const tbody = document.getElementById('appTableDataBody');
  if (!tbody) return;
  const total = appFilteredIndices.length, pages = Math.ceil(total / appPageSize) || 1;
  appCurrentPage = Math.max(1, Math.min(appCurrentPage, pages));

  const start = (appCurrentPage - 1) * appPageSize, end = Math.min(start + appPageSize, total);
  let html = '';

  for (let i = start; i < end; i++) {
    const realIdx = appFilteredIndices[i], row = applicationDataset[realIdx];
    html += '<tr>';
    appDisplayHeaders.forEach((colName, cIdx) => {
      let val = formatAppBlank(row[cIdx]);
      const cls = getAppColumnClass(colName, cIdx), clean = colName.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (clean.includes('after') || clean.includes('before')) val = formatAppDateStr(val);
      else if (clean.includes('limit')) val = formatAppLimitStr(val);

      if (cIdx === 0 || clean.includes('appid') || clean === 'id') {
        html += `<td class="${cls}"><button type="button" class="cas-trigger-btn" onclick="openAppDetailsDrawer(${realIdx})" title="View Details">${val}</button></td>`;
      } else if (clean.includes('status')) {
        const s = getStatusStyleInfo(val);
        html += `<td class="${cls} ${s.cls}" style="${s.style}" title="${val}">${val}</td>`;
      } else if (clean.includes('risk')) {
        const r = getRiskStyleInfo(val);
        html += `<td class="${cls} ${r.cls}" style="${r.style}" title="${val}">${val}</td>`;
      } else {
        html += `<td class="${cls}" title="${val}">${val}</td>`;
      }
    });
    html += '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  const badge = document.getElementById('appViewerBadgeCount');
  if (badge) badge.textContent = `Showing ${total.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`;
  const pInfo = document.getElementById('appPageInfoDisplay');
  if (pInfo) pInfo.textContent = `Page ${appCurrentPage} of ${pages}`;
  const btnPrev = document.getElementById('btnAppPrevPage');
  if (btnPrev) btnPrev.disabled = (appCurrentPage <= 1);
  const btnNext = document.getElementById('btnAppNextPage');
  if (btnNext) btnNext.disabled = (appCurrentPage >= pages);
}

function goToAppPage(p) { appCurrentPage = p; renderAppCurrentPage(); }
function changeAppPageSize(s) { appPageSize = parseInt(s, 10); appCurrentPage = 1; renderAppCurrentPage(); }

function resetAppFilters() {
  document.querySelectorAll('#appTableFilterRow .filter-input').forEach(i => i.value = '');
  appTableFilters = Array(appDisplayHeaders.length).fill('');
  appSelectedInsightCodes.clear();
  syncAllInsightUIStates();
  Object.keys(appMultiSelectFilters).forEach(idx => {
    const chkAll = document.getElementById(`appChkAll_${idx}`);
    if (chkAll) selectAllAppDropdown(idx, chkAll);
  });
  filterAppTableRows();
}

// 7. 서랍 및 AI Insights (Bilingual EN/KR + Timestamp & Admin Refresh 지원)
async function requestGeminiInsightsFromGAS(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText, forceRefresh = false) {
  if (!forceRefresh && appAiInsightsCache[appId]) return appAiInsightsCache[appId];
  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!key) return null;

  try {
    const resp = await fetch(URL_APPLICATION, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        auth: key, 
        action: 'get_ai_insights', 
        appId, 
        appName, 
        substanceGroup, 
        riskLevel, 
        beforeDate, 
        afterDate, 
        limitVal, 
        elvrVal, 
        fullContext: fullContextText,
        forceRefresh: forceRefresh
      })
    });
    const res = await resp.json();
    if (res?.status === 'success' && res.insights) {
      appAiInsightsCache[appId] = res.insights;
      return res.insights;
    }
    return null;
  } catch(e) { return null; }
}

// 이중 언어 카드 렌더링 헬퍼
function buildAppBilingualSectionHtml(titleIcon, titleText, dataObj, fallbackEn, fallbackKr) {
  let enList = [];
  let krList = [];

  if (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) {
    enList = Array.isArray(dataObj.en) && dataObj.en.length ? dataObj.en : fallbackEn;
    krList = Array.isArray(dataObj.kr) && dataObj.kr.length ? dataObj.kr : fallbackKr;
  } else if (Array.isArray(dataObj) && dataObj.length) {
    enList = dataObj;
    krList = [];
  } else if (typeof dataObj === 'string' && dataObj.trim()) {
    enList = [dataObj];
    krList = [];
  } else {
    enList = fallbackEn;
    krList = fallbackKr;
  }

  return `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px;">
      <div style="font-weight:700; color:#0f172a; font-size:0.92rem; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
        <span>${titleIcon}</span> ${titleText}
      </div>
      <!-- 영문 목록 -->
      <ul style="margin:0; padding-left:18px; font-size:0.88rem; color:#334155; line-height:1.65;">
        ${enList.map(item => `<li>${parseAppMarkdownBold(item)}</li>`).join('')}
      </ul>
      <!-- 한글 번역 목록 (구분선 포함) -->
      ${krList.length ? `
        <div style="margin:12px 0 10px; border-top:1px dashed #cbd5e1;"></div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#475569; line-height:1.65;">
          ${krList.map(item => `<li>${parseAppMarkdownBold(item)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

async function renderRealtimeAIInsights(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText, forceRefresh = false) {
  const container = document.getElementById('appDrawerAiContentWrap');
  const metaBadge = document.getElementById('appAiGeneratedMeta');
  if (!container) return;

  if (forceRefresh) {
    container.innerHTML = `
      <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.15rem;">⏳</span> Force refreshing insights from Gemini AI...
      </div>`;
    if (metaBadge) metaBadge.textContent = 'Refreshing...';
  }

  const insights = await requestGeminiInsightsFromGAS(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText, forceRefresh);
  
  if (metaBadge) {
    const rawTime = insights?.generatedAt;
    const formattedKst = (typeof formatKstTimestampDetailed === 'function')
      ? formatKstTimestampDetailed(rawTime)
      : (rawTime || new Date().toISOString());
    metaBadge.textContent = `🕒 Generated: ${formattedKst}`;
  }

  const defaultRiskEn = [
    "**Timeline**: Evaluated under EU ELV Annex II thresholds.",
    "**OEM Impact**: Requires OEM compliance approval."
  ];
  const defaultRiskKr = [
    "**적용 일정 및 규제 현황**: EU ELV 부속서 II 기준치 및 면제 조건에 따라 평가됨.",
    "**OEM 승인 및 리스크**: 완성차 IMDS 규제 준수 승인 및 검증 필수."
  ];

  const defaultWhereEn = [
    "**Target Parts**: Functional metal alloys and electrical components.",
    "**Sub-systems**: Chassis, powertrain, and body modules."
  ];
  const defaultWhereKr = [
    "**적용 대상 부품**: 기능성 금속 합금 및 전기·전자 구성품.",
    "**하위 시스템**: 섀시, 파워트레인 및 차체 모듈."
  ];

  const riskCardHtml = buildAppBilingualSectionHtml('🛡️', 'Risk Level & OEM Approval', insights?.riskOemApproval, defaultRiskEn, defaultRiskKr);
  const whereCardHtml = buildAppBilingualSectionHtml('🎯', 'Where Used & Target Parts', insights?.whereUsed, defaultWhereEn, defaultWhereKr);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-top:6px;">
      ${riskCardHtml}
      ${whereCardHtml}
    </div>`;
}

function refreshCurrentAppAi(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText) {
  if (appAiInsightsCache[appId]) {
    delete appAiInsightsCache[appId];
  }
  renderRealtimeAIInsights(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText, true);
}

function openAppDetailsDrawer(realIdx) {
  const row = applicationDataset[realIdx];
  if (!row) return;

  const findVal = (str, isDate = false, isLimit = false) => {
    const idx = appRawHeaders.findIndex(h => h.toLowerCase().includes(str));
    if (idx === -1) return '-';
    let v = formatAppBlank(row[idx]);
    if (isDate) return formatAppDateStr(v) || '-';
    if (isLimit) return formatAppLimitStr(v) || '-';
    return v || '-';
  };

  const appId = formatAppBlank(row[0]) || '-';
  const appName = findVal('name');
  const statusVal = findVal('status');
  const substanceGroup = findVal('substan');
  const afterDate = findVal('after', true);
  const beforeDate = findVal('before', true);
  const limitVal = findVal('limit', false, true);
  const riskLevel = findVal('risk');
  const regRef = findVal('elvr');

  const sInfo = getStatusStyleInfo(statusVal);
  const rInfo = getRiskStyleInfo(riskLevel);
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

  const infoCard = document.getElementById('appDrawerInfoCard');
  if (infoCard) {
    infoCard.innerHTML = metaFields.map(f => `
      <div class="drawer-info-row"><span class="drawer-info-label">${f.label}</span><span class="drawer-info-val" title="${f.val}">${f.val}</span></div>
    `).join('');
  }

  let tableRowsHtml = '', fullContextArray = [];
  for (let idx = 9; idx < appRawHeaders.length; idx++) {
    const h = appRawHeaders[idx] || `Col ${idx + 1}`;
    let val = formatAppBlank(row[idx]);
    if (val) fullContextArray.push(`[${h}] ${val}`);
    if (/date|oj|after|before/i.test(h)) val = formatAppDateStr(val);
    tableRowsHtml += `<tr><td class="drawer-matrix-label">📝 ${h}</td><td class="drawer-matrix-val">${renderClickableContent(val)}</td></tr>`;
  }

  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  const fullCtxStr = fullContextArray.join('\n').replace(/'/g, "\\'");
  const safeId = appId.replace(/'/g, "\\'");
  const safeName = appName.replace(/'/g, "\\'");
  const safeSub = substanceGroup.replace(/'/g, "\\'");
  const safeRisk = riskLevel.replace(/'/g, "\\'");

  const extContainer = document.getElementById('appDrawerExtendedContainer');
  if (extContainer) {
    extContainer.innerHTML = `
      ${tableRowsHtml ? `<div class="drawer-matrix-table-wrap"><table class="drawer-matrix-table"><tbody>${tableRowsHtml}</tbody></table></div>` : ''}
      <div class="ai-insights-box">
        <div class="ai-insights-header">
          <div class="ai-insights-title">
            <span style="font-size:1.25rem;">🧠</span>
            <span>AI-Powered Insights</span>
          </div>
          <div style="font-size: 0.78rem; color: #64748b; margin: -2px 0 2px; display: flex; align-items: center; justify-content: center; gap: 5px;">
            <span>ℹ️</span>
            <span>AI can make mistakes. Always verify important information.</span>
          </div>
          <div class="ai-insights-meta-bar">
            <span id="appAiGeneratedMeta" class="ai-timestamp-badge">🕒 Checking...</span>
            ${isAdmin ? `<button type="button" class="btn-ai-refresh" onclick="refreshCurrentAppAi('${safeId}', '${safeName}', '${safeSub}', '${safeRisk}', '${beforeDate}', '${afterDate}', '${limitVal}', '${regRef}', '${fullCtxStr}')" title="Force refresh and overwrite server AI cache">🔄 Refresh</button>` : ''}
          </div>
        </div>
        <div class="ai-insights-content" id="appDrawerAiContentWrap">
          <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;"><span>⏳</span> Generating real-time regulatory & engineering insights via Gemini AI...</div>
        </div>
      </div>`;
  }

  const overlay = document.getElementById('appDrawerOverlay');
  if (overlay) overlay.style.display = 'flex';
  renderRealtimeAIInsights(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, regRef, fullContextArray.join('\n'), false);
}

function closeAppDrawer() {
  const overlay = document.getElementById('appDrawerOverlay');
  if (overlay) overlay.style.display = 'none';
}

// 8. Excel 내보내기
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

  const buf = await wb.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `a2MDS_Application_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
}
