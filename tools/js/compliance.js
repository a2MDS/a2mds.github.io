/* =========================================================================
   COMPLIANCE LOG MODULE (Dual Tabs: Log & Daily Feed, Compact Fixed Layout)
   ========================================================================= */
const URL_COMPLIANCE = 'https://script.google.com/macros/s/AKfycbyGilhtUIPaPbcNfFeXgdho08nAdnsT0xzFjZafy9CIwkg2cXsJ5tk0qkV3BO3QA6yT/exec';
const COMP_DB_NAME = 'a2MDS_ComplianceLog_DB';

// 1. Log Tab State
let compRawHeaders = [], compDisplayColumns = [], compDataset = [];
let compTimelineRawData = [], compTableFilters = [];
let compMultiSelectFilters = {}, compEditingItemId = null;
let compUnsavedChanges = new Set();
let compCurrentPage = 1, compPageSize = 50;

// 2. Daily Feed Tab State
let compDailyFeedHeaders = [], compDailyFeedRows = [], compDailyFeedErrors = [];
let compFeedFilters = {};

// 채널별 원본 공식 사이트 링크 매핑
const COMP_CHANNEL_SOURCE_URLS = {
  "RMI News": "https://www.responsiblemineralsinitiative.org/news/",
  "IMDS News": "https://public.mdsystem.com/en/web/imds-public-pages/imds-news",
  "IMDS News (Services)": "https://public.mdsystem.com/en/web/imds-public-pages/imds-extended-services-news",
  "IMDS Release Notes(Next)": "https://public.mdsystem.com/en/web/imds-public-pages/release-notes-mof-next",
  "IMDS Professional Blog": "https://www.imds-professional.com/en/ipblog/",
  "Assent Content Hub": "https://www.assent.com/resources/content-hub/?pager=1&filter=1&filter_order=newest",
  "CDX News": "https://public.cdxsystem.com/en/web/cdx/news",
  "CDX Updates": "https://public.cdxsystem.com/en/web/cdx/updates-releases",
  "CDX Events": "https://public.cdxsystem.com/en/web/cdx/events",
  "iPoint (News)": "https://www.ipoint-systems.com/news/",
  "iPoint (Blog)": "https://www.ipoint-systems.com/news/",
  "ECHA News": "https://echa.europa.eu/news",
  "COMPASS": "https://www.compass.or.kr/news/newsList",
  "EUR-Lex": "https://eur-lex.europa.eu/homepage.html",
  "ECHACHEM": "https://chem.echa.europa.eu/",
  "국가법령정보센터": "https://www.law.go.kr/"
};

function getChannelSourceUrl(name) {
  if (!name) return '#';
  for (const [key, url] of Object.entries(COMP_CHANNEL_SOURCE_URLS)) {
    if (name.includes(key) || key.includes(name)) return url;
  }
  if (name.startsWith('EUR-Lex')) return 'https://eur-lex.europa.eu/homepage.html';
  if (name.startsWith('ECHACHEM')) return 'https://chem.echa.europa.eu/';
  if (name.startsWith('국가법령')) return 'https://www.law.go.kr/';
  return '#';
}

// 0. Summary 영역 접이식 토글 핸들러
function toggleCompSummarySection() {
  const body = document.getElementById('compSummaryBody');
  const icon = document.getElementById('compSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

// Sub-Tab Switcher
function switchCompSubTab(tabKey, btnElem) {
  document.querySelectorAll('#viewCompliance .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewCompliance .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const defaultBtn = document.getElementById(`btnCompTab${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`);
    defaultBtn?.classList.add('active');
  }

  const paneId = `compSubPane${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`;
  document.getElementById(paneId)?.classList.add('active');

  if (tabKey === 'feed') {
    renderCompDailyFeedTable();
  }
}

// Helpers
const escapeHtmlAttr = s => String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeHtmlText = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatCompDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (s === '-' || s === 'null' || s === 'undefined') return '';
  if (s.includes('T')) {
    const p = s.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  }
  if (/^\d{4}[\.\/]\d{2}[\.\/]\d{2}$/.test(s)) return s.replace(/[\.\/]/g, '-');
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime()) && s.length >= 8) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function updateCompAdminUI() {
  const saveBtn = document.getElementById('btnSaveAllTop');
  if (saveBtn) {
    saveBtn.style.display = (typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin()) ? 'inline-flex' : 'none';
  }
}

// 1. IndexedDB Operations
const openCompDB = () => new Promise(res => {
  try {
    const req = indexedDB.open(COMP_DB_NAME, 6);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('sources')) db.deleteObjectStore('sources');
      db.createObjectStore('sources', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  } catch(e) { res(null); }
});

