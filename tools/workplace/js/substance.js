/* =========================================================================
   a2MDS WORKSPACE - SUBSTANCE LOG MODULE (Pure Master + Optimized Checker)
   ========================================================================= */
const URL_SUBSTANCE = 'https://script.google.com/macros/s/AKfycbxiXjBrQd0PzxiTKjbo-xT9816xq31K444psq6jwDxy7Kcd_W8We3rwjRwICb1hLn2O/exec';
const SUBST_DB_NAME = 'a2MDS_SubstanceLog_DB';

// Master Dataset States
let substRawHeaders = [], substDisplayHeaders = [], substanceDataset = [];
let substTableFilters = [], substMultiSelectFilters = {};
let substCurrentPage = 1, substPageSize = 100, substFilteredIndices = [];
let substCurrentLastUpdated = '', substFilterDebounceTimer = null;

// Substance Checker States
let substCheckerRawRows = [], substCheckerFilteredRows = [];
let substCheckerFilters = {}, substCheckerMultiFilters = {};
let activeSubstCheckerKpiFilterSet = new Set();
let substCheckerFilterDebounceTimer = null;

// Helpers & Cleaners
const formatSubstBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());
const getSubstAuthKey = () => (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
const cleanSubstStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toggleSubstSummarySection() {
  const body = document.getElementById('substSummaryBody');
  const icon = document.getElementById('substSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function switchSubstSubTab(tab, btnElem) {
  document.querySelectorAll('#viewSubstance .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewSubstance .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const defaultBtn = document.getElementById(`btnSubstTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    defaultBtn?.classList.add('active');
  }

  const paneId = `substSubPane${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
  document.getElementById(paneId)?.classList.add('active');

  if (tab === 'checker') {
    document.getElementById('substCheckerInput')?.focus();
  }
}

function renderGadslBadge(val) {
  if (!val || val === '-') return '<span class="text-neutral-cell">-</span>';
  const clean = String(val).trim().toUpperCase();
  if (clean.includes('P')) return `<span class="badge-status-p">${val}</span>`;
  if (clean.includes('D')) return `<span class="badge-status-d">${val}</span>`;
  return `<span>${val}</span>`;
}

function renderGadslHeaderBox(val) {
  if (!val || val === '-') return '';
  const clean = String(val).trim().toUpperCase();
  const style = clean.includes('P')
    ? 'background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;'
    : (clean.includes('D') ? 'background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd;' : 'background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;');
  return `<span style="${style} padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:700; margin-left:8px; display:inline-block;">${val}</span>`;
}

const renderNameShortHeaderBox = val => (!val || val === '-' ? '' : `<span style="background:#f8fafc; color:#334155; border:1px solid #cbd5e1; padding:3px 8px; border-radius:6px; font-size:0.82rem; font-weight:600; margin-left:8px; display:inline-block;">${val}</span>`);

// CAS 복사 핸들러
async function copySubstCasToClipboard(cas, el, ev) {
  if (ev) ev.stopPropagation();
  if (!cas || cas === '-' || cas === 'Various' || cas === 'Unknown / Not in Master DB') return;

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(cas);
    } else {
      const temp = document.createElement('input');
      temp.value = cas;
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

// =========================================================================
// INDEXEDDB OPERATIONS
// =========================================================================
const openSubstDB = () => new Promise((res, rej) => {
  try {
    const req = indexedDB.open(SUBST_DB_NAME, 3);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('substances')) db.deleteObjectStore('substances');
      db.createObjectStore('substances', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  } catch(e) { rej(e); }
});

async function saveSubstToDB(headers, rows, lastUpdated) {
  try {
    const db = await openSubstDB();
    const tx = db.transaction('substances', 'readwrite');
    tx.objectStore('substances').clear();
    tx.objectStore('substances').put({ id: 'all_data', headers, rows, lastUpdated });
  } catch(e) {}
}

async function loadSubstFromDB() {
  try {
    const db = await openSubstDB();
    return new Promise(res => {
      const req = db.transaction('substances', 'readonly').objectStore('substances').get('all_data');
      req.onsuccess = () => res(req.result?.rows?.length ? req.result : null);
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearSubstIndexedDB() {
  try { const db = await openSubstDB(); if (db) db.transaction('substances', 'readwrite').objectStore('substances').clear(); } catch(e) {}
}

// =========================================================================
// INITIALIZATION & SYNC
// =========================================================================
async function initSubstanceModule() {
  try {
    const cached = await loadSubstFromDB();
    if (cached?.rows?.length) {
      substRawHeaders = cached.headers || [];
      substanceDataset = cached.rows || [];
      substCurrentLastUpdated = cached.lastUpdated || '';
      setupSubstHeadersAndBuildTable();
      if (substCurrentLastUpdated) {
        const badge = document.getElementById('substLastModifiedBadge');
        if (badge) badge.textContent = `Last Modified: ${substCurrentLastUpdated} KST(UTC+9)`;
      }
      filterSubstTableRows();
    }
  } catch(e) { console.error("initSubstanceModule error:", e); }
}

async function fetchSubstanceData(authOverride = '', forceReload = false) {
  const key = authOverride || getSubstAuthKey();
  if (!key) return;

  const countBadge = document.getElementById('substViewerBadgeCount');
  if (countBadge && !substanceDataset.length) countBadge.textContent = 'Syncing...';

  try {
    const resp = await fetch(URL_SUBSTANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data', clientLastUpdated: forceReload ? '' : substCurrentLastUpdated })
    });
    const res = await resp.json();

    if (res?.data?.length) {
      substRawHeaders = res.headers || [];
      substanceDataset = res.data || [];
      substCurrentLastUpdated = res.lastUpdated || '';
      await saveSubstToDB(substRawHeaders, substanceDataset, substCurrentLastUpdated);
      setupSubstHeadersAndBuildTable();
      if (substCurrentLastUpdated) {
        const badge = document.getElementById('substLastModifiedBadge');
        if (badge) badge.textContent = `Last Modified: ${substCurrentLastUpdated} KST(UTC+9)`;
      }
      filterSubstTableRows();
    } else if (res?.status === 'not_modified' && substanceDataset.length > 0 && countBadge) {
      countBadge.textContent = `Showing ${substFilteredIndices.length.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`;
    }
    return res;
  } catch(err) {
    console.error("fetchSubstanceData Error:", err);
    if (countBadge && !substanceDataset.length) countBadge.textContent = 'Sync Failed';
  }
}
window.syncSubstanceData = fetchSubstanceData;

// =========================================================================
// MASTER TABLE RENDERING & FILTERING (SoCs & Master 탭)
// =========================================================================
const SUBST_COL_CLASSES = [
  'col-no', 'col-cas', 'col-gadsl', 'col-name', 'col-reach-xiv',
  'col-reach-xiv-entry', 'col-reach-xvii', 'col-eupops', 'col-scpops',
  'col-emerging', 'col-tag'
];

function setupSubstHeadersAndBuildTable() {
  if (!substRawHeaders?.length) return;
  substDisplayHeaders = substRawHeaders.slice(0, 11);
  substTableFilters = Array(substDisplayHeaders.length).fill('');
  substMultiSelectFilters = {};

  const [headRow, filterRow] = ['substTableHeadRow', 'substTableFilterRow'].map(id => document.getElementById(id));
  if (!headRow || !filterRow) return;

  headRow.innerHTML = ''; filterRow.innerHTML = '';

  substDisplayHeaders.forEach((colName, idx) => {
    const colClass = SUBST_COL_CLASSES[idx] || '';
    const clean = cleanSubstStr(colName);
    const isGadsl = clean === 'gadslsvhc' || (clean.includes('gadsl') && !clean.includes('version') && !clean.includes('2026'));

    headRow.innerHTML += `<th class="${colClass}" title="${colName}">${colName}</th>`;

    if (isGadsl || clean.includes('emerging') || clean.includes('tag')) {
      substMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th ${colClass}">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="substMsBtn_${idx}" onclick="toggleSubstDropdown(${idx})">
              <span class="multiselect-btn-text" id="substMsText_${idx}">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="substMsDropdown_${idx}"></div>
          </div>
        </th>`;
    } else {
      filterRow.innerHTML += `
        <th class="filter-th ${colClass}">
          <input type="text" class="filter-input" placeholder="Filter..." oninput="onSubstFilterChange(${idx}, this.value)">
        </th>`;
    }
  });

  renderSubstTopTags();
}

