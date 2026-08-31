/* =========================================================================
   SMELTER LOG MODULE (CAHRA Multi-Preset Engine & Plain Text Styling)
   ========================================================================= */
const URL_SMELTER = 'https://script.google.com/macros/s/AKfycbwKKRk2-NKSnSnVfb1cGrMkHGgxx5J5iHognV4AAR1ZGZK9fmp9vTcPW5w69MjgGWQRlw/exec';
const SMELTER_DB_NAME = 'a2MDS_SmelterLog_DB';
const CAHRA_STORAGE_KEY = 'a2mds_cahra_custom_countries';

let smelterFilesToProcess = [];
let consolidatedDataStore = [];
let smelterTableFilters = {};
let smelterMultiSelectFilters = {};
let consolidatedHeaderStore = [
  'No.', 'Source', 'Metal', 'Smelter Reference', 'Standard Smelter Name', 
  'Country', 'Smelter ID', 'City', 'State Province', 'RMAP Status', 
  'Last audit / Cycle / Reaudit In Progress', 'Revision History'
];
let smelterCurrentLastUpdated = '';
let smelterFilterDebounceTimer = null;

// 페이지네이션 상태 (기본 100개)
let smelterCurrentPage = 1;
let smelterPageSize = 100;
let smelterFilteredIndices = [];

// 화면 표시 컬럼 매핑 구조
let displayColumnMap = [];

// =========================================================================
// CAHRA REGULATORY PRESETS & DETERMINATION ENGINE
// =========================================================================
const CAHRA_PRESET_EU = [
  'AFGHANISTAN', 'BURKINA FASO', 'BURUNDI', 'CAMEROON', 'CENTRAL AFRICAN REPUBLIC', 'CHAD',
  'COLOMBIA', 'DEMOCRATIC REPUBLIC OF THE CONGO', 'ERITREA', 'ETHIOPIA', 'INDIA', 'LIBYA',
  'MALI', 'MOZAMBIQUE', 'MYANMAR', 'NIGER', 'NIGERIA', 'PAKISTAN', 'PHILIPPINES', 'RUSSIA',
  'SOMALIA', 'SOUTH SUDAN', 'SUDAN', 'TURKEY', 'UKRAINE', 'YEMEN'
];

// US Dodd-Frank 1502: DRC + 9 Covered Countries (총 10개국 정격)
const CAHRA_PRESET_US = [
  'DEMOCRATIC REPUBLIC OF THE CONGO', 'ANGOLA', 'BURUNDI', 'CENTRAL AFRICAN REPUBLIC',
  'CONGO', 'RWANDA', 'SOUTH SUDAN', 'TANZANIA', 'UGANDA', 'ZAMBIA'
];

let activeCahraCountrySet = new Set([...CAHRA_PRESET_EU, ...CAHRA_PRESET_US]);

function loadSavedCahraCountries() {
  try {
    const raw = localStorage.getItem(CAHRA_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        activeCahraCountrySet = new Set(arr.map(c => String(c).trim().toUpperCase()));
      }
    }
  } catch(e) {}
}

function saveCahraCountriesToStorage() {
  try {
    localStorage.setItem(CAHRA_STORAGE_KEY, JSON.stringify(Array.from(activeCahraCountrySet)));
  } catch(e) {}
}

function isCahraCountry(countryName) {
  if (!countryName) return false;
  const clean = String(countryName).trim().toUpperCase();
  if (activeCahraCountrySet.has(clean)) return true;
  for (const c of activeCahraCountrySet) {
    if (clean.includes(c) || c.includes(clean)) return true;
  }
  return false;
}

// CAHRA 설정 모달 핸들러
function openCahraModal() {
  updateCahraModalUI();
  const modal = document.getElementById('cahraModal');
  if (modal) modal.style.display = 'flex';
}

function closeCahraModal() {
  const modal = document.getElementById('cahraModal');
  if (modal) modal.style.display = 'none';
}

function updateCahraModalUI() {
  const container = document.getElementById('cahraTagsContainer');
  const countBadge = document.getElementById('cahraActiveCount');
  const topCountBadge = document.getElementById('btnCahraCountBadge');
  const btnEu = document.getElementById('btnPresetEu');
  const btnUs = document.getElementById('btnPresetUs');

  const count = activeCahraCountrySet.size;
  if (countBadge) countBadge.textContent = count;
  if (topCountBadge) topCountBadge.textContent = count;

  // 각 프리셋 목록이 현재 선택에 완전히 포함되어 있는지 확인
  const isEuAll = CAHRA_PRESET_EU.every(c => activeCahraCountrySet.has(c));
  const isUsAll = CAHRA_PRESET_US.every(c => activeCahraCountrySet.has(c));

  // EU 버튼 상태 및 체크 마크 갱신
  if (btnEu) {
    btnEu.classList.toggle('active', isEuAll);
    const titleSpan = btnEu.querySelector('.preset-title');
    if (titleSpan) {
      titleSpan.innerHTML = isEuAll 
        ? `<span>✓ 🇪🇺 EU CAHRA Standard</span>` 
        : `<span>🇪🇺 EU CAHRA Standard</span>`;
    }
  }

  // US 버튼 상태 및 체크 마크 갱신
  if (btnUs) {
    btnUs.classList.toggle('active', isUsAll);
    const titleSpan = btnUs.querySelector('.preset-title');
    if (titleSpan) {
      titleSpan.innerHTML = isUsAll 
        ? `<span>✓ 🇺🇸 Dodd-Frank (DRC+9)</span>` 
        : `<span>🇺🇸 Dodd-Frank (DRC+9)</span>`;
    }
  }

  // 활성 국가 태그 렌더링
  if (container) {
    const sorted = Array.from(activeCahraCountrySet).sort();
    container.innerHTML = sorted.length ? sorted.map(c => `
      <span class="cahra-tag-chip">
        ${c}
        <span class="tag-del" onclick="removeCahraCountry('${c}')" title="Remove country">&times;</span>
      </span>
    `).join('') : '<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No countries selected.</span>';
  }
}

