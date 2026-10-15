/* =========================================================================
   SMELTER & FACILITY LOG MODULE (Optimized & Compact Architecture)
   ========================================================================= */
const URL_SMELTER = 'https://script.google.com/macros/s/AKfycbwKKRk2-NKSnSnVfb1cGrMkHGgxx5J5iHognV4AAR1ZGZK9fmp9vTcPW5w69MjgGWQRlw/exec';
const SMELTER_DB_NAME = 'a2MDS_SmelterLog_DB';

// -------------------------------------------------------------------------
// Storage Key & State Managers
// -------------------------------------------------------------------------
const getUserStorageKey = type => {
  const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
  const comp = String(profile?.company || profile?.companyName || profile?.userId || '').trim().toLowerCase().replace(/\s+/g, '_');
  return comp ? `a2mds_smelter_${type}_custom_v5_${comp}` : `a2mds_smelter_${type}_custom_v5_guest`;
};
const getUserSocsStorageKey = () => getUserStorageKey('socs');
const getUserCahraStorageKey = () => getUserStorageKey('cahra');

let consolidatedDataStore = [];
let consolidatedHeaderStore = [
  'No.', 'Source', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis',
  'Standard Facility Name', 'Country', 'Smelter Reference', 'City',
  'State Province', 'DD Status', 'Audit / Cycle / Reaudit'
];
let headerIdxMap = {};
let smelterCurrentLastUpdated = '';
let smelterFilterDebounceTimer = null;
let smelterCurrentPage = 1, smelterPageSize = 100;
let smelterFilteredIndices = [], displayColumnMap = [];
let smelterTableFilters = {}, smelterMultiSelectFilters = {};

// CID Checker State
let smelterAnalysisRawRows = [], smelterAnalysisFilteredRows = [];
let smelterAnalysisFilters = {}, smelterAnalysisMultiFilters = {};
let activeAnalysisKpiFilterSet = new Set();

// Master Data Sets
let masterEuCahraSet = new Set(), masterUsDoddFrankSet = new Set();
let activeEuCahraSet = new Set(), activeUsDoddFrankSet = new Set();
let socMasterHeaders = [], socMasterRows = [];
let activeSocsSet = new Set();
const cahraClassificationCache = new Map();

// User Custom Map & Edit Tracker
let activeUserDefinedCahraMap = new Map(), editingUserCahraCountry = null;
let activeUserDefinedSocsMap = new Map(), editingUserSocCid = null;
let currentCahraMasterViewTab = 'EU';

window.consolidatedDataStore = consolidatedDataStore;

// =========================================================================
// 0. GENERIC USER CONFIGURATION ENGINE (CAHRA & SoCs 통합 관리)
// =========================================================================
const UserConfig = {
  load(map, type) {
    map.clear();
    try {
      const raw = localStorage.getItem(getUserStorageKey(type));
      if (raw) {
        JSON.parse(raw)?.forEach(i => {
          const k = String(i?.country || i?.cid || '').trim().toUpperCase();
          if (k) map.set(k, { userId: String(i.userId || '').trim(), remarks: String(i.remarks || '-').trim(), updated: i.updated || '' });
        });
      }
    } catch(e) {}
  },
  save(map, type) {
    try {
      const arr = Array.from(map.entries()).map(([k, v]) => ({
        [type === 'cahra' ? 'country' : 'cid']: k,
        userId: v.userId, remarks: v.remarks, updated: v.updated
      }));
      localStorage.setItem(getUserStorageKey(type), JSON.stringify(arr));
    } catch(e) {}
  },
  async sync(type, action, map, onSyncPost) {
    this.save(map, type);
    if (onSyncPost) onSyncPost();

    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (!key) return;
    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const items = Array.from(map.entries()).map(([k, v]) => ({
      [type === 'cahra' ? 'country' : 'cid']: k,
      remarks: v.remarks,
      userId: v.userId || String(profile?.userId || 'User').trim()
    }));

    try {
      await fetch(URL_SMELTER, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action, auth: key,
          company: String(profile?.company || profile?.companyName || '').trim(),
          userId: String(profile?.userId || 'User').trim(),
          items
        })
      });
    } catch(e) { console.warn(`Backend ${type} sync error:`, e); }
  },
  exportExcel(map, type, fileNamePrefix, sheetName, extraSheets = []) {
    if (typeof XLSX === 'undefined') return alert('Excel export library is not loaded.');
    if (!map.size && !extraSheets.length) return alert('No records to export.');

    const wb = XLSX.utils.book_new();
    const headers = ['User ID', type === 'cahra' ? 'Country' : 'CID', 'Remarks / Reason', 'Updated (KST)'];
    const rows = Array.from(map.entries()).map(([k, v]) => [v.userId || '-', k, v.remarks || '-', v.updated || '-']);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([headers, ...rows]), sheetName);

    extraSheets.forEach(s => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([s.headers, ...s.rows]), s.sheetName));
    const now = new Date(), y = now.getFullYear(), m = String(now.getMonth() + 1).padStart(2, '0'), d = String(now.getDate()).padStart(2, '0');
    XLSX.writeFile(wb, `${fileNamePrefix}_${y}${m}${d}.xlsx`);
  },
  renderTable(tbodyId, map, editFnName, removeFnName, colAlign = 'left', isMono = false) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    if (!map.size) {
      tbody.innerHTML = `<tr><td colspan="6" class="cell-center" style="padding:16px; color:#94a3b8;">No records registered yet.</td></tr>`;
      return;
    }
    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const compName = String(profile?.company || profile?.companyName || '-').trim();
    const monoStyle = isMono ? "font-family:'Consolas',monospace;" : "";

    tbody.innerHTML = Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([k, data]) => `
      <tr style="border-bottom: 1px solid #f1f5f9;">
        <td class="cell-left cell-ellipsis" style="font-weight:600; color:#1e293b; font-size:0.74rem;" title="${compName}">${compName}</td>
        <td class="cell-center" style="font-weight:500; color:#64748b; font-size:0.74rem;">${data.userId || '-'}</td>
        <td class="cell-${colAlign} cell-ellipsis" style="font-weight:600; color:#0284c7; ${monoStyle}">
          <span class="clickable-cid" onclick="copyTextToClipboard('${k}', this)" title="Click to copy">${k}</span>
        </td>
        <td class="cell-left cell-remarks" title="${data.remarks}">${data.remarks || '-'}</td>
        <td class="cell-center" style="color:#64748b; font-size:0.72rem;">${data.updated || '-'}</td>
        <td class="cell-center" style="white-space:nowrap;">
          <button type="button" class="btn-row-action btn-edit" onclick="${editFnName}('${k.replace(/'/g, "\\'")}')" title="Edit Remarks">✏️</button>
          <button type="button" class="btn-row-action btn-del" onclick="${removeFnName}('${k.replace(/'/g, "\\'")}')" title="Delete">🗑️</button>
        </td>
      </tr>`).join('');
  }
};

// =========================================================================
// 1. CAHRA CLASSIFICATION & CONFIGURATION
// =========================================================================
function clearCahraCache() {
  cahraClassificationCache.clear();
  if (consolidatedDataStore.length) {
    const cIdx = getColIndex('country');
    consolidatedDataStore.forEach(r => { r._cahra = determineCahraClassification(r[cIdx]); });
  }
}

const loadSavedCahraConfig = () => { UserConfig.load(activeUserDefinedCahraMap, 'cahra'); clearCahraCache(); };
const saveUserCahraLocally = () => UserConfig.save(activeUserDefinedCahraMap, 'cahra');
const syncUserCahraToBackend = () => UserConfig.sync('cahra', 'save_user_cahra', activeUserDefinedCahraMap, () => {
  clearCahraCache(); updateCahraModalUI(); filterSmelterTableRows();
});

function processCahraCommonData(rows = []) {
  masterEuCahraSet.clear(); masterUsDoddFrankSet.clear();
  if (Array.isArray(rows)) {
    rows.forEach(item => {
      const type = String(item.type || '').trim().toUpperCase(), c = String(item.country || '').trim().toUpperCase();
      if (!c) return;
      if (type.includes('US') || type.includes('DODD')) masterUsDoddFrankSet.add(c);
      else if (type.includes('EU') || type.includes('CAHRA')) masterEuCahraSet.add(c);
    });
  }
  activeEuCahraSet = new Set(masterEuCahraSet);
  activeUsDoddFrankSet = new Set(masterUsDoddFrankSet);
  clearCahraCache(); updateCahraModalUI();
}

function processUserCahraData(items = []) {
  activeUserDefinedCahraMap.clear();
  const defUid = (typeof getStoredUserProfile === 'function' ? getStoredUserProfile()?.userId : null) || 'User';
  if (Array.isArray(items)) {
    items.forEach(i => {
      const c = String(i.country || '').trim().toUpperCase();
      if (c) activeUserDefinedCahraMap.set(c, { userId: String(i.userId || defUid).trim(), remarks: String(i.remarks || '-').trim(), updated: i.updated || '' });
    });
  }
  saveUserCahraLocally(); clearCahraCache(); updateCahraModalUI();
}

function determineCahraClassification(countryName) {
  if (!countryName) return '-';
  const clean = String(countryName).trim().toUpperCase();
  if (!clean || clean === '-') return '-';
  if (cahraClassificationCache.has(clean)) return cahraClassificationCache.get(clean);

  let res = '-';
  if (activeUserDefinedCahraMap.has(clean)) {
    res = 'User-defined';
  } else {
    const isEu = activeEuCahraSet.has(clean), isUs = activeUsDoddFrankSet.has(clean);
    res = (isEu && isUs) ? 'EU & US' : (isEu ? 'EU CAHRA' : (isUs ? 'US Dodd-Frank' : '-'));
  }
  cahraClassificationCache.set(clean, res);
  return res;
}