function getSubstAvailableRows(targetIdx = -1) {
  return substanceDataset.filter(row => {
    for (let i = 0; i < substTableFilters.length; i++) {
      const kw = substTableFilters[i];
      if (kw && !formatSubstBlank(row[i]).toLowerCase().includes(kw)) return false;
    }
    for (const [idxStr, selectedSet] of Object.entries(substMultiSelectFilters)) {
      const i = parseInt(idxStr, 10);
      if (i === targetIdx || !selectedSet.size) continue;
      const cellVal = formatSubstBlank(row[i]);
      const cellTokens = cellVal.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
      if (!Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel)) return false;
    }
    return true;
  });
}

function populateSingleSubstDropdown(targetIdx) {
  const dd = document.getElementById(`substMsDropdown_${targetIdx}`);
  if (!dd) return;

  const availableRows = getSubstAvailableRows(targetIdx);
  const uniqueSet = new Set();

  availableRows.forEach(row => {
    const val = formatSubstBlank(row[targetIdx]);
    if (val) {
      val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(tok => uniqueSet.add(tok));
    }
  });

  const unique = Array.from(uniqueSet).sort();
  const currentSet = substMultiSelectFilters[targetIdx] || new Set();

  for (const v of currentSet) {
    if (!uniqueSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`substMsText_${targetIdx}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="substChkAll_${targetIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstDropdown(${targetIdx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `<label class="multiselect-item"><input type="checkbox" value="${val}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleSubstDropdownItem(${targetIdx}, '${val}', this.checked)"> <span>${val}</span></label>`).join('');
}

function populateSubstDropdownFilters() {
  Object.keys(substMultiSelectFilters).forEach(k => populateSingleSubstDropdown(parseInt(k, 10)));
}

function toggleSubstDropdown(idx) {
  const [dd, btn] = [`substMsDropdown_${idx}`, `substMsBtn_${idx}`].map(id => document.getElementById(id));
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleSubstDropdown(idx);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 230)}px`;
    dd.classList.add('show');
  }
}

function renderSubstTopTags() {
  const [emergingContainer, emergingBadge] = ['emergingTagsContainer', 'emergingCountBadge'].map(id => document.getElementById(id));
  const [funcContainer, funcBadge] = ['functionalTagsContainer', 'functionalCountBadge'].map(id => document.getElementById(id));

  let emergingIdx = 9, tagsIdx = 10;
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    if (clean === 'emerging') emergingIdx = idx;
    if (clean.includes('tag')) tagsIdx = idx;
  });

  const countTagsFromRows = (rows, colIdx) => {
    const counts = {};
    rows.forEach(row => {
      if (colIdx !== -1 && row[colIdx]) {
        const raw = formatSubstBlank(row[colIdx]);
        if (raw && raw !== '-') raw.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(t => counts[t] = (counts[t] || 0) + 1);
      }
    });
    return counts;
  };

  const emergingCounts = countTagsFromRows(getSubstAvailableRows(emergingIdx), emergingIdx);
  const funcCounts = countTagsFromRows(getSubstAvailableRows(tagsIdx), tagsIdx);

  const renderChips = (container, badge, counts, colIdx, typeCls) => {
    if (!container) return;
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (badge) badge.textContent = `${keys.length} tags`;
    const sel = substMultiSelectFilters[colIdx] || new Set();
    container.innerHTML = keys.length ? keys.map(k => `
      <span class="insight-chip ${typeCls} ${sel.has(k) ? 'active' : ''}" onclick="applySubstMultiTagFilter('${k.replace(/'/g, "\\'")}', ${colIdx})">
        ${k} <span class="insight-chip-badge">${counts[k]}</span>
      </span>`).join('') : `<span style="font-size:0.78rem; color:#94a3b8;">No ${typeCls} records</span>`;
  };

  renderChips(emergingContainer, emergingBadge, emergingCounts, emergingIdx, 'emerging');
  renderChips(funcContainer, funcBadge, funcCounts, tagsIdx, 'tag');
}