function toggleCahraPreset(type) {
  const targetList = (type === 'EU') ? CAHRA_PRESET_EU : CAHRA_PRESET_US;
  const otherList = (type === 'EU') ? CAHRA_PRESET_US : CAHRA_PRESET_EU;
  const isAllIncluded = targetList.every(c => activeCahraCountrySet.has(c));

  if (isAllIncluded) {
    // 3 & 4) 이미 활성화된 상태에서 클릭 시: 다른 프리셋에 포함된 국가는 보존하고, 해당 프리셋 고유 국가만 안전하게 제거
    const otherSet = new Set(otherList.every(c => activeCahraCountrySet.has(c)) ? otherList : []);
    targetList.forEach(c => {
      if (!otherSet.has(c)) {
        activeCahraCountrySet.delete(c);
      }
    });
  } else {
    // 1 & 2) 비활성화된 상태에서 클릭 시: 해당 프리셋 국가들을 모두 추가
    targetList.forEach(c => activeCahraCountrySet.add(c));
  }
  updateCahraModalUI();
}

function addCahraCountryFromInput() {
  const input = document.getElementById('inputNewCahraCountry');
  if (!input) return;
  const val = input.value.trim().toUpperCase();
  if (val) {
    activeCahraCountrySet.add(val);
    input.value = '';
    updateCahraModalUI();
  }
}

function removeCahraCountry(c) {
  activeCahraCountrySet.delete(c);
  updateCahraModalUI();
}

function clearAllCahraCountries() {
  activeCahraCountrySet.clear();
  updateCahraModalUI();
}

function saveCahraConfiguration() {
  saveCahraCountriesToStorage();
  closeCahraModal();
  updateTopCahraButtonBadge();
  filterSmelterTableRows();
}

function updateTopCahraButtonBadge() {
  const topBadge = document.getElementById('btnCahraCountBadge');
  if (topBadge) topBadge.textContent = activeCahraCountrySet.size;
}

const openManualModal = () => { const el = document.getElementById('manualModal'); if (el) el.style.display = 'flex'; };
const closeManualModal = () => { const el = document.getElementById('manualModal'); if (el) el.style.display = 'none'; };

function openSmelterDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(SMELTER_DB_NAME, 1);
      req.onupgradeneeded = e => { 
        const db = e.target.result; 
        if (!db.objectStoreNames.contains('smelters')) db.createObjectStore('smelters', { keyPath: 'id', autoIncrement: true }); 
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch(e) { res(null); }
  });
}

async function saveSmelterToDB(headers, rows, lastUpdated) {
  try {
    const db = await openSmelterDB();
    if (!db) return;
    const tx = db.transaction('smelters', 'readwrite');
    const store = tx.objectStore('smelters');
    store.clear();
    store.put({ id: 'metadata', headers, lastUpdated });
    rows.forEach((r, idx) => store.put({ id: idx + 1, rowData: r }));
  } catch(e) {}
}

async function loadSmelterFromDB() {
  try {
    const db = await openSmelterDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('smelters', 'readonly').objectStore('smelters').getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        if (!items.length) return res(null);
        const meta = items.find(i => i.id === 'metadata');
        res({ 
          headers: meta?.headers || [], 
          lastUpdated: meta?.lastUpdated || '', 
          rows: items.filter(i => i.id !== 'metadata').map(i => i.rowData) 
        });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearSmelterIndexedDB() { 
  try { 
    const db = await openSmelterDB(); 
    if (db) db.transaction('smelters', 'readwrite').objectStore('smelters').clear(); 
  } catch(e) {} 
}

async function initSmelterModule() {
  try {
    loadSavedCahraCountries();
    updateTopCahraButtonBadge();
    const cachedSmelter = await loadSmelterFromDB();
    if (cachedSmelter?.rows?.length) {
      consolidatedHeaderStore = cachedSmelter.headers || consolidatedHeaderStore; 
      consolidatedDataStore = cachedSmelter.rows || [];
      smelterCurrentLastUpdated = cachedSmelter.lastUpdated || '';
      renderSmelterVisualDashboard(cachedSmelter.rows, smelterCurrentLastUpdated); 
      renderSmelterViewerTable();
    } else {
      const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
      if (key) fetchSmelterData(key);
    }
  } catch(e) {
    console.error("initSmelterModule error:", e);
  }
}

async function fetchSmelterData(authOverride = '', forceReload = false) {
  const key = authOverride || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) return;

  const btn = document.getElementById('btnRefreshCloudSmelter');
  if (btn) { btn.textContent = '⏳ Loading...'; btn.disabled = true; }

  try {
    const payload = {
      auth: key,
      action: 'fetch_data',
      clientLastUpdated: forceReload ? '' : smelterCurrentLastUpdated
    };

    const resp = await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      if (btn) { btn.textContent = '🔄 Reload'; btn.disabled = false; }
      return res;
    }

    const rows = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    if (res?.headers?.length) consolidatedHeaderStore = res.headers;

    if (rows.length > 0) {
      consolidatedDataStore = rows;
      smelterCurrentLastUpdated = res.lastUpdated || '';
      await saveSmelterToDB(consolidatedHeaderStore, rows, smelterCurrentLastUpdated);
      renderSmelterVisualDashboard(rows, smelterCurrentLastUpdated);
      renderSmelterViewerTable();
    }
    return res;
  } catch(err) {
    console.error("fetchSmelterData error:", err);
  } finally {
    if (btn) { btn.textContent = '🔄 Reload'; btn.disabled = false; }
  }
}

