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

// Pre-indexed Master Lookups (O(1) Checker Cache)
let substMasterCasMap = new Map();
let substMasterNameMap = new Map();
let substIndicesConfig = {
  casIdx: 1,
  nameShortIdx: 2,
  gadslIdx: 3,
  reachXivIdx: 4,
  reachXivEntryIdx: 5,
  reachXviiEntryIdx: 6,
  euPopsIdx: 7,
  scPopsIdx: 8,
  emergingIdx: 9,
  tagsIdx: 10,
  nameImdsIdx: 11,
  gadslDetailIdx: 14,
  remarksIdx: 15,
  notesIdx: 16
};

// Substance Checker States
let substCheckerRawRows = [], substCheckerFilteredRows = [];
let substCheckerFilters = {}, substCheckerMultiFilters = {};
let activeSubstCheckerKpiFilterSet = new Set();
let substCheckerFilterDebounceTimer = null;

// Helpers & Cleaners & Safe Encoders
const formatSubstBlank = v => (v === undefined || v === null ? '' : String(v).trim());
const getSubstAuthKey = () => (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
const cleanSubstStr = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const normalizeSubstMatchKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

// core.js 등 전역 escapeHtml 유틸리티 충돌 방지 및 안전 폴백
if (typeof window.escapeHtml !== 'function') {
  window.escapeHtml = s => (s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
}

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
  } else if (tab === 'regNews') {
    renderSubstRegNewsTable();
  }
}

function renderGadslBadge(val) {
  if (!val || val === '-') return '';
  const clean = String(val).trim().toUpperCase();
  const safeVal = escapeHtml(val);
  if (clean.includes('P')) return `<span class="badge-status-p">${safeVal}</span>`;
  if (clean.includes('D')) return `<span class="badge-status-d">${safeVal}</span>`;
  return `<span>${safeVal}</span>`;
}

function renderGadslHeaderBox(val) {
  if (!val || val === '-') return '';
  const clean = String(val).trim().toUpperCase();
  const safeVal = escapeHtml(val);
  const style = clean.includes('P')
    ? 'background:#fee2e2; color:#dc2626; border:1px solid #fca5a5;'
    : (clean.includes('D') ? 'background:#e0f2fe; color:#0284c7; border:1px solid #bae6fd;' : 'background:#f1f5f9; color:#475569; border:1px solid #cbd5e1;');
  return `<span style="${style} padding:3px 8px; border-radius:6px; font-size:0.8rem; font-weight:700; margin-left:8px; display:inline-block;">${safeVal}</span>`;
}

const renderNameShortHeaderBox = val => (!val || val === '-' ? '' : `<span style="background:#f8fafc; color:#334155; border:1px solid #cbd5e1; padding:3px 8px; border-radius:6px; font-size:0.82rem; font-weight:600; margin-left:8px; display:inline-block;">${escapeHtml(val)}</span>`);

// CAS 복사 핸들러 (XSS 방어 및 안전 인자 처리)
async function copySubstCasToClipboard(cas, el, ev) {
  if (typeof window.copyTextToClipboard === 'function') {
    return window.copyTextToClipboard(cas, el, ev);
  }
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
  } catch(e) {
    console.error("IndexedDB Save Failed:", e);
  }
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
  try {
    const db = await openSubstDB();
    if (db) db.transaction('substances', 'readwrite').objectStore('substances').clear();
  } catch(e) {
    console.error("IndexedDB Clear Failed:", e);
  }
}

// =========================================================================
// INDEX MAP BUILDER (O(1) Pre-indexing for Substance Checker)
// =========================================================================
function buildSubstanceIndexMaps() {
  substMasterCasMap.clear();
  substMasterNameMap.clear();

  let casIdx = 1, nameShortIdx = 2, gadslIdx = 3, reachXivIdx = 4;
  let reachXivEntryIdx = 5, reachXviiEntryIdx = 6, euPopsIdx = 7, scPopsIdx = 8;
  let emergingIdx = 9, tagsIdx = 10, nameImdsIdx = 11, gadslDetailIdx = 14, remarksIdx = 15, notesIdx = 16;

  substRawHeaders.forEach((h, idx) => {
    const raw = String(h || '').trim();
    const clean = cleanSubstStr(raw);

    if (clean === 'cas' || clean === 'casrn') casIdx = idx;
    else if (clean === 'nameshort' || (clean.includes('name') && clean.includes('short'))) nameShortIdx = idx;
    else if (clean === 'gadslsvhc' || (clean.includes('gadsl') && clean.includes('svhc') && !clean.includes('version'))) gadslIdx = idx;
    else if (raw === 'REACH XIV' || clean === 'reachxiv') reachXivIdx = idx;
    else if (clean.includes('reachxiv') && clean.includes('entry')) reachXivEntryIdx = idx;
    else if (clean.includes('reachxvii') && clean.includes('entry')) reachXviiEntryIdx = idx;
    else if (clean === 'eupops' || clean.includes('eupops')) euPopsIdx = idx;
    else if (clean.includes('scpops')) scPopsIdx = idx;
    else if (clean === 'emerging') emergingIdx = idx;
    else if (clean.includes('tag')) tagsIdx = idx;
    else if (clean === 'nameimds' || (clean.includes('name') && clean.includes('imds'))) nameImdsIdx = idx;
    else if (clean.includes('gadsl') && (clean.includes('version') || clean.includes('details') || clean.includes('2026'))) gadslDetailIdx = idx;
    else if (clean.includes('applications') || clean.includes('remarks')) remarksIdx = idx;
    else if (clean.includes('additionalnotes') || clean.includes('notes')) notesIdx = idx;
  });

  substIndicesConfig = {
    casIdx, nameShortIdx, gadslIdx, reachXivIdx,
    reachXivEntryIdx, reachXviiEntryIdx, euPopsIdx, scPopsIdx,
    emergingIdx, tagsIdx, nameImdsIdx, gadslDetailIdx, remarksIdx, notesIdx
  };

  substanceDataset.forEach(r => {
    const casRaw = String(r[casIdx] || '').trim().toUpperCase();
    const nameImdsRaw = formatSubstBlank(r[nameImdsIdx]) || formatSubstBlank(r[nameShortIdx]);
    const normName = normalizeSubstMatchKey(nameImdsRaw);

    if (casRaw && casRaw !== '-' && casRaw !== 'SYSTEM' && !substMasterCasMap.has(casRaw)) {
      substMasterCasMap.set(casRaw, r);
    }
    if (normName && !substMasterNameMap.has(normName)) {
      substMasterNameMap.set(normName, r);
    }
  });
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
      buildSubstanceIndexMaps();
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
      buildSubstanceIndexMaps();
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
// C열: Name (Short) [col-name], D열: GADSL/SVHC [col-gadsl] 의도 순서 반영
const SUBST_COL_CLASSES = [
  'col-no', 'col-cas', 'col-name', 'col-gadsl', 'col-reach-xiv',
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

    // 1. 헤더 타이틀 가운데 정렬 및 지정 줄바꿈(<br>) 매핑
    let displayTitleHtml = escapeHtml(colName);
    if (clean === 'gadslsvhc' || clean.includes('gadsl')) {
      displayTitleHtml = 'GADSL<br>SVHC';
    } else if (clean.includes('reachxiv') && clean.includes('entry')) {
      displayTitleHtml = 'REACH<br>XIV Entry';
    } else if (clean.includes('reachxvii') && clean.includes('entry')) {
      displayTitleHtml = 'REACH<br>XVII Entry';
    }

    headRow.innerHTML += `
      <th class="${colClass}" title="${escapeHtmlAttr(colName)}" style="text-align:center !important; vertical-align:middle; white-space:normal; line-height:1.25; padding:6px 4px;">
        ${displayTitleHtml}
      </th>`;

    // 2. 텍스트 검색 3열(Node ID, CAS, Name) 외 나머지 8개 규제열 전체 드롭다운 적용
    const isTextInput = (idx === 0) || clean.includes('cas') || (clean.includes('name') && clean.includes('short'));

    if (!isTextInput) {
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
      const rawVal = row[i];
      const cellVal = formatSubstBlank(rawVal);

      if (cellVal === '') {
        if (!selectedSet.has('(blank)')) return false;
      } else {
        // 슬래시(/) 분해 방지: 쉼표, 세미콜론, 줄바꿈만 분리
        const cellTokens = cellVal.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel)) return false;
      }
    }
    return true;
  });
}

