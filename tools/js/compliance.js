/* =========================================================================
   COMPLIANCE LOG MODULE (Optimized & Clean Architecture)
   ========================================================================= */
const URL_COMPLIANCE = 'https://script.google.com/macros/s/AKfycbyGilhtUIPaPbcNfFeXgdho08nAdnsT0xzFjZafy9CIwkg2cXsJ5tk0qkV3BO3QA6yT/exec';
const COMP_DB_NAME = 'a2MDS_ComplianceLog_DB';

let compRawHeaders = [], compDisplayColumns = [], compDataset = [];
let compTimelineRawData = [], compTableFilters = [];
let compMultiSelectFilters = {}, compEditingItemId = null;
let compUnsavedChanges = new Set();

// 0. Summary 영역 접이식(Collapsible) 토글 핸들러
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
  if (saveBtn) saveBtn.style.display = (typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin()) ? 'inline-flex' : 'none';
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
  try { const db = await openCompDB(); if (db) db.transaction('sources', 'readwrite').objectStore('sources').clear(); } catch(e) {}
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
    if (cached.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${cached.lastUpdated} KST(UTC+9)`;
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

    if (res.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
    return res;
  } catch(err) {
    if (badge) badge.textContent = 'Sync Failed';
    throw err;
  }
}

// 3. Summary & Timeline Rendering
function renderCompSummary() {
  const total = compDataset.length;
  document.getElementById('compSummaryTotalDisplay')?.replaceChildren(document.createTextNode(`${total.toLocaleString()} sources`));
  if (!total) return;

  const counts = {};
  compDataset.forEach(d => { const s = (d.source || 'Unassigned').trim(); counts[s] = (counts[s] || 0) + 1; });

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

  const bar = document.getElementById('compProgressBarContainer'), leg = document.getElementById('compSummaryLegendGrid');
  if (bar) bar.innerHTML = barHtml;
  if (leg) leg.innerHTML = legendHtml;
}

function filterByLegendSource(sourceName) {
  if (!compMultiSelectFilters[1]) compMultiSelectFilters[1] = new Set();
  compMultiSelectFilters[1].clear();
  compMultiSelectFilters[1].add(sourceName);

  document.querySelectorAll('#compMsDropdown input[type="checkbox"]').forEach(c => { c.checked = (c.value === sourceName); });
  const chkAll = document.getElementById('compChkAll'), txt = document.getElementById('compMsText');
  if (chkAll) chkAll.checked = false;
  if (txt) txt.textContent = '1 selected';
  filterCompRows();
}

function formatCompTimelineHeader(val) {
  const s = String(val || '').trim();
  if (!s || /^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime()) && s.length >= 7) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]}, ${d.getFullYear()}`;
  }
  return s;
}