function applySubstMultiTagFilter(tagVal, colIdx) {
  if (colIdx === -1) return;
  if (!substMultiSelectFilters[colIdx]) substMultiSelectFilters[colIdx] = new Set();
  substMultiSelectFilters[colIdx].has(tagVal) ? substMultiSelectFilters[colIdx].delete(tagVal) : substMultiSelectFilters[colIdx].add(tagVal);

  const dd = document.getElementById(`substMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c.value) c.checked = substMultiSelectFilters[colIdx].has(c.value); });
    const chkAll = document.getElementById(`substChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = !substMultiSelectFilters[colIdx].size;
  }
  const msText = document.getElementById(`substMsText_${colIdx}`);
  if (msText) msText.textContent = !substMultiSelectFilters[colIdx].size ? 'All' : `${substMultiSelectFilters[colIdx].size} selected`;

  substCurrentPage = 1;
  filterSubstTableRows();
}

function selectAllSubstDropdown(idx, chk) {
  substMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#substMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`substMsText_${idx}`);
  if (msText) msText.textContent = 'All';
  substCurrentPage = 1; 
  filterSubstTableRows();
}

function toggleSubstDropdownItem(idx, val, checked) {
  checked ? substMultiSelectFilters[idx].add(val) : substMultiSelectFilters[idx].delete(val);
  const cnt = substMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`substChkAll_${idx}`);
  if (chkAll) chkAll.checked = !cnt;
  const msText = document.getElementById(`substMsText_${idx}`);
  if (msText) msText.textContent = !cnt ? 'All' : `${cnt} selected`;
  substCurrentPage = 1; 
  filterSubstTableRows();
}

function onSubstFilterChange(idx, val) {
  substTableFilters[idx] = val.toLowerCase().trim();
  substCurrentPage = 1;
  clearTimeout(substFilterDebounceTimer);
  substFilterDebounceTimer = setTimeout(filterSubstTableRows, 150);
}

function filterSubstTableRows() {
  substFilteredIndices = [];

  substanceDataset.forEach((row, rIdx) => {
    for (let i = 0; i < substTableFilters.length; i++) {
      const kw = substTableFilters[i];
      if (kw && !formatSubstBlank(row[i]).toLowerCase().includes(kw)) return;
    }

    for (const [idxStr, selectedSet] of Object.entries(substMultiSelectFilters)) {
      if (selectedSet.size > 0) {
        const cellVal = formatSubstBlank(row[parseInt(idxStr, 10)]);
        const cellTokens = cellVal.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel)) return;
      }
    }
    substFilteredIndices.push(rIdx);
  });

  populateSubstDropdownFilters();
  renderSubstTopTags();
  renderSubstCurrentPage();
}

