/* =========================================================================
   APPLICATION LOG MODULE (Synchronized Risk & Status Color Mapping)
   ========================================================================= */
const URL_APPLICATION = 'https://script.google.com/macros/s/AKfycbx1taySthB4Wf1X-hdkC77szE05MTY86x9Kc2w-kcYGP7CynC1j3qgaGDvqZiIYDthS/exec';
const APP_DB_NAME = 'a2MDS_ApplicationLog_DB';

let appRawHeaders = [];
let appDisplayHeaders = [];
let applicationDataset = [];
let appTableFilters = [];
let appMultiSelectFilters = {};
let appDateFilters = { after: '', before: '' };

let appCurrentPage = 1;
let appPageSize = 100;
let appFilteredIndices = [];
let appCurrentLastUpdated = '';
let appFilterDebounceTimer = null;

const formatAppBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());

// 1. 날짜 YYYY-MM-DD 변환
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

// 2. Limit % 변환
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

// 3. Status 스타일 및 클래스 도출 (Active만 초록색 볼드)
function getStatusStyleInfo(val) {
  const v = String(val || '').toLowerCase().trim();
  if (v === 'active') {
    return { cls: 'status-badge-active', chipCls: 'status-chip-active', style: 'color:#16a34a; font-weight:700;' };
  }
  return { cls: 'status-badge-normal', chipCls: 'tag', style: 'color:var(--text-body); font-weight:400;' };
}

// 4. Risk Level 스타일 및 클래스 도출 (High는 빨강 볼드 칩, 나머지는 각 색상별 전용 칩)
function getRiskStyleInfo(val) {
  const v = String(val || '').toLowerCase().trim();
  if (v === 'high') {
    return { 
      cls: 'risk-badge-high', 
      chipCls: 'risk-chip-high', 
      style: 'color:#dc2626; font-weight:700;' 
    };
  }
  if (v === 'medium' || v === 'med') {
    return { 
      cls: 'risk-badge-medium', 
      chipCls: 'risk-chip-medium', 
      style: 'color:#d97706; font-weight:400;' 
    };
  }
  if (v === 'low') {
    return { 
      cls: 'risk-badge-low', 
      chipCls: 'risk-chip-low', 
      style: 'color:#16a34a; font-weight:400;' 
    };
  }
  return { 
    cls: 'risk-badge-muted', 
    chipCls: 'risk-chip-muted', 
    style: 'color:#64748b; font-weight:400;' 
  };
}

