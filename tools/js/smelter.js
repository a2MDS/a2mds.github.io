/* =========================================================================
   SMELTER & FACILITY LOG MODULE (Optimized & Synchronized Architecture)
   ========================================================================= */
const URL_SMELTER = 'https://script.google.com/macros/s/AKfycbwKKRk2-NKSnSnVfb1cGrMkHGgxx5J5iHognV4AAR1ZGZK9fmp9vTcPW5w69MjgGWQRlw/exec';
const SMELTER_DB_NAME = 'a2MDS_SmelterLog_DB';
const CAHRA_CUSTOM_STORAGE_KEY = 'a2mds_smelter_cahra_custom_v3';

let consolidatedDataStore = [];
let smelterTableFilters = {};
let smelterMultiSelectFilters = {};

let consolidatedHeaderStore = [
  'No.', 'Source', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis',
  'Standard Facility Name', 'Country', 'Smelter Reference', 'City',
  'State Province', 'RMAP', 'Audit / Cycle / Reaudit', 'Revision History'
];
let smelterCurrentLastUpdated = '';
let smelterFilterDebounceTimer = null;

let smelterCurrentPage = 1, smelterPageSize = 100;
let smelterFilteredIndices = [], displayColumnMap = [];

let smelterAnalysisRawRows = [], smelterAnalysisFilteredRows = [];
let smelterAnalysisFilters = {}, smelterAnalysisMultiFilters = {};
let activeAnalysisKpiFilterSet = new Set();

// 캐시 및 인덱스 맵
let headerIdxMap = {};
const cahraClassificationCache = new Map();

// =========================================================================
// 0. CAHRA ENGINE & USER-DEFINED CONFIGURATION
// =========================================================================
const DEFAULT_PRESET_EU = [
  'AFGHANISTAN', 'BENIN', 'BURKINA FASO', 'BURUNDI', 'CAMEROON',
  'CENTRAL AFRICAN REPUBLIC', 'COLOMBIA', 'CONGO, DEMOCRATIC REPUBLIC OF THE', 'ERITREA', 'ETHIOPIA', 'HAITI', 'INDIA', 
  'LEBANON', 'LIBYA', 'MALI', 'MEXICO', 'MOZAMBIQUE', 'MYANMAR', 'NIGER', 'NIGERIA', 'PAKISTAN',
  'RUSSIA', 'SOMALIA', 'SOUTH SUDAN', 'SUDAN', 'UKRAINE', 'VENEZUELA', 'YEMEN', 'ZIMBABWE'
];

const DEFAULT_PRESET_US = [
  'CONGO, DEMOCRATIC REPUBLIC OF THE', 'ANGOLA', 'BURUNDI', 'CENTRAL AFRICAN REPUBLIC', 'REPUBLIC OF THE CONGO',
  'RWANDA', 'SOUTH SUDAN', 'TANZANIA', 'UGANDA', 'ZAMBIA'
];

let activeEuCahraSet = new Set(DEFAULT_PRESET_EU);
let activeUsDoddFrankSet = new Set(DEFAULT_PRESET_US);
let activeUserDefinedSet = new Set();
let savedUserDefinedBackupSet = new Set();

function clearCahraCache() {
  cahraClassificationCache.clear();
  if (consolidatedDataStore.length) {
    const cIdx = getColIndex('country');
    consolidatedDataStore.forEach(r => {
      r._cahra = determineCahraClassification(r[cIdx]);
    });
  }
}

function loadSavedCahraConfig() {
  try {
    const raw = localStorage.getItem(CAHRA_CUSTOM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.eu)) activeEuCahraSet = new Set(parsed.eu.map(c => String(c).trim().toUpperCase()));
      if (Array.isArray(parsed.us)) activeUsDoddFrankSet = new Set(parsed.us.map(c => String(c).trim().toUpperCase()));
      if (Array.isArray(parsed.user)) {
        activeUserDefinedSet = new Set(parsed.user.map(c => String(c).trim().toUpperCase()));
        savedUserDefinedBackupSet = new Set(activeUserDefinedSet);
      }
    }
  } catch(e) {}
  clearCahraCache();
}

function saveCahraConfiguration() {
  try {
    const data = {
      eu: Array.from(activeEuCahraSet),
      us: Array.from(activeUsDoddFrankSet),
      user: Array.from(activeUserDefinedSet.size ? activeUserDefinedSet : savedUserDefinedBackupSet)
    };
    localStorage.setItem(CAHRA_CUSTOM_STORAGE_KEY, JSON.stringify(data));
  } catch(e) {}
  closeCahraModal();
  clearCahraCache();
  updateCahraModalUI();
  filterSmelterTableRows();
}

function matchPartialCountry(cleanName, countrySet) {
  if (countrySet.has(cleanName)) return true;
  for (const c of countrySet) {
    if (c && (cleanName.includes(c) || c.includes(cleanName))) return true;
  }
  return false;
}

function determineCahraClassification(countryName) {
  if (!countryName) return '-';
  const clean = String(countryName).trim().toUpperCase();
  if (!clean || clean === '-') return '-';

  if (cahraClassificationCache.has(clean)) {
    return cahraClassificationCache.get(clean);
  }

  let result = '-';
  if (matchPartialCountry(clean, activeUserDefinedSet)) {
    result = 'User-defined';
  } else {
    const isEu = matchPartialCountry(clean, activeEuCahraSet);
    const isUs = matchPartialCountry(clean, activeUsDoddFrankSet);
    if (isEu && isUs) result = 'EU & US';
    else if (isEu) result = 'EU CAHRA';
    else if (isUs) result = 'US Dodd-Frank';
  }

  cahraClassificationCache.set(clean, result);
  return result;
}

const getCahraBadge = status => {
  const map = {
    'User-defined': '<span style="color:#0284c7; font-weight:normal;">User-defined</span>',
    'EU & US': '<span style="color:#dc2626; font-weight:normal;">EU & US</span>',
    'EU CAHRA': '<span style="color:#059669; font-weight:normal;">EU CAHRA</span>',
    'US Dodd-Frank': '<span style="color:#7c3aed; font-weight:normal;">US Dodd-Frank</span>'
  };
  return map[status] || '<span class="text-neutral-cell">-</span>';
};

const getStatusBadge = st => {
  const colors = { 
    Conformant: 'text-conformant-green', 
    Active: 'color:#0284c7; font-weight:500;', 
    Removed: 'text-cahra-red', 
    Identified: 'color:#64748b; font-weight:400;',
    Unmatched: 'color:#dc2626; font-weight:600;' 
  };
  const cls = colors[st];
  return cls ? (cls.includes(':') ? `<span style="${cls}">${st}</span>` : `<span class="${cls}">${st}</span>`) : `<span class="text-neutral-cell">${st || '-'}</span>`;
};

const openCahraModal = () => { updateCahraModalUI(); document.getElementById('cahraModal')?.style.setProperty('display', 'flex'); };
const closeCahraModal = () => document.getElementById('cahraModal')?.style.setProperty('display', 'none');
const openManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'flex');
const closeManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'none');