function populateSingleSubstDropdown(targetIdx) {
  const dd = document.getElementById(`substMsDropdown_${targetIdx}`);
  if (!dd) return;

  const availableRows = getSubstAvailableRows(targetIdx);
  const uniqueSet = new Set();
  let hasEmptyCell = false;

  availableRows.forEach(row => {
    const rawVal = row[targetIdx];
    const val = formatSubstBlank(rawVal);
    if (!val) {
      hasEmptyCell = true;
    } else {
      // 슬래시(/) 분해 방지
      val.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(tok => uniqueSet.add(tok));
    }
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (hasEmptyCell) {
    unique.unshift('(blank)'); // 빈 값('(blank)') 단독 배치
  }

  const currentSet = substMultiSelectFilters[targetIdx] || new Set();

  for (const v of currentSet) {
    if (v === '(blank)' && !hasEmptyCell) currentSet.delete(v);
    else if (v !== '(blank)' && !uniqueSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`substMsText_${targetIdx}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="substChkAll_${targetIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstDropdown(${targetIdx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => {
      let displayLabel = escapeHtml(val);
      if (val === '(blank)') displayLabel = '<span style="color:#94a3b8; font-weight:500;">(blank)</span>';
      else if (targetIdx === substIndicesConfig.gadslIdx) displayLabel = renderGadslBadge(val);

      const safeAttrVal = escapeHtmlAttr(val);
      return `<label class="multiselect-item"><input type="checkbox" value="${safeAttrVal}" ${currentSet.has(val) ? 'checked' : ''} data-col="${targetIdx}" data-val="${safeAttrVal}" onchange="toggleSubstDropdownItemElement(this)"> <span>${displayLabel}</span></label>`;
    }).join('');
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

// 뱃지 목록 및 카운트 보존 렌더링 함수
function renderSubstTopTagsFromCounts(emergingCounts, funcCounts) {
  const [emergingContainer, emergingBadge] = ['emergingTagsContainer', 'emergingCountBadge'].map(id => document.getElementById(id));
  const [funcContainer, funcBadge] = ['functionalTagsContainer', 'functionalCountBadge'].map(id => document.getElementById(id));

  const { emergingIdx, tagsIdx } = substIndicesConfig;

  const renderChips = (container, badge, counts, colIdx, typeCls) => {
    if (!container) return;
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    if (badge) badge.textContent = `${keys.length} tags`;
    const sel = substMultiSelectFilters[colIdx] || new Set();

    container.innerHTML = keys.length ? keys.map(k => {
      const safeKey = escapeHtml(k);
      const safeAttr = escapeHtmlAttr(k);
      const isActive = sel.has(k);
      return `
        <span class="insight-chip ${typeCls} ${isActive ? 'active' : ''}" data-col="${colIdx}" data-tag="${safeAttr}" onclick="onSubstTagChipClick(this)">
          ${safeKey} <span class="insight-chip-badge">${counts[k]}</span>
        </span>`;
    }).join('') : `<span style="font-size:0.78rem; color:#94a3b8;">No ${typeCls} records</span>`;
  };

  renderChips(emergingContainer, emergingBadge, emergingCounts, emergingIdx, 'emerging');
  renderChips(funcContainer, funcBadge, funcCounts, tagsIdx, 'tag');
}

// 클릭 시 다른 뱃지 목록이 사라지지 않도록 독립 풀 집계
function updateSubstTopTags() {
  const { emergingIdx, tagsIdx } = substIndicesConfig;
  const emergingCounts = {};
  const funcCounts = {};

  const baseFiltered = substanceDataset.filter(row => {
    for (let i = 0; i < substTableFilters.length; i++) {
      const kw = substTableFilters[i];
      if (kw && !formatSubstBlank(row[i]).toLowerCase().includes(kw)) return false;
    }
    for (const [idxStr, selectedSet] of Object.entries(substMultiSelectFilters)) {
      const i = parseInt(idxStr, 10);
      if (i === emergingIdx || i === tagsIdx || !selectedSet.size) continue;
      const cellVal = formatSubstBlank(row[i]);
      if (cellVal === '') {
        if (!selectedSet.has('(blank)')) return false;
      } else {
        const tokens = cellVal.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(selectedSet).some(sel => tokens.includes(sel) || cellVal === sel)) return false;
      }
    }
    return true;
  });

  const emergingSel = substMultiSelectFilters[emergingIdx] || new Set();
  const tagsSel = substMultiSelectFilters[tagsIdx] || new Set();

  baseFiltered.forEach(row => {
    let okForEmerging = true;
    if (tagsSel.size > 0 && tagsIdx !== -1) {
      const cellVal = formatSubstBlank(row[tagsIdx]);
      if (cellVal === '') {
        if (!tagsSel.has('(blank)')) okForEmerging = false;
      } else {
        const tokens = cellVal.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(tagsSel).some(sel => tokens.includes(sel) || cellVal === sel)) okForEmerging = false;
      }
    }
    if (okForEmerging && emergingIdx !== -1 && row[emergingIdx]) {
      const val = formatSubstBlank(row[emergingIdx]);
      if (val) {
        val.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(t => {
          emergingCounts[t] = (emergingCounts[t] || 0) + 1;
        });
      }
    }

    let okForTags = true;
    if (emergingSel.size > 0 && emergingIdx !== -1) {
      const cellVal = formatSubstBlank(row[emergingIdx]);
      if (cellVal === '') {
        if (!emergingSel.has('(blank)')) okForTags = false;
      } else {
        const tokens = cellVal.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
        if (!Array.from(emergingSel).some(sel => tokens.includes(sel) || cellVal === sel)) okForTags = false;
      }
    }
    if (okForTags && tagsIdx !== -1 && row[tagsIdx]) {
      const val = formatSubstBlank(row[tagsIdx]);
      if (val && val !== '-') {
        val.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean).forEach(t => {
          funcCounts[t] = (funcCounts[t] || 0) + 1;
        });
      }
    }
  });

  renderSubstTopTagsFromCounts(emergingCounts, funcCounts);
}

function onSubstTagChipClick(el) {
  if (!el) return;
  const colIdx = parseInt(el.getAttribute('data-col'), 10);
  const tagVal = el.getAttribute('data-tag');
  if (isNaN(colIdx) || tagVal === null) return;
  applySubstMultiTagFilter(tagVal, colIdx);
}

function applySubstMultiTagFilter(tagVal, colIdx) {
  if (colIdx === -1) return;
  if (!substMultiSelectFilters[colIdx]) substMultiSelectFilters[colIdx] = new Set();
  substMultiSelectFilters[colIdx].has(tagVal) ? substMultiSelectFilters[colIdx].delete(tagVal) : substMultiSelectFilters[colIdx].add(tagVal);

  const dd = document.getElementById(`substMsDropdown_${colIdx}`);
  if (dd && dd.classList.contains('show')) {
    populateSingleSubstDropdown(colIdx);
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

function toggleSubstDropdownItemElement(chk) {
  if (!chk) return;
  const idx = parseInt(chk.getAttribute('data-col'), 10);
  const val = chk.getAttribute('data-val');
  toggleSubstDropdownItem(idx, val, chk.checked);
}

function toggleSubstDropdownItem(idx, val, checked) {
  if (!substMultiSelectFilters[idx]) substMultiSelectFilters[idx] = new Set();
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
  substFilterDebounceTimer = setTimeout(filterSubstTableRows, 120);
}

// Single-Pass 필터링 실행
function filterSubstTableRows() {
  substFilteredIndices = [];

  substanceDataset.forEach((row, rIdx) => {
    let match = true;

    for (let i = 0; i < substTableFilters.length; i++) {
      const kw = substTableFilters[i];
      if (kw && !formatSubstBlank(row[i]).toLowerCase().includes(kw)) {
        match = false;
        break;
      }
    }
    if (!match) return;

    for (const [idxStr, selectedSet] of Object.entries(substMultiSelectFilters)) {
      if (selectedSet.size > 0) {
        const rawVal = row[parseInt(idxStr, 10)];
        const cellVal = formatSubstBlank(rawVal);

        if (cellVal === '') {
          if (!selectedSet.has('(blank)')) {
            match = false;
            break;
          }
        } else {
          // 슬래시(/) 분해 방지
          const cellTokens = cellVal.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
          if (!Array.from(selectedSet).some(sel => cellTokens.includes(sel) || cellVal === sel)) {
            match = false;
            break;
          }
        }
      }
    }
    if (!match) return;

    substFilteredIndices.push(rIdx);
  });

  updateSubstTopTags();
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

  const { casIdx, nameShortIdx, gadslIdx, emergingIdx, tagsIdx } = substIndicesConfig;

  for (let i = start; i < end; i++) {
    const realIdx = substFilteredIndices[i], row = substanceDataset[realIdx];
    html += '<tr>' + substDisplayHeaders.map((colName, cIdx) => {
      const val = formatSubstBlank(row[cIdx]);
      const safeVal = escapeHtml(val);
      const safeAttrVal = escapeHtmlAttr(val);
      const colClass = SUBST_COL_CLASSES[cIdx] || '';

      // 1. Node ID 열
      if (cIdx === 0) {
        return `
          <td class="${colClass}">
            <div style="display:flex; align-items:center; justify-content:space-between; gap:4px; width:100%; min-width:0;">
              <span style="font-family:var(--font-mono); font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeAttrVal}">${safeVal}</span>
              <button type="button" class="btn-view-drawer" onclick="openSubstDetailsDrawer(${realIdx})" data-tooltip="Click to View Details">📑</button>
            </div>
          </td>`;
      }

      // 2. CAS 열
      if (cIdx === casIdx) {
        return `
          <td class="${colClass}">
            ${val ? `<span class="clickable-cid" data-cas="${safeAttrVal}" onclick="onSubstCasCellClick(this, event)" title="Click to copy">${safeVal}</span>` : ''}
          </td>`;
      }

      // 3. Name (Short) 열 (C열)
      if (cIdx === nameShortIdx) {
        return `<td class="${colClass}" title="${safeAttrVal}">${safeVal}</td>`;
      }

      // 4. GADSL/SVHC 열 (D열)
      if (cIdx === gadslIdx) {
        return `<td class="${colClass}">${renderGadslBadge(val)}</td>`;
      }

      // 5. Emerging 및 Tags 열
      if ((cIdx === emergingIdx || cIdx === tagsIdx) && val !== '') {
        const tags = val.split(/[,;\r\n]+/).map(t => t.trim()).filter(Boolean);
        const badgeCls = cIdx === emergingIdx ? 'badge-emerging' : 'badge-tag';
        return `<td class="${colClass}"><div class="tags-flex-wrap">${tags.map(t => `<span class="${badgeCls}">${escapeHtml(t)}</span>`).join('')}</div></td>`;
      }

      // 6. 일반 규제 열
      return `<td class="${colClass}" title="${safeAttrVal}" style="text-align:center;">${safeVal}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || '<tr><td colspan="11" style="text-align:center; padding:20px; color:#94a3b8;">No matching records found.</td></tr>';
  document.getElementById('substViewerBadgeCount')?.replaceChildren(document.createTextNode(`Showing ${totalMatches.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`));
  document.getElementById('pageInfoDisplay')?.replaceChildren(document.createTextNode(`Page ${substCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()}`));
  const prev = document.getElementById('btnPrevPage'), next = document.getElementById('btnNextPage');
  if (prev) prev.disabled = substCurrentPage <= 1;
  if (next) next.disabled = substCurrentPage >= totalPages;
}

function onSubstCasCellClick(el, ev) {
  if (!el) return;
  const cas = el.getAttribute('data-cas');
  copySubstCasToClipboard(cas, el, ev);
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
  if (!nameShortVal && row[2]) nameShortVal = formatSubstBlank(row[2]);
  if (!gadslVal && row[3] && String(row[3]).length <= 6) gadslVal = formatSubstBlank(row[3]);

  return { casVal, nameShortVal, gadslVal };
}

function openSubstDetailsDrawer(realIdx) {
  const row = substanceDataset[realIdx];
  if (!row) return;

  const { casVal, nameShortVal, gadslVal } = getSubstKeyFields(row);

  const titleEl = document.getElementById('drawerSubstanceTitle');
  if (titleEl) {
    const safeCas = escapeHtml(casVal);
    const safeCasAttr = escapeHtmlAttr(casVal);
    titleEl.innerHTML = `
      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px;">
        <span>🧪 CAS: <strong>${safeCas || '-'}</strong></span>
        ${casVal ? `<button type="button" data-cas="${safeCasAttr}" onclick="onSubstCasCellClick(this, event)" title="Copy CAS" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; cursor:pointer; padding:2px 6px; font-size:0.75rem; color:#334155;">📋 Copy</button>` : ''}
        ${renderNameShortHeaderBox(nameShortVal)}
        ${renderGadslHeaderBox(gadslVal)}
      </div>`;
  }

  const metaGridFields = [];
  substRawHeaders.forEach((h, idx) => {
    const clean = cleanSubstStr(h);
    const isSpecialHeader = clean === 'cas' || clean === 'nameshort' || clean === 'gadslsvhc';
    if ((idx < 11 && !isSpecialHeader) || clean.includes('inclusion') || clean.includes('sunset')) {
      let rawVal = formatSubstBlank(row[idx]);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(rawVal)) {
        const d = new Date(rawVal);
        if (!isNaN(d.getTime())) {
          const yyyy = d.getFullYear();
          const mm = String(d.getMonth() + 1).padStart(2, '0');
          const dd = String(d.getDate()).padStart(2, '0');
          rawVal = `${yyyy}-${mm}-${dd}`;
        }
      }
      metaGridFields.push({ label: h, val: rawVal });
    }
  });

  document.getElementById('drawerInfoCard')?.replaceChildren(
    document.createRange().createContextualFragment(metaGridFields.map(f => `
      <div class="drawer-info-row">
        <span class="drawer-info-label">${escapeHtml(f.label)}</span>
        <span class="drawer-info-val" title="${escapeHtmlAttr(f.val)}"><strong>${escapeHtml(f.val) || '-'}</strong></span>
      </div>`).join(''))
  );

  let detailRowsHtml = '';
  for (let idx = 11; idx < substRawHeaders.length; idx++) {
    const headerName = substRawHeaders[idx] || `Field ${idx + 1}`;
    if (/inclusion|sunset/i.test(headerName)) continue;
    detailRowsHtml += `<tr><td class="drawer-matrix-label">📝 ${escapeHtml(headerName)}</td><td class="drawer-matrix-val">${escapeHtml(formatSubstBlank(row[idx])) || '-'}</td></tr>`;
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
// SUBSTANCE CHECKER ENGINE (O(1) Pre-indexed Lookup & Dynamic GADSL Modal)
// =========================================================================
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

  if (!substMasterCasMap.size) {
    buildSubstanceIndexMaps();
  }

  const {
    casIdx, nameShortIdx, gadslIdx, reachXivIdx, euPopsIdx, scPopsIdx,
    emergingIdx, nameImdsIdx, gadslDetailIdx, remarksIdx, notesIdx
  } = substIndicesConfig;

  substCheckerRawRows = [];

  items.forEach(itemObj => {
    const { rawCas, rawName } = itemObj;
    const casUpper = rawCas.toUpperCase();
    const normCas = normalizeSubstMatchKey(rawCas);
    const normName = normalizeSubstMatchKey(rawName);

    let matchedRow = null;

    // Pre-indexed Map 조회 (O(1))
    if (casUpper && casUpper !== '-' && casUpper !== 'SYSTEM' && substMasterCasMap.has(casUpper)) {
      matchedRow = substMasterCasMap.get(casUpper);
    } else if (normName && substMasterNameMap.has(normName)) {
      matchedRow = substMasterNameMap.get(normName);
    } else if (normCas && substMasterNameMap.has(normCas)) {
      matchedRow = substMasterNameMap.get(normCas);
    }

    if (matchedRow) {
      const remVal = formatSubstBlank(matchedRow[remarksIdx]) || '-';
      const notVal = formatSubstBlank(matchedRow[notesIdx]) || '-';
      const gadslDetailVal = formatSubstBlank(matchedRow[gadslDetailIdx]) || '-';
      const hasAnyContent = (remVal !== '-' && remVal !== '') || (notVal !== '-' && notVal !== '') || (gadslDetailVal !== '-' && gadslDetailVal !== '');

      substCheckerRawRows.push({
        cas: matchedRow[casIdx] || rawCas || '-',
        name: formatSubstBlank(matchedRow[nameImdsIdx]) || formatSubstBlank(matchedRow[nameShortIdx]) || rawName || '-',
        gadsl: formatSubstBlank(matchedRow[gadslIdx]) || '-',
        gadslDetail: gadslDetailVal,
        reachXiv: formatSubstBlank(matchedRow[reachXivIdx]) || '-',
        euPops: formatSubstBlank(matchedRow[euPopsIdx]) || '-',
        scPops: formatSubstBlank(matchedRow[scPopsIdx]) || '-',
        emerging: formatSubstBlank(matchedRow[emergingIdx]) || '-',
        remarks: remVal,
        notes: notVal,
        hasRemarksOrNotes: hasAnyContent,
        remarksCombined: `${remVal} ${notVal} ${gadslDetailVal}`.trim(),
        unmatched: '-'
      });
    } else {
      substCheckerRawRows.push({
        cas: rawCas || '-',
        name: rawName || 'Unknown / Not in Master DB',
        gadsl: '-',
        gadslDetail: '-',
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
  substCheckerFilterDebounceTimer = setTimeout(filterSubstCheckerRows, 120);
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
  const uniqueSet = new Set();
  let hasEmpty = false;

  substCheckerRawRows.forEach(r => {
    const rawVal = r[key];
    const val = formatSubstBlank(rawVal);
    if (!val) {
      hasEmpty = true;
    } else {
      uniqueSet.add(val);
    }
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (hasEmpty) {
    unique.unshift('(blank)');
  }

  const validSet = new Set(unique);
  for (const val of currentSet) {
    if (!validSet.has(val)) currentSet.delete(val);
  }

  const txt = document.getElementById(`checkerMsText_${key}`);
  if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="checkerChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstCheckerDropdown('${key}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => {
      let displayLabel = escapeHtml(v);
      if (v === '(blank)') {
        displayLabel = '<span style="color:#94a3b8; font-weight:500;">(blank)</span>';
      } else if (key === 'gadsl') {
        displayLabel = renderGadslBadge(v);
      }
      const safeAttrVal = escapeHtmlAttr(v);
      return `<label class="multiselect-item"><input type="checkbox" value="${safeAttrVal}" ${currentSet.has(v) ? 'checked' : ''} data-key="${key}" data-val="${safeAttrVal}" onchange="toggleSubstCheckerDropdownItemElement(this)"> <span>${displayLabel}</span></label>`;
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

function toggleSubstCheckerDropdownItemElement(chk) {
  if (!chk) return;
  const key = chk.getAttribute('data-key');
  const val = chk.getAttribute('data-val');
  toggleSubstCheckerDropdownItem(key, val, chk.checked);
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
      const cellVal = formatSubstBlank(r[key]);
      if (!cellVal) {
        if (!set.has('(blank)')) return false;
      } else {
        if (!set.has(cellVal)) return false;
      }
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
    const remarksCellHtml = r.hasRemarksOrNotes
      ? `<button type="button" class="btn-action-soft" onclick="openSubstRemarksModal(${i})" style="padding:2px 8px; font-size:0.75rem; background:#ffffff; border:1px solid #cbd5e1; border-radius:4px; font-weight:600; color:#334155;">📝 View</button>`
      : '';

    const cleanDisplay = v => (!v || v === '-' ? '' : v);
    const safeCas = escapeHtml(r.cas || '');
    const safeCasAttr = escapeHtmlAttr(r.cas || '');
    const safeName = escapeHtml(r.name || '');
    const safeNameAttr = escapeHtmlAttr(r.name || '');
    const safeReach = escapeHtml(cleanDisplay(r.reachXiv));
    const safeReachAttr = escapeHtmlAttr(cleanDisplay(r.reachXiv));
    const safeEuPops = escapeHtml(cleanDisplay(r.euPops));
    const safeEuPopsAttr = escapeHtmlAttr(cleanDisplay(r.euPops));
    const safeScPops = escapeHtml(cleanDisplay(r.scPops));
    const safeScPopsAttr = escapeHtmlAttr(cleanDisplay(r.scPops));
    const safeEmerging = escapeHtml(cleanDisplay(r.emerging));
    const safeEmergingAttr = escapeHtmlAttr(cleanDisplay(r.emerging));

    return `
      <tr>
        <td style="text-align:center; font-weight:normal; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>
        <td style="text-align:left; padding:6px 6px; font-family:'Consolas',monospace;">
          <span class="clickable-cid" data-cas="${safeCasAttr}" onclick="onSubstCasCellClick(this, event)" title="Click to copy" style="display:inline-block; font-size:0.80rem;">${safeCas}</span>
        </td>
        <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.78rem;" title="${safeNameAttr}">${safeName}</td>
        <td style="text-align:center; padding:6px 2px;">${renderGadslBadge(r.gadsl)}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeReachAttr}">${safeReach}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeEuPopsAttr}">${safeEuPops}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeScPopsAttr}">${safeScPops}</td>
        <td style="text-align:center; padding:6px 2px; font-size:0.78rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${safeEmergingAttr}">${safeEmerging}</td>
        <td style="text-align:center; padding:6px 6px;">${remarksCellHtml}</td>
      </tr>
    `;
  }).join('');
}

function openSubstRemarksModal(filteredIdx) {
  const row = substCheckerFilteredRows[filteredIdx];
  if (!row) return;

  const modal = document.getElementById('substRemarksModal');
  if (modal) {
    // 1. 모달 가로 너비 확장
    const dialog = modal.querySelector('.modal-content, .modal-dialog, .modal-card, [class*="modal"]') || modal.firstElementChild;
    if (dialog && dialog !== modal) {
      dialog.style.maxWidth = '860px';
      dialog.style.width = '92%';
    }
  }

  const titleEl = document.getElementById('substRemarksModalTitle');
  if (titleEl) {
    titleEl.textContent = `📝 GADSL Details & Remarks (CAS: ${row.cas})`;
  }

  // 2. 원본 구글 시트 헤더 명칭 동적 추출
  const { gadslDetailIdx, remarksIdx, notesIdx } = substIndicesConfig;
  const gadslHeaderTitle = (substRawHeaders[gadslDetailIdx] || 'GADSL Regulatory Details').trim();
  const remarksHeaderTitle = (substRawHeaders[remarksIdx] || 'Applications / Remarks').trim();
  const notesHeaderTitle = (substRawHeaders[notesIdx] || 'Additional Notes').trim();

  const remarksEl = document.getElementById('modalContentRemarks');
  if (remarksEl) {
    remarksEl.style.whiteSpace = 'pre-wrap';
    remarksEl.style.wordBreak = 'break-word';
    remarksEl.textContent = (row.remarks && row.remarks !== '-') ? row.remarks : '-';

   // Remarks 카드 타이틀 동적 동기화 (기존 텍스트 전체 깔끔하게 대체)
    const remarksTitleWrap = remarksEl.previousElementSibling;
    if (remarksTitleWrap) {
      remarksTitleWrap.innerHTML = `<span>📌</span> <strong>${escapeHtml(remarksHeaderTitle)}</strong>`;
    }

    // 3. GADSL 세부 내용 상단 카드 동적 생성 및 원본 헤더 타이틀 주입
    let gadslCard = document.getElementById('modalCardGadsl');
    if (!gadslCard && remarksEl.parentElement) {
      gadslCard = document.createElement('div');
      gadslCard.id = 'modalCardGadsl';
      gadslCard.className = remarksEl.parentElement.className || '';
      gadslCard.style.cssText = remarksEl.parentElement.style.cssText;
      gadslCard.style.marginBottom = '12px';
      gadslCard.innerHTML = `
        <div style="font-weight:700; margin-bottom:6px; display:flex; align-items:center; gap:6px; color:#0f172a;">
          <span>📦</span> <strong id="modalTitleGadsl">${escapeHtml(gadslHeaderTitle)}</strong>
        </div>
        <div id="modalContentGadsl" style="white-space:pre-wrap; word-break:break-word; font-size:0.84rem; line-height:1.5; color:#334155;"></div>
      `;
      remarksEl.parentElement.parentElement.insertBefore(gadslCard, remarksEl.parentElement);
    } else {
      const gTitle = document.getElementById('modalTitleGadsl');
      if (gTitle) gTitle.textContent = gadslHeaderTitle;
    }

    const gadslEl = document.getElementById('modalContentGadsl');
    if (gadslEl) {
      gadslEl.textContent = (row.gadslDetail && row.gadslDetail !== '-') ? row.gadslDetail : '-';
    }
  }

  const notesEl = document.getElementById('modalContentNotes');
  if (notesEl) {
    notesEl.style.whiteSpace = 'pre-wrap';
    notesEl.style.wordBreak = 'break-word';
    notesEl.textContent = (row.notes && row.notes !== '-') ? row.notes : '-';

    // Notes 카드 타이틀 동적 동기화 (기존 텍스트 전체 깔끔하게 대체)
    const notesTitleWrap = notesEl.previousElementSibling;
    if (notesTitleWrap) {
      notesTitleWrap.innerHTML = `<span>📝</span> <strong>${escapeHtml(notesHeaderTitle)}</strong>`;
    }
  }

  modal?.style.setProperty('display', 'flex');
}

function closeSubstRemarksModal() {
  document.getElementById('substRemarksModal')?.style.setProperty('display', 'none');
}
window.openSubstRemarksModal = openSubstRemarksModal;
window.closeSubstRemarksModal = closeSubstRemarksModal;

async function copySubstCheckerTable() {
  if (!substCheckerFilteredRows.length) return alert('No substance analysis records available to copy.');
  const btn = document.getElementById('btnCopySubstChecker'), orgHtml = btn?.innerHTML || '';

  const headers = ['No.', 'CAS', 'Name (IMDS)', 'GADSL/SVHC', 'REACH XIV', 'EU POPs', 'SC POPs', 'Emerging', 'GADSL Details & Remarks'];

  const rowsData = substCheckerFilteredRows.map((r, i) => {
    const fullNotesText = [
      (r.gadslDetail && r.gadslDetail !== '-') ? `[GADSL] ${r.gadslDetail}` : '',
      (r.remarks && r.remarks !== '-') ? `[Remarks] ${r.remarks}` : '',
      (r.notes && r.notes !== '-') ? `[Notes] ${r.notes}` : ''
    ].filter(Boolean).join(' | ') || '-';

    return [i + 1, r.cas, r.name, r.gadsl, r.reachXiv, r.euPops, r.scPops, r.emerging, fullNotesText];
  });

  if (typeof window.copyFormattedTableToClipboard === 'function') {
    await window.copyFormattedTableToClipboard(headers, rowsData, btn, orgHtml);
  } else {
    let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;"><thead style="background-color:#f1f5f9;"><tr>` +
      headers.map(h => `<th style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:normal; color:#0f172a; text-align:center;">${escapeHtml(h)}</th>`).join('') + `</tr></thead><tbody>`;

    let plainText = headers.join('\t') + '\n';
    rowsData.forEach(r => {
      const gColor = String(r[3]).includes('P') ? 'color:#dc2626;' : (String(r[3]).includes('D') ? 'color:#0284c7;' : 'color:#334155;');
      tableHtml += `<tr><td style="border:1px solid #cbd5e1; text-align:center;">${r[0]}</td><td style="border:1px solid #cbd5e1; text-align:left; font-family:monospace;">${escapeHtml(r[1])}</td><td style="border:1px solid #cbd5e1;">${escapeHtml(r[2])}</td><td style="border:1px solid #cbd5e1; text-align:center; ${gColor}">${escapeHtml(r[3])}</td><td style="border:1px solid #cbd5e1; text-align:center;">${escapeHtml(r[4])}</td><td style="border:1px solid #cbd5e1; text-align:center;">${escapeHtml(r[5])}</td><td style="border:1px solid #cbd5e1; text-align:center;">${escapeHtml(r[6])}</td><td style="border:1px solid #cbd5e1; text-align:center;">${escapeHtml(r[7])}</td><td style="border:1px solid #cbd5e1; text-align:left;">${escapeHtml(r[8])}</td></tr>`;
      plainText += r.join('\t') + '\n';
    });
    tableHtml += '</tbody></table>';

    try {
      if (navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([tableHtml], { type: 'text/html' }), 'text/plain': new Blob([plainText], { type: 'text/plain' }) })]);
      } else if (navigator.clipboard) await navigator.clipboard.writeText(plainText);
      if (btn) { btn.innerHTML = '✓ Copied!'; btn.style.color = '#16a34a'; setTimeout(() => { btn.innerHTML = orgHtml; btn.style.color = ''; }, 1500); }
    } catch(e) { alert('Failed to copy table to clipboard.'); }
  }
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
window.toggleSubstDropdownItemElement = toggleSubstDropdownItemElement;
window.onSubstTagChipClick = onSubstTagChipClick;
window.onSubstCasCellClick = onSubstCasCellClick;
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
window.toggleSubstCheckerDropdownItemElement = toggleSubstCheckerDropdownItemElement;
window.copySubstCheckerTable = copySubstCheckerTable;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('substCheckerInput')?.addEventListener('input', e => {
    const items = parseSubstInputItems(e.target.value);
    document.getElementById('substCheckerCountLabel')?.replaceChildren(document.createTextNode(`${items.length} unique items detected`));
  });
});

