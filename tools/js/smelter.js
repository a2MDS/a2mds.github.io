/* =========================================================================
   SMELTER LOG MODULE (High-Performance Cached Sync)
   ========================================================================= */
const URL_SMELTER = 'https://script.google.com/macros/s/AKfycbwKKRk2-NKSnSnVfb1cGrMkHGgxx5J5iHognV4AAR1ZGZK9fmp9vTcPW5w69MjgGWQRlw/exec';
const SMELTER_DB_NAME = 'a2MDS_SmelterLog_DB';
const SMELTER_COLUMN_WIDTHS = [50, 95, 95, 170, 190, 95, 90, 100, 100, 110, 180, 220];

let smelterFilesToProcess = [], consolidatedDataStore = [], smelterTableFilters = [], smelterMultiSelectFilters = {};
let consolidatedHeaderStore = ['No.', 'Source', 'Metal', 'Smelter Reference', 'Standard Smelter Name', 'Country', 'Smelter ID', 'City', 'State Province', 'RMAP Status', 'Last audit / Cycle / Reaudit In Progress', 'Revision History'];
let smelterCurrentLastUpdated = '';

const openManualModal = () => document.getElementById('manualModal').style.display = 'flex';
const closeManualModal = () => document.getElementById('manualModal').style.display = 'none';

function openSmelterDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(SMELTER_DB_NAME, 1);
    req.onupgradeneeded = e => { const db = e.target.result; if (!db.objectStoreNames.contains('smelters')) db.createObjectStore('smelters', { keyPath: 'id', autoIncrement: true }); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveSmelterToDB(headers, rows, lastUpdated) {
  try {
    const db = await openSmelterDB();
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
  try { const db = await openSmelterDB(); db.transaction('smelters', 'readwrite').objectStore('smelters').clear(); } catch(e) {} 
}

async function initSmelterModule() {
  const cachedSmelter = await loadSmelterFromDB();
  if (cachedSmelter?.rows?.length) {
    consolidatedHeaderStore = cachedSmelter.headers; 
    consolidatedDataStore = cachedSmelter.rows;
    smelterCurrentLastUpdated = cachedSmelter.lastUpdated || '';
    renderSmelterVisualDashboard(cachedSmelter.rows, smelterCurrentLastUpdated); 
    renderSmelterViewerTable();
  }
}

async function fetchSmelterData(authOverride = '', forceReload = false) {
  const key = authOverride || getStoredAuthKey();
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

    // 서버 데이터에 변경이 없는 경우 캐시 데이터 유지 후 조기 종료
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
  } finally {
    if (btn) { btn.textContent = '🔄 Reload'; btn.disabled = false; }
  }
}

function renderSmelterVisualDashboard(rows, serverLastUpdated = '') {
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

  document.getElementById('barConformant').style.width = `${pConf}%`;
  document.getElementById('barActive').style.width = `${pAct}%`;
  document.getElementById('barStandard').style.width = `${pStd}%`;
  document.getElementById('barRemoved').style.width = `${pRem}%`;

  document.getElementById('rmapTotalLabel').textContent = `${total.toLocaleString()} facilities`;
  document.getElementById('legConformant').textContent = `${statusCounts.Conformant.toLocaleString()} (${pConf.toFixed(1)}%)`;
  document.getElementById('legActive').textContent = `${statusCounts.Active.toLocaleString()} (${pAct.toFixed(1)}%)`;
  document.getElementById('legStandard').textContent = `${statusCounts.Standard.toLocaleString()} (${pStd.toFixed(1)}%)`;
  document.getElementById('legRemoved').textContent = `${statusCounts.Removed.toLocaleString()} (${pRem.toFixed(1)}%)`;

  const pCMRT = total ? (typeCounts.CMRT / total) * 100 : 0;
  const pEMRT = total ? (typeCounts.EMRT / total) * 100 : 0;
  const pAMRT = total ? (typeCounts.AMRT / total) * 100 : 0;
  const pRev = total ? (typeCounts.REVISION / total) * 100 : 0;

  document.getElementById('barCMRT').style.width = `${pCMRT}%`;
  document.getElementById('barEMRT').style.width = `${pEMRT}%`;
  document.getElementById('barAMRT').style.width = `${pAMRT}%`;
  document.getElementById('barRevType').style.width = `${pRev}%`;

  document.getElementById('templateTotalLabel').textContent = `${total.toLocaleString()} total`;
  document.getElementById('legCMRT').textContent = `${typeCounts.CMRT.toLocaleString()} (${pCMRT.toFixed(1)}%)`;
  document.getElementById('legEMRT').textContent = `${typeCounts.EMRT.toLocaleString()} (${pEMRT.toFixed(1)}%)`;
  document.getElementById('legAMRT').textContent = `${typeCounts.AMRT.toLocaleString()} (${pAMRT.toFixed(1)}%)`;
  document.getElementById('legRevType').textContent = `${typeCounts.REVISION.toLocaleString()} (${pRev.toFixed(1)}%)`;

  const sortedMetals = Object.entries(metalCounts).sort((a, b) => b[1] - a[1]);
  let mBarHtml = '', mLegHtml = '';
  sortedMetals.forEach(([mName, count], idx) => {
    const pct = total ? (count / total) * 100 : 0;
    const color = PALETTE[idx % PALETTE.length];
    mBarHtml += `<div class="p-segment" style="width:${pct}%; background:${color};" title="${mName}: ${count.toLocaleString()} (${pct.toFixed(1)}%)"></div>`;
    mLegHtml += `<div class="legend-item"><span class="legend-dot" style="background:${color};"></span>${mName}: <strong>${count.toLocaleString()} (${pct.toFixed(1)}%)</strong></div>`;
  });

  document.getElementById('metalProgressBarWrap').innerHTML = mBarHtml;
  document.getElementById('metalLegendGrid').innerHTML = mLegHtml;
  document.getElementById('metalTotalLabel').textContent = `${total.toLocaleString()} facilities`;
  document.getElementById('smelterSummaryUpdateDate').textContent = serverLastUpdated ? `Latest Harvest: ${serverLastUpdated} KST(UTC+9)` : `Latest Harvest: Live Synced`;
}

function renderSmelterViewerTable() {
  const headRow = document.getElementById('smelterTableHeadRow');
  const filterRow = document.getElementById('smelterTableFilterRow');
  const table = document.getElementById('smelterDataTable');

  let colgroup = table.querySelector('colgroup');
  if (colgroup) colgroup.remove();
  colgroup = document.createElement('colgroup');

  headRow.innerHTML = ''; filterRow.innerHTML = '';
  smelterTableFilters = Array(consolidatedHeaderStore.length).fill('');
  smelterMultiSelectFilters = {};

  consolidatedHeaderStore.forEach((headerName, idx) => {
    const colWidth = SMELTER_COLUMN_WIDTHS[idx] || 120;
    colgroup.innerHTML += `<col style="width:${colWidth}px;">`;
    headRow.innerHTML += `<th title="${headerName}">${headerName}</th>`;

    const cleanH = String(headerName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const isMulti = (idx === 1 || idx === 2 || idx === 9 || cleanH.includes('source') || cleanH.includes('metal') || cleanH.includes('rmap'));

    if (isMulti) {
      smelterMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `
        <th class="filter-th">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="smelterMsBtn_${idx}" onclick="toggleSmelterDropdown(${idx})">
              <span class="multiselect-btn-text" id="smelterMsText_${idx}">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="smelterMsDropdown_${idx}"></div>
          </div>
        </th>`;
    } else if (idx !== 0) {
      filterRow.innerHTML += `<th class="filter-th"><input type="text" class="filter-input" placeholder="Filter..." oninput="onSmelterFilterChange(${idx}, this.value)"></th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th"></th>';
    }
  });

  table.insertBefore(colgroup, table.firstChild);
  populateSmelterDropdownFilters();
  filterSmelterTableRows();
}

function populateSmelterDropdownFilters() {
  Object.keys(smelterMultiSelectFilters).forEach(idxStr => {
    const idx = parseInt(idxStr, 10);
    const dd = document.getElementById(`smelterMsDropdown_${idx}`);
    if (!dd) return;

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
  document.getElementById(`smelterMsText_${idx}`).textContent = 'All';
  filterSmelterTableRows();
}

function toggleSmelterDropdownItem(idx, val, checked) {
  if (checked) smelterMultiSelectFilters[idx].add(val); else smelterMultiSelectFilters[idx].delete(val);
  const cnt = smelterMultiSelectFilters[idx].size;
  const chkAll = document.getElementById(`smelterChkAll_${idx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  document.getElementById(`smelterMsText_${idx}`).textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  filterSmelterTableRows();
}

function onSmelterFilterChange(idx, val) { smelterTableFilters[idx] = val.toLowerCase().trim(); filterSmelterTableRows(); }

function getFilteredSmelterDataset() {
  return consolidatedDataStore.filter(row => {
    return consolidatedHeaderStore.every((header, idx) => {
      if (idx === 0) return true;
      const cellText = String(row[idx] || '').trim();
      if (smelterMultiSelectFilters[idx]?.size > 0 && !smelterMultiSelectFilters[idx].has(cellText)) return false;
      if (smelterTableFilters[idx] && !cellText.toLowerCase().includes(smelterTableFilters[idx])) return false;
      return true;
    });
  });
}

function filterSmelterTableRows() {
  const tbody = document.getElementById('smelterTableDataBody');
  const filtered = getFilteredSmelterDataset();
  let html = '';

  filtered.forEach((row, rIdx) => {
    html += '<tr>';
    row.forEach((val, cIdx) => {
      if (cIdx === 0) {
        html += `<td style="text-align:center; font-weight:600; color:var(--text-muted);">${rIdx + 1}</td>`;
      } else {
        const sVal = String(val || '');
        let cls = '';
        if (cIdx === 9) {
          if (val === 'Conformant') cls = 'class="status-conformant"';
          else if (val === 'Active') cls = 'class="status-active"';
          else if (val === 'Removed') cls = 'class="status-removed"';
        }
        html += `<td ${cls} title="${sVal}">${sVal}</td>`;
      }
    });
    html += '</tr>';
  });

  tbody.innerHTML = html;
  document.getElementById('smelterViewerBadgeCount').textContent = `Showing ${filtered.length.toLocaleString()} of ${consolidatedDataStore.length.toLocaleString()} facilities`;
}

function resetSmelterFilters() {
  document.querySelectorAll('#smelterTableFilterRow .filter-input').forEach(inp => inp.value = '');
  smelterTableFilters = Array(consolidatedHeaderStore.length).fill('');
  Object.keys(smelterMultiSelectFilters).forEach(idx => {
    const chkAll = document.getElementById(`smelterChkAll_${idx}`);
    if (chkAll) selectAllSmelterDropdown(idx, chkAll);
  });
}

async function executeSmelterBackup() {
  const btn = document.getElementById('btnBackupDriveSmelter');
  const authKey = getStoredAuthKey();
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
  const filtered = getFilteredSmelterDataset();
  if (!filtered.length) return;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Smelter Log", { views: [{ state: 'frozen', xSplit: 2, ySplit: 1, topLeftCell: 'C2' }] });
  const widths = [8, 10, 12, 22, 26, 16, 13, 14, 16, 14, 34, 38];

  ws.columns = consolidatedHeaderStore.map((h, i) => ({ header: h, key: `col_${i}`, width: widths[i] || 15 }));
  const hRow = ws.getRow(1);
  hRow.height = 25;
  hRow.eachCell(cell => {
    cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  });

  filtered.forEach(rowItem => ws.addRow(rowItem));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: ws.rowCount, column: consolidatedHeaderStore.length } };
  const dateStr = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `RMI_Smelter_Data_Sync_${dateStr}.xlsx`);
}

/* Smelter XML Manual Fallback Functions */
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
    if (matched[t]) {
      badge.textContent = 'Uploaded'; badge.className = 'file-badge badge-ready';
      label.textContent = `${matched[t].name} (${(matched[t].size / 1024).toFixed(1)} KB)`;
      box.classList.add('ready');
    } else {
      badge.textContent = 'Not uploaded yet'; badge.className = 'file-badge badge-missing';
      label.textContent = 'Waiting for file...';
      box.classList.remove('ready');
    }
  });
}