const getCahraBadge = st => {
  if (!st || st === '-') return '<span class="text-neutral-cell">-</span>';
  return `<span style="color:#334155;">${st}</span>`;
};

const getStatusBadge = st => {
  if (!st || st === '-') return '<span class="text-neutral-cell">-</span>';
  if (st === 'Conformant') return `<span class="text-conformant-green">${st}</span>`;
  return `<span style="color:#334155;">${st}</span>`;
};

// Modal Open/Close Controls
const openCahraModal = () => { cancelUserCahraEdit(); closeCahraMasterPopover(); updateCahraModalUI(); document.getElementById('cahraModal')?.style.setProperty('display', 'flex'); };
const closeCahraModal = () => { cancelUserCahraEdit(); closeCahraMasterPopover(); document.getElementById('cahraModal')?.style.setProperty('display', 'none'); };
const openSocsModal = () => { cancelUserSocEdit(); renderSocsModalTable(); renderUserSocsModalTable(); document.getElementById('socsModal')?.style.setProperty('display', 'flex'); };
const closeSocsModal = () => { cancelUserSocEdit(); document.getElementById('socsModal')?.style.setProperty('display', 'none'); };
const openManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'flex');
const closeManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'none');

function toggleCahraMasterPopover(tab, btnElem) {
  const popover = document.getElementById('cahraMasterPopover');
  if (!popover) return;
  if (btnElem?.classList.contains('active') && popover.style.display === 'block') { closeCahraMasterPopover(); return; }

  currentCahraMasterViewTab = tab;
  document.querySelectorAll('#cahraModal .cahra-preset-btn').forEach(b => b.classList.remove('active'));
  btnElem?.classList.add('active');

  const isUs = (tab === 'US');
  const label = isUs ? 'US Dodd-Frank' : 'EU CAHRA';
  const titleEl = document.getElementById('cahraPopoverTitle');
  if (titleEl) titleEl.textContent = `${label} Country List (${isUs ? masterUsDoddFrankSet.size : masterEuCahraSet.size})`;

  renderCahraMasterChips();
  popover.style.display = 'block';
}

function closeCahraMasterPopover() {
  const popover = document.getElementById('cahraMasterPopover');
  if (popover) popover.style.display = 'none';
  document.querySelectorAll('#cahraModal .cahra-preset-btn').forEach(b => b.classList.remove('active'));
}

const downloadUserCahraExcel = () => UserConfig.exportExcel(activeUserDefinedCahraMap, 'cahra', 'User_Target_Countries', 'User-Defined Countries');
const renderUserCahraModalTable = () => UserConfig.renderTable('cahraUserTableBody', activeUserDefinedCahraMap, 'editUserCahra', 'removeUserCahraCountry', 'left');

function renderCahraMasterChips() {
  const container = document.getElementById('cahraPresetViewContainer');
  if (!container) return;
  const isUs = (currentCahraMasterViewTab === 'US');
  const targetSet = isUs ? masterUsDoddFrankSet : masterEuCahraSet, label = isUs ? 'US' : 'EU';
  const sorted = Array.from(targetSet).sort();

  container.innerHTML = sorted.length ? sorted.map(c => `
    <span class="cahra-tag-chip" style="background:#f8fafc; border-color:#e2e8f0; cursor:default;">
      <strong>${c}</strong> <small style="color:#64748b; font-size:0.68rem;">[${label}]</small>
    </span>`).join('') : `<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No countries registered in ${label}.</span>`;
}

function updateCahraModalUI() {
  const total = new Set([...masterEuCahraSet, ...masterUsDoddFrankSet, ...activeUserDefinedCahraMap.keys()]).size;
  const b = document.getElementById('btnCahraCountBadge'); if (b) b.textContent = total;
  const u = document.getElementById('cahraUserCount'); if (u) u.textContent = activeUserDefinedCahraMap.size;
  const eu = document.getElementById('lblCahraCountEu'); if (eu) eu.textContent = `EU CAHRA (${masterEuCahraSet.size})`;
  const us = document.getElementById('lblCahraCountUs'); if (us) us.textContent = `US Dodd-Frank (${masterUsDoddFrankSet.size})`;
  renderCahraMasterChips();
  renderUserCahraModalTable();
}

function addCahraCountryFromInput() {
  const countryInp = document.getElementById('inputNewCahraCountry');
  const remarksInp = document.getElementById('inputNewCahraRemarks');
  const feedback = document.getElementById('userCahraFeedbackMsg');
  const rawCountry = countryInp?.value || '';
  const inputRemarks = remarksInp ? remarksInp.value.trim() : '';

  if (!rawCountry.trim()) { if (feedback) feedback.textContent = 'Please enter country name.'; return; }

  const uid = String((typeof getStoredUserProfile === 'function' ? getStoredUserProfile()?.userId : null) || 'User').trim();
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (editingUserCahraCountry) {
    const target = editingUserCahraCountry.toUpperCase();
    activeUserDefinedCahraMap.set(target, { userId: uid, remarks: inputRemarks || '-', updated: now });
    cancelUserCahraEdit();
    syncUserCahraToBackend();
    if (feedback) { feedback.textContent = `Updated ${target} successfully.`; feedback.style.color = '#16a34a'; }
    return;
  }

  let count = 0;
  rawCountry.split(/[\r\n]+/).forEach(l => {
    if (!l.trim()) return;
    const parts = l.split('\t');
    const c = String(parts[0] || '').trim().toUpperCase();
    if (!c) return;
    activeUserDefinedCahraMap.set(c, { userId: uid, remarks: parts[1] ? parts[1].trim() : (inputRemarks || '-'), updated: now });
    count++;
  });

  if (countryInp) countryInp.value = '';
  if (remarksInp) remarksInp.value = '';
  syncUserCahraToBackend();
  if (feedback) { feedback.textContent = `Added ${count} country record(s).`; feedback.style.color = '#16a34a'; }
}

function editUserCahra(country) {
  const data = activeUserDefinedCahraMap.get(country);
  if (!data) return;
  editingUserCahraCountry = country;
  const cInp = document.getElementById('inputNewCahraCountry');
  const rInp = document.getElementById('inputNewCahraRemarks');
  const sBtn = document.getElementById('btnSubmitUserCahra');
  const cBtn = document.getElementById('btnCancelUserCahraEdit');

  if (cInp) { cInp.value = country; cInp.readOnly = true; cInp.style.backgroundColor = '#f1f5f9'; }
  if (rInp) { rInp.value = data.remarks === '-' ? '' : data.remarks; rInp.focus(); }
  if (sBtn) { sBtn.textContent = '✏️ Update'; sBtn.style.backgroundColor = '#0284c7'; }
  if (cBtn) cBtn.style.display = 'inline-block';
}

function cancelUserCahraEdit() {
  editingUserCahraCountry = null;
  const cInp = document.getElementById('inputNewCahraCountry');
  const rInp = document.getElementById('inputNewCahraRemarks');
  const sBtn = document.getElementById('btnSubmitUserCahra');
  const cBtn = document.getElementById('btnCancelUserCahraEdit');

  if (cInp) { cInp.value = ''; cInp.readOnly = false; cInp.style.backgroundColor = '#ffffff'; }
  if (rInp) rInp.value = '';
  if (sBtn) { sBtn.textContent = '+ Add'; sBtn.style.backgroundColor = '#1e293b'; }
  if (cBtn) cBtn.style.display = 'none';
}

function removeUserCahraCountry(c) {
  if (editingUserCahraCountry === c) cancelUserCahraEdit();
  activeUserDefinedCahraMap.delete(c.toUpperCase());
  syncUserCahraToBackend();
}

function clearAllUserCahraCountries() {
  if (!activeUserDefinedCahraMap.size) return;
  cancelUserCahraEdit();
  activeUserDefinedCahraMap.clear();
  syncUserCahraToBackend();
  const feedback = document.getElementById('userCahraFeedbackMsg');
  if (feedback) { feedback.textContent = 'All user-defined countries cleared.'; feedback.style.color = '#dc2626'; }
}

const saveCahraConfiguration = () => { closeCahraModal(); clearCahraCache(); updateCahraModalUI(); filterSmelterTableRows(); };

// =========================================================================
// 2. SoCs (Smelters of Concern) ENGINE
// =========================================================================
const loadSavedUserSocsConfig = () => UserConfig.load(activeUserDefinedSocsMap, 'socs');
const saveUserSocsLocally = () => UserConfig.save(activeUserDefinedSocsMap, 'socs');
const syncUserSocsToBackend = () => UserConfig.sync('socs', 'save_user_socs', activeUserDefinedSocsMap, () => updateMergedSocsSet());