function updateCahraModalUI() {
  const allUnique = new Set([...activeEuCahraSet, ...activeUsDoddFrankSet, ...activeUserDefinedSet]);
  ['cahraActiveCount', 'btnCahraCountBadge'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = allUnique.size;
  });

  const syncBtn = (btn, isOk) => {
    if (!btn) return;
    btn.classList.toggle('active', isOk);
    const t = btn.querySelector('.preset-title');
    if (t) t.innerHTML = (isOk ? '✓ ' : '') + t.textContent.replace('✓ ', '');
  };

  syncBtn(document.getElementById('btnPresetEu'), DEFAULT_PRESET_EU.every(c => activeEuCahraSet.has(c)));
  syncBtn(document.getElementById('btnPresetUs'), DEFAULT_PRESET_US.every(c => activeUsDoddFrankSet.has(c)));
  syncBtn(document.getElementById('btnPresetUser'), activeUserDefinedSet.size > 0);

  const container = document.getElementById('cahraTagsContainer');
  if (container) {
    const sorted = Array.from(allUnique).sort();
    container.innerHTML = sorted.length ? sorted.map(c => {
      let tagLabel = 'EU';
      if (activeUserDefinedSet.has(c)) tagLabel = 'USER';
      else if (activeEuCahraSet.has(c) && activeUsDoddFrankSet.has(c)) tagLabel = 'EU&US';
      else if (activeUsDoddFrankSet.has(c)) tagLabel = 'US';

      return `
        <span class="cahra-tag-chip">
          <strong>${c}</strong> <small style="color:#64748b; font-size:0.68rem;">[${tagLabel}]</small>
          <span class="tag-del" onclick="removeCustomCahraCountry('${c.replace(/'/g, "\\'")}')">&times;</span>
        </span>`;
    }).join('') : '<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No countries registered.</span>';
  }
}

function toggleCahraPreset(type) {
  if (type === 'EU') {
    // 현재 EU 기본 프리셋이 온전히 다 켜져 있는지 확인
    const isFullyActive = DEFAULT_PRESET_EU.length > 0 && 
                          DEFAULT_PRESET_EU.every(c => activeEuCahraSet.has(c));
    
    if (isFullyActive) {
      // 이미 최신 목록이 다 켜져 있다면 전체 해제
      activeEuCahraSet.clear();
    } else {
      // 켤 때는 과거 캐시를 싹 비우고, 코드에 정의된 최신 국가 목록으로 100% 강제 동기화
      activeEuCahraSet = new Set(DEFAULT_PRESET_EU);
    }
  } else if (type === 'US') {
    // 현재 US 기본 프리셋이 온전히 다 켜져 있는지 확인
    const isFullyActive = DEFAULT_PRESET_US.length > 0 && 
                          DEFAULT_PRESET_US.every(c => activeUsDoddFrankSet.has(c));
    
    if (isFullyActive) {
      // 이미 최신 목록이 다 켜져 있다면 전체 해제
      activeUsDoddFrankSet.clear();
    } else {
      // 켤 때는 과거 캐시를 싹 비우고, 코드에 정의된 최신 국가 목록으로 100% 강제 동기화
      activeUsDoddFrankSet = new Set(DEFAULT_PRESET_US);
    }
  } else if (type === 'USER') {
    if (activeUserDefinedSet.size > 0) {
      savedUserDefinedBackupSet = new Set(activeUserDefinedSet);
      activeUserDefinedSet.clear();
    } else if (savedUserDefinedBackupSet.size > 0) {
      activeUserDefinedSet = new Set(savedUserDefinedBackupSet);
    }
  }
  
  clearCahraCache();
  updateCahraModalUI();
}

function addCahraCountryFromInput() {
  const inp = document.getElementById('inputNewCahraCountry');
  const typeSel = document.getElementById('selectNewCahraType');
  const val = inp?.value.trim().toUpperCase();
  const targetType = typeSel?.value || 'USER';

  if (!val) return;
  if (targetType === 'USER') {
    activeUserDefinedSet.add(val);
    savedUserDefinedBackupSet.add(val);
  } else if (targetType === 'EU') {
    activeEuCahraSet.add(val);
  } else if (targetType === 'US') {
    activeUsDoddFrankSet.add(val);
  } else if (targetType === 'BOTH') {
    activeEuCahraSet.add(val);
    activeUsDoddFrankSet.add(val);
  }

  inp.value = '';
  clearCahraCache();
  updateCahraModalUI();
}

function removeCustomCahraCountry(c) {
  activeEuCahraSet.delete(c);
  activeUsDoddFrankSet.delete(c);
  activeUserDefinedSet.delete(c);
  savedUserDefinedBackupSet.delete(c);
  clearCahraCache();
  updateCahraModalUI();
}

function clearAllCahraCountries() {
  activeEuCahraSet.clear();
  activeUsDoddFrankSet.clear();
  activeUserDefinedSet.clear();
  savedUserDefinedBackupSet.clear();
  clearCahraCache();
  updateCahraModalUI();
}

// =========================================================================
// 1. USEFUL LINKS DATA
// =========================================================================
const SMELTER_USEFUL_LINKS = [
  { no: 1, title: 'CMRT', subTitle: 'Conflict Minerals Reporting Template', desc: 'Industry-standard reporting template for supply chain due diligence on Tantalum, Tin, Tungsten, and Gold (3TG).', url: 'https://www.responsiblemineralsinitiative.org/conflict-minerals-reporting-template/' },
  { no: 2, title: 'EMRT', subTitle: 'Extended Minerals Reporting Template', desc: 'Industry-standard reporting template for supply chain due diligence on Cobalt, Mica, Copper, Lithium, Nickel and Natural Graphite.', url: 'https://www.responsiblemineralsinitiative.org/extended-minerals-reporting-template/' },
  { no: 3, title: 'AMRT', subTitle: 'Additional Minerals Reporting Template', desc: 'Reporting template for minerals not covered by CMRT or EMRT.', url: 'https://www.responsiblemineralsinitiative.org/additional-minerals-reporting-template/' },
  { no: 4, title: 'Smelter Reference Lists', subTitle: 'Master Facilities & Revision History', desc: 'Complete lists of Standard Smelters across CMRT, EMRT and AMRT, including delisted entities.', url: 'https://www.responsiblemineralsinitiative.org/facilities-lists/smelter-reference-lists/' },
  { no: 5, title: 'Eligible Facilities List', subTitle: 'Active & Participating Entities', desc: 'Facilities eligible for RMAP assessment, actively participating, or under evaluation across covered minerals.', url: 'https://www.responsiblemineralsinitiative.org/facilities-lists/eligible-facilities-list/' },
  { no: 6, title: 'Public Facilities List', subTitle: 'Mine, Upstream, Pinch Point & Downstream', desc: 'Consolidated multi-tier facility list provided by RMI, including full supply chain tiers and RMAP assessment audit progress.', url: 'https://www.responsiblemineralsinitiative.org/facilities-lists/public-facilities-list/' }
];