document.getElementById('fileInput')?.addEventListener('change', e => {
  smelterFilesToProcess = Array.from(e.target.files);
  document.getElementById('fileCount').textContent = `${smelterFilesToProcess.length} file(s) selected`;
  document.getElementById('processBtn').disabled = smelterFilesToProcess.length === 0;
  updateSmelterCardStatus();
});

function confirmResetAllSmelterFiles() {
  if (confirm("Clear all selected files?")) {
    smelterFilesToProcess = [];
    document.getElementById('fileInput').value = '';
    document.getElementById('fileCount').textContent = 'No files selected';
    document.getElementById('processBtn').disabled = true;
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
  const authKey = getStoredAuthKey();
  if (!authKey) return;

  const btn = document.getElementById('btnSaveCloud');
  const orgText = btn.innerHTML;
  btn.innerHTML = '⏳ Saving...'; btn.disabled = true;

  const CHUNK_SIZE = 500;
  const totalChunks = Math.ceil(consolidatedDataStore.length / CHUNK_SIZE);
  const kstTime = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(new Date()).replace(/\. /g, '-').replace('.', '');

  try {
    for (let i = 0; i < totalChunks; i++) {
      btn.innerHTML = `⏳ Saving (${i + 1}/${totalChunks})...`;
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
    document.getElementById('smelterSummaryUpdateDate').textContent = `Latest Harvest: ${smelterCurrentLastUpdated} KST(UTC+9)`;

    btn.innerHTML = '✓ Saved!';
    setTimeout(() => { btn.innerHTML = orgText; btn.disabled = false; }, 1500);
  } catch(err) {
    alert('Error saving to Google Sheets.');
    btn.innerHTML = orgText; btn.disabled = false;
  }
}