function updateMergedSocsSet() {
  const masterIds = socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean);
  const userIds = Array.from(activeUserDefinedSocsMap.keys());
  activeSocsSet = new Set([...masterIds, ...userIds]);

  const b = document.getElementById('btnSocsCountBadge'); if (b) b.textContent = activeSocsSet.size;
  const cb = document.getElementById('socsModalCountBadge'); if (cb) cb.textContent = `Common: ${socMasterRows.length} | User: ${activeUserDefinedSocsMap.size}`;
  const uc = document.getElementById('socsUserCount'); if (uc) uc.textContent = activeUserDefinedSocsMap.size;

  renderUserSocsModalTable();

  if (consolidatedDataStore.length) {
    const idCol = getColIndex('cid');
    const mSet = new Set(masterIds);
    consolidatedDataStore.forEach(r => {
      const cid = String(r[idCol] || '').trim().toUpperCase();
      r._socs = mSet.has(cid) ? 'Y (Common)' : (activeUserDefinedSocsMap.has(cid) ? 'Y (User)' : '-');
    });
    renderSmelterCurrentPage();
  }

  if (smelterAnalysisRawRows.length) {
    const mSet = new Set(masterIds);
    const mRemarks = new Map(socMasterRows.map(r => [String(r[0] || '').trim().toUpperCase(), String(r[5] || '').trim()]));
    smelterAnalysisRawRows.forEach(r => {
      if (mSet.has(r.smelterId)) {
        r.userSoc = 'Y (Common)'; r.remarks = mRemarks.get(r.smelterId) || '-';
      } else if (activeUserDefinedSocsMap.has(r.smelterId)) {
        r.userSoc = 'Y (User)'; r.remarks = activeUserDefinedSocsMap.get(r.smelterId)?.remarks || '-';
      } else {
        r.userSoc = '-'; r.remarks = '-';
      }
    });
    renderSmelterAnalysisKpiBar();
    filterSmelterAnalysisRows();
  }
}

function addUserSocFromInputs() {
  const cidInp = document.getElementById('inputNewUserSocId');
  const remInp = document.getElementById('inputNewUserSocRemarks');
  const feedback = document.getElementById('userSocFeedbackMsg');
  const rawCid = cidInp?.value.trim() || '';
  const inputRemarks = remInp?.value.trim() || '';

  if (!rawCid) { if (feedback) feedback.textContent = 'Please enter or paste at least one CID.'; return; }

  const uid = String((typeof getStoredUserProfile === 'function' ? getStoredUserProfile()?.userId : null) || 'User').trim();
  const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
  const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

  if (editingUserSocCid) {
    const target = editingUserSocCid.toUpperCase();
    activeUserDefinedSocsMap.set(target, { userId: uid, remarks: inputRemarks || '-', updated: now });
    cancelUserSocEdit();
    syncUserSocsToBackend();
    if (feedback) { feedback.textContent = `Updated ${target} successfully.`; feedback.style.color = '#16a34a'; }
    return;
  }

  let count = 0, skipped = 0;
  rawCid.split(/[\r\n]+/).forEach(l => {
    const parts = l.split('\t');
    const cid = String(parts[0] || '').trim().toUpperCase();
    if (!cid) return;
    if (masterIdsSet.has(cid)) { skipped++; }
    else {
      activeUserDefinedSocsMap.set(cid, { userId: uid, remarks: parts[1] ? parts[1].trim() : (inputRemarks || '-'), updated: now });
      count++;
    }
  });

  if (cidInp) cidInp.value = '';
  if (remInp) remInp.value = '';
  syncUserSocsToBackend();

  let msg = `Saved ${count} CID(s) to User DB.`;
  if (skipped > 0) msg += ` (${skipped} already exist in Common list)`;
  if (feedback) { feedback.textContent = msg; feedback.style.color = count > 0 ? '#16a34a' : '#d97706'; }
}

function editUserSoc(cid) {
  const data = activeUserDefinedSocsMap.get(cid);
  if (!data) return;
  editingUserSocCid = cid;
  const cInp = document.getElementById('inputNewUserSocId');
  const rInp = document.getElementById('inputNewUserSocRemarks');
  const sBtn = document.getElementById('btnSubmitUserSoc');
  const cBtn = document.getElementById('btnCancelUserSocEdit');
  const ind = document.getElementById('userSocEditModeIndicator');

  if (cInp) { cInp.value = cid; cInp.readOnly = true; cInp.style.backgroundColor = '#f1f5f9'; }
  if (rInp) { rInp.value = data.remarks === '-' ? '' : data.remarks; rInp.focus(); }
  if (sBtn) { sBtn.textContent = '✏️ Update'; sBtn.style.backgroundColor = '#0284c7'; }
  if (cBtn) cBtn.style.display = 'inline-block';
  if (ind) ind.style.display = 'inline-block';
}

function cancelUserSocEdit() {
  editingUserSocCid = null;
  const cInp = document.getElementById('inputNewUserSocId');
  const rInp = document.getElementById('inputNewUserSocRemarks');
  const sBtn = document.getElementById('btnSubmitUserSoc');
  const cBtn = document.getElementById('btnCancelUserSocEdit');
  const ind = document.getElementById('userSocEditModeIndicator');

  if (cInp) { cInp.value = ''; cInp.readOnly = false; cInp.style.backgroundColor = '#ffffff'; }
  if (rInp) rInp.value = '';
  if (sBtn) { sBtn.textContent = '+ Add'; sBtn.style.backgroundColor = '#1e293b'; }
  if (cBtn) cBtn.style.display = 'none';
  if (ind) ind.style.display = 'none';
}

function removeUserSoc(id) {
  if (editingUserSocCid === id) cancelUserSocEdit();
  activeUserDefinedSocsMap.delete(id);
  syncUserSocsToBackend();
}

function clearAllUserSocs() {
  if (!activeUserDefinedSocsMap.size) return;
  cancelUserSocEdit();
  activeUserDefinedSocsMap.clear();
  syncUserSocsToBackend();
  const feedback = document.getElementById('userSocFeedbackMsg');
  if (feedback) { feedback.textContent = 'All user-defined CIDs cleared from Cloud DB.'; feedback.style.color = '#dc2626'; }
}

function renderSocsModalTable() {
  const thead = document.getElementById('socsModalTableHead');
  const tbody = document.getElementById('socsModalTableBody');
  if (!thead || !tbody) return;

  const headers = [
    { title: 'CID', align: 'center' }, { title: 'Metal', align: 'left' }, { title: 'Name', align: 'left' },
    { title: 'Country', align: 'left' }, { title: 'Year Identified', align: 'center' }, { title: 'Remarks', align: 'left' }
  ];
  thead.innerHTML = `<tr>${headers.map(h => `<th class="cell-${h.align}" style="padding:6px 6px; font-size:0.76rem; white-space:nowrap;">${h.title}</th>`).join('')}</tr>`;

  if (!socMasterRows.length) {
    tbody.innerHTML = `<tr><td colspan="${headers.length}" class="cell-center" style="padding:16px; color:#94a3b8;">No Smelters of Concern records registered in Common sheet.</td></tr>`;
    return;
  }

  tbody.innerHTML = socMasterRows.map(r => `
    <tr>
      <td class="cell-center" style="padding:5px 4px; font-family:'Consolas',monospace; color:#dc2626;">
        <span class="clickable-cid" onclick="copyTextToClipboard('${r[0]}', this)" title="Click to copy">${r[0] || '-'}</span>
      </td>
      <td class="cell-left" style="padding:5px 8px; font-size:0.76rem;">${r[1] || '-'}</td>
      <td class="cell-left cell-ellipsis" style="padding:5px 8px; font-size:0.76rem;" title="${r[2] || '-'}">${r[2] || '-'}</td>
      <td class="cell-left cell-ellipsis" style="padding:5px 8px; font-size:0.76rem;" title="${r[3] || '-'}">${r[3] || '-'}</td>
      <td class="cell-center" style="padding:5px 4px; font-size:0.76rem; white-space:nowrap;">${r[4] || '-'}</td>
      <td class="cell-left cell-remarks" style="padding:5px 8px; font-size:0.76rem; color:#dc2626;" title="${r[5] || '-'}">${r[5] || '-'}</td>
    </tr>`).join('');
}

const renderUserSocsModalTable = () => UserConfig.renderTable('socsUserTableBody', activeUserDefinedSocsMap, 'editUserSoc', 'removeUserSoc', 'center', true);

const downloadSocsExcel = () => {
  const masterHeaders = ['CID', 'Metal', 'Name', 'Country', 'Year Identified', 'Remarks'];
  const masterRows = (socMasterRows || []).map(r => [r[0] || '-', r[1] || '-', r[2] || '-', r[3] || '-', r[4] || '-', r[5] || '-']);
  UserConfig.exportExcel(activeUserDefinedSocsMap, 'socs', 'SoCs_List', 'User-Defined', [{ headers: masterHeaders, rows: masterRows, sheetName: 'Master SoCs' }]);
};

function processSoCsData(headers = [], rows = []) {
  socMasterHeaders = Array.isArray(headers) ? headers : [];
  socMasterRows = Array.isArray(rows) ? rows : [];
  updateMergedSocsSet();
}

function processUserSoCsData(items = []) {
  activeUserDefinedSocsMap.clear();
  const defUid = (typeof getStoredUserProfile === 'function' ? getStoredUserProfile()?.userId : null) || 'User';
  if (Array.isArray(items)) {
    items.forEach(i => {
      const cid = String(i.cid || '').trim().toUpperCase();
      if (cid) activeUserDefinedSocsMap.set(cid, { userId: String(i.userId || defUid).trim(), remarks: String(i.remarks || '-').trim(), updated: i.updated || '' });
    });
  }
  saveUserSocsLocally(); updateMergedSocsSet();
}

