/* =========================================================================
   a2MDS WORKSPACE - SUBSTANCE LOG MODULE (Bilingual EN/KR UI & Full CAS Display)
   ========================================================================= */
const URL_SUBSTANCE = 'https://script.google.com/macros/s/AKfycbxiXjBrQd0PzxiTKjbo-xT9816xq31K444psq6jwDxy7Kcd_W8We3rwjRwICb1hLn2O/exec';
const SUBST_DB_NAME = 'a2MDS_SubstanceLog_DB';

let substRawHeaders = [];
let substDisplayHeaders = [];
let substanceDataset = [];
let substTableFilters = [];
let substMultiSelectFilters = {};
let substAiInsightsCache = {};

let substCurrentPage = 1;
let substPageSize = 100;
let substFilteredIndices = [];
let substCurrentLastUpdated = '';
let substFilterDebounceTimer = null;

const formatSubstBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());

function parseSubstMarkdownBold(str) {
  return String(str || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}

function getSubstAuthKey() {
  return typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
}

/* =========================================================================
   1. GADSL 뱃지 & CAS 복사 토스트 헬퍼
   ========================================================================= */
function renderGadslBadge(val) {
  if (!val || val === '-') return '';
  const clean = String(val).trim().toUpperCase();

  if (clean.includes('P')) {
    return `<span class="badge-status-p">${val}</span>`;
  }
  if (clean.includes('D')) {
    return `<span class="badge-status-d">${val}</span>`;
  }
  return `<span>${val}</span>`;
}

function renderGadslHeaderBox(val) {
  if (!val || val === '-') return '';
  const clean = String(val).trim().toUpperCase();
  if (clean.includes('P')) {
    return `<span style="background:#fee2e2; color:#dc2626; border:1px solid #fca5a5; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:700; margin-left:8px; display:inline-block;">${val}</span>`;
  }
  if (clean.includes('D')) {
    return `<span style="background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:700; margin-left:8px; display:inline-block;">${val}</span>`;
  }
  return `<span style="background:#f1f5f9; color:#475569; border:1px solid #cbd5e1; padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:600; margin-left:8px; display:inline-block;">${val}</span>`;
}

function renderNameShortHeaderBox(val) {
  if (!val || val === '-') return '';
  return `<span style="background:#f8fafc; color:#334155; border:1px solid #cbd5e1; padding:3px 8px; border-radius:6px; font-size:0.82rem; font-weight:600; margin-left:8px; display:inline-block;">${val}</span>`;
}

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

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(cas).then(() => {
      showSubstToast(`📋 Copied CAS: ${cas}`);
    }).catch(() => fallbackCopy(cas));
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

/* =========================================================================
   2. INDEXED DB 캐시 로직
   ========================================================================= */
function openSubstDB() {
  return new Promise((res, rej) => {
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
}

async function saveSubstToDB(headers, rows, lastUpdated) {
  try {
    const db = await openSubstDB();
    const tx = db.transaction('substances', 'readwrite');
    const store = tx.objectStore('substances');
    store.clear();
    store.put({ id: 'all_data', headers, rows, lastUpdated });
  } catch(e) {}
}

async function loadSubstFromDB() {
  try {
    const db = await openSubstDB();
    return new Promise(res => {
      const req = db.transaction('substances', 'readonly').objectStore('substances').get('all_data');
      req.onsuccess = () => {
        const item = req.result;
        if (!item || !item.rows?.length) return res(null);
        res({ headers: item.headers || [], rows: item.rows, lastUpdated: item.lastUpdated || '' });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearSubstIndexedDB() { 
  try { 
    const db = await openSubstDB(); 
    if (db) db.transaction('substances', 'readwrite').objectStore('substances').clear(); 
  } catch(e) {} 
}

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
  } catch(e) {
    console.error("initSubstanceModule error:", e);
  }
}

async function fetchSubstanceData(authOverride = '', forceReload = false) {
  const key = authOverride || getSubstAuthKey();
  if (!key) return;

  const countBadge = document.getElementById('substViewerBadgeCount');
  if (countBadge && !substanceDataset.length) countBadge.textContent = 'Syncing...';

  try {
    const payload = {
      auth: key,
      action: 'fetch_data',
      clientLastUpdated: forceReload ? '' : substCurrentLastUpdated
    };

    const resp = await fetch(URL_SUBSTANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
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
    } else if (res?.status === 'not_modified' && substanceDataset.length > 0) {
      if (countBadge) countBadge.textContent = `Showing ${substFilteredIndices.length.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`;
    }
    return res;
  } catch(err) {
    console.error("fetchSubstanceData Error:", err);
    if (countBadge && !substanceDataset.length) countBadge.textContent = 'Sync Failed';
  }
}

window.syncSubstanceData = fetchSubstanceData;

/* =========================================================================
   3. 테이블 헤더 & 필터 빌드 (CAS 155px 고정 & Name 단축)
   ========================================================================= */
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

  const table = document.getElementById('substDataTable');
  const headRow = document.getElementById('substTableHeadRow');
  const filterRow = document.getElementById('substTableFilterRow');
  if (!table || !headRow || !filterRow) return;

  headRow.innerHTML = '';
  filterRow.innerHTML = '';

  substDisplayHeaders.forEach((colName, idx) => {
    const colClass = SUBST_COL_CLASSES[idx] || '';
    const clean = String(colName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const isCas = clean === 'cas' || clean.includes('cas');
    const isName = clean.includes('name') && clean.includes('short');
    const isGadsl = clean.includes('gadsl') || clean.includes('svhc');

    let customHeaderStyle = '';
    if (isCas) customHeaderStyle = 'style="min-width:155px !important; width:155px !important; white-space:nowrap !important;"';
    else if (isGadsl) customHeaderStyle = 'style="min-width:90px !important; width:90px !important; text-align:center;"';
    else if (isName) customHeaderStyle = 'style="max-width:120px !important;"';

    headRow.innerHTML += `<th class="${colClass}" ${customHeaderStyle}>${colName}</th>`;

    const isMulti = clean.includes('gadsl') || clean.includes('emerging') || clean === 'tags' || clean.includes('tag');

    if (isMulti) {
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

  populateSubstDropdownFilters();
  renderSubstTopTags();
}

function populateSubstDropdownFilters() {
  const multiIndices = Object.keys(substMultiSelectFilters).map(k => parseInt(k, 10));
  const uniqueCounts = {};
  multiIndices.forEach(idx => { uniqueCounts[idx] = {}; });

  substanceDataset.forEach(row => {
    multiIndices.forEach(idx => {
      let val = formatSubstBlank(row[idx]);
      if (val) {
        const tokens = val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        tokens.forEach(tok => {
          uniqueCounts[idx][tok] = (uniqueCounts[idx][tok] || 0) + 1;
        });
      }
    });
  });

  multiIndices.forEach(idx => {
    const dd = document.getElementById(`substMsDropdown_${idx}`);
    if (!dd) return;
    const sortedKeys = Object.keys(uniqueCounts[idx]).sort();
    let html = `<label class="multiselect-item"><input type="checkbox" id="substChkAll_${idx}" checked onchange="selectAllSubstDropdown(${idx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
    sortedKeys.forEach(val => {
      html += `<label class="multiselect-item"><input type="checkbox" value="${val}" onchange="toggleSubstDropdownItem(${idx}, '${val}', this.checked)"> <span>${val}</span></label>`;
    });
    dd.innerHTML = html;
  });
}

/* =========================================================================
   4. 상단 Substances of Concern 태그 집계 & 필터
   ========================================================================= */
function renderSubstTopTags() {
  const emergingContainer = document.getElementById('emergingTagsContainer');
  const emergingBadge = document.getElementById('emergingCountBadge');
  const funcContainer = document.getElementById('functionalTagsContainer');
  const funcBadge = document.getElementById('functionalCountBadge');

  let emergingIdx = 9;
  let tagsIdx = 10;

  substRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').trim().toLowerCase();
    if (clean === 'emerging') emergingIdx = idx;
    if (clean === 'tags' || clean.includes('tag')) tagsIdx = idx;
  });

  const emergingCounts = {};
  const funcCounts = {};

  substanceDataset.forEach(row => {
    if (emergingIdx !== -1 && row[emergingIdx]) {
      const rawEmerging = formatSubstBlank(row[emergingIdx]);
      if (rawEmerging && rawEmerging !== '-') {
        const splitEmerging = rawEmerging.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        splitEmerging.forEach(tag => {
          emergingCounts[tag] = (emergingCounts[tag] || 0) + 1;
        });
      }
    }

    if (tagsIdx !== -1 && row[tagsIdx]) {
      const rawTags = formatSubstBlank(row[tagsIdx]);
      if (rawTags && rawTags !== '-') {
        const splitTags = rawTags.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        splitTags.forEach(tag => {
          funcCounts[tag] = (funcCounts[tag] || 0) + 1;
        });
      }
    }
  });

  const selectedEmerging = substMultiSelectFilters[emergingIdx] || new Set();
  const selectedTags = substMultiSelectFilters[tagsIdx] || new Set();

  if (emergingContainer) {
    const eKeys = Object.keys(emergingCounts).sort((a, b) => emergingCounts[b] - emergingCounts[a]);
    if (emergingBadge) emergingBadge.textContent = `${eKeys.length} tags`;
    emergingContainer.innerHTML = eKeys.length ? eKeys.map(k => `
      <span class="insight-chip emerging ${selectedEmerging.has(k) ? 'active' : ''}" onclick="applySubstMultiTagFilter('${k.replace(/'/g, "\\'")}', ${emergingIdx})">
        ${k} <span class="insight-chip-badge">${emergingCounts[k]}</span>
      </span>
    `).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No emerging records</span>';
  }

  if (funcContainer) {
    const fKeys = Object.keys(funcCounts).sort((a, b) => funcCounts[b] - funcCounts[a]);
    if (funcBadge) funcBadge.textContent = `${fKeys.length} tags`;
    funcContainer.innerHTML = fKeys.length ? fKeys.map(k => `
      <span class="insight-chip tag ${selectedTags.has(k) ? 'active' : ''}" onclick="applySubstMultiTagFilter('${k.replace(/'/g, "\\'")}', ${tagsIdx})">
        ${k} <span class="insight-chip-badge">${funcCounts[k]}</span>
      </span>
    `).join('') : '<span style="font-size:0.78rem; color:#94a3b8;">No functional tags recorded</span>';
  }
}

function applySubstMultiTagFilter(tagVal, colIdx) {
  if (colIdx === -1) return;
  if (!substMultiSelectFilters[colIdx]) substMultiSelectFilters[colIdx] = new Set();

  if (substMultiSelectFilters[colIdx].has(tagVal)) {
    substMultiSelectFilters[colIdx].delete(tagVal);
  } else {
    substMultiSelectFilters[colIdx].add(tagVal);
  }

  const dd = document.getElementById(`substMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => {
      if (c.value) c.checked = substMultiSelectFilters[colIdx].has(c.value);
    });
    const chkAll = document.getElementById(`substChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = (substMultiSelectFilters[colIdx].size === 0);
  }
  const msText = document.getElementById(`substMsText_${colIdx}`);
  if (msText) msText.textContent = substMultiSelectFilters[colIdx].size === 0 ? 'All' : `${substMultiSelectFilters[colIdx].size} selected`;

  renderSubstTopTags();
  substCurrentPage = 1;
  filterSubstTableRows();
}

function toggleSubstDropdown(idx) {
  const dd = document.getElementById(`substMsDropdown_${idx}`);
  const btn = document.getElementById(`substMsBtn_${idx}`);
  if (!dd || !btn) return;
  const isShow = dd.classList.toggle('show');
  if (isShow) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${Math.min(rect.left, window.innerWidth - 230)}px`;
  }
}

function selectAllSubstDropdown(idx, chk) {
  substMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#substMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`substMsText_${idx}`);
  if (msText) msText.textContent = 'All';
  renderSubstTopTags();
  substCurrentPage = 1; 
  filterSubstTableRows();
}

function toggleSubstDropdownItem(idx, val, checked) {
  if (checked) substMultiSelectFilters[idx].add(val); else substMultiSelectFilters[idx].delete(val);
  const cnt = substMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`substChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  const msText = document.getElementById(`substMsText_${idx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  renderSubstTopTags();
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
        const hasMatch = Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel);
        if (!hasMatch) return;
      }
    }

    substFilteredIndices.push(rIdx);
  });

  renderSubstCurrentPage();
}

/* =========================================================================
   5. 메인 테이블 렌더링 & 페이지네이션 (CAS 전체 표시 완비)
   ========================================================================= */
function renderSubstCurrentPage() {
  const tbody = document.getElementById('substTableDataBody');
  if (!tbody) return;

  const totalMatches = substFilteredIndices.length;
  const totalPages = Math.ceil(totalMatches / substPageSize) || 1;

  if (substCurrentPage > totalPages) substCurrentPage = totalPages;
  if (substCurrentPage < 1) substCurrentPage = 1;

  const start = (substCurrentPage - 1) * substPageSize;
  const end = Math.min(start + substPageSize, totalMatches);
  let html = '';

  let casColIdx = 1;
  let gadslColIdx = 2;
  let nameColIdx = 3;
  let emergingColIdx = 9;
  let tagColIdx = 10;

  substDisplayHeaders.forEach((colName, idx) => {
    const clean = String(colName).trim().toLowerCase();
    if (clean === 'cas' || clean.includes('cas')) casColIdx = idx;
    if (clean.includes('gadsl') || clean.includes('svhc')) gadslColIdx = idx;
    if (clean.includes('name') && clean.includes('short')) nameColIdx = idx;
    if (clean === 'emerging') emergingColIdx = idx;
    if (clean === 'tags' || clean.includes('tag')) tagColIdx = idx;
  });

  for (let i = start; i < end; i++) {
    const realIdx = substFilteredIndices[i];
    const row = substanceDataset[realIdx];

    html += '<tr>';
    substDisplayHeaders.forEach((colName, cIdx) => {
      let val = formatSubstBlank(row[cIdx]);

      if (cIdx === casColIdx && val !== '') {
        html += `
          <td class="col-cas" style="min-width:155px !important; width:155px !important; max-width:none !important; white-space:nowrap !important; overflow:visible !important; text-overflow:clip !important; padding:6px 6px;">
            <div style="display:flex; align-items:center; gap:4px; justify-content:space-between; width:100%;">
              <button type="button" class="cas-trigger-btn" onclick="openSubstDetailsDrawer(${realIdx})" title="Click to view details" style="font-weight:400 !important; color:#0284c7; background:none; border:none; cursor:pointer; text-align:left; padding:0; text-decoration:none; font-size:0.83rem; white-space:nowrap !important; max-width:none !important; text-overflow:clip !important; overflow:visible !important;">${val}</button>
              <button type="button" onclick="copySubstCasToClipboard('${val}', event)" title="Copy CAS Number" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; padding:1px 4px; font-size:0.65rem; color:#475569; flex-shrink:0;">📋</button>
            </div>
          </td>`;
      } else if (cIdx === gadslColIdx) {
        html += `<td class="col-gadsl" style="min-width:90px !important; width:90px !important; text-align:center; padding:6px 8px;">${renderGadslBadge(val)}</td>`;
      } else if (cIdx === nameColIdx) {
        html += `<td class="col-name" style="max-width:120px !important; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 8px;" title="${val}">${val}</td>`;
      } else if (cIdx === emergingColIdx && val !== '') {
        const tags = val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        html += `<td><div class="tags-flex-wrap">${tags.map(t => `<span class="badge-emerging">${t}</span>`).join('')}</div></td>`;
      } else if (cIdx === tagColIdx && val !== '') {
        const tags = val.split(/[,;\/\r\n]+/).map(t => t.trim()).filter(Boolean);
        html += `<td><div class="tags-flex-wrap">${tags.map(t => `<span class="badge-tag">${t}</span>`).join('')}</div></td>`;
      } else {
        html += `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${val}">${val}</td>`;
      }
    });
    html += '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="11" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  
  const badge = document.getElementById('substViewerBadgeCount');
  if (badge) badge.textContent = `Showing ${totalMatches.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`;
  
  const pInfo = document.getElementById('pageInfoDisplay');
  if (pInfo) pInfo.textContent = `Page ${substCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;
  const btnPrev = document.getElementById('btnPrevPage');
  if (btnPrev) btnPrev.disabled = (substCurrentPage <= 1);
  const btnNext = document.getElementById('btnNextPage');
  if (btnNext) btnNext.disabled = (substCurrentPage >= totalPages);
}

function goToSubstPage(p) { substCurrentPage = p; renderSubstCurrentPage(); }
function changeSubstPageSize(s) { substPageSize = parseInt(s, 10); substCurrentPage = 1; renderSubstCurrentPage(); }

/* =========================================================================
   6. Clear 필터 초기화
   ========================================================================= */
function resetSubstanceFilters() {
  document.querySelectorAll('#substTableFilterRow .filter-input').forEach(input => {
    input.value = '';
  });
  substTableFilters = Array(substDisplayHeaders.length).fill('');

  Object.keys(substMultiSelectFilters).forEach(idx => {
    substMultiSelectFilters[idx].clear();

    const dd = document.getElementById(`substMsDropdown_${idx}`);
    if (dd) {
      dd.querySelectorAll('input[type="checkbox"]').forEach(chk => {
        chk.checked = false;
      });
      const chkAll = document.getElementById(`substChkAll_${idx}`);
      if (chkAll) chkAll.checked = true;
    }

    const msText = document.getElementById(`substMsText_${idx}`);
    if (msText) msText.textContent = 'All';
  });

  renderSubstTopTags();
  substCurrentPage = 1;
  filterSubstTableRows();
}

window.resetSubstanceFilters = resetSubstanceFilters;
window.resetSubstFilters = resetSubstanceFilters;

/* =========================================================================
   7. 서랍 상세 및 AI Insights (이중 언어 EN/KR & Timestamp 지원)
   ========================================================================= */
async function requestGeminiSubstInsightsFromGAS(cas, substanceName, gadslSvhc, reachXiv, forceRefresh = false) {
  if (!forceRefresh && substAiInsightsCache[cas]) {
    return substAiInsightsCache[cas];
  }

  const key = getSubstAuthKey();
  if (!key) return null;

  try {
    const payload = {
      auth: key,
      action: 'get_subst_ai_insights',
      cas: cas,
      substanceName: substanceName,
      gadslSvhc: gadslSvhc,
      reachXiv: reachXiv,
      forceRefresh: forceRefresh
    };

    const resp = await fetch(URL_SUBSTANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'success' && res.insights) {
      substAiInsightsCache[cas] = res.insights;
      return res.insights;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// 이중 언어 카드 렌더링 헬퍼 (상단 영문 / 점선 구분 / 하단 한글 번역)
function buildBilingualSectionHtml(titleIcon, titleText, dataObj, fallbackEn, fallbackKr) {
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
        ${enList.map(item => `<li>${parseSubstMarkdownBold(item)}</li>`).join('')}
      </ul>
      <!-- 한글 번역 목록 (구분선 포함) -->
      ${krList.length ? `
        <div style="margin:12px 0 10px; border-top:1px dashed #cbd5e1;"></div>
        <ul style="margin:0; padding-left:18px; font-size:0.86rem; color:#475569; line-height:1.65;">
          ${krList.map(item => `<li>${parseSubstMarkdownBold(item)}</li>`).join('')}
        </ul>
      ` : ''}
    </div>
  `;
}

async function renderRealtimeSubstAIInsights(cas, substanceName, gadslSvhc, reachXiv, forceRefresh = false) {
  const container = document.getElementById('substDrawerAiContentWrap');
  const metaBadge = document.getElementById('substAiGeneratedMeta');
  if (!container) return;

  if (forceRefresh) {
    container.innerHTML = `
      <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;">
        <span style="font-size:1.15rem;">⏳</span> Force refreshing insights from Gemini AI...
      </div>`;
    if (metaBadge) metaBadge.textContent = 'Refreshing...';
  }

  const insights = await requestGeminiSubstInsightsFromGAS(cas, substanceName, gadslSvhc, reachXiv, forceRefresh);

  if (metaBadge) {
    const rawTime = insights?.generatedAt;
    const formattedKst = (typeof formatKstTimestampDetailed === 'function') 
      ? formatKstTimestampDetailed(rawTime) 
      : (rawTime || new Date().toISOString());
    metaBadge.textContent = `🕒 Generated: ${formattedKst}`;
  }

  const defaultWhereEn = [
    "**Function**: Functional additives, specialized polymers, or processing aids.",
    "**Target Parts**: Automotive interior/exterior components and electrical systems."
  ];
  const defaultWhereKr = [
    "**기능**: 기능성 첨가제, 특수 고분자 수지 또는 가공 조제.",
    "**적용 부품**: 자동차 내외장재 부품 및 전자·전장 시스템."
  ];

  const defaultTrendEn = [
    "**Regulatory Status**: Monitored under REACH SVHC and GADSL classification.",
    "**OEM Direction**: Compliance verification required for IMDS MDS declarations."
  ];
  const defaultTrendKr = [
    "**규제 동향**: REACH SVHC 후보물질 및 GADSL 관리 물질로 모니터링.",
    "**OEM 대응 방향**: IMDS MDS 물질 선언 및 규제 준수 검증 필수."
  ];

  const whereCardHtml = buildBilingualSectionHtml('🎯', 'Where Used & Functional Parts', insights?.whereUsed, defaultWhereEn, defaultWhereKr);
  const trendCardHtml = buildBilingualSectionHtml('📈', 'Regulatory Trends & OEM Direction', insights?.recentTrends, defaultTrendEn, defaultTrendKr);

  container.innerHTML = `
    <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:14px; margin-top:6px;">
      ${whereCardHtml}
      ${trendCardHtml}
    </div>
  `;
}

function refreshCurrentSubstAi(cas, substanceName, gadslSvhc, reachXiv) {
  if (substAiInsightsCache[cas]) {
    delete substAiInsightsCache[cas];
  }
  renderRealtimeSubstAIInsights(cas, substanceName, gadslSvhc, reachXiv, true);
}

function openSubstDetailsDrawer(realIdx) {
  const row = substanceDataset[realIdx];
  if (!row) return;

  let casVal = '', nameShortVal = '', gadslVal = '';
  substRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').trim().toLowerCase();
    if (clean === 'cas' || clean === 'cas rn' || clean === 'cas no') casVal = formatSubstBlank(row[idx]);
    if (clean === 'name (short)' || clean === 'name(short)' || clean === 'short name') nameShortVal = formatSubstBlank(row[idx]);
    if (clean === 'gadsl/svhc' || clean === 'gadsl' || clean === 'gadsl / svhc') gadslVal = formatSubstBlank(row[idx]);
  });

  const titleEl = document.getElementById('drawerSubstanceTitle');
  if (titleEl) {
    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>🧪 CAS: <strong>${casVal || '-'}</strong></span>
        ${casVal ? `<button type="button" onclick="copySubstCasToClipboard('${casVal}', event)" title="Copy CAS" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.75rem; color:#334155;">📋 Copy</button>` : ''}
        ${renderNameShortHeaderBox(nameShortVal)}
        ${renderGadslHeaderBox(gadslVal)}
      </div>
    `;
  }

  const metaGridFields = [];
  substRawHeaders.forEach((h, idx) => {
    const clean = String(h || '').trim().toLowerCase();
    if (idx < 11 && !clean.includes('cas') && !clean.includes('short') && clean !== 'gadsl/svhc' && clean !== 'gadsl') {
      metaGridFields.push({ label: h, val: formatSubstBlank(row[idx]) });
    }
    if (clean.includes('inclusion') || clean.includes('sunset')) {
      metaGridFields.push({ label: h, val: formatSubstBlank(row[idx]) });
    }
  });

  const infoCard = document.getElementById('drawerInfoCard');
  if (infoCard) {
    infoCard.innerHTML = metaGridFields.map(f => `
      <div class="drawer-info-row">
        <span class="drawer-info-label">${f.label}</span>
        <span class="drawer-info-val" title="${f.val}"><strong>${f.val || '-'}</strong></span>
      </div>
    `).join('');
  }

  let detailRowsHtml = '';
  for (let idx = 11; idx < substRawHeaders.length; idx++) {
    const headerName = substRawHeaders[idx] || `Field ${idx + 1}`;
    const clean = headerName.toLowerCase();
    if (clean.includes('inclusion') || clean.includes('sunset')) continue;

    let val = formatSubstBlank(row[idx]);
    detailRowsHtml += `
      <tr>
        <td class="drawer-matrix-label">📝 ${headerName}</td>
        <td class="drawer-matrix-val">${val || '-'}</td>
      </tr>`;
  }

  const isAdmin = typeof isWorkspaceAdmin === 'function' && isWorkspaceAdmin();
  const safeCas = casVal.replace(/'/g, "\\'");
  const safeName = nameShortVal.replace(/'/g, "\\'");
  const safeGadsl = gadslVal.replace(/'/g, "\\'");

  const extContainer = document.getElementById('drawerExtendedContainer');
  if (extContainer) {
    extContainer.innerHTML = `
      ${detailRowsHtml ? `
      <div class="drawer-matrix-table-wrap">
        <table class="drawer-matrix-table">
          <tbody>${detailRowsHtml}</tbody>
        </table>
      </div>` : ''}
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
            <span id="substAiGeneratedMeta" class="ai-timestamp-badge">🕒 Checking...</span>
            ${isAdmin ? `<button type="button" class="btn-ai-refresh" onclick="refreshCurrentSubstAi('${safeCas}', '${safeName}', '${safeGadsl}', '')" title="Force refresh and overwrite server AI cache">🔄 Refresh</button>` : ''}
          </div>
        </div>
        <div class="ai-insights-content" id="substDrawerAiContentWrap">
          <div style="color:#64748b; font-size:0.86rem; display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.15rem;">⏳</span> Generating real-time regulatory & materials insights via Gemini AI...
          </div>
        </div>
      </div>
    `;
  }

  const drawerOverlay = document.getElementById('drawerOverlay');
  if (drawerOverlay) {
    drawerOverlay.style.display = 'flex';
  }

  renderRealtimeSubstAIInsights(casVal, nameShortVal, gadslVal, '', false);
}

function closeDrawer() {
  const drawerOverlay = document.getElementById('drawerOverlay');
  if (drawerOverlay) {
    drawerOverlay.style.display = 'none';
  }
}

window.closeDrawer = closeDrawer;

/* =========================================================================
   8. Excel 내보내기
   ========================================================================= */
function exportSubstanceExcel() {
  if (!substanceDataset.length || !window.XLSX) return;
  const rowsToExport = substFilteredIndices.map(rIdx => substanceDataset[rIdx]);
  const wsData = [substRawHeaders, ...rowsToExport];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Substances");
  XLSX.writeFile(wb, `a2MDS_SubstanceLog_${new Date().toISOString().slice(0,10)}.xlsx`);
}

window.exportSubstanceExcel = exportSubstanceExcel;

/* =========================================================================
   9. 초기 로드 트리거
   ========================================================================= */
document.addEventListener('DOMContentLoaded', async () => {
  await initSubstanceModule();
  const token = getSubstAuthKey();
  if ((!substanceDataset || substanceDataset.length === 0) && token) {
    await fetchSubstanceData(token, true);
  }
});

window.reloadSubstanceData = function() {
  const token = getSubstAuthKey();
  if (token) fetchSubstanceData(token, true);
};
