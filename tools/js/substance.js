/* =========================================================================
   a2MDS WORKSPACE - SUBSTANCE LOG MODULE (Optimized & Clean Architecture)
   ========================================================================= */
const URL_SUBSTANCE = 'https://script.google.com/macros/s/AKfycbxiXjBrQd0PzxiTKjbo-xT9816xq31K444psq6jwDxy7Kcd_W8We3rwjRwICb1hLn2O/exec';
const SUBST_DB_NAME = 'a2MDS_SubstanceLog_DB';

let substRawHeaders = [], substDisplayHeaders = [], substanceDataset = [];
let substTableFilters = [], substMultiSelectFilters = {}, substAiInsightsCache = {};
let substCurrentPage = 1, substPageSize = 100, substFilteredIndices = [];
let substCurrentLastUpdated = '', substFilterDebounceTimer = null;

// Helpers & Cleaners
const formatSubstBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());
const parseSubstMarkdownBold = s => String(s || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
const getSubstAuthKey = () => (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
const cleanSubstStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// 0. Summary 영역 접이식(Collapsible) 토글 핸들러
function toggleSubstSummarySection() {
  const body = document.getElementById('substSummaryBody');
  const icon = document.getElementById('substSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

// 1. GADSL 뱃지 및 토스트 / 클립보드 헬퍼
function renderGadslBadge(val) {
  if (!val || val === '-') return '';
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

function showSubstToast(msg) {
  let toast = document.getElementById('substGlobalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'substGlobalToast';
    toast.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#1e293b; color:#ffffff; padding:10px 18px; border-radius:8px; font-size:0.84rem; font-weight:600; box-shadow:0 10px 15px -3px rgba(0,0,0,0.2); z-index:10000; opacity:0; transition:opacity 0.2s ease, transform 0.2s ease; transform:translateY(10px); pointer-events:none;';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.transform = 'translateY(0)';
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
  }, 2000);
}

function copySubstCasToClipboard(cas, event) {
  if (event) event.stopPropagation();
  if (!cas || cas === '-') return;

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(cas).then(() => showSubstToast(`📋 Copied CAS: ${cas}`)).catch(() => fallbackCopy(cas));
  } else {
    fallbackCopy(cas);
  }
}

function fallbackCopy(text) {
  const temp = document.createElement('input');
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  document.execCommand('copy');
  document.body.removeChild(temp);
  showSubstToast(`📋 Copied CAS: ${text}`);
}

// 2. IndexedDB Operations
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

// 3. Initialization & Sync
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

// 4. Header & Filter Building
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
    const isCas = clean.includes('cas'), isName = clean.includes('name') && clean.includes('short'), isGadsl = clean.includes('gadsl') || clean.includes('svhc');

    let customHeaderStyle = '';
    if (isCas) customHeaderStyle = 'style="min-width:155px !important; width:155px !important; white-space:nowrap !important;"';
    else if (isGadsl) customHeaderStyle = 'style="min-width:90px !important; width:90px !important; text-align:center;"';
    else if (isName) customHeaderStyle = 'style="max-width:120px !important;"';

    headRow.innerHTML += `<th class="${colClass}" ${customHeaderStyle}>${colName}</th>`;

    if (clean.includes('gadsl') || clean.includes('emerging') || clean.includes('tag')) {
      substMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th ${colClass}" ${customHeaderStyle}>
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
        <th class="filter-th ${colClass}" ${customHeaderStyle}>
          <input type="text" class="filter-input" placeholder="Filter..." oninput="onSubstFilterChange(${idx}, this.value)">
        </th>`;
    }
  });

  renderSubstTopTags();
}

// ⭐️ 연쇄 반응형(Cascading) 동적 드롭다운 옵션 생성 엔진
function populateSubstDropdownFilters() {
  const multiIndices = Object.keys(substMultiSelectFilters).map(k => parseInt(k, 10));

  multiIndices.forEach(targetIdx => {
    const dd = document.getElementById(`substMsDropdown_${targetIdx}`);
    if (!dd) return;

    // targetIdx를 제외한 다른 필터들을 통과하는 행들만 추출
    const availableRows = substanceDataset.filter(row => {
      // 텍스트 필터 확인
      for (let i = 0; i < substTableFilters.length; i++) {
        const kw = substTableFilters[i];
        if (kw && !formatSubstBlank(row[i]).toLowerCase().includes(kw)) return false;
      }

      // 다른 다중선택 필터 확인
      for (const [idxStr, selectedSet] of Object.entries(substMultiSelectFilters)) {
        const i = parseInt(idxStr, 10);
        if (i === targetIdx || !selectedSet.size) continue;
        const cellVal = formatSubstBlank(row[i]);
        const cellTokens = cellVal.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel)) return false;
      }

      return true;
    });

    const uniqueCounts = {};
    availableRows.forEach(row => {
      const val = formatSubstBlank(row[targetIdx]);
      if (val) {
        val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(tok => {
          uniqueCounts[tok] = (uniqueCounts[tok] || 0) + 1;
        });
      }
    });

    const currentSet = substMultiSelectFilters[targetIdx] || new Set();
    const validUnique = new Set(Object.keys(uniqueCounts));
    for (const v of currentSet) {
      if (!validUnique.has(v)) currentSet.delete(v);
    }

    const msText = document.getElementById(`substMsText_${targetIdx}`);
    if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

    dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="substChkAll_${targetIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstDropdown(${targetIdx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
      Object.keys(uniqueCounts).sort().map(val => `<label class="multiselect-item"><input type="checkbox" value="${val}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleSubstDropdownItem(${targetIdx}, '${val}', this.checked)"> <span>${val} (${uniqueCounts[val]})</span></label>`).join('');
  });
}

// 5. Top Insights Tags Counter & Chips (연쇄 반응 동기화)
function renderSubstTopTags() {
  const [emergingContainer, emergingBadge] = ['emergingTagsContainer', 'emergingCountBadge'].map(id => document.getElementById(id));
  const [funcContainer, funcBadge] = ['functionalTagsContainer', 'functionalCountBadge'].map(id => document.getElementById(id));

  let emergingIdx = 9, tagsIdx = 10;
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    if (clean === 'emerging') emergingIdx = idx;
    if (clean.includes('tag')) tagsIdx = idx;
  });

  const getAvailableRowsForTag = targetIdx => substanceDataset.filter(row => {
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

  const emergingCounts = countTagsFromRows(getAvailableRowsForTag(emergingIdx), emergingIdx);
  const funcCounts = countTagsFromRows(getAvailableRowsForTag(tagsIdx), tagsIdx);

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

function toggleSubstDropdown(idx) {
  const [dd, btn] = [`substMsDropdown_${idx}`, `substMsBtn_${idx}`].map(id => document.getElementById(id));
  if (!dd || !btn) return;
  if (dd.classList.toggle('show')) {
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 230)}px`;
  }
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

// 6. Main Table Render & Pagination
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
    if (c.includes('gadsl') || c.includes('svhc')) gadslColIdx = idx;
    if (c.includes('name') && c.includes('short')) nameColIdx = idx;
    if (c === 'emerging') emergingColIdx = idx;
    if (c.includes('tag')) tagColIdx = idx;
  });

  for (let i = start; i < end; i++) {
    const realIdx = substFilteredIndices[i], row = substanceDataset[realIdx];
    html += '<tr>' + substDisplayHeaders.map((colName, cIdx) => {
      const val = formatSubstBlank(row[cIdx]);
      if (cIdx === casColIdx && val !== '') {
        return `
          <td class="col-cas" style="min-width:155px !important; width:155px !important; max-width:none !important; white-space:nowrap !important; overflow:visible !important; text-overflow:clip !important; padding:6px 6px;">
            <div style="display:flex; align-items:center; gap:4px; justify-content:space-between; width:100%;">
              <button type="button" class="cas-trigger-btn" onclick="openSubstDetailsDrawer(${realIdx})" title="Click to view details" style="font-weight:400 !important; color:#0284c7; background:none; border:none; cursor:pointer; text-align:left; padding:0; text-decoration:none; font-size:0.83rem; white-space:nowrap !important; max-width:none !important; text-overflow:clip !important; overflow:visible !important;">${val}</button>
              <button type="button" onclick="copySubstCasToClipboard('${val}', event)" title="Copy CAS Number" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; padding:1px 4px; font-size:0.65rem; color:#475569; flex-shrink:0;">📋</button>
            </div>
          </td>`;
      }
      if (cIdx === gadslColIdx) return `<td class="col-gadsl" style="min-width:90px !important; width:90px !important; text-align:center; padding:6px 8px;">${renderGadslBadge(val)}</td>`;
      if (cIdx === nameColIdx) return `<td class="col-name" style="max-width:120px !important; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 8px;" title="${val}">${val}</td>`;
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

// 7. Drawer Details & AI Insights
async function requestGeminiSubstInsightsFromGAS(cas, substanceName, gadslSvhc, reachXiv, forceRefresh = false) {
  if (!forceRefresh && substAiInsightsCache[cas]) return substAiInsightsCache[cas];
  const key = getSubstAuthKey();
  if (!key) return null;

  try {
    const resp = await fetch(URL_SUBSTANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'get_subst_ai_insights', cas, substanceName, gadslSvhc, reachXiv, forceRefresh })
    });
    const res = await resp.json();
    if (res?.status === 'success' && res.insights) {
      substAiInsightsCache[cas] = res.insights;
      return res.insights;
    }
  } catch(e) {}
  return null;
}

function buildBilingualSectionHtml(titleIcon, titleText, dataObj, fallbackEn, fallbackKr) {
  const enList = (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) ? (dataObj.en?.length ? dataObj.en : fallbackEn) : (Array.isArray(dataObj) ? dataObj : fallbackEn);
  const krList = (dataObj && typeof dataObj === 'object' && !Array.isArray(dataObj)) ? (dataObj.kr?.length ? dataObj.kr : fallbackKr) : fallbackKr;

  return `
    <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:14px 16px;">
      <div style="font-weight:700; color:#0f172a; font-size:0.92rem; margin-bottom:10px; display:flex; align-items:center; gap:6px;">
        <span>${titleIcon}</span> ${titleText}
      </div>
      <ul style="margin:0; padding-left:18px; font-size:0.88rem; color:#334155; line-height:1.65;">
        ${enList.map(item => `<li>${parseSubstMarkdownBold(item)}</li>`).join('')}
      </ul>
      ${krList.length ? `
        <div style="margin:12px 0 10px; border-top:1px dashed #cbd5e1;"></div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#475569; line-height:1.65;">
          ${krList.map(item => `<li>${parseSubstMarkdownBold(item)}</li>`).join('')}
        </ul>` : ''}
    </div>`;
}

async function renderRealtimeSubstAIInsights(cas, substanceName, gadslSvhc, reachXiv, forceRefresh = false) {
  const [container, metaBadge] = ['substDrawerAiContentWrap', 'substAiGeneratedMeta'].map(id => document.getElementById(id));
  if (!container) return;

  if (forceRefresh) {
    container.innerHTML = `<div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;"><span style="font-size:1.15rem;">⏳</span> Force refreshing insights from Gemini AI...</div>`;
    if (metaBadge) metaBadge.textContent = 'Refreshing...';
  }

  const insights = await requestGeminiSubstInsightsFromGAS(cas, substanceName, gadslSvhc, reachXiv, forceRefresh);
  if (metaBadge) {
    const rawTime = insights?.generatedAt;
    metaBadge.textContent = `🕒 Generated: ${(typeof formatKstTimestampDetailed === 'function' ? formatKstTimestampDetailed(rawTime) : rawTime) || new Date().toISOString()}`;
  }

  const whereCardHtml = buildBilingualSectionHtml('🎯', 'Where Used & Functional Parts', insights?.whereUsed, ["**Function**: Functional additives, specialized polymers, or processing aids.", "**Target Parts**: Automotive interior/exterior components and electrical systems."], ["**기능**: 기능성 첨가제, 특수 고분자 수지 또는 가공 조제.", "**적용 부품**: 자동차 내외장재 부품 및 전자·전장 시스템."]);
  const trendCardHtml = buildBilingualSectionHtml('📈', 'Regulatory Trends & OEM Direction', insights?.recentTrends, ["**Regulatory Status**: Monitored under REACH SVHC and GADSL classification.", "**OEM Direction**: Compliance verification required for IMDS MDS declarations."], ["**규제 동향**: REACH SVHC 후보물질 및 GADSL 관리 물질로 모니터링.", "**OEM 대응 방향**: IMDS MDS 물질 선언 및 규제 준수 검증 필수."]);

  container.innerHTML = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-top:6px;">${whereCardHtml}${trendCardHtml}</div>`;
}

function refreshCurrentSubstAi(cas, substanceName, gadslSvhc, reachXiv) {
  delete substAiInsightsCache[cas];
  renderRealtimeSubstAIInsights(cas, substanceName, gadslSvhc, reachXiv, true);
}

function openSubstDetailsDrawer(realIdx) {
  const row = substanceDataset[realIdx];
  if (!row) return;

  let [casVal, nameShortVal, gadslVal] = ['', '', ''];
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    if (clean.includes('cas')) casVal = formatSubstBlank(row[idx]);
    if (clean.includes('name') && clean.includes('short')) nameShortVal = formatSubstBlank(row[idx]);
    if (clean.includes('gadsl')) gadslVal = formatSubstBlank(row[idx]);
  });

  const titleEl = document.getElementById('drawerSubstanceTitle');
  if (titleEl) {
    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>🧪 CAS: <strong>${casVal || '-'}</strong></span>
        ${casVal ? `<button type="button" onclick="copySubstCasToClipboard('${casVal}', event)" title="Copy CAS" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.75rem; color:#334155;">📋 Copy</button>` : ''}
        ${renderNameShortHeaderBox(nameShortVal)}
        ${renderGadslHeaderBox(gadslVal)}
      </div>`;
  }

  const metaGridFields = [];
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    if ((idx < 11 && !clean.includes('cas') && !clean.includes('short') && !clean.includes('gadsl')) || clean.includes('inclusion') || clean.includes('sunset')) {
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

  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  const escapeArg = s => String(s || '').replace(/'/g, "\\'");

  const extContainer = document.getElementById('drawerExtendedContainer');
  if (extContainer) {
    extContainer.innerHTML = `
      ${detailRowsHtml ? `<div class="drawer-matrix-table-wrap"><table class="drawer-matrix-table"><tbody>${detailRowsHtml}</tbody></table></div>` : ''}
      <div class="ai-insights-box">
        <div class="ai-insights-header">
          <div class="ai-insights-title"><span style="font-size:1.25rem;">🧠</span><span>AI-Powered Insights</span></div>
          <div style="font-size:0.78rem; color:#64748b; margin:-2px 0 2px; display:flex; align-items:center; justify-content:center; gap:5px;"><span>ℹ️</span><span>AI can make mistakes. Always verify important information.</span></div>
          <div class="ai-insights-meta-bar">
            <span id="substAiGeneratedMeta" class="ai-timestamp-badge">🕒 Checking...</span>
            ${isAdmin ? `<button type="button" class="btn-ai-refresh" onclick="refreshCurrentSubstAi('${escapeArg(casVal)}', '${escapeArg(nameShortVal)}', '${escapeArg(gadslVal)}', '')" title="Force refresh and overwrite server AI cache">🔄 Refresh</button>` : ''}
          </div>
        </div>
        <div class="ai-insights-content" id="substDrawerAiContentWrap">
          <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;"><span>⏳</span> Generating real-time regulatory & materials insights via Gemini AI...</div>
        </div>
      </div>`;
  }

  document.getElementById('drawerOverlay')?.style.setProperty('display', 'flex');
  renderRealtimeSubstAIInsights(casVal, nameShortVal, gadslVal, '', false);
}

const closeDrawer = () => document.getElementById('drawerOverlay')?.style.setProperty('display', 'none');
window.closeDrawer = closeDrawer;

// 8. Excel Export & Lifecycle Listeners
function exportSubstanceExcel() {
  if (!substanceDataset.length || !window.XLSX) return;
  const ws = XLSX.utils.aoa_to_sheet([substRawHeaders, ...substFilteredIndices.map(rIdx => substanceDataset[rIdx])]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Substances");
  XLSX.writeFile(wb, `a2MDS_SubstanceLog_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
window.exportSubstanceExcel = exportSubstanceExcel;

document.addEventListener('DOMContentLoaded', async () => {
  await initSubstanceModule();
  const token = getSubstAuthKey();
  if ((!substanceDataset || substanceDataset.length === 0) && token) await fetchSubstanceData(token, true);
});

window.reloadSubstanceData = () => {
  const token = getSubstAuthKey();
  if (token) fetchSubstanceData(token, true);
};
