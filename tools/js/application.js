/* =========================================================================
   APPLICATION LOG MODULE (Refined Drawer Layout & Structured AI Bullets)
   ========================================================================= */
const URL_APPLICATION = 'https://script.google.com/macros/s/AKfycbx1taySthB4Wf1X-hdkC77szE05MTY86x9Kc2w-kcYGP7CynC1j3qgaGDvqZiIYDthS/exec';
const APP_DB_NAME = 'a2MDS_ApplicationLog_DB';

let appRawHeaders = [];
let appDisplayHeaders = [];
let applicationDataset = [];
let appTableFilters = [];
let appMultiSelectFilters = {};
let appSelectedInsightCodes = new Set();
let appShiftGroupsMap = {};
let appAiInsightsCache = {};

let appCurrentPage = 1;
let appPageSize = 100;
let appFilteredIndices = [];
let appCurrentLastUpdated = '';
let appFilterDebounceTimer = null;

const formatAppBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());

function parseAppMarkdownBold(str) {
  return String(str || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function formatAppDateStr(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (!s || s === '-' || s === 'null' || s === 'undefined') return '';

  const mIso = s.match(/^(\d{4})[-\/\.](\d{1,2})[-\/\.](\d{1,2})/);
  if (mIso) {
    const y = mIso[1];
    const m = String(mIso[2]).padStart(2, '0');
    const d = String(mIso[3]).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const pDate = new Date(s);
  if (!isNaN(pDate.getTime())) {
    const y = pDate.getFullYear();
    const m = String(pDate.getMonth() + 1).padStart(2, '0');
    const d = String(pDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const mEn = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\-\.]+(\d{1,2})[,\s\-\.]+(\d{4})/i);
  if (mEn) {
    const months = { jan:'01', feb:'02', mar:'03', apr:'04', may:'05', jun:'06', jul:'07', aug:'08', sep:'09', oct:'10', nov:'11', dec:'12' };
    const m = months[mEn[1].toLowerCase().slice(0, 3)] || '01';
    const d = String(mEn[2]).padStart(2, '0');
    const y = mEn[3];
    return `${y}-${m}-${d}`;
  }

  return s;
}

function formatAppLimitStr(val) {
  if (val === undefined || val === null) return '';
  const s = String(val).trim();
  if (!s || s === '-' || s === 'null') return '';
  if (s.includes('%')) return s;

  const num = parseFloat(s);
  if (!isNaN(num)) {
    if (num > 0 && num < 1) {
      const pct = Number((num * 100).toFixed(4));
      return `${pct}%`;
    }
    if (num === 1) return '100%';
    return `${num}%`;
  }
  return s;
}

function getStatusStyleInfo(val) {
  const v = String(val || '').toLowerCase().trim();
  if (v === 'active') {
    return { cls: 'status-badge-active', chipCls: 'status-chip-active', style: 'color:#16a34a; font-weight:500;' };
  }
  return { cls: 'status-badge-normal', chipCls: 'tag', style: 'color:var(--text-body); font-weight:400;' };
}

function getRiskStyleInfo(val) {
  const v = String(val || '').toLowerCase().trim();
  if (v === 'high') {
    return { cls: 'risk-badge-high', chipCls: 'risk-chip-high', style: 'color:#dc2626; font-weight:500;' };
  }
  if (v === 'medium' || v === 'med') {
    return { cls: 'risk-badge-medium', chipCls: 'risk-chip-medium', style: 'color:#d97706; font-weight:400;' };
  }
  if (v === 'low') {
    return { cls: 'risk-badge-low', chipCls: 'risk-chip-low', style: 'color:#16a34a; font-weight:400;' };
  }
  return { cls: 'risk-badge-muted', chipCls: 'risk-chip-muted', style: 'color:#64748b; font-weight:400;' };
}

function renderClickableContent(val) {
  if (!val || val === '-') return '-';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  if (urlRegex.test(val)) {
    return val.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  return val;
}

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
    } catch(e) { 
      res(null); 
    }
  });
}

async function saveAppToDB(headers, rows, lastUpdated) {
  try {
    const db = await openAppDB();
    if (!db) return;
    const tx = db.transaction('applications', 'readwrite');
    const store = tx.objectStore('applications');
    store.clear();
    store.put({ id: 'all_data', headers, rows, lastUpdated });
  } catch(e) {}
}