/* =========================================================================
   대시보드 칩 렌더링
   ========================================================================= */
function renderSmelterVisualDashboard(rows = [], serverLastUpdated = '') {
  const typeCounts = { CMRT: 0, EMRT: 0, AMRT: 0, REVISION: 0, OTHER: 0 };
  const statusCounts = { Conformant: 0, Active: 0, Removed: 0, Standard: 0 };
  const metalCounts = {};

  rows.forEach(r => {
    const type = String(r[1] || '').toUpperCase();
    if (typeCounts[type] !== undefined) typeCounts[type]++; else typeCounts.OTHER++;

    const status = String(r[9] || '');
    if (statusCounts[status] !== undefined) statusCounts[status]++; else statusCounts.Standard++;

    const metal = String(r[2] || '').trim();
    const mKey = metal && metal !== '-' ? metal : 'Unassigned';
    metalCounts[mKey] = (metalCounts[mKey] || 0) + 1;
  });

  const total = rows.length;

  const pConf = total ? (statusCounts.Conformant / total) * 100 : 0;
  const pAct = total ? (statusCounts.Active / total) * 100 : 0;
  const pStd = total ? (statusCounts.Standard / total) * 100 : 0;
  const pRem = total ? (statusCounts.Removed / total) * 100 : 0;

  const bConf = document.getElementById('barConformant');
  const bAct = document.getElementById('barActive');
  const bStd = document.getElementById('barStandard');
  const bRem = document.getElementById('barRemoved');
  if (bConf) bConf.style.width = `${pConf}%`;
  if (bAct) bAct.style.width = `${pAct}%`;
  if (bStd) bStd.style.width = `${pStd}%`;
  if (bRem) bRem.style.width = `${pRem}%`;

  const rmapTotal = document.getElementById('rmapTotalLabel');
  if (rmapTotal) rmapTotal.textContent = `${total.toLocaleString()} facilities`;

  let rmapWrap = document.getElementById('smelterRmapChipsWrap');
  if (!rmapWrap) {
    const legEl = document.getElementById('legConformant');
    if (legEl) {
      rmapWrap = legEl.parentElement.parentElement;
      rmapWrap.id = 'smelterRmapChipsWrap';
    }
  }

  if (rmapWrap) {
    const statusItems = [
      { key: 'Conformant', count: statusCounts.Conformant, pct: pConf, color: '#16a34a' },
      { key: 'Active', count: statusCounts.Active, pct: pAct, color: '#0284c7' },
      { key: 'Standard', count: statusCounts.Standard, pct: pStd, color: '#64748b' },
      { key: 'Removed', count: statusCounts.Removed, pct: pRem, color: '#dc2626' }
    ];

    rmapWrap.innerHTML = statusItems.filter(item => item.count > 0).map(item => {
      const isSelected = smelterMultiSelectFilters[9]?.has(item.key);
      return `
        <span class="insight-chip tag ${isSelected ? 'active' : ''}" 
              data-col="9" data-tag="${item.key}"
              onclick="toggleSmelterDashboardFilter(9, '${item.key}')" 
              title="Filter by ${item.key}">
          <span class="legend-dot" style="background:${item.color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${item.key}</strong> 
          <span class="insight-chip-badge" style="font-weight:400;">${item.count.toLocaleString()} (${item.pct.toFixed(1)}%)</span>
        </span>`;
    }).join('');
  }

  const pCMRT = total ? (typeCounts.CMRT / total) * 100 : 0;
  const pEMRT = total ? (typeCounts.EMRT / total) * 100 : 0;
  const pAMRT = total ? (typeCounts.AMRT / total) * 100 : 0;
  const pRev = total ? (typeCounts.REVISION / total) * 100 : 0;

  const bCMRT = document.getElementById('barCMRT');
  const bEMRT = document.getElementById('barEMRT');
  const bAMRT = document.getElementById('barAMRT');
  const bRev = document.getElementById('barRevType');
  if (bCMRT) bCMRT.style.width = `${pCMRT}%`;
  if (bEMRT) bEMRT.style.width = `${pEMRT}%`;
  if (bAMRT) bAMRT.style.width = `${pAMRT}%`;
  if (bRev) bRev.style.width = `${pRev}%`;

  const templateTotal = document.getElementById('templateTotalLabel');
  if (templateTotal) templateTotal.textContent = `${total.toLocaleString()} total`;

  let sourceWrap = document.getElementById('smelterSourceChipsWrap');
  if (!sourceWrap) {
    const legEl = document.getElementById('legCMRT');
    if (legEl) {
      sourceWrap = legEl.parentElement.parentElement;
      sourceWrap.id = 'smelterSourceChipsWrap';
    }
  }

  if (sourceWrap) {
    const typeItems = [
      { key: 'CMRT', label: 'CMRT', count: typeCounts.CMRT, pct: pCMRT, color: '#16a34a' },
      { key: 'EMRT', label: 'EMRT', count: typeCounts.EMRT, pct: pEMRT, color: '#0284c7' },
      { key: 'AMRT', label: 'AMRT', count: typeCounts.AMRT, pct: pAMRT, color: '#d97706' },
      { key: 'REVISION', label: 'Revision', count: typeCounts.REVISION, pct: pRev, color: '#dc2626' }
    ];

    sourceWrap.innerHTML = typeItems.filter(item => item.count > 0).map(item => {
      const isSelected = smelterMultiSelectFilters[1]?.has(item.key);
      return `
        <span class="insight-chip tag ${isSelected ? 'active' : ''}" 
              data-col="1" data-tag="${item.key}"
              onclick="toggleSmelterDashboardFilter(1, '${item.key}')" 
              title="Filter by ${item.label}">
          <span class="legend-dot" style="background:${item.color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${item.label}</strong> 
          <span class="insight-chip-badge" style="font-weight:400;">${item.count.toLocaleString()} (${item.pct.toFixed(1)}%)</span>
        </span>`;
    }).join('');
  }

  const sortedMetals = Object.entries(metalCounts).sort((a, b) => b[1] - a[1]);
  let mBarHtml = '', mLegHtml = '';
  sortedMetals.forEach(([mName, count], idx) => {
    const pct = total ? (count / total) * 100 : 0;
    const color = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) ? PALETTE[idx % PALETTE.length] : '#0284c7';
    const isSelected = smelterMultiSelectFilters[2]?.has(mName);
    
    mBarHtml += `<div class="p-segment" style="width:${pct}%; background:${color};" title="${mName}: ${count.toLocaleString()} (${pct.toFixed(1)}%)"></div>`;
    mLegHtml += `
      <span class="insight-chip tag ${isSelected ? 'active' : ''}" 
            data-col="2" data-tag="${mName}"
            onclick="toggleSmelterDashboardFilter(2, '${mName.replace(/'/g, "\\'")}')" 
            title="Filter by ${mName}">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${mName}</strong> 
        <span class="insight-chip-badge" style="font-weight:400;">${count.toLocaleString()} (${pct.toFixed(1)}%)</span>
      </span>`;
  });

  const mBarWrap = document.getElementById('metalProgressBarWrap');
  const mLegGrid = document.getElementById('metalLegendGrid');
  const mTotalLabel = document.getElementById('metalTotalLabel');
  const sSummaryDate = document.getElementById('smelterSummaryUpdateDate');
  if (mBarWrap) mBarWrap.innerHTML = mBarHtml;
  if (mLegGrid) mLegGrid.innerHTML = mLegHtml;
  if (mTotalLabel) mTotalLabel.textContent = `${total.toLocaleString()} facilities`;
  if (sSummaryDate) sSummaryDate.textContent = serverLastUpdated ? `Latest Harvest: ${serverLastUpdated} KST(UTC+9)` : `Latest Harvest: Live Synced`;
}