async function saveCompToDB(headers, items, lastUpdated, timeline, dailyFeed) {
  try {
    const db = await openCompDB();
    if (!db) return;
    const tx = db.transaction('sources', 'readwrite');
    const store = tx.objectStore('sources');
    store.clear();
    store.put({ id: '__meta__', headers, lastUpdated, timeline, dailyFeed });
    items.forEach(i => store.put(i));
  } catch(e) {}
}

async function loadCompFromDB() {
  try {
    const db = await openCompDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('sources', 'readonly').objectStore('sources').getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        if (!items.length) return res(null);
        const meta = items.find(i => i.id === '__meta__');
        res({
          headers: meta?.headers || [],
          lastUpdated: meta?.lastUpdated || '',
          timeline: meta?.timeline || [],
          dailyFeed: meta?.dailyFeed || { headers: [], data: [], errors: [] },
          rows: items.filter(i => i.id !== '__meta__')
        });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearCompIndexedDB() {
  try {
    const db = await openCompDB();
    if (db) db.transaction('sources', 'readwrite').objectStore('sources').clear();
  } catch(e) {}
}

// 2. Initialization & Fetch
async function initComplianceModule() {
  updateCompAdminUI();
  const cached = await loadCompFromDB();
  if (cached?.rows?.length) {
    compRawHeaders = cached.headers;
    compDataset = cached.rows;
    compTimelineRawData = cached.timeline;
    
    if (cached.dailyFeed) {
      compDailyFeedHeaders = cached.dailyFeed.headers || [];
      compDailyFeedRows = cached.dailyFeed.data || [];
      compDailyFeedErrors = cached.dailyFeed.errors || [];
    }

    setupCompColumns();
    renderCompTimeline();
    filterCompRows();
    renderCompDailyFeedTable();

    if (cached.lastUpdated) {
      const b = document.getElementById('compLastModifiedBadge');
      if (b) b.textContent = `Last Modified: ${cached.lastUpdated} KST(UTC+9)`;
    }
  }
}

async function fetchComplianceData(authOverride = '') {
  const key = authOverride || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) {
    document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
    return { status: 'auth_failed' };
  }

  const badge = document.getElementById('compViewerBadgeCount');
  if (badge) badge.textContent = 'Syncing...';

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data' })
    });
    const res = await resp.json();

    if (res?.status === 'auth_failed') {
      if (typeof clearStoredAuthKey === 'function') clearStoredAuthKey();
      document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
      return res;
    }

    compRawHeaders = res.headers || [];
    compTimelineRawData = res.timeline || [];
    compUnsavedChanges.clear();

    compDataset = (res.data || []).map((item, idx) => ({
      id: `ROW_${idx}`,
      source: item[0] || item.source || '',
      linkName: item[1] || item.linkName || '',
      linkUrl: item[2] || item.linkUrl || '',
      method: item[3] || item.method || '',
      criteria: item[4] || item.criteria || '',
      date: formatCompDate(item[5] || item.date),
      ref: item[6] || item.ref || '',
      details: item[7] || item.details || ''
    }));

    if (res.dailyFeed) {
      compDailyFeedHeaders = res.dailyFeed.headers || [];
      compDailyFeedRows = res.dailyFeed.data || [];
      compDailyFeedErrors = res.dailyFeed.errors || [];
    }

    await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData, res.dailyFeed);
    setupCompColumns();
    renderCompTimeline();
    filterCompRows();
    renderCompDailyFeedTable();
    updateSaveButtonState();
    updateCompAdminUI();

    if (res.lastUpdated) {
      const b = document.getElementById('compLastModifiedBadge');
      if (b) b.textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
    }
    return res;
  } catch(err) {
    if (badge) badge.textContent = 'Sync Failed';
    throw err;
  }
}