function renderCompTimeline() {
  const wrapper = document.getElementById('compTimelineWrapper');
  if (!wrapper) return;
  if (!compTimelineRawData?.length) {
    wrapper.innerHTML = '<div style="padding:24px; color:#64748b; text-align:center; font-size:0.85rem;">No Timeline data found.</div>';
    return;
  }

  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(compTimelineRawData.length, 5); r++) {
    if (compTimelineRawData[r].some(cell => /^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(formatCompTimelineHeader(cell)))) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = compTimelineRawData[headerRowIdx] || [];
  const dataRows = compTimelineRawData.slice(headerRowIdx + 1);
  const validColIndices = [];
  let firstDateColIdx = 999;

  headerRow.forEach((h, c) => {
    const fH = formatCompTimelineHeader(h);
    if (/^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(fH)) {
      validColIndices.push({ index: c, label: fH });
      if (c < firstDateColIdx) firstDateColIdx = c;
    }
  });

  const regNameColIdx = firstDateColIdx > 0 ? (firstDateColIdx - 1) : 0;
  let html = `
    <div style="overflow-x:auto; width:100%;">
      <table class="timeline-table" style="width:100%; border-collapse:collapse;">
        <thead>
          <tr style="position:sticky; top:0; background:#f8fafc; z-index:2;">
            <th class="reg-name-th" style="padding:10px 14px; text-align:left; font-size:0.82rem; font-weight:700; color:#334155; border-bottom:2px solid #cbd5e1; min-width:180px;">Regulation</th>
            ${validColIndices.map(col => `<th style="padding:10px 12px; text-align:center; font-size:0.8rem; font-weight:700; color:#475569; border-bottom:2px solid #cbd5e1; min-width:120px; white-space:nowrap;">${col.label}</th>`).join('')}
          </tr>
        </thead>
        <tbody>`;

  let hasRows = false;
  dataRows.forEach((row, rIdx) => {
    let regName = String(row[regNameColIdx] || '').trim();
    if (!regName) {
      for (let c = 0; c < firstDateColIdx; c++) {
        const v = String(row[c] || '').trim();
        if (v) { regName = v; break; }
      }
    }
    if (!regName) return;
    hasRows = true;

    const bgStyle = rIdx % 2 === 1 ? 'background-color:#fcfdfd;' : 'background-color:#ffffff;';
    html += `<tr style="${bgStyle} border-bottom:1px solid #f1f5f9;"><td class="reg-name-td" style="padding:10px 14px; font-weight:600; color:#1e293b; font-size:0.84rem;">${regName}</td>` +
      validColIndices.map(col => {
        const val = String(row[col.index] || '').trim();
        if (!val) return '<td style="padding:8px 10px; color:#cbd5e1; text-align:center; font-size:0.8rem;">-</td>';
        const isHigh = /Entry into Force|Application|Final adoption|Repeal/i.test(val);
        const badgeStyle = isHigh ? 'background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5; font-weight:600;' : 'background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd;';
        return `<td style="padding:8px 10px; text-align:center;"><span class="milestone-badge" style="display:inline-block; padding:4px 8px; border-radius:6px; font-size:0.75rem; line-height:1.3; ${badgeStyle}">${val.replace(/\n/g, '<br>')}</span></td>`;
      }).join('') + '</tr>';
  });

  if (!hasRows) html += `<tr><td colspan="${validColIndices.length + 1}" style="text-align:center; padding:24px; color:#64748b;">No Regulation entries found.</td></tr>`;
  html += '</tbody></table></div>';
  wrapper.innerHTML = html;
}

// 4. Columns & Filter Setup
function setupCompColumns() {
  compDisplayColumns = [
    { key: 'no', label: 'No.', width: '50px' },
    { key: 'source', label: compRawHeaders[0] || 'Source', width: '130px' },
    { key: 'link', label: 'Link', width: '170px' },
    { key: 'criteria', label: compRawHeaders[3] || 'Date Basis', width: '130px' },
    { key: 'date', label: compRawHeaders[4] || 'Date', width: '135px' },
    { key: 'ref', label: compRawHeaders[5] || 'Ref. Values', width: '130px' },
    { key: 'details', label: compRawHeaders[6] || 'Additional Notes', width: 'auto' }
  ];

  const [headRow, filterRow] = ['compTableHeadRow', 'compTableFilterRow'].map(id => document.getElementById(id));
  if (!headRow || !filterRow) return;

  headRow.innerHTML = ''; filterRow.innerHTML = '';
  compTableFilters = Array(compDisplayColumns.length).fill('');
  compMultiSelectFilters = {};

  compDisplayColumns.forEach((col, idx) => {
    headRow.innerHTML += `<th style="width:${col.width}; padding:10px 8px;">${col.label}</th>`;
    if (col.key === 'source') {
      compMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th">
          <div class="multiselect-container" style="position:relative;">
            <button type="button" class="multiselect-btn" id="compMsBtn" onclick="toggleCompDropdown()">
              <span id="compMsText">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compMsDropdown"></div>
          </div>
        </th>`;
    } else if (col.key !== 'no') {
      filterRow.innerHTML += `<th class="filter-th"><input type="text" class="filter-input" placeholder="Filter..." oninput="onCompFilterChange(${idx}, this.value)"></th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th"></th>';
    }
  });

  updateCompAdminUI();
}

