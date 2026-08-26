/* =========================================================================
   SUBSTANCE LOG MODULE
   ========================================================================= */
const URL_SUBSTANCE = 'https://script.google.com/macros/s/AKfycbxiXjBrQd0PzxiTKjbo-xT9816xq31K444psq6jwDxy7Kcd_W8We3rwjRwICb1hLn2O/exec';
const SUBST_DB_NAME = 'a2MDS_SubstanceLog_DB';

let substRawHeaders = [], substDisplayHeaders = [], substanceDataset = [], substTableFilters = [], substMultiSelectFilters = {};
let substCurrentPage = 1, substPageSize = 100, substFilteredIndices = [];
let substCurrentLastUpdated = '', substFilterDebounceTimer = null;

const formatBlank = v => (v === undefined || v === null || String(v).trim() === '-' ? '' : String(v).trim());

function openSubstDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(SUBST_DB_NAME, 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('substances')) db.deleteObjectStore('substances');
      db.createObjectStore('substances', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
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
        res({ headers: item.headers || [], lastUpdated: item.lastUpdated || '', rows: item.rows });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearSubstIndexedDB() { 
  try { const db = await openSubstDB(); db.transaction('substances', 'readwrite').objectStore('substances').clear(); } catch(e) {} 
}

async function initSubstanceModule() {
  const cachedSubst = await loadSubstFromDB();
  if (cachedSubst?.rows?.length) {
    substRawHeaders = cachedSubst.headers; 
    substanceDataset = cachedSubst.rows; 
    substCurrentLastUpdated = cachedSubst.lastUpdated || '';
    setupSubstHeadersAndBuildTable();
    if (substCurrentLastUpdated) document.getElementById('substLastModifiedBadge').textContent = `Last Modified: ${substCurrentLastUpdated} KST(UTC+9)`;
    filterSubstTableRows();
  }
}

async function syncSubstanceData(authOverride = '', forceReload = false) {
  const key = authOverride || getStoredAuthKey();
  if (!key) return;

  const btnSync = document.getElementById('btnSyncCloudSubst');
  if (btnSync) { btnSync.textContent = '⏳ Syncing...'; btnSync.disabled = true; }
  document.getElementById('substViewerBadgeCount').textContent = 'Syncing...';

  try {
    const payload = { auth: key, action: 'fetch_data', clientLastUpdated: forceReload ? '' : substCurrentLastUpdated };
    const resp = await fetch(URL_SUBSTANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      document.getElementById('substViewerBadgeCount').textContent = `Showing ${substFilteredIndices.length.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`;
      return res;
    }

    if (res?.data?.length) {
      substRawHeaders = res.headers || [];
      substanceDataset = res.data || [];
      substCurrentLastUpdated = res.lastUpdated || '';
      await saveSubstToDB(substRawHeaders, substanceDataset, substCurrentLastUpdated);
      setupSubstHeadersAndBuildTable();
      if (substCurrentLastUpdated) document.getElementById('substLastModifiedBadge').textContent = `Last Modified: ${substCurrentLastUpdated} KST(UTC+9)`;
      filterSubstTableRows();
    }
    return res;
  } catch(err) {
    document.getElementById('substViewerBadgeCount').textContent = 'Sync Failed';
  } finally {
    if (btnSync) { btnSync.textContent = '🔄 Reload'; btnSync.disabled = false; }
  }
}

function getSubstColumnClass(colName, idx) {
  if (idx === 0) return 'col-no';
  const c = String(colName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (c === 'cas' || c.includes('casno')) return 'col-cas';
  if (c.includes('name')) return 'col-name';
  if (c.includes('gadsl') || c.includes('svhc')) return 'col-gadsl';
  if (c.includes('reachxiventry')) return 'col-reach-xiv-entry';
  if (c.includes('reachxiv')) return 'col-reach-xiv';
  if (c.includes('reachxvii')) return 'col-reach-xvii';
  if (c.includes('eupops')) return 'col-eupops';
  if (c.includes('scpops') || c.includes('pop')) return 'col-scpops';
  if (c.includes('emerging')) return 'col-emerging';
  if (c.includes('tag')) return 'col-tag';
  return 'col-default';
}

function setupSubstHeadersAndBuildTable() {
  if (!substRawHeaders?.length) return;
  substDisplayHeaders = substRawHeaders.slice(0, 11);
  substTableFilters = Array(substDisplayHeaders.length).fill('');
  substMultiSelectFilters = {};

  const table = document.getElementById('substDataTable');
  const headRow = document.getElementById('substTableHeadRow');
  const filterRow = document.getElementById('substTableFilterRow');

  let colgroup = table.querySelector('colgroup');
  if (colgroup) colgroup.remove();
  colgroup = document.createElement('colgroup');
  headRow.innerHTML = ''; filterRow.innerHTML = '';

  substDisplayHeaders.forEach((colName, idx) => {
    const cls = getSubstColumnClass(colName, idx);
    colgroup.innerHTML += `<col class="${cls}">`;
    headRow.innerHTML += `<th class="${cls}">${colName}</th>`;

    const clean = String(colName).toLowerCase().replace(/[^a-z0-9]/g, '');
    const isMulti = clean.includes('gadsl') || clean.includes('svhc') || clean.includes('tag') || clean.includes('emerging');

    if (isMulti) {
      substMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th ${cls}">
          <div class="filter-container-flex">
            <div class="multiselect-container">
              <button type="button" class="multiselect-btn" id="substMsBtn_${idx}" onclick="toggleSubstDropdown(${idx})">
                <span class="multiselect-btn-text" id="substMsText_${idx}">All</span>
                <span style="font-size:0.6rem; color:#64748b;">▼</span>
              </button>
              <div class="multiselect-dropdown" id="substMsDropdown_${idx}"></div>
            </div>
          </div>
        </th>`;
    } else {
      const ph = (idx === 0 && (clean.includes('no') || clean.includes('node'))) ? '#' : 'Filter...';
      filterRow.innerHTML += `
        <th class="filter-th ${cls}">
          <input type="text" class="filter-input" placeholder="${ph}" style="${ph==='#'?'text-align:center;':''}" oninput="onSubstFilterChange(${idx}, this.value)">
        </th>`;
    }
  });

  table.insertBefore(colgroup, table.firstChild);
  populateSubstDropdownFiltersAndInsights();
}

function populateSubstDropdownFiltersAndInsights() {
  const multiIndices = Object.keys(substMultiSelectFilters).map(k => parseInt(k, 10));
  if (multiIndices.length === 0) return;

  const uniqueCounts = {};
  multiIndices.forEach(idx => { uniqueCounts[idx] = {}; });

  let emergingColIdx = -1, tagColIdx = -1;
  substDisplayHeaders.forEach((h, idx) => {
    const clean = String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (clean.includes('emerging')) emergingColIdx = idx;
    if (clean.includes('tag')) tagColIdx = idx;
  });

  substanceDataset.forEach(row => {
    multiIndices.forEach(idx => {
      const val = formatBlank(row[idx]);
      if (val) {
        val.split(/[\n,]+/).forEach(v => {
          const item = v.trim();
          if (item) uniqueCounts[idx][item] = (uniqueCounts[idx][item] || 0) + 1;
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

  renderSubstInsightChips(emergingColIdx, 'emergingTagsContainer', 'emergingCountBadge', 'emerging');
  renderSubstInsightChips(tagColIdx, 'functionalTagsContainer', 'functionalCountBadge', 'tag');

  function renderSubstInsightChips(colIdx, containerId, badgeId, typeClass) {
    const container = document.getElementById(containerId);
    const badge = document.getElementById(badgeId);
    if (!container || colIdx === -1) return;

    const counts = uniqueCounts[colIdx] || {};
    const keys = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
    badge.textContent = `${keys.length.toLocaleString()} items`;

    if (keys.length === 0) {
      container.innerHTML = '<span style="font-size:0.78rem; color:#94a3b8;">No records found</span>';
      return;
    }

    let html = '';
    keys.forEach(key => {
      const isSelected = substMultiSelectFilters[colIdx]?.has(key);
      html += `<span class="insight-chip ${typeClass} ${isSelected ? 'active' : ''}" data-col="${colIdx}" data-tag="${key}" onclick="applySubstSingleTagFilter(${colIdx}, '${key.replace(/'/g, "\\'")}')">
        ${key} <span class="insight-chip-badge">${counts[key]}</span>
      </span>`;
    });
    container.innerHTML = html;
  }
}

function applySubstSingleTagFilter(colIdx, tagVal) {
  if (!substMultiSelectFilters[colIdx]) return;
  if (substMultiSelectFilters[colIdx].has(tagVal)) substMultiSelectFilters[colIdx].delete(tagVal);
  else substMultiSelectFilters[colIdx].add(tagVal);

  const cnt = substMultiSelectFilters[colIdx].size;
  const dd = document.getElementById(`substMsDropdown_${colIdx}`);
  if (dd) {
    dd.querySelectorAll('input[type="checkbox"]').forEach(c => { if (c.value) c.checked = substMultiSelectFilters[colIdx].has(c.value); });
    const chkAll = document.getElementById(`substChkAll_${colIdx}`);
    if (chkAll) chkAll.checked = (cnt === 0);
  }
  const msText = document.getElementById(`substMsText_${colIdx}`);
  if (msText) msText.textContent = cnt === 0 ? 'All' : `${cnt} selected`;

  const chips = document.querySelectorAll(`.insight-chip[data-col="${colIdx}"]`);
  chips.forEach(chip => {
    const v = chip.getAttribute('data-tag');
    if (substMultiSelectFilters[colIdx]?.has(v)) chip.classList.add('active'); else chip.classList.remove('active');
  });

  substCurrentPage = 1; filterSubstTableRows();
}

function toggleSubstDropdown(idx) {
  const dd = document.getElementById(`substMsDropdown_${idx}`);
  const btn = document.getElementById(`substMsBtn_${idx}`);
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
  document.getElementById(`substMsText_${idx}`).textContent = 'All';
  substCurrentPage = 1; filterSubstTableRows();
}

function toggleSubstDropdownItem(idx, val, checked) {
  if (checked) substMultiSelectFilters[idx].add(val); else substMultiSelectFilters[idx].delete(val);
  const cnt = substMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`substChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  document.getElementById(`substMsText_${idx}`).textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  substCurrentPage = 1; filterSubstTableRows();
}

function onSubstFilterChange(idx, val) {
  substTableFilters[idx] = val.toLowerCase().trim();
  substCurrentPage = 1;
  clearTimeout(substFilterDebounceTimer);
  substFilterDebounceTimer = setTimeout(filterSubstTableRows, 150);
}

function filterSubstTableRows() {
  substFilteredIndices = [];
  const activeFilters = [];
  substTableFilters.forEach((kw, idx) => {
    if (kw) activeFilters.push({ idx, kw, cleanKw: kw.includes('-') ? kw.replace(/-/g, '') : (kw.length >= 3 ? kw : '') });
  });

  const activeMulti = [];
  Object.keys(substMultiSelectFilters).forEach(idxStr => {
    const idx = parseInt(idxStr, 10);
    if (substMultiSelectFilters[idx]?.size > 0) activeMulti.push({ idx, set: substMultiSelectFilters[idx] });
  });

  const hasMulti = activeMulti.length > 0;
  const hasText = activeFilters.length > 0;

  if (!hasMulti && !hasText) {
    substFilteredIndices = substanceDataset.map((_, i) => i);
    renderSubstCurrentPage();
    return;
  }

  substanceDataset.forEach((row, rIdx) => {
    if (hasMulti) {
      for (let i = 0; i < activeMulti.length; i++) {
        const { idx, set } = activeMulti[i];
        const cellVal = formatBlank(row[idx]);
        const items = cellVal.split(/[\n,]+/).map(v => v.trim()).filter(Boolean);
        if (!items.some(item => set.has(item))) return;
      }
    }
    if (hasText) {
      for (let i = 0; i < activeFilters.length; i++) {
        const { idx, kw, cleanKw } = activeFilters[i];
        const cVal = formatBlank(row[idx]).toLowerCase();
        if (!cVal.includes(kw)) {
          if (!cleanKw || !cVal.replace(/-/g, '').includes(cleanKw)) return;
        }
      }
    }
    substFilteredIndices.push(rIdx);
  });

  renderSubstCurrentPage();
}

function renderSubstCurrentPage() {
  const tbody = document.getElementById('substTableDataBody');
  const totalMatches = substFilteredIndices.length;
  const totalPages = Math.ceil(totalMatches / substPageSize) || 1;

  if (substCurrentPage > totalPages) substCurrentPage = totalPages;
  if (substCurrentPage < 1) substCurrentPage = 1;

  const start = (substCurrentPage - 1) * substPageSize;
  const end = Math.min(start + substPageSize, totalMatches);
  let html = '';

  const gadslColIdx = substDisplayHeaders.findIndex(h => {
    const clean = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return clean.includes('gadsl') || clean.includes('svhc');
  });

  for (let i = start; i < end; i++) {
    const realIdx = substFilteredIndices[i];
    const row = substanceDataset[realIdx];

    const gadslVal = gadslColIdx !== -1 ? formatBlank(row[gadslColIdx]).toUpperCase() : '';
    let statusClass = '';
    if (gadslVal.includes('P')) {
      statusClass = 'status-p';
    } else if (gadslVal.includes('D')) {
      statusClass = 'status-d';
    }

    html += '<tr>';
    substDisplayHeaders.forEach((colName, cIdx) => {
      const cls = getSubstColumnClass(colName, cIdx);
      const val = formatBlank(row[cIdx]);
      const clean = colName.toLowerCase().replace(/[^a-z0-9]/g, '');

      if (clean === 'cas' || clean.includes('casno')) {
        html += `<td class="${cls}"><button type="button" class="cas-trigger-btn ${statusClass}" onclick="openSubstDetailsDrawer(${realIdx})" title="View details">${val}</button></td>`;
      } else if (clean.includes('emerging') && val) {
        const tags = val.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
        const badgesHtml = tags.map(t => `<span class="badge-emerging" title="${t}">${t}</span>`).join('');
        html += `<td class="${cls}"><div class="tags-flex-wrap">${badgesHtml}</div></td>`;
      } else if (clean.includes('tag') && val) {
        const tags = val.split(/[\n,]+/).map(t => t.trim()).filter(Boolean);
        const badgesHtml = tags.map(t => `<span class="badge-tag" title="${t}">${t}</span>`).join('');
        html += `<td class="${cls}"><div class="tags-flex-wrap">${badgesHtml}</div></td>`;
      } else if (clean.includes('gadsl') || clean.includes('svhc')) {
        const stBadge = statusClass ? `badge-${statusClass}` : '';
        html += `<td class="${cls} ${stBadge}" title="${val}">${val}</td>`;
      } else {
        html += `<td class="${cls}" title="${val}">${val}</td>`;
      }
    });
    html += '</tr>';
  }

  tbody.innerHTML = html;
  document.getElementById('substViewerBadgeCount').textContent = `Showing ${totalMatches.toLocaleString()} of ${substanceDataset.length.toLocaleString()} substances`;
  document.getElementById('pageInfoDisplay').textContent = `Page ${substCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()}`;
  document.getElementById('btnPrevPage').disabled = (substCurrentPage <= 1);
  document.getElementById('btnNextPage').disabled = (substCurrentPage >= totalPages);
}

function goToSubstPage(p) { substCurrentPage = p; renderSubstCurrentPage(); }
function changeSubstPageSize(s) { substPageSize = parseInt(s, 10); substCurrentPage = 1; renderSubstCurrentPage(); }

function resetSubstanceFilters() {
  clearTimeout(substFilterDebounceTimer);
  document.querySelectorAll('#substTableFilterRow .filter-input').forEach(i => i.value = '');
  substTableFilters = Array(substDisplayHeaders.length).fill('');
  Object.keys(substMultiSelectFilters).forEach(idx => {
    const chkAll = document.getElementById(`substChkAll_${idx}`);
    if (chkAll) selectAllSubstDropdown(idx, chkAll);
  });
}

function openSubstDetailsDrawer(realIdx) {
  const row = substanceDataset[realIdx];
  if (!row) return;

  const casIdx = substRawHeaders.findIndex(h => { const c = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return c === 'cas' || c.includes('casno'); });
  document.getElementById('drawerSubstanceTitle').textContent = `🧪 CAS: ${formatBlank(row[casIdx])}`;

  const svhcIdx = substRawHeaders.findIndex(h => { const c = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return c.includes('svhc') && (c.includes('date') || c.includes('inclusion')); });
  const reachIdx = substRawHeaders.findIndex(h => { const c = String(h || '').toLowerCase().replace(/[^a-z0-9]/g, ''); return c.includes('reachxiv') && c.includes('sunset'); });

  const topIndices = [];
  for (let idx = 0; idx <= Math.min(10, substRawHeaders.length - 1); idx++) { if (idx !== casIdx) topIndices.push(idx); }
  if (svhcIdx !== -1 && !topIndices.includes(svhcIdx)) topIndices.push(svhcIdx);
  if (reachIdx !== -1 && !topIndices.includes(reachIdx)) topIndices.push(reachIdx);

  let infoHtml = '';
  topIndices.forEach(idx => {
    const h = substRawHeaders[idx] || `Col ${idx + 1}`;
    const v = formatBlank(row[idx]);
    infoHtml += `<div class="drawer-info-row"><span class="drawer-info-label" title="${h}">${h}</span><span class="drawer-info-val" title="${v}">${v}</span></div>`;
  });
  document.getElementById('drawerInfoCard').innerHTML = infoHtml;

  let extHtml = '';
  for (let idx = 11; idx < substRawHeaders.length; idx++) {
    if (idx === svhcIdx || idx === reachIdx) continue;
    const h = substRawHeaders[idx] || `Column ${idx + 1}`;
    const v = formatBlank(row[idx]);
    extHtml += `<div class="drawer-extended-item"><label class="drawer-extended-label">📝 ${h}</label><div class="drawer-details-box">${v}</div></div>`;
  }
  document.getElementById('drawerExtendedContainer').innerHTML = extHtml || '<div class="drawer-details-box" style="text-align:center; color:var(--text-muted);">No additional notes available.</div>';
  document.getElementById('drawerOverlay').style.display = 'flex';
}
function closeDrawer() { document.getElementById('drawerOverlay').style.display = 'none'; }

async function exportSubstanceExcel() {
  if (!substanceDataset.length) return;
  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Substance Log", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws.columns = substRawHeaders.map((h, idx) => ({ header: h, key: h, width: idx === 0 ? 8 : (String(h).toLowerCase().includes('detail') ? 40 : 18) }));
  
  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  substFilteredIndices.forEach(realIdx => ws.addRow(substanceDataset[realIdx]));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: substRawHeaders.length } };
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `a2MDS_Substance_Log_${dateStr}.xlsx`);
}