// 3. Milestone Timeline Rendering
function renderCompTimeline() {
  const wrapper = document.getElementById('compTimelineWrapper');
  if (!wrapper) return;
  if (!compTimelineRawData?.length) {
    wrapper.innerHTML = '<div style="padding:20px; color:#64748b; text-align:center; font-size:0.85rem;">No Timeline milestones available.</div>';
    return;
  }

  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(compTimelineRawData.length, 6); r++) {
    const row = compTimelineRawData[r] || [];
    const dateCount = row.filter(cell => /\d{4}/.test(String(cell))).length;
    if (dateCount >= 1) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = compTimelineRawData[headerRowIdx] || [];
  const dataRows = compTimelineRawData.slice(headerRowIdx + 1);
  const validColIndices = [];
  let firstDateColIdx = 999;

  headerRow.forEach((h, c) => {
    const raw = String(h || '').trim();
    if (!raw) return;
    if (/\d{4}|[12]H|Q[1-4]/i.test(raw)) {
      validColIndices.push({ index: c, label: raw });
      if (c < firstDateColIdx) firstDateColIdx = c;
    }
  });

  const regNameColIdx = (firstDateColIdx > 0 && firstDateColIdx !== 999) ? (firstDateColIdx - 1) : 0;

  let html = `
    <table class="timeline-table" style="width:100%; min-width:980px; border-collapse:separate; border-spacing:0;">
      <thead>
        <tr>
          <th class="reg-name-th" style="min-width:160px; text-align:left; padding:8px 12px;">Regulation</th>
          ${validColIndices.map(col => `<th style="min-width:110px; text-align:center; padding:8px 10px; white-space:nowrap;">${escapeHtmlText(col.label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>`;

  let hasRows = false;
  dataRows.forEach(row => {
    let regName = String(row[regNameColIdx] || '').trim();
    if (!regName) {
      for (let c = 0; c < firstDateColIdx; c++) {
        const v = String(row[c] || '').trim();
        if (v) { regName = v; break; }
      }
    }
    if (!regName) return;
    hasRows = true;

    html += `<tr><td class="reg-name-td" style="padding:8px 12px; font-weight:600; color:#1e293b;">${escapeHtmlText(regName)}</td>` +
      validColIndices.map(col => {
        const val = String(row[col.index] || '').trim();
        if (!val || val === '-') return '<td style="color:#cbd5e1; text-align:center; padding:6px 8px;">-</td>';
        const isHigh = /Entry into Force|Application|Final adoption|Repeal/i.test(val);
        const badgeClass = isHigh ? 'milestone-badge highlight' : 'milestone-badge';
        return `<td style="padding:6px 8px; text-align:center;"><span class="${badgeClass}">${escapeHtmlText(val).replace(/\n/g, '<br>')}</span></td>`;
      }).join('') + '</tr>';
  });

  if (!hasRows) html += `<tr><td colspan="${validColIndices.length + 1}" style="text-align:center; padding:20px; color:#64748b;">No Regulation entries found.</td></tr>`;
  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

// 4. Columns Setup (Log Tab)
function setupCompColumns() {
  compDisplayColumns = [
    { key: 'no', label: 'No.', width: '45px' },
    { key: 'source', label: compRawHeaders[0] || 'Source', width: '90px', isMulti: true },
    { key: 'link', label: 'Link', width: '150px' },
    { key: 'method', label: compRawHeaders[3] || 'Method', width: '85px', isMulti: true },
    { key: 'criteria', label: compRawHeaders[4] || 'Date Basis', width: '95px' },
    { key: 'date', label: compRawHeaders[5] || 'Date', width: '115px' },
    { key: 'ref', label: compRawHeaders[6] || 'Ref. Values', width: '105px' },
    { key: 'details', label: compRawHeaders[7] || 'Additional Notes', width: 'auto' }
  ];

  const headRow = document.getElementById('compTableHeadRow');
  const filterRow = document.getElementById('compTableFilterRow');
  if (!headRow || !filterRow) return;

  headRow.innerHTML = ''; 
  filterRow.innerHTML = '';
  compTableFilters = Array(compDisplayColumns.length).fill('');
  compMultiSelectFilters = { 1: new Set(), 3: new Set() };

  compDisplayColumns.forEach((col, idx) => {
    headRow.innerHTML += `<th style="width:${col.width}; padding:8px 6px; font-size:0.80rem; text-align:center;">${col.label}</th>`;
    
    if (col.isMulti) {
      filterRow.innerHTML += `
        <th class="filter-th" style="padding:4px 4px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="compMsBtn_${idx}" onclick="toggleCompDropdown(${idx})" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="compMsText_${idx}">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compMsDropdown_${idx}"></div>
          </div>
        </th>`;
    } else if (col.key !== 'no') {
      filterRow.innerHTML += `<th class="filter-th" style="padding:4px 4px;"><input type="text" class="filter-input" placeholder="Filter..." oninput="onCompFilterChange(${idx}, this.value)" style="padding:3px 5px; font-size:0.75rem;"></th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th"></th>';
    }
  });

  updateCompAdminUI();
}

function getCompRowField(r, idx) {
  const searchVals = [
    '', 
    r.source, 
    `${r.linkName} ${r.linkUrl}`, 
    r.method, 
    r.criteria, 
    r.date, 
    r.ref, 
    r.details
  ];
  return searchVals[idx] || '';
}

function getCompAvailableRows(excludeColIdx = -1) {
  return compDataset.filter((r, rowIdx) => {
    for (let i = 0; i < compDisplayColumns.length; i++) {
      if (i === excludeColIdx) continue;
      
      if (compDisplayColumns[i].isMulti) {
        const selSet = compMultiSelectFilters[i];
        if (selSet && selSet.size > 0) {
          const val = getCompRowField(r, i);
          if (!selSet.has(val)) return false;
        }
      } else {
        const kw = compTableFilters[i];
        if (kw) {
          const target = (i === 0) ? String(rowIdx + 1) : getCompRowField(r, i);
          if (!target.toLowerCase().includes(kw)) return false;
        }
      }
    }
    return true;
  });
}