window.reloadSubstanceData = () => {
  const token = getSubstAuthKey();
  if (token) fetchSubstanceData(token, true);
};

// =========================================================================
// REG. NEWS ENGINE (Compliance Automated Feed 연동: In-Scope Only, Remarks 제외)
// =========================================================================
let substRegNewsRows = [];
let substRegNewsFilters = {};
let substRegNewsMultiFilters = { region: new Set(), status: new Set() };

// Compliance 데이터 브릿지 (메모리 우선, 로컬 IndexedDB 백업)
async function getComplianceFeedRowsForSubst() {
  if (window.compMonitoringFeedRows && window.compMonitoringFeedRows.length > 0) {
    return window.compMonitoringFeedRows;
  }
  try {
    const db = await openCompDB();
    if (!db) return [];
    return new Promise(res => {
      const req = db.transaction('sources', 'readonly').objectStore('sources').get('__meta__');
      req.onsuccess = () => res(req.result?.monitoringFeed?.data || []);
      req.onerror = () => res([]);
    });
  } catch (e) {
    return [];
  }
}

async function renderSubstRegNewsTable() {
  const headRow = document.getElementById('substRegNewsHeadRow');
  const filterRow = document.getElementById('substRegNewsFilterRow');
  const tbody = document.getElementById('substRegNewsTableBody');
  const badge = document.getElementById('substRegNewsBadgeCount');
  const tabBadge = document.getElementById('substRegNewsBadge');
  if (!headRow || !filterRow || !tbody) return;

  const rawRows = await getComplianceFeedRowsForSubst();

  // Status가 공란이거나 Out-of-Scope인 항목 엄격히 제외
  substRegNewsRows = rawRows.filter(row => {
    const stRaw = String(row[7] || '').trim();
    if (!stRaw || stRaw === '-') return false; // 공란 제외
    const stClean = stRaw.toLowerCase().replace(/\s+/g, '-');
    return stClean !== 'out-of-scope'; // Out-of-Scope 제외
  });

  // Remarks 제외 8개 열 구성 규격
  const columns = [
    { label: 'No.', width: '3.5%', filterType: 'none' },
    { label: 'Monitored', width: '8%', filterType: 'text', dataIdx: 0 },
    { label: 'Region', width: '6%', filterType: 'dropdown', key: 'region' },
    { label: 'Source / Endpoint', width: '15%', filterType: 'text', dataIdx: 2 },
    { label: 'Date', width: '8%', filterType: 'text', dataIdx: 3 },
    { label: 'Title', width: '24%', filterType: 'text', dataIdx: 4 },
    { label: 'Status', width: '8.5%', filterType: 'dropdown', key: 'status' },
    { label: 'Summary', width: 'auto', filterType: 'text', dataIdx: 8 }
  ];

  if (!substRegNewsRows.length) {
    headRow.innerHTML = columns.map(c => `<th style="width:${c.width}; font-weight:normal; text-align:center;">${escapeHtml(c.label)}</th>`).join('');
    filterRow.innerHTML = columns.map(c => `<th class="filter-th" style="width:${c.width};"></th>`).join('');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#94a3b8; font-weight:normal;">No In-Scope Regulatory News Found.</td></tr>';
    if (badge) badge.textContent = '0 items';
    return;
  }

  headRow.innerHTML = columns.map(c => 
    `<th style="width:${c.width}; max-width:${c.width}; padding:8px 6px; font-size:0.80rem; font-weight:normal; text-align:center; box-sizing:border-box;">${escapeHtml(c.label)}</th>`
  ).join('');

  filterRow.innerHTML = columns.map(c => {
    if (c.filterType === 'none') {
      return `<th class="filter-th" style="width:${c.width}; padding:4px 2px; text-align:center;"></th>`;
    }
    
    if (c.filterType === 'dropdown') {
      const currentSet = substRegNewsMultiFilters[c.key] || new Set();
      const btnText = !currentSet.size ? 'All' : `${currentSet.size} selected`;
      return `
        <th class="filter-th" style="width:${c.width}; padding:4px 2px; box-sizing:border-box;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="substNewsMsBtn_${c.key}" onclick="toggleSubstRegNewsDropdown('${c.key}')" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="substNewsMsText_${c.key}">${btnText}</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="substNewsMsDropdown_${c.key}"></div>
          </div>
        </th>`;
    }

    const curVal = substRegNewsFilters[c.dataIdx] || '';
    return `
      <th class="filter-th" style="width:${c.width}; padding:4px 3px; box-sizing:border-box;">
        <input type="text" class="filter-input" placeholder="Filter..." value="${escapeHtmlAttr(curVal)}" oninput="onSubstRegNewsFilterChange(${c.dataIdx}, this.value)" style="width:100%; padding:3px 5px; font-size:0.75rem; box-sizing:border-box;">
      </th>`;
  }).join('');

  filterSubstRegNewsRows();
}