function toggleSmelterDashboardFilter(colIdx, tagVal) {
  if (!smelterMultiSelectFilters[colIdx]) smelterMultiSelectFilters[colIdx] = new Set();
  
  if (smelterMultiSelectFilters[colIdx].has(tagVal)) {
    smelterMultiSelectFilters[colIdx].delete(tagVal);
  } else {
    smelterMultiSelectFilters[colIdx].add(tagVal);
  }

  const dd = document.getElementById(`smelterMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => {
      if (c.value) c.checked = smelterMultiSelectFilters[colIdx].has(c.value);
    });
    const chkAll = document.getElementById(`smelterChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = (smelterMultiSelectFilters[colIdx].size === 0);
  }

  const msText = document.getElementById(`smelterMsText_${colIdx}`);
  if (msText) {
    const cnt = smelterMultiSelectFilters[colIdx].size;
    msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  }

  document.querySelectorAll(`.insight-chip[data-col="${colIdx}"]`).forEach(chip => {
    const tVal = chip.getAttribute('data-tag');
    chip.classList.toggle('active', smelterMultiSelectFilters[colIdx].has(tVal));
  });

  smelterCurrentPage = 1;
  filterSmelterTableRows();
}

/* =========================================================================
   테이블 헤더 매핑 & 가로 스크롤 완전 제거 (11개 열 풀-뷰)
   ========================================================================= */
function buildDisplayColumnMap() {
  const getIdx = (keywords) => {
    return consolidatedHeaderStore.findIndex(h => {
      const clean = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return keywords.some(k => clean.includes(k));
    });
  };

  const noIdx = 0;
  const srcIdx = getIdx(['source']);
  const metalIdx = getIdx(['metal']);
  const idIdx = getIdx(['smelterid', 'cid']);
  const countryIdx = getIdx(['country']);
  const rmapIdx = getIdx(['rmap', 'status']);
  const auditIdx = getIdx(['lastaudit', 'audit', 'cycle']);
  const revIdx = getIdx(['revision', 'history']);
  const refIdx = getIdx(['reference', 'smelterref']);
  const nameIdx = getIdx(['standardsmeltername', 'smeltername', 'name']);

  // Smelter ID 바로 옆에 CAHRA 열 배치
  displayColumnMap = [
    { origIdx: noIdx !== -1 ? noIdx : 0, header: 'No.', widthPct: '4%', isMulti: false },
    { origIdx: srcIdx !== -1 ? srcIdx : 1, header: 'Source', widthPct: '6%', isMulti: true },
    { origIdx: metalIdx !== -1 ? metalIdx : 2, header: 'Metal', widthPct: '6%', isMulti: true },
    { origIdx: idIdx !== -1 ? idIdx : 6, header: 'Smelter ID', widthPct: '8%', isMulti: false },
    { origIdx: 'CAHRA', countryColIdx: countryIdx !== -1 ? countryIdx : 5, header: 'CAHRA', widthPct: '8%', isMulti: true, isCustom: true },
    { origIdx: rmapIdx !== -1 ? rmapIdx : 9, header: 'RMAP Status', widthPct: '8%', isMulti: true },
    { origIdx: auditIdx !== -1 ? auditIdx : 10, header: 'Audit / Cycle / Reaudit', widthPct: '15%', isMulti: false },
    { origIdx: revIdx !== -1 ? revIdx : 11, header: 'Revision History', widthPct: '15%', isMulti: false },
    { origIdx: countryIdx !== -1 ? countryIdx : 5, header: 'Country', widthPct: '8%', isMulti: false },
    { origIdx: refIdx !== -1 ? refIdx : 3, header: 'Smelter Reference', widthPct: '10%', isMulti: false, isEllipsis: true },
    { origIdx: nameIdx !== -1 ? nameIdx : 4, header: 'Standard Smelter Name', widthPct: '12%', isMulti: false, isEllipsis: true }
  ];
}