function populateSingleCompDropdown(colIdx) {
  const dd = document.getElementById(`compMsDropdown_${colIdx}`);
  if (!dd) return;

  const availableRows = getCompAvailableRows(colIdx);
  const rawList = availableRows.map(r => getCompRowField(r, colIdx)).filter(Boolean);
  const unique = [...new Set(rawList)].sort();
  const currentSet = compMultiSelectFilters[colIdx] || new Set();

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (textEl) textEl.textContent = currentSet.size === 0 ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="compChkAll_${colIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompDropdown(${colIdx}, this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:4px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `
      <label class="multiselect-item">
        <input type="checkbox" value="${escapeHtmlAttr(val)}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompDropdownItem(${colIdx}, '${escapeHtmlAttr(val)}', this.checked)">
        <span>${escapeHtmlText(val)}</span>
      </label>`).join('');
}

function populateCompAllDropdowns() {
  [1, 3].forEach(colIdx => populateSingleCompDropdown(colIdx));
}

function toggleCompDropdown(colIdx) {
  const dd = document.getElementById(`compMsDropdown_${colIdx}`);
  const btn = document.getElementById(`compMsBtn_${colIdx}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleCompDropdown(colIdx);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 260))}px`;
    dd.classList.add('show');
  }
}

function selectAllCompDropdown(colIdx, chk) {
  if (compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx].clear();
  document.querySelectorAll(`#compMsDropdown_${colIdx} input[type="checkbox"]`).forEach(c => { 
    if (c !== chk) c.checked = false; 
  });
  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (textEl) textEl.textContent = 'All';
  compCurrentPage = 1;
  filterCompRows();
}

function toggleCompDropdownItem(colIdx, val, checked) {
  if (!compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx] = new Set();
  checked ? compMultiSelectFilters[colIdx].add(val) : compMultiSelectFilters[colIdx].delete(val);
  
  const cnt = compMultiSelectFilters[colIdx].size;
  const chkAll = document.getElementById(`compChkAll_${colIdx}`);
  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  if (textEl) textEl.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  
  compCurrentPage = 1;
  filterCompRows();
}

function onCompFilterChange(idx, val) {
  compTableFilters[idx] = val.toLowerCase().trim();
  compCurrentPage = 1;
  filterCompRows();
}

function getFilteredCompData() {
  return compDataset.filter((r, rowIdx) => {
    if (compMultiSelectFilters[1]?.size && !compMultiSelectFilters[1].has(r.source)) return false;
    if (compMultiSelectFilters[3]?.size && !compMultiSelectFilters[3].has(r.method)) return false;

    for (let i = 0; i < compDisplayColumns.length; i++) {
      if (compDisplayColumns[i].isMulti) continue;
      const kw = compTableFilters[i];
      if (kw) {
        const target = (i === 0) ? String(rowIdx + 1) : getCompRowField(r, i);
        if (!target.toLowerCase().includes(kw)) return false;
      }
    }
    return true;
  });
}