function getSubstRegNewsAvailableRows(excludeKey = '') {
  return substRegNewsRows.filter(row => {
    if (excludeKey !== 'region' && substRegNewsMultiFilters.region?.size > 0) {
      const reg = String(row[1] || '').trim();
      if (!substRegNewsMultiFilters.region.has(reg || '(blank)')) return false;
    }
    if (excludeKey !== 'status' && substRegNewsMultiFilters.status?.size > 0) {
      const st = String(row[7] || '').trim();
      if (!substRegNewsMultiFilters.status.has(st || '(blank)')) return false;
    }
    for (const [colIdxStr, kw] of Object.entries(substRegNewsFilters)) {
      if (!kw) continue;
      const c = parseInt(colIdxStr, 10);
      const cellVal = String(row[c] || '').toLowerCase();
      if (!cellVal.includes(kw)) return false;
    }
    return true;
  });
}

function populateSingleSubstRegNewsDropdown(key) {
  const dd = document.getElementById(`substNewsMsDropdown_${key}`);
  if (!dd) return;

  const colIdx = (key === 'region') ? 1 : 7;
  const availableRows = getSubstRegNewsAvailableRows(key);
  const currentSet = substRegNewsMultiFilters[key] || new Set();
  const uniqueSet = new Set();
  let hasEmptyCell = false;

  availableRows.forEach(row => {
    const rawVal = String(row[colIdx] || '').trim();
    if (!rawVal) hasEmptyCell = true;
    else uniqueSet.add(rawVal);
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (hasEmptyCell) unique.unshift('(blank)');

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`substNewsMsText_${key}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="substNewsChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSubstRegNewsDropdown('${key}', this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => {
      let displayLabel = escapeHtml(val);
      if (val === '(blank)') displayLabel = '<span style="color:#94a3b8; font-weight:500;">(blank)</span>';
      const safeAttrVal = escapeHtmlAttr(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" value="${safeAttrVal}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleSubstRegNewsDropdownItem('${key}', '${safeAttrVal}', this.checked)">
          <span>${displayLabel}</span>
        </label>`;
    }).join('');
}