function renderSmelterViewerTable() {
  const headRow = document.getElementById('smelterTableHeadRow');
  const filterRow = document.getElementById('smelterTableFilterRow');
  const table = document.getElementById('smelterDataTable');
  if (!headRow || !filterRow || !table) return;

  buildDisplayColumnMap();

  table.style.tableLayout = 'fixed';
  table.style.width = '100%';

  const tableContainer = table.parentElement;
  if (tableContainer) {
    tableContainer.style.overflowX = 'hidden';
  }

  let colgroup = table.querySelector('colgroup');
  if (colgroup) colgroup.remove();
  colgroup = document.createElement('colgroup');

  headRow.innerHTML = ''; 
  filterRow.innerHTML = '';
  smelterTableFilters = {};
  smelterMultiSelectFilters = {};

  displayColumnMap.forEach(col => {
    const origIdx = col.origIdx;
    const headerName = col.header || (consolidatedHeaderStore[origIdx] || `Col ${origIdx + 1}`);

    colgroup.innerHTML += `<col style="width:${col.widthPct};">`;
    headRow.innerHTML += `<th style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:8px 6px; text-align:center;" title="${headerName}">${headerName}</th>`;

    if (col.isMulti) {
      smelterMultiSelectFilters[origIdx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th" style="padding:4px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="smelterMsBtn_${origIdx}" onclick="toggleSmelterDropdown('${origIdx}')" style="padding:3px 6px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="smelterMsText_${origIdx}">All</span>
              <span style="font-size:0.55rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="smelterMsDropdown_${origIdx}"></div>
          </div>
        </th>`;
    } else if (origIdx !== 0) {
      filterRow.innerHTML += `
        <th class="filter-th" style="padding:4px;">
          <input type="text" class="filter-input" placeholder="Filter..." oninput="onSmelterFilterChange('${origIdx}', this.value)" style="padding:3px 6px; font-size:0.75rem;">
        </th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th" style="padding:4px;"></th>';
    }
  });

  table.insertBefore(colgroup, table.firstChild);
  populateSmelterDropdownFilters();
  filterSmelterTableRows();
}

function populateSmelterDropdownFilters() {
  Object.keys(smelterMultiSelectFilters).forEach(idxKey => {
    const dd = document.getElementById(`smelterMsDropdown_${idxKey}`);
    if (!dd) return;

    if (idxKey === 'CAHRA') {
      let html = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_CAHRA" checked onchange="selectAllSmelterDropdown('CAHRA', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
      html += `<label class="multiselect-item"><input type="checkbox" value="CAHRA" onchange="toggleSmelterDropdownItem('CAHRA', 'CAHRA', this.checked)"> <span class="text-cahra-red">CAHRA</span></label>`;
      html += `<label class="multiselect-item"><input type="checkbox" value="Non-CAHRA" onchange="toggleSmelterDropdownItem('CAHRA', 'Non-CAHRA', this.checked)"> <span class="text-neutral-cell">Non-CAHRA</span></label>`;
      dd.innerHTML = html;
      return;
    }

    const idx = parseInt(idxKey, 10);
    const unique = [...new Set(consolidatedDataStore.map(r => String(r[idx] || '').trim()).filter(v => v && v !== '-'))].sort();
    let html = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_${idx}" checked onchange="selectAllSmelterDropdown(${idx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
    unique.forEach(val => {
      html += `<label class="multiselect-item"><input type="checkbox" value="${val}" onchange="toggleSmelterDropdownItem(${idx}, '${val}', this.checked)"> <span>${val}</span></label>`;
    });
    dd.innerHTML = html;
  });
}

function toggleSmelterDropdown(idx) {
  const dd = document.getElementById(`smelterMsDropdown_${idx}`);
  const btn = document.getElementById(`smelterMsBtn_${idx}`);
  if (!dd || !btn) return;
  const isShow = dd.classList.toggle('show');
  if (isShow) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${Math.min(rect.left, window.innerWidth - 250)}px`;
  }
}

function selectAllSmelterDropdown(idx, chk) {
  smelterMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#smelterMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`smelterMsText_${idx}`);
  if (msText) msText.textContent = 'All';

  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(chip => chip.classList.remove('active'));

  smelterCurrentPage = 1;
  filterSmelterTableRows();
}

function toggleSmelterDropdownItem(idx, val, checked) {
  if (checked) smelterMultiSelectFilters[idx].add(val); else smelterMultiSelectFilters[idx].delete(val);
  const cnt = smelterMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`smelterChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  const msText = document.getElementById(`smelterMsText_${idx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;

  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(chip => {
    const tVal = chip.getAttribute('data-tag');
    chip.classList.toggle('active', smelterMultiSelectFilters[idx].has(tVal));
  });

  smelterCurrentPage = 1;
  filterSmelterTableRows();
}

function onSmelterFilterChange(origIdx, val) {
  smelterTableFilters[origIdx] = val.toLowerCase().trim();
  smelterCurrentPage = 1;
  clearTimeout(smelterFilterDebounceTimer);
  smelterFilterDebounceTimer = setTimeout(filterSmelterTableRows, 150);
}

/* =========================================================================
   필터링 및 렌더링
   ========================================================================= */
function filterSmelterTableRows() {
  smelterFilteredIndices = [];
  const countryColIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || '')));
  const safeCountryIdx = countryColIdx !== -1 ? countryColIdx : 5;

  consolidatedDataStore.forEach((row, rIdx) => {
    const isCahra = isCahraCountry(row[safeCountryIdx]);
    const cahraTag = isCahra ? 'CAHRA' : 'Non-CAHRA';

    for (const [origIdxKey, kw] of Object.entries(smelterTableFilters)) {
      if (!kw) continue;
      if (origIdxKey === 'CAHRA') {
        if (!cahraTag.toLowerCase().includes(kw)) return;
      } else {
        const idx = parseInt(origIdxKey, 10);
        if (!String(row[idx] || '').toLowerCase().includes(kw)) return;
      }
    }

    for (const [origIdxKey, selectedSet] of Object.entries(smelterMultiSelectFilters)) {
      if (selectedSet.size === 0) continue;
      if (origIdxKey === 'CAHRA') {
        if (!selectedSet.has(cahraTag)) return;
      } else {
        const idx = parseInt(origIdxKey, 10);
        if (!selectedSet.has(String(row[idx] || '').trim())) return;
      }
    }

    smelterFilteredIndices.push(rIdx);
  });

  renderSmelterCurrentPage();
}

function renderSmelterCurrentPage() {
  const tbody = document.getElementById('smelterTableDataBody');
  if (!tbody) return;

  const totalMatches = smelterFilteredIndices.length;
  const totalPages = Math.ceil(totalMatches / smelterPageSize) || 1;

  if (smelterCurrentPage > totalPages) smelterCurrentPage = totalPages;
  if (smelterCurrentPage < 1) smelterCurrentPage = 1;

  const start = (smelterCurrentPage - 1) * smelterPageSize;
  const end = Math.min(start + smelterPageSize, totalMatches);
  let html = '';

  const countryColIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || '')));
  const safeCountryIdx = countryColIdx !== -1 ? countryColIdx : 5;

  for (let i = start; i < end; i++) {
    const realIdx = smelterFilteredIndices[i];
    const row = consolidatedDataStore[realIdx];
    const isCahra = isCahraCountry(row[safeCountryIdx]);

    html += '<tr>';
    displayColumnMap.forEach(col => {
      const origIdx = col.origIdx;

      // 1. CAHRA 전용 열 렌더링
      if (col.isCustom && origIdx === 'CAHRA') {
        if (isCahra) {
          html += `<td style="text-align:center; padding:6px 4px;"><span class="text-cahra-red">CAHRA</span></td>`;
        } else {
          html += `<td style="text-align:center; padding:6px 4px;"><span class="text-neutral-cell">Non-CAHRA</span></td>`;
        }
        return;
      }

      const sVal = String(row[origIdx] || '');

      // 2. No. 열
      if (origIdx === 0) {
        html += `<td style="text-align:center; font-weight:600; color:#64748b; padding:6px 4px; font-size:0.8rem;">${i + 1}</td>`;
      } 
      // 3. RMAP Status 열
      else if (origIdx === 9) {
        if (sVal === 'Conformant') {
          html += `<td style="text-align:center; padding:6px 4px;"><span class="text-conformant-green">${sVal}</span></td>`;
        } else {
          html += `<td style="text-align:center; padding:6px 4px;"><span class="text-neutral-cell">${sVal || '-'}</span></td>`;
        }
      } 
      // 4. 기타 일반 열
      else if (col.isEllipsis) {
        html += `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${sVal}">${sVal || '-'}</td>`;
      } else {
        html += `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${sVal}">${sVal || '-'}</td>`;
      }
    });
    html += '</tr>';
  }

  tbody.innerHTML = html || `<tr><td colspan="${displayColumnMap.length}" style="text-align:center; padding:24px; color:#94a3b8;">No matching smelter records found.</td></tr>`;
  
  const badge = document.getElementById('smelterViewerBadgeCount');
  if (badge) badge.textContent = `Showing ${totalMatches.toLocaleString()} of ${consolidatedDataStore.length.toLocaleString()} facilities`;

  const pInfo = document.getElementById('smelterPageInfoDisplay');
  if (pInfo) pInfo.textContent = `Page ${smelterCurrentPage} of ${totalPages}`;
  const btnPrev = document.getElementById('btnSmelterPrevPage');
  if (btnPrev) btnPrev.disabled = (smelterCurrentPage <= 1);
  const btnNext = document.getElementById('btnSmelterNextPage');
  if (btnNext) btnNext.disabled = (smelterCurrentPage >= totalPages);
}

function goToSmelterPage(p) { smelterCurrentPage = p; renderSmelterCurrentPage(); }
function changeSmelterPageSize(s) { smelterPageSize = parseInt(s, 10); smelterCurrentPage = 1; renderSmelterCurrentPage(); }

function resetSmelterFilters() {
  document.querySelectorAll('#smelterTableFilterRow .filter-input').forEach(inp => inp.value = '');
  smelterTableFilters = {};
  Object.keys(smelterMultiSelectFilters).forEach(idx => {
    const chkAll = document.getElementById(`smelterChkAll_${idx}`);
    if (chkAll) selectAllSmelterDropdown(idx, chkAll);
  });
  document.querySelectorAll('.insight-chip').forEach(chip => chip.classList.remove('active'));
  smelterCurrentPage = 1;
  filterSmelterTableRows();
}

/* =========================================================================
   백업 및 엑셀 내보내기 (CAHRA Status 포함)
   ========================================================================= */
async function executeSmelterBackup() {
  const btn = document.getElementById('btnBackupDriveSmelter');
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey) return;
  btn.textContent = '⏳ Backing up...'; btn.disabled = true;

  try {
    const resp = await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'backup_drive' })
    });
    const res = await resp.json();
    if (res?.status === 'success') {
      if (confirm(`Backup created successfully!\nFile: ${res.fileName}\n\nOpen backup sheet?`)) window.open(res.url, '_blank');
    } else alert('Backup failed.');
  } catch(e) { alert('Backup error.'); }
  finally { btn.textContent = '☁️ Backup'; btn.disabled = false; }
}