// 5. URL 링크 변환
function renderClickableContent(val) {
  if (!val || val === '-') return '-';
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  if (urlRegex.test(val)) {
    return val.replace(urlRegex, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
  }
  return val;
}

function openAppDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(APP_DB_NAME, 3);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('applications')) db.deleteObjectStore('applications');
      db.createObjectStore('applications', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveAppToDB(headers, rows, lastUpdated) {
  try {
    const db = await openAppDB();
    const tx = db.transaction('applications', 'readwrite');
    const store = tx.objectStore('applications');
    store.clear();
    store.put({ id: 'all_data', headers, rows, lastUpdated });
  } catch(e) {}
}

async function loadAppFromDB() {
  try {
    const db = await openAppDB();
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
    db.transaction('applications', 'readwrite').objectStore('applications').clear();
  } catch(e) {}
}

function normalizeDatasetValues(headers, rows) {
  return rows.map(row => {
    return row.map((cell, idx) => {
      const h = String(headers[idx] || '').toLowerCase();
      if (h.includes('after') || h.includes('before') || h.includes('date') || h.includes('oj')) {
        return formatAppDateStr(cell);
      }
      if (h.includes('limit')) {
        return formatAppLimitStr(cell);
      }
      return cell;
    });
  });
}

async function initApplicationModule() {
  const cached = await loadAppFromDB();
  if (cached?.rows?.length) {
    appRawHeaders = cached.headers;
    applicationDataset = normalizeDatasetValues(cached.headers, cached.rows);
    appCurrentLastUpdated = cached.lastUpdated || '';
    setupAppHeadersAndBuildTable();
    if (appCurrentLastUpdated) {
      const badge = document.getElementById('appLastModifiedBadge');
      if (badge) badge.textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
    }
    filterAppTableRows();
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

    if (res?.status === 'not_modified') {
      if (countBadge) countBadge.textContent = `Showing ${appFilteredIndices.length.toLocaleString()} of ${applicationDataset.length.toLocaleString()} applications`;
      return res;
    }

    if (res?.data?.length) {
      appRawHeaders = res.headers || [];
      applicationDataset = normalizeDatasetValues(appRawHeaders, res.data || []);
      appCurrentLastUpdated = res.lastUpdated || '';
      await saveAppToDB(appRawHeaders, applicationDataset, appCurrentLastUpdated);
      setupAppHeadersAndBuildTable();
      if (appCurrentLastUpdated) {
        const badge = document.getElementById('appLastModifiedBadge');
        if (badge) badge.textContent = `Last Modified: ${appCurrentLastUpdated} KST(UTC+9)`;
      }
      filterAppTableRows();
    }
    return res;
  } catch(err) {
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
  appDateFilters = { after: '', before: '' };

  const table = document.getElementById('appDataTable');
  const headRow = document.getElementById('appTableHeadRow');
  const filterRow = document.getElementById('appTableFilterRow');

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
    const isDateCol = clean.includes('after') || clean.includes('before');

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
    } else if (isDateCol) {
      const dateType = clean.includes('after') ? 'after' : 'before';
      filterRow.innerHTML += `
        <th class="filter-th ${cls}">
          <input type="date" class="filter-input" onchange="onAppDateFilterChange('${dateType}', this.value)">
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

function toggleAppDropdown(idx) {
  const dd = document.getElementById(`appMsDropdown_${idx}`);
  const btn = document.getElementById(`appMsBtn_${idx}`);
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
  document.getElementById(`appMsText_${idx}`).textContent = 'All';
  syncAppChipHighlight(idx);
  appCurrentPage = 1; filterAppTableRows();
}

function toggleAppDropdownItem(idx, val, checked) {
  if (checked) appMultiSelectFilters[idx].add(val); else appMultiSelectFilters[idx].delete(val);
  const cnt = appMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`appChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  document.getElementById(`appMsText_${idx}`).textContent = cnt === 0 ? 'All' : `${cnt} selected`;
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

function onAppDateFilterChange(type, val) {
  appDateFilters[type] = val;
  appCurrentPage = 1;
  filterAppTableRows();
}

function filterAppTableRows() {
  appFilteredIndices = [];

  let afterColIdx = -1, beforeColIdx = -1;
  appDisplayHeaders.forEach((h, idx) => {
    const clean = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('after')) afterColIdx = idx;
    if (clean.includes('before')) beforeColIdx = idx;
  });

  applicationDataset.forEach((row, rIdx) => {
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

    if (appDateFilters.after && afterColIdx !== -1) {
      const rowDate = formatAppDateStr(row[afterColIdx]);
      if (rowDate && rowDate < appDateFilters.after) return;
    }
    if (appDateFilters.before && beforeColIdx !== -1) {
      const rowDate = formatAppDateStr(row[beforeColIdx]);
      if (rowDate && rowDate > appDateFilters.before) return;
    }

    appFilteredIndices.push(rIdx);
  });

  renderAppCurrentPage();
}

function renderAppCurrentPage() {
  const tbody = document.getElementById('appTableDataBody');
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
  appDateFilters = { after: '', before: '' };
  Object.keys(appMultiSelectFilters).forEach(idx => {
    const chkAll = document.getElementById(`appChkAll_${idx}`);
    if (chkAll) selectAllAppDropdown(idx, chkAll);
    syncAppChipHighlight(idx);
  });
  filterAppTableRows();
}

/* =========================================================================
   APPLICATION DETAILS DRAWER (Top Summary Card + J-Column Beyond Extends)
   ========================================================================= */
function openAppDetailsDrawer(realIdx) {
  const row = applicationDataset[realIdx];
  if (!row) return;

  const appId = formatAppBlank(row[0]);
  document.getElementById('appDrawerTitle').textContent = `📑 Application ID: ${appId}`;

  // 1. 상단 정보 카드 (A~I열 3열 그리드 배치)
  let infoHtml = '';
  for (let idx = 0; idx < Math.min(9, appRawHeaders.length); idx++) {
    const headerName = appRawHeaders[idx] || `Col ${idx + 1}`;
    let val = formatAppBlank(row[idx]);
    const clean = headerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (clean.includes('after') || clean.includes('before') || clean.includes('date') || clean.includes('oj')) {
      val = formatAppDateStr(val);
    } else if (clean.includes('limit')) {
      val = formatAppLimitStr(val);
    }

    let valStyle = '';
    if (clean.includes('status')) {
      const statusInfo = getStatusStyleInfo(val);
      valStyle = `style="${statusInfo.style}"`;
    } else if (clean.includes('risk')) {
      const riskInfo = getRiskStyleInfo(val);
      valStyle = `style="${riskInfo.style}"`;
    }

    infoHtml += `
      <div class="drawer-info-row">
        <span class="drawer-info-label" title="${headerName}">${headerName}</span>
        <span class="drawer-info-val" ${valStyle} title="${val}">${val || '-'}</span>
      </div>`;
  }
  document.getElementById('appDrawerInfoCard').innerHTML = infoHtml;

  // 2. 하단 확장 섹션 (J열 [인덱스 9] 이후 모든 열 동적 순회 및 포맷팅)
  let extHtml = '';
  for (let idx = 9; idx < appRawHeaders.length; idx++) {
    const headerName = appRawHeaders[idx] || `Column ${idx + 1}`;
    let val = formatAppBlank(row[idx]);
    const clean = headerName.toLowerCase().replace(/[^a-z0-9]/g, '');

    if (clean.includes('date') || clean.includes('oj') || clean.includes('after') || clean.includes('before')) {
      val = formatAppDateStr(val);
    }

    const displayHtml = renderClickableContent(val);

    extHtml += `
      <div class="drawer-extended-item">
        <label class="drawer-extended-label">📝 ${headerName}</label>
        <div class="drawer-details-box">${displayHtml}</div>
      </div>`;
  }

  document.getElementById('appDrawerExtendedContainer').innerHTML = extHtml || '<div class="drawer-details-box" style="text-align:center; color:var(--text-muted);">No additional extended details recorded beyond Column I.</div>';
  document.getElementById('appDrawerOverlay').style.display = 'flex';
}

function closeAppDrawer() {
  document.getElementById('appDrawerOverlay').style.display = 'none';
}

async function exportAppExcel() {
  if (!applicationDataset.length) return;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Applications", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws.columns = appDisplayHeaders.map(h => ({ header: h, key: h, width: 22 }));

  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  appFilteredIndices.forEach(realIdx => ws.addRow(applicationDataset[realIdx]));
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `a2MDS_Application_Report_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.xlsx`);
}