async function loadAppFromDB() {
  try {
    const db = await openAppDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('applications', 'readonly').objectStore('applications').get('all_data');
      req.onsuccess = () => {
        const item = req.result;
        if (!item || !item.rows?.length) return res(null);
        res({ headers: item.headers || [], rows: item.rows, lastUpdated: item.lastUpdated || '' });
      };
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

async function initApplicationModule() {
  try {
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
    }
  } catch(e) {
    console.error("initApplicationModule error:", e);
  }
}

async function fetchApplicationData(authOverride = '', forceReload = false) {
  const key = authOverride || getStoredAuthKey();
  if (!key) return;

  const btnSync = document.getElementById('btnSyncCloudApp');
  if (btnSync) { btnSync.textContent = '⏳ Syncing...'; btnSync.disabled = true; }
  const countBadge = document.getElementById('appViewerBadgeCount');
  if (countBadge && !applicationDataset.length) countBadge.textContent = 'Syncing...';

  try {
    const payload = {
      auth: key,
      action: 'fetch_data',
      clientLastUpdated: forceReload ? '' : appCurrentLastUpdated
    };

    const resp = await fetch(URL_APPLICATION, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
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
    } else if (res?.status === 'not_modified' && applicationDataset.length > 0) {
      if (countBadge) countBadge.textContent = `Showing ${appFilteredIndices.length.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`;
    }
    return res;
  } catch(err) {
    console.error("fetchApplicationData Error:", err);
    if (countBadge && !applicationDataset.length) countBadge.textContent = 'Sync Failed';
  } finally {
    if (btnSync) { btnSync.textContent = '🔄 Reload'; btnSync.disabled = false; }
  }
}

function getAppColumnClass(colName, idx) {
  const clean = String(colName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (idx === 0 || clean.includes('appid') || clean === 'id') return 'col-app-id';
  if (clean === 'application' || clean.includes('appname')) return 'col-app-name';
  if (clean.includes('status')) return 'col-app-status';
  if (clean.includes('substan') || clean.includes('group')) return 'col-app-group';
  if (clean.includes('after')) return 'col-app-after';
  if (clean.includes('before')) return 'col-app-before';
  if (clean.includes('limit')) return 'col-app-limit';
  if (clean.includes('risk')) return 'col-app-risk';
  return 'col-app-elvr';
}

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
  headRow.innerHTML = '';
  filterRow.innerHTML = '';

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
      filterRow.innerHTML += `
        <th class="filter-th ${cls}">
          <input type="text" class="filter-input" placeholder="Filter..." oninput="onAppFilterChange(${idx}, this.value)">
        </th>`;
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
      let val = formatAppBlank(row[idx]);
      if (val) {
        uniqueCounts[idx][val] = (uniqueCounts[idx][val] || 0) + 1;
      }
    });
  });

  multiIndices.forEach(idx => {
    const dd = document.getElementById(`appMsDropdown_${idx}`);
    if (!dd) return;
    const sortedKeys = Object.keys(uniqueCounts[idx]).sort();
    let html = `<label class="multiselect-item"><input type="checkbox" id="appChkAll_${idx}" checked onchange="selectAllAppDropdown(${idx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
    sortedKeys.forEach(val => {
      html += `<label class="multiselect-item"><input type="checkbox" value="${val}" onchange="toggleAppDropdownItem(${idx}, '${val}', this.checked)"> <span>${val}</span></label>`;
    });
    dd.innerHTML = html;
  });

  let statusColIdx = -1, limitColIdx = -1, riskColIdx = -1;
  appDisplayHeaders.forEach((h, idx) => {
    const clean = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('status')) statusColIdx = idx;
    if (clean.includes('limit')) limitColIdx = idx;
    if (clean.includes('risk')) riskColIdx = idx;
  });

  renderAppChips(statusColIdx, 'appStatusTagsContainer', 'appStatusCountBadge', 'status', uniqueCounts);
  renderAppChips(limitColIdx, 'appLimitTagsContainer', 'appLimitCountBadge', 'limit', uniqueCounts);
  renderAppChips(riskColIdx, 'appRiskTagsContainer', 'appRiskCountBadge', 'risk', uniqueCounts);
}

function renderAppChips(colIdx, containerId, badgeId, typeCategory, uniqueCounts) {
  const container = document.getElementById(containerId);
  const badge = document.getElementById(badgeId);
  if (!container || colIdx === -1) return;

  const counts = uniqueCounts[colIdx] || {};
  const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  if (badge) badge.textContent = `${keys.length.toLocaleString()} types`;

  if (keys.length === 0) {
    container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No records</span>';
    return;
  }

  let html = '';
  keys.forEach(key => {
    const isSelected = appMultiSelectFilters[colIdx]?.has(key);
    let chipClass = 'tag';

    if (typeCategory === 'status') {
      const statusInfo = getStatusStyleInfo(key);
      chipClass = statusInfo.chipCls;
    } else if (typeCategory === 'risk') {
      const riskInfo = getRiskStyleInfo(key);
      chipClass = riskInfo.chipCls;
    }

    html += `<span class="insight-chip ${chipClass} ${isSelected ? 'active' : ''}" data-col="${colIdx}" data-tag="${key}" onclick="applyAppSingleTagFilter(${colIdx}, '${key.replace(/'/g, "\\'")}')">
      ${key} <span class="insight-chip-badge">${counts[key]}</span>
    </span>`;
  });
  container.innerHTML = html;
}

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
    if (/^(\d+(\([a-z0-9]+\))*[\s,\/-]*)+$/i.test(s)) return;
    s = s.replace(/^(\d+(\([a-z0-9]+\))*[\s\:\.\-–—]+)/i, '').trim();
    if (s) meaningfulLines.push(s);
  });

  return meaningfulLines.join(' ');
}

function classifyShiftCategory(text, appId = '') {
  const raw = String(text || '').trim();
  const idStr = String(appId || '').trim().toLowerCase();

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

  if (phrase.length > 0) {
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

  let beforeIdx = -1, appIdIdx = 0;
  
  appRawHeaders.forEach((h, idx) => {
    const clean = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('before')) beforeIdx = idx;
    if (clean.includes('appid') || clean === 'id') appIdIdx = idx;
  });

  let refColIdx = 8;
  if (refColIdx >= appRawHeaders.length && appRawHeaders.length > 0) {
    refColIdx = appRawHeaders.length - 1;
  }

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
      if (beforeDate && beforeDate > todayStr) {
        if (!futureCodes.some(f => f.id === appId)) {
          futureCodes.push({ id: appId, date: beforeDate });
        }
      }
    }

    const refVal = formatAppBlank(row[refColIdx]);
    const catKey = classifyShiftCategory(refVal, appId);
    if (catKey) {
      if (!appShiftGroupsMap[catKey]) {
        appShiftGroupsMap[catKey] = [];
      }
      if (!appShiftGroupsMap[catKey].includes(appId)) {
        appShiftGroupsMap[catKey].push(appId);
      }
      if (!recordedShiftIds.has(appId)) {
        recordedShiftIds.add(appId);
        totalShiftIdCount++;
      }
    }
  });

  if (futureBadge) futureBadge.textContent = `${futureCodes.length.toLocaleString()} codes`;
  if (futureCodes.length === 0) {
    futureContainer.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No future expiring codes recorded.</span>';
  } else {
    futureContainer.innerHTML = futureCodes.map(f => {
      const isSelected = appSelectedInsightCodes.has(f.id);
      return `
        <span class="insight-chip tag ${isSelected ? 'active' : ''}" data-appid="${f.id}" title="Expires Before: ${f.date}" onclick="toggleAppSingleInsightCode('${f.id}')">
          ID ${f.id} <span class="insight-chip-badge" style="background:#e0f2fe; color:#0369a1;">${f.date}</span>
        </span>
      `;
    }).join('');
  }

  if (shiftBadge) shiftBadge.textContent = `${totalShiftIdCount.toLocaleString()} codes`;
  const fixedOrderKeys = ['New', 'Deleted', 'Date Changed', 'REACH', 'IMDS', 'No Longer Exist'];
  
  const dynamicKeys = Object.keys(appShiftGroupsMap).filter(k => !fixedOrderKeys.includes(k)).sort();
  const orderedKeys = [...fixedOrderKeys, ...dynamicKeys].filter(k => appShiftGroupsMap[k] && appShiftGroupsMap[k].length > 0);

  if (orderedKeys.length === 0) {
    shiftContainer.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No regulatory changes recorded.</span>';
  } else {
    let html = '';
    orderedKeys.forEach(grpName => {
      const idList = appShiftGroupsMap[grpName];
      const isAllGroupSelected = idList.length > 0 && idList.every(id => appSelectedInsightCodes.has(id));
      const titleTooltip = `Filter IDs: ${idList.join(', ')}`;

      html += `
        <span class="insight-chip tag ${isAllGroupSelected ? 'active' : ''}" 
              data-shift-group="${grpName}" 
              title="${titleTooltip}" 
              onclick="toggleAppKeywordGroupFilter('${grpName.replace(/'/g, "\\'")}')">
          ${grpName} 
          <span class="insight-chip-badge">${idList.length}</span>
        </span>
      `;
    });
    shiftContainer.innerHTML = html;
  }
}

function toggleAppKeywordGroupFilter(grpName) {
  const idList = appShiftGroupsMap[grpName] || [];
  if (!idList.length) return;

  const isAllSelected = idList.every(id => appSelectedInsightCodes.has(id));

  if (isAllSelected) {
    idList.forEach(id => appSelectedInsightCodes.delete(id));
  } else {
    idList.forEach(id => appSelectedInsightCodes.add(id));
  }

  syncAllInsightUIStates();
  appCurrentPage = 1;
  filterAppTableRows();
}

function toggleAppSingleInsightCode(appId) {
  if (appSelectedInsightCodes.has(appId)) {
    appSelectedInsightCodes.delete(appId);
  } else {
    appSelectedInsightCodes.add(appId);
  }

  syncAllInsightUIStates();
  appCurrentPage = 1;
  filterAppTableRows();
}

function syncAllInsightUIStates() {
  document.querySelectorAll('.insight-chip[data-appid]').forEach(chip => {
    const id = chip.getAttribute('data-appid');
    if (appSelectedInsightCodes.has(id)) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });

  document.querySelectorAll('.insight-chip[data-shift-group]').forEach(chip => {
    const grp = chip.getAttribute('data-shift-group');
    const idList = appShiftGroupsMap[grp] || [];
    if (idList.length > 0 && idList.every(id => appSelectedInsightCodes.has(id))) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function toggleAppDropdown(idx) {
  const dd = document.getElementById(`appMsDropdown_${idx}`);
  const btn = document.getElementById(`appMsBtn_${idx}`);
  if (!dd || !btn) return;
  const isShow = dd.classList.toggle('show');
  if (isShow) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
  }
}

function syncAppChipHighlight(colIdx) {
  const chips = document.querySelectorAll(`.insight-chip[data-col="${colIdx}"]`);
  chips.forEach(chip => {
    const tagVal = chip.getAttribute('data-tag');
    const isSelected = appMultiSelectFilters[colIdx]?.has(tagVal);

    if (isSelected) {
      chip.classList.add('active');
    } else {
      chip.classList.remove('active');
    }
  });
}

function selectAllAppDropdown(idx, chk) {
  appMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#appMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`appMsText_${idx}`);
  if (msText) msText.textContent = 'All';
  syncAppChipHighlight(idx);
  appCurrentPage = 1; filterAppTableRows();
}

function toggleAppDropdownItem(idx, val, checked) {
  if (checked) appMultiSelectFilters[idx].add(val); else appMultiSelectFilters[idx].delete(val);
  const cnt = appMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`appChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  const msText = document.getElementById(`appMsText_${idx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  syncAppChipHighlight(idx);
  appCurrentPage = 1; filterAppTableRows();
}

function applyAppSingleTagFilter(colIdx, tagVal) {
  if (!appMultiSelectFilters[colIdx]) return;
  if (appMultiSelectFilters[colIdx].has(tagVal)) {
    appMultiSelectFilters[colIdx].delete(tagVal);
  } else {
    appMultiSelectFilters[colIdx].add(tagVal);
  }

  const cnt = appMultiSelectFilters[colIdx].size;
  const dd = document.getElementById(`appMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => {
      if (c.value) c.checked = appMultiSelectFilters[colIdx].has(c.value);
    });
    const chkAll = document.getElementById(`appChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = (cnt === 0);
  }
  const msText = document.getElementById(`appMsText_${colIdx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;

  syncAppChipHighlight(colIdx);
  appCurrentPage = 1; 
  filterAppTableRows();
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
    const clean = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('appid') || clean === 'id') appIdIdx = idx;
  });

  applicationDataset.forEach((row, rIdx) => {
    if (appSelectedInsightCodes.size > 0) {
      const currentAppId = formatAppBlank(row[appIdIdx]);
      if (!appSelectedInsightCodes.has(currentAppId)) return;
    }

    for (let i = 0; i < appTableFilters.length; i++) {
      const kw = appTableFilters[i];
      if (kw && !formatAppBlank(row[i]).toLowerCase().includes(kw)) return;
    }

    for (const [idxStr, selectedSet] of Object.entries(appMultiSelectFilters)) {
      if (selectedSet.size > 0) {
        const cellVal = formatAppBlank(row[parseInt(idxStr, 10)]);
        if (!selectedSet.has(cellVal)) return;
      }
    }

    appFilteredIndices.push(rIdx);
  });

  renderAppCurrentPage();
}