// =========================================================================
// 3. USEFUL LINKS, NORMALIZERS & UI HELPERS
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
      <td class="cell-center" style="font-weight:600; color:#64748b; padding:12px 4px; font-size:0.85rem;">${item.no}</td>
      <td style="padding:12px 10px;">
        <strong style="font-size:0.9rem; color:#0f172a;">${item.title}</strong><br>
        <span style="font-size:0.75rem; color:#64748b;">${item.subTitle}</span>
      </td>
      <td style="padding:12px 10px; font-size:0.82rem; color:#334155; line-height:1.6; white-space:normal !important; word-break:keep-all;">${item.desc}</td>
      <td class="cell-center" style="padding:12px 4px;">
        <a href="${item.url}" target="_blank" rel="noopener noreferrer" class="link-anchor-btn">View Resource ↗</a>
      </td>
    </tr>`).join('');
}

function toggleSmelterSummarySection() {
  const body = document.getElementById('smelterSummaryBody');
  const icon = document.getElementById('smelterSummaryToggleIcon');
  if (!body) return;
  const isCol = body.style.display === 'none';
  body.style.display = isCol ? 'flex' : 'none';
  if (icon) icon.textContent = isCol ? '▲' : '▼';
}

function switchSmelterSubTab(tab, btnElem) {
  document.querySelectorAll('#viewSmelter .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewSmelter .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  const cap = tab.charAt(0).toUpperCase() + tab.slice(1);
  (btnElem || document.getElementById(`btnSmelterTab${cap}`))?.classList.add('active');
  document.getElementById(`smelterSubPane${cap}`)?.classList.add('active');

  if (tab === 'analysis') document.getElementById('smelterAnalysisInput')?.focus();
  else if (tab === 'links') renderSmelterUsefulLinks();
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
// 4. STORAGE & INDEXEDDB OPERATIONS
// =========================================================================
function openSmelterDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(SMELTER_DB_NAME, 3);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        ['smelters', 'socs', 'cahra'].forEach(s => {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, s === 'smelters' ? { keyPath: 'id', autoIncrement: true } : { keyPath: 'id' });
        });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch(e) { res(null); }
  });
}

async function saveSmelterToDB(headers, rows, lastUpdated, socHeaders = [], socRows = [], cahraCommon = []) {
  try {
    const db = await openSmelterDB();
    if (!db) return;
    const tx = db.transaction(['smelters', 'socs', 'cahra'], 'readwrite');
    const st = tx.objectStore('smelters');
    st.clear();
    st.put({ id: 'metadata', headers, lastUpdated });
    rows.forEach((r, i) => {
      const { _norm, _cahra, _rmap, ...cleanRow } = r;
      st.put({ id: i + 1, rowData: cleanRow });
    });
    const stSoc = tx.objectStore('socs');
    stSoc.clear();
    stSoc.put({ id: 'soc_data', headers: socHeaders, rows: socRows });
    const stCahra = tx.objectStore('cahra');
    stCahra.clear();
    stCahra.put({ id: 'cahra_common_data', rows: cahraCommon });
  } catch(e) {}
}

async function loadSmelterFromDB() {
  try {
    const db = await openSmelterDB();
    if (!db) return null;
    return new Promise(res => {
      const tx = db.transaction(['smelters', 'socs', 'cahra'], 'readonly');
      const reqSmelters = tx.objectStore('smelters').getAll();
      const reqSoc = tx.objectStore('socs').get('soc_data');
      const reqCahra = tx.objectStore('cahra').get('cahra_common_data');
      let smelterRes = null, socRes = null, cahraRes = null;

      reqSmelters.onsuccess = () => { smelterRes = reqSmelters.result || []; };
      reqSoc.onsuccess = () => { socRes = reqSoc.result || null; };
      reqCahra.onsuccess = () => { cahraRes = reqCahra.result || null; };

      tx.oncomplete = () => {
        if (!smelterRes || !smelterRes.length) return res(null);
        const meta = smelterRes.find(i => i.id === 'metadata');
        res({ 
          headers: meta?.headers || [], 
          lastUpdated: meta?.lastUpdated || '', 
          rows: smelterRes.filter(i => i.id !== 'metadata').map(i => i.rowData),
          socHeaders: socRes?.headers || [], socRows: socRes?.rows || [],
          cahraCommonRows: cahraRes?.rows || []
        });
      };
      tx.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearSmelterIndexedDB() {
  try {
    const db = await openSmelterDB();
    if (db) {
      const tx = db.transaction(['smelters', 'socs', 'cahra'], 'readwrite');
      tx.objectStore('smelters').clear();
      tx.objectStore('socs').clear();
      tx.objectStore('cahra').clear();
    }
  } catch(e) {}
}

function findHeaderColIdx(kws) {
  for (const kw of kws) {
    const cleanKw = kw.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (let i = 0; i < consolidatedHeaderStore.length; i++) {
      if (String(consolidatedHeaderStore[i] || '').toLowerCase().replace(/[^a-z0-9]/g, '').includes(cleanKw)) return i;
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
    rmap: findHeaderColIdx(['ddstatus', 'dd', 'auditstatus', 'rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) !== -1 ? findHeaderColIdx(['ddstatus', 'dd', 'auditstatus', 'rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) : 12,
    audit: findHeaderColIdx(['lastaudit', 'audit', 'cycle']) !== -1 ? findHeaderColIdx(['lastaudit', 'audit', 'cycle']) : 13
  };
}
const getColIndex = key => headerIdxMap[key] ?? -1;

function memoizeAndDeduplicateSmelterRows(rawRows) {
  if (!Array.isArray(rawRows) || !rawRows.length) return [];
  buildHeaderIndexMap();
  const idCol = getColIndex('cid'), cIdx = getColIndex('country'), rmapIdx = getColIndex('rmap');
  const seen = new Set(), result = [];
  let no = 1;
  const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));

  rawRows.forEach(r => {
    const cid = String(r[idCol] || '').trim().toUpperCase();
    if (!cid || cid === '-' || !seen.has(cid)) {
      if (cid && cid !== '-') seen.add(cid);
      const row = Array.isArray(r) ? [...r] : Object.values(r);
      row[0] = no++;
      row._cahra = determineCahraClassification(row[cIdx]);
      row._rmap = normalizeRmapStatus(row[rmapIdx]);
      row._socs = masterIdsSet.has(cid) ? 'Y (Common)' : (activeUserDefinedSocsMap.has(cid) ? 'Y (User)' : '-');
      row._norm = {};
      result.push(row);
    }
  });
  return result;
}

// =========================================================================
// 5. DATA INITIALIZATION & SYNC
// =========================================================================
async function initSmelterModule() {
  loadSavedCahraConfig();
  loadSavedUserSocsConfig();
  buildHeaderIndexMap();

  const cached = await loadSmelterFromDB();
  if (cached?.rows?.length) {
    consolidatedHeaderStore = (cached.headers && cached.headers.length >= 12) ? cached.headers : consolidatedHeaderStore;
    buildHeaderIndexMap();

    if (cached.cahraCommonRows?.length) processCahraCommonData(cached.cahraCommonRows);
    consolidatedDataStore = memoizeAndDeduplicateSmelterRows(cached.rows);
    window.consolidatedDataStore = consolidatedDataStore;
    smelterCurrentLastUpdated = cached.lastUpdated || '';

    if (cached.socRows?.length) processSoCsData(cached.socHeaders, cached.socRows);
    else updateMergedSocsSet();

    updateCahraModalUI();
    renderSmelterViewerTable();
    filterSmelterTableRows();

    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) fetchSmelterData(key, false);
  } else {
    updateCahraModalUI();
    updateMergedSocsSet();
    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) await fetchSmelterData(key, true);
  }
  renderSmelterUsefulLinks();
}

async function fetchSmelterData(authKey = '', forceReload = false) {
  const key = authKey || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) return;

  loadSavedCahraConfig();
  loadSavedUserSocsConfig();

  const tsToSend = (forceReload || !consolidatedDataStore.length) ? '' : smelterCurrentLastUpdated;
  const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
  const currentCompany = String(profile?.company || profile?.companyName || '').trim();
  const currentUserId = String(profile?.userId || 'User').trim();

  try {
    const resp = await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'fetch_data', auth: key, clientLastUpdated: tsToSend, company: currentCompany, userId: currentUserId })
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      smelterCurrentLastUpdated = res.lastUpdated || smelterCurrentLastUpdated;
      if (!consolidatedDataStore.length) {
        const cached = await loadSmelterFromDB();
        if (cached?.rows?.length) {
          if (cached.cahraCommonRows?.length) processCahraCommonData(cached.cahraCommonRows);
          consolidatedDataStore = memoizeAndDeduplicateSmelterRows(cached.rows);
          window.consolidatedDataStore = consolidatedDataStore;
        }
      }
      if (Array.isArray(res?.cahraCommonRows)) processCahraCommonData(res.cahraCommonRows);
      if (Array.isArray(res?.userCahraItems)) processUserCahraData(res.userCahraItems);
      if (Array.isArray(res?.socRows)) processSoCsData(res.socHeaders, res.socRows);
      if (Array.isArray(res?.userSocItems)) processUserSoCsData(res.userSocItems);

      updateCahraModalUI();
      updateMergedSocsSet();
      renderSmelterViewerTable();
      filterSmelterTableRows();
      return res;
    }

    const raw = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    if (res?.headers?.length) consolidatedHeaderStore = res.headers;
    buildHeaderIndexMap();

    if (Array.isArray(res?.cahraCommonRows)) processCahraCommonData(res.cahraCommonRows);
    if (Array.isArray(res?.userCahraItems)) processUserCahraData(res.userCahraItems);
    if (Array.isArray(res?.socRows)) processSoCsData(res.socHeaders, res.socRows);
    if (Array.isArray(res?.userSocItems)) processUserSoCsData(res.userSocItems);

    if (raw.length) {
      consolidatedDataStore = memoizeAndDeduplicateSmelterRows(raw);
      window.consolidatedDataStore = consolidatedDataStore;
      smelterCurrentLastUpdated = res.lastUpdated || '';
      await saveSmelterToDB(consolidatedHeaderStore, raw, smelterCurrentLastUpdated, socMasterHeaders, socMasterRows, Array.isArray(res?.cahraCommonRows) ? res.cahraCommonRows : []);
      renderSmelterViewerTable();
      filterSmelterTableRows();
    }
    return res;
  } catch(e) { console.error("fetchSmelterData error:", e); }
}

// =========================================================================
// 6. DASHBOARD & MASTER TABLE (슬림화 통합 렌더러 적용)
// =========================================================================
function renderDashboardSegment(colIdx, colorMap, barWrapId, chipsWrapId, totalLabelId, valueExtractor = null) {
  const rows = getSmelterAvailableRows(colIdx);
  const countMap = {};
  rows.forEach(r => {
    const v = valueExtractor ? valueExtractor(r) : (getRowCellValue(r, colIdx) || 'Unassigned');
    countMap[v] = (countMap[v] || 0) + 1;
  });

  const total = rows.length || 1;
  const filterSet = smelterMultiSelectFilters[String(colIdx)] || new Set();
  const sorted = Object.entries(countMap).sort((a, b) => b[1] - a[1]);

  let barHtml = '', chipsHtml = '';
  sorted.forEach(([tag, count], idx) => {
    const color = colorMap[tag] || ((typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#64748b');
    const pct = ((count / total) * 100).toFixed(1);
    barHtml += `<div class="p-segment" style="width:${(count / total) * 100}%; background:${color};" title="${escapeHtmlAttr(tag)}: ${count.toLocaleString()} (${pct}%)"></div>`;
    chipsHtml += `
      <span class="insight-chip tag ${filterSet.has(tag) ? 'active' : ''}" data-col="${colIdx}" data-tag="${escapeHtmlAttr(tag)}" onclick="toggleSmelterDashboardFilter(${colIdx}, this.getAttribute('data-tag'))">
        <span class="legend-dot" style="background:${color}; margin-right:4px;"></span><strong>${escapeHtmlText(tag)}</strong>
        <span class="insight-chip-badge">${count.toLocaleString()} (${pct}%)</span>
      </span>`;
  });

  const barEl = document.getElementById(barWrapId); if (barEl && barHtml) barEl.innerHTML = barHtml;
  const chipsEl = document.getElementById(chipsWrapId); if (chipsEl) chipsEl.innerHTML = chipsHtml;
  const totEl = document.getElementById(totalLabelId); if (totEl) totEl.textContent = `${rows.length.toLocaleString()} facilities`;
}

function updateSmelterDashboardCounts() {
  buildHeaderIndexMap();
  const updateDateEl = document.getElementById('smelterSummaryUpdateDate');
  if (updateDateEl) updateDateEl.textContent = smelterCurrentLastUpdated ? `Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)` : 'Latest Harvest: Live Synced';

  renderDashboardSegment(getColIndex('rmap'), {
    'Conformant': '#16a34a', 'Active': '#0284c7', 'Identified': '#64748b',
    'Removed': '#dc2626', 'Facility Standard Assessed': '#7c3aed', 'In Communication': '#d97706'
  }, 'rmapProgressBarWrap', 'smelterRmapChipsWrap', 'rmapTotalLabel', r => r._rmap || normalizeRmapStatus(r[getColIndex('rmap')]) || 'Identified');

  renderDashboardSegment(getColIndex('level'), {
    'Pinch Point': '#0284c7', 'Downstream': '#16a34a', 'Mine': '#d97706', 'Upstream': '#7c3aed', '-': '#94a3b8'
  }, 'levelProgressBarWrap', 'levelLegendGrid', 'levelTotalLabel');

  renderDashboardSegment(getColIndex('metal'), {}, 'metalProgressBarWrap', 'metalLegendGrid', 'metalTotalLabel', r => String(r[getColIndex('metal')] || '').trim() || 'Unassigned');
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
    { origIdx: getColIndex('source'), header: 'Source', widthPct: '5.0%', isMulti: true },
    { origIdx: getColIndex('metal'), header: 'Metal', widthPct: '5.0%', isMulti: true },
    { origIdx: getColIndex('cid'), header: 'CID', widthPct: '9.5%', isMulti: false, isCid: true },
    { origIdx: getColIndex('op'), header: 'Operation', widthPct: '7.5%', isMulti: true },
    { origIdx: getColIndex('level'), header: 'Level', widthPct: '7.0%', isMulti: true },
    { origIdx: getColIndex('rmap'), header: 'DD Status', widthPct: '8.0%', isMulti: true },
    { origIdx: getColIndex('country'), header: 'Country', widthPct: '8.0%', isMulti: false },
    { origIdx: 'CAHRA', countryColIdx: getColIndex('country'), header: 'CAHRA Basis', widthPct: '9.0%', isMulti: true, isCustom: true },
    { origIdx: 'SOCS', header: 'SoCs', widthPct: '7.5%', isMulti: true, isCustom: true },
    { origIdx: getColIndex('name'), header: 'Standard Facility Name', widthPct: 'auto', isMulti: false, isEllipsis: true },
    { origIdx: getColIndex('audit'), header: 'Auditted/Cycle/Reaudit', widthPct: '14%', isMulti: false, isAuditCycle: true }
  ];
}

function renderSmelterViewerTable() {
  const [hRow, fRow, tbl] = ['smelterTableHeadRow', 'smelterTableFilterRow', 'smelterDataTable'].map(id => document.getElementById(id));
  if (!hRow || !fRow || !tbl) return;
  buildDisplayColumnMap();

  tbl.style.tableLayout = 'fixed'; 
  tbl.style.width = '100%';
  tbl.querySelector('colgroup')?.remove();

  const colgroup = document.createElement('colgroup');
  hRow.innerHTML = ''; fRow.innerHTML = '';
  smelterTableFilters = {}; smelterMultiSelectFilters = {};

  displayColumnMap.forEach(col => {
    colgroup.innerHTML += `<col style="width:${col.widthPct};">`;
    hRow.innerHTML += `<th class="cell-center cell-ellipsis" style="padding:8px 4px;" title="${col.header}">${col.header}</th>`;
    const colKey = String(col.origIdx);
    if (col.isMulti) {
      smelterMultiSelectFilters[colKey] = new Set();
      fRow.innerHTML += `
        <th class="filter-th" style="padding:4px 2px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="smelterMsBtn_${colKey}" onclick="toggleDropdownGeneric('smelter', '${colKey}')">
              <span class="multiselect-btn-text" id="smelterMsText_${colKey}">All</span>
              <span style="font-size:0.55rem; color:#64748b; margin-left:2px;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="smelterMsDropdown_${colKey}"></div>
          </div>
        </th>`;
    } else if (col.origIdx !== 0) {
      fRow.innerHTML += `<th class="filter-th" style="padding:4px 2px;"><input type="text" class="filter-input" placeholder="Filter..." oninput="onSmelterFilterChange('${colKey}', this.value)" style="padding:3px 4px; font-size:0.72rem;"></th>`;
    } else {
      fRow.innerHTML += '<th class="filter-th" style="padding:4px 2px;"></th>';
    }
  });

  tbl.insertBefore(colgroup, tbl.firstChild);
}

function getRowCellValue(row, colKey) {
  if (colKey === 'CAHRA') return row._cahra;
  if (colKey === 'SOCS') return row._socs || '-';
  const kInt = parseInt(colKey, 10);
  if (kInt === getColIndex('rmap')) return row._rmap;
  if (!row._norm[kInt]) row._norm[kInt] = normalizeCellValue(kInt, row[kInt]);
  return row._norm[kInt];
}

function matchesCahraCriteria(rowVal, filterSet) {
  if (!filterSet || !filterSet.size) return true;
  for (const s of filterSet) {
    if (s === 'US Dodd-Frank' && (rowVal === 'US Dodd-Frank' || rowVal === 'EU & US')) return true;
    if (s === 'EU CAHRA' && (rowVal === 'EU CAHRA' || rowVal === 'EU & US')) return true;
    if (rowVal === s) return true;
  }
  return false;
}

function getSmelterAvailableRows(excludeKey) {
  const excludeStr = excludeKey !== undefined && excludeKey !== null ? String(excludeKey) : null;
  const filterKeys = Object.entries(smelterTableFilters).filter(([_, kw]) => Boolean(kw));
  const multiKeys = Object.entries(smelterMultiSelectFilters).filter(([k, set]) => k !== excludeStr && set.size > 0);

  return consolidatedDataStore.filter(row => {
    for (const [k, kw] of filterKeys) {
      if (!getRowCellValue(row, k).toLowerCase().includes(kw)) return false;
    }
    for (const [k, set] of multiKeys) {
      const target = getRowCellValue(row, k);
      if (k === 'CAHRA') { if (!matchesCahraCriteria(target, set)) return false; }
      else if (!set.has(target)) return false;
    }
    return true;
  });
}

// -------------------------------------------------------------------------
// Multiselect Dropdown Engine (Generic & Unified)
// -------------------------------------------------------------------------
function toggleDropdownGeneric(prefix, key) {
  const strKey = String(key);
  const dd = document.getElementById(`${prefix}MsDropdown_${strKey}`);
  const btn = document.getElementById(`${prefix}MsBtn_${strKey}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    prefix === 'smelter' ? populateSingleSmelterDropdown(strKey) : populateSingleAnalysisDropdown(strKey);
    const r = btn.getBoundingClientRect();
    let top = (r.bottom + 2 + 250 > window.innerHeight && r.top > 250) ? r.top - 252 : r.bottom + 2;
    let left = (r.left + 240 > window.innerWidth) ? Math.max(10, window.innerWidth - 250) : r.left;
    dd.style.top = `${top}px`;
    dd.style.left = `${left}px`;
    dd.classList.add('show');
  }
}