// ⭐️ 연쇄 반응형(Cascading) 동적 드롭다운 옵션 생성 엔진
function populateCompSourceOptions() {
  const dd = document.getElementById('compMsDropdown');
  if (!dd) return;

  // 텍스트 필터를 만족하는 행들만 추출
  const availableRows = compDataset.filter((r, idx) => {
    const searchVals = [String(idx + 1), r.source, `${r.linkName} ${r.linkUrl}`, r.criteria, r.date, r.ref, r.details];
    return compDisplayColumns.every((col, i) => i === 1 || !compTableFilters[i] || searchVals[i].toLowerCase().includes(compTableFilters[i]));
  });

  const unique = [...new Set(availableRows.map(d => d.source).filter(Boolean))].sort();
  const currentSet = compMultiSelectFilters[1] || new Set();

  // 유효하지 않은 선택값 정리
  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const textEl = document.getElementById('compMsText');
  if (textEl) textEl.textContent = currentSet.size === 0 ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="compChkAll" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompSources(this)"> <span>(Select All)</span></label><hr style="margin:4px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `<label class="multiselect-item"><input type="checkbox" value="${escapeHtmlAttr(val)}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompSource('${escapeHtmlAttr(val)}', this.checked)"> <span>${val}</span></label>`).join('');
}

function toggleCompDropdown() {
  const [dd, btn] = ['compMsDropdown', 'compMsBtn'].map(id => document.getElementById(id));
  if (!dd || !btn) return;
  if (dd.classList.toggle('show')) {
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
  }
}

function selectAllCompSources(chk) {
  if (compMultiSelectFilters[1]) compMultiSelectFilters[1].clear();
  document.querySelectorAll('#compMsDropdown input[type="checkbox"]').forEach(c => { if (c !== chk) c.checked = false; });
  const textEl = document.getElementById('compMsText');
  if (textEl) textEl.textContent = 'All';
  filterCompRows();
}

function toggleCompSource(val, checked) {
  if (!compMultiSelectFilters[1]) compMultiSelectFilters[1] = new Set();
  checked ? compMultiSelectFilters[1].add(val) : compMultiSelectFilters[1].delete(val);
  const cnt = compMultiSelectFilters[1].size;
  const chkAll = document.getElementById('compChkAll'), textEl = document.getElementById('compMsText');
  if (chkAll) chkAll.checked = (cnt === 0);
  if (textEl) textEl.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  filterCompRows();
}

function onCompFilterChange(idx, val) {
  compTableFilters[idx] = val.toLowerCase().trim();
  filterCompRows();
}

function getFilteredCompData() {
  return compDataset.filter((r, idx) => {
    if (compMultiSelectFilters[1]?.size && !compMultiSelectFilters[1].has(r.source)) return false;
    const searchVals = [String(idx + 1), r.source, `${r.linkName} ${r.linkUrl}`, r.criteria, r.date, r.ref, r.details];
    return compDisplayColumns.every((col, i) => !compTableFilters[i] || searchVals[i].toLowerCase().includes(compTableFilters[i]));
  });
}