async function exportSmelterExcel() {
  if (!smelterFilteredIndices.length || !window.ExcelJS) return;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Smelter Log", { views: [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }] });
  
  const headersWithCahra = [
    'No.', 'Source', 'Metal', 'Smelter Reference', 'Standard Smelter Name', 
    'Country', 'Smelter ID', 'CAHRA Status', 'City', 'State Province', 'RMAP Status', 
    'Last audit / Cycle / Reaudit In Progress', 'Revision History'
  ];
  const widths = [8, 10, 12, 22, 26, 16, 13, 14, 14, 16, 14, 34, 38];

  ws.columns = headersWithCahra.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] || 15 }));
  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  const countryColIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || '')));
  const safeCountryIdx = countryColIdx !== -1 ? countryColIdx : 5;

  smelterFilteredIndices.forEach((realIdx, rowNum) => {
    const r = consolidatedDataStore[realIdx];
    const isCahra = isCahraCountry(r[safeCountryIdx]);
    const cahraLabel = isCahra ? 'CAHRA' : 'Non-CAHRA';

    const exportRow = [
      rowNum + 1, r[1], r[2], r[3], r[4], r[5], r[6], cahraLabel, r[7], r[8], r[9], r[10], r[11]
    ];
    ws.addRow(exportRow);
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headersWithCahra.length } };
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `RMI_Smelter_CAHRA_Sync_${dateStr}.xlsx`);
}