function renderSmelterUsefulLinks() {
  const tbody = document.getElementById('smelterUsefulLinksBody');
  if (!tbody) return;
  tbody.innerHTML = SMELTER_USEFUL_LINKS.map(item => `
    <tr>
      <td style="text-align:center; font-weight:600; color:#64748b; padding:12px 4px; font-size:0.85rem;">${item.no}</td>
      <td style="padding:12px 10px;">
        <strong style="font-size:0.9rem; color:#0f172a;">${item.title}</strong><br>
        <span style="font-size:0.75rem; color:#64748b;">${item.subTitle}</span>
      </td>
      <td style="padding:12px 10px; font-size:0.82rem; color:#334155; line-height:1.6; white-space:normal !important; word-break:keep-all;">${item.desc}</td>
      <td style="text-align:center; padding:12px 4px;">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="link-anchor-btn" style="display:inline-block; padding:5px 10px; border-radius:6px; font-size:0.75rem; font-weight:600;">View Resource ↗</a>
      </td>
    </tr>
  `).join('');
}

// =========================================================================
// 2. UI HELPERS & NORMALIZERS
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
  ['master', 'analysis', 'links'].forEach(t => {
    const isTarget = t === tab;
    const btnId = `btnSmelterTab${t.charAt(0).toUpperCase() + t.slice(1)}`;
    const paneId = `smelterSubPane${t.charAt(0).toUpperCase() + t.slice(1)}`;
    document.getElementById(btnId)?.classList.toggle('active', isTarget);
    document.getElementById(paneId)?.classList.toggle('active', isTarget);
  });
  if (tab === 'analysis') {
    document.getElementById('smelterAnalysisInput')?.focus();
  } else if (tab === 'links') {
    renderSmelterUsefulLinks();
  }
}

function normalizeCellValue(colIdx, val) {
  const s = String(val || '').trim();
  if (!s || s === '-') return '-';
  const lower = s.toLowerCase();
  if (lower === 'in operation') return 'In Operation';
  if (lower === 'pinch point') return 'Pinch Point';
  if (lower === 'downstream') return 'Downstream';
  if (lower === 'upstream') return 'Upstream';
  if (lower === 'mine') return 'Mine';
  return s;
}

const normalizeRmapStatus = s => {
  const str = String(s || '').trim();
  if (!str || str === '-' || /^standard$|^identified$/i.test(str)) return 'Identified';
  if (/conform/i.test(str)) return 'Conformant';
  if (/active|participat/i.test(str)) return 'Active';
  if (/remove/i.test(str)) return 'Removed';
  return str;
};

async function copyTextToClipboard(text, el) {
  if (!text || text === '-' || text === 'Unknown / Not in Master DB') return;
  try {
    await navigator.clipboard.writeText(text);
    if (el) {
      el.classList.add('copy-success');
      setTimeout(() => el.classList.remove('copy-success'), 900);
    }
  } catch(e) {}
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
    rows.forEach((r, i) => {
      const { _norm, _cahra, _rmap, ...cleanRow } = r;
      st.put({ id: i + 1, rowData: cleanRow });
    });
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

function findHeaderColIdx(kws) {
  for (const kw of kws) {
    const cleanKw = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let i = 0; i < consolidatedHeaderStore.length; i++) {
      const h = String(consolidatedHeaderStore[i] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (h.includes(cleanKw)) return i;
    }
  }
  return -1;
}

function buildHeaderIndexMap() {
  headerIdxMap = {
    source: findHeaderColIdx(['source']),
    metal: findHeaderColIdx(['metal']) !== -1 ? findHeaderColIdx(['metal']) : 2,
    cid: findHeaderColIdx(['cid', 'facilityid', 'smelterid']) !== -1 ? findHeaderColIdx(['cid', 'facilityid', 'smelterid']) : 3,
    op: findHeaderColIdx(['facilityoperationalstatus', 'operationstatus', 'operationalstatus', 'operation']) !== -1 ? findHeaderColIdx(['facilityoperationalstatus', 'operationstatus', 'operationalstatus', 'operation']) : 4,
    level: findHeaderColIdx(['supplychainlevel', 'level']) !== -1 ? findHeaderColIdx(['supplychainlevel', 'level']) : 5,
    name: findHeaderColIdx(['standardfacilityname', 'standardsmeltername', 'facilityname', 'smeltername']) !== -1 ? findHeaderColIdx(['standardfacilityname', 'standardsmeltername', 'facilityname', 'smeltername']) : 7,
    country: findHeaderColIdx(['countrylocation', 'country']) !== -1 ? findHeaderColIdx(['countrylocation', 'country']) : 8,
    ref: findHeaderColIdx(['smelterreference', 'reference']) !== -1 ? findHeaderColIdx(['smelterreference', 'reference']) : 9,
    city: findHeaderColIdx(['city']) !== -1 ? findHeaderColIdx(['city']) : 10,
    state: findHeaderColIdx(['stateprovince', 'state']) !== -1 ? findHeaderColIdx(['stateprovince', 'state']) : 11,
    rmap: findHeaderColIdx(['rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) !== -1 ? findHeaderColIdx(['rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) : 12,
    audit: findHeaderColIdx(['lastaudit', 'audit', 'cycle']) !== -1 ? findHeaderColIdx(['lastaudit', 'audit', 'cycle']) : 13,
    revision: findHeaderColIdx(['revisionhistory', 'revision', 'history']) !== -1 ? findHeaderColIdx(['revisionhistory', 'revision', 'history']) : 14
  };
}

const getColIndex = key => headerIdxMap[key] ?? -1;

function memoizeAndDeduplicateSmelterRows(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return [];
  buildHeaderIndexMap();
  const idCol = getColIndex('cid');
  const cIdx = getColIndex('country');
  const rmapIdx = getColIndex('rmap');

  const seen = new Set(), result = [];
  let no = 1;

  rawRows.forEach(r => {
    const cid = String(r[idCol] || '').trim().toUpperCase();
    if (!cid || cid === '-' || !seen.has(cid)) {
      if (cid && cid !== '-') seen.add(cid);
      const row = Array.isArray(r) ? [...r] : Object.values(r);
      row[0] = no++;
      row._cahra = determineCahraClassification(row[cIdx]);
      row._rmap = normalizeRmapStatus(row[rmapIdx]);
      row._norm = {};
      result.push(row);
    }
  });
  return result;
}

// =========================================================================
// 4. DATA INITIALIZATION & SYNC
// =========================================================================
async function initSmelterModule() {
  loadSavedCahraConfig();
  updateCahraModalUI();
  const cached = await loadSmelterFromDB();
  if (cached?.rows?.length) {
    consolidatedHeaderStore = (cached.headers && cached.headers.length >= 12) ? cached.headers : consolidatedHeaderStore;
    consolidatedDataStore = memoizeAndDeduplicateSmelterRows(cached.rows);
    window.consolidatedDataStore = consolidatedDataStore;
    smelterCurrentLastUpdated = cached.lastUpdated || '';
    renderSmelterViewerTable();
    updateSmelterDashboardCounts();
  } else {
    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) await fetchSmelterData(key);
  }
  renderSmelterUsefulLinks();
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
      consolidatedDataStore = memoizeAndDeduplicateSmelterRows(raw);
      window.consolidatedDataStore = consolidatedDataStore;
      smelterCurrentLastUpdated = res.lastUpdated || '';
      await saveSmelterToDB(consolidatedHeaderStore, raw, smelterCurrentLastUpdated);
      renderSmelterViewerTable();
      updateSmelterDashboardCounts();
    }
    return res;
  } catch(e) { console.error("fetchSmelterData error:", e); }
  finally { if (btn) { btn.textContent = '🔄 Reload'; btn.disabled = false; } }
}