// 5. Main Table Render & Pagination (Log Tab)
function filterCompRows() {
  populateCompAllDropdowns();
  const tbody = document.getElementById('compTableDataBody');
  if (!tbody) return;

  const filtered = getFilteredCompData();
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / compPageSize));

  if (compCurrentPage > totalPages) compCurrentPage = totalPages;
  const startIdx = (compCurrentPage - 1) * compPageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + compPageSize);

  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  let html = '';

  pagedRows.forEach((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const isDirty = compUnsavedChanges.has(r.id);
    const rowBg = isDirty ? 'background-color: #fffbeb;' : '';
    const hasLink = Boolean(r.linkUrl && r.linkUrl !== '#');

    html += `
      <tr data-id="${r.id}" style="${rowBg}">
        <td style="text-align:center; color:#64748b; font-size:0.78rem; padding:4px 6px;">
          ${actualNo}
          ${isDirty ? '<span title="Unsaved changes" style="display:inline-block; width:6px; height:6px; background:#ea580c; border-radius:50%; margin-left:2px; vertical-align:top;"></span>' : ''}
        </td>
        <td style="padding:4px 6px; font-size:0.80rem; color:#334155; font-weight:normal; white-space:nowrap; text-align:center;">${escapeHtmlText(r.source || '-')}</td>
        <td style="padding:4px 6px; max-width:150px;">
          <div class="editable-cell-box" style="display:flex; align-items:center; justify-content:space-between; gap:4px; width:100%; min-width:0;">
            ${hasLink 
              ? `<a href="${escapeHtmlAttr(r.linkUrl)}" target="_blank" rel="noopener noreferrer" class="link-anchor" style="color:#0284c7; text-decoration:none; font-size:0.80rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; flex:1; min-width:0;" title="${escapeHtmlAttr(r.linkName || r.linkUrl)}">${escapeHtmlText(r.linkName || 'Open Link')} ↗</a>` 
              : `<span style="color:#94a3b8; font-size:0.78rem; font-style:italic;">No link</span>`}
            ${isAdmin ? `<button type="button" class="btn-edit-inline" onclick="openLinkModal('${r.id}')" data-tooltip="Edit Link" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.78rem; padding:2px; flex-shrink:0;">✎</button>` : ''}
          </div>
        </td>
        <td style="padding:4px 6px; text-align:center; white-space:nowrap;">
          <span class="cell-read-only" style="font-size:0.78rem; text-align:center; color:#475569;" title="${escapeHtmlAttr(r.method || '-')}">${escapeHtmlText(r.method || '-')}</span>
        </td>
        <td style="padding:4px 6px;"><span class="cell-read-only" style="font-size:0.80rem;" title="${escapeHtmlAttr(r.criteria || '-')}">${escapeHtmlText(r.criteria || '-')}</span></td>
        <td style="padding:3px 4px;">
          ${isAdmin 
            ? `<input type="date" class="tbl-input-date" value="${r.date || ''}" onchange="updateCompCell('${r.id}', 'date', this.value)" style="padding:2px 4px; font-size:0.76rem; border:1px solid #cbd5e1; border-radius:4px; width:100%; box-sizing:border-box;">`
            : `<span class="cell-read-only" style="font-size:0.80rem; text-align:center;">${r.date || '-'}</span>`}
        </td>
        <td style="padding:3px 4px;">
          ${isAdmin 
            ? `<input type="text" class="tbl-input-text" value="${escapeHtmlAttr(r.ref || '')}" onchange="updateCompCell('${r.id}', 'ref', this.value)" placeholder="Ref" style="padding:2px 5px; font-size:0.78rem; border:1px solid #cbd5e1; border-radius:4px; width:100%; box-sizing:border-box;">`
            : `<span class="cell-read-only" style="font-size:0.80rem;">${escapeHtmlText(r.ref || '-')}</span>`}
        </td>
        <td style="padding:4px 6px;">
          <div style="display:flex; align-items:flex-start; gap:4px;">
            ${isAdmin 
              ? `<textarea class="tbl-textarea-details" oninput="autoGrowCompTextarea(this)" onchange="updateCompCell('${r.id}', 'details', this.value)" placeholder="Additional notes..." style="padding:4px 6px; font-size:0.80rem; min-height:32px; max-height:80px; overflow-y:auto; border:1px solid #cbd5e1; border-radius:4px; width:100%; box-sizing:border-box;">${escapeHtmlText(r.details || '')}</textarea>
                 <button type="button" onclick="openNotesModal('${r.id}')" data-tooltip="Expand Notes" style="background:#fff; border:1px solid #cbd5e1; border-radius:4px; padding:4px 5px; font-size:0.75rem; cursor:pointer; flex-shrink:0;">🔍</button>`
              : `<div class="cell-read-only" style="white-space:pre-wrap; line-height:1.4; font-size:0.80rem; color:#334155; max-height:80px; overflow-y:auto;">${escapeHtmlText(r.details || '-')}</div>`}
          </div>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html || `<tr><td colspan="${compDisplayColumns.length}" style="text-align:center; padding:24px; color:#94a3b8;">No matching records found.</td></tr>`;
  
  const countBadge = document.getElementById('compViewerBadgeCount');
  if (countBadge) countBadge.textContent = `Showing ${filtered.length} of ${compDataset.length} sources`;

  const pageInfo = document.getElementById('compPageInfoDisplay');
  if (pageInfo) pageInfo.textContent = `Page ${compCurrentPage} of ${totalPages}`;

  const btnPrev = document.getElementById('btnCompPrevPage');
  const btnNext = document.getElementById('btnCompNextPage');
  if (btnPrev) btnPrev.disabled = (compCurrentPage <= 1);
  if (btnNext) btnNext.disabled = (compCurrentPage >= totalPages);

  requestAnimationFrame(() => {
    document.querySelectorAll('#compTableDataBody .tbl-textarea-details').forEach(el => autoGrowCompTextarea(el));
  });
}

function goToCompPage(page) {
  const filtered = getFilteredCompData();
  const totalPages = Math.max(1, Math.ceil(filtered.length / compPageSize));
  if (page < 1 || page > totalPages) return;
  compCurrentPage = page;
  filterCompRows();
}

function changeCompPageSize(newSize) {
  compPageSize = parseInt(newSize, 10) || 50;
  compCurrentPage = 1;
  filterCompRows();
}

// 세로 높이 강제 제한 (최대 80px)
function autoGrowCompTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.min(Math.max(el.scrollHeight, 34), 80);
  el.style.height = `${newHeight}px`;
  el.style.overflowY = el.scrollHeight > 80 ? 'auto' : 'hidden';
}

