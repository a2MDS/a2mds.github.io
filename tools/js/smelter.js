/* =========================================================================
   SMELTER LOG MODULE (Optimized & Modularized Engine)
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

// Pagination & Mapping
let smelterCurrentPage = 1, smelterPageSize = 100;
let smelterFilteredIndices = [], displayColumnMap = [];

// Analysis State
let smelterAnalysisRawRows = [], smelterAnalysisFilteredRows = [];
let smelterAnalysisFilters = {}, activeAnalysisKpiFilterSet = new Set();

// =========================================================================
// 1. UI HELPERS & SUB-TAB CONTROLLER
// =========================================================================
function toggleSmelterSummarySection() {
  const body = document.getElementById('smelterSummaryBody');
  const icon = document.getElementById('smelterSummaryToggleIcon');
  if (!body) return;
  const isCollapsed = body.style.display === 'none';
  body.style.display = isCollapsed ? 'flex' : 'none';
  if (icon) icon.textContent = isCollapsed ? '▲' : '▼';
}

function switchSmelterSubTab(tab) {
  const isMaster = tab === 'master';
  ['btnSmelterTabMaster', 'smelterSubPaneMaster'].forEach(id => document.getElementById(id)?.classList.toggle('active', isMaster));
  ['btnSmelterTabAnalysis', 'smelterSubPaneAnalysis'].forEach(id => document.getElementById(id)?.classList.toggle('active', !isMaster));
  if (!isMaster) document.getElementById('smelterAnalysisInput')?.focus();
}

const normalizeRmapStatus = s => {
  const str = String(s || '').trim();
  return (!str || str === '-' || str.toLowerCase() === 'standard') ? 'Identified' : str;
};

const getCahraBadge = isCahra => {
  return isCahra 
    ? `<span class="text-cahra-red">CAHRA</span>` 
    : `<span class="text-neutral-cell">Non-CAHRA</span>`;
};

const getStatusBadge = st => {
  const colors = { 
    Conformant: 'text-conformant-green', 
    Active: 'color:#0284c7; font-weight:500;', 
    Removed: 'text-cahra-red', 
    Unmatched: 'color:#dc2626; font-weight:600;' 
  };
  const cls = colors[st];
  return cls ? (cls.includes(':') ? `<span style="${cls}">${st}</span>` : `<span class="${cls}">${st}</span>`) : `<span class="text-neutral-cell">${st || '-'}</span>`;
};

// =========================================================================
// 2. CAHRA PRESETS & DETERMINATION ENGINE
// =========================================================================
const CAHRA_PRESET_EU = [
  'AFGHANISTAN', 'BURKINA FASO', 'BURUNDI', 'CAMEROON', 'CENTRAL AFRICAN REPUBLIC', 'CHAD',
  'COLOMBIA', 'DEMOCRATIC REPUBLIC OF THE CONGO', 'ERITREA', 'ETHIOPIA', 'INDIA', 'LIBYA',
  'MALI', 'MOZAMBIQUE', 'MYANMAR', 'NIGER', 'NIGERIA', 'PAKISTAN', 'PHILIPPINES', 'RUSSIA',
  'SOMALIA', 'SOUTH SUDAN', 'SUDAN', 'TURKEY', 'UKRAINE', 'YEMEN'
];
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
      if (Array.isArray(arr) && arr.length) activeCahraCountrySet = new Set(arr.map(c => String(c).trim().toUpperCase()));
    }
  } catch(e) {}
}

const saveCahraCountriesToStorage = () => localStorage.setItem(CAHRA_STORAGE_KEY, JSON.stringify(Array.from(activeCahraCountrySet)));

function isCahraCountry(name) {
  if (!name) return false;
  const clean = String(name).trim().toUpperCase();
  if (activeCahraCountrySet.has(clean)) return true;
  for (const c of activeCahraCountrySet) if (clean.includes(c) || c.includes(clean)) return true;
  return false;
}

const openCahraModal = () => { updateCahraModalUI(); document.getElementById('cahraModal')?.style.setProperty('display', 'flex'); };
const closeCahraModal = () => document.getElementById('cahraModal')?.style.setProperty('display', 'none');
const openManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'flex');
const closeManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'none');

function updateCahraModalUI() {
  const cnt = activeCahraCountrySet.size;
  ['cahraActiveCount', 'btnCahraCountBadge'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = cnt; });

  const syncBtn = (btn, list) => {
    if (!btn) return;
    const ok = list.every(c => activeCahraCountrySet.has(c));
    btn.classList.toggle('active', ok);
    const t = btn.querySelector('.preset-title');
    if (t) t.innerHTML = (ok ? '✓ ' : '') + t.textContent.replace('✓ ', '');
  };
  syncBtn(document.getElementById('btnPresetEu'), CAHRA_PRESET_EU);
  syncBtn(document.getElementById('btnPresetUs'), CAHRA_PRESET_US);

  const container = document.getElementById('cahraTagsContainer');
  if (container) {
    const sorted = Array.from(activeCahraCountrySet).sort();
    container.innerHTML = sorted.length ? sorted.map(c => `
      <span class="cahra-tag-chip">${c}<span class="tag-del" onclick="removeCahraCountry('${c}')">&times;</span></span>
    `).join('') : '<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No countries selected.</span>';
  }
}

function toggleCahraPreset(type) {
  const [tList, oList] = type === 'EU' ? [CAHRA_PRESET_EU, CAHRA_PRESET_US] : [CAHRA_PRESET_US, CAHRA_PRESET_EU];
  if (tList.every(c => activeCahraCountrySet.has(c))) {
    const oSet = new Set(oList.every(c => activeCahraCountrySet.has(c)) ? oList : []);
    tList.forEach(c => { if (!oSet.has(c)) activeCahraCountrySet.delete(c); });
  } else {
    tList.forEach(c => activeCahraCountrySet.add(c));
  }
  updateCahraModalUI();
}

function addCahraCountryFromInput() {
  const inp = document.getElementById('inputNewCahraCountry');
  const val = inp?.value.trim().toUpperCase();
  if (val) { activeCahraCountrySet.add(val); inp.value = ''; updateCahraModalUI(); }
}
const removeCahraCountry = c => { activeCahraCountrySet.delete(c); updateCahraModalUI(); };
const clearAllCahraCountries = () => { activeCahraCountrySet.clear(); updateCahraModalUI(); };

function saveCahraConfiguration() {
  saveCahraCountriesToStorage();
  closeCahraModal();
  document.getElementById('btnCahraCountBadge')?.replaceChildren(document.createTextNode(activeCahraCountrySet.size));
  filterSmelterTableRows();
}

// =========================================================================
// 3. STORAGE & INDEXEDDB OPERATIONS
// =========================================================================
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
    const st = tx.objectStore('smelters');
    st.clear();
    st.put({ id: 'metadata', headers, lastUpdated });
    rows.forEach((r, i) => st.put({ id: i + 1, rowData: r }));
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
        res({ headers: meta?.headers || [], lastUpdated: meta?.lastUpdated || '', rows: items.filter(i => i.id !== 'metadata').map(i => i.rowData) });
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

function deduplicateSmelterRows(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return [];
  const safeIdIdx = consolidatedHeaderStore.findIndex(h => /smelterid|cid/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /smelterid|cid/i.test(String(h || ''))) : 6;
  const seen = new Set(), result = [];
  let no = 1;
  rawRows.forEach(r => {
    const cid = String(r[safeIdIdx] || '').trim().toUpperCase();
    if (!cid || cid === '-' || !seen.has(cid)) {
      if (cid && cid !== '-') seen.add(cid);
      const row = [...r]; row[0] = no++; result.push(row);
    }
  });
  return result;
}

// =========================================================================
// 4. DATA INITIALIZATION & SYNC
// =========================================================================
async function initSmelterModule() {
  loadSavedCahraCountries();
  document.getElementById('btnCahraCountBadge')?.replaceChildren(document.createTextNode(activeCahraCountrySet.size));
  const cached = await loadSmelterFromDB();
  if (cached?.rows?.length) {
    consolidatedHeaderStore = cached.headers || consolidatedHeaderStore;
    consolidatedDataStore = deduplicateSmelterRows(cached.rows);
    smelterCurrentLastUpdated = cached.lastUpdated || '';
    renderSmelterVisualDashboard(consolidatedDataStore, smelterCurrentLastUpdated);
    renderSmelterViewerTable();
  } else {
    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) fetchSmelterData(key);
  }
}

async function fetchSmelterData(authKey = '', forceReload = false) {
  const key = authKey || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) return;
  const btn = document.getElementById('btnRefreshCloudSmelter');
  if (btn) { btn.textContent = '⏳ Loading...'; btn.disabled = true; }

  try {
    const resp = await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data', clientLastUpdated: forceReload ? '' : smelterCurrentLastUpdated })
    });
    const res = await resp.json();
    if (res?.status === 'not_modified') return res;

    const raw = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    if (res?.headers?.length) consolidatedHeaderStore = res.headers;
    if (raw.length) {
      consolidatedDataStore = deduplicateSmelterRows(raw);
      smelterCurrentLastUpdated = res.lastUpdated || '';
      await saveSmelterToDB(consolidatedHeaderStore, raw, smelterCurrentLastUpdated);
      renderSmelterVisualDashboard(consolidatedDataStore, smelterCurrentLastUpdated);
      renderSmelterViewerTable();
    }
    return res;
  } catch(e) { console.error("fetchSmelterData error:", e); }
  finally { if (btn) { btn.textContent = '🔄 Reload'; btn.disabled = false; } }
}

// =========================================================================
// 5. DASHBOARD & MASTER TABLE RENDERING
// =========================================================================
function renderSmelterVisualDashboard(rows = [], serverDate = '') {
  const typeMap = { CMRT: 0, EMRT: 0, AMRT: 0, REVISION: 0, OTHER: 0 };
  const statusMap = { Conformant: 0, Active: 0, Removed: 0, Identified: 0 };
  const metalMap = {};

  rows.forEach(r => {
    const t = String(r[1] || '').toUpperCase();
    typeMap[t] !== undefined ? typeMap[t]++ : typeMap.OTHER++;
    const st = normalizeRmapStatus(r[9]);
    statusMap[st] !== undefined ? statusMap[st]++ : statusMap.Identified++;
    const m = String(r[2] || '').trim() || 'Unassigned';
    metalMap[m] = (metalMap[m] || 0) + 1;
  });

  const total = rows.length || 1;
  const syncBars = (items, prefix) => items.forEach(it => {
    const el = document.getElementById(`${prefix}${it.key}`);
    if (el) el.style.width = `${(it.val / total) * 100}%`;
  });

  syncBars([{ key: 'Conformant', val: statusMap.Conformant }, { key: 'Active', val: statusMap.Active }, { key: 'Standard', val: statusMap.Identified }, { key: 'Removed', val: statusMap.Removed }], 'bar');
  syncBars([{ key: 'CMRT', val: typeMap.CMRT }, { key: 'EMRT', val: typeMap.EMRT }, { key: 'AMRT', val: typeMap.AMRT }, { key: 'RevType', val: typeMap.REVISION }], 'bar');

  const makeChips = (items, col) => items.filter(it => it.count > 0).map(it => `
    <span class="insight-chip tag ${smelterMultiSelectFilters[col]?.has(it.key) ? 'active' : ''}" data-col="${col}" data-tag="${it.key}" onclick="toggleSmelterDashboardFilter(${col}, '${it.key}')">
      <span class="legend-dot" style="background:${it.color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${it.label || it.key}</strong>
      <span class="insight-chip-badge" style="font-weight:400;">${it.count.toLocaleString()} (${((it.count/total)*100).toFixed(1)}%)</span>
    </span>
  `).join('');

  document.getElementById('smelterRmapChipsWrap')?.replaceChildren(document.createRange().createContextualFragment(makeChips([
    { key: 'Conformant', count: statusMap.Conformant, color: '#16a34a' }, { key: 'Active', count: statusMap.Active, color: '#0284c7' },
    { key: 'Identified', count: statusMap.Identified, color: '#64748b' }, { key: 'Removed', count: statusMap.Removed, color: '#dc2626' }
  ], 9)));

  document.getElementById('smelterSourceChipsWrap')?.replaceChildren(document.createRange().createContextualFragment(makeChips([
    { key: 'CMRT', label: 'CMRT', count: typeMap.CMRT, color: '#16a34a' }, { key: 'EMRT', label: 'EMRT', count: typeMap.EMRT, color: '#0284c7' },
    { key: 'AMRT', label: 'AMRT', count: typeMap.AMRT, color: '#d97706' }, { key: 'REVISION', label: 'Revision', count: typeMap.REVISION, color: '#dc2626' }
  ], 1)));

  const sortedMetals = Object.entries(metalMap).sort((a, b) => b[1] - a[1]);
  let mBar = '', mLeg = '';
  sortedMetals.forEach(([m, count], idx) => {
    const color = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#0284c7';
    mBar += `<div class="p-segment" style="width:${(count/total)*100}%; background:${color};" title="${m}: ${count.toLocaleString()}"></div>`;
    mLeg += `
      <span class="insight-chip tag ${smelterMultiSelectFilters[2]?.has(m) ? 'active' : ''}" data-col="2" data-tag="${m}" onclick="toggleSmelterDashboardFilter(2, '${m.replace(/'/g, "\\'")}')">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${m}</strong>
        <span class="insight-chip-badge" style="font-weight:400;">${count.toLocaleString()}</span>
      </span>`;
  });

  document.getElementById('metalProgressBarWrap')?.replaceChildren(document.createRange().createContextualFragment(mBar));
  document.getElementById('metalLegendGrid')?.replaceChildren(document.createRange().createContextualFragment(mLeg));
  document.getElementById('rmapTotalLabel')?.replaceChildren(document.createTextNode(`${rows.length.toLocaleString()} facilities`));
  document.getElementById('templateTotalLabel')?.replaceChildren(document.createTextNode(`${rows.length.toLocaleString()} total`));
  document.getElementById('metalTotalLabel')?.replaceChildren(document.createTextNode(`${rows.length.toLocaleString()} facilities`));
  document.getElementById('smelterSummaryUpdateDate')?.replaceChildren(document.createTextNode(serverDate ? `Latest Harvest: ${serverDate} KST(UTC+9)` : 'Latest Harvest: Live Synced'));
}

function toggleSmelterDashboardFilter(col, val) {
  if (!smelterMultiSelectFilters[col]) smelterMultiSelectFilters[col] = new Set();
  smelterMultiSelectFilters[col].has(val) ? smelterMultiSelectFilters[col].delete(val) : smelterMultiSelectFilters[col].add(val);

  const dd = document.getElementById(`smelterMsDropdown_${col}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c.value) c.checked = smelterMultiSelectFilters[col].has(c.value); });
    const all = document.getElementById(`smelterChkAll_${col}`); if (all) all.checked = !smelterMultiSelectFilters[col].size;
  }
  const txt = document.getElementById(`smelterMsText_${col}`);
  if (txt) txt.textContent = smelterMultiSelectFilters[col].size ? `${smelterMultiSelectFilters[col].size} selected` : 'All';
  document.querySelectorAll(`.insight-chip[data-col="${col}"]`).forEach(c => c.classList.toggle('active', smelterMultiSelectFilters[col].has(c.getAttribute('data-tag'))));

  smelterCurrentPage = 1; filterSmelterTableRows();
}

function buildDisplayColumnMap() {
  const getIdx = kws => consolidatedHeaderStore.findIndex(h => {
    const c = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return kws.some(k => c.includes(k));
  });
  displayColumnMap = [
    { origIdx: 0, header: 'No.', widthPct: '4%', isMulti: false },
    { origIdx: getIdx(['source']), header: 'Source', widthPct: '6%', isMulti: true },
    { origIdx: getIdx(['metal']), header: 'Metal', widthPct: '6%', isMulti: true },
    { origIdx: getIdx(['smelterid', 'cid']), header: 'Smelter ID', widthPct: '8%', isMulti: false },
    { origIdx: 'CAHRA', countryColIdx: getIdx(['country']), header: 'CAHRA', widthPct: '8%', isMulti: true, isCustom: true },
    { origIdx: getIdx(['rmap', 'status']), header: 'RMAP Status', widthPct: '8%', isMulti: true },
    { origIdx: getIdx(['lastaudit', 'audit', 'cycle']), header: 'Audit / Cycle / Reaudit', widthPct: '18%', isMulti: false },
    { origIdx: getIdx(['revision', 'history']), header: 'Revision History', widthPct: '18%', isMulti: false },
    { origIdx: getIdx(['country']), header: 'Country', widthPct: '9%', isMulti: false },
    { origIdx: getIdx(['standardsmeltername', 'smeltername', 'name']), header: 'Standard Smelter Name', widthPct: '15%', isMulti: false, isEllipsis: true }
  ];
}

function renderSmelterViewerTable() {
  const [hRow, fRow, tbl] = ['smelterTableHeadRow', 'smelterTableFilterRow', 'smelterDataTable'].map(id => document.getElementById(id));
  if (!hRow || !fRow || !tbl) return;
  buildDisplayColumnMap();

  tbl.style.tableLayout = 'fixed'; tbl.style.width = '100%';
  tbl.querySelector('colgroup')?.remove();

  const colgroup = document.createElement('colgroup');
  hRow.innerHTML = ''; fRow.innerHTML = '';
  smelterTableFilters = {}; smelterMultiSelectFilters = {};

  displayColumnMap.forEach(col => {
    colgroup.innerHTML += `<col style="width:${col.widthPct};">`;
    hRow.innerHTML += `<th style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:8px 6px; text-align:center;" title="${col.header}">${col.header}</th>`;
    if (col.isMulti) {
      smelterMultiSelectFilters[col.origIdx] = new Set();
      fRow.innerHTML += `
        <th class="filter-th" style="padding:4px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="smelterMsBtn_${col.origIdx}" onclick="toggleSmelterDropdown('${col.origIdx}')" style="padding:3px 6px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="smelterMsText_${col.origIdx}">All</span>
              <span style="font-size:0.55rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="smelterMsDropdown_${col.origIdx}"></div>
          </div>
        </th>`;
    } else if (col.origIdx !== 0) {
      fRow.innerHTML += `<th class="filter-th" style="padding:4px;"><input type="text" class="filter-input" placeholder="Filter..." oninput="onSmelterFilterChange('${col.origIdx}', this.value)" style="padding:3px 6px; font-size:0.75rem;"></th>`;
    } else fRow.innerHTML += '<th class="filter-th" style="padding:4px;"></th>';
  });

  tbl.insertBefore(colgroup, tbl.firstChild);
  populateSmelterDropdownFilters();
  filterSmelterTableRows();
}

function populateSmelterDropdownFilters() {
  Object.keys(smelterMultiSelectFilters).forEach(key => {
    const dd = document.getElementById(`smelterMsDropdown_${key}`);
    if (!dd) return;
    if (key === 'CAHRA') {
      dd.innerHTML = `
        <label class="multiselect-item"><input type="checkbox" id="smelterChkAll_CAHRA" checked onchange="selectAllSmelterDropdown('CAHRA', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">
        <label class="multiselect-item"><input type="checkbox" value="CAHRA" onchange="toggleSmelterDropdownItem('CAHRA', 'CAHRA', this.checked)"> <span class="text-cahra-red">CAHRA</span></label>
        <label class="multiselect-item"><input type="checkbox" value="Non-CAHRA" onchange="toggleSmelterDropdownItem('CAHRA', 'Non-CAHRA', this.checked)"> <span class="text-neutral-cell">Non-CAHRA</span></label>`;
      return;
    }
    const idx = parseInt(key, 10);
    const unique = [...new Set(consolidatedDataStore.map(r => idx === 9 ? normalizeRmapStatus(r[9]) : String(r[idx] || '').trim()).filter(v => v && v !== '-'))].sort();
    dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_${idx}" checked onchange="selectAllSmelterDropdown(${idx}, this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
      unique.map(v => `<label class="multiselect-item"><input type="checkbox" value="${v}" onchange="toggleSmelterDropdownItem(${idx}, '${v}', this.checked)"> <span>${v}</span></label>`).join('');
  });
}

function toggleSmelterDropdown(idx) {
  const dd = document.getElementById(`smelterMsDropdown_${idx}`);
  const btn = document.getElementById(`smelterMsBtn_${idx}`);
  if (!dd || !btn) return;
  if (dd.classList.toggle('show')) {
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 250)}px`;
  }
}

function selectAllSmelterDropdown(idx, chk) {
  smelterMultiSelectFilters[idx].clear();
  document.querySelectorAll(`#smelterMsDropdown_${idx} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const txt = document.getElementById(`smelterMsText_${idx}`); if (txt) txt.textContent = 'All';
  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(c => c.classList.remove('active'));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

function toggleSmelterDropdownItem(idx, val, chk) {
  chk ? smelterMultiSelectFilters[idx].add(val) : smelterMultiSelectFilters[idx].delete(val);
  const all = document.getElementById(`smelterChkAll_${idx}`); if (all) all.checked = !smelterMultiSelectFilters[idx].size;
  const txt = document.getElementById(`smelterMsText_${idx}`); if (txt) txt.textContent = smelterMultiSelectFilters[idx].size ? `${smelterMultiSelectFilters[idx].size} selected` : 'All';
  document.querySelectorAll(`.insight-chip[data-col="${idx}"]`).forEach(c => c.classList.toggle('active', smelterMultiSelectFilters[idx].has(c.getAttribute('data-tag'))));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

function onSmelterFilterChange(idx, val) {
  smelterTableFilters[idx] = val.toLowerCase().trim();
  smelterCurrentPage = 1;
  clearTimeout(smelterFilterDebounceTimer);
  smelterFilterDebounceTimer = setTimeout(filterSmelterTableRows, 150);
}

function filterSmelterTableRows() {
  smelterFilteredIndices = [];
  const cIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) : 5;

  consolidatedDataStore.forEach((row, rIdx) => {
    const cahra = isCahraCountry(row[cIdx]) ? 'CAHRA' : 'Non-CAHRA';
    const rmap = normalizeRmapStatus(row[9]);

    for (const [k, kw] of Object.entries(smelterTableFilters)) {
      if (!kw) continue;
      const target = k === 'CAHRA' ? cahra : (k === '9' ? rmap : String(row[k] || ''));
      if (!target.toLowerCase().includes(kw)) return;
    }
    for (const [k, set] of Object.entries(smelterMultiSelectFilters)) {
      if (!set.size) continue;
      const target = k === 'CAHRA' ? cahra : (k === '9' ? rmap : String(row[k] || '').trim());
      if (!set.has(target)) return;
    }
    smelterFilteredIndices.push(rIdx);
  });
  renderSmelterCurrentPage();
}

function renderSmelterCurrentPage() {
  const tbody = document.getElementById('smelterTableDataBody');
  if (!tbody) return;
  const total = smelterFilteredIndices.length, totalPages = Math.ceil(total / smelterPageSize) || 1;
  smelterCurrentPage = Math.max(1, Math.min(smelterCurrentPage, totalPages));

  const start = (smelterCurrentPage - 1) * smelterPageSize, end = Math.min(start + smelterPageSize, total);
  const cIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) : 5;

  let html = '';
  for (let i = start; i < end; i++) {
    const r = consolidatedDataStore[smelterFilteredIndices[i]];
    const isCahra = isCahraCountry(r[cIdx]), rmap = normalizeRmapStatus(r[9]);
    html += '<tr>' + displayColumnMap.map(col => {
      const idx = col.origIdx;
      if (col.isCustom && idx === 'CAHRA') return `<td style="text-align:center; padding:6px 4px;">${getCahraBadge(isCahra)}</td>`;
      if (idx === 0) return `<td style="text-align:center; font-weight:600; color:#64748b; padding:6px 4px; font-size:0.8rem;">${i + 1}</td>`;
      if (idx === 9) return `<td style="text-align:center; padding:6px 4px;">${getStatusBadge(rmap)}</td>`;
      const val = String(r[idx] || '');
      return `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${val}">${val || '-'}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || `<tr><td colspan="${displayColumnMap.length}" style="text-align:center; padding:24px; color:#94a3b8;">No matching smelter records found.</td></tr>`;
  document.getElementById('smelterViewerBadgeCount')?.replaceChildren(document.createTextNode(`Showing ${total.toLocaleString()} of ${consolidatedDataStore.length.toLocaleString()} facilities`));
  document.getElementById('smelterPageInfoDisplay')?.replaceChildren(document.createTextNode(`Page ${smelterCurrentPage} of ${totalPages}`));
  const prev = document.getElementById('btnSmelterPrevPage'), next = document.getElementById('btnSmelterNextPage');
  if (prev) prev.disabled = smelterCurrentPage <= 1;
  if (next) next.disabled = smelterCurrentPage >= totalPages;
}

const goToSmelterPage = p => { smelterCurrentPage = p; renderSmelterCurrentPage(); };
const changeSmelterPageSize = s => { smelterPageSize = parseInt(s, 10); smelterCurrentPage = 1; renderSmelterCurrentPage(); };

function resetSmelterFilters() {
  document.querySelectorAll('#smelterTableFilterRow .filter-input').forEach(inp => inp.value = '');
  smelterTableFilters = {};
  Object.keys(smelterMultiSelectFilters).forEach(idx => { const all = document.getElementById(`smelterChkAll_${idx}`); if (all) selectAllSmelterDropdown(idx, all); });
  document.querySelectorAll('.insight-chip').forEach(c => c.classList.remove('active'));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

// =========================================================================
// 6. SMELTER ID CHECKER (ANALYSIS ENGINE)
// =========================================================================
function clearSmelterAnalysisInput() {
  const inp = document.getElementById('smelterAnalysisInput'); if (inp) inp.value = '';
  document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode('0 IDs detected'));
  document.getElementById('smelterAnalysisResultCard')?.style.setProperty('display', 'none');
  document.getElementById('analysisSubTabBadge')?.style.setProperty('display', 'none');
  smelterAnalysisRawRows = []; smelterAnalysisFilteredRows = []; smelterAnalysisFilters = {}; activeAnalysisKpiFilterSet.clear();
}

function parseSmelterInputIds(text) {
  if (!text) return [];
  const set = new Set(), result = [];
  text.split(/[\r\n\t,; ]+/).map(s => s.trim().toUpperCase()).filter(Boolean).forEach(id => {
    if (!set.has(id)) { set.add(id); result.push(id); }
  });
  return result;
}

function runSmelterAnalysis() {
  const ids = parseSmelterInputIds(document.getElementById('smelterAnalysisInput')?.value.trim());
  document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  if (!ids.length) return alert('Please enter or paste at least one Smelter ID.');
  if (!consolidatedDataStore.length) return alert('Master Smelter data is not loaded yet. Please wait for sync.');

  const idIdx = consolidatedHeaderStore.findIndex(h => /smelterid|cid/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /smelterid|cid/i.test(String(h || ''))) : 6;
  const cIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) : 5;

  const masterMap = new Map();
  consolidatedDataStore.forEach(r => {
    const sid = String(r[idIdx] || '').trim().toUpperCase();
    if (sid && !masterMap.has(sid)) masterMap.set(sid, r);
  });

  smelterAnalysisRawRows = [];
  let [matched, unmatched, conformant, active, identified] = [0, 0, 0, 0, 0];

  ids.forEach(id => {
    if (masterMap.has(id)) {
      matched++;
      const r = masterMap.get(id), country = String(r[cIdx] || '').trim(), isCahra = isCahraCountry(country), rmap = normalizeRmapStatus(r[9]);
      if (rmap === 'Conformant') conformant++; else if (rmap === 'Active') active++; else identified++;
      smelterAnalysisRawRows.push({ metal: r[2] || '-', smelterId: r[6] || id, cahra: isCahra ? 'CAHRA' : 'Non-CAHRA', isCahra, rmapStatus: rmap, audit: r[10] || '-', revision: r[11] || '-', country: country || '-', smelterName: r[4] || '-' });
    } else {
      unmatched++;
      smelterAnalysisRawRows.push({ metal: '-', smelterId: id, cahra: '-', isCahra: false, rmapStatus: 'Unmatched', audit: '-', revision: '-', country: '-', smelterName: 'Unknown / Not in Master DB' });
    }
  });

  activeAnalysisKpiFilterSet.clear();
  renderSmelterAnalysisKpiBar(ids.length, unmatched, matched, conformant, active, identified);

  const badge = document.getElementById('analysisSubTabBadge');
  if (badge) { badge.textContent = smelterAnalysisRawRows.length; badge.style.display = 'inline-flex'; }
  document.getElementById('smelterAnalysisResultCard')?.style.setProperty('display', 'block');

  smelterAnalysisFilters = {};
  populateAnalysisDropdowns();
  resetSmelterAnalysisFilterInputs();
  filterSmelterAnalysisRows();
}

function populateAnalysisDropdowns() {
  const syncSelect = (id, set, defaults) => {
    const sel = document.getElementById(id);
    if (sel) sel.innerHTML = '<option value="">All</option>' + defaults.filter(v => set.has(v)).map(v => `<option value="${v}">${v}</option>`).join('');
  };
  syncSelect('analysisFilterCahra', new Set(smelterAnalysisRawRows.map(r => r.cahra)), ['CAHRA', 'Non-CAHRA']);
  syncSelect('analysisFilterStatus', new Set(smelterAnalysisRawRows.map(r => r.rmapStatus)), ['Conformant', 'Active', 'Identified', 'Unmatched']);
}

function renderSmelterAnalysisKpiBar(total, unmatched, matched, conf, act, ident) {
  const kpiBar = document.getElementById('smelterAnalysisKpiBar');
  if (!kpiBar) return;
  const isAll = !activeAnalysisKpiFilterSet.size;

  const chips = [
    { key: 'ALL', label: '📥 Input IDs:', count: total, active: isAll },
    { key: 'UNMATCHED', label: '❌ Unmatched:', count: unmatched, active: activeAnalysisKpiFilterSet.has('UNMATCHED'), alert: unmatched > 0 && !activeAnalysisKpiFilterSet.has('UNMATCHED') },
    { key: 'MATCHED', label: '🎯 Matched:', count: matched, active: activeAnalysisKpiFilterSet.has('MATCHED') },
    { key: 'CONFORMANT', label: '🛡️ Conformant:', count: conf, active: activeAnalysisKpiFilterSet.has('CONFORMANT'), color: '#16a34a' },
    { key: 'ACTIVE', label: '⚡ Active:', count: act, active: activeAnalysisKpiFilterSet.has('ACTIVE'), color: '#0284c7' },
    { key: 'IDENTIFIED', label: '📌 Identified:', count: ident, active: activeAnalysisKpiFilterSet.has('IDENTIFIED') }
  ];

  kpiBar.innerHTML = chips.map(c => `
    <div class="smelter-analysis-kpi-chip insight-chip tag ${c.active ? 'active' : ''}" style="cursor:pointer; ${c.alert ? 'border-color:#fca5a5; background:#fef2f2;' : ''}" onclick="toggleAnalysisKpiFilter('${c.key}')">
      <span style="${c.alert ? 'color:#dc2626;' : (c.color && !c.active ? `color:${c.color};` : '')}">${c.label}</span>
      <strong style="${c.alert ? 'color:#dc2626;' : (c.color && !c.active ? `color:${c.color};` : '')}">${c.count}</strong>
    </div>
  `).join('');
}

function toggleAnalysisKpiFilter(type) {
  if (type === 'ALL') activeAnalysisKpiFilterSet.clear();
  else activeAnalysisKpiFilterSet.has(type) ? activeAnalysisKpiFilterSet.delete(type) : activeAnalysisKpiFilterSet.add(type);

  const getCnt = st => smelterAnalysisRawRows.filter(r => st === 'MATCHED' ? r.rmapStatus !== 'Unmatched' : r.rmapStatus === st).length;
  renderSmelterAnalysisKpiBar(smelterAnalysisRawRows.length, getCnt('Unmatched'), getCnt('MATCHED'), getCnt('Conformant'), getCnt('Active'), getCnt('Identified'));
  filterSmelterAnalysisRows();
}

function resetSmelterAnalysisFilterInputs() {
  document.querySelectorAll('#smelterAnalysisFilterRow .filter-input').forEach(inp => inp.value = '');
  ['analysisFilterCahra', 'analysisFilterStatus'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
}

function resetSmelterAnalysisFilter() {
  resetSmelterAnalysisFilterInputs();
  smelterAnalysisFilters = {};
  activeAnalysisKpiFilterSet.clear();
  const getCnt = st => smelterAnalysisRawRows.filter(r => st === 'MATCHED' ? r.rmapStatus !== 'Unmatched' : r.rmapStatus === st).length;
  renderSmelterAnalysisKpiBar(smelterAnalysisRawRows.length, getCnt('Unmatched'), getCnt('MATCHED'), getCnt('Conformant'), getCnt('Active'), getCnt('Identified'));
  filterSmelterAnalysisRows();
}

function onAnalysisFilterChange(col, val) {
  smelterAnalysisFilters[col] = val.trim();
  filterSmelterAnalysisRows();
}

function filterSmelterAnalysisRows() {
  smelterAnalysisFilteredRows = smelterAnalysisRawRows.filter(r => {
    if (activeAnalysisKpiFilterSet.size) {
      let ok = false;
      if (activeAnalysisKpiFilterSet.has('UNMATCHED') && r.rmapStatus === 'Unmatched') ok = true;
      if (activeAnalysisKpiFilterSet.has('MATCHED') && r.rmapStatus !== 'Unmatched') ok = true;
      if (activeAnalysisKpiFilterSet.has('CONFORMANT') && r.rmapStatus === 'Conformant') ok = true;
      if (activeAnalysisKpiFilterSet.has('ACTIVE') && r.rmapStatus === 'Active') ok = true;
      if (activeAnalysisKpiFilterSet.has('IDENTIFIED') && r.rmapStatus === 'Identified') ok = true;
      if (!ok) return false;
    }

    const map = { 1: r.metal, 2: r.smelterId, 3: r.cahra, 4: r.rmapStatus, 5: r.audit, 6: r.revision, 7: r.country, 8: r.smelterName };
    for (const [kStr, kw] of Object.entries(smelterAnalysisFilters)) {
      if (!kw) continue;
      const k = parseInt(kStr, 10), val = String(map[k] || '').trim();
      if (k === 3 || k === 4) { if (val.toLowerCase() !== kw.toLowerCase()) return false; }
      else if (!val.toLowerCase().includes(kw.toLowerCase())) return false;
    }
    return true;
  });
  renderSmelterAnalysisTable();
}

function renderSmelterAnalysisTable() {
  const tbody = document.getElementById('smelterAnalysisTableBody');
  if (!tbody) return;
  document.getElementById('analysisResultBadge')?.replaceChildren(document.createTextNode(`Showing ${smelterAnalysisFilteredRows.length} of ${smelterAnalysisRawRows.length} records`));

  if (!smelterAnalysisFilteredRows.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No matching analysis records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = smelterAnalysisFilteredRows.map((r, i) => `
    <tr>
      <td style="text-align:center; font-weight:600; color:#64748b; padding:6px 4px; font-size:0.8rem;">${i + 1}</td>
      <td style="text-align:center; padding:6px 4px; font-size:0.8rem;">${r.metal}</td>
      <td style="text-align:center; padding:6px 4px; font-weight:600; font-family:'Consolas',monospace; font-size:0.8rem;">${r.smelterId}</td>
      <td style="text-align:center; padding:6px 4px;">${getCahraBadge(r.isCahra)}</td>
      <td style="text-align:center; padding:6px 4px;">${getStatusBadge(r.rmapStatus)}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${r.audit}">${r.audit}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${r.revision}">${r.revision}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${r.country}">${r.country}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 6px; font-size:0.8rem;" title="${r.smelterName}">${r.smelterName}</td>
    </tr>
  `).join('');
}

// =========================================================================
// 7. EXPORT & CLIPBOARD COPY ENGINE
// =========================================================================
async function copySmelterAnalysisTable() {
  if (!smelterAnalysisFilteredRows.length) return alert('No analysis records available to copy.');
  const btn = document.getElementById('btnCopySmelterAnalysis'), orgHtml = btn?.innerHTML || '';
  const headers = ['No.', 'Metal', 'Smelter ID', 'CAHRA', 'RMAP Status', 'Audit / Cycle / Reaudit', 'Revision History', 'Country', 'Standard Smelter Name'];

  let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;"><thead style="background-color:#f1f5f9;"><tr>` +
    headers.map(h => `<th style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:700; color:#0f172a; text-align:center;">${h}</th>`).join('') + `</tr></thead><tbody>`;

  let plainText = headers.join('\t') + '\n';
  smelterAnalysisFilteredRows.forEach((r, i) => {
    const rowBg = i % 2 ? '#fafafa' : '#ffffff';
    const cColor = r.isCahra ? 'color:#dc2626; font-weight:600;' : 'color:#334155;';
    const sColor = r.rmapStatus === 'Conformant' ? 'color:#16a34a; font-weight:600;' : (r.rmapStatus === 'Active' ? 'color:#0284c7; font-weight:600;' : (r.rmapStatus === 'Unmatched' ? 'color:#dc2626; font-weight:600;' : 'color:#334155;'));

    tableHtml += `<tr style="background-color:${rowBg};"><td style="border:1px solid #cbd5e1; text-align:center;">${i + 1}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.metal}</td><td style="border:1px solid #cbd5e1; text-align:center; font-family:monospace; font-weight:600;">${r.smelterId}</td><td style="border:1px solid #cbd5e1; text-align:center; ${cColor}">${r.cahra}</td><td style="border:1px solid #cbd5e1; text-align:center; ${sColor}">${r.rmapStatus}</td><td style="border:1px solid #cbd5e1;">${r.audit}</td><td style="border:1px solid #cbd5e1;">${r.revision}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.country}</td><td style="border:1px solid #cbd5e1;">${r.smelterName}</td></tr>`;
    plainText += [i + 1, r.metal, r.smelterId, r.cahra, r.rmapStatus, r.audit, r.revision, r.country, r.smelterName].join('\t') + '\n';
  });
  tableHtml += '</tbody></table>';

  try {
    if (navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([tableHtml], { type: 'text/html' }), 'text/plain': new Blob([plainText], { type: 'text/plain' }) })]);
    } else if (navigator.clipboard) await navigator.clipboard.writeText(plainText);
    if (btn) { btn.innerHTML = '✓ Copied!'; btn.style.color = '#16a34a'; setTimeout(() => { btn.innerHTML = orgHtml; btn.style.color = ''; }, 1500); }
  } catch(e) { alert('Failed to copy table to clipboard.'); }
}

async function exportSmelterAnalysisExcel() {
  if (!smelterAnalysisFilteredRows.length || !window.ExcelJS) return alert('No analysis records available to export.');
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Smelter Analysis", { views: [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2' }] });
  const headers = ['No.', 'Metal', 'Smelter ID', 'CAHRA', 'RMAP Status', 'Audit / Cycle / Reaudit', 'Revision History', 'Country', 'Standard Smelter Name'];
  const widths = [8, 12, 16, 14, 16, 32, 36, 18, 30];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  ws.getRow(1).eachCell(c => { c.font = { name: "Inter", size: 10, bold: true }; c.alignment = { vertical: "middle", horizontal: "center" }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });
  smelterAnalysisFilteredRows.forEach((r, i) => ws.addRow([i + 1, r.metal, r.smelterId, r.cahra, r.rmapStatus, r.audit, r.revision, r.country, r.smelterName]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };

  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `Smelter_Analysis_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

async function executeSmelterBackup() {
  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!key) return;
  const btn = document.getElementById('btnBackupDriveSmelter');
  if (btn) { btn.textContent = '⏳ Backing up...'; btn.disabled = true; }

  try {
    const resp = await fetch(URL_SMELTER, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ auth: key, action: 'backup_drive' }) });
    const res = await resp.json();
    if (res?.status === 'success' && confirm(`Backup created: ${res.fileName}\nOpen sheet?`)) window.open(res.url, '_blank');
  } catch(e) { alert('Backup error.'); }
  finally { if (btn) { btn.textContent = '☁️ Backup'; btn.disabled = false; } }
}

async function exportSmelterExcel() {
  if (!smelterFilteredIndices.length || !window.ExcelJS) return;
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Smelter Log", { views: [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }] });
  const headers = ['No.', 'Source', 'Metal', 'Standard Smelter Name', 'Country', 'Smelter ID', 'CAHRA Status', 'City', 'State Province', 'RMAP Status', 'Last audit / Cycle / Reaudit In Progress', 'Revision History'];
  const widths = [8, 10, 12, 28, 16, 14, 14, 14, 16, 14, 34, 38];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  ws.getRow(1).eachCell(c => { c.font = { name: "Inter", size: 10, bold: true }; c.alignment = { vertical: "middle", horizontal: "center" }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });

  const cIdx = consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) !== -1 ? consolidatedHeaderStore.findIndex(h => /country/i.test(String(h || ''))) : 5;
  smelterFilteredIndices.forEach((realIdx, rowNum) => {
    const r = consolidatedDataStore[realIdx];
    ws.addRow([rowNum + 1, r[1], r[2], r[4], r[5], r[6], isCahraCountry(r[cIdx]) ? 'CAHRA' : 'Non-CAHRA', r[7], r[8], normalizeRmapStatus(r[9]), r[10], r[11]]);
  });
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `RMI_Smelter_Master_Unique_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

// =========================================================================
// 8. MANUAL XML PARSING & SHEET SAVE (FALLBACK ENGINE)
// =========================================================================
const identifySmelterFileType = fn => {
  const u = fn.toUpperCase();
  if (u.startsWith('CMRT')) return 'CMRT'; if (u.startsWith('EMRT')) return 'EMRT'; if (u.startsWith('AMRT')) return 'AMRT';
  if (u.includes('REVISION')) return 'REVISIONS'; if (u.includes('ACTIVE')) return 'ACTIVE'; if (u.includes('CONFORMANT')) return 'CONFORMANT';
  return 'UNKNOWN';
};

function updateSmelterCardStatus() {
  const matched = {};
  smelterFilesToProcess.forEach(f => { const t = identifySmelterFileType(f.name); if (t !== 'UNKNOWN') matched[t] = f; });
  ['CMRT', 'EMRT', 'AMRT', 'REVISIONS', 'ACTIVE', 'CONFORMANT'].forEach(t => {
    const [badge, label, box] = [`badge-${t}`, `name-${t}`, `item-${t}`].map(id => document.getElementById(id));
    if (badge && label && box) {
      if (matched[t]) {
        badge.textContent = 'Uploaded'; badge.className = 'file-badge badge-ready';
        label.textContent = `${matched[t].name} (${(matched[t].size / 1024).toFixed(1)} KB)`;
        box.classList.add('ready');
      } else {
        badge.textContent = 'Not uploaded yet'; badge.className = 'file-badge badge-missing';
        label.textContent = 'Waiting for file...'; box.classList.remove('ready');
      }
    }
  });
}

function confirmResetAllSmelterFiles() {
  if (confirm("Clear all selected files?")) {
    smelterFilesToProcess = [];
    const inp = document.getElementById('fileInput'); if (inp) inp.value = '';
    document.getElementById('fileCount')?.replaceChildren(document.createTextNode('No files selected'));
    const btn = document.getElementById('processBtn'); if (btn) btn.disabled = true;
    updateSmelterCardStatus();
  }
}

function parseExcelXml(doc) {
  const rows = Array.from(doc.getElementsByTagName('*')).filter(n => n.localName?.toLowerCase() === 'row');
  return rows.map(r => {
    const data = []; let idx = 0;
    for (let c of r.children) {
      if (c.localName?.toLowerCase() === 'cell') {
        const iAttr = c.getAttribute('ss:Index') || c.getAttribute('Index');
        if (iAttr) idx = parseInt(iAttr, 10) - 1;
        const d = Array.from(c.children).find(el => el.localName?.toLowerCase() === 'data');
        data[idx++] = d ? d.textContent.trim() : c.textContent.trim();
      }
    }
    return data;
  }).filter(r => r.some(v => v !== undefined && v !== ''));
}

const findColIndex = (headers, kws) => headers.findIndex(h => h && kws.some(k => String(h).toLowerCase().replace(/[^a-z0-9]/g, '').includes(k)));

async function processSmelterFiles() {
  const parser = new DOMParser(), baseRows = [], conformantMap = new Map(), activeSet = new Set(), revisionsMap = new Map();
  for (const file of smelterFilesToProcess) {
    try {
      const grid = parseExcelXml(parser.parseFromString(await file.text(), "text/xml"));
      if (grid.length < 2) continue;
      const [h, ...rows] = grid, type = identifySmelterFileType(file.name);

      if (['CMRT', 'EMRT', 'AMRT'].includes(type)) {
        const [mIdx, refIdx, nIdx, cIdx, idIdx, cityIdx, stIdx] = [findColIndex(h, ['metal']), findColIndex(h, ['smelterreference', 'reference']), findColIndex(h, ['standardsmeltername', 'smeltername']), findColIndex(h, ['country']), findColIndex(h, ['smelterid', 'cid']), findColIndex(h, ['city']), findColIndex(h, ['stateprovince', 'state'])];
        rows.forEach(r => baseRows.push({ type, metal: r[mIdx] || '', smelterRef: r[refIdx] || '', smelterName: r[nIdx] || '', country: r[cIdx] || '', smelterId: String(r[idIdx] || '').trim(), city: r[cityIdx] || '', state: r[stIdx] || '' }));
      } else if (type === 'CONFORMANT') {
        const [idIdx, dIdx, cyIdx, reIdx] = [findColIndex(h, ['smelterid', 'cid']), findColIndex(h, ['lastaudit', 'auditdate']), findColIndex(h, ['cycle', 'auditcycle']), findColIndex(h, ['reaudit', 'status'])];
        rows.forEach(r => { const id = String(r[idIdx] || '').trim(); if (id) conformantMap.set(id, { lastAudit: String(r[dIdx] || '').substring(0,10), cycle: String(r[cyIdx] || '').trim(), reaudit: String(r[reIdx] || '').trim() }); });
      } else if (type === 'ACTIVE') {
        const idIdx = findColIndex(h, ['smelterid', 'cid']);
        rows.forEach(r => { const id = String(r[idIdx] || '').trim(); if (id) activeSet.add(id); });
      } else if (type === 'REVISIONS') {
        const [mIdx, idIdx, nIdx, cIdx, bIdx, detIdx, revDIdx] = [findColIndex(h, ['metal']), findColIndex(h, ['smelterid', 'cid']), findColIndex(h, ['standardsmeltername', 'smeltername']), findColIndex(h, ['country']), findColIndex(h, ['basisforrevision', 'basis']), findColIndex(h, ['details', 'comments']), findColIndex(h, ['revisiondate', 'date'])];
        rows.forEach(r => {
          const id = String(r[idIdx] || '').trim(), info = [r[bIdx], r[detIdx]].filter(Boolean).join(': '), date = String(r[revDIdx] || '').substring(0,10);
          if (id && (!revisionsMap.has(id) || date >= revisionsMap.get(id).date)) revisionsMap.set(id, { metal: r[mIdx] || '', name: r[nIdx] || '', country: r[cIdx] || '', info, date });
        });
      }
    } catch(e) {}
  }

  if (!baseRows.length && !revisionsMap.size) return;
  consolidatedDataStore = [];
  const processed = new Set(); let no = 1;

  baseRows.forEach(it => {
    const sId = it.smelterId;
    let rmap = 'Identified', audit = '';
    if (sId && conformantMap.has(sId)) { rmap = 'Conformant'; const c = conformantMap.get(sId); audit = `${c.lastAudit || ''} / ${c.cycle || ''} / ${c.reaudit || 'No'}`; }
    else if (sId && activeSet.has(sId)) rmap = 'Active';
    consolidatedDataStore.push([no++, it.type, it.metal, it.smelterRef, it.smelterName, it.country, it.smelterId, it.city, it.state, rmap, audit, (sId && revisionsMap.get(sId)?.info) || '']);
    if (sId) processed.add(sId);
  });

  revisionsMap.forEach((v, id) => {
    if (!processed.has(id)) { consolidatedDataStore.push([no++, 'REVISION', v.metal, '', v.name, v.country, id, '', '', 'Removed', '', v.info || 'Removed']); processed.add(id); }
  });

  consolidatedDataStore = deduplicateSmelterRows(consolidatedDataStore);
  renderSmelterVisualDashboard(consolidatedDataStore);
  renderSmelterViewerTable();
}

async function saveSmelterToGoogleSheets() {
  if (!consolidatedDataStore.length) return alert('No consolidated data to save.');
  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey) return;
  const btn = document.getElementById('btnSaveCloud'), org = btn?.innerHTML || '';
  if (btn) { btn.innerHTML = '⏳ Saving...'; btn.disabled = true; }

  const CHUNK = 500, total = Math.ceil(consolidatedDataStore.length / CHUNK);
  const now = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date()).replace(/\. /g, '-').replace('.', '');

  try {
    for (let i = 0; i < total; i++) {
      if (btn) btn.innerHTML = `⏳ Saving (${i + 1}/${total})...`;
      await fetch(URL_SMELTER, {
        method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ auth: key, action: 'save_smelters_chunk', isFirstChunk: !i, lastUpdated: now, headers: !i ? consolidatedHeaderStore : [], rows: consolidatedDataStore.slice(i * CHUNK, (i + 1) * CHUNK) })
      });
    }
    smelterCurrentLastUpdated = now;
    await saveSmelterToDB(consolidatedHeaderStore, consolidatedDataStore, smelterCurrentLastUpdated);
    document.getElementById('smelterSummaryUpdateDate')?.replaceChildren(document.createTextNode(`Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)`));
    if (btn) { btn.innerHTML = '✓ Saved!'; setTimeout(() => { btn.innerHTML = org; btn.disabled = false; }, 1500); }
  } catch(e) {
    alert('Error saving to Google Sheets.');
    if (btn) { btn.innerHTML = org; btn.disabled = false; }
  }
}

// =========================================================================
// 9. EVENT LISTENERS
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fileInput')?.addEventListener('change', e => {
    smelterFilesToProcess = Array.from(e.target.files);
    document.getElementById('fileCount')?.replaceChildren(document.createTextNode(`${smelterFilesToProcess.length} file(s) selected`));
    const btn = document.getElementById('processBtn'); if (btn) btn.disabled = !smelterFilesToProcess.length;
    updateSmelterCardStatus();
  });

  document.getElementById('smelterAnalysisInput')?.addEventListener('input', e => {
    const ids = parseSmelterInputIds(e.target.value);
    document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  });
});