/* =========================================================================
   로컬 파일 수동 파싱 및 업로드
   ========================================================================= */
function identifySmelterFileType(fn) {
  const u = fn.toUpperCase();
  if (u.startsWith('CMRT')) return 'CMRT';
  if (u.startsWith('EMRT')) return 'EMRT';
  if (u.startsWith('AMRT')) return 'AMRT';
  if (u.includes('REVISION')) return 'REVISIONS';
  if (u.includes('ACTIVE')) return 'ACTIVE';
  if (u.includes('CONFORMANT')) return 'CONFORMANT';
  return 'UNKNOWN';
}

function updateSmelterCardStatus() {
  const matched = {};
  smelterFilesToProcess.forEach(f => { const t = identifySmelterFileType(f.name); if (t !== 'UNKNOWN') matched[t] = f; });
  ['CMRT', 'EMRT', 'AMRT', 'REVISIONS', 'ACTIVE', 'CONFORMANT'].forEach(t => {
    const badge = document.getElementById(`badge-${t}`), label = document.getElementById(`name-${t}`), box = document.getElementById(`item-${t}`);
    if (badge && label && box) {
      if (matched[t]) {
        badge.textContent = 'Uploaded'; badge.className = 'file-badge badge-ready';
        label.textContent = `${matched[t].name} (${(matched[t].size / 1024).toFixed(1)} KB)`;
        box.classList.add('ready');
      } else {
        badge.textContent = 'Not uploaded yet'; badge.className = 'file-badge badge-missing';
        label.textContent = 'Waiting for file...';
        box.classList.remove('ready');
      }
    }
  });
}

function confirmResetAllSmelterFiles() {
  if (confirm("Clear all selected files?")) {
    smelterFilesToProcess = [];
    const fInp = document.getElementById('fileInput');
    if (fInp) fInp.value = '';
    const fCnt = document.getElementById('fileCount');
    if (fCnt) fCnt.textContent = 'No files selected';
    const pBtn = document.getElementById('processBtn');
    if (pBtn) pBtn.disabled = true;
    updateSmelterCardStatus();
  }
}

function parseExcelXml(xmlDoc) {
  const rowNodes = Array.from(xmlDoc.getElementsByTagName('*')).filter(n => n.localName?.toLowerCase() === 'row');
  const grid = [];
  rowNodes.forEach(row => {
    const rowData = [];
    let colIdx = 0;
    for (let child of row.children) {
      if (child.localName?.toLowerCase() === 'cell') {
        const idxAttr = child.getAttribute('ss:Index') || child.getAttribute('Index') || child.getAttributeNS('urn:schemas-microsoft-com:office:spreadsheet', 'Index');
        if (idxAttr) colIdx = parseInt(idxAttr, 10) - 1;
        const dataElem = Array.from(child.children).find(c => c.localName?.toLowerCase() === 'data');
        rowData[colIdx] = dataElem ? dataElem.textContent.trim() : child.textContent.trim();
        colIdx++;
      }
    }
    if (rowData.some(v => v !== undefined && v !== '')) grid.push(rowData);
  });
  return grid;
}

function findColIndex(headers, keywords) {
  for (let i = 0; i < headers.length; i++) {
    if (!headers[i]) continue;
    const cleanH = headers[i].toLowerCase().replace(/[^a-z0-9]/g, '');
    if (keywords.some(kw => cleanH.includes(kw.toLowerCase().replace(/[^a-z0-9]/g, '')))) return i;
  }
  return -1;
}