function toggleSubstRegNewsDropdown(key) {
  const dd = document.getElementById(`substNewsMsDropdown_${key}`);
  const btn = document.getElementById(`substNewsMsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleSubstRegNewsDropdown(key);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 240))}px`;
    dd.classList.add('show');
  }
}

function selectAllSubstRegNewsDropdown(key, chk) {
  if (!substRegNewsMultiFilters[key]) substRegNewsMultiFilters[key] = new Set();
  substRegNewsMultiFilters[key].clear();
  document.querySelectorAll(`#substNewsMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });
  const msText = document.getElementById(`substNewsMsText_${key}`);
  if (msText) msText.textContent = 'All';
  filterSubstRegNewsRows();
}

function toggleSubstRegNewsDropdownItem(key, val, checked) {
  if (!substRegNewsMultiFilters[key]) substRegNewsMultiFilters[key] = new Set();
  checked ? substRegNewsMultiFilters[key].add(val) : substRegNewsMultiFilters[key].delete(val);
  const cnt = substRegNewsMultiFilters[key].size;
  const chkAll = document.getElementById(`substNewsChkAll_${key}`);
  if (chkAll) chkAll.checked = !cnt;
  const msText = document.getElementById(`substNewsMsText_${key}`);
  if (msText) msText.textContent = !cnt ? 'All' : `${cnt} selected`;
  filterSubstRegNewsRows();
}

function onSubstRegNewsFilterChange(colIdx, val) {
  substRegNewsFilters[colIdx] = val.toLowerCase().trim();
  filterSubstRegNewsRows();
}

function resetSubstRegNewsFilters() {
  substRegNewsFilters = {};
  substRegNewsMultiFilters = { region: new Set(), status: new Set() };
  document.querySelectorAll('#substRegNewsFilterRow .filter-input').forEach(i => i.value = '');
  ['region', 'status'].forEach(key => {
    const textEl = document.getElementById(`substNewsMsText_${key}`);
    if (textEl) textEl.textContent = 'All';
    const chkAll = document.getElementById(`substNewsChkAll_${key}`);
    if (chkAll) chkAll.checked = true;
    document.querySelectorAll(`#substNewsMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
      if (c !== chkAll) c.checked = false;
    });
  });
  filterSubstRegNewsRows();
}