// =========================================================================
// 5. DASHBOARD & MASTER TABLE (OPTIMIZED)
// =========================================================================
function updateSmelterDashboardCounts() {
  const metalIdx = getColIndex('metal');
  const rmapIdx = getColIndex('rmap');

  const rowsForRmap = getSmelterAvailableRows(rmapIdx);
  const statusMap = { Conformant: 0, Active: 0, Identified: 0, Removed: 0 };
  rowsForRmap.forEach(r => {
    const st = r._rmap || normalizeRmapStatus(r[rmapIdx]);
    statusMap[st] !== undefined ? statusMap[st]++ : statusMap.Identified++;
  });
  const totalRmap = rowsForRmap.length || 1;

  const syncBars = (items, prefix) => items.forEach(it => {
    const el = document.getElementById(`${prefix}${it.key}`);
    if (el) el.style.width = `${(it.val / totalRmap) * 100}%`;
  });
  syncBars([
    { key: 'Conformant', val: statusMap.Conformant }, 
    { key: 'Active', val: statusMap.Active }, 
    { key: 'Standard', val: statusMap.Identified }, 
    { key: 'Removed', val: statusMap.Removed }
  ], 'bar');

  const rmapFilterSet = smelterMultiSelectFilters[String(rmapIdx)] || new Set();
  const rmapChipsData = [
    { key: 'Conformant', count: statusMap.Conformant, color: '#16a34a' }, 
    { key: 'Active', count: statusMap.Active, color: '#0284c7' },
    { key: 'Identified', count: statusMap.Identified, color: '#64748b' }, 
    { key: 'Removed', count: statusMap.Removed, color: '#dc2626' }
  ];
  const rmapChipsHtml = rmapChipsData.filter(it => it.count > 0).map(it => `
    <span class="insight-chip tag ${rmapFilterSet.has(it.key) ? 'active' : ''}" data-col="${rmapIdx}" data-tag="${it.key}" onclick="toggleSmelterDashboardFilter(${rmapIdx}, '${it.key}')">
      <span class="legend-dot" style="background:${it.color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${it.key}</strong>
      <span class="insight-chip-badge" style="font-weight:400;">${it.count.toLocaleString()} (${((it.count / totalRmap) * 100).toFixed(1)}%)</span>
    </span>
  `).join('');
  document.getElementById('smelterRmapChipsWrap')?.replaceChildren(document.createRange().createContextualFragment(rmapChipsHtml));
  document.getElementById('rmapTotalLabel')?.replaceChildren(document.createTextNode(`${rowsForRmap.length.toLocaleString()} facilities`));

  const rowsForMetal = getSmelterAvailableRows(metalIdx);
  const metalMap = {};
  rowsForMetal.forEach(r => {
    const m = String(r[metalIdx] || '').trim() || 'Unassigned';
    metalMap[m] = (metalMap[m] || 0) + 1;
  });
  const totalMetal = rowsForMetal.length || 1;

  const sortedMetals = Object.entries(metalMap).sort((a, b) => b[1] - a[1]);
  let mBar = '', mLeg = '';
  const metalFilterSet = smelterMultiSelectFilters[String(metalIdx)] || new Set();
  sortedMetals.forEach(([m, count], idx) => {
    const color = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#0284c7';
    const pct = ((count / totalMetal) * 100).toFixed(1);
    mBar += `<div class="p-segment" style="width:${(count / totalMetal) * 100}%; background:${color};" title="${m}: ${count.toLocaleString()} (${pct}%)"></div>`;
    mLeg += `
      <span class="insight-chip tag ${metalFilterSet.has(m) ? 'active' : ''}" data-col="${metalIdx}" data-tag="${m}" onclick="toggleSmelterDashboardFilter(${metalIdx}, '${m.replace(/'/g, "\\'")}')">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong>${m}</strong>
        <span class="insight-chip-badge" style="font-weight:400;">${count.toLocaleString()} (${pct}%)</span>
      </span>`;
  });

  document.getElementById('metalProgressBarWrap')?.replaceChildren(document.createRange().createContextualFragment(mBar));
  document.getElementById('metalLegendGrid')?.replaceChildren(document.createRange().createContextualFragment(mLeg));
  document.getElementById('metalTotalLabel')?.replaceChildren(document.createTextNode(`${rowsForMetal.length.toLocaleString()} facilities`));
  document.getElementById('smelterSummaryUpdateDate')?.replaceChildren(document.createTextNode(smelterCurrentLastUpdated ? `Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)` : 'Latest Harvest: Live Synced'));
}

function toggleSmelterDashboardFilter(col, val) {
  const key = String(col);
  if (!smelterMultiSelectFilters[key]) smelterMultiSelectFilters[key] = new Set();
  smelterMultiSelectFilters[key].has(val) ? smelterMultiSelectFilters[key].delete(val) : smelterMultiSelectFilters[key].add(val);

  const dd = document.getElementById(`smelterMsDropdown_${key}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c.value) c.checked = smelterMultiSelectFilters[key].has(c.value); });
    const all = document.getElementById(`smelterChkAll_${key}`); if (all) all.checked = !smelterMultiSelectFilters[key].size;
  }
  const txt = document.getElementById(`smelterMsText_${key}`);
  if (txt) txt.textContent = smelterMultiSelectFilters[key].size ? `${smelterMultiSelectFilters[key].size} selected` : 'All';

  smelterCurrentPage = 1; 
  filterSmelterTableRows();
}

function buildDisplayColumnMap() {
  buildHeaderIndexMap();
  displayColumnMap = [
    { origIdx: 0, header: 'No.', widthPct: '3.5%', isMulti: false },
    { origIdx: getColIndex('source'), header: 'Source', widthPct: '5.5%', isMulti: true },
    { origIdx: getColIndex('metal'), header: 'Metal', widthPct: '6.0%', isMulti: true },
    { origIdx: getColIndex('cid'), header: 'CID', widthPct: '7.5%', isMulti: false, isCid: true },
    { origIdx: getColIndex('op'), header: 'Operation', widthPct: '7.0%', isMulti: true },
    { origIdx: getColIndex('level'), header: 'Level', widthPct: '6.5%', isMulti: true },
    { origIdx: 'CAHRA', countryColIdx: getColIndex('country'), header: 'CAHRA Basis', widthPct: '9.8%', isMulti: true, isCustom: true },
    { origIdx: getColIndex('rmap'), header: 'RMAP', widthPct: '7.0%', isMulti: true },
    { origIdx: getColIndex('audit'), header: 'Audit / Cycle / Reaudit', widthPct: '13.5%', isMulti: false },
    { origIdx: getColIndex('revision'), header: 'Revision History', widthPct: '12.2%', isMulti: false },
    { origIdx: getColIndex('country'), header: 'Country', widthPct: '7.5%', isMulti: false },
    { origIdx: getColIndex('name'), header: 'Standard Facility Name', widthPct: '14.0%', isMulti: false, isEllipsis: true }
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
    hRow.innerHTML += `<th style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:8px 4px; text-align:center;" title="${col.header}">${col.header}</th>`;
    const colKey = String(col.origIdx);
    if (col.isMulti) {
      smelterMultiSelectFilters[colKey] = new Set();
      fRow.innerHTML += `
        <th class="filter-th" style="padding:4px 2px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="smelterMsBtn_${colKey}" onclick="toggleSmelterDropdown('${colKey}')">
              <span class="multiselect-btn-text" id="smelterMsText_${colKey}">All</span>
              <span style="font-size:0.55rem; color:#64748b; margin-left:2px;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="smelterMsDropdown_${colKey}"></div>
          </div>
        </th>`;
    } else if (col.origIdx !== 0) {
      fRow.innerHTML += `<th class="filter-th" style="padding:4px 2px;"><input type="text" class="filter-input" placeholder="Filter..." oninput="onSmelterFilterChange('${colKey}', this.value)" style="padding:3px 4px; font-size:0.72rem;"></th>`;
    } else fRow.innerHTML += '<th class="filter-th" style="padding:4px 2px;"></th>';
  });

  tbl.insertBefore(colgroup, tbl.firstChild);
  filterSmelterTableRows();
}