function updateCompCell(id, key, val) {
  const item = compDataset.find(d => d.id === id);
  if (item) {
    item[key] = val.trim();
    compUnsavedChanges.add(id);
    updateSaveButtonState();
    
    const rowEl = document.querySelector(`tr[data-id="${id}"]`);
    if (rowEl) rowEl.style.backgroundColor = '#fffbeb';
  }
}

function updateSaveButtonState() {
  const btn = document.getElementById('btnSaveAllTop');
  if (!btn) return;
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'inline-flex';

  if (compUnsavedChanges.size > 0) {
    btn.style.background = '#ea580c';
    btn.style.color = '#ffffff';
    btn.style.fontWeight = '700';
    btn.textContent = `💾 Save (${compUnsavedChanges.size} uncommitted)`;
  } else {
    btn.style.background = '';
    btn.style.color = '';
    btn.style.fontWeight = '';
    btn.textContent = '💾 Save';
  }
}

function resetComplianceFilters() {
  document.querySelectorAll('#compTableFilterRow .filter-input').forEach(i => i.value = '');
  compTableFilters = Array(compDisplayColumns.length).fill('');
  
  [1, 3].forEach(colIdx => {
    if (compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx].clear();
    document.querySelectorAll(`#compMsDropdown_${colIdx} input[type="checkbox"]`).forEach(c => { c.checked = false; });
    const allChk = document.getElementById(`compChkAll_${colIdx}`);
    if (allChk) allChk.checked = true;
    const textEl = document.getElementById(`compMsText_${colIdx}`);
    if (textEl) textEl.textContent = 'All';
  });

  compCurrentPage = 1;
  filterCompRows();
}

// =========================================================================
// 6. DAILY FEED (100% Fixed Layout, Ellipsis, Source Links)
// =========================================================================
function renderCompDailyFeedTable() {
  const table = document.getElementById('compFeedDataTable');
  const headRow = document.getElementById('compFeedTableHeadRow');
  const filterRow = document.getElementById('compFeedTableFilterRow');
  const tbody = document.getElementById('compFeedTableDataBody');
  const badge = document.getElementById('compDailyFeedBadge');
  const tabBadge = document.getElementById('compFeedCountBadge');
  if (!headRow || !filterRow || !tbody) return;

  if (table) {
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
  }

  if (tabBadge) {
    tabBadge.textContent = compDailyFeedRows.length;
    tabBadge.style.display = compDailyFeedRows.length ? 'inline-flex' : 'none';
  }

  if (!compDailyFeedHeaders.length && !compDailyFeedRows.length) {
    headRow.innerHTML = '<th>Status</th>';
    filterRow.innerHTML = '<th class="filter-th"></th>';
    tbody.innerHTML = '<tr><td style="text-align:center; padding:24px; color:#94a3b8;">No Daily Feed data synchronized yet.</td></tr>';
    if (badge) badge.textContent = '0 items';
    return;
  }

  // Source/Endpoint 열을 270px로 확장하여 명칭 전체를 온전히 노출
  const widths = ['40px', '270px', '80px', '95px', 'auto', '65px'];

  headRow.innerHTML = compDailyFeedHeaders.map((h, i) => {
    const w = widths[i] || 'auto';
    return `<th style="width:${w}; max-width:${w}; padding:8px 6px; font-size:0.80rem; text-align:center; box-sizing:border-box;">${escapeHtmlText(h)}</th>`;
  }).join('');

  filterRow.innerHTML = compDailyFeedHeaders.map((h, i) => {
    const w = widths[i] || 'auto';
    if (i === 0 || i === compDailyFeedHeaders.length - 1) {
      return `<th class="filter-th" style="width:${w}; padding:4px 2px; text-align:center;"></th>`;
    }
    return `<th class="filter-th" style="width:${w}; padding:4px 3px; box-sizing:border-box;">
      <input type="text" class="filter-input" placeholder="Filter..." oninput="onCompFeedFilterChange(${i}, this.value)" style="width:100%; padding:3px 5px; font-size:0.75rem; box-sizing:border-box;">
    </th>`;
  }).join('');

  filterCompFeedRows();
  renderCompDailyFeedErrors();
}

function filterCompFeedRows() {
  const tbody = document.getElementById('compFeedTableDataBody');
  const badge = document.getElementById('compDailyFeedBadge');
  if (!tbody) return;

  const filtered = compDailyFeedRows.filter(row => {
    for (const [colIdxStr, kw] of Object.entries(compFeedFilters)) {
      if (!kw) continue;
      const c = parseInt(colIdxStr, 10);
      const cellVal = String(row[c] || '').toLowerCase();
      if (!cellVal.includes(kw)) return false;
    }
    return true;
  });

  if (badge) badge.textContent = `${filtered.length} of ${compDailyFeedRows.length} items`;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="${compDailyFeedHeaders.length || 1}" style="text-align:center; padding:24px; color:#94a3b8;">No matching feed records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(row => {
    return '<tr style="height:36px;">' + row.map((cell, cIdx) => {
      const val = String(cell || '').trim();

      // 1. No 열 (40px, 중앙 정렬)
      if (cIdx === 0) {
        return `<td style="text-align:center; font-weight:600; color:#64748b; font-size:0.78rem; padding:4px 2px; white-space:nowrap;">${escapeHtmlText(val)}</td>`;
      }

      // 2. Source / Endpoint 열 (270px, 말줄임 없이 전체 텍스트 온전히 노출, 원본 링크)
      if (cIdx === 1) {
        const srcUrl = getChannelSourceUrl(val);
        return `<td style="padding:4px 8px; font-size:0.80rem; white-space:nowrap;">
          <a href="${srcUrl}" target="_blank" rel="noopener noreferrer" style="color:#0284c7; text-decoration:none; font-weight:600;">${escapeHtmlText(val)}</a>
        </td>`;
      }

      // 3. Status 열 (80px, 중앙 정렬)
      if (cIdx === 2) {
        let statusHtml = `<span style="color:#64748b; font-size:0.76rem;">${escapeHtmlText(val)}</span>`;
        if (val === 'NEW') statusHtml = '<strong style="color:#16a34a; font-size:0.78rem;">NEW</strong>';
        else if (val === 'ERROR') statusHtml = '<strong style="color:#dc2626; font-size:0.78rem;">ERROR</strong>';
        return `<td style="text-align:center; padding:4px 2px; white-space:nowrap;">${statusHtml}</td>`;
      }

      // 4. Date 열 (95px, 중앙 정렬)
      if (cIdx === 3) {
        return `<td style="text-align:center; font-size:0.76rem; color:#475569; padding:4px 2px; white-space:nowrap;">${escapeHtmlText(val)}</td>`;
      }

      // 5. Link 열 (65px, 마지막 열, 원클릭 버튼)
      if (cIdx === row.length - 1) {
        const isUrl = /^https?:\/\//i.test(val);
        return `<td style="text-align:center; padding:4px 4px; white-space:nowrap;">
          ${isUrl 
            ? `<a href="${escapeHtmlAttr(val)}" target="_blank" rel="noopener noreferrer" style="display:inline-block; padding:2px 8px; background:#dcfce7; color:#166534; border:1px solid #86efac; text-decoration:none; border-radius:4px; font-size:0.74rem; font-weight:600;">Link ↗</a>` 
            : '<span style="color:#94a3b8; font-size:0.75rem;">-</span>'}
        </td>`;
      }

      // 6. Latest Record / Title 열 (가변 너비, 긴 제목만 말줄임 '...' 표기, tooltip 제공)
      return `<td style="padding:4px 8px; font-size:0.80rem; color:#1f2937; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtmlAttr(val)}">
        ${escapeHtmlText(val)}
      </td>`;
    }).join('') + '</tr>';
  }).join('');
}

function renderCompDailyFeedErrors() {
  const section = document.getElementById('compFeedErrorSection');
  const badge = document.getElementById('compFeedErrorBadge');
  const container = document.getElementById('compFeedErrorContainer');
  if (!section || !container) return;

  if (!compDailyFeedErrors || !compDailyFeedErrors.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  if (badge) badge.textContent = `${compDailyFeedErrors.length} Issue(s)`;

  container.innerHTML = compDailyFeedErrors.map(err => `
    <div style="background:#ffffff; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; display:flex; flex-direction:column; gap:4px;">
      <div style="font-weight:700; color:#b91c1c; font-size:0.85rem;">${escapeHtmlText(err.target || 'Target')}</div>
      <div style="font-family:monospace; font-size:0.75rem; color:#7f1d1d; word-break:break-all; line-height:1.45; background:#fef2f2; padding:6px 8px; border-radius:4px;">${escapeHtmlText(err.diagnostic || 'No diagnostic message')}</div>
    </div>
  `).join('');
}

// 7. Save, Backup & Excel Export
async function saveComplianceData() {
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) {
    return alert("Unauthorized: Administrator permission required.");
  }
  const btn = document.getElementById('btnSaveAllTop');
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey || !btn) return;

  btn.textContent = '⏳ Saving...'; 
  btn.disabled = true;

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'save_all_rows', items: compDataset })
    });
    const res = await resp.json();

    if (res.status === 'success') {
      btn.textContent = '✓ Saved!';
      compUnsavedChanges.clear();
      if (res.lastUpdated) {
        const b = document.getElementById('compLastModifiedBadge');
        if (b) b.textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
      }
      await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData, {
        headers: compDailyFeedHeaders,
        data: compDailyFeedRows,
        errors: compDailyFeedErrors
      });
      filterCompRows();
    } else {
      alert(res.message || 'Save failed.');
    }
  } catch(e) {
    alert('Network error while saving data.');
  } finally {
    setTimeout(() => { 
      btn.disabled = false; 
      updateSaveButtonState(); 
    }, 1200);
  }
}