function renderSubstCurrentPage() {
  const tbody = document.getElementById('substTableDataBody');
  if (!tbody) return;

  const totalMatches = substFilteredIndices.length;
  const totalPages = Math.ceil(totalMatches / substPageSize) || 1;
  substCurrentPage = Math.max(1, Math.min(substCurrentPage, totalPages));

  const start = (substCurrentPage - 1) * substPageSize, end = Math.min(start + substPageSize, totalMatches);
  let html = '';

  let [casColIdx, gadslColIdx, nameColIdx, emergingColIdx, tagColIdx] = [1, 2, 3, 9, 10];
  substDisplayHeaders.forEach((colName, idx) => {
    const c = cleanSubstStr(colName);
    if (c.includes('cas')) casColIdx = idx;
    if (c === 'gadslsvhc' || (c.includes('gadsl') && !c.includes('version') && !c.includes('2026'))) gadslColIdx = idx;
    if (c.includes('name') && c.includes('short')) nameColIdx = idx;
    if (c === 'emerging') emergingColIdx = idx;
    if (c.includes('tag')) tagColIdx = idx;
  });

  for (let i = start; i < end; i++) {
    const realIdx = substFilteredIndices[i], row = substanceDataset[realIdx];
    html += '<tr>' + substDisplayHeaders.map((colName, cIdx) => {
      const val = formatSubstBlank(row[cIdx]);
      
      // ⭐️ 마스터 인덱스에서는 상세 서랍 보기 버튼(📑) 유지[cite: 4]
      if (cIdx === casColIdx && val !== '') {
        return `
          <td class="col-cas" style="padding:5px 8px;">
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%; min-width:0;">
              <span class="clickable-cid" onclick="copySubstCasToClipboard('${val}', this, event)" title="Click to copy">${val}</span>
              <button type="button" class="btn-view-drawer" onclick="openSubstDetailsDrawer(${realIdx})" data-tooltip="Click to View Details">📑</button>
            </div>
          </td>`;
      }
      if (cIdx === gadslColIdx) return `<td class="col-gadsl" style="text-align:center; padding:6px 8px;">${renderGadslBadge(val)}</td>`;
      if (cIdx === nameColIdx) return `<td class="col-name" style="padding:6px 8px;" title="${val}">${val}</td>`;
      if ((cIdx === emergingColIdx || cIdx === tagColIdx) && val !== '') {
        const tags = val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        const cls = cIdx === emergingColIdx ? 'badge-emerging' : 'badge-tag';
        return `<td><div class="tags-flex-wrap">${tags.map(t => `<span class="${cls}">${t}</span>`).join('')}</div></td>`;
      }
      return `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${val}">${val}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="11" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  document.getElementById('substViewerBadgeCount')?.replaceChildren(document.createTextNode(`Showing ${totalMatches.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`));
  document.getElementById('pageInfoDisplay')?.replaceChildren(document.createTextNode(`Page ${substCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()}`));
  const prev = document.getElementById('btnPrevPage'), next = document.getElementById('btnNextPage');
  if (prev) prev.disabled = substCurrentPage <= 1;
  if (next) next.disabled = substCurrentPage >= totalPages;
}

const goToSubstPage = p => { substCurrentPage = p; renderSubstCurrentPage(); };
const changeSubstPageSize = s => { substPageSize = parseInt(s, 10); substCurrentPage = 1; renderSubstCurrentPage(); };

function resetSubstanceFilters() {
  document.querySelectorAll('#substTableFilterRow .filter-input').forEach(input => input.value = '');
  substTableFilters = Array(substDisplayHeaders.length).fill('');

  Object.keys(substMultiSelectFilters).forEach(idx => {
    substMultiSelectFilters[idx].clear();
    const dd = document.getElementById(`substMsDropdown_${idx}`);
    if (dd) {
      dd.querySelectorAll('input[type="checkbox"]').forEach(chk => chk.checked = false);
      const chkAll = document.getElementById(`substChkAll_${idx}`);
      if (chkAll) chkAll.checked = true;
    }
    const msText = document.getElementById(`substMsText_${idx}`);
    if (msText) msText.textContent = 'All';
  });

  substCurrentPage = 1;
  filterSubstTableRows();
}
window.resetSubstanceFilters = resetSubstanceFilters;
window.resetSubstFilters = resetSubstanceFilters;

function getSubstKeyFields(row) {
  let casVal = '', nameShortVal = '', gadslVal = '';
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    if (clean === 'cas' || clean.includes('casrn')) casVal = formatSubstBlank(row[idx]);
    else if (clean === 'nameshort' || (clean.includes('name') && clean.includes('short'))) nameShortVal = formatSubstBlank(row[idx]);
    else if (clean === 'gadslsvhc' || (clean.includes('gadsl') && clean.includes('svhc') && !clean.includes('version'))) {
      gadslVal = formatSubstBlank(row[idx]);
    }
  });

  if (!casVal && row[1]) casVal = formatSubstBlank(row[1]);
  if (!gadslVal && row[2] && String(row[2]).length <= 6) gadslVal = formatSubstBlank(row[2]);
  if (!nameShortVal && row[3]) nameShortVal = formatSubstBlank(row[3]);

  return { casVal, nameShortVal, gadslVal };
}

function openSubstDetailsDrawer(realIdx) {
  const row = substanceDataset[realIdx];
  if (!row) return;

  const { casVal, nameShortVal, gadslVal } = getSubstKeyFields(row);

  const titleEl = document.getElementById('drawerSubstanceTitle');
  if (titleEl) {
    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>🧪 CAS: <strong>${casVal || '-'}</strong></span>
        ${casVal ? `<button type="button" onclick="copySubstCasToClipboard('${casVal}', null, event)" title="Copy CAS" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.75rem; color:#334155;">📋 Copy</button>` : ''}
        ${renderNameShortHeaderBox(nameShortVal)}
        ${renderGadslHeaderBox(gadslVal)}
      </div>`;
  }

  const metaGridFields = [];
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    const isSpecialHeader = clean === 'cas' || clean === 'nameshort' || clean === 'gadslsvhc';
    if ((idx < 11 && !isSpecialHeader) || clean.includes('inclusion') || clean.includes('sunset')) {
      metaGridFields.push({ label: h, val: formatSubstBlank(row[idx]) });
    }
  });

  document.getElementById('drawerInfoCard')?.replaceChildren(
    document.createRange().createContextualFragment(metaGridFields.map(f => `<div class="drawer-info-row"><span class="drawer-info-label">${f.label}</span><span class="drawer-info-val" title="${f.val}"><strong>${f.val || '-'}</strong></span></div>`).join(''))
  );

  let detailRowsHtml = '';
  for (let idx = 11; idx < substRawHeaders.length; idx++) {
    const headerName = substRawHeaders[idx] || `Field ${idx + 1}`;
    if (/inclusion|sunset/i.test(headerName)) continue;
    detailRowsHtml += `<tr><td class="drawer-matrix-label">📝 ${headerName}</td><td class="drawer-matrix-val">${formatSubstBlank(row[idx]) || '-'}</td></tr>`;
  }

  const extContainer = document.getElementById('drawerExtendedContainer');
  if (extContainer) {
    extContainer.innerHTML = detailRowsHtml ? `<div class="drawer-matrix-table-wrap"><table class="drawer-matrix-table"><tbody>${detailRowsHtml}</tbody></table></div>` : '';
  }

  document.getElementById('drawerOverlay')?.style.setProperty('display', 'flex');
}

const closeDrawer = () => document.getElementById('drawerOverlay')?.style.setProperty('display', 'none');
window.closeDrawer = closeDrawer;

function exportSubstanceExcel() {
  if (!substanceDataset.length || !window.XLSX) return;
  const ws = XLSX.utils.aoa_to_sheet([substRawHeaders, ...substFilteredIndices.map(rIdx => substanceDataset[rIdx])]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Substances");
  XLSX.writeFile(wb, `a2MDS_SubstanceLog_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
window.exportSubstanceExcel = exportSubstanceExcel;

// =========================================================================
// SUBSTANCE CHECKER ENGINE (Optimized 9 Columns & Remarks Modal)
// =========================================================================
function normalizeSubstMatchKey(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseSubstInputItems(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const seenKeys = new Set();
  const parsedItems = [];

  lines.forEach(line => {
    let rawCas = '', rawName = '';

    if (line.includes('\t')) {
      const parts = line.split('\t').map(p => p.trim());
      rawCas = parts[0] || '';
      rawName = parts.slice(1).join(' ').trim();
    } else if (line.includes('  ')) {
      const parts = line.split(/\s{2,}/).map(p => p.trim());
      rawCas = parts[0] || '';
      rawName = parts.slice(1).join(' ').trim();
    } else {
      rawCas = line.trim();
      rawName = '';
    }

    const uniqueKey = (rawCas.toUpperCase() + '___' + rawName.toUpperCase());
    if (!seenKeys.has(uniqueKey)) {
      seenKeys.add(uniqueKey);
      parsedItems.push({ rawCas, rawName });
    }
  });

  return parsedItems;
}

function clearSubstCheckerInput() {
  const inp = document.getElementById('substCheckerInput');
  if (inp) inp.value = '';
  document.getElementById('substCheckerCountLabel')?.replaceChildren(document.createTextNode('0 items detected'));
  document.getElementById('substCheckerResultCard')?.style.setProperty('display', 'none');
  document.getElementById('substCheckerBadge')?.style.setProperty('display', 'none');
  substCheckerRawRows = [];
  substCheckerFilteredRows = [];
  substCheckerFilters = {};
  substCheckerMultiFilters = {};
  activeSubstCheckerKpiFilterSet.clear();
}

function runSubstChecker() {
  const items = parseSubstInputItems(document.getElementById('substCheckerInput')?.value.trim());
  document.getElementById('substCheckerCountLabel')?.replaceChildren(document.createTextNode(`${items.length} unique items detected`));

  if (!items.length) return alert('Please enter or paste at least one substance/CAS item.');
  if (!substanceDataset.length) return alert('Master substance data is not loaded yet. Please wait for sync.');

  // 원본 시트 실제 헤더 기반 1:1 정밀 인덱스 타겟팅
  let casIdx = -1, gadslIdx = -1, nameImdsIdx = -1;
  let reachXivIdx = -1, euPopsIdx = -1, scPopsIdx = -1, emergingIdx = -1;
  let remarksIdx = -1, notesIdx = -1;

  substRawHeaders.forEach((h, idx) => {
    const raw = String(h || '').trim();
    const clean = cleanSubstStr(raw);

    if (clean === 'cas' || clean === 'casrn') casIdx = idx;
    else if (clean === 'gadslsvhc') gadslIdx = idx;
    else if (clean === 'nameimds' || (clean.includes('name') && clean.includes('imds'))) nameImdsIdx = idx;
    else if (raw === 'REACH XIV' || (clean === 'reachxiv' && !clean.includes('sunset') && !clean.includes('entry'))) reachXivIdx = idx;
    else if (clean === 'eupops' || clean.includes('eupops')) euPopsIdx = idx;
    else if (clean.includes('scpops')) scPopsIdx = idx;
    else if (clean === 'emerging') emergingIdx = idx;
    else if (clean.includes('applications') || clean.includes('remarks')) remarksIdx = idx;
    else if (clean.includes('additionalnotes') || clean.includes('notes')) notesIdx = idx;
  });

  // 폴백 기본 인덱스 매핑 (실제 캡처 순서 반영)
  if (casIdx === -1) casIdx = 1;
  if (gadslIdx === -1) gadslIdx = 2;
  if (reachXivIdx === -1) reachXivIdx = 4;
  if (euPopsIdx === -1) euPopsIdx = 7;
  if (scPopsIdx === -1) scPopsIdx = 8;
  if (emergingIdx === -1) emergingIdx = 9;
  if (nameImdsIdx === -1) nameImdsIdx = 11;
  if (remarksIdx === -1) remarksIdx = 15;
  if (notesIdx === -1) notesIdx = 16;

  // CAS 및 Name(IMDS) 다중 인덱스 맵 생성
  const masterCasMap = new Map();
  const masterNameMap = new Map();

  substanceDataset.forEach(r => {
    const casRaw = String(r[casIdx] || '').trim().toUpperCase();
    const nameImdsRaw = formatSubstBlank(r[nameImdsIdx]) || formatSubstBlank(r[3]);
    const normName = normalizeSubstMatchKey(nameImdsRaw);

    if (casRaw && casRaw !== '-' && casRaw !== 'SYSTEM' && !masterCasMap.has(casRaw)) {
      masterCasMap.set(casRaw, r);
    }
    if (normName && !masterNameMap.has(normName)) {
      masterNameMap.set(normName, r);
    }
  });

  substCheckerRawRows = [];

  items.forEach(itemObj => {
    const { rawCas, rawName } = itemObj;
    const casUpper = rawCas.toUpperCase();
    const normCas = normalizeSubstMatchKey(rawCas);
    const normName = normalizeSubstMatchKey(rawName);

    let matchedRow = null;

    if (casUpper && casUpper !== '-' && casUpper !== 'SYSTEM' && masterCasMap.has(casUpper)) {
      matchedRow = masterCasMap.get(casUpper);
    } else if (normName && masterNameMap.has(normName)) {
      matchedRow = masterNameMap.get(normName);
    } else if (normCas && masterNameMap.has(normCas)) {
      matchedRow = masterNameMap.get(normCas);
    }

    if (matchedRow) {
      const remVal = formatSubstBlank(matchedRow[remarksIdx]) || '-';
      const notVal = formatSubstBlank(matchedRow[notesIdx]) || '-';
      const hasAnyContent = (remVal !== '-' && remVal !== '') || (notVal !== '-' && notVal !== '');

      substCheckerRawRows.push({
        cas: matchedRow[casIdx] || rawCas || '-',
        name: formatSubstBlank(matchedRow[nameImdsIdx]) || formatSubstBlank(matchedRow[3]) || rawName || '-',
        gadsl: formatSubstBlank(matchedRow[gadslIdx]) || '-',
        reachXiv: formatSubstBlank(matchedRow[reachXivIdx]) || '-',
        euPops: formatSubstBlank(matchedRow[euPopsIdx]) || '-',
        scPops: formatSubstBlank(matchedRow[scPopsIdx]) || '-',
        emerging: formatSubstBlank(matchedRow[emergingIdx]) || '-',
        remarks: remVal,
        notes: notVal,
        hasRemarksOrNotes: hasAnyContent,
        remarksCombined: `${remVal} ${notVal}`.trim(),
        unmatched: '-'
      });
    } else {
      substCheckerRawRows.push({
        cas: rawCas || '-',
        name: rawName || 'Unknown / Not in Master DB',
        gadsl: '-',
        reachXiv: '-',
        euPops: '-',
        scPops: '-',
        emerging: '-',
        remarks: '-',
        notes: '-',
        hasRemarksOrNotes: false,
        remarksCombined: '',
        unmatched: 'O'
      });
    }
  });

  activeSubstCheckerKpiFilterSet.clear();
  renderSubstCheckerKpiBar();

  const badge = document.getElementById('substCheckerBadge');
  if (badge) {
    badge.textContent = substCheckerRawRows.length;
    badge.style.display = 'inline-flex';
  }
  document.getElementById('substCheckerResultCard')?.style.setProperty('display', 'block');

  substCheckerFilters = {};
  substCheckerMultiFilters = {
    gadsl: new Set(),
    reachXiv: new Set(),
    euPops: new Set(),
    scPops: new Set(),
    emerging: new Set()
  };

  resetSubstCheckerFilterInputs();
  filterSubstCheckerRows();
}

function renderSubstCheckerKpiBar() {
  const kpiBar = document.getElementById('substCheckerKpiBar');
  if (!kpiBar) return;

  const total = substCheckerRawRows.length;
  let gadslPCount = 0;
  let unmatchedCount = 0;

  substCheckerRawRows.forEach(r => {
    const g = String(r.gadsl || '').trim().toUpperCase();
    if (g === 'P' || g === 'P/SVHC' || (g.startsWith('P') && !g.includes('D'))) {
      gadslPCount++;
    }
    if (r.unmatched === 'O') {
      unmatchedCount++;
    }
  });

  const isAll = !activeSubstCheckerKpiFilterSet.size;

  const actionChips = [
    { key: 'ALL', label: '📥 CAS entered:', count: total, active: isAll },
    { key: 'GADSL_P', label: '🚨 GADSL P:', count: gadslPCount, active: activeSubstCheckerKpiFilterSet.has('GADSL_P'), color: '#dc2626' },
    { key: 'UNMATCHED', label: '⚠️ Unmatched:', count: unmatchedCount, active: activeSubstCheckerKpiFilterSet.has('UNMATCHED'), color: '#ea580c' }
  ];

  kpiBar.innerHTML = actionChips.map(c => `
    <div class="smelter-analysis-kpi-chip insight-chip tag ${c.active ? 'active' : ''}" style="cursor:pointer;" onclick="toggleSubstCheckerKpiFilter('${c.key}')">
      <span style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:600;">${c.label}</span>
      <strong style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:700;">${c.count}</strong>
    </div>
  `).join('');
}

function toggleSubstCheckerKpiFilter(type) {
  if (type === 'ALL') {
    activeSubstCheckerKpiFilterSet.clear();
  } else {
    activeSubstCheckerKpiFilterSet.has(type) ? activeSubstCheckerKpiFilterSet.delete(type) : activeSubstCheckerKpiFilterSet.add(type);
  }
  renderSubstCheckerKpiBar();
  filterSubstCheckerRows();
}

function resetSubstCheckerFilterInputs() {
  ['checkerFilterCas', 'checkerFilterName', 'checkerFilterRemarks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  ['gadsl', 'reachXiv', 'euPops', 'scPops', 'emerging'].forEach(k => {
    const txt = document.getElementById(`checkerMsText_${k}`);
    if (txt) txt.textContent = 'All';
    if (substCheckerMultiFilters[k]) substCheckerMultiFilters[k].clear();
  });
}

function resetSubstCheckerFilter() {
  resetSubstCheckerFilterInputs();
  substCheckerFilters = {};
  activeSubstCheckerKpiFilterSet.clear();
  renderSubstCheckerKpiBar();
  filterSubstCheckerRows();
}

function onSubstCheckerFilterChange(propKey, val) {
  substCheckerFilters[propKey] = val.trim();
  clearTimeout(substCheckerFilterDebounceTimer);
  substCheckerFilterDebounceTimer = setTimeout(filterSubstCheckerRows, 150);
}

function toggleSubstCheckerDropdown(key) {
  const dd = document.getElementById(`checkerMsDropdown_${key}`);
  const btn = document.getElementById(`checkerMsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleSubstCheckerDropdown(key);
    const r = btn.getBoundingClientRect();
    let topPos = r.bottom + 2;
    if (topPos + 250 > window.innerHeight && r.top > 250) {
      topPos = r.top - 252;
    }
    let leftPos = r.left;
    if (leftPos + 240 > window.innerWidth) {
      leftPos = Math.max(10, window.innerWidth - 250);
    }
    dd.style.top = `${topPos}px`;
    dd.style.left = `${leftPos}px`;
    dd.classList.add('show');
  }
}

function populateSingleSubstCheckerDropdown(key) {
  const dd = document.getElementById(`checkerMsDropdown_${key}`);
  if (!dd) return;

  const currentSet = substCheckerMultiFilters[key] || new Set();
  const rawList = substCheckerRawRows.map(r => r[key] || '-');
  
  const unique = [...new Set(rawList)].sort((a, b) => {
    if (a === '-') return 1;
    if (b === '-') return -1;
    return a.localeCompare(b);
  });

  const validSet = new Set(unique);
  for (const val of currentSet) {
    if (!validSet.has(val)) currentSet.delete(val);
  }

  const txt = document.getElementById(`checkerMsText_${key}`);
  if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="checkerChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstCheckerDropdown('${key}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => {
      let displayLabel = v;
      if (key === 'gadsl') {
        displayLabel = renderGadslBadge(v);
      }
      return `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleSubstCheckerDropdownItem('${key}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${displayLabel}</span></label>`;
    }).join('');
}

function selectAllSubstCheckerDropdown(key, chk) {
  if (!substCheckerMultiFilters[key]) substCheckerMultiFilters[key] = new Set();
  substCheckerMultiFilters[key].clear();

  document.querySelectorAll(`#checkerMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });

  const txt = document.getElementById(`checkerMsText_${key}`);
  if (txt) txt.textContent = 'All';

  filterSubstCheckerRows();
}

function toggleSubstCheckerDropdownItem(key, val, chk) {
  if (!substCheckerMultiFilters[key]) substCheckerMultiFilters[key] = new Set();

  chk ? substCheckerMultiFilters[key].add(val) : substCheckerMultiFilters[key].delete(val);

  const all = document.getElementById(`checkerChkAll_${key}`);
  if (all) all.checked = !substCheckerMultiFilters[key].size;

  const txt = document.getElementById(`checkerMsText_${key}`);
  if (txt) txt.textContent = substCheckerMultiFilters[key].size ? `${substCheckerMultiFilters[key].size} selected` : 'All';

  filterSubstCheckerRows();
}

function filterSubstCheckerRows() {
  substCheckerFilteredRows = substCheckerRawRows.filter(r => {
    if (activeSubstCheckerKpiFilterSet.size) {
      let ok = false;
      const g = String(r.gadsl || '').trim().toUpperCase();
      if (activeSubstCheckerKpiFilterSet.has('GADSL_P') && (g === 'P' || g === 'P/SVHC' || (g.startsWith('P') && !g.includes('D')))) ok = true;
      if (activeSubstCheckerKpiFilterSet.has('UNMATCHED') && r.unmatched === 'O') ok = true;
      if (!ok) return false;
    }

    for (const [propKey, kw] of Object.entries(substCheckerFilters)) {
      if (!kw) continue;
      const val = String(r[propKey] || '').trim();
      if (!val.toLowerCase().includes(kw.toLowerCase())) return false;
    }

    for (const [key, set] of Object.entries(substCheckerMultiFilters)) {
      if (!set || !set.size) continue;
      const val = r[key] || '-';
      if (!set.has(val)) return false;
    }

    return true;
  });

  renderSubstCheckerTable();
}

function renderSubstCheckerTable() {
  const tbody = document.getElementById('substCheckerTableBody');
  if (!tbody) return;
  document.getElementById('substCheckerResultBadge')?.replaceChildren(document.createTextNode(`Showing ${substCheckerFilteredRows.length} of ${substCheckerRawRows.length} records`));

  if (!substCheckerFilteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No matching substance records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = substCheckerFilteredRows.map((r, i) => {
    // ⭐️ 내용이 있을 때만 📝 View 버튼 노출
    const remarksCellHtml = r.hasRemarksOrNotes
      ? `<button type="button" class="btn-action-soft" onclick="openSubstRemarksModal(${i})" style="padding:2px 8px; font-size:0.75rem; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; font-weight:600; color:#334155;">📝 View</button>`
      : `<span class="text-neutral-cell">-</span>`;

    return `
      <tr>
        <td style="text-align:center; font-weight:normal; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>
        <!-- ⭐️ CAS 열: 왼쪽 정렬, 최소 너비, '📑' 제거 -->
        <td style="text-align:left; padding:6px 6px; font-family:'Consolas',monospace;">
          <span class="clickable-cid" onclick="copySubstCasToClipboard('${r.cas}', this, event)" title="Click to copy" style="display:inline-block; font-size:0.80rem;">${r.cas}</span>
        </td>
        <!-- ⭐️ Name (IMDS) 열: 타이틀 기준 최소 너비 & 말줄임 -->
        <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.78rem;" title="${r.name}">${r.name}</td>
        <!-- ⭐️ 규제 5개 열: 값 크기에 맞춘 타이트한 중앙 배치 -->
        <td style="text-align:center; padding:6px 2px;">${renderGadslBadge(r.gadsl)}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.reachXiv}">${r.reachXiv}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.euPops}">${r.euPops}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.scPops}">${r.scPops}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r.emerging}">${r.emerging}</td>
        <!-- ⭐️ Remarks & Notes 열 -->
        <td style="text-align:center; padding:6px 6px;">${remarksCellHtml}</td>
      </tr>
    `;
  }).join('');
}

// ⭐️ Remarks & Notes 전용 팝업 열기/닫기
function openSubstRemarksModal(filteredIdx) {
  const row = substCheckerFilteredRows[filteredIdx];
  if (!row) return;

  const titleEl = document.getElementById('substRemarksModalTitle');
  if (titleEl) {
    titleEl.textContent = `📝 Remarks & Notes (CAS: ${row.cas})`;
  }

  const remarksEl = document.getElementById('modalContentRemarks');
  if (remarksEl) {
    remarksEl.textContent = (row.remarks && row.remarks !== '-') ? row.remarks : 'No specific application or remark recorded.';
  }

  const notesEl = document.getElementById('modalContentNotes');
  if (notesEl) {
    notesEl.textContent = (row.notes && row.notes !== '-') ? row.notes : 'No additional note recorded.';
  }

  document.getElementById('substRemarksModal')?.style.setProperty('display', 'flex');
}

function closeSubstRemarksModal() {
  document.getElementById('substRemarksModal')?.style.setProperty('display', 'none');
}
window.openSubstRemarksModal = openSubstRemarksModal;
window.closeSubstRemarksModal = closeSubstRemarksModal;

// ⭐️ 클립보드 복사 시 버튼 대신 실제 Remarks 원본 텍스트 복사 연동[cite: 6]
async function copySubstCheckerTable() {
  if (!substCheckerFilteredRows.length) return alert('No substance analysis records available to copy.');
  const btn = document.getElementById('btnCopySubstChecker'), orgHtml = btn?.innerHTML || '';

  const headers = ['No.', 'CAS', 'Name (IMDS)', 'GADSL/SVHC', 'REACH XIV', 'EU POPs', 'SC POPs (xx/xx)', 'Emerging', 'Remarks & Notes'];

  let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;"><thead style="background-color:#f1f5f9;"><tr>` +
    headers.map(h => `<th style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:normal; color:#0f172a; text-align:center;">${h}</th>`).join('') + `</tr></thead><tbody>`;

  let plainText = headers.join('\t') + '\n';
  substCheckerFilteredRows.forEach((r, i) => {
    const rowBg = i % 2 ? '#fafafa' : '#ffffff';
    const gColor = r.gadsl.includes('P') ? 'color:#dc2626;' : (r.gadsl.includes('D') ? 'color:#0284c7;' : 'color:#334155;');
    
    // 원본 텍스트 합성
    const fullNotesText = [
      (r.remarks && r.remarks !== '-') ? `[Remarks] ${r.remarks}` : '',
      (r.notes && r.notes !== '-') ? `[Notes] ${r.notes}` : ''
    ].filter(Boolean).join(' | ') || '-';

    tableHtml += `<tr style="background-color:${rowBg};"><td style="border:1px solid #cbd5e1; text-align:center;">${i + 1}</td><td style="border:1px solid #cbd5e1; text-align:left; font-family:monospace;">${r.cas}</td><td style="border:1px solid #cbd5e1;">${r.name}</td><td style="border:1px solid #cbd5e1; text-align:center; ${gColor}">${r.gadsl}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.reachXiv}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.euPops}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.scPops}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.emerging}</td><td style="border:1px solid #cbd5e1; text-align:left;">${fullNotesText}</td></tr>`;
    plainText += [i + 1, r.cas, r.name, r.gadsl, r.reachXiv, r.euPops, r.scPops, r.emerging, fullNotesText].join('\t') + '\n';
  });
  tableHtml += '</tbody></table>';

  try {
    if (navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([tableHtml], { type: 'text/html' }), 'text/plain': new Blob([plainText], { type: 'text/plain' }) })]);
    } else if (navigator.clipboard) await navigator.clipboard.writeText(plainText);
    if (btn) { btn.innerHTML = '✓ Copied!'; btn.style.color = '#16a34a'; setTimeout(() => { btn.innerHTML = orgHtml; btn.style.color = ''; }, 1500); }
  } catch(e) { alert('Failed to copy table to clipboard.'); }
}