// 5. Main Table Render & Textarea Autosize
function filterCompRows() {
  populateCompSourceOptions();
  const tbody = document.getElementById('compTableDataBody');
  if (!tbody) return;
  const filtered = getFilteredCompData();
  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  let html = '';

  filtered.forEach((r, idx) => {
    const isDirty = compUnsavedChanges.has(r.id);
    const rowBg = isDirty ? 'background-color: #fffbeb;' : '';
    const hasLink = Boolean(r.linkUrl && r.linkUrl !== '#');

    html += `
      <tr data-id="${r.id}" style="${rowBg}">
        <td style="text-align:center; font-weight:600; color:#64748b;">
          ${idx + 1}
          ${isDirty ? '<span title="Unsaved changes" style="display:inline-block; width:7px; height:7px; background:#f59e0b; border-radius:50%; margin-left:3px; vertical-align:top;"></span>' : ''}
        </td>
        <td><span style="display:inline-block; padding:3px 8px; border-radius:4px; font-weight:600; font-size:0.8rem; background:#f1f5f9; color:#1e293b;">${r.source || '-'}</span></td>
        <td>
          <div class="editable-cell-box" style="display:flex; align-items:center; justify-content:space-between; gap:6px;">
            ${hasLink 
              ? `<a href="${escapeHtmlAttr(r.linkUrl)}" target="_blank" rel="noopener noreferrer" class="link-anchor" style="color:#0284c7; text-decoration:none; font-weight:500; font-size:0.82rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:125px;" title="${escapeHtmlAttr(r.linkName || r.linkUrl)}">${r.linkName || 'Open Link'} ↗</a>` 
              : `<span style="color:#94a3b8; font-size:0.8rem; font-style:italic;">No link</span>`}
            ${isAdmin ? `<button type="button" class="btn-edit-inline" onclick="openLinkModal('${r.id}')" data-tooltip="Edit Link URL and Title" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:2px 5px; font-size:0.75rem; color:#475569;">✎</button>` : ''}
          </div>
        </td>
        <td><span class="cell-read-only" style="font-size:0.82rem; color:#475569;" title="${escapeHtmlAttr(r.criteria || '-')}">${r.criteria || '-'}</span></td>
        <td>
          ${isAdmin 
            ? `<input type="date" class="tbl-input-date" value="${r.date || ''}" onchange="updateCompCell('${r.id}', 'date', this.value)" style="padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem; width:100%; box-sizing:border-box;">`
            : `<span class="cell-read-only" style="font-size:0.82rem; color:#475569;">${r.date || '-'}</span>`}
        </td>
        <td>
          ${isAdmin 
            ? `<input type="text" class="tbl-input-text" value="${escapeHtmlAttr(r.ref || '')}" onchange="updateCompCell('${r.id}', 'ref', this.value)" placeholder="Ref value" style="padding:4px 6px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.8rem; width:100%; box-sizing:border-box;">`
            : `<span class="cell-read-only" style="font-size:0.82rem; color:#475569;">${r.ref || '-'}</span>`}
        </td>
        <td>
          <div style="display:flex; align-items:flex-start; gap:4px;">
            ${isAdmin 
              ? `<textarea class="tbl-textarea-details" oninput="autoGrowCompTextarea(this)" onchange="updateCompCell('${r.id}', 'details', this.value)" placeholder="Additional notes..." style="width:100%; min-height:36px; padding:6px 8px; border:1px solid #cbd5e1; border-radius:4px; font-size:0.82rem; font-family:inherit; resize:none; overflow:hidden; box-sizing:border-box; line-height:1.45; word-break:break-word;">${escapeHtmlText(r.details || '')}</textarea>
                 <button type="button" onclick="openNotesModal('${r.id}')" data-tooltip="Expand & Edit Full Notes" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:5px 6px; font-size:0.75rem; color:#475569; flex-shrink:0;">🔍</button>`
              : `<div class="cell-read-only" style="white-space:pre-wrap; line-height:1.45; font-size:0.82rem; color:#334155;">${escapeHtmlText(r.details || '-')}</div>`}
          </div>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html;
  requestAnimationFrame(() => {
    document.querySelectorAll('#compTableDataBody .tbl-textarea-details').forEach(el => autoGrowCompTextarea(el));
  });

  const countBadge = document.getElementById('compViewerBadgeCount');
  if (countBadge) countBadge.textContent = `Showing ${filtered.length} of ${compDataset.length} sources`;
}

function autoGrowCompTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.max(el.scrollHeight, 36)}px`;
}

function updateCompCell(id, key, val) {
  const item = compDataset.find(d => d.id === id);
  if (item) {
    item[key] = val.trim();
    compUnsavedChanges.add(id);
    updateSaveButtonState();
    if (key !== 'details') filterCompRows();
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
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) return alert("Unauthorized: Administrator permission required.");
  const btn = document.getElementById('btnSaveAllTop'), authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey || !btn) return;

  btn.textContent = '⏳ Saving...'; btn.disabled = true;

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
      if (res.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
      await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData);
      filterCompRows();
    } else {
      alert(res.message || 'Save failed.');
    }
  } catch(e) {
    alert('Network error while saving data.');
  } finally {
    setTimeout(() => { btn.disabled = false; updateSaveButtonState(); }, 1200);
  }
}

async function executeComplianceBackup() {
  const btn = document.getElementById('btnBackupDriveComp'), authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey || !btn) return;
  btn.textContent = '⏳ Backing up...'; btn.disabled = true;

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
    btn.textContent = '☁️ Backup'; btn.disabled = false;
  }
}

async function exportComplianceExcel() {
  const filtered = getFilteredCompData();
  if (!filtered.length || !window.ExcelJS) return alert('No data to export.');

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Compliance Log");
  const headers = ['No.', 'Source', 'Link Name', 'Link URL', 'Date Basis', 'Date', 'Ref. values', 'Additional notes'];
  const widths = [8, 16, 25, 40, 18, 14, 20, 60];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  filtered.forEach((r, idx) => ws.addRow([idx + 1, r.source, r.linkName, r.linkUrl, r.criteria, r.date, r.ref, r.details]));

  saveAs(new Blob([await workbook.xlsx.writeBuffer()]), `Compliance_Log_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

// 7. Modal Handlers (Link & Notes)
function openLinkModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;
  const [nameInput, urlInput] = ['modalLinkName', 'modalLinkUrl'].map(i => document.getElementById(i));
  if (nameInput) nameInput.value = item.linkName || '';
  if (urlInput) urlInput.value = item.linkUrl || '';
  document.getElementById('linkModal')?.style.setProperty('display', 'flex');
}

const closeLinkModal = () => document.getElementById('linkModal')?.style.setProperty('display', 'none');

function saveLinkModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    const nameInput = document.getElementById('modalLinkName'), urlInput = document.getElementById('modalLinkUrl');
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
      <div id="compNotesExpandModal" style="display:none; position:fixed; inset:0; background:rgba(15,23,42,0.6); z-index:9999; align-items:center; justify-content:center; padding:16px;">
        <div style="background:#ffffff; border-radius:10px; width:100%; max-width:640px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.2); overflow:hidden; display:flex; flex-direction:column;">
          <div style="padding:14px 18px; border-bottom:1px solid #e2e8f0; display:flex; justify-content:space-between; align-items:center; background:#f8fafc;">
            <h3 id="compNotesModalTitle" style="margin:0; font-size:0.95rem; font-weight:700; color:#1e293b;">Additional Notes Detail</h3>
            <button type="button" onclick="closeNotesModal()" style="background:transparent; border:none; font-size:1.2rem; cursor:pointer; color:#64748b;">✕</button>
          </div>
          <div style="padding:16px;">
            <textarea id="compNotesModalTextarea" style="width:100%; height:240px; padding:10px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.85rem; font-family:inherit; line-height:1.5; box-sizing:border-box; resize:vertical;"></textarea>
          </div>
          <div style="padding:12px 18px; border-top:1px solid #e2e8f0; display:flex; justify-content:flex-end; gap:8px; background:#f8fafc;">
            <button type="button" onclick="closeNotesModal()" style="padding:6px 14px; border:1px solid #cbd5e1; border-radius:6px; background:#ffffff; font-size:0.82rem; cursor:pointer;">Cancel</button>
            <button type="button" onclick="saveNotesModal()" style="padding:6px 14px; border:none; border-radius:6px; background:#0284c7; color:#ffffff; font-size:0.82rem; font-weight:600; cursor:pointer;">Apply Changes</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('compNotesExpandModal');
  }

  document.getElementById('compNotesModalTitle').textContent = `Notes - ${item.source || 'Item'} (${item.linkName || 'No Link'})`;
  document.getElementById('compNotesModalTextarea').value = item.details || '';
  modal.style.display = 'flex';
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