function renderAppCurrentPage() {
  const tbody = document.getElementById('appTableDataBody');
  if (!tbody) return;

  const totalMatches = appFilteredIndices.length;
  const totalPages = Math.ceil(totalMatches / appPageSize) || 1;

  if (appCurrentPage > totalPages) appCurrentPage = totalPages;
  if (appCurrentPage < 1) appCurrentPage = 1;

  const start = (appCurrentPage - 1) * appPageSize;
  const end = Math.min(start + appPageSize, totalMatches);
  let html = '';

  for (let i = start; i < end; i++) {
    const realIdx = appFilteredIndices[i];
    const row = applicationDataset[realIdx];

    html += '<tr>';
    appDisplayHeaders.forEach((colName, cIdx) => {
      let val = formatAppBlank(row[cIdx]);
      const cls = getAppColumnClass(colName, cIdx);
      const clean = colName.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (clean.includes('after') || clean.includes('before')) {
        val = formatAppDateStr(val);
      } else if (clean.includes('limit')) {
        val = formatAppLimitStr(val);
      }

      if (cIdx === 0 || clean.includes('appid') || clean === 'id') {
        html += `<td class="${cls}"><button type="button" class="cas-trigger-btn" onclick="openAppDetailsDrawer(${realIdx})" title="View Details">${val}</button></td>`;
      } else if (clean.includes('status')) {
        const statusInfo = getStatusStyleInfo(val);
        html += `<td class="${cls} ${statusInfo.cls}" style="${statusInfo.style}" title="${val}">${val}</td>`;
      } else if (clean.includes('risk')) {
        const riskInfo = getRiskStyleInfo(val);
        html += `<td class="${cls} ${riskInfo.cls}" style="${riskInfo.style}" title="${val}">${val}</td>`;
      } else {
        html += `<td class="${cls}" title="${val}">${val}</td>`;
      }
    });
    html += '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  
  const badge = document.getElementById('appViewerBadgeCount');
  if (badge) badge.textContent = `Showing ${totalMatches.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`;
  const pInfo = document.getElementById('appPageInfoDisplay');
  if (pInfo) pInfo.textContent = `Page ${appCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;
  const btnPrev = document.getElementById('btnAppPrevPage');
  if (btnPrev) btnPrev.disabled = (appCurrentPage <= 1);
  const btnNext = document.getElementById('btnAppNextPage');
  if (btnNext) btnNext.disabled = (appCurrentPage >= totalPages);
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
    syncAppChipHighlight(idx);
  });
  filterAppTableRows();
}

/* =========================================================================
   APPLICATION DETAILS DRAWER (Structured AI Insights & Explicit Badges)
   ========================================================================= */
async function requestGeminiInsightsFromGAS(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText) {
  if (appAiInsightsCache[appId]) {
    return appAiInsightsCache[appId];
  }

  const key = getStoredAuthKey();
  if (!key) return null;

  try {
    const payload = {
      auth: key,
      action: 'get_ai_insights',
      appId: appId,
      appName: appName,
      substanceGroup: substanceGroup,
      riskLevel: riskLevel,
      beforeDate: beforeDate,
      afterDate: afterDate,
      limitVal: limitVal,
      elvrVal: elvrVal,
      conditions: fullContextText,
      fullContext: fullContextText
    };

    const resp = await fetch(URL_APPLICATION, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'success' && res.insights) {
      appAiInsightsCache[appId] = res.insights;
      return res.insights;
    }
    return null;
  } catch(e) {
    return null;
  }
}

async function renderRealtimeAIInsights(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText, statusVal) {
  const container = document.getElementById('appDrawerAiContentWrap');
  if (!container) return;

  const insights = await requestGeminiInsightsFromGAS(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, elvrVal, fullContextText);

  let riskItems = [];
  if (Array.isArray(insights?.riskOemApproval) && insights.riskOemApproval.length > 0) {
    riskItems = insights.riskOemApproval;
  } else if (typeof insights?.riskOemApproval === 'string' && insights.riskOemApproval.trim()) {
    riskItems = [insights.riskOemApproval];
  } else {
    riskItems = [
      "**Timeline**: Evaluation based on EU ELV Annex II thresholds.",
      "**OEM Impact**: Direct mass production use requires OEM compliance approval."
    ];
  }

  let whereItems = [];
  if (Array.isArray(insights?.whereUsed) && insights.whereUsed.length > 0) {
    whereItems = insights.whereUsed;
  } else if (typeof insights?.whereUsed === 'string' && insights.whereUsed.trim()) {
    whereItems = [insights.whereUsed];
  } else {
    whereItems = [
      "**Target Parts**: Functional metal alloys, electronic units, and fasteners.",
      "**Sub-systems**: Chassis systems, powertrain assemblies, and body modules."
    ];
  }

  const renderSubList = (arr) => {
    return `<ul style="margin:4px 0 0 0; padding-left:18px; list-style-type:circle; color:#334155; font-size:0.85rem; line-height:1.6;">` +
      arr.map(item => `<li>${parseAppMarkdownBold(item)}</li>`).join('') +
      `</ul>`;
  };

  container.innerHTML = `
    <ul style="margin:0; padding-left:18px; line-height:1.65; list-style-type:disc;">
      <li style="margin-bottom:10px;">
        <strong style="color:#0f172a; font-size:0.88rem;">Risk Level & OEM Approval</strong>
        ${renderSubList(riskItems)}
      </li>
      <li style="margin-bottom:4px;">
        <strong style="color:#0f172a; font-size:0.88rem;">Where used</strong>
        ${renderSubList(whereItems)}
      </li>
    </ul>
  `;
}

function openAppDetailsDrawer(realIdx) {
  const row = applicationDataset[realIdx];
  if (!row) return;

  let appId = '', appName = '', statusVal = '', substanceGroup = '', afterDate = '', beforeDate = '', limitVal = '', riskLevel = '', regRef = '';
  let fullContextArray = [];

  let appIdIdx = -1, appNameIdx = -1, statusIdx = -1, substIdx = -1, afterIdx = -1, beforeIdx = -1, limitIdx = -1, riskIdx = -1, regRefIdx = -1;

  appRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (idx === 0 || clean.includes('appid') || clean === 'id') appIdIdx = idx;
    else if (clean === 'application' || clean.includes('appname')) appNameIdx = idx;
    else if (clean.includes('status')) statusIdx = idx;
    else if (clean.includes('substan') || clean.includes('group')) substIdx = idx;
    else if (clean.includes('after')) afterIdx = idx;
    else if (clean.includes('before')) beforeIdx = idx;
    else if (clean.includes('limit')) limitIdx = idx;
    else if (clean.includes('risk')) riskIdx = idx;
    else if (idx === 8 || clean.includes('reg') || clean.includes('reference') || clean.includes('elvr')) regRefIdx = idx;
  });

  appId = appIdIdx !== -1 ? formatAppBlank(row[appIdIdx]) : '-';
  appName = appNameIdx !== -1 ? formatAppBlank(row[appNameIdx]) : '-';
  statusVal = statusIdx !== -1 ? formatAppBlank(row[statusIdx]) : '-';
  substanceGroup = substIdx !== -1 ? formatAppBlank(row[substIdx]) : '-';
  afterDate = afterIdx !== -1 ? formatAppDateStr(row[afterIdx]) : '-';
  beforeDate = beforeIdx !== -1 ? formatAppDateStr(row[beforeIdx]) : '-';
  limitVal = limitIdx !== -1 ? formatAppLimitStr(row[limitIdx]) : '-';
  riskLevel = riskIdx !== -1 ? formatAppBlank(row[riskIdx]) : '-';
  regRef = regRefIdx !== -1 ? formatAppBlank(row[regRefIdx]) : '-';

  let statusBadgeHtml = '';
  if (statusVal && statusVal !== '-') {
    const sInfo = getStatusStyleInfo(statusVal);
    statusBadgeHtml = `<span class="badge-tag-dp ${sInfo.cls}" style="margin-left:8px; font-size:0.8rem; padding:2px 8px; ${sInfo.style}">Status: ${statusVal}</span>`;
  }
  let riskBadgeHtml = '';
  if (riskLevel && riskLevel !== '-') {
    const rInfo = getRiskStyleInfo(riskLevel);
    riskBadgeHtml = `<span class="badge-tag-dp ${rInfo.cls}" style="margin-left:6px; font-size:0.8rem; padding:2px 8px; ${rInfo.style}">Risk Level: ${riskLevel}</span>`;
  }

  const titleEl = document.getElementById('appDrawerTitle');
  if (titleEl) {
    titleEl.innerHTML = `📑 App ID: <strong>${appId}</strong>${statusBadgeHtml}${riskBadgeHtml}`;
  }

  const metaFields = [
    { label: 'Application', val: appName },
    { label: 'Substance Group', val: substanceGroup },
    { label: 'Limit', val: limitVal },
    { label: 'After', val: afterDate },
    { label: 'Before', val: beforeDate },
    { label: 'Reg. Reference', val: regRef }
  ];

  let metaHtml = '';
  metaFields.forEach(f => {
    metaHtml += `
      <div class="drawer-info-row">
        <span class="drawer-info-label" title="${f.label}">${f.label}</span>
        <span class="drawer-info-val" title="${f.val}">${f.val || '-'}</span>
      </div>`;
  });
  const infoCard = document.getElementById('appDrawerInfoCard');
  if (infoCard) infoCard.innerHTML = metaHtml;

  let tableRowsHtml = '';
  for (let idx = 9; idx < appRawHeaders.length; idx++) {
    const headerName = appRawHeaders[idx] || `Column ${idx + 1}`;
    let val = formatAppBlank(row[idx]);
    const clean = headerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (val) fullContextArray.push(`[${headerName}] ${val}`);

    if (clean.includes('date') || clean.includes('oj') || clean.includes('after') || clean.includes('before')) {
      val = formatAppDateStr(val);
    }

    const displayHtml = renderClickableContent(val);

    tableRowsHtml += `
      <tr>
        <td class="drawer-matrix-label">📝 ${headerName}</td>
        <td class="drawer-matrix-val">${displayHtml}</td>
      </tr>`;
  }

  let extHtml = '';
  if (tableRowsHtml) {
    extHtml += `
      <div class="drawer-matrix-table-wrap">
        <table class="drawer-matrix-table">
          <tbody>${tableRowsHtml}</tbody>
        </table>
      </div>`;
  }

  extHtml += `
    <div class="ai-insights-box">
      <div class="ai-insights-header">
        <div class="ai-insights-title">🧠 AI-Driven Insights</div>
      </div>
      <div class="ai-insights-content" id="appDrawerAiContentWrap">
        <div style="color:var(--text-muted); font-size:0.82rem; display:flex; align-items:center; gap:8px;">
          <span style="font-size:1.1rem;">⏳</span> Generating real-time regulatory & engineering insights via Gemini AI...
        </div>
      </div>
    </div>
  `;

  const extContainer = document.getElementById('appDrawerExtendedContainer');
  if (extContainer) extContainer.innerHTML = extHtml;
  
  const drawerOverlay = document.getElementById('appDrawerOverlay');
  if (drawerOverlay) drawerOverlay.style.display = 'flex';

  const fullContextText = fullContextArray.join('\n');
  renderRealtimeAIInsights(appId, appName, substanceGroup, riskLevel, beforeDate, afterDate, limitVal, regRef, fullContextText, statusVal);
}

function closeAppDrawer() {
  const drawerOverlay = document.getElementById('appDrawerOverlay');
  if (drawerOverlay) drawerOverlay.style.display = 'none';
}

/* =========================================================================
   EXCEL EXPORT
   ========================================================================= */
async function exportAppExcel() {
  if (!applicationDataset.length) return;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Applications", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });

  const exportHeaders = appRawHeaders.length ? appRawHeaders : appDisplayHeaders;
  ws.columns = exportHeaders.map((h, idx) => ({
    header: h,
    key: `col_${idx}`,
    width: idx === 0 ? 10 : (idx === 1 ? 30 : 20)
  }));

  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  appFilteredIndices.forEach(realIdx => {
    const fullRowData = applicationDataset[realIdx];
    ws.addRow(fullRowData);
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: exportHeaders.length } };

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `a2MDS_Application_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
}