async function processSmelterFiles() {
  const parser = new DOMParser();
  const baseRows = [], conformantMap = new Map(), activeSet = new Set(), revisionsMap = new Map();

  for (const file of smelterFilesToProcess) {
    try {
      const text = await file.text();
      const grid = parseExcelXml(parser.parseFromString(text, "text/xml"));
      if (grid.length < 2) continue;
      const [headers, ...dataRows] = grid;
      const type = identifySmelterFileType(file.name);

      if (['CMRT', 'EMRT', 'AMRT'].includes(type)) {
        const [mIdx, refIdx, nIdx, cIdx, idIdx, cityIdx, stIdx] = [
          findColIndex(headers, ['metal']), findColIndex(headers, ['smelterreference', 'reference']),
          findColIndex(headers, ['standardsmeltername', 'smeltername']), findColIndex(headers, ['country']),
          findColIndex(headers, ['smelterid', 'cid']), findColIndex(headers, ['city']),
          findColIndex(headers, ['stateprovince', 'state', 'province'])
        ];
        dataRows.forEach(r => baseRows.push({
          type, metal: r[mIdx] || '', smelterRef: r[refIdx] || '', smelterName: r[nIdx] || '',
          country: r[cIdx] || '', smelterId: String(r[idIdx] || '').trim(), city: r[cityIdx] || '', state: r[stIdx] || ''
        }));
      } else if (type === 'CONFORMANT') {
        const [idIdx, dIdx, cyIdx, reIdx] = [findColIndex(headers, ['smelterid', 'cid']), findColIndex(headers, ['lastaudit', 'auditdate']), findColIndex(headers, ['cycle', 'auditcycle']), findColIndex(headers, ['reaudit', 'status'])];
        dataRows.forEach(r => { const id = String(r[idIdx] || '').trim(); if (id) conformantMap.set(id, { lastAudit: String(r[dIdx] || '').substring(0,10), cycle: String(r[cyIdx] || '').trim(), reaudit: String(r[reIdx] || '').trim() }); });
      } else if (type === 'ACTIVE') {
        const idIdx = findColIndex(headers, ['smelterid', 'cid']);
        dataRows.forEach(r => { const id = String(r[idIdx] || '').trim(); if (id) activeSet.add(id); });
      } else if (type === 'REVISIONS') {
        const [mIdx, idIdx, nIdx, cIdx, bIdx, detIdx, revDIdx] = [findColIndex(headers, ['metal']), findColIndex(headers, ['smelterid', 'cid']), findColIndex(headers, ['standardsmeltername', 'smeltername']), findColIndex(headers, ['country']), findColIndex(headers, ['basisforrevision', 'basis']), findColIndex(headers, ['details', 'comments', 'history']), findColIndex(headers, ['revisiondate', 'date'])];
        dataRows.forEach(r => {
          const id = String(r[idIdx] || '').trim();
          const basis = String(r[bIdx] || '').trim(), details = String(r[detIdx] || '').trim();
          const info = basis ? (details ? `${basis}: ${details}` : basis) : details;
          const revDate = String(r[revDIdx] || '').substring(0,10);
          if (id && (!revisionsMap.has(id) || revDate >= revisionsMap.get(id).date)) revisionsMap.set(id, { metal: r[mIdx] || '', name: r[nIdx] || '', country: r[cIdx] || '', info: info || '', date: revDate });
        });
      }
    } catch(e) {}
  }

  if (!baseRows.length && !revisionsMap.size) return;
  consolidatedDataStore = [];
  const processedIds = new Set();
  let rowNumber = 1;

  baseRows.forEach(item => {
    const sId = item.smelterId;
    let rmapStatus = '-', auditInfo = '';
    if (sId && conformantMap.has(sId)) {
      rmapStatus = 'Conformant';
      const c = conformantMap.get(sId);
      auditInfo = `${c.lastAudit || ''} / ${c.cycle || ''} / ${c.reaudit || 'No'}`;
    } else if (sId && activeSet.has(sId)) rmapStatus = 'Active';

    const revHistory = (sId && revisionsMap.has(sId)) ? revisionsMap.get(sId).info : '';
    consolidatedDataStore.push([rowNumber++, item.type, item.metal, item.smelterRef, item.smelterName, item.country, item.smelterId, item.city, item.state, rmapStatus, auditInfo, revHistory]);
    if (sId) processedIds.add(sId);
  });

  revisionsMap.forEach((revVal, revId) => {
    if (!processedIds.has(revId)) {
      consolidatedDataStore.push([rowNumber++, 'REVISION', revVal.metal, '', revVal.name, revVal.country, revId, '', '', 'Removed', '', revVal.info || 'Removed']);
      processedIds.add(revId);
    }
  });

  renderSmelterVisualDashboard(consolidatedDataStore);
  renderSmelterViewerTable();
}

async function saveSmelterToGoogleSheets() {
  if (!consolidatedDataStore.length) return alert('No consolidated data to save.');
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey) return;

  const btn = document.getElementById('btnSaveCloud');
  const orgText = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '⏳ Saving...'; btn.disabled = true; }

  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(consolidatedDataStore.length / CHUNK_SIZE);
  const kstTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date()).replace(/\. /g, '-').replace('.', '');

  try {
    for (let i = 0; i < totalChunks; i++) {
      if (btn) btn.innerHTML = `⏳ Saving (${i + 1}/${totalChunks})...`;
      const chunkRows = consolidatedDataStore.slice(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, consolidatedDataStore.length));
      await fetch(URL_SMELTER, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          auth: authKey,
          action: 'save_smelters_chunk',
          isFirstChunk: (i === 0),
          lastUpdated: kstTime,
          headers: (i === 0) ? consolidatedHeaderStore : [],
          rows: chunkRows
        })
      });
    }

    smelterCurrentLastUpdated = kstTime;
    await saveSmelterToDB(consolidatedHeaderStore, consolidatedDataStore, smelterCurrentLastUpdated);
    const sDate = document.getElementById('smelterSummaryUpdateDate');
    if (sDate) sDate.textContent = `Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)`;

    if (btn) {
      btn.innerHTML = '✓ Saved!';
      setTimeout(() => { btn.innerHTML = orgText; btn.disabled = false; }, 1500);
    }
  } catch(err) {
    alert('Error saving to Google Sheets.');
    if (btn) { btn.innerHTML = orgText; btn.disabled = false; }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const fInput = document.getElementById('fileInput');
  if (fInput) {
    fInput.addEventListener('change', e => {
      smelterFilesToProcess = Array.from(e.target.files);
      const fCount = document.getElementById('fileCount');
      if (fCount) fCount.textContent = `${smelterFilesToProcess.length} file(s) selected`;
      const pBtn = document.getElementById('processBtn');
      if (pBtn) pBtn.disabled = smelterFilesToProcess.length === 0;
      updateSmelterCardStatus();
    });
  }
});