// Window Global Exports
window.initSubstanceModule = initSubstanceModule;
window.fetchSubstanceData = fetchSubstanceData;
window.switchSubstSubTab = switchSubstSubTab;
window.toggleSubstSummarySection = toggleSubstSummarySection;
window.openSubstDetailsDrawer = openSubstDetailsDrawer;
window.closeDrawer = closeDrawer;
window.exportSubstanceExcel = exportSubstanceExcel;
window.toggleSubstDropdown = toggleSubstDropdown;
window.selectAllSubstDropdown = selectAllSubstDropdown;
window.toggleSubstDropdownItem = toggleSubstDropdownItem;
window.onSubstFilterChange = onSubstFilterChange;
window.goToSubstPage = goToSubstPage;
window.changeSubstPageSize = changeSubstPageSize;

// Substance Checker Exports
window.clearSubstCheckerInput = clearSubstCheckerInput;
window.runSubstChecker = runSubstChecker;
window.toggleSubstCheckerKpiFilter = toggleSubstCheckerKpiFilter;
window.resetSubstCheckerFilter = resetSubstCheckerFilter;
window.onSubstCheckerFilterChange = onSubstCheckerFilterChange;
window.toggleSubstCheckerDropdown = toggleSubstCheckerDropdown;
window.selectAllSubstCheckerDropdown = selectAllSubstCheckerDropdown;
window.toggleSubstCheckerDropdownItem = toggleSubstCheckerDropdownItem;
window.copySubstCheckerTable = copySubstCheckerTable;

document.addEventListener('DOMContentLoaded', async () => {
  await initSubstanceModule();
  const token = getSubstAuthKey();
  if ((!substanceDataset || substanceDataset.length === 0) && token) await fetchSubstanceData(token, true);

  document.getElementById('substCheckerInput')?.addEventListener('input', e => {
    const items = parseSubstInputItems(e.target.value);
    document.getElementById('substCheckerCountLabel')?.replaceChildren(document.createTextNode(`${items.length} unique items detected`));
  });
});

window.reloadSubstanceData = () => {
  const token = getSubstAuthKey();
  if (token) fetchSubstanceData(token, true);
};