function filterSubstRegNewsRows() {
  const tbody = document.getElementById('substRegNewsTableBody');
  const badge = document.getElementById('substRegNewsBadgeCount');
  if (!tbody) return;

  const filtered = substRegNewsRows.filter(row => {
    if (substRegNewsMultiFilters.region?.size > 0) {
      const reg = String(row[1] || '').trim();
      if (!substRegNewsMultiFilters.region.has(reg || '(blank)')) return false;
    }
    if (substRegNewsMultiFilters.status?.size > 0) {
      const st = String(row[7] || '').trim();
      if (!substRegNewsMultiFilters.status.has(st || '(blank)')) return false;
    }
    for (const [colIdxStr, kw] of Object.entries(substRegNewsFilters)) {
      if (!kw) continue;
      const c = parseInt(colIdxStr, 10);
      const cellVal = String(row[c] || '').toLowerCase();
      if (!cellVal.includes(kw)) return false;
    }
    return true;
  });

  if (badge) badge.textContent = `${filtered.length} of ${substRegNewsRows.length} items`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:24px; color:#94a3b8; font-weight:normal;">No matching regulatory news found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((row, idx) => {
    const no = idx + 1;
    const rawExecTime = String(row[0] || '').trim();
    const execTime = rawExecTime.split(' ')[0] || '-';
    const region = String(row[1] || '').trim();
    const sourceEndpoint = String(row[2] || '').trim();
    const pubDate = String(row[3] || '').trim();
    const title = String(row[4] || '').trim();
    const link = String(row[5] || '').trim();
    const sourceUrl = row[6] || (typeof getChannelSourceUrl === 'function' ? getChannelSourceUrl(sourceEndpoint) : '#');
    const status = String(row[7] || '').trim();
    const summary = String(row[8] || '').trim();

    // Source 인라인 링크 + 말줄임 + 툴팁
    const isSourceLink = /^https?:\/\//i.test(sourceUrl);
    const sourceHtml = isSourceLink
      ? `<a href="${escapeHtmlAttr(sourceUrl)}" target="_blank" rel="noopener noreferrer" style="color:#0284c7; text-decoration:none; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtmlAttr(sourceEndpoint)}">${escapeHtml(sourceEndpoint || '-')}</a>`
      : `<span style="display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtmlAttr(sourceEndpoint)}">${escapeHtml(sourceEndpoint || '-')}</span>`;

    // Title 인라인 링크 + 말줄임 + 툴팁
    const isLinkUrl = /^https?:\/\//i.test(link);
    const titleHtml = isLinkUrl
      ? `<a href="${escapeHtmlAttr(link)}" target="_blank" rel="noopener noreferrer" style="color:#0284c7; text-decoration:none; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtmlAttr(title)}">${escapeHtml(title || '-')}</a>`
      : `<span style="color:#1f2937; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${escapeHtmlAttr(title)}">${escapeHtml(title || '-')}</span>`;

    // Status 텍스트 색상 분기
    let statusColor = '#64748b';
    const stClean = status.toLowerCase();
    if (stClean === 'completed') statusColor = '#16a34a';
    else if (stClean === 'in progress' || stClean === 'in-progress') statusColor = '#d97706';

    // Summary: 전체 텍스트 줄바꿈 유지 (Remarks 제외)
    const summaryHtml = summary
      ? `<div style="color:#475569; font-size:0.75rem; line-height:1.4; white-space:pre-line; word-break:break-word;" title="${escapeHtmlAttr(summary)}">${escapeHtml(summary)}</div>`
      : '<span style="color:#cbd5e1;">-</span>';

    return `
      <tr style="min-height:36px; border-bottom:1px solid #f1f5f9;">
        <td style="text-align:center; color:#64748b; font-size:0.78rem; padding:4px 2px; white-space:nowrap;">${no}</td>
        <td style="text-align:center; font-family:var(--font-mono); font-size:0.75rem; color:#475569; padding:4px 2px; white-space:nowrap;" title="${escapeHtmlAttr(rawExecTime)}">${escapeHtml(execTime)}</td>
        <td style="text-align:center; font-size:0.78rem; color:#334155; padding:4px 2px; white-space:nowrap;">${escapeHtml(region || '')}</td>
        <td style="padding:4px 8px; font-size:0.80rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${sourceHtml}</td>
        <td style="text-align:center; font-size:0.76rem; color:#475569; padding:4px 4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${escapeHtmlAttr(pubDate || '-')}">${escapeHtml(pubDate || '-')}</td>
        <td style="padding:4px 8px; font-size:0.80rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${titleHtml}</td>
        <td style="text-align:center; font-size:0.78rem; font-weight:normal; color:${statusColor}; padding:4px 4px; white-space:nowrap;">${escapeHtml(status)}</td>
        <td style="padding:4px 8px; font-size:0.75rem; vertical-align:middle;">${summaryHtml}</td>
      </tr>`;
  }).join('');
}

// 전역 window 바인딩
window.renderSubstRegNewsTable = renderSubstRegNewsTable;
window.filterSubstRegNewsRows = filterSubstRegNewsRows;
window.onSubstRegNewsFilterChange = onSubstRegNewsFilterChange;
window.resetSubstRegNewsFilters = resetSubstRegNewsFilters;
window.toggleSubstRegNewsDropdown = toggleSubstRegNewsDropdown;
window.selectAllSubstRegNewsDropdown = selectAllSubstRegNewsDropdown;
window.toggleSubstRegNewsDropdownItem = toggleSubstRegNewsDropdownItem;