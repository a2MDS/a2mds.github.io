/* =========================================================================
   COMPLIANCE LOG MODULE (Fixed 7-Column Direct Mapping)
   ========================================================================= */
const URL_COMPLIANCE = 'https://script.google.com/macros/s/AKfycbyGilhtUIPaPbcNfFeXgdho08nAdnsT0xzFjZafy9CIwkg2cXsJ5tk0qkV3BO3QA6yT/exec';
const COMP_DB_NAME = 'a2MDS_ComplianceLog_DB';

let compRawHeaders = [], compDisplayColumns = [], compDataset = [], compTimelineRawData = [], compTableFilters = [], compMultiSelectFilters = {}, compEditingItemId = null;

function openCompDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(COMP_DB_NAME, 3);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('sources')) {
        db.createObjectStore('sources', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function saveCompToDB(headers, items, lastUpdated, timeline) {
  try {
    const db = await openCompDB();
    const tx = db.transaction('sources', 'readwrite');
    const store = tx.objectStore('sources');
    store.clear();
    store.put({ id: '__meta__', headers, lastUpdated, timeline });
    items.forEach(i => store.put(i));
  } catch(e) {}
}

async function loadCompFromDB() {
  try {
    const db = await openCompDB();
    return new Promise(res => {
      const req = db.transaction('sources', 'readonly').objectStore('sources').getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        if (!items.length) return res(null);
        const meta = items.find(i => i.id === '__meta__');
        res({ headers: meta?.headers || [], lastUpdated: meta?.lastUpdated || '', timeline: meta?.timeline || [], rows: items.filter(i => i.id !== '__meta__') });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearCompIndexedDB() { 
  try { const db = await openCompDB(); db.transaction('sources', 'readwrite').objectStore('sources').clear(); } catch(e) {} 
}

function formatCompDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (s === '-' || s === 'null' || s === 'undefined') return '';
  if (s.includes('T')) {
    const datePart = s.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
  }
  if (/^\d{4}[\.\/]\d{2}[\.\/]\d{2}$/.test(s)) return s.replace(/[\.\/]/g, '-');
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime()) && s.length >= 8) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return '';
}

async function initComplianceModule() {
  const cachedComp = await loadCompFromDB();
  if (cachedComp?.rows?.length) {
    compRawHeaders = cachedComp.headers; 
    compDataset = cachedComp.rows; 
    compTimelineRawData = cachedComp.timeline;
    setupCompColumns(); 
    renderCompSummary(); 
    renderCompTimeline(); 
    filterCompRows();
    if (cachedComp.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${cachedComp.lastUpdated} KST(UTC+9)`;
  }
}

async function fetchComplianceData(authOverride = '') {
  const key = authOverride || getStoredAuthKey();
  if (!key) { document.getElementById('authLockOverlay').style.display = 'flex'; return { status: 'auth_failed' }; }

  document.getElementById('compViewerBadgeCount').textContent = 'Syncing...';
  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data' })
    });
    const res = await resp.json();

    if (res?.status === 'auth_failed') {
      clearStoredAuthKey(); document.getElementById('authLockOverlay').style.display = 'flex'; return res;
    }

    const rows = res.data || [];
    compRawHeaders = res.headers || [];
    compTimelineRawData = res.timeline || [];

    // 시트 A~G열 7개 데이터 1:1 파싱 (id는 프론트엔드 임시 식별용)
    compDataset = rows.map((item, idx) => ({
      id: `ROW_${idx}`,
      source: item[0] || item.source || '',
      linkName: item[1] || item.linkName || '',
      linkUrl: item[2] || item.linkUrl || '',
      criteria: item[3] || item.criteria || '',
      date: formatCompDate(item[4] || item.date),
      ref: item[5] || item.ref || '',
      details: item[6] || item.details || ''
    }));

    await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData);
    setupCompColumns();
    renderCompSummary();
    renderCompTimeline();
    filterCompRows();

    if (res.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
    return res;
  } catch(err) {
    document.getElementById('compViewerBadgeCount').textContent = 'Sync Failed';
    throw err;
  }
}

function renderCompSummary() {
  const total = compDataset.length;
  document.getElementById('compSummaryTotalDisplay').textContent = `${total.toLocaleString()} sources`;
  if (!total) return;

  const counts = {};
  compDataset.forEach(d => { const s = (d.source || 'Unassigned').trim(); counts[s] = (counts[s] || 0) + 1; });

  let barHtml = '', legendHtml = '';
  Object.keys(counts).sort((a,b) => counts[b] - counts[a]).forEach((s, idx) => {
    const c = counts[s];
    const pct = ((c / total) * 100).toFixed(1);
    const color = PALETTE[idx % PALETTE.length];
    barHtml += `<div class="progress-segment" style="width:${pct}%; background:${color};" title="${s}: ${c} (${pct}%)"></div>`;
    legendHtml += `<div class="legend-item"><div class="legend-dot" style="background:${color};"></div><span class="legend-label">${s}:</span><span class="legend-count">${c} (${pct}%)</span></div>`;
  });

  document.getElementById('compProgressBarContainer').innerHTML = barHtml;
  document.getElementById('compSummaryLegendGrid').innerHTML = legendHtml;
}

function formatCompTimelineHeader(val) {
  if (!val) return '';
  const s = String(val).trim();
  if (/^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(s)) return s;
  const d = new Date(s);
  if (!isNaN(d.getTime()) && s.length >= 7) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]}` + ', ' + d.getFullYear();
  }
  return s;
}

function renderCompTimeline() {
  const wrapper = document.getElementById('compTimelineWrapper');
  if (!compTimelineRawData || !compTimelineRawData.length) {
    wrapper.innerHTML = '<div style="padding:16px; color:#64748b; text-align:center; font-size:0.82rem;">No Timeline data found.</div>';
    return;
  }

  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(compTimelineRawData.length, 5); r++) {
    const row = compTimelineRawData[r];
    const hasDate = row.some(cell => /^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(formatCompTimelineHeader(cell)));
    if (hasDate) { headerRowIdx = r; break; }
  }

  const headerRow = compTimelineRawData[headerRowIdx] || [];
  const dataRows = compTimelineRawData.slice(headerRowIdx + 1);

  const validColIndices = [];
  let firstDateColIdx = 999;
  for (let c = 0; c < headerRow.length; c++) {
    const formattedH = formatCompTimelineHeader(headerRow[c]);
    if (/^(?:[A-Za-z]{3}|1H|2H|Q[1-4]),?\s*\d{4}/i.test(formattedH)) {
      validColIndices.push({ index: c, label: formattedH });
      if (c < firstDateColIdx) firstDateColIdx = c;
    }
  }

  const regNameColIdx = firstDateColIdx > 0 ? (firstDateColIdx - 1) : 0;
  let html = '<table class="timeline-table"><thead><tr><th class="reg-name-th">Regulation</th>';
  validColIndices.forEach(col => { html += `<th>${col.label}</th>`; });
  html += '</tr></thead><tbody>';

  let hasRows = false;
  dataRows.forEach(row => {
    let regName = String(row[regNameColIdx] || '').trim();
    if (!regName) {
      for (let c = 0; c < firstDateColIdx; c++) {
        const v = String(row[c] || '').trim();
        if (v) { regName = v; break; }
      }
    }
    if (!regName) return;
    hasRows = true;

    html += `<tr><td class="reg-name-td">${regName}</td>`;
    validColIndices.forEach(col => {
      const val = String(row[col.index] || '').trim();
      if (val) {
        const isHigh = /Entry into Force|Application|Final adoption|Repeal/i.test(val);
        html += `<td><span class="milestone-badge ${isHigh ? 'highlight' : ''}">${val.replace(/\n/g, '<br>')}</span></td>`;
      } else {
        html += '<td style="color:#cbd5e1; text-align:center;">-</td>';
      }
    });
    html += '</tr>';
  });

  if (!hasRows) html += '<tr><td colspan="15" style="text-align:center; padding:16px; color:#64748b;">No Regulation entries found.</td></tr>';
  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

function setupCompColumns() {
  compDisplayColumns = [
    { key: 'no', label: 'No.', width: '45px' },
    { key: 'source', label: compRawHeaders[0] || 'Source', width: '130px' },
    { key: 'link', label: 'Link', width: '160px' },
    { key: 'criteria', label: compRawHeaders[3] || 'Date Basis', width: '130px' },
    { key: 'date', label: compRawHeaders[4] || 'Date', width: '130px' },
    { key: 'ref', label: compRawHeaders[5] || 'Ref. Values', width: '120px' },
    { key: 'details', label: compRawHeaders[6] || 'Additional Notes', width: 'auto' }
  ];

  const headRow = document.getElementById('compTableHeadRow');
  const filterRow = document.getElementById('compTableFilterRow');
  headRow.innerHTML = ''; filterRow.innerHTML = '';
  compTableFilters = Array(compDisplayColumns.length).fill('');
  compMultiSelectFilters = {};

  compDisplayColumns.forEach((col, idx) => {
    headRow.innerHTML += `<th style="width:${col.width};">${col.label}</th>`;
    if (col.key === 'source') {
      compMultiSelectFilters[idx] = new Set();
      filterRow.innerHTML += `<th class="filter-th"><div class="multiselect-container"><button type="button" class="multiselect-btn" id="compMsBtn" onclick="toggleCompDropdown()"><span id="compMsText">All</span><span style="font-size:0.6rem; color:#64748b;">▼</span></button><div class="multiselect-dropdown" id="compMsDropdown"></div></div></th>`;
    } else if (col.key !== 'no') {
      filterRow.innerHTML += `<th class="filter-th"><input type="text" class="filter-input" placeholder="Filter..." oninput="onCompFilterChange(${idx}, this.value)"></th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th"></th>';
    }
  });

  populateCompSourceOptions();
}

function populateCompSourceOptions() {
  const dd = document.getElementById('compMsDropdown');
  if (!dd) return;
  const unique = [...new Set(compDataset.map(d => d.source).filter(Boolean))].sort();
  let html = `<label class="multiselect-item"><input type="checkbox" id="compChkAll" checked onchange="selectAllCompSources(this)"> <span>(Select All)</span></label><hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">`;
  unique.forEach(val => {
    html += `<label class="multiselect-item"><input type="checkbox" value="${val}" onchange="toggleCompSource('${val}', this.checked)"> <span>${val}</span></label>`;
  });
  dd.innerHTML = html;
}

function toggleCompDropdown() {
  const dd = document.getElementById('compMsDropdown');
  const btn = document.getElementById('compMsBtn');
  const isShow = dd.classList.toggle('show');
  if (isShow) {
    const rect = btn.getBoundingClientRect();
    dd.style.top = `${rect.bottom + 4}px`;
    dd.style.left = `${Math.min(rect.left, window.innerWidth - 260)}px`;
  }
}

function selectAllCompSources(chk) {
  compMultiSelectFilters[1].clear();
  document.querySelectorAll('#compMsDropdown input[type="checkbox"]').forEach(c => { if(c !== chk) c.checked = false; });
  document.getElementById('compMsText').textContent = 'All';
  filterCompRows();
}

function toggleCompSource(val, checked) {
  if (checked) compMultiSelectFilters[1].add(val); else compMultiSelectFilters[1].delete(val);
  const cnt = compMultiSelectFilters[1].size;
  document.getElementById('compChkAll').checked = (cnt === 0);
  document.getElementById('compMsText').textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  filterCompRows();
}

function onCompFilterChange(idx, val) { compTableFilters[idx] = val.toLowerCase().trim(); filterCompRows(); }

function getFilteredCompData() {
  return compDataset.filter((r, idx) => {
    if (compMultiSelectFilters[1]?.size && !compMultiSelectFilters[1].has(r.source)) return false;
    const searchVals = [String(idx+1), r.source, `${r.linkName} ${r.linkUrl}`, r.criteria, r.date, r.ref, r.details];
    return compDisplayColumns.every((col, i) => !compTableFilters[i] || searchVals[i].toLowerCase().includes(compTableFilters[i]));
  });
}

function filterCompRows() {
  const tbody = document.getElementById('compTableDataBody');
  const filtered = getFilteredCompData();
  let html = '';

  filtered.forEach((r, idx) => {
    html += `
      <tr data-id="${r.id}">
        <td style="text-align:center; font-weight:600; color:#64748b;">${idx+1}</td>
        <td><b>${r.source || '-'}</b></td>
        <td>
          <div class="editable-cell-box">
            <a href="${r.linkUrl || '#'}" target="_blank" class="link-anchor">${r.linkName || 'Open Link'}</a>
            <button class="btn-edit-inline" onclick="openLinkModal('${r.id}')">✎</button>
          </div>
        </td>
        <td><span class="cell-read-only" title="${r.criteria || '-'}">${r.criteria || '-'}</span></td>
        <td><input type="date" class="tbl-input-date" value="${r.date || ''}" onchange="updateCompCell('${r.id}', 'date', this.value)"></td>
        <td><input type="text" class="tbl-input-text" value="${r.ref || ''}" onchange="updateCompCell('${r.id}', 'ref', this.value)"></td>
        <td><textarea class="tbl-textarea-details" onchange="updateCompCell('${r.id}', 'details', this.value)">${r.details || ''}</textarea></td>
      </tr>`;
  });

  tbody.innerHTML = html;
  document.getElementById('compViewerBadgeCount').textContent = `Showing ${filtered.length} of ${compDataset.length} sources`;
}

function updateCompCell(id, key, val) { const item = compDataset.find(d => d.id === id); if (item) item[key] = val.trim(); }

function resetComplianceFilters() {
  document.querySelectorAll('#compTableFilterRow .filter-input').forEach(i => i.value = '');
  compTableFilters = Array(compDisplayColumns.length).fill('');
  selectAllCompSources(document.getElementById('compChkAll'));
}

async function saveComplianceData() {
  const btn = document.getElementById('btnSaveAllTop');
  const authKey = getStoredAuthKey();
  if (!authKey) return;

  btn.textContent = '⏳ Saving...'; btn.disabled = true;
  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ 
        auth: authKey, 
        action: 'save_all_rows', 
        items: compDataset 
      })
    });
    const res = await resp.json();
    btn.textContent = '✓ Saved!';
    if (res.lastUpdated) document.getElementById('compLastModifiedBadge').textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
    await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData);
  } catch(e) { alert('Save failed.'); }
  finally { setTimeout(() => { btn.textContent = '💾 Save'; btn.disabled = false; }, 1200); }
}

async function executeComplianceBackup() {
  const btn = document.getElementById('btnBackupDriveComp');
  const authKey = getStoredAuthKey();
  if (!authKey) return;
  btn.textContent = '⏳ Backing up...'; btn.disabled = true;

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'backup_drive' })
    });
    const res = await resp.json();
    if (res.status === 'success') {
      if (confirm(`Backup created successfully!\nFile: ${res.fileName}\n\nOpen backup sheet?`)) window.open(res.url, '_blank');
    } else alert('Backup failed.');
  } catch(e) { alert('Backup error.'); }
  finally { btn.textContent = '☁️ Backup'; btn.disabled = false; }
}

async function exportComplianceExcel() {
  const filtered = getFilteredCompData();
  if (!filtered.length) return;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet("Compliance Log");
  ws.columns = [
    { header: 'No.', key: 'no', width: 8 }, { header: 'Source', key: 'source', width: 16 },
    { header: 'Link', key: 'linkName', width: 25 }, { header: 'Date Basis', key: 'criteria', width: 18 },
    { header: 'Date', key: 'date', width: 14 }, { header: 'Ref. values', key: 'ref', width: 20 },
    { header: 'Additional notes', key: 'details', width: 60 }
  ];

  filtered.forEach((r, idx) => {
    ws.addRow({ no: idx+1, source: r.source, linkName: r.linkUrl ? { text: r.linkName, hyperlink: r.linkUrl } : r.linkName, criteria: r.criteria, date: r.date, ref: r.ref, details: r.details });
  });

  const buf = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buf]), `Compliance_Log_${new Date().toISOString().slice(0,10).replace(/-/g,'')}.xlsx`);
}

function openLinkModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;
  document.getElementById('modalLinkName').value = item.linkName || '';
  document.getElementById('modalLinkUrl').value = item.linkUrl || '';
  document.getElementById('linkModal').style.display = 'flex';
}
function closeLinkModal() { document.getElementById('linkModal').style.display = 'none'; }
function saveLinkModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    item.linkName = document.getElementById('modalLinkName').value.trim();
    item.linkUrl = document.getElementById('modalLinkUrl').value.trim();
    closeLinkModal(); filterCompRows();
  }
}