function populateSingleSmelterDropdown(key) {
  const strKey = String(key);
  const dd = document.getElementById(`smelterMsDropdown_${strKey}`);
  if (!dd) return;

  const availableRows = getSmelterAvailableRows(strKey);
  const currentSet = smelterMultiSelectFilters[strKey] || new Set();

  if (strKey === 'CAHRA' || strKey === 'SOCS') {
    const isCahra = strKey === 'CAHRA';
    const presets = isCahra ? ['User-defined', 'EU & US', 'EU CAHRA', 'US Dodd-Frank', '-'] : ['Y (Common)', 'Y (User)', '-'];
    const activeSet = new Set(availableRows.map(r => isCahra ? r._cahra : (r._socs || '-')));

    const itemsHtml = presets.filter(p => activeSet.has(p) || (isCahra && (p === 'EU CAHRA' || p === 'US Dodd-Frank') && activeSet.has('EU & US'))).map(p => `
      <label class="multiselect-item">
        <input type="checkbox" value="${p}" ${currentSet.has(p) ? 'checked' : ''} onchange="toggleSmelterDropdownItem('${strKey}', '${p}', this.checked)">
        <span>${isCahra ? getCahraBadge(p) : (p.startsWith('Y') ? `<span style="color:#dc2626;">${p}</span>` : p)}</span>
      </label>`).join('');

    dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_${strKey}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSmelterDropdown('${strKey}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">${itemsHtml}`;
    return;
  }

  const rawList = availableRows.map(r => getRowCellValue(r, strKey)).filter(v => v && v !== '-');
  const unique = [...new Set(rawList)].sort();
  const validSet = new Set(unique);
  for (const v of currentSet) { if (!validSet.has(v)) currentSet.delete(v); }

  const txt = document.getElementById(`smelterMsText_${strKey}`);
  if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="smelterChkAll_${strKey}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllSmelterDropdown('${strKey}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleSmelterDropdownItem('${strKey}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${strKey === String(getColIndex('rmap')) ? getStatusBadge(v) : v}</span></label>`).join('');
}

function selectAllSmelterDropdown(key, chk) {
  const strKey = String(key);
  if (!smelterMultiSelectFilters[strKey]) smelterMultiSelectFilters[strKey] = new Set();
  smelterMultiSelectFilters[strKey].clear();
  document.querySelectorAll(`#smelterMsDropdown_${strKey} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const txt = document.getElementById(`smelterMsText_${strKey}`); if (txt) txt.textContent = 'All';
  document.querySelectorAll(`.insight-chip[data-col="${strKey}"]`).forEach(c => c.classList.remove('active'));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

function toggleSmelterDropdownItem(key, val, chk) {
  const strKey = String(key);
  if (!smelterMultiSelectFilters[strKey]) smelterMultiSelectFilters[strKey] = new Set();
  chk ? smelterMultiSelectFilters[strKey].add(val) : smelterMultiSelectFilters[strKey].delete(val);
  const all = document.getElementById(`smelterChkAll_${strKey}`); if (all) all.checked = !smelterMultiSelectFilters[strKey].size;
  const txt = document.getElementById(`smelterMsText_${strKey}`); if (txt) txt.textContent = smelterMultiSelectFilters[strKey].size ? `${smelterMultiSelectFilters[key].size} selected` : 'All';
  document.querySelectorAll(`.insight-chip[data-col="${strKey}"]`).forEach(c => c.classList.toggle('active', smelterMultiSelectFilters[strKey].has(c.getAttribute('data-tag'))));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

const toggleSmelterDropdown = idx => toggleDropdownGeneric('smelter', idx);
const populateSmelterDropdownFilters = () => Object.keys(smelterMultiSelectFilters).forEach(key => populateSingleSmelterDropdown(key));

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
      if (!getRowCellValue(row, k).toLowerCase().includes(kw)) return;
    }
    for (const [k, set] of multiKeys) {
      const target = getRowCellValue(row, k);
      if (k === 'CAHRA') { if (!matchesCahraCriteria(target, set)) return; }
      else if (!set.has(target)) return;
    }
    smelterFilteredIndices.push(rIdx);
  });

  renderSmelterCurrentPage();
  try { updateSmelterDashboardCounts(); } catch(e) {}
  try { populateSmelterDropdownFilters(); } catch(e) {}
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
    const rawStoreIdx = smelterFilteredIndices[i];
    const r = consolidatedDataStore[rawStoreIdx];
    html += '<tr>' + displayColumnMap.map(col => {
      const idx = col.origIdx;
      if (col.isCustom && idx === 'CAHRA') return `<td class="cell-center" style="padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r._cahra)}</td>`;
      if (col.isCustom && idx === 'SOCS') {
        const socVal = r._socs || '-';
        return `<td class="cell-center" style="padding:6px 2px; font-size:0.78rem; color:${socVal.startsWith('Y') ? '#dc2626' : 'inherit'};">${socVal}</td>`;
      }
      if (idx === 0) return `<td class="cell-center" style="color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>`;
      if (idx === rmapIdx) return `<td class="cell-center" style="padding:6px 2px; white-space:nowrap;">${getStatusBadge(r._rmap)}</td>`;
      
      const val = getRowCellValue(r, idx);
      if (col.isCid) {
        return `
          <td class="col-cid" style="padding:5px 8px;">
            <div style="display:flex; align-items:center; justify-content:space-between; width:100%; min-width:0; gap:4px;">
              <span class="clickable-cid" onclick="copyTextToClipboard('${val}', this)" title="Click to copy">${val}</span>
              <button type="button" class="btn-view-drawer" onclick="openSmelterDetailModal(${rawStoreIdx})" data-tooltip="Click to View Details">📑</button>
            </div>
          </td>`;
      }
      if (col.isAuditCycle) return `<td class="cell-left cell-remarks" style="padding:6px 6px; font-size:0.76rem;" title="${val}">${val || '-'}</td>`;
      return `<td class="cell-left cell-ellipsis" style="padding:6px 4px; font-size:0.78rem;" title="${val}">${val || '-'}</td>`;
    }).join('') + '</tr>';
  }

  tbody.innerHTML = html || `<tr><td colspan="${displayColumnMap.length}" class="cell-center" style="padding:24px; color:#94a3b8;">No matching facility records found.</td></tr>`;
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
    const txt = document.getElementById(`smelterMsText_${idx}`); if (txt) txt.textContent = 'All';
  });
  document.querySelectorAll('.insight-chip').forEach(c => c.classList.remove('active'));
  smelterCurrentPage = 1; filterSmelterTableRows();
}

// =========================================================================
// 7. CID CHECKER
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
    if (!set.has(id)) { set.add(id); result.push(id); }
  });
  return result;
}

function runSmelterAnalysis() {
  const ids = parseSmelterInputIds(document.getElementById('smelterAnalysisInput')?.value.trim());
  document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  if (!ids.length) return alert('Please enter or paste at least one CID (Facility ID).');
  if (!consolidatedDataStore.length) return alert('Master facility data is not loaded yet. Please wait for sync.');

  buildHeaderIndexMap();
  const idIdx = getColIndex('cid'), metalIdx = getColIndex('metal'), opIdx = getColIndex('op'), levelIdx = getColIndex('level'), nameIdx = getColIndex('name'), cIdx = getColIndex('country');
  const masterMap = new Map();
  consolidatedDataStore.forEach(r => {
    const sid = String(r[idIdx] || '').trim().toUpperCase();
    if (sid && !masterMap.has(sid)) masterMap.set(sid, r);
  });

  const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
  const masterRemarksMap = new Map(socMasterRows.map(r => [String(r[0] || '').trim().toUpperCase(), String(r[5] || '').trim()]));

  smelterAnalysisRawRows = ids.map(id => {
    let socLabel = masterIdsSet.has(id) ? 'Y (Common)' : (activeUserDefinedSocsMap.has(id) ? 'Y (User)' : '-');
    let remarksText = masterIdsSet.has(id) ? (masterRemarksMap.get(id) || '-') : (activeUserDefinedSocsMap.get(id)?.remarks || '-');

    if (masterMap.has(id)) {
      const r = masterMap.get(id);
      return {
        metal: r[metalIdx] || '-', smelterId: r[idIdx] || id, opStatus: getRowCellValue(r, opIdx),
        level: getRowCellValue(r, levelIdx), rmapStatus: r._rmap, country: r[cIdx] || '-',
        cahra: r._cahra, userSoc: socLabel, smelterName: r[nameIdx] || '-', remarks: remarksText
      };
    }
    return {
      metal: '-', smelterId: id, opStatus: '-', level: '-', rmapStatus: 'Unmatched', country: '-',
      cahra: '-', userSoc: socLabel, smelterName: 'Unknown / Not in Master DB', remarks: remarksText
    };
  });

  activeAnalysisKpiFilterSet.clear();
  renderSmelterAnalysisKpiBar();

  const badge = document.getElementById('analysisSubTabBadge');
  if (badge) { badge.textContent = smelterAnalysisRawRows.length; badge.style.display = 'inline-flex'; }
  document.getElementById('smelterAnalysisResultCard')?.style.setProperty('display', 'block');

  smelterAnalysisFilters = {};
  smelterAnalysisMultiFilters = { opStatus: new Set(), level: new Set(), rmapStatus: new Set(), cahra: new Set(), userSoc: new Set() };
  resetSmelterAnalysisFilterInputs();
  filterSmelterAnalysisRows();
}

function renderSmelterAnalysisKpiBar() {
  const kpiBar = document.getElementById('smelterAnalysisKpiBar');
  if (!kpiBar) return;

  const total = smelterAnalysisRawRows.length;
  let conf = 0, act = 0, ident = 0, unmatch = 0, others = 0, socs = 0;
  smelterAnalysisRawRows.forEach(r => {
    if (r.rmapStatus === 'Conformant') conf++;
    else if (r.rmapStatus === 'Active') act++;
    else if (r.rmapStatus === 'Identified') ident++;
    else if (r.rmapStatus === 'Unmatched') unmatch++;
    else others++;
    if (r.userSoc && r.userSoc.startsWith('Y')) socs++;
  });

  const actionChips = [
    { key: 'ALL', label: '📥 Input IDs:', count: total, active: !activeAnalysisKpiFilterSet.size },
    { key: 'EXCEPT_CONF', label: '⚠️ Except Conformant:', count: total - conf, active: activeAnalysisKpiFilterSet.has('EXCEPT_CONF'), color: '#d97706' },
    { key: 'EXCEPT_CONF_ACT', label: '🚨 Except Conformant & Active:', count: total - conf - act, active: activeAnalysisKpiFilterSet.has('EXCEPT_CONF_ACT'), color: '#7c3aed' },
    { key: 'SOCS', label: '📋 Smelters of Concern:', count: socs, active: activeAnalysisKpiFilterSet.has('SOCS'), color: '#dc2626' }
  ];

  kpiBar.style.display = 'flex'; kpiBar.style.alignItems = 'center'; kpiBar.style.justifyContent = 'flex-start'; kpiBar.style.gap = '8px'; kpiBar.style.flexWrap = 'wrap';
  kpiBar.innerHTML = actionChips.map(c => `
    <div class="smelter-analysis-kpi-chip insight-chip tag ${c.active ? 'active' : ''}" style="cursor:pointer;" onclick="toggleAnalysisKpiFilter('${c.key}')">
      <span style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:600;">${c.label}</span>
      <strong style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:700;">${c.count}</strong>
    </div>`).join('') + `
    <div style="display:flex; align-items:center; gap:10px; font-size:0.77rem; color:var(--text-muted); padding:4px 8px; background:#fff; border:1px solid var(--border-darker); border-radius:6px; margin-left:auto; white-space:nowrap;">
      <span><strong>Conformant:</strong> <span style="color:#16a34a;">${conf}</span></span><span style="color:var(--border-darker);">·</span>
      <span><strong>Active:</strong> <span style="color:#0284c7;">${act}</span></span><span style="color:var(--border-darker);">·</span>
      <span><strong>Identified:</strong> <span style="color:#64748b;">${ident}</span></span><span style="color:var(--border-darker);">·</span>
      <span><strong>Unmatched:</strong> <span style="color:#dc2626;">${unmatch}</span></span><span style="color:var(--border-darker);">·</span>
      <span><strong>Others:</strong> <span style="color:#7c3aed;">${others}</span></span>
    </div>`;
}

function toggleAnalysisKpiFilter(type) {
  type === 'ALL' ? activeAnalysisKpiFilterSet.clear() : (activeAnalysisKpiFilterSet.has(type) ? activeAnalysisKpiFilterSet.delete(type) : activeAnalysisKpiFilterSet.add(type));
  renderSmelterAnalysisKpiBar();
  filterSmelterAnalysisRows();
}

function resetSmelterAnalysisFilterInputs() {
  document.querySelectorAll('#smelterAnalysisFilterRow .filter-input').forEach(inp => inp.value = '');
  ['opStatus', 'level', 'rmapStatus', 'cahra', 'userSoc'].forEach(k => {
    const txt = document.getElementById(`analysisMsText_${k}`); if (txt) txt.textContent = 'All';
    if (smelterAnalysisMultiFilters[k]) smelterAnalysisMultiFilters[k].clear();
  });
}

function resetSmelterAnalysisFilter() {
  resetSmelterAnalysisFilterInputs();
  smelterAnalysisFilters = {};
  activeAnalysisKpiFilterSet.clear();
  renderSmelterAnalysisKpiBar();
  filterSmelterAnalysisRows();
}

const onAnalysisFilterChange = (propKey, val) => { smelterAnalysisFilters[propKey] = val.trim(); filterSmelterAnalysisRows(); };
const toggleAnalysisDropdown = key => toggleDropdownGeneric('analysis', key);

function populateSingleAnalysisDropdown(key) {
  const dd = document.getElementById(`analysisMsDropdown_${key}`);
  if (!dd) return;
  const currentSet = smelterAnalysisMultiFilters[key] || new Set();

  if (key === 'cahra') {
    const cahraSet = new Set(smelterAnalysisRawRows.map(r => r.cahra));
    const allPresets = ['User-defined', 'EU & US', 'EU CAHRA', 'US Dodd-Frank', '-'];
    const itemsHtml = allPresets.filter(p => cahraSet.has(p) || ((p === 'EU CAHRA' || p === 'US Dodd-Frank') && cahraSet.has('EU & US'))).map(p => `
      <label class="multiselect-item">
        <input type="checkbox" value="${p}" ${currentSet.has(p) ? 'checked' : ''} onchange="toggleAnalysisDropdownItem('cahra', '${p}', this.checked)">
        <span>${getCahraBadge(p)}</span>
      </label>`).join('');
    dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="analysisChkAll_cahra" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAnalysisDropdown('cahra', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">${itemsHtml}`;
    return;
  }

  const rawList = smelterAnalysisRawRows.map(r => r[key]).filter(v => v && v !== '-');
  const unique = [...new Set(rawList)].sort();
  const validSet = new Set(unique);
  for (const val of currentSet) { if (!validSet.has(val)) currentSet.delete(val); }

  const txt = document.getElementById(`analysisMsText_${key}`); if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

  dd.innerHTML = `<label class="multiselect-item"><input type="checkbox" id="analysisChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllAnalysisDropdown('${key}', this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(v => {
      let lbl = v;
      if (key === 'rmapStatus') lbl = getStatusBadge(v);
      else if (key === 'userSoc' && v.startsWith('Y')) lbl = `<span style="color:#dc2626;">${v}</span>`;
      return `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleAnalysisDropdownItem('${key}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${lbl}</span></label>`;
    }).join('');
}

function selectAllAnalysisDropdown(key, chk) {
  if (!smelterAnalysisMultiFilters[key]) smelterAnalysisMultiFilters[key] = new Set();
  smelterAnalysisMultiFilters[key].clear();
  document.querySelectorAll(`#analysisMsDropdown_${key} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const txt = document.getElementById(`analysisMsText_${key}`); if (txt) txt.textContent = 'All';
  filterSmelterAnalysisRows();
}

function toggleAnalysisDropdownItem(key, val, chk) {
  if (!smelterAnalysisMultiFilters[key]) smelterAnalysisMultiFilters[key] = new Set();
  chk ? smelterAnalysisMultiFilters[key].add(val) : smelterAnalysisMultiFilters[key].delete(val);
  const all = document.getElementById(`analysisChkAll_${key}`); if (all) all.checked = !smelterAnalysisMultiFilters[key].size;
  const txt = document.getElementById(`analysisMsText_${key}`); if (txt) txt.textContent = smelterAnalysisMultiFilters[key].size ? `${smelterAnalysisMultiFilters[key].size} selected` : 'All';
  filterSmelterAnalysisRows();
}

function filterSmelterAnalysisRows() {
  smelterAnalysisFilteredRows = smelterAnalysisRawRows.filter(r => {
    if (activeAnalysisKpiFilterSet.size) {
      let ok = false;
      if (activeAnalysisKpiFilterSet.has('EXCEPT_CONF') && r.rmapStatus !== 'Conformant') ok = true;
      if (activeAnalysisKpiFilterSet.has('EXCEPT_CONF_ACT') && r.rmapStatus !== 'Conformant' && r.rmapStatus !== 'Active') ok = true;
      if (activeAnalysisKpiFilterSet.has('SOCS') && r.userSoc && r.userSoc.startsWith('Y')) ok = true;
      if (!ok) return false;
    }
    for (const [propKey, kw] of Object.entries(smelterAnalysisFilters)) {
      if (kw && !String(r[propKey] || '').toLowerCase().includes(kw.toLowerCase())) return false;
    }
    for (const [key, set] of Object.entries(smelterAnalysisMultiFilters)) {
      if (set?.size) {
        if (key === 'cahra') { if (!matchesCahraCriteria(r[key], set)) return false; }
        else if (!set.has(r[key])) return false;
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
    tbody.innerHTML = `<tr><td colspan="11" class="cell-center" style="padding:24px; color:#94a3b8;">No matching analysis records found.</td></tr>`;
    return;
  }

  tbody.innerHTML = smelterAnalysisFilteredRows.map((r, i) => `
    <tr>
      <td class="cell-center" style="color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>
      <td class="cell-center" style="padding:6px 2px; font-size:0.78rem;">${r.metal}</td>
      <td class="cell-center" style="padding:6px 2px; font-family:'Consolas',monospace;"><span class="clickable-cid" onclick="copyTextToClipboard('${r.smelterId}', this)" title="Click to copy">${r.smelterId}</span></td>
      <td class="cell-center" style="padding:6px 2px; font-size:0.78rem;">${r.opStatus}</td>
      <td class="cell-center" style="padding:6px 2px; font-size:0.78rem;">${r.level}</td>
      <td class="cell-center" style="padding:6px 2px;">${getStatusBadge(r.rmapStatus)}</td>
      <td class="cell-left cell-ellipsis" style="padding:6px 4px; font-size:0.78rem;" title="${r.country}">${r.country}</td>
      <td class="cell-center" style="padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r.cahra)}</td>
      <td class="cell-center" style="padding:6px 2px; color:${r.userSoc.startsWith('Y') ? '#dc2626' : 'inherit'}; font-size:0.80rem;">${r.userSoc}</td>
      <td class="cell-left cell-ellipsis" style="padding:6px 4px; font-size:0.78rem;" title="${r.smelterName}">${r.smelterName}</td>
      <td class="cell-left cell-remarks" style="padding:6px 6px; font-size:0.78rem;" title="${r.remarks}">${r.remarks || '-'}</td>
    </tr>`).join('');
}

// =========================================================================
// 8. CLIPBOARD TABLE EXPORT
// =========================================================================
async function copySmelterAnalysisTable() {
  if (!smelterAnalysisFilteredRows.length) return alert('No analysis records available to copy.');
  const btn = document.getElementById('btnCopySmelterAnalysis'), orgHtml = btn?.innerHTML || '';
  const headers = ['No.', 'Metal', 'CID', 'Operation', 'Level', 'DD Status', 'Country', 'CAHRA Basis', 'Smelter of Concern', 'Standard Facility Name', 'Remarks'];

  let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;"><thead style="background-color:#f1f5f9;"><tr>` +
    headers.map(h => `<th style="border:1px solid #cbd5e1; padding:8px 10px; font-weight:normal; color:#0f172a; text-align:center;">${h}</th>`).join('') + `</tr></thead><tbody>`;

  let plainText = headers.join('\t') + '\n';
  smelterAnalysisFilteredRows.forEach((r, i) => {
    const rowBg = i % 2 ? '#fafafa' : '#ffffff';
    let cColor = 'color:#334155;';
    let sColor = r.rmapStatus === 'Conformant' ? 'color:#16a34a;' : 'color:#334155;';

    tableHtml += `<tr style="background-color:${rowBg};"><td style="border:1px solid #cbd5e1; text-align:center;">${i + 1}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.metal}</td><td style="border:1px solid #cbd5e1; text-align:center; font-family:monospace;">${r.smelterId}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.opStatus}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.level}</td><td style="border:1px solid #cbd5e1; text-align:center; ${sColor}">${r.rmapStatus}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.country}</td><td style="border:1px solid #cbd5e1; text-align:center; ${cColor}">${r.cahra}</td><td style="border:1px solid #cbd5e1; text-align:center; color:${r.userSoc.startsWith('Y') ? '#dc2626' : 'inherit'};">${r.userSoc}</td><td style="border:1px solid #cbd5e1;">${r.smelterName}</td><td style="border:1px solid #cbd5e1;">${r.remarks}</td></tr>`;
    plainText += [i + 1, r.metal, r.smelterId, r.opStatus, r.level, r.rmapStatus, r.country, r.cahra, r.userSoc, r.smelterName, r.remarks].join('\t') + '\n';
  });
  tableHtml += '</tbody></table>';

  try {
    if (navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([tableHtml], { type: 'text/html' }), 'text/plain': new Blob([plainText], { type: 'text/plain' }) })]);
    } else if (navigator.clipboard) await navigator.clipboard.writeText(plainText);
    if (btn) { btn.innerHTML = '✓ Copied!'; btn.style.color = '#16a34a'; setTimeout(() => { btn.innerHTML = orgHtml; btn.style.color = ''; }, 1500); }
  } catch(e) { alert('Failed to copy table to clipboard.'); }
}

// =========================================================================
// 9. DETAIL MODAL (선언형 매핑 & CSS 클래스 적용)
// =========================================================================
function openSmelterDetailModal(rawStoreIdx) {
  const r = consolidatedDataStore[rawStoreIdx];
  if (!r) return;

  buildHeaderIndexMap();
  const cid = r[getColIndex('cid')] || '-';
  const name = r[getColIndex('name')] || '-';

  const titleEl = document.getElementById('smelterDrawerTitle');
  if (titleEl) titleEl.textContent = `🏭 ${cid}: ${name}`;

  const infoCard = document.getElementById('smelterDrawerInfoCard');
  if (infoCard) {
    infoCard.className = 'drawer-card-info smelter-drawer-grid';
    infoCard.style.cssText = '';

    const fields = [
      { label: 'Facility ID (CID)', val: `<span class="clickable-cid" onclick="copyTextToClipboard('${cid}', this)" style="color:#0284c7; cursor:pointer; font-weight:600;">${cid}</span>` },
      { label: 'Metal', val: r[getColIndex('metal')] || '-' },
      { label: 'Standard Name', val: `<strong>${name}</strong>` },
      { label: 'Smelter Reference', val: r[getColIndex('ref')] || '-' },
      { label: 'Operation Status', val: r[getColIndex('op')] || '-' },
      { label: 'Supply Chain Level', val: r[getColIndex('level')] || '-' },
      { label: 'DD Status (RMAP)', val: getStatusBadge(r._rmap || normalizeRmapStatus(r[getColIndex('rmap')]) || '-') },
      { label: 'Audit / Cycle / Reaudit', val: r[getColIndex('audit')] || '-' },
      { label: 'Country', val: r[getColIndex('country')] || '-' },
      { label: 'Location (City / State)', val: `${r[getColIndex('city')] || '-'} / ${r[getColIndex('state')] || '-'}` },
      { label: 'CAHRA Basis', val: getCahraBadge(r._cahra || '-') },
      { label: 'SoCs Designation', val: `<span style="color:${(r._socs || '-').startsWith('Y') ? '#dc2626' : '#1e293b'}; font-weight:600;">${r._socs || '-'}</span>` }
    ];

    infoCard.innerHTML = fields.map(f => `
      <div class="smelter-drawer-field">
        <span class="smelter-drawer-label">${f.label}:</span>
        <div class="smelter-drawer-val">${f.val}</div>
      </div>`).join('');
  }

  const ext = document.getElementById('smelterDrawerExtendedContainer');
  if (ext) {
    ext.innerHTML = `
      <div style="margin-top:12px; padding:12px; background:var(--bg-slate); border:1px solid var(--border-gray); border-radius:6px; font-size:0.8rem; line-height:1.5;">
        <div style="font-weight:700; color:var(--text-main); margin-bottom:6px;">🔗 RMI Official Resources</div>
        <div>Verify facility data against official lists: <a href="https://www.responsiblemineralsinitiative.org/facilities-lists/public-facilities-list/" target="_blank" rel="noopener noreferrer" style="color:#0284c7; font-weight:600; text-decoration:none;">RMI Public Facilities List ↗</a></div>
      </div>`;
  }
  document.getElementById('smelterDrawerOverlay')?.style.setProperty('display', 'flex');
}

const closeSmelterDetailModal = () => document.getElementById('smelterDrawerOverlay')?.style.setProperty('display', 'none');

// =========================================================================
// 10. 전역 함수 바인딩 (HTML 및 core.js 완전 호환)
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
window.updateSmelterDashboardCounts = updateSmelterDashboardCounts;
window.openSmelterDetailModal = openSmelterDetailModal;
window.closeSmelterDetailModal = closeSmelterDetailModal;

// 외부(core.js) 세션 연동용 전역 바인딩
window.loadSavedCahraConfig = loadSavedCahraConfig;
window.loadSavedUserSocsConfig = loadSavedUserSocsConfig;
window.updateCahraModalUI = updateCahraModalUI;
window.updateMergedSocsSet = updateMergedSocsSet;

// CAHRA Modal Handlers
window.openCahraModal = openCahraModal;
window.closeCahraModal = closeCahraModal;
window.toggleCahraMasterPopover = toggleCahraMasterPopover;
window.closeCahraMasterPopover = closeCahraMasterPopover;
window.downloadUserCahraExcel = downloadUserCahraExcel;
window.renderUserCahraModalTable = renderUserCahraModalTable;
window.addCahraCountryFromInput = addCahraCountryFromInput;
window.editUserCahra = editUserCahra;
window.cancelUserCahraEdit = cancelUserCahraEdit;
window.removeUserCahraCountry = removeUserCahraCountry;
window.clearAllUserCahraCountries = clearAllUserCahraCountries;
window.saveCahraConfiguration = saveCahraConfiguration;

// SoCs Modal Handlers
window.openSocsModal = openSocsModal;
window.closeSocsModal = closeSocsModal;
window.renderSocsModalTable = renderSocsModalTable;
window.renderUserSocsModalTable = renderUserSocsModalTable;
window.addUserSocFromInputs = addUserSocFromInputs;
window.editUserSoc = editUserSoc;
window.cancelUserSocEdit = cancelUserSocEdit;
window.removeUserSoc = removeUserSoc;
window.clearAllUserSocs = clearAllUserSocs;
window.downloadSocsExcel = downloadSocsExcel;

// Manual, Analysis & Pagination
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
window.goToSmelterPage = goToSmelterPage;
window.changeSmelterPageSize = changeSmelterPageSize;
window.copyTextToClipboard = copyTextToClipboard;

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('smelterAnalysisInput')?.addEventListener('input', e => {
    const ids = parseSmelterInputIds(e.target.value);
    document.getElementById('analysisInputCountLabel')?.replaceChildren(document.createTextNode(`${ids.length} unique IDs detected`));
  });
});