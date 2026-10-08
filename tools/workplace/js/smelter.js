/* =========================================================================
   SMELTER & FACILITY LOG MODULE (Optimized & Synchronized Architecture)
   ========================================================================= */
const URL_SMELTER = 'https://script.google.com/macros/s/AKfycbwKKRk2-NKSnSnVfb1cGrMkHGgxx5J5iHognV4AAR1ZGZK9fmp9vTcPW5w69MjgGWQRlw/exec';
const SMELTER_DB_NAME = 'a2MDS_SmelterLog_DB';
const CAHRA_CUSTOM_STORAGE_KEY = 'a2mds_smelter_cahra_custom_v3';

// 사용자별 고유 localStorage 키 생성 헬퍼 (계정 간 데이터 섞임 방지)
const getUserSocsStorageKey = () => {
  const uid = typeof getStoredUserProfile === 'function' ? String(getStoredUserProfile()?.userId || '').trim().toLowerCase() : '';
  return uid ? `a2mds_smelter_socs_custom_v4_${uid}` : 'a2mds_smelter_socs_custom_v4_guest';
};

let consolidatedDataStore = [];
let smelterTableFilters = {};
let smelterMultiSelectFilters = {};

let consolidatedHeaderStore = [
  'No.', 'Source', 'Metal', 'CID', 'Operation', 'Level', 'CAHRA Basis',
  'Standard Facility Name', 'Country', 'Smelter Reference', 'City',
  'State Province', 'DD Status', 'Audit / Cycle / Reaudit'
];
let smelterCurrentLastUpdated = '';
let smelterFilterDebounceTimer = null;

let smelterCurrentPage = 1, smelterPageSize = 100;
let smelterFilteredIndices = [], displayColumnMap = [];

let smelterAnalysisRawRows = [], smelterAnalysisFilteredRows = [];
let smelterAnalysisFilters = {}, smelterAnalysisMultiFilters = {};
let activeAnalysisKpiFilterSet = new Set();

let socMasterHeaders = [];
let socMasterRows = [];
// Map<CID, { userId: string, remarks: string, updated: string }>
let activeUserDefinedSocsMap = new Map();
let activeSocsSet = new Set();
let editingUserSocCid = null; // 현재 편집 중인 CID 식별용

let headerIdxMap = {};
const cahraClassificationCache = new Map();

window.consolidatedDataStore = consolidatedDataStore;

// =========================================================================
// 0. CAHRA ENGINE & USER-DEFINED CONFIGURATION (COUNTRY)
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
let activeUserDefinedCountrySet = new Set();

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
        activeUserDefinedCountrySet = new Set(parsed.user.map(c => String(c).trim().toUpperCase()));
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
      user: Array.from(activeUserDefinedCountrySet)
    };
    localStorage.setItem(CAHRA_CUSTOM_STORAGE_KEY, JSON.stringify(data));
  } catch(e) {}
  closeCahraModal();
  clearCahraCache();
  updateCahraModalUI();
  filterSmelterTableRows();
}

function matchNormalizedCountry(cleanName, countrySet) {
  if (!cleanName || !countrySet || !countrySet.size) return false;
  if (countrySet.has(cleanName)) return true;

  const aliasMap = {
    'RUSSIAN FEDERATION': 'RUSSIA',
    'CONGO, THE DEMOCRATIC REPUBLIC OF THE': 'CONGO, DEMOCRATIC REPUBLIC OF THE',
    'DRC': 'CONGO, DEMOCRATIC REPUBLIC OF THE',
    'CONGO': 'REPUBLIC OF THE CONGO',
    'USA': 'UNITED STATES OF AMERICA'
  };

  const alias = aliasMap[cleanName];
  if (alias && countrySet.has(alias)) return true;

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
  if (matchNormalizedCountry(clean, activeUserDefinedCountrySet)) {
    result = 'User-defined';
  } else {
    const isEu = matchNormalizedCountry(clean, activeEuCahraSet);
    const isUs = matchNormalizedCountry(clean, activeUsDoddFrankSet);
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
    Active: 'color:#0284c7; font-weight:normal;', 
    Removed: 'text-cahra-red', 
    Identified: 'color:#64748b; font-weight:normal;',
    Unmatched: 'color:#dc2626; font-weight:normal;',
    'Facility Standard Assessed': 'color:#7c3aed; font-weight:normal;',
    'In Communication': 'color:#d97706; font-weight:normal;'
  };
  const cls = colors[st];
  return cls ? (cls.includes(':') ? `<span style="${cls}">${st}</span>` : `<span class="${cls}">${st}</span>`) : `<span class="text-neutral-cell">${st || '-'}</span>`;
};

const openCahraModal = () => { updateCahraModalUI(); document.getElementById('cahraModal')?.style.setProperty('display', 'flex'); };
const closeCahraModal = () => document.getElementById('cahraModal')?.style.setProperty('display', 'none');
const openSocsModal = () => { cancelUserSocEdit(); renderSocsModalTable(); renderUserSocsModalTable(); document.getElementById('socsModal')?.style.setProperty('display', 'flex'); };
const closeSocsModal = () => { cancelUserSocEdit(); document.getElementById('socsModal')?.style.setProperty('display', 'none'); };
const openManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'flex');
const closeManualModal = () => document.getElementById('manualModal')?.style.setProperty('display', 'none');