function getRowCellValue(row, colKey) {
  if (colKey === 'CAHRA') return row._cahra;
  const kInt = parseInt(colKey, 10);
  if (kInt === getColIndex('rmap')) return row._rmap;
  if (!row._norm[kInt]) {
    row._norm[kInt] = normalizeCellValue(kInt, row[kInt]);
  }
  return row._norm[kInt];
}

function matchesCahraCriteria(rowVal, filterSet) {
  if (!filterSet || !filterSet.size) return true;
  for (const selected of filterSet) {
    if (selected === 'US Dodd-Frank') {
      if (rowVal === 'US Dodd-Frank' || rowVal === 'EU & US') return true;
    } else if (selected === 'EU CAHRA') {
      if (rowVal === 'EU CAHRA' || rowVal === 'EU & US') return true;
    } else {
      if (rowVal === selected) return true;
    }
  }
  return false;
}

function getSmelterAvailableRows(excludeKey) {
  const excludeStr = excludeKey !== undefined && excludeKey !== null ? String(excludeKey) : null;
  const filterKeys = Object.entries(smelterTableFilters).filter(([_, kw]) => Boolean(kw));
  const multiKeys = Object.entries(smelterMultiSelectFilters).filter(([k, set]) => k !== excludeStr && set.size > 0);

  return consolidatedDataStore.filter(row => {
    for (const [k, kw] of filterKeys) {
      const target = getRowCellValue(row, k);
      if (!target.toLowerCase().includes(kw)) return false;
    }
    for (const [k, set] of multiKeys) {
      const target = getRowCellValue(row, k);
      if (k === 'CAHRA') {
        if (!matchesCahraCriteria(target, set)) return false;
      } else {
        if (!set.has(target)) return false;
      }
    }
    return true;
  });
}

function populateSingleSmelterDropdown(key) {
  const strKey = String(key);
  const dd = document.getElementById(`smelterMsDropdown_${strKey}`);
  if (!dd) return;

  const availableRows = getSmelterAvailableRows(strKey);

  if (strKey === 'CAHRA') {
    const cahraSet = new Set(availableRows.map(r => r._cahra));
    const currentSet = smelterMultiSelectFilters['CAHRA'] || new Set();
    const allPresets = ['User-defined', 'EU & US', 'EU CAHRA', 'US Dodd-Frank', '-'];

    const itemsHtml = allPresets.filter(p => {
      if (cahraSet.has(p)) return true;
      if (p === 'EU CAHRA' && cahraSet.has('EU & US')) return true;
      if (p === 'US Dodd-Frank' && cahraSet.has('EU & US')) return true;
      return false;
    }).map(p => `
      <label class="multiselect-item">
        <input type="checkbox" value="${p}" ${currentSet.has(p) ? 'checked' : ''} onchange="toggleSmelterDropdownItem('CAHRA', '${p}', this.checked)">
        <span>${getCahraBadge(p)}</span>
      </label>
    `).join('');

    dd.innerHTML = `
      <label class="multiselect-item"><input type="checkbox" id="smelterChkAll_CAHRA" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSmelterDropdown('CAHRA', this)"> <span>(Select All)</span></label>
      <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">
      ${itemsHtml}`;
    return;
  }

  const rawList = availableRows.map(r => getRowCellValue(r, strKey)).filter(v => v && v !== '-');
  const unique = [...new Set(rawList)].sort();
  const currentSet = smelterMultiSelectFilters[strKey] || new Set();
  const validUniqueSet = new Set(unique);

  for (const val of currentSet) {
    if (!validUniqueSet.has(val)) currentSet.delete(val);
  }

  const txt = document.getElementById(`smelterMsText_${strKey}`);
  if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_${strKey}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSmelterDropdown('${strKey}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleSmelterDropdownItem('${strKey}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${v}</span></label>`).join('');
}

function populateSmelterDropdownFilters() {
  Object.keys(smelterMultiSelectFilters).forEach(key => populateSingleSmelterDropdown(key));
}

function toggleSmelterDropdown(idx) {
  const strKey = String(idx);
  const dd = document.getElementById(`smelterMsDropdown_${strKey}`);
  const btn = document.getElementById(`smelterMsBtn_${strKey}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleSmelterDropdown(strKey);
    const r = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    dd.style.top = spaceBelow < 250 ? `${Math.max(10, r.top - 240)}px` : `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    dd.classList.add('show');
  }
}

function selectAllSmelterDropdown(idx, chk) {
  const key = String(idx);
  if (!smelterMultiSelectFilters[key]) smelterMultiSelectFilters[key] = new Set();
  smelterMultiSelectFilters[key].clear();
  
  document.querySelectorAll(`#smelterMsDropdown_${key} input[type="checkbox"]`).forEach(c => { 
    if (c !== chk) c.checked = false; 
  });
  
  const txt = document.getElementById(`smelterMsText_${key}`); 
  if (txt) txt.textContent = 'All';
  document.querySelectorAll(`.insight-chip[data-col="${key}"]`).forEach(c => c.classList.remove('active'));
  
  smelterCurrentPage = 1; 
  filterSmelterTableRows();
}

function toggleSmelterDropdownItem(idx, val, chk) {
  const key = String(idx);
  if (!smelterMultiSelectFilters[key]) smelterMultiSelectFilters[key] = new Set();
  
  chk ? smelterMultiSelectFilters[key].add(val) : smelterMultiSelectFilters[key].delete(val);
  
  const all = document.getElementById(`smelterChkAll_${key}`); 
  if (all) all.checked = !smelterMultiSelectFilters[key].size;
  
  const txt = document.getElementById(`smelterMsText_${key}`); 
  if (txt) txt.textContent = smelterMultiSelectFilters[key].size ? `${smelterMultiSelectFilters[key].size} selected` : 'All';
  
  document.querySelectorAll(`.insight-chip[data-col="${key}"]`).forEach(c => 
    c.classList.toggle('active', smelterMultiSelectFilters[key].has(c.getAttribute('data-tag')))
  );
  
  smelterCurrentPage = 1; 
  filterSmelterTableRows();
}

function onSmelterFilterChange(idx, val) {
  smelterTableFilters[String(idx)] = val.toLowerCase().trim();
  smelterCurrentPage = 1;
  clearTimeout(smelterFilterDebounceTimer);
  smelterFilterDebounceTimer = setTimeout(filterSmelterTableRows, 150);
}

function filterSmelterTableRows() {
  smelterFilteredIndices = [];
  const filterKeys = Object.entries(smelterTableFilters).filter(([_, kw]) => Boolean(kw));
  const multiKeys = Object.entries(smelterMultiSelectFilters).filter(([_, set]) => set.size > 0);

  consolidatedDataStore.forEach((row, rIdx) => {
    for (const [k, kw] of filterKeys) {
      const target = getRowCellValue(row, k);
      if (!target.toLowerCase().includes(kw)) return;
    }
    for (const [k, set] of multiKeys) {
      const target = getRowCellValue(row, k);
      if (k === 'CAHRA') {
        if (!matchesCahraCriteria(target, set)) return;
      } else {
        if (!set.has(target)) return;
      }
    }
    smelterFilteredIndices.push(rIdx);
  });

  populateSmelterDropdownFilters();
  updateSmelterDashboardCounts();
  renderSmelterCurrentPage();
}

function renderSmelterCurrentPage() {
  const tbody = document.getElementById('smelterTableDataBody');
  if (!tbody) return;
  const total = smelterFilteredIndices.length, totalPages = Math.ceil(total / smelterPageSize) || 1;
  smelterCurrentPage = Math.max(1, Math.min(smelterCurrentPage, totalPages));

  const start = (smelterCurrentPage - 1) * smelterPageSize, end = Math.min(start + smelterPageSize, total);
  const rmapIdx = getColIndex('rmap');

  let html = '';
  for (let i = start; i < end; i++) {
    const r = consolidatedDataStore[smelterFilteredIndices[i]];
    html += '<tr>' + displayColumnMap.map(col => {
      const idx = col.origIdx;
      if (col.isCustom && idx === 'CAHRA') {
        return `<td style="text-align:center; padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r._cahra)}</td>`;
      }
      if (idx === 0) return `<td style="text-align:center; font-weight:600; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>`;
      if (idx === rmapIdx) return `<td style="text-align:center; padding:6px 2px;">${getStatusBadge(r._rmap)}</td>`;
      
      const val = getRowCellValue(r, idx);

      if (col.isCid) {
        return `<td style="text-align:center; padding:6px 2px; font-family:'Consolas',monospace;"><span class="clickable-cid" onclick="copyTextToClipboard('${val}', this)" title="Click to copy">${val}</span></td>`;
      }

      return `<td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${val}">${val || '-'}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || `<tr><td colspan="${displayColumnMap.length}" style="text-align:center; padding:24px; color:#94a3b8;">No matching facility records found.</td></tr>`;
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
  Object.keys(smelterMultiSelectFilters).forEach(idx => { 
    smelterMultiSelectFilters[idx].clear();
    const txt = document.getElementById(`smelterMsText_${idx}`);
    if (txt) txt.textContent = 'All';
  });
  document.querySelectorAll('.insight-chip').forEach(c => c.classList.remove('active'));
  smelterCurrentPage = 1; 
  filterSmelterTableRows();
}

// =========================================================================
// 6. CID CHECKER (ANALYSIS ENGINE - SYNCHRONIZED ARCHITECTURE)
// =========================================================================
function clearSmelterAnalysisInput() {
  const inp = document.getElementById('smelterAnalysisInput'); if (inp) inp.value = '';
  document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode('0 IDs detected'));
  document.getElementById('smelterAnalysisResultCard')?.style.setProperty('display', 'none');
  document.getElementById('analysisSubTabBadge')?.style.setProperty('display', 'none');
  smelterAnalysisRawRows = []; smelterAnalysisFilteredRows = []; 
  smelterAnalysisFilters = {}; smelterAnalysisMultiFilters = {}; 
  activeAnalysisKpiFilterSet.clear();
}

function parseSmelterInputIds(text) {
  if (!text) return [];
  const set = new Set(), result = [];
  text.split(/[\r\n\t,; ]+/).map(s => s.trim().toUpperCase()).filter(Boolean).forEach(id => {
    if (!set.has(id)) { 
      set.add(id); 
      result.push(id); 
    }
  });
  return result;
}

function runSmelterAnalysis() {
  const ids = parseSmelterInputIds(document.getElementById('smelterAnalysisInput')?.value.trim());
  document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  if (!ids.length) return alert('Please enter or paste at least one CID (Facility ID).');
  if (!consolidatedDataStore.length) return alert('Master facility data is not loaded yet. Please wait for sync.');

  buildHeaderIndexMap();
  const idIdx = getColIndex('cid');
  const metalIdx = getColIndex('metal');
  const opIdx = getColIndex('op');
  const levelIdx = getColIndex('level');
  const nameIdx = getColIndex('name');
  const cIdx = getColIndex('country');
  const auditIdx = getColIndex('audit');
  const revIdx = getColIndex('revision');

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
      const r = masterMap.get(id);
      const rmap = r._rmap;
      if (rmap === 'Conformant') conformant++; else if (rmap === 'Active') active++; else identified++;
      
      smelterAnalysisRawRows.push({
        metal: r[metalIdx] || '-',
        smelterId: r[idIdx] || id,
        opStatus: getRowCellValue(r, opIdx),
        level: getRowCellValue(r, levelIdx),
        cahra: r._cahra,
        rmapStatus: rmap,
        audit: r[auditIdx] || '-',
        revision: r[revIdx] || '-',
        country: r[cIdx] || '-',
        smelterName: r[nameIdx] || '-'
      });
    } else {
      unmatched++;
      smelterAnalysisRawRows.push({
        metal: '-',
        smelterId: id,
        opStatus: '-',
        level: '-',
        cahra: '-',
        rmapStatus: 'Unmatched',
        audit: '-',
        revision: '-',
        country: '-',
        smelterName: 'Unknown / Not in Master DB'
      });
    }
  });

  activeAnalysisKpiFilterSet.clear();
  renderSmelterAnalysisKpiBar(ids.length, unmatched, matched, conformant, active, identified);

  const badge = document.getElementById('analysisSubTabBadge');
  if (badge) { badge.textContent = smelterAnalysisRawRows.length; badge.style.display = 'inline-flex'; }
  document.getElementById('smelterAnalysisResultCard')?.style.setProperty('display', 'block');

  smelterAnalysisFilters = {};
  smelterAnalysisMultiFilters = { opStatus: new Set(), level: new Set(), cahra: new Set(), rmapStatus: new Set() };
  resetSmelterAnalysisFilterInputs();
  filterSmelterAnalysisRows();
}

function renderSmelterAnalysisKpiBar(total, unmatched, matched, conf, act, ident) {
  const kpiBar = document.getElementById('smelterAnalysisKpiBar');
  if (!kpiBar) return;
  const isAll = !activeAnalysisKpiFilterSet.size;

  const chips = [
    { key: 'ALL', label: '📥 Input IDs:', count: total, active: isAll },
    { key: 'UNMATCHED', label: '❌ Unmatched:', count: unmatched, active: activeAnalysisKpiFilterSet.has('UNMATCHED'), alert: unmatched > 0 },
    { key: 'MATCHED', label: '🎯 Matched:', count: matched, active: activeAnalysisKpiFilterSet.has('MATCHED') },
    { key: 'CONFORMANT', label: '🛡️ Conformant:', count: conf, active: activeAnalysisKpiFilterSet.has('CONFORMANT'), color: '#16a34a' },
    { key: 'ACTIVE', label: '⚡ Active:', count: act, active: activeAnalysisKpiFilterSet.has('ACTIVE'), color: '#0284c7' },
    { key: 'IDENTIFIED', label: '📌 Identified:', count: ident, active: activeAnalysisKpiFilterSet.has('IDENTIFIED') }
  ];

  kpiBar.innerHTML = chips.map(c => `
    <div class="smelter-analysis-kpi-chip insight-chip tag ${c.active ? 'active' : ''}" style="cursor:pointer; ${c.alert && !c.active ? 'border-color:#fca5a5; background:#fef2f2;' : ''}" onclick="toggleAnalysisKpiFilter('${c.key}')">
      <span style="${c.alert && !c.active ? 'color:#dc2626; font-weight:700;' : (c.color && !c.active ? `color:${c.color};` : '')}">${c.label}</span>
      <strong style="${c.alert && !c.active ? 'color:#dc2626;' : (c.color && !c.active ? `color:${c.color};` : '')}">${c.count}</strong>
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
  ['opStatus', 'level', 'cahra', 'rmapStatus'].forEach(k => {
    const txt = document.getElementById(`analysisMsText_${k}`);
    if (txt) txt.textContent = 'All';
    if (smelterAnalysisMultiFilters[k]) smelterAnalysisMultiFilters[k].clear();
  });
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

function toggleAnalysisDropdown(key) {
  const dd = document.getElementById(`analysisMsDropdown_${key}`);
  const btn = document.getElementById(`analysisMsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleAnalysisDropdown(key);
    const r = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    dd.style.top = spaceBelow < 250 ? `${Math.max(10, r.top - 240)}px` : `${r.bottom + 4}px`;
    dd.style.left = `${Math.min(r.left, window.innerWidth - 260)}px`;
    dd.classList.add('show');
  }
}

function populateSingleAnalysisDropdown(key) {
  const dd = document.getElementById(`analysisMsDropdown_${key}`);
  if (!dd) return;

  const currentSet = smelterAnalysisMultiFilters[key] || new Set();

  if (key === 'cahra') {
    const cahraSet = new Set(smelterAnalysisRawRows.map(r => r.cahra));
    const allPresets = ['User-defined', 'EU & US', 'EU CAHRA', 'US Dodd-Frank', '-'];

    const itemsHtml = allPresets.filter(p => {
      if (cahraSet.has(p)) return true;
      if (p === 'EU CAHRA' && cahraSet.has('EU & US')) return true;
      if (p === 'US Dodd-Frank' && cahraSet.has('EU & US')) return true;
      return false;
    }).map(p => `
      <label class="multiselect-item">
        <input type="checkbox" value="${p}" ${currentSet.has(p) ? 'checked' : ''} onchange="toggleAnalysisDropdownItem('cahra', '${p}', this.checked)">
        <span>${getCahraBadge(p)}</span>
      </label>
    `).join('');

    dd.innerHTML = `
      <label class="multiselect-item"><input type="checkbox" id="analysisChkAll_cahra" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAnalysisDropdown('cahra', this)"> <span>(Select All)</span></label>
      <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">
      ${itemsHtml}`;
    return;
  }

  const rawList = smelterAnalysisRawRows.map(r => r[key]).filter(v => v && v !== '-');
  const unique = [...new Set(rawList)].sort();
  const validUniqueSet = new Set(unique);

  for (const val of currentSet) {
    if (!validUniqueSet.has(val)) currentSet.delete(val);
  }

  const txt = document.getElementById(`analysisMsText_${key}`);
  if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="analysisChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAnalysisDropdown('${key}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleAnalysisDropdownItem('${key}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${key === 'rmapStatus' ? getStatusBadge(v) : v}</span></label>`).join('');
}

function selectAllAnalysisDropdown(key, chk) {
  if (!smelterAnalysisMultiFilters[key]) smelterAnalysisMultiFilters[key] = new Set();
  smelterAnalysisMultiFilters[key].clear();

  document.querySelectorAll(`#analysisMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });

  const txt = document.getElementById(`analysisMsText_${key}`);
  if (txt) txt.textContent = 'All';

  filterSmelterAnalysisRows();
}

function toggleAnalysisDropdownItem(key, val, chk) {
  if (!smelterAnalysisMultiFilters[key]) smelterAnalysisMultiFilters[key] = new Set();

  chk ? smelterAnalysisMultiFilters[key].add(val) : smelterAnalysisMultiFilters[key].delete(val);

  const all = document.getElementById(`analysisChkAll_${key}`);
  if (all) all.checked = !smelterAnalysisMultiFilters[key].size;

  const txt = document.getElementById(`analysisMsText_${key}`);
  if (txt) txt.textContent = smelterAnalysisMultiFilters[key].size ? `${smelterAnalysisMultiFilters[key].size} selected` : 'All';

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

    // 1) 텍스트 입력 필터 검증
    const map = { 1: r.metal, 2: r.smelterId, 7: r.audit, 8: r.revision, 9: r.country, 10: r.smelterName };
    for (const [kStr, kw] of Object.entries(smelterAnalysisFilters)) {
      if (!kw) continue;
      const k = parseInt(kStr, 10), val = String(map[k] || '').trim();
      if (!val.toLowerCase().includes(kw.toLowerCase())) return false;
    }

    // 2) 다중 선택 필터 검증 (Operation, Level, CAHRA Basis, RMAP)
    for (const [key, set] of Object.entries(smelterAnalysisMultiFilters)) {
      if (!set || !set.size) continue;
      const val = r[key];
      if (key === 'cahra') {
        if (!matchesCahraCriteria(val, set)) return false;
      } else {
        if (!set.has(val)) return false;
      }
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
    tbody.innerHTML = `<tr><td colspan="11" style="text-align:center; padding:24px; color:#94a3b8;">No matching analysis records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = smelterAnalysisFilteredRows.map((r, i) => `
    <tr>
      <td style="text-align:center; font-weight:600; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.metal}</td>
      <td style="text-align:center; padding:6px 2px; font-family:'Consolas',monospace;"><span class="clickable-cid" onclick="copyTextToClipboard('${r.smelterId}', this)" title="Click to copy">${r.smelterId}</span></td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.opStatus}</td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.level}</td>
      <td style="text-align:center; padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r.cahra)}</td>
      <td style="text-align:center; padding:6px 2px;">${getStatusBadge(r.rmapStatus)}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.audit}">${r.audit}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.revision}">${r.revision}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.country}">${r.country}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.smelterName}">${r.smelterName}</td>
    </tr>
  `).join('');
}

// =========================================================================
// 7. EXPORT & CLIPBOARD COPY ENGINE
// =========================================================================
async function copySmelterAnalysisTable() {
  if (!smelterAnalysisFilteredRows.length) return alert('No analysis records available to copy.');
  const btn = document.getElementById('btnCopySmelterAnalysis'), orgHtml = btn?.innerHTML || '';
  const headers = ['No.', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis', 'RMAP', 'Audit / Cycle / Reaudit', 'Revision History', 'Country', 'Standard Facility Name'];

  let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;"><thead style="background-color:#f1f5f9;"><tr>` +
    headers.map(h => `<th style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:700; color:#0f172a; text-align:center;">${h}</th>`).join('') + `</tr></thead><tbody>`;

  let plainText = headers.join('\t') + '\n';
  smelterAnalysisFilteredRows.forEach((r, i) => {
    const rowBg = i % 2 ? '#fafafa' : '#ffffff';
    let cColor = 'color:#334155;';
    if (r.cahra === 'EU & US') cColor = 'color:#dc2626;';
    else if (r.cahra === 'EU CAHRA') cColor = 'color:#059669;';
    else if (r.cahra === 'US Dodd-Frank') cColor = 'color:#7c3aed;';
    else if (r.cahra === 'User-defined') cColor = 'color:#0284c7;';

    const sColor = r.rmapStatus === 'Conformant' ? 'color:#16a34a; font-weight:600;' : (r.rmapStatus === 'Active' ? 'color:#0284c7; font-weight:600;' : (r.rmapStatus === 'Unmatched' ? 'color:#dc2626; font-weight:600;' : 'color:#334155;'));

    tableHtml += `<tr style="background-color:${rowBg};"><td style="border:1px solid #cbd5e1; text-align:center;">${i + 1}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.metal}</td><td style="border:1px solid #cbd5e1; text-align:center; font-family:monospace; font-weight:600;">${r.smelterId}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.opStatus}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.level}</td><td style="border:1px solid #cbd5e1; text-align:center; ${cColor}">${r.cahra}</td><td style="border:1px solid #cbd5e1; text-align:center; ${sColor}">${r.rmapStatus}</td><td style="border:1px solid #cbd5e1;">${r.audit}</td><td style="border:1px solid #cbd5e1;">${r.revision}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.country}</td><td style="border:1px solid #cbd5e1;">${r.smelterName}</td></tr>`;
    plainText += [i + 1, r.metal, r.smelterId, r.opStatus, r.level, r.cahra, r.rmapStatus, r.audit, r.revision, r.country, r.smelterName].join('\t') + '\n';
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
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Facility Analysis", { views: [{ state: 'frozen', xSplit: 3, ySplit: 1, topLeftCell: 'D2' }] });
  const headers = ['No.', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis', 'RMAP', 'Audit / Cycle / Reaudit', 'Revision History', 'Country', 'Standard Facility Name'];
  const widths = [6, 12, 14, 16, 14, 18, 16, 30, 28, 16, 28];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  ws.getRow(1).eachCell(c => { c.font = { name: "Inter", size: 10, bold: true }; c.alignment = { vertical: "middle", horizontal: "center" }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });
  smelterAnalysisFilteredRows.forEach((r, i) => ws.addRow([i + 1, r.metal, r.smelterId, r.opStatus, r.level, r.cahra, r.rmapStatus, r.audit, r.revision, r.country, r.smelterName]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };

  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `Facility_Analysis_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
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
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Facility Log", { views: [{ state: 'frozen', xSplit: 4, ySplit: 1, topLeftCell: 'E2' }] });
  
  const headers = [
    'No.', 'Source', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis',
    'Standard Facility Name', 'Country', 'Smelter Reference', 'City',
    'State Province', 'RMAP', 'Audit / Cycle / Reaudit', 'Revision History'
  ];
  const widths = [6, 10, 12, 14, 16, 14, 18, 28, 16, 20, 14, 16, 16, 32, 28];

  ws.columns = headers.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] }));
  ws.getRow(1).eachCell(c => { c.font = { name: "Inter", size: 10, bold: true }; c.alignment = { vertical: "middle", horizontal: "center" }; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }; });

  const cIdx = getColIndex('country');

  smelterFilteredIndices.forEach((realIdx, rowNum) => {
    const r = consolidatedDataStore[realIdx];
    ws.addRow([
      rowNum + 1,
      r[getColIndex('source')] || '',
      r[getColIndex('metal')] || '',
      r[getColIndex('cid')] || '',
      getRowCellValue(r, getColIndex('op')),
      getRowCellValue(r, getColIndex('level')),
      r._cahra,
      r[getColIndex('name')] || '',
      r[cIdx] || '',
      r[getColIndex('ref')] || '',
      r[getColIndex('city')] || '',
      r[getColIndex('state')] || '',
      r._rmap,
      r[getColIndex('audit')] || '',
      r[getColIndex('revision')] || ''
    ]);
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: headers.length } };
  saveAs(new Blob([await wb.xlsx.writeBuffer()]), `RMI_Facility_Master_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

// =========================================================================
// 전역 바인딩 (core.js 및 인라인 HTML 이벤트 호환)
// =========================================================================
window.consolidatedDataStore = consolidatedDataStore;
window.initSmelterModule = initSmelterModule;
window.fetchSmelterData = fetchSmelterData;
window.clearSmelterIndexedDB = clearSmelterIndexedDB;
window.toggleSmelterDropdown = toggleSmelterDropdown;
window.selectAllSmelterDropdown = selectAllSmelterDropdown;
window.toggleSmelterDropdownItem = toggleSmelterDropdownItem;
window.onSmelterFilterChange = onSmelterFilterChange;
window.toggleSmelterDashboardFilter = toggleSmelterDashboardFilter;
window.resetSmelterFilters = resetSmelterFilters;
window.switchSmelterSubTab = switchSmelterSubTab;
window.toggleSmelterSummarySection = toggleSmelterSummarySection;
window.openCahraModal = openCahraModal;
window.closeCahraModal = closeCahraModal;
window.toggleCahraPreset = toggleCahraPreset;
window.addCahraCountryFromInput = addCahraCountryFromInput;
window.removeCustomCahraCountry = removeCustomCahraCountry;
window.clearAllCahraCountries = clearAllCahraCountries;
window.saveCahraConfiguration = saveCahraConfiguration;
window.openManualModal = openManualModal;
window.closeManualModal = closeManualModal;
window.clearSmelterAnalysisInput = clearSmelterAnalysisInput;
window.runSmelterAnalysis = runSmelterAnalysis;
window.toggleAnalysisKpiFilter = toggleAnalysisKpiFilter;
window.resetSmelterAnalysisFilter = resetSmelterAnalysisFilter;
window.onAnalysisFilterChange = onAnalysisFilterChange;
window.toggleAnalysisDropdown = toggleAnalysisDropdown;
window.selectAllAnalysisDropdown = selectAllAnalysisDropdown;
window.toggleAnalysisDropdownItem = toggleAnalysisDropdownItem;
window.copySmelterAnalysisTable = copySmelterAnalysisTable;
window.exportSmelterAnalysisExcel = exportSmelterAnalysisExcel;
window.executeSmelterBackup = executeSmelterBackup;
window.exportSmelterExcel = exportSmelterExcel;
window.goToSmelterPage = goToSmelterPage;
window.changeSmelterPageSize = changeSmelterPageSize;
window.copyTextToClipboard = copyTextToClipboard;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('smelterAnalysisInput')?.addEventListener('input', e => {
    const ids = parseSmelterInputIds(e.target.value);
    document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  });
});
