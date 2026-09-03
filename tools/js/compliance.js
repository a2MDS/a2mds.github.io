/* =========================================================================
   COMPLIANCE LOG MODULE (Optimized & Refined Architecture)
   ========================================================================= */
const URL_COMPLIANCE = 'https://script.google.com/macros/s/AKfycbyGilhtUIPaPbcNfFeXgdho08nAdnsT0xzFjZafy9CIwkg2cXsJ5tk0qkV3BO3QA6yT/exec';
const COMP_DB_NAME = 'a2MDS_ComplianceLog_DB';

let compRawHeaders = [], compDisplayColumns = [], compDataset = [];
let compTimelineRawData = [], compTableFilters = [];
let compMultiSelectFilters = {}, compEditingItemId = null;
let compUnsavedChanges = new Set();

// 페이징 변수
let compCurrentPage = 1;
let compPageSize = 50;

// 0. Summary 영역 접이식 토글 핸들러
function toggleCompSummarySection() {
  const body = document.getElementById('compSummaryBody');
  const icon = document.getElementById('compSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
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
    const req = indexedDB.open(COMP_DB_NAME, 3);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sources')) db.createObjectStore('sources', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  } catch(e) { res(null); }
});

async function saveCompToDB(headers, items, lastUpdated, timeline) {
  try {
    const db = await openCompDB();
    if (!db) return;
    const tx = db.transaction('sources', 'readwrite');
    const store = tx.objectStore('sources');
    store.clear();
    store.put({ id: '__meta__', headers, lastUpdated, timeline });
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
    setupCompColumns();
    renderCompSummary();
    renderCompTimeline();
    filterCompRows();
    if (cached.lastUpdated) {
      document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${cached.lastUpdated} KST(UTC+9)`;
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
      criteria: item[3] || item.criteria || '',
      date: formatCompDate(item[4] || item.date),
      ref: item[5] || item.ref || '',
      details: item[6] || item.details || ''
    }));

    await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData);
    setupCompColumns();
    renderCompSummary();
    renderCompTimeline();
    filterCompRows();
    updateSaveButtonState();
    updateCompAdminUI();

    if (res.lastUpdated) {
      document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
    }
    return res;
  } catch(err) {
    if (badge) badge.textContent = 'Sync Failed';
    throw err;
  }
}

// 3. Summary & Timeline Rendering
function renderCompSummary() {
  const total = compDataset.length;
  const totalDisplay = document.getElementById('compSummaryTotalDisplay');
  if (totalDisplay) totalDisplay.textContent = `${total.toLocaleString()} sources`;
  if (!total) return;

  const counts = {};
  compDataset.forEach(d => {
    const s = (d.source || 'Unassigned').trim();
    counts[s] = (counts[s] || 0) + 1;
  });

  const sorted = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  let barHtml = '', legendHtml = '';

  sorted.forEach((s, idx) => {
    const c = counts[s], pct = ((c / total) * 100).toFixed(1);
    const color = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#16a34a';
    barHtml += `<div class="progress-segment" style="width:${pct}%; background:${color};" title="${s}: ${c} (${pct}%)"></div>`;
    legendHtml += `
      <div class="legend-item" onclick="filterByLegendSource('${escapeHtmlAttr(s)}')" style="cursor:pointer;" title="Click to filter by ${s}">
        <div class="legend-dot" style="background:${color};"></div>
        <span class="legend-label">${s}:</span>
        <span class="legend-count">${c} (${pct}%)</span>
      </div>`;
  });

  const bar = document.getElementById('compProgressBarContainer');
  const leg = document.getElementById('compSummaryLegendGrid');
  if (bar) bar.innerHTML = barHtml;
  if (leg) leg.innerHTML = legendHtml;
}

function filterByLegendSource(sourceName) {
  if (!compMultiSelectFilters[1]) compMultiSelectFilters[1] = new Set();
  
  if (compMultiSelectFilters[1].has(sourceName) && compMultiSelectFilters[1].size === 1) {
    compMultiSelectFilters[1].clear();
  } else {
    compMultiSelectFilters[1].clear();
    compMultiSelectFilters[1].add(sourceName);
  }

  compCurrentPage = 1;
  filterCompRows();
}

// 1) Milestone 날짜 헤더 판별 (유연한 정규식 매칭)
function formatCompTimelineHeader(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  if (/(?:\d{4}|1H|2H|H1|H2|Q[1-4]|[A-Za-z]{3})/i.test(s)) return s;
  
  const d = new Date(s);
  if (!isNaN(d.getTime()) && s.length >= 7) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]}, ${d.getFullYear()}`;
  }
  return s;
}

// 1) Milestone 타임라인 렌더링 (전체 열 복원)
function renderCompTimeline() {
  const wrapper = document.getElementById('compTimelineWrapper');
  if (!wrapper) return;
  if (!compTimelineRawData?.length) {
    wrapper.innerHTML = '<div style="padding:24px; color:#64748b; text-align:center; font-size:0.85rem;">No Timeline milestones available.</div>';
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
    <div style="overflow-x:auto; width:100%;">
      <table class="timeline-table" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr>
            <th class="reg-name-th" style="min-width:180px; text-align:left; padding:8px 12px;">Regulation</th>
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

  if (!hasRows) html += `<tr><td colspan="${validColIndices.length + 1}" style="text-align:center; padding:24px; color:#64748b;">No Regulation entries found.</td></tr>`;
  html += '</tbody></table></div>';
  wrapper.innerHTML = html;
}

// 2, 3, 4) Columns Setup & 너비 재배치
function setupCompColumns() {
  compDisplayColumns = [
    { key: 'no', label: 'No.', width: '45px' },
    { key: 'source', label: compRawHeaders[0] || 'Source', width: '85px' },       // 너비 최소화
    { key: 'link', label: 'Link', width: '220px' },                               // 넓혀서 내용 확보
    { key: 'criteria', label: compRawHeaders[3] || 'Date Basis', width: '100px' },
    { key: 'date', label: compRawHeaders[4] || 'Date', width: '115px' },          // 슬림화
    { key: 'ref', label: compRawHeaders[5] || 'Ref. Values', width: '105px' },    // 슬림화
    { key: 'details', label: compRawHeaders[6] || 'Additional Notes', width: 'auto' }
  ];

  const headRow = document.getElementById('compTableHeadRow');
  const filterRow = document.getElementById('compTableFilterRow');
  if (!headRow || !filterRow) return;

  headRow.innerHTML = ''; 
  filterRow.innerHTML = '';
  compTableFilters = Array(compDisplayColumns.length).fill('');
  compMultiSelectFilters = {};

  compDisplayColumns.forEach((col, idx) => {
    headRow.innerHTML += `<th style="width:${col.width}; padding:8px 6px; font-size:0.80rem;">${col.label}</th>`;
    if (col.key === 'source') {
      compMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th" style="padding:4px 4px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="compMsBtn" onclick="toggleCompDropdown()" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="compMsText">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compMsDropdown"></div>
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

function populateCompSourceOptions() {
  const dd = document.getElementById('compMsDropdown');
  if (!dd) return;

  const availableRows = compDataset.filter((r, idx) => {
    const searchVals = [String(idx + 1), r.source, `${r.linkName} ${r.linkUrl}`, r.criteria, r.date, r.ref, r.details];
    return compDisplayColumns.every((col, i) => i === 1 || !compTableFilters[i] || searchVals[i].toLowerCase().includes(compTableFilters[i]));
  });

  const unique = [...new Set(availableRows.map(d => d.source).filter(Boolean))].sort();
  const currentSet = compMultiSelectFilters[1] || new Set();

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const textEl = document.getElementById('compMsText');
  if (textEl) textEl.textContent = currentSet.size === 0 ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="compChkAll" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompSources(this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:4px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `
      <label class="multiselect-item">
        <input type="checkbox" value="${escapeHtmlAttr(val)}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompSource('${escapeHtmlAttr(val)}', this.checked)">
        <span>${val}</span>
      </label>`).join('');
}

function toggleCompDropdown() {
  const dd = document.getElementById('compMsDropdown');
  const btn = document.getElementById('compMsBtn');
  if (!dd || !btn) return;
  if (dd.classList.toggle('show')) {
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 260))}px`;
  }
}

function selectAllCompSources(chk) {
  if (compMultiSelectFilters[1]) compMultiSelectFilters[1].clear();
  document.querySelectorAll('#compMsDropdown input[type="checkbox"]').forEach(c => { if (c !== chk) c.checked = false; });
  const textEl = document.getElementById('compMsText');
  if (textEl) textEl.textContent = 'All';
  compCurrentPage = 1;
  filterCompRows();
}

function toggleCompSource(val, checked) {
  if (!compMultiSelectFilters[1]) compMultiSelectFilters[1] = new Set();
  checked ? compMultiSelectFilters[1].add(val) : compMultiSelectFilters[1].delete(val);
  const cnt = compMultiSelectFilters[1].size;
  const chkAll = document.getElementById('compChkAll');
  const textEl = document.getElementById('compMsText');
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
  return compDataset.filter((r, idx) => {
    if (compMultiSelectFilters[1]?.size && !compMultiSelectFilters[1].has(r.source)) return false;
    const searchVals = [String(idx + 1), r.source, `${r.linkName} ${r.linkUrl}`, r.criteria, r.date, r.ref, r.details];
    return compDisplayColumns.every((col, i) => !compTableFilters[i] || searchVals[i].toLowerCase().includes(compTableFilters[i]));
  });
}

// 5. Main Table Render & Pagination
function filterCompRows() {
  populateCompSourceOptions();
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
        <!-- 2. Source: 볼드 제거, 일반 텍스트, 여백 최소화 -->
        <td style="padding:4px 6px; font-size:0.80rem; color:#334155; font-weight:normal; white-space:nowrap;">${escapeHtmlText(r.source || '-')}</td>
        <!-- 3. Link: 가급적 다 보이도록 확대 -->
        <td style="padding:4px 8px;">
          <div class="editable-cell-box" style="display:flex; align-items:center; justify-content:space-between; gap:4px;">
            ${hasLink 
              ? `<a href="${escapeHtmlAttr(r.linkUrl)}" target="_blank" rel="noopener noreferrer" class="link-anchor" style="color:#0284c7; text-decoration:none; font-size:0.82rem; white-space:nowrap; overflow:visible;" title="${escapeHtmlAttr(r.linkName || r.linkUrl)}">${escapeHtmlText(r.linkName || 'Open Link')} ↗</a>` 
              : `<span style="color:#94a3b8; font-size:0.78rem; font-style:italic;">No link</span>`}
            ${isAdmin ? `<button type="button" class="btn-edit-inline" onclick="openLinkModal('${r.id}')" data-tooltip="Edit Link" style="background:none; border:none; color:#94a3b8; cursor:pointer; font-size:0.78rem; padding:2px;">✎</button>` : ''}
          </div>
        </td>
        <td style="padding:4px 6px;"><span class="cell-read-only" style="font-size:0.80rem;" title="${escapeHtmlAttr(r.criteria || '-')}">${escapeHtmlText(r.criteria || '-')}</span></td>
        <!-- 4. Date & Ref. Values: 슬림 컴팩트화 -->
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
              ? `<textarea class="tbl-textarea-details" oninput="autoGrowCompTextarea(this)" onchange="updateCompCell('${r.id}', 'details', this.value)" placeholder="Additional notes..." style="padding:4px 6px; font-size:0.80rem; min-height:32px; border:1px solid #cbd5e1; border-radius:4px; width:100%; box-sizing:border-box;">${escapeHtmlText(r.details || '')}</textarea>
                 <button type="button" onclick="openNotesModal('${r.id}')" data-tooltip="Expand Notes" style="background:#fff; border:1px solid #cbd5e1; border-radius:4px; padding:4px 5px; font-size:0.75rem; cursor:pointer; flex-shrink:0;">🔍</button>`
              : `<div class="cell-read-only" style="white-space:pre-wrap; line-height:1.4; font-size:0.80rem; color:#334155;">${escapeHtmlText(r.details || '-')}</div>`}
          </div>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html;
  
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

function autoGrowCompTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 34)}px`;
}

function updateCompCell(id, key, val) {
  const item = compDataset.find(d => d.id === id);
  if (item) {
    item[key] = val.trim();
    compUnsavedChanges.add(id);
    updateSaveButtonState();
    
    // 전체 DOM을 다시 그리지 않고 해당 행 배경만 즉각 업데이트
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
  selectAllCompSources(document.getElementById('compChkAll'));
}

// 6. Save, Backup & Excel Export
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
        document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
      }
      await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData);
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

async function exportComplianceExcel() {
  const filtered = getFilteredCompData();
  if (!filtered.length || !window.ExcelJS) return alert('No data to export.');

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Compliance Log");
  const headers = ['No.', 'Source', 'Link Name', 'Link URL', 'Date Basis', 'Date', 'Ref. values', 'Additional notes'];
  const widths = [8, 14, 30, 45, 18, 14, 18, 60];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  filtered.forEach((r, idx) => ws.addRow([idx + 1, r.source, r.linkName, r.linkUrl, r.criteria, r.date, r.ref, r.details]));

  saveAs(new Blob([await workbook.xlsx.writeBuffer()]), `Compliance_Log_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

// 7. Modals (Link & Notes)
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