function openSmelterDetailModal(rowIndex) {
  const r = consolidatedDataStore[rowIndex];
  if (!r) return;

  let modal = document.getElementById('smelterDetailModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'smelterDetailModal';
    modal.className = 'modal-backdrop';
    modal.style.cssText = 'position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(15,23,42,0.6); display:flex; align-items:center; justify-content:center; z-index:9999; backdrop-filter:blur(2px);';
    modal.innerHTML = `
      <div style="background:#ffffff; border-radius:12px; width:92%; max-width:650px; max-height:85vh; overflow-y:auto; box-shadow:0 20px 25px -5px rgba(0,0,0,0.2), 0 8px 10px -6px rgba(0,0,0,0.1); border:1px solid #e2e8f0; font-family:var(--font-sans, inherit);">
        <div style="display:flex; justify-content:space-between; align-items:center; padding:14px 20px; border-bottom:1px solid #e2e8f0; background:#f8fafc; border-top-left-radius:12px; border-top-right-radius:12px;">
          <h3 id="smelterDetailTitle" style="margin:0; font-size:1.05rem; font-weight:600; color:#0f172a; display:flex; align-items:center; gap:8px;">
            <span>Facility Details</span>
          </h3>
          <button onclick="closeSmelterDetailModal()" style="border:none; background:transparent; font-size:1.4rem; line-height:1; cursor:pointer; color:#64748b;">&times;</button>
        </div>
        <div id="smelterDetailContent" style="padding:20px; font-size:0.85rem;"></div>
        <div style="padding:12px 20px; background:#f8fafc; border-top:1px solid #e2e8f0; text-align:right; border-bottom-left-radius:12px; border-bottom-right-radius:12px;">
          <button onclick="closeSmelterDetailModal()" style="padding:6px 16px; border-radius:6px; border:1px solid #cbd5e1; background:#ffffff; color:#334155; font-size:0.82rem; cursor:pointer; font-weight:500;">Close</button>
        </div>
      </div>
    `;
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeSmelterDetailModal();
    });
    document.body.appendChild(modal);
  }

  const fields = [
    { label: 'CID', value: r[getColIndex('cid')] || '-', mono: true },
    { label: 'Standard Facility Name', value: r[getColIndex('name')] || '-' },
    { label: 'Source', value: r[getColIndex('source')] || '-' },
    { label: 'Metal', value: r[getColIndex('metal')] || '-' },
    { label: 'Facility Operational Status', value: getRowCellValue(r, getColIndex('op')) || '-' },
    { label: 'Supply Chain Level', value: getRowCellValue(r, getColIndex('level')) || '-' },
    { label: 'Due Diligence Status', value: r._rmap || '-' },
    { label: 'CAHRA Basis', value: r._cahra || '-' },
    { label: 'Country', value: r[getColIndex('country')] || '-' },
    { label: 'State / Province', value: r[getColIndex('state')] || '-' },
    { label: 'City', value: r[getColIndex('city')] || '-' },
    { label: 'Smelter Reference', value: r[getColIndex('ref')] || '-' },
    { label: 'Audit / Cycle / Reaudit', value: r[getColIndex('audit')] || '-' }
  ];

  const contentEl = document.getElementById('smelterDetailContent');
  if (contentEl) {
    contentEl.innerHTML = `
      <table style="width:100%; border-collapse:collapse; font-size:0.83rem;">
        <tbody>
          ${fields.map(f => `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:8px 6px; width:36%; color:#64748b; font-weight:500; vertical-align:top;">${f.label}</td>
              <td style="padding:8px 6px; color:#0f172a; ${f.mono ? "font-family:var(--font-mono, monospace); font-weight:600;" : ""} word-break:break-word; line-height:1.4;">${f.value}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  }

  modal.style.display = 'flex';
}

function closeSmelterDetailModal() {
  const modal = document.getElementById('smelterDetailModal');
  if (modal) modal.style.display = 'none';
}

function updateCahraModalUI() {
  const totalCount = new Set([...activeEuCahraSet, ...activeUsDoddFrankSet, ...activeUserDefinedCountrySet]).size;
  const userCount = activeUserDefinedCountrySet.size;

  const btnCahraBadge = document.getElementById('btnCahraCountBadge');
  if (btnCahraBadge) btnCahraBadge.textContent = totalCount;
  const userCountEl = document.getElementById('cahraUserCount');
  if (userCountEl) userCountEl.textContent = userCount;

  const syncBtn = (btn, isOk) => {
    if (!btn) return;
    btn.classList.toggle('active', isOk);
    const t = btn.querySelector('.preset-title');
    if (t) t.innerHTML = (isOk ? '✓ ' : '') + t.textContent.replace('✓ ', '');
  };

  syncBtn(document.getElementById('btnPresetEu'), DEFAULT_PRESET_EU.length > 0 && DEFAULT_PRESET_EU.every(c => activeEuCahraSet.has(c)));
  syncBtn(document.getElementById('btnPresetUs'), DEFAULT_PRESET_US.length > 0 && DEFAULT_PRESET_US.every(c => activeUsDoddFrankSet.has(c)));

  const presetContainer = document.getElementById('cahraPresetViewContainer');
  if (presetContainer) {
    const activeStandards = new Set([...activeEuCahraSet, ...activeUsDoddFrankSet]);
    const sorted = Array.from(activeStandards).sort();
    presetContainer.innerHTML = sorted.length ? sorted.map(c => {
      let label = 'EU';
      if (activeEuCahraSet.has(c) && activeUsDoddFrankSet.has(c)) label = 'EU&US';
      else if (activeUsDoddFrankSet.has(c)) label = 'US';
      return `<span class="cahra-tag-chip" style="background:#f8fafc; border-color:#e2e8f0; cursor:default;">
        <strong style="font-weight:normal;">${c}</strong> <small style="color:#64748b; font-size:0.68rem;">[${label}]</small>
      </span>`;
    }).join('') : '<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No standard preset active.</span>';
  }

  const userContainer = document.getElementById('cahraTagsContainer');
  if (userContainer) {
    const sorted = Array.from(activeUserDefinedCountrySet).sort();
    userContainer.innerHTML = sorted.length ? sorted.map(c => `
      <span class="cahra-tag-chip">
        <strong style="font-weight:normal;">${c}</strong> <small style="color:#0284c7; font-size:0.68rem;">[USER]</small>
        <span class="tag-del" onclick="removeUserCahraCountry('${c.replace(/'/g, "\\'")}')">&times;</span>
      </span>
    `).join('') : '<span style="font-size:0.78rem; color:#94a3b8; padding:4px;">No user-defined countries registered.</span>';
  }
}

function toggleCahraPreset(type) {
  if (type === 'EU') {
    const isFullyActive = DEFAULT_PRESET_EU.length > 0 && DEFAULT_PRESET_EU.every(c => activeEuCahraSet.has(c));
    if (isFullyActive) activeEuCahraSet.clear();
    else activeEuCahraSet = new Set(DEFAULT_PRESET_EU);
  } else if (type === 'US') {
    const isFullyActive = DEFAULT_PRESET_US.length > 0 && DEFAULT_PRESET_US.every(c => activeUsDoddFrankSet.has(c));
    if (isFullyActive) activeUsDoddFrankSet.clear();
    else activeUsDoddFrankSet = new Set(DEFAULT_PRESET_US);
  }
  clearCahraCache();
  updateCahraModalUI();
}

function addCahraCountryFromInput() {
  const inp = document.getElementById('inputNewCahraCountry');
  const val = inp?.value.trim().toUpperCase();
  if (!val) return;

  activeUserDefinedCountrySet.add(val);
  inp.value = '';
  clearCahraCache();
  updateCahraModalUI();
}

function removeUserCahraCountry(c) {
  activeUserDefinedCountrySet.delete(c);
  clearCahraCache();
  updateCahraModalUI();
}

function clearAllUserCahraCountries() {
  activeUserDefinedCountrySet.clear();
  clearCahraCache();
  updateCahraModalUI();
}

// =========================================================================
// 0-1. SoCs ENGINE & HYBRID CLOUD STORAGE (User-Isolated Multi-Tenant)
// =========================================================================
function loadSavedUserSocsConfig() {
  activeUserDefinedSocsMap.clear();
  try {
    const raw = localStorage.getItem(getUserSocsStorageKey());
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        parsed.forEach(item => {
          if (item && item.cid) {
            activeUserDefinedSocsMap.set(String(item.cid).trim().toUpperCase(), {
              userId: String(item.userId || '').trim(),
              remarks: String(item.remarks || '').trim(),
              updated: item.updated || ''
            });
          }
        });
      }
    }
  } catch(e) {}
}

function saveUserSocsLocally() {
  try {
    const arr = [];
    activeUserDefinedSocsMap.forEach((v, k) => {
      arr.push({ cid: k, userId: v.userId, remarks: v.remarks, updated: v.updated });
    });
    localStorage.setItem(getUserSocsStorageKey(), JSON.stringify(arr));
  } catch(e) {}
}

async function syncUserSocsToBackend() {
  saveUserSocsLocally();
  updateMergedSocsSet();

  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!key) return;

  const items = [];
  activeUserDefinedSocsMap.forEach((v, k) => {
    items.push({ cid: k, remarks: v.remarks });
  });

  try {
    await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'save_user_socs',
        auth: key,
        items: items
      })
    });
  } catch(e) {
    console.warn("Backend user SoC sync warning:", e);
  }
}

function updateMergedSocsSet() {
  const masterIds = socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean);
  const userIds = Array.from(activeUserDefinedSocsMap.keys());
  activeSocsSet = new Set([...masterIds, ...userIds]);

  const btnBadge = document.getElementById('btnSocsCountBadge');
  if (btnBadge) btnBadge.textContent = activeSocsSet.size;

  const countBadge = document.getElementById('socsModalCountBadge');
  if (countBadge) countBadge.textContent = `Common: ${socMasterRows.length} | User: ${activeUserDefinedSocsMap.size}`;

  const userCountEl = document.getElementById('socsUserCount');
  if (userCountEl) userCountEl.textContent = activeUserDefinedSocsMap.size;

  renderUserSocsModalTable();

  if (smelterAnalysisRawRows.length) {
    const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
    const masterRemarksMap = new Map();
    socMasterRows.forEach(r => {
      const cid = String(r[0] || '').trim().toUpperCase();
      if (cid) masterRemarksMap.set(cid, String(r[5] || '').trim());
    });

    smelterAnalysisRawRows.forEach(r => {
      if (masterIdsSet.has(r.smelterId)) {
        r.userSoc = 'Y (Common)';
        r.remarks = masterRemarksMap.get(r.smelterId) || '-';
      } else if (activeUserDefinedSocsMap.has(r.smelterId)) {
        r.userSoc = 'Y (User)';
        r.remarks = activeUserDefinedSocsMap.get(r.smelterId)?.remarks || '-';
      } else {
        r.userSoc = '-';
        r.remarks = '-';
      }
    });
    renderSmelterAnalysisKpiBar();
    filterSmelterAnalysisRows();
  }
}

function addUserSocFromInputs() {
  const cidInput = document.getElementById('inputNewUserSocId');
  const remarksInput = document.getElementById('inputNewUserSocRemarks');
  const feedback = document.getElementById('userSocFeedbackMsg');

  const rawCid = cidInput ? cidInput.value.trim() : '';
  const inputRemarks = remarksInput ? remarksInput.value.trim() : '';

  if (!rawCid) {
    if (feedback) feedback.textContent = 'Please enter or paste at least one CID.';
    return;
  }

  const userProfile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
  const currentUserId = userProfile?.userId || 'User';

  const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
  const nowStr = new Date().toISOString().replace('T', ' ').substring(0, 19);

  // 1. 수정 모드일 때 처리
  if (editingUserSocCid) {
    const targetCid = editingUserSocCid.toUpperCase();
    const existing = activeUserDefinedSocsMap.get(targetCid);
    activeUserDefinedSocsMap.set(targetCid, {
      userId: existing?.userId || currentUserId,
      remarks: inputRemarks || '-',
      updated: nowStr
    });
    cancelUserSocEdit();
    syncUserSocsToBackend();
    if (feedback) {
      feedback.textContent = `Updated ${targetCid} successfully.`;
      feedback.style.color = '#16a34a';
    }
    return;
  }

  // 2. 신규 추가 모드 (단일 입력 또는 탭/줄바꿈 복사 지원)
  let addedCount = 0, masterSkipped = 0;
  const lines = rawCid.split(/[\r\n]+/);
  lines.forEach(line => {
    const parts = line.split('\t');
    const cid = String(parts[0] || '').trim().toUpperCase();
    const lineRemarks = parts[1] ? parts[1].trim() : inputRemarks;

    if (!cid) return;
    if (masterIdsSet.has(cid)) {
      masterSkipped++;
    } else {
      activeUserDefinedSocsMap.set(cid, {
        userId: currentUserId,
        remarks: lineRemarks || '-',
        updated: nowStr
      });
      addedCount++;
    }
  });

  if (cidInput) cidInput.value = '';
  if (remarksInput) remarksInput.value = '';

  syncUserSocsToBackend();

  let msg = `Saved ${addedCount} CID(s) to User DB.`;
  if (masterSkipped > 0) msg += ` (${masterSkipped} already exist in Common list)`;
  if (feedback) {
    feedback.textContent = msg;
    feedback.style.color = addedCount > 0 ? '#16a34a' : '#d97706';
  }
}

function editUserSoc(cid) {
  const data = activeUserDefinedSocsMap.get(cid);
  if (!data) return;

  editingUserSocCid = cid;
  const cidInput = document.getElementById('inputNewUserSocId');
  const remarksInput = document.getElementById('inputNewUserSocRemarks');
  const submitBtn = document.getElementById('btnSubmitUserSoc');
  const cancelBtn = document.getElementById('btnCancelUserSocEdit');
  const editIndicator = document.getElementById('userSocEditModeIndicator');

  if (cidInput) {
    cidInput.value = cid;
    cidInput.readOnly = true;
    cidInput.style.backgroundColor = '#f1f5f9';
  }
  if (remarksInput) {
    remarksInput.value = data.remarks === '-' ? '' : data.remarks;
    remarksInput.focus();
  }
  if (submitBtn) {
    submitBtn.textContent = '✏️ Update';
    submitBtn.style.backgroundColor = '#0284c7';
  }
  if (cancelBtn) cancelBtn.style.display = 'inline-block';
  if (editIndicator) editIndicator.style.display = 'inline-block';
}

function cancelUserSocEdit() {
  editingUserSocCid = null;
  const cidInput = document.getElementById('inputNewUserSocId');
  const remarksInput = document.getElementById('inputNewUserSocRemarks');
  const submitBtn = document.getElementById('btnSubmitUserSoc');
  const cancelBtn = document.getElementById('btnCancelUserSocEdit');
  const editIndicator = document.getElementById('userSocEditModeIndicator');

  if (cidInput) {
    cidInput.value = '';
    cidInput.readOnly = false;
    cidInput.style.backgroundColor = '#ffffff';
  }
  if (remarksInput) remarksInput.value = '';
  if (submitBtn) {
    submitBtn.textContent = '+ Add';
    submitBtn.style.backgroundColor = '#1e293b';
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (editIndicator) editIndicator.style.display = 'none';
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
  if (feedback) {
    feedback.textContent = 'All user-defined CIDs cleared from Cloud DB.';
    feedback.style.color = '#dc2626';
  }
}

function renderSocsModalTable() {
  const thead = document.getElementById('socsModalTableHead');
  const tbody = document.getElementById('socsModalTableBody');

  if (!thead || !tbody) return;

  const headers = [
    { title: 'CID', align: 'center' },
    { title: 'Metal', align: 'left' },
    { title: 'Name', align: 'left' },
    { title: 'Country', align: 'left' },
    { title: 'Year Identified', align: 'center' },
    { title: 'Remarks', align: 'left' }
  ];

  thead.innerHTML = `<tr>${headers.map(h => `<th style="text-align:${h.align}; padding:6px 6px; font-weight:normal; font-size:0.76rem; white-space:nowrap;">${h.title}</th>`).join('')}</tr>`;

  if (!socMasterRows.length) {
    tbody.innerHTML = `<tr><td colspan="${headers.length}" style="text-align:center; padding:16px; color:#94a3b8;">No Smelters of Concern records registered in Common sheet.</td></tr>`;
    return;
  }

  tbody.innerHTML = socMasterRows.map(r => `
    <tr>
      <td style="text-align:center; padding:5px 4px; font-family:'Consolas',monospace; font-weight:normal; color:#dc2626;">
        <span class="clickable-cid" onclick="copyTextToClipboard('${r[0]}', this)" title="Click to copy">${r[0] || '-'}</span>
      </td>
      <td style="text-align:left; padding:5px 8px; font-size:0.76rem;">${r[1] || '-'}</td>
      <td style="text-align:left; padding:5px 8px; font-size:0.76rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r[2] || '-'}">${r[2] || '-'}</td>
      <td style="text-align:left; padding:5px 8px; font-size:0.76rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${r[3] || '-'}">${r[3] || '-'}</td>
      <td style="text-align:center; padding:5px 4px; font-size:0.76rem; white-space:nowrap;">${r[4] || '-'}</td>
      <td style="text-align:left; padding:5px 8px; font-size:0.76rem; color:#dc2626; overflow:hidden; text-overflow:ellipsis; white-space:normal; word-break:break-word; line-height:1.3;" title="${r[5] || '-'}">${r[5] || '-'}</td>
    </tr>
  `).join('');
}

function renderUserSocsModalTable() {
  const tbody = document.getElementById('socsUserTableBody');
  if (!tbody) return;

  if (!activeUserDefinedSocsMap.size) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:14px; color:#94a3b8;">No user-defined CIDs registered yet.</td></tr>`;
    return;
  }

  const entries = Array.from(activeUserDefinedSocsMap.entries());
  tbody.innerHTML = entries.map(([cid, data]) => `
    <tr>
      <td style="text-align:center; padding:5px 4px; font-weight:500; color:#334155; font-size:0.75rem;">${data.userId || '-'}</td>
      <td style="text-align:center; padding:5px 4px; font-family:'Consolas',monospace; font-weight:normal; color:#0284c7;">
        <span class="clickable-cid" onclick="copyTextToClipboard('${cid}', this)" title="Click to copy">${cid}</span>
      </td>
      <td style="text-align:left; padding:5px 8px; overflow:hidden; text-overflow:ellipsis; white-space:normal; word-break:break-word; line-height:1.3;" title="${data.remarks}">${data.remarks || '-'}</td>
      <td style="text-align:center; padding:5px 4px; color:#64748b; font-size:0.73rem;">${data.updated || '-'}</td>
      <td style="text-align:center; padding:5px 4px; white-space:nowrap;">
        <button type="button" onclick="editUserSoc('${cid.replace(/'/g, "\\'")}')" style="background:none; border:none; color:#0284c7; cursor:pointer; font-size:0.85rem; padding:0 3px;" title="Edit Remarks">✏️</button>
        <button type="button" onclick="removeUserSoc('${cid.replace(/'/g, "\\'")}')" style="background:none; border:none; color:#dc2626; cursor:pointer; font-size:0.85rem; padding:0 3px;" title="Delete">🗑️</button>
      </td>
    </tr>
  `).join('');
}

function processSoCsData(headers = [], rows = []) {
  socMasterHeaders = Array.isArray(headers) ? headers : [];
  socMasterRows = Array.isArray(rows) ? rows : [];
  updateMergedSocsSet();
}

function processUserSoCsData(userSocItems = []) {
  // 백엔드 응답 시 이전 잔여 데이터 초기화
  activeUserDefinedSocsMap.clear();

  const userProfile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
  const defaultUid = userProfile?.userId || 'User';

  if (Array.isArray(userSocItems) && userSocItems.length > 0) {
    userSocItems.forEach(item => {
      const cid = String(item.cid || '').trim().toUpperCase();
      if (cid) {
        activeUserDefinedSocsMap.set(cid, {
          userId: String(item.userId || defaultUid).trim(),
          remarks: String(item.remarks || '-').trim(),
          updated: item.updated || ''
        });
      }
    });
  }

  // 현재 사용자 기준으로 localStorage 동기화 (빈 배열이면 스토리지도 비워짐)
  saveUserSocsLocally();
  updateMergedSocsSet();
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
        <strong style="font-size:0.9rem; color:#0f172a; font-weight:normal;">${item.title}</strong><br>
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

function switchSmelterSubTab(tab, btnElem) {
  document.querySelectorAll('#viewSmelter .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewSmelter .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const defaultBtn = document.getElementById(`btnSmelterTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`);
    defaultBtn?.classList.add('active');
  }

  const paneId = `smelterSubPane${tab.charAt(0).toUpperCase() + tab.slice(1)}`;
  document.getElementById(paneId)?.classList.add('active');

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
      const req = indexedDB.open(SMELTER_DB_NAME, 2);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('smelters')) db.createObjectStore('smelters', { keyPath: 'id', autoIncrement: true });
        if (!db.objectStoreNames.contains('socs')) db.createObjectStore('socs', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch(e) { res(null); }
  });
}

async function saveSmelterToDB(headers, rows, lastUpdated, socHeaders = [], socRows = []) {
  try {
    const db = await openSmelterDB();
    if (!db) return;
    const tx = db.transaction(['smelters', 'socs'], 'readwrite');
    
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
  } catch(e) {}
}

async function loadSmelterFromDB() {
  try {
    const db = await openSmelterDB();
    if (!db) return null;
    return new Promise(res => {
      const tx = db.transaction(['smelters', 'socs'], 'readonly');
      const reqSmelters = tx.objectStore('smelters').getAll();
      const reqSoc = tx.objectStore('socs').get('soc_data');

      let smelterRes = null, socRes = null;

      reqSmelters.onsuccess = () => { smelterRes = reqSmelters.result || []; };
      reqSoc.onsuccess = () => { socRes = reqSoc.result || null; };

      tx.oncomplete = () => {
        if (!smelterRes || !smelterRes.length) return res(null);
        const meta = smelterRes.find(i => i.id === 'metadata');
        res({ 
          headers: meta?.headers || [], 
          lastUpdated: meta?.lastUpdated || '', 
          rows: smelterRes.filter(i => i.id !== 'metadata').map(i => i.rowData),
          socHeaders: socRes?.headers || [],
          socRows: socRes?.rows || []
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
      const tx = db.transaction(['smelters', 'socs'], 'readwrite');
      tx.objectStore('smelters').clear();
      tx.objectStore('socs').clear();
    }
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
    rmap: findHeaderColIdx(['ddstatus', 'dd', 'auditstatus', 'rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) !== -1 ? findHeaderColIdx(['ddstatus', 'dd', 'auditstatus', 'rmapstatus', 'assessmentprogramstatus', 'programstatus', 'conformance', 'rmap']) : 12,
    audit: findHeaderColIdx(['lastaudit', 'audit', 'cycle']) !== -1 ? findHeaderColIdx(['lastaudit', 'audit', 'cycle']) : 13
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
  loadSavedUserSocsConfig();
  updateCahraModalUI();
  buildHeaderIndexMap();

  const cached = await loadSmelterFromDB();
  if (cached?.rows?.length) {
    consolidatedHeaderStore = (cached.headers && cached.headers.length >= 12) ? cached.headers : consolidatedHeaderStore;
    buildHeaderIndexMap();
    consolidatedDataStore = memoizeAndDeduplicateSmelterRows(cached.rows);
    window.consolidatedDataStore = consolidatedDataStore;
    smelterCurrentLastUpdated = cached.lastUpdated || '';
    
    if (cached.socRows?.length) {
      processSoCsData(cached.socHeaders, cached.socRows);
    } else {
      updateMergedSocsSet();
    }

    renderSmelterViewerTable();
    filterSmelterTableRows();
  } else {
    updateMergedSocsSet();
    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) {
      await fetchSmelterData(key, true);
    }
  }
  renderSmelterUsefulLinks();
}

async function fetchSmelterData(authKey = '', forceReload = false) {
  const key = authKey || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) return;

  const tsToSend = (forceReload || !consolidatedDataStore.length) ? '' : smelterCurrentLastUpdated;

  try {
    const resp = await fetch(URL_SMELTER, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data', clientLastUpdated: tsToSend })
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      smelterCurrentLastUpdated = res.lastUpdated || smelterCurrentLastUpdated;
      if (!consolidatedDataStore.length) {
        const cached = await loadSmelterFromDB();
        if (cached?.rows?.length) {
          consolidatedDataStore = memoizeAndDeduplicateSmelterRows(cached.rows);
          window.consolidatedDataStore = consolidatedDataStore;
        }
      }
      renderSmelterViewerTable();
      filterSmelterTableRows();
      return res;
    }

    const raw = Array.isArray(res?.data) ? res.data : (Array.isArray(res) ? res : []);
    if (res?.headers?.length) consolidatedHeaderStore = res.headers;
    buildHeaderIndexMap();
    
    if (Array.isArray(res?.socRows)) {
      processSoCsData(res.socHeaders, res.socRows);
    }

    // 백엔드에서 반환된 현재 사용자 전용 SoC 항목 동기화
    if (Array.isArray(res?.userSocItems)) {
      processUserSoCsData(res.userSocItems);
    }

    if (raw.length) {
      consolidatedDataStore = memoizeAndDeduplicateSmelterRows(raw);
      window.consolidatedDataStore = consolidatedDataStore;
      smelterCurrentLastUpdated = res.lastUpdated || '';
      await saveSmelterToDB(consolidatedHeaderStore, raw, smelterCurrentLastUpdated, socMasterHeaders, socMasterRows);
      renderSmelterViewerTable();
      filterSmelterTableRows();
    }
    return res;
  } catch(e) { 
    console.error("fetchSmelterData error:", e); 
  }
}

// =========================================================================
// 5. DASHBOARD & MASTER TABLE
// =========================================================================
function updateSmelterDashboardCounts() {
  buildHeaderIndexMap();

  const updateDateEl = document.getElementById('smelterSummaryUpdateDate');
  if (updateDateEl) {
    updateDateEl.textContent = smelterCurrentLastUpdated ? `Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)` : 'Latest Harvest: Live Synced';
  }

  const metalIdx = getColIndex('metal');
  const rmapIdx = getColIndex('rmap');
  const levelIdx = getColIndex('level');

  // 1. Audit Status Breakdown
  const rowsForRmap = getSmelterAvailableRows(rmapIdx);
  const rmapMap = {};
  rowsForRmap.forEach(r => {
    const st = r._rmap || normalizeRmapStatus(r[rmapIdx]) || 'Identified';
    rmapMap[st] = (rmapMap[st] || 0) + 1;
  });
  const totalRmap = rowsForRmap.length || 1;

  const rmapColorMap = {
    'Conformant': '#16a34a',
    'Active': '#0284c7',
    'Identified': '#64748b',
    'Removed': '#dc2626',
    'Facility Standard Assessed': '#7c3aed',
    'In Communication': '#d97706'
  };

  const rmapFilterSet = smelterMultiSelectFilters[String(rmapIdx)] || new Set();
  const sortedRmap = Object.entries(rmapMap).sort((a, b) => b[1] - a[1]);

  let rBarHtml = '', rChipsHtml = '';
  sortedRmap.forEach(([st, count], idx) => {
    const defaultColor = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#64748b';
    const color = rmapColorMap[st] || defaultColor;
    const pct = ((count / totalRmap) * 100).toFixed(1);

    rBarHtml += `<div class="p-segment" style="width:${(count / totalRmap) * 100}%; background:${color};" title="${escapeHtmlAttr(st)}: ${count.toLocaleString()} (${pct}%)"></div>`;
    
    rChipsHtml += `
      <span class="insight-chip tag ${rmapFilterSet.has(st) ? 'active' : ''}" data-col="${rmapIdx}" data-tag="${escapeHtmlAttr(st)}" onclick="toggleSmelterDashboardFilter(${rmapIdx}, this.getAttribute('data-tag'))">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong style="font-weight:normal;">${escapeHtmlText(st)}</strong>
        <span class="insight-chip-badge" style="font-weight:normal;">${count.toLocaleString()} (${pct}%)</span>
      </span>`;
  });

  const rmapBarWrap = document.getElementById('rmapProgressBarWrap');
  if (rmapBarWrap && rBarHtml) rmapBarWrap.innerHTML = rBarHtml;
  
  const rmapChipsWrap = document.getElementById('smelterRmapChipsWrap');
  if (rmapChipsWrap) rmapChipsWrap.innerHTML = rChipsHtml;
  
  const rmapTotalLabel = document.getElementById('rmapTotalLabel');
  if (rmapTotalLabel) rmapTotalLabel.textContent = `${rowsForRmap.length.toLocaleString()} facilities`;

  // 2. Level Breakdown
  const rowsForLevel = getSmelterAvailableRows(levelIdx);
  const levelMap = {};
  rowsForLevel.forEach(r => {
    const lvl = getRowCellValue(r, levelIdx) || 'Unassigned';
    levelMap[lvl] = (levelMap[lvl] || 0) + 1;
  });
  const totalLevel = rowsForLevel.length || 1;

  const levelColorMap = {
    'Pinch Point': '#0284c7',
    'Downstream': '#16a34a',
    'Mine': '#d97706',
    'Upstream': '#7c3aed',
    '-': '#94a3b8'
  };

  const levelFilterSet = smelterMultiSelectFilters[String(levelIdx)] || new Set();
  const sortedLevels = Object.entries(levelMap).sort((a, b) => b[1] - a[1]);

  let lBarHtml = '', lChipsHtml = '';
  sortedLevels.forEach(([lvl, count], idx) => {
    const defaultColor = (typeof PALETTE !== 'undefined' && PALETTE[idx % PALETTE.length]) || '#475569';
    const color = levelColorMap[lvl] || defaultColor;
    const pct = ((count / totalLevel) * 100).toFixed(1);

    lBarHtml += `<div class="p-segment" style="width:${(count / totalLevel) * 100}%; background:${color};" title="${escapeHtmlAttr(lvl)}: ${count.toLocaleString()} (${pct}%)"></div>`;
    
    lChipsHtml += `
      <span class="insight-chip tag ${levelFilterSet.has(lvl) ? 'active' : ''}" data-col="${levelIdx}" data-tag="${escapeHtmlAttr(lvl)}" onclick="toggleSmelterDashboardFilter(${levelIdx}, this.getAttribute('data-tag'))">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong style="font-weight:normal;">${escapeHtmlText(lvl)}</strong>
        <span class="insight-chip-badge" style="font-weight:normal;">${count.toLocaleString()} (${pct}%)</span>
      </span>`;
  });

  const levelBarWrap = document.getElementById('levelProgressBarWrap');
  if (levelBarWrap) levelBarWrap.innerHTML = lBarHtml;

  const levelLegendGrid = document.getElementById('levelLegendGrid');
  if (levelLegendGrid) levelLegendGrid.innerHTML = lChipsHtml;

  const levelTotalLabel = document.getElementById('levelTotalLabel');
  if (levelTotalLabel) levelTotalLabel.textContent = `${rowsForLevel.length.toLocaleString()} facilities`;

  // 3. Metal Type Distribution
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
    mBar += `<div class="p-segment" style="width:${(count / totalMetal) * 100}%; background:${color};" title="${escapeHtmlAttr(m)}: ${count.toLocaleString()} (${pct}%)"></div>`;
    mLeg += `
      <span class="insight-chip tag ${metalFilterSet.has(m) ? 'active' : ''}" data-col="${metalIdx}" data-tag="${escapeHtmlAttr(m)}" onclick="toggleSmelterDashboardFilter(${metalIdx}, this.getAttribute('data-tag'))">
        <span class="legend-dot" style="background:${color}; display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:4px;"></span><strong style="font-weight:normal;">${escapeHtmlText(m)}</strong>
        <span class="insight-chip-badge" style="font-weight:normal;">${count.toLocaleString()} (${pct}%)</span>
      </span>`;
  });

  const metalProgressBarWrap = document.getElementById('metalProgressBarWrap');
  if (metalProgressBarWrap) metalProgressBarWrap.innerHTML = mBar;
  
  const metalLegendGrid = document.getElementById('metalLegendGrid');
  if (metalLegendGrid) metalLegendGrid.innerHTML = mLeg;
  
  const metalTotalLabel = document.getElementById('metalTotalLabel');
  if (metalTotalLabel) metalTotalLabel.textContent = `${rowsForMetal.length.toLocaleString()} facilities`;
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
    { origIdx: getColIndex('metal'), header: 'Metal', widthPct: '5.5%', isMulti: true },
    { origIdx: getColIndex('cid'), header: 'CID', widthPct: '10.5%', isMulti: false, isCid: true },
    { origIdx: getColIndex('op'), header: 'Operation', widthPct: '8.5%', isMulti: true },
    { origIdx: getColIndex('level'), header: 'Level', widthPct: '8.0%', isMulti: true },
    { origIdx: getColIndex('rmap'), header: 'DD Status', widthPct: '8.5%', isMulti: true },
    { origIdx: getColIndex('country'), header: 'Country', widthPct: '8.5%', isMulti: false },
    { origIdx: 'CAHRA', countryColIdx: getColIndex('country'), header: 'CAHRA Basis', widthPct: '10.0%', isMulti: true, isCustom: true },
    { origIdx: getColIndex('name'), header: 'Standard Facility Name', widthPct: '24.0%', isMulti: false, isEllipsis: true },
    { origIdx: getColIndex('audit'), header: 'Auditted/Cycle/Reaudit', widthPct: '17.5%', isMulti: false, isAuditCycle: true }
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
  hRow.innerHTML = ''; 
  fRow.innerHTML = '';
  smelterTableFilters = {}; 
  smelterMultiSelectFilters = {};

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
    } else {
      fRow.innerHTML += '<th class="filter-th" style="padding:4px 2px;"></th>';
    }
  });

  tbl.insertBefore(colgroup, tbl.firstChild);
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
    unique.map(v => `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleSmelterDropdownItem('${strKey}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${strKey === String(getColIndex('rmap')) ? getStatusBadge(v) : v}</span></label>`).join('');
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

  renderSmelterCurrentPage();

  try {
    updateSmelterDashboardCounts();
  } catch(e) {}

  try {
    populateSmelterDropdownFilters();
  } catch(e) {}
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
      if (col.isCustom && idx === 'CAHRA') {
        return `<td style="text-align:center; padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r._cahra)}</td>`;
      }
      if (idx === 0) return `<td style="text-align:center; font-weight:normal; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>`;
      if (idx === rmapIdx) return `<td style="text-align:center; padding:6px 2px; white-space:nowrap;">${getStatusBadge(r._rmap)}</td>`;
      
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

      if (col.isAuditCycle) {
        return `<td style="padding:6px 6px; font-size:0.76rem; white-space:normal; word-break:break-word; line-height:1.35; color:#334155;" title="${val}">${val || '-'}</td>`;
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
// 6. CID CHECKER
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

  const masterMap = new Map();
  consolidatedDataStore.forEach(r => {
    const sid = String(r[idIdx] || '').trim().toUpperCase();
    if (sid && !masterMap.has(sid)) masterMap.set(sid, r);
  });

  const masterIdsSet = new Set(socMasterRows.map(r => String(r[0] || '').trim().toUpperCase()).filter(Boolean));
  const masterRemarksMap = new Map();
  socMasterRows.forEach(r => {
    const cid = String(r[0] || '').trim().toUpperCase();
    if (cid) masterRemarksMap.set(cid, String(r[5] || '').trim());
  });

  smelterAnalysisRawRows = [];

  ids.forEach(id => {
    let socLabel = '-';
    let remarksText = '-';

    if (masterIdsSet.has(id)) {
      socLabel = 'Y (Common)';
      remarksText = masterRemarksMap.get(id) || '-';
    } else if (activeUserDefinedSocsMap.has(id)) {
      socLabel = 'Y (User)';
      remarksText = activeUserDefinedSocsMap.get(id)?.remarks || '-';
    }

    if (masterMap.has(id)) {
      const r = masterMap.get(id);
      smelterAnalysisRawRows.push({
        metal: r[metalIdx] || '-',
        smelterId: r[idIdx] || id,
        opStatus: getRowCellValue(r, opIdx),
        level: getRowCellValue(r, levelIdx),
        rmapStatus: r._rmap,
        country: r[cIdx] || '-',
        cahra: r._cahra,
        userSoc: socLabel,
        smelterName: r[nameIdx] || '-',
        remarks: remarksText
      });
    } else {
      smelterAnalysisRawRows.push({
        metal: '-',
        smelterId: id,
        opStatus: '-',
        level: '-',
        rmapStatus: 'Unmatched',
        country: '-',
        cahra: '-',
        userSoc: socLabel,
        smelterName: 'Unknown / Not in Master DB',
        remarks: remarksText
      });
    }
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
    const st = r.rmapStatus;
    if (st === 'Conformant') conf++;
    else if (st === 'Active') act++;
    else if (st === 'Identified') ident++;
    else if (st === 'Unmatched') unmatch++;
    else others++;

    if (r.userSoc && r.userSoc.startsWith('Y')) socs++;
  });

  const exceptConf = total - conf;
  const exceptConfAct = total - conf - act;
  const isAll = !activeAnalysisKpiFilterSet.size;

  const actionChips = [
    { key: 'ALL', label: '📥 Input IDs:', count: total, active: isAll },
    { key: 'EXCEPT_CONF', label: '⚠️ Except Conformant:', count: exceptConf, active: activeAnalysisKpiFilterSet.has('EXCEPT_CONF'), color: '#d97706' },
    { key: 'EXCEPT_CONF_ACT', label: '🚨 Except Conformant & Active:', count: exceptConfAct, active: activeAnalysisKpiFilterSet.has('EXCEPT_CONF_ACT'), color: '#7c3aed' },
    { key: 'SOCS', label: '📋 Smelters of Concern:', count: socs, active: activeAnalysisKpiFilterSet.has('SOCS'), color: '#dc2626' }
  ];

  const actionChipsHtml = actionChips.map(c => `
    <div class="smelter-analysis-kpi-chip insight-chip tag ${c.active ? 'active' : ''}" style="cursor:pointer;" onclick="toggleAnalysisKpiFilter('${c.key}')">
      <span style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:600;">${c.label}</span>
      <strong style="${c.color && !c.active ? `color:${c.color};` : ''} font-weight:700;">${c.count}</strong>
    </div>
  `).join('');

  const statsTextHtml = `
    <div style="display:flex; align-items:center; gap:10px; font-size:0.77rem; color:var(--text-muted); padding:4px 8px; background:#fff; border:1px solid var(--border-darker); border-radius:6px; margin-left:auto; white-space:nowrap;">
      <span><strong>Conformant:</strong> <span style="color:#16a34a; font-weight:normal;">${conf}</span></span>
      <span style="color:var(--border-darker);">·</span>
      <span><strong>Active:</strong> <span style="color:#0284c7; font-weight:normal;">${act}</span></span>
      <span style="color:var(--border-darker);">·</span>
      <span><strong>Identified:</strong> <span style="color:#64748b; font-weight:normal;">${ident}</span></span>
      <span style="color:var(--border-darker);">·</span>
      <span><strong>Unmatched:</strong> <span style="color:#dc2626; font-weight:normal;">${unmatch}</span></span>
      <span style="color:var(--border-darker);">·</span>
      <span><strong>Others:</strong> <span style="color:#7c3aed; font-weight:normal;">${others}</span></span>
    </div>
  `;

  kpiBar.style.display = 'flex';
  kpiBar.style.alignItems = 'center';
  kpiBar.style.justifyContent = 'flex-start';
  kpiBar.style.gap = '8px';
  kpiBar.style.flexWrap = 'wrap';
  kpiBar.innerHTML = actionChipsHtml + statsTextHtml;
}

function toggleAnalysisKpiFilter(type) {
  if (type === 'ALL') {
    activeAnalysisKpiFilterSet.clear();
  } else {
    activeAnalysisKpiFilterSet.has(type) ? activeAnalysisKpiFilterSet.delete(type) : activeAnalysisKpiFilterSet.add(type);
  }

  renderSmelterAnalysisKpiBar();
  filterSmelterAnalysisRows();
}

function resetSmelterAnalysisFilterInputs() {
  document.querySelectorAll('#smelterAnalysisFilterRow .filter-input').forEach(inp => inp.value = '');
  ['opStatus', 'level', 'rmapStatus', 'cahra', 'userSoc'].forEach(k => {
    const txt = document.getElementById(`analysisMsText_${k}`);
    if (txt) txt.textContent = 'All';
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

function onAnalysisFilterChange(propKey, val) {
  smelterAnalysisFilters[propKey] = val.trim();
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
    unique.map(v => {
      let displayLabel = v;
      if (key === 'rmapStatus') {
        displayLabel = getStatusBadge(v);
      } else if (key === 'userSoc' && v.startsWith('Y')) {
        displayLabel = `<span style="color:#dc2626; font-weight:normal;">${v}</span>`;
      }
      return `<label class="multiselect-item"><input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="toggleAnalysisDropdownItem('${key}', '${v.replace(/'/g, "\\'")}', this.checked)"> <span>${displayLabel}</span></label>`;
    }).join('');
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
      if (activeAnalysisKpiFilterSet.has('EXCEPT_CONF') && r.rmapStatus !== 'Conformant') ok = true;
      if (activeAnalysisKpiFilterSet.has('EXCEPT_CONF_ACT') && r.rmapStatus !== 'Conformant' && r.rmapStatus !== 'Active') ok = true;
      if (activeAnalysisKpiFilterSet.has('SOCS') && r.userSoc && r.userSoc.startsWith('Y')) ok = true;
      if (!ok) return false;
    }

    for (const [propKey, kw] of Object.entries(smelterAnalysisFilters)) {
      if (!kw) continue;
      const val = String(r[propKey] || '').trim();
      if (!val.toLowerCase().includes(kw.toLowerCase())) return false;
    }

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
      <td style="text-align:center; font-weight:normal; color:#64748b; padding:6px 2px; font-size:0.78rem;">${i + 1}</td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.metal}</td>
      <td style="text-align:center; padding:6px 2px; font-family:'Consolas',monospace;"><span class="clickable-cid" onclick="copyTextToClipboard('${r.smelterId}', this)" title="Click to copy">${r.smelterId}</span></td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.opStatus}</td>
      <td style="text-align:center; padding:6px 2px; font-size:0.78rem;">${r.level}</td>
      <td style="text-align:center; padding:6px 2px;">${getStatusBadge(r.rmapStatus)}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.country}">${r.country}</td>
      <td style="text-align:center; padding:6px 4px; white-space:nowrap; overflow:visible;">${getCahraBadge(r.cahra)}</td>
      <td style="text-align:center; padding:6px 2px; font-weight:normal; color:${r.userSoc.startsWith('Y') ? '#dc2626' : 'inherit'}; font-size:0.80rem;">${r.userSoc}</td>
      <td style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding:6px 4px; font-size:0.78rem;" title="${r.smelterName}">${r.smelterName}</td>
      <td style="padding:6px 6px; font-size:0.78rem; color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:normal; word-break:break-word;" title="${r.remarks}">${r.remarks || '-'}</td>
    </tr>
  `).join('');
}

// =========================================================================
// 7. EXPORT & CLIPBOARD COPY ENGINE
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
    if (r.cahra === 'EU & US') cColor = 'color:#dc2626;';
    else if (r.cahra === 'EU CAHRA') cColor = 'color:#059669;';
    else if (r.cahra === 'US Dodd-Frank') cColor = 'color:#7c3aed;';
    else if (r.cahra === 'User-defined') cColor = 'color:#0284c7;';

    const sColor = r.rmapStatus === 'Conformant' ? 'color:#16a34a;' : (r.rmapStatus === 'Active' ? 'color:#0284c7;' : (r.rmapStatus === 'Unmatched' ? 'color:#dc2626;' : 'color:#334155;'));

    tableHtml += `<tr style="background-color:${rowBg};"><td style="border:1px solid #cbd5e1; text-align:center;">${i + 1}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.metal}</td><td style="border:1px solid #cbd5e1; text-align:center; font-family:monospace; font-weight:normal;">${r.smelterId}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.opStatus}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.level}</td><td style="border:1px solid #cbd5e1; text-align:center; ${sColor}">${r.rmapStatus}</td><td style="border:1px solid #cbd5e1; text-align:center;">${r.country}</td><td style="border:1px solid #cbd5e1; text-align:center; ${cColor}">${r.cahra}</td><td style="border:1px solid #cbd5e1; text-align:center; color:${r.userSoc.startsWith('Y') ? '#dc2626' : 'inherit'}; font-weight:normal;">${r.userSoc}</td><td style="border:1px solid #cbd5e1;">${r.smelterName}</td><td style="border:1px solid #cbd5e1;">${r.remarks}</td></tr>`;
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
// 전역 바인딩
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

// Smelter Detail View Handlers
window.openSmelterDetailModal = openSmelterDetailModal;
window.closeSmelterDetailModal = closeSmelterDetailModal;

// CAHRA Modal Handlers
window.openCahraModal = openCahraModal;
window.closeCahraModal = closeCahraModal;
window.toggleCahraPreset = toggleCahraPreset;
window.addCahraCountryFromInput = addCahraCountryFromInput;
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

// Manual & Analysis
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