async function executeComplianceBackup() {
  const btn = document.getElementById('btnBackupDriveComp');
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey || !btn) return;
  btn.textContent = '⏳ Backing up...'; 
  btn.disabled = true;

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'backup_drive' })
    });
    const res = await resp.json();
    if (res?.status === 'success' && confirm(`Backup created successfully!\nFile: ${res.fileName}\n\nOpen backup sheet?`)) {
      window.open(res.url, '_blank');
    } else if (res?.status !== 'success') {
      alert(res?.message || 'Backup failed.');
    }
  } catch(e) {
    alert('Backup error.');
  } finally {
    btn.textContent = '☁️ Backup'; 
    btn.disabled = false;
  }
}

// 8. Modals (Link & Notes)
function openLinkModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;
  const nameInput = document.getElementById('modalLinkName');
  const urlInput = document.getElementById('modalLinkUrl');
  if (nameInput) nameInput.value = item.linkName || '';
  if (urlInput) urlInput.value = item.linkUrl || '';
  document.getElementById('linkModal')?.style.setProperty('display', 'flex');
}

const closeLinkModal = () => document.getElementById('linkModal')?.style.setProperty('display', 'none');

function saveLinkModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    const nameInput = document.getElementById('modalLinkName');
    const urlInput = document.getElementById('modalLinkUrl');
    if (nameInput) item.linkName = nameInput.value.trim();
    if (urlInput) item.linkUrl = urlInput.value.trim();
    compUnsavedChanges.add(item.id);
    closeLinkModal();
    filterCompRows();
    updateSaveButtonState();
  }
}

function openNotesModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;

  let modal = document.getElementById('compNotesExpandModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="compNotesExpandModal" class="modal-overlay" style="display:flex;">
        <div class="modal-card" style="max-width:640px; width:100%;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
            <h3 id="compNotesModalTitle" style="margin:0; font-size:1.05rem; font-weight:700; color:var(--text-main);">Additional Notes</h3>
            <button type="button" onclick="closeNotesModal()" style="background:none; border:none; font-size:1.3rem; cursor:pointer; color:#94a3b8;">✕</button>
          </div>
          <textarea id="compNotesModalTextarea" style="width:100%; height:220px; padding:10px; border:1px solid var(--border-darker); border-radius:6px; font-size:0.85rem; font-family:inherit; line-height:1.5; resize:vertical; box-sizing:border-box;"></textarea>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px;">
            <button type="button" class="btn-act" onclick="closeNotesModal()">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="saveNotesModal()">Apply</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('compNotesExpandModal');
  } else {
    modal.style.display = 'flex';
  }

  document.getElementById('compNotesModalTitle').textContent = `Notes - ${item.source || 'Item'} (${item.linkName || 'No Link'})`;
  document.getElementById('compNotesModalTextarea').value = item.details || '';
}

const closeNotesModal = () => document.getElementById('compNotesExpandModal')?.style.setProperty('display', 'none');

function saveNotesModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    item.details = (document.getElementById('compNotesModalTextarea')?.value || '').trim();
    compUnsavedChanges.add(item.id);
    closeNotesModal();
    filterCompRows();
    updateSaveButtonState();
  }
}

// Global Window Exports
window.initComplianceModule = initComplianceModule;
window.fetchComplianceData = fetchComplianceData;
window.clearCompIndexedDB = clearCompIndexedDB;
window.toggleCompSummarySection = toggleCompSummarySection;
window.switchCompSubTab = switchCompSubTab;
window.toggleCompDropdown = toggleCompDropdown;
window.selectAllCompDropdown = selectAllCompDropdown;
window.toggleCompDropdownItem = toggleCompDropdownItem;
window.onCompFilterChange = onCompFilterChange;
window.resetComplianceFilters = resetComplianceFilters;
window.saveComplianceData = saveComplianceData;
window.executeComplianceBackup = executeComplianceBackup;
window.goToCompPage = goToCompPage;
window.changeCompPageSize = changeCompPageSize;
window.openLinkModal = openLinkModal;
window.closeLinkModal = closeLinkModal;
window.saveLinkModal = saveLinkModal;
window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.saveNotesModal = saveNotesModal;
window.onCompFeedFilterChange = onCompFeedFilterChange;
window.resetCompFeedFilters = resetCompFeedFilters;