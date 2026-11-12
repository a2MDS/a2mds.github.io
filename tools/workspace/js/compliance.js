/* =========================================================================
   COMPLIANCE LOG MODULE (Tabs: Automated Feed, Channels, Monitoring Log)
   ========================================================================= */
const URL_COMPLIANCE = 'https://script.google.com/macros/s/AKfycbyGilhtUIPaPbcNfFeXgdho08nAdnsT0xzFjZafy9CIwkg2cXsJ5tk0qkV3BO3QA6yT/exec';
const COMP_DB_NAME = 'a2MDS_ComplianceLog_DB';

// 1. Log Tab State
let compRawHeaders = [], compDisplayColumns = [], compDataset = [];
let compTimelineRawData = [], compTableFilters = [];
let compMultiSelectFilters = {}, compEditingItemId = null;
let compUnsavedChanges = new Set();
let compCurrentPage = 1, compPageSize = 50;

// 동시 중복 호출 방지 플래그
let compIsFetching = false;

// 2. Automated Monitoring Feed State
let compMonitoringFeedHeaders = [], compMonitoringFeedRows = [], compMonitoringFeedErrors = [];
let compFeedFilters = {};
let compFeedMultiFilters = { region: new Set(), status: new Set() };

// 3. Channels State
let compChannelsHeaders = [], compChannelsRows = [];
let compChannelsFilters = {};
let compChannelsMultiFilters = { region: new Set(), status: new Set() };

window.compDataset = compDataset;

// 채널별 기본 링크 폴백용 사전
const COMP_CHANNEL_SOURCE_URLS = {
  "RMI News": "https://www.responsiblemineralsinitiative.org/news/",
  "IMDS News": "https://public.mdsystem.com/en/web/imds-public-pages/imds-news",
  "IMDS News (Services)": "https://public.mdsystem.com/en/web/imds-public-pages/imds-extended-services-news",
  "IMDS Release Notes(Next)": "https://public.mdsystem.com/en/web/imds-public-pages/release-notes-mof-next",
  "IMDS Professional Blog": "https://www.imds-professional.com/en/ipblog/",
  "Assent Content Hub": "https://www.assent.com/resources/content-hub/?pager=1&filter=1&filter_order=newest",
  "CDX News": "https://public.cdxsystem.com/en/web/cdx/news",
  "CDX Updates": "https://public.cdxsystem.com/en/web/cdx/updates-releases",
  "CDX Events": "https://public.cdxsystem.com/en/web/cdx/events",
  "iPoint (News)": "https://www.ipoint-systems.com/news/",
  "iPoint (Blog)": "https://www.ipoint-systems.com/news/",
  "ECHA News": "https://echa.europa.eu/news",
  "COMPASS News": "https://www.compass.or.kr/news/newsList",
  "EUR-Lex": "https://eur-lex.europa.eu/homepage.html",
  "ECHACHEM": "https://chem.echa.europa.eu/",
  "국가법령정보센터": "https://www.law.go.kr/",
  "기후에너지환경부 입법예고": "https://mcee.go.kr/home/web/index.do?menuId=68",
  "기후에너지환경부 행정예고": "https://mcee.go.kr/home/web/index.do?menuId=10557",
  "기후에너지환경부 고시/훈령/예규": "https://mcee.go.kr/home/web/index.do?menuId=71",
  "화학물질안전원": "https://nics.mcee.go.kr/sub.do?menuId=36"
};

function getChannelSourceUrl(name) {
  if (!name) return '#';
  for (const [key, url] of Object.entries(COMP_CHANNEL_SOURCE_URLS)) {
    if (name.includes(key) || key.includes(name)) return url;
  }
  if (name.startsWith('EUR-Lex')) return 'https://eur-lex.europa.eu/homepage.html';
  if (name.startsWith('ECHACHEM')) return 'https://chem.echa.europa.eu/';
  if (name.startsWith('국가법령')) return 'https://www.law.go.kr/';
  if (name.startsWith('기후에너지환경부')) return 'https://mcee.go.kr/';
  if (name.startsWith('화학물질안전원')) return 'https://nics.mcee.go.kr/';
  return '#';
}

function toggleCompSummarySection() {
  const body = document.getElementById('compSummaryBody');
  const icon = document.getElementById('compSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'flex' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function switchCompSubTab(tabKey, btnElem) {
  document.querySelectorAll('#viewCompliance .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewCompliance .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const defaultBtn = document.getElementById(`btnCompTab${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`);
    defaultBtn?.classList.add('active');
  }

  const paneId = `compSubPane${tabKey.charAt(0).toUpperCase() + tabKey.slice(1)}`;
  document.getElementById(paneId)?.classList.add('active');

  if (tabKey === 'feed') {
    renderCompMonitoringFeedTable();
  } else if (tabKey === 'channels') {
    renderCompChannelsTable();
  } else if (tabKey === 'log') {
    filterCompRows();
  }
}

const escapeHtmlAttr = s => String(s || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escapeHtmlText = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatCompDate(d) {
  if (!d) return '';
  const s = String(d).trim();
  if (s === '-' || s === 'null' || s === 'undefined') return '';
  if (s.includes('T')) {
    const p = s.split('T')[0];
    if (/^\d{4}-\d{2}-\d{2}$/.test(p)) return p;
  }
  if (/^\d{4}[\.\/]\d{2}[\.\/]\d{2}$/.test(s)) return s.replace(/[\.\/]/g, '-');
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime()) && s.length >= 8) {
    return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
  }
  return '';
}

function updateCompAdminUI() {
  const saveBtn = document.getElementById('btnSaveAllTop');
  if (saveBtn) {
    saveBtn.style.display = 'none'; // Save 버튼 완전 숨김
  }
}

const openCompDB = () => new Promise(res => {
  try {
    const req = indexedDB.open(COMP_DB_NAME, 9);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('sources')) db.deleteObjectStore('sources');
      db.createObjectStore('sources', { keyPath: 'id' });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => res(null);
  } catch(e) { res(null); }
});

async function saveCompToDB(headers, items, lastUpdated, timeline, monitoringFeed, channels) {
  try {
    const db = await openCompDB();
    if (!db) return;
    const tx = db.transaction('sources', 'readwrite');
    const store = tx.objectStore('sources');
    store.clear();
    store.put({ id: '__meta__', headers, lastUpdated, timeline, monitoringFeed, channels });
    items.forEach(i => store.put(i));
  } catch(e) {}
}

async function loadCompFromDB() {
  try {
    const db = await openCompDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('sources', 'readonly').objectStore('sources').getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        if (!items.length) return res(null);
        const meta = items.find(i => i.id === '__meta__');
        
        // __meta__ 제외 후 ROW_ 뒤의 숫자 인덱스 기준으로 원본 순서 복원
        const rows = items.filter(i => i.id !== '__meta__');
        rows.sort((a, b) => {
          const idxA = parseInt(String(a.id || '').replace(/^ROW_/, ''), 10);
          const idxB = parseInt(String(b.id || '').replace(/^ROW_/, ''), 10);
          return (isNaN(idxA) ? 0 : idxA) - (isNaN(idxB) ? 0 : idxB);
        });

        res({
          headers: meta?.headers || [],
          lastUpdated: meta?.lastUpdated || '',
          timeline: meta?.timeline || [],
          monitoringFeed: meta?.monitoringFeed || { headers: [], data: [], errors: [] },
          channels: meta?.channels || { headers: [], data: [] },
          rows
        });
      };
      req.onerror = () => res(null);
    });
  } catch(e) { return null; }
}

async function clearCompIndexedDB() {
  try {
    const db = await openCompDB();
    if (db) db.transaction('sources', 'readwrite').objectStore('sources').clear();
  } catch(e) {}
}

// 2. 초기화 (기본 탭: Automated Feed)
async function initComplianceModule() {
  updateCompAdminUI();
  const cached = await loadCompFromDB();
  const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';

  if (cached?.rows?.length) {
    compRawHeaders = cached.headers;
    compDataset = cached.rows;
    window.compDataset = compDataset;
    compTimelineRawData = cached.timeline;
    
    if (cached.monitoringFeed) {
      compMonitoringFeedHeaders = cached.monitoringFeed.headers || [];
      compMonitoringFeedRows = cached.monitoringFeed.data || [];
      compMonitoringFeedErrors = cached.monitoringFeed.errors || [];
    }

    if (cached.channels) {
      compChannelsHeaders = cached.channels.headers || [];
      compChannelsRows = cached.channels.data || [];
    }

    setupCompColumns();
    renderCompTimeline();
    renderCompMonitoringFeedTable();
    renderCompChannelsTable();
    filterCompRows();
    switchCompSubTab('feed');

    const b = document.getElementById('compLastModifiedBadge');
    if (b) {
      b.textContent = cached.lastUpdated
        ? `Last Modified: ${cached.lastUpdated} KST(UTC+9)`
        : 'Last Modified: Live Synced';
    }

    if (key) {
      checkComplianceVersion(key, cached.lastUpdated);
    }
  } else {
    setupCompColumns();
    switchCompSubTab('feed');
    if (key) {
      await fetchComplianceData(key);
    }
  }
}

async function checkComplianceVersion(key, localLastUpdated) {
  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'check_version' })
    });
    const res = await resp.json();

    if (res?.status === 'success' && res.lastUpdated && res.lastUpdated !== localLastUpdated) {
      await fetchComplianceData(key);
    }
  } catch (e) {
    console.warn("Compliance version check failed:", e);
  }
}

async function fetchComplianceData(authOverride = '') {
  if (compIsFetching) return;

  const key = authOverride || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  const badge = document.getElementById('compViewerBadgeCount');

  if (!key) {
    document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
    if (badge) badge.textContent = 'Auth Required';
    return { status: 'auth_failed' };
  }

  compIsFetching = true;
  if (badge && !compDataset.length) badge.textContent = 'Syncing...';

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data' })
    });
    const res = await resp.json();

    if (res?.status === 'auth_failed' || res?.status === 'forbidden') {
      if (badge) badge.textContent = res.status === 'forbidden' ? 'Access Denied' : 'Auth Failed';
      setupCompColumns();
      filterCompRows();
      return res;
    }

    compRawHeaders = res.headers || [];
    compTimelineRawData = res.timeline || [];
    compUnsavedChanges.clear();

    const rawData = Array.isArray(res.data) ? res.data : [];
    compDataset = rawData.filter(r => Array.isArray(r) && r.some(c => c !== '')).map((item, idx) => ({
      id: `ROW_${idx}`,
      source: String(item[0] || ''),
      linkName: String(item[1] || ''),
      linkUrl: String(item[2] || ''),
      criteria: String(item[3] || ''),
      criteriaUrl: String(item[4] || ''), // 신규: Date Basis Link
      date: formatCompDate(item[5]),      // 인덱스 5로 이동
      ref: String(item[6] || ''),         // 인덱스 6으로 이동
      details: String(item[7] || '')      // 인덱스 7로 이동
    }));
    window.compDataset = compDataset;

    if (res.monitoringFeed) {
      compMonitoringFeedHeaders = res.monitoringFeed.headers || [];
      const rawRows = res.monitoringFeed.data || [];
      rawRows.sort((a, b) => String(b[0] || '').localeCompare(String(a[0] || '')));
      compMonitoringFeedRows = rawRows;
      compMonitoringFeedErrors = res.monitoringFeed.errors || [];
    }

    if (res.channels) {
      compChannelsHeaders = res.channels.headers || [];
      compChannelsRows = res.channels.data || [];
    }

    await saveCompToDB(compRawHeaders, compDataset, res.lastUpdated || '', compTimelineRawData, {
      headers: compMonitoringFeedHeaders,
      data: compMonitoringFeedRows,
      errors: compMonitoringFeedErrors
    }, {
      headers: compChannelsHeaders,
      data: compChannelsRows
    });

    setupCompColumns();
    renderCompTimeline();
    renderCompMonitoringFeedTable();
    renderCompChannelsTable();
    filterCompRows();
    updateSaveButtonState();
    updateCompAdminUI();

    const b = document.getElementById('compLastModifiedBadge');
    if (b) {
      b.textContent = res.lastUpdated ? `Last Modified: ${res.lastUpdated} KST(UTC+9)` : 'Last Modified: Live Synced';
    }
    return res;
  } catch(err) {
    console.error("fetchComplianceData error:", err);
    if (badge && !compDataset.length) badge.textContent = 'Sync Failed';
    setupCompColumns();
    filterCompRows();
  } finally {
    compIsFetching = false;
  }
}

// 3. Milestone Timeline Rendering (Compliance에서 ChemHub로 이전되어 가드 처리)
function renderCompTimeline() {
  const wrapper = document.getElementById('compTimelineWrapper');
  if (!wrapper) return;
  if (!compTimelineRawData?.length) {
    wrapper.innerHTML = '<div class="empty-state-row text-sm">No Timeline milestones available.</div>';
    return;
  }

  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(compTimelineRawData.length, 6); r++) {
    const row = compTimelineRawData[r] || [];
    const dateCount = row.filter(cell => /\d{4}/.test(String(cell))).length;
    if (dateCount >= 1) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = compTimelineRawData[headerRowIdx] || [];
  const dataRows = compTimelineRawData.slice(headerRowIdx + 1);
  const validColIndices = [];
  let firstDateColIdx = 999;

  headerRow.forEach((h, c) => {
    const raw = String(h || '').trim();
    if (!raw) return;
    if (/\d{4}|[12]H|Q[1-4]/i.test(raw)) {
      validColIndices.push({ index: c, label: raw });
      if (c < firstDateColIdx) firstDateColIdx = c;
    }
  });

  const regNameColIdx = (firstDateColIdx > 0 && firstDateColIdx !== 999) ? (firstDateColIdx - 1) : 0;

  let html = `
    <table class="timeline-table" style="width:100%; min-width:980px; border-collapse:separate; border-spacing:0;">
      <thead>
        <tr>
          <th class="data-table-th reg-name-th" style="min-width:160px; padding:8px 12px;">Regulation</th>
          ${validColIndices.map(col => `<th class="data-table-th text-center" style="min-width:110px; padding:8px 10px; white-space:nowrap;">${escapeHtmlText(col.label)}</th>`).join('')}
        </tr>
      </thead>
      <tbody>`;

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

    html += `<tr><td class="data-cell reg-name-td font-semibold text-main" style="padding:8px 12px;">${escapeHtmlText(regName)}</td>` +
      validColIndices.map(col => {
        const val = String(row[col.index] || '').trim();
        if (!val || val === '-') return '<td class="data-cell text-center text-muted" style="padding:6px 8px;">-</td>';
        const isHigh = /Entry into Force|Application|Final adoption|Repeal/i.test(val);
        const badgeClass = isHigh ? 'milestone-badge highlight' : 'milestone-badge';
        return `<td class="data-cell text-center" style="padding:6px 8px;"><span class="${badgeClass}">${escapeHtmlText(val).replace(/\n/g, '<br>')}</span></td>`;
      }).join('') + '</tr>';
  });

  if (!hasRows) html += `<tr><td colspan="${validColIndices.length + 1}" class="empty-state-row">No Regulation entries found.</td></tr>`;
  html += '</tbody></table>';
  wrapper.innerHTML = html;
}

// 4. Columns Setup (Monitoring Log Tab)
function setupCompColumns() {
  compDisplayColumns = [
    { key: 'no', label: 'No.', width: '4%' },
    { key: 'source', label: compRawHeaders[0] || 'Source', width: '9%', isMulti: true },
    { key: 'link', label: compRawHeaders[2] || 'Target Link', width: '16%' },
    { key: 'criteria', label: compRawHeaders[3] || 'Date Basis', width: '9%' },
    { key: 'date', label: compRawHeaders[5] || 'Date', width: '9%' },
    { key: 'ref', label: compRawHeaders[6] || 'Ref. Values', width: '9%' },
    { key: 'details', label: compRawHeaders[7] || 'Notes', width: 'auto' }
  ];

  const headRow = document.getElementById('compTableHeadRow');
  const filterRow = document.getElementById('compTableFilterRow');
  if (!headRow || !filterRow) return;

  headRow.innerHTML = ''; 
  filterRow.innerHTML = '';
  compTableFilters = Array(compDisplayColumns.length).fill('');
  compMultiSelectFilters = { 1: new Set() };

  compDisplayColumns.forEach((col, idx) => {
    headRow.innerHTML += `<th class="data-table-th text-center text-sm" style="width:${col.width}; padding:8px 6px;">${col.label}</th>`;
    
    if (col.isMulti) {
      filterRow.innerHTML += `
        <th class="filter-th" style="padding:4px 4px;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="compMsBtn_${idx}" onclick="toggleCompDropdown(${idx})" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="compMsText_${idx}">All</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compMsDropdown_${idx}"></div>
          </div>
        </th>`;
    } else if (col.key !== 'no') {
      filterRow.innerHTML += `<th class="filter-th" style="padding:4px 4px;"><input type="text" class="filter-input" placeholder="Filter..." oninput="onCompFilterChange(${idx}, this.value)" style="padding:3px 5px; font-size:0.75rem;"></th>`;
    } else {
      filterRow.innerHTML += '<th class="filter-th"></th>';
    }
  });

  updateCompAdminUI();
}

function getCompRowField(r, idx) {
  const searchVals = [
    '', 
    r.source, 
    `${r.linkName} ${r.linkUrl}`, 
    `${r.criteria} ${r.criteriaUrl || ''}`, // Date Basis 텍스트와 URL 모두 검색/필터 지원
    r.date, 
    r.ref, 
    r.details
  ];
  return searchVals[idx] || '';
}

function getCompAvailableRows(excludeColIdx = -1) {
  return compDataset.filter((r, rowIdx) => {
    for (let i = 0; i < compDisplayColumns.length; i++) {
      if (i === excludeColIdx) continue;
      
      if (compDisplayColumns[i].isMulti) {
        const selSet = compMultiSelectFilters[i];
        if (selSet && selSet.size > 0) {
          const val = getCompRowField(r, i);
          if (!selSet.has(val)) return false;
        }
      } else {
        const kw = compTableFilters[i];
        if (kw) {
          const target = (i === 0) ? String(rowIdx + 1) : getCompRowField(r, i);
          if (!target.toLowerCase().includes(kw)) return false;
        }
      }
    }
    return true;
  });
}

function populateSingleCompDropdown(colIdx) {
  const dd = document.getElementById(`compMsDropdown_${colIdx}`);
  if (!dd) return;

  const availableRows = getCompAvailableRows(colIdx);
  const rawList = availableRows.map(r => getCompRowField(r, colIdx)).filter(Boolean);
  const unique = [...new Set(rawList)].sort();
  const currentSet = compMultiSelectFilters[colIdx] || new Set();

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (textEl) textEl.textContent = currentSet.size === 0 ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="compChkAll_${colIdx}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompDropdown(${colIdx}, this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:4px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => `
      <label class="multiselect-item">
        <input type="checkbox" value="${escapeHtmlAttr(val)}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompDropdownItem(${colIdx}, '${escapeHtmlAttr(val)}', this.checked)">
        <span>${escapeHtmlText(val)}</span>
      </label>`).join('');
}

function populateCompAllDropdowns() {
  [1].forEach(colIdx => populateSingleCompDropdown(colIdx));
}

function toggleCompDropdown(colIdx) {
  const dd = document.getElementById(`compMsDropdown_${colIdx}`);
  const btn = document.getElementById(`compMsBtn_${colIdx}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleCompDropdown(colIdx);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 260))}px`;
    dd.classList.add('show');
  }
}

function selectAllCompDropdown(colIdx, chk) {
  if (compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx].clear();
  document.querySelectorAll(`#compMsDropdown_${colIdx} input[type="checkbox"]`).forEach(c => { 
    if (c !== chk) c.checked = false; 
  });
  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (textEl) textEl.textContent = 'All';
  compCurrentPage = 1;
  filterCompRows();
}

function toggleCompDropdownItem(colIdx, val, checked) {
  if (!compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx] = new Set();
  checked ? compMultiSelectFilters[colIdx].add(val) : compMultiSelectFilters[colIdx].delete(val);
  
  const cnt = compMultiSelectFilters[colIdx].size;
  const chkAll = document.getElementById(`compChkAll_${colIdx}`);
  const textEl = document.getElementById(`compMsText_${colIdx}`);
  if (chkAll) chkAll.checked = (cnt === 0);
  if (textEl) textEl.textContent = cnt === 0 ? 'All' : `${cnt} selected`;
  
  compCurrentPage = 1;
  filterCompRows();
}

function onCompFilterChange(idx, val) {
  compTableFilters[idx] = val.toLowerCase().trim();
  compCurrentPage = 1;
  filterCompRows();
}

function getFilteredCompData() {
  return compDataset.filter((r, rowIdx) => {
    if (compMultiSelectFilters[1]?.size && !compMultiSelectFilters[1].has(r.source)) return false;

    for (let i = 0; i < compDisplayColumns.length; i++) {
      if (compDisplayColumns[i].isMulti) continue;
      const kw = compTableFilters[i];
      if (kw) {
        const target = (i === 0) ? String(rowIdx + 1) : getCompRowField(r, i);
        if (!target.toLowerCase().includes(kw)) return false;
      }
    }
    return true;
  });
}

// 5. Main Table Render & Pagination (Monitoring Log)
function filterCompRows() {
  populateCompAllDropdowns();
  const tbody = document.getElementById('compTableDataBody');
  if (!tbody) return;

  const filtered = getFilteredCompData();
  const totalItems = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / compPageSize));

  if (compCurrentPage > totalPages) compCurrentPage = totalPages;
  const startIdx = (compCurrentPage - 1) * compPageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + compPageSize);

  let html = '';

  pagedRows.forEach((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const isDirty = compUnsavedChanges.has(r.id);
    const rowBg = isDirty ? 'background-color: #fffbeb;' : '';
    const hasLink = Boolean(r.linkUrl && r.linkUrl !== '#');

    html += `
      <tr data-id="${r.id}" style="${rowBg}">
        <td class="data-cell text-center text-muted text-sm font-normal" style="padding:4px 6px;">
          ${actualNo}
          ${isDirty ? '<span title="Unsaved changes" style="display:inline-block; width:6px; height:6px; background:#ea580c; border-radius:50%; margin-left:2px; vertical-align:top;"></span>' : ''}
        </td>
        <td class="data-cell text-center text-body font-normal" style="padding:4px 6px; font-size:0.80rem; white-space:nowrap;">${escapeHtmlText(r.source || '-')}</td>
        <td class="data-cell" style="padding:4px 6px; max-width:150px;">
          <div class="cell-ellipsis" style="width:100%;">
            ${hasLink 
              ? `<a href="${escapeHtmlAttr(r.linkUrl)}" target="_blank" rel="noopener noreferrer" class="link-anchor text-info font-normal cell-ellipsis" style="text-decoration:none; font-size:0.80rem; display:block;" title="${escapeHtmlAttr(r.linkName || r.linkUrl)}">${escapeHtmlText(r.linkName || 'Open Link')}</a>` 
              : `<span class="text-sm text-muted font-normal" style="font-style:italic;">No link</span>`}
          </div>
        </td>
        <td class="data-cell text-center" style="padding:4px 6px;">
          ${(r.criteriaUrl && r.criteriaUrl !== '#')
            ? `<a href="${escapeHtmlAttr(r.criteriaUrl)}" target="_blank" rel="noopener noreferrer" class="link-anchor text-info font-normal cell-ellipsis" style="text-decoration:none; font-size:0.80rem; display:block;" title="${escapeHtmlAttr(r.criteria || r.criteriaUrl)}">${escapeHtmlText(r.criteria || 'Open Link')}</a>`
            : `<span class="cell-read-only font-normal" style="font-size:0.80rem;" title="${escapeHtmlAttr(r.criteria || '-')}">${escapeHtmlText(r.criteria || '-')}</span>`}
        </td>
        <td class="data-cell text-center font-normal text-body" style="padding:4px 6px; font-size:0.80rem;">
          <span class="cell-read-only font-normal text-body" style="font-size:0.80rem;">${r.date || '-'}</span>
        </td>
        <td class="data-cell text-center font-normal text-body" style="padding:4px 6px; font-size:0.80rem;">
          <span class="cell-read-only font-normal text-body" style="font-size:0.80rem;">${escapeHtmlText(r.ref || '-')}</span>
        </td>
        <td class="data-cell font-normal text-body" style="padding:6px 8px;">
          <div class="cell-read-only font-normal text-body" style="white-space:pre-wrap; line-height:1.5; font-size:0.80rem; word-break:break-word;">${escapeHtmlText(r.details || '-')}</div>
        </td>
      </tr>`;
  });

  tbody.innerHTML = html || `<tr><td colspan="${compDisplayColumns.length}" class="empty-state-row text-sm">No matching records found.</td></tr>`;
  
  const countBadge = document.getElementById('compViewerBadgeCount');
  if (countBadge) countBadge.textContent = `Showing ${filtered.length} of ${compDataset.length} sources`;

  const pageInfo = document.getElementById('compPageInfoDisplay');
  if (pageInfo) pageInfo.textContent = `Page ${compCurrentPage} of ${totalPages}`;

  const btnPrev = document.getElementById('btnCompPrevPage');
  const btnNext = document.getElementById('btnCompNextPage');
  if (btnPrev) btnPrev.disabled = (compCurrentPage <= 1);
  if (btnNext) btnNext.disabled = (compCurrentPage >= totalPages);

  requestAnimationFrame(() => {
    document.querySelectorAll('#compTableDataBody .tbl-textarea-details').forEach(el => autoGrowCompTextarea(el));
  });
}

function goToCompPage(page) {
  const filtered = getFilteredCompData();
  const totalPages = Math.max(1, Math.ceil(filtered.length / compPageSize));
  if (page < 1 || page > totalPages) return;
  compCurrentPage = page;
  filterCompRows();
}

function changeCompPageSize(newSize) {
  compPageSize = parseInt(newSize, 10) || 50;
  compCurrentPage = 1;
  filterCompRows();
}

function autoGrowCompTextarea(el) {
  if (!el) return;
  el.style.height = 'auto';
  const newHeight = Math.max(el.scrollHeight, 34);
  el.style.height = `${newHeight}px`;
  el.style.overflowY = 'hidden';
}

function updateCompCell(id, key, val) {
  const item = compDataset.find(d => d.id === id);
  if (item) {
    item[key] = val.trim();
    compUnsavedChanges.add(id);
    updateSaveButtonState();
    
    const rowEl = document.querySelector(`tr[data-id="${id}"]`);
    if (rowEl) rowEl.style.backgroundColor = '#fffbeb';
  }
}

function updateSaveButtonState() {
  const btn = document.getElementById('btnSaveAllTop');
  if (btn) btn.style.display = 'none'; // 화면에서 Save 버튼 완전 비표시
}

function resetComplianceFilters() {
  document.querySelectorAll('#compTableFilterRow .filter-input').forEach(i => i.value = '');
  compTableFilters = Array(compDisplayColumns.length).fill('');
  
  [1].forEach(colIdx => {
    if (compMultiSelectFilters[colIdx]) compMultiSelectFilters[colIdx].clear();
    document.querySelectorAll(`#compMsDropdown_${colIdx} input[type="checkbox"]`).forEach(c => { c.checked = false; });
    const allChk = document.getElementById(`compChkAll_${colIdx}`);
    if (allChk) allChk.checked = true;
    const textEl = document.getElementById(`compMsText_${colIdx}`);
    if (textEl) textEl.textContent = 'All';
  });

  compCurrentPage = 1;
  filterCompRows();
}

// =========================================================================
// 6. AUTOMATED MONITORING FEED ENGINE (9개 열, Monitored/Title/Summary/Remarks 규격)
// =========================================================================
function renderCompMonitoringFeedTable() {
  const table = document.getElementById('compFeedDataTable');
  const headRow = document.getElementById('compFeedTableHeadRow');
  const filterRow = document.getElementById('compFeedTableFilterRow');
  const tbody = document.getElementById('compFeedTableDataBody');
  const badge = document.getElementById('compDailyFeedBadge');
  if (!headRow || !filterRow || !tbody) return;

  if (table) {
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
  }

  // 8개 화면 표시 열 구성 규격 (Date 제거, Summary 및 Remarks 영역 확장)
  const columns = [
    { label: 'No.', width: '3.5%', filterType: 'none' },
    { label: 'Monitored', width: '7.5%', filterType: 'text', dataIdx: 0 },
    { label: 'Region', width: '5.5%', filterType: 'dropdown', key: 'region' },
    { label: 'Source / Endpoint', width: '13%', filterType: 'text', dataIdx: 2 },
    { label: 'Title', width: '21%', filterType: 'text', dataIdx: 5 },
    { label: 'Status', width: '7.5%', filterType: 'dropdown', key: 'status' },
    { label: 'Summary', width: 'auto', filterType: 'text', dataIdx: 8 },
    { label: 'Remarks', width: '16.5%', filterType: 'text', dataIdx: 10 }
  ];

  if (!compMonitoringFeedRows.length) {
    headRow.innerHTML = columns.map(c => `<th class="data-table-th text-center" style="width:${c.width};">${escapeHtmlText(c.label)}</th>`).join('');
    filterRow.innerHTML = columns.map(c => `<th class="filter-th" style="width:${c.width};"></th>`).join('');
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state-row text-sm">No Monitoring Feed Data Synchronized Yet.</td></tr>';
    if (badge) badge.textContent = '0 items';
    return;
  }

  headRow.innerHTML = columns.map(c => 
    `<th class="data-table-th text-center text-sm" style="width:${c.width}; max-width:${c.width}; padding:8px 6px;">${escapeHtmlText(c.label)}</th>`
  ).join('');

  filterRow.innerHTML = columns.map(c => {
    if (c.filterType === 'none') {
      return `<th class="filter-th" style="width:${c.width}; padding:4px 2px;"></th>`;
    }
    
    if (c.filterType === 'dropdown') {
      const currentSet = compFeedMultiFilters[c.key] || new Set();
      const btnText = !currentSet.size ? 'All' : `${currentSet.size} selected`;
      return `
        <th class="filter-th" style="width:${c.width}; padding:4px 2px; box-sizing:border-box;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="compFeedMsBtn_${c.key}" onclick="toggleCompFeedDropdown('${c.key}')" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="compFeedMsText_${c.key}">${btnText}</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compFeedMsDropdown_${c.key}"></div>
          </div>
        </th>`;
    }

    const curVal = compFeedFilters[c.dataIdx] || '';
    return `
      <th class="filter-th" style="width:${c.width}; padding:4px 3px; box-sizing:border-box;">
        <input type="text" class="filter-input" placeholder="Filter..." value="${escapeHtmlAttr(curVal)}" oninput="onCompFeedFilterChange(${c.dataIdx}, this.value)" style="width:100%; padding:3px 5px; font-size:0.75rem;">
      </th>`;
  }).join('');

  filterCompFeedRows();
  renderCompMonitoringFeedErrors();
}

function getCompFeedAvailableRows(excludeKey = '') {
  return compMonitoringFeedRows.filter(row => {
    // Region 멀티 드롭다운 검증
    if (excludeKey !== 'region' && compFeedMultiFilters.region?.size > 0) {
      const reg = String(row[1] || '').trim();
      if (!reg) {
        if (!compFeedMultiFilters.region.has('(blank)')) return false;
      } else {
        if (!compFeedMultiFilters.region.has(reg)) return false;
      }
    }

    // Status 멀티 드롭다운 검증
    if (excludeKey !== 'status' && compFeedMultiFilters.status?.size > 0) {
      const st = String(row[7] || '').trim();
      if (!st) {
        if (!compFeedMultiFilters.status.has('(blank)')) return false;
      } else {
        if (!compFeedMultiFilters.status.has(st)) return false;
      }
    }

    // 텍스트 필터 검증
    for (const [colIdxStr, kw] of Object.entries(compFeedFilters)) {
      if (!kw) continue;
      const c = parseInt(colIdxStr, 10);
      const cellVal = String(row[c] || '').toLowerCase();
      if (!cellVal.includes(kw)) return false;
    }
    return true;
  });
}

function populateSingleCompFeedDropdown(key) {
  const dd = document.getElementById(`compFeedMsDropdown_${key}`);
  if (!dd) return;

  const colIdx = (key === 'region') ? 1 : 7;
  const availableRows = getCompFeedAvailableRows(key);
  const currentSet = compFeedMultiFilters[key] || new Set();
  const uniqueSet = new Set();
  let hasEmptyCell = false;

  availableRows.forEach(row => {
    const rawVal = String(row[colIdx] || '').trim();
    if (!rawVal) {
      hasEmptyCell = true;
    } else {
      uniqueSet.add(rawVal);
    }
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (hasEmptyCell) {
    unique.unshift('(blank)');
  }

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`compFeedMsText_${key}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="compFeedChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompFeedDropdown('${key}', this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => {
      let displayLabel = escapeHtmlText(val);
      if (val === '(blank)') displayLabel = '<span class="text-muted font-medium">(blank)</span>';
      const safeAttrVal = escapeHtmlAttr(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" value="${safeAttrVal}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompFeedDropdownItem('${key}', '${safeAttrVal}', this.checked)">
          <span>${displayLabel}</span>
        </label>`;
    }).join('');
}

function toggleCompFeedDropdown(key) {
  const dd = document.getElementById(`compFeedMsDropdown_${key}`);
  const btn = document.getElementById(`compFeedMsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleCompFeedDropdown(key);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 240))}px`;
    dd.classList.add('show');
  }
}

function selectAllCompFeedDropdown(key, chk) {
  if (!compFeedMultiFilters[key]) compFeedMultiFilters[key] = new Set();
  compFeedMultiFilters[key].clear();
  document.querySelectorAll(`#compFeedMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });
  const msText = document.getElementById(`compFeedMsText_${key}`);
  if (msText) msText.textContent = 'All';
  filterCompFeedRows();
}

function toggleCompFeedDropdownItem(key, val, checked) {
  if (!compFeedMultiFilters[key]) compFeedMultiFilters[key] = new Set();
  checked ? compFeedMultiFilters[key].add(val) : compFeedMultiFilters[key].delete(val);
  const cnt = compFeedMultiFilters[key].size;
  const chkAll = document.getElementById(`compFeedChkAll_${key}`);
  if (chkAll) chkAll.checked = !cnt;
  const msText = document.getElementById(`compFeedMsText_${key}`);
  if (msText) msText.textContent = !cnt ? 'All' : `${cnt} selected`;
  filterCompFeedRows();
}

function filterCompFeedRows() {
  const tbody = document.getElementById('compFeedTableDataBody');
  const badge = document.getElementById('compDailyFeedBadge');
  if (!tbody) return;

  const filtered = compMonitoringFeedRows.filter(row => {
    // Region 필터 검증
    if (compFeedMultiFilters.region?.size > 0) {
      const reg = String(row[1] || '').trim();
      if (!reg) {
        if (!compFeedMultiFilters.region.has('(blank)')) return false;
      } else {
        if (!compFeedMultiFilters.region.has(reg)) return false;
      }
    }

    // Status 필터 검증
    if (compFeedMultiFilters.status?.size > 0) {
      const st = String(row[7] || '').trim();
      if (!st) {
        if (!compFeedMultiFilters.status.has('(blank)')) return false;
      } else {
        if (!compFeedMultiFilters.status.has(st)) return false;
      }
    }

    // 텍스트 필터 검증
    for (const [colIdxStr, kw] of Object.entries(compFeedFilters)) {
      if (!kw) continue;
      const c = parseInt(colIdxStr, 10);
      const cellVal = String(row[c] || '').toLowerCase();
      if (!cellVal.includes(kw)) return false;
    }
    return true;
  });

  if (badge) badge.textContent = `${filtered.length} of ${compMonitoringFeedRows.length} items`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state-row text-sm">No matching feed records found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((row, idx) => {
    const no = idx + 1;
    const rawExecTime = String(row[0] || '').trim();
    const execTime = rawExecTime.split(' ')[0] || '-'; // 시간 제거, 날짜만 표시
    const region = String(row[1] || '').trim();
    const sourceEndpoint = String(row[2] || '').trim();
    const sourceUrl = row[3] || getChannelSourceUrl(sourceEndpoint); // D열: Source URL
    const pubDate = String(row[4] || '').trim();                     // E열: Date
    const title = String(row[5] || '').trim();                       // F열: Latest Record / Title
    const link = String(row[6] || '').trim();                        // G열: Link
    const status = String(row[7] || '').trim();                      // H열: Status
    const summary = String(row[8] || '').trim();                     // I열: Summary
    const moreDetails = String(row[9] || '').trim();                 // J열: More Details
    const remarks = String(row[10] || '').trim();                    // K열: Remarks

    // Source / Endpoint 인라인 링크
    const isSourceLink = /^https?:\/\//i.test(sourceUrl);
    const sourceHtml = isSourceLink
      ? `<a href="${escapeHtmlAttr(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal cell-ellipsis" style="text-decoration:none; display:block;" title="${escapeHtmlAttr(sourceEndpoint)}">${escapeHtmlText(sourceEndpoint || '-')}</a>`
      : `<span class="cell-ellipsis" style="display:block;" title="${escapeHtmlAttr(sourceEndpoint)}">${escapeHtmlText(sourceEndpoint || '-')}</span>`;

    // Title 인라인 링크
    const isLinkUrl = /^https?:\/\//i.test(link);
    const titleHtml = isLinkUrl
      ? `<a href="${escapeHtmlAttr(link)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal cell-ellipsis" style="text-decoration:none; display:block;" title="${escapeHtmlAttr(title)}">${escapeHtmlText(title || '-')}</a>`
      : `<span class="text-body cell-ellipsis" style="display:block;" title="${escapeHtmlAttr(title)}">${escapeHtmlText(title || '-')}</span>`;

    // Status: 텍스트 색상만 분기
    const statusText = (status === '-' ? '' : status);
    let statusColor = '#64748b';
    const stClean = status.toLowerCase();
    if (stClean === 'completed') {
      statusColor = '#16a34a';
    } else if (stClean === 'in progress' || stClean === 'in-progress') {
      statusColor = '#d97706';
    }

    // Summary: More Details 링크
    const isMoreDetailsLink = /^https?:\/\//i.test(moreDetails);
    let summaryHtml = '';
    if (summary) {
      summaryHtml = isMoreDetailsLink
        ? `<a href="${escapeHtmlAttr(moreDetails)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration:none; font-size:0.75rem; line-height:1.4; display:block; white-space:pre-line; word-break:break-word;" title="${escapeHtmlAttr(summary)}">${escapeHtmlText(summary)}</a>`
        : `<div class="text-muted" style="font-size:0.75rem; line-height:1.4; white-space:pre-line; word-break:break-word;" title="${escapeHtmlAttr(summary)}">${escapeHtmlText(summary)}</div>`;
    }

    // Remarks
    const remarksHtml = remarks
      ? `<div class="text-muted" style="font-size:0.76rem; line-height:1.4; white-space:pre-line; word-break:break-word;" title="${escapeHtmlAttr(remarks)}">${escapeHtmlText(remarks)}</div>`
      : '';

    return `
      <tr style="min-height:36px; border-bottom:1px solid #f1f5f9;">
        <td class="data-cell text-center text-muted text-sm font-normal" style="white-space:nowrap;">${no}</td>
        <td class="data-cell text-center font-mono text-xs text-muted font-normal" style="white-space:nowrap;" title="${escapeHtmlAttr(rawExecTime)}">${escapeHtmlText(execTime)}</td>
        <td class="data-cell text-center text-sm text-body font-normal" style="white-space:nowrap;">${escapeHtmlText(region || '')}</td>
        <td class="data-cell text-sm cell-ellipsis" style="padding:4px 8px;">${sourceHtml}</td>
        <td class="data-cell text-sm cell-ellipsis font-normal" style="padding:4px 8px;">${titleHtml}</td>
        <td class="data-cell text-center text-sm font-normal" style="color:${statusColor}; white-space:nowrap;">${escapeHtmlText(statusText)}</td>
        <td class="data-cell font-normal" style="padding:4px 8px; font-size:0.75rem; vertical-align:middle;">${summaryHtml}</td>
        <td class="data-cell font-normal" style="padding:4px 8px; font-size:0.76rem; vertical-align:middle;">${remarksHtml}</td>
      </tr>`;
  }).join('');
}

function renderCompMonitoringFeedErrors() {
  const section = document.getElementById('compFeedErrorSection');
  const badge = document.getElementById('compFeedErrorBadge');
  const container = document.getElementById('compFeedErrorContainer');
  if (!section || !container) return;

  if (!compMonitoringFeedErrors || !compMonitoringFeedErrors.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  if (badge) badge.textContent = `${compMonitoringFeedErrors.length} Issue(s)`;

  container.innerHTML = compMonitoringFeedErrors.map(err => `
    <div style="background:#ffffff; border:1px solid #fecaca; border-radius:6px; padding:10px 14px; display:flex; flex-direction:column; gap:4px;">
      <div class="font-normal text-base" style="color:#b91c1c;">${escapeHtmlText(err.target || 'Target')}</div>
      <div class="font-mono text-xs" style="color:#7f1d1d; word-break:break-all; line-height:1.45; background:#fef2f2; padding:6px 8px; border-radius:4px;">${escapeHtmlText(err.diagnostic || 'No diagnostic message')}</div>
    </div>
  `).join('');
}

function onCompFeedFilterChange(colIdx, val) {
  compFeedFilters[colIdx] = val.toLowerCase().trim();
  filterCompFeedRows();
}

function resetCompFeedFilters() {
  compFeedFilters = {};
  compFeedMultiFilters = { region: new Set(), status: new Set() };
  document.querySelectorAll('#compFeedTableFilterRow .filter-input').forEach(i => i.value = '');
  ['region', 'status'].forEach(key => {
    const textEl = document.getElementById(`compFeedMsText_${key}`);
    if (textEl) textEl.textContent = 'All';
    const chkAll = document.getElementById(`compFeedChkAll_${key}`);
    if (chkAll) chkAll.checked = true;
    document.querySelectorAll(`#compFeedMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
      if (c !== chkAll) c.checked = false;
    });
  });
  filterCompFeedRows();
}

// =========================================================================
// 7. CHANNELS ENGINE (No. 열 자동 생성, 인라인 링크, 다중 선택 드롭다운 필터)
// =========================================================================
function renderCompChannelsTable() {
  const table = document.getElementById('compChannelsTable');
  const headRow = document.getElementById('compChannelsTableHeadRow');
  const filterRow = document.getElementById('compChannelsTableFilterRow');
  const tbody = document.getElementById('compChannelsTableDataBody');
  const badge = document.getElementById('compChannelsBadge');
  if (!headRow || !filterRow || !tbody) return;

  if (table) {
    table.style.tableLayout = 'fixed';
    table.style.width = '100%';
  }

  const columns = [
    { label: 'No.', width: '4%', filterType: 'none' },
    { label: 'Region', width: '8%', filterType: 'dropdown', key: 'region' },
    { label: 'Source / Endpoint', width: 'auto', filterType: 'text', key: 'source' },
    { label: 'Last Verified (KST)', width: '17%', filterType: 'text', key: 'verified' },
    { label: 'Status', width: '10%', filterType: 'dropdown', key: 'status' }
  ];

  if (!compChannelsRows.length) {
    headRow.innerHTML = columns.map(c => `<th class="data-table-th text-center" style="width:${c.width};">${escapeHtmlText(c.label)}</th>`).join('');
    filterRow.innerHTML = columns.map(c => `<th class="filter-th" style="width:${c.width};"></th>`).join('');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state-row text-sm">No Channels Data Synchronized Yet.</td></tr>';
    if (badge) badge.textContent = '0 channels';
    return;
  }

  headRow.innerHTML = columns.map(c => 
    `<th class="data-table-th text-center text-sm" style="width:${c.width}; max-width:${c.width}; padding:8px 8px;">${escapeHtmlText(c.label)}</th>`
  ).join('');

  filterRow.innerHTML = columns.map(c => {
    if (c.filterType === 'none') {
      return `<th class="filter-th" style="width:${c.width}; padding:4px 2px;"></th>`;
    }

    if (c.filterType === 'dropdown') {
      const currentSet = compChannelsMultiFilters[c.key] || new Set();
      const btnText = !currentSet.size ? 'All' : `${currentSet.size} selected`;
      return `
        <th class="filter-th" style="width:${c.width}; padding:4px 2px; box-sizing:border-box;">
          <div class="multiselect-container">
            <button type="button" class="multiselect-btn" id="compChannelsMsBtn_${c.key}" onclick="toggleCompChannelsDropdown('${c.key}')" style="padding:3px 4px; font-size:0.75rem;">
              <span class="multiselect-btn-text" id="compChannelsMsText_${c.key}">${btnText}</span>
              <span style="font-size:0.6rem; color:#64748b;">▼</span>
            </button>
            <div class="multiselect-dropdown" id="compChannelsMsDropdown_${c.key}"></div>
          </div>
        </th>`;
    }

    const curVal = compChannelsFilters[c.key] || '';
    const placeholder = c.key === 'source' ? 'Search Source...' : 'Search Date...';
    return `
      <th class="filter-th" style="width:${c.width}; padding:4px 3px; box-sizing:border-box;">
        <input type="text" id="filterChannels_${c.key}" class="filter-input" placeholder="${placeholder}" value="${escapeHtmlAttr(curVal)}" oninput="onCompChannelsFilterChange('${c.key}', this.value)" style="width:100%; padding:3px 5px; font-size:0.75rem;">
      </th>`;
  }).join('');

  filterCompChannelsRows();
}

function getCompChannelsAvailableRows(excludeKey = '') {
  return compChannelsRows.filter(r => {
    const region = String(r[0] || '').trim();
    const sourceEndpoint = String(r[1] || '').trim();
    const verified = String(r[3] || '').trim();
    const status = String(r[4] || '').trim();

    // Region 멀티 드롭다운 검증
    if (excludeKey !== 'region' && compChannelsMultiFilters.region?.size > 0) {
      if (!region) {
        if (!compChannelsMultiFilters.region.has('(blank)')) return false;
      } else {
        if (!compChannelsMultiFilters.region.has(region)) return false;
      }
    }

    // Status 멀티 드롭다운 검증
    if (excludeKey !== 'status' && compChannelsMultiFilters.status?.size > 0) {
      if (!status) {
        if (!compChannelsMultiFilters.status.has('(blank)')) return false;
      } else {
        if (!compChannelsMultiFilters.status.has(status)) return false;
      }
    }

    // 텍스트 필터 검증
    if (compChannelsFilters.source && !sourceEndpoint.toLowerCase().includes(compChannelsFilters.source.toLowerCase())) return false;
    if (compChannelsFilters.verified && !verified.toLowerCase().includes(compChannelsFilters.verified.toLowerCase())) return false;

    return true;
  });
}

function populateSingleCompChannelsDropdown(key) {
  const dd = document.getElementById(`compChannelsMsDropdown_${key}`);
  if (!dd) return;

  const colIdx = (key === 'region') ? 0 : 4;
  const availableRows = getCompChannelsAvailableRows(key);
  const currentSet = compChannelsMultiFilters[key] || new Set();
  const uniqueSet = new Set();
  let hasEmptyCell = false;

  availableRows.forEach(r => {
    const rawVal = String(r[colIdx] || '').trim();
    if (!rawVal) {
      hasEmptyCell = true;
    } else {
      uniqueSet.add(rawVal);
    }
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }));
  if (hasEmptyCell) {
    unique.unshift('(blank)');
  }

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`compChannelsMsText_${key}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="compChannelsChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCompChannelsDropdown('${key}', this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">` +
    unique.map(val => {
      let displayLabel = escapeHtmlText(val);
      if (val === '(blank)') displayLabel = '<span class="text-muted font-medium">(blank)</span>';
      const safeAttrVal = escapeHtmlAttr(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" value="${safeAttrVal}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCompChannelsDropdownItem('${key}', '${safeAttrVal}', this.checked)">
          <span>${displayLabel}</span>
        </label>`;
    }).join('');
}

function toggleCompChannelsDropdown(key) {
  const dd = document.getElementById(`compChannelsMsDropdown_${key}`);
  const btn = document.getElementById(`compChannelsMsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateSingleCompChannelsDropdown(key);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 240))}px`;
    dd.classList.add('show');
  }
}

function selectAllCompChannelsDropdown(key, chk) {
  if (!compChannelsMultiFilters[key]) compChannelsMultiFilters[key] = new Set();
  compChannelsMultiFilters[key].clear();
  document.querySelectorAll(`#compChannelsMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });
  const msText = document.getElementById(`compChannelsMsText_${key}`);
  if (msText) msText.textContent = 'All';
  filterCompChannelsRows();
}

function toggleCompChannelsDropdownItem(key, val, checked) {
  if (!compChannelsMultiFilters[key]) compChannelsMultiFilters[key] = new Set();
  checked ? compChannelsMultiFilters[key].add(val) : compChannelsMultiFilters[key].delete(val);
  const cnt = compChannelsMultiFilters[key].size;
  const chkAll = document.getElementById(`compChannelsChkAll_${key}`);
  if (chkAll) chkAll.checked = !cnt;
  const msText = document.getElementById(`compChannelsMsText_${key}`);
  if (msText) msText.textContent = !cnt ? 'All' : `${cnt} selected`;
  filterCompChannelsRows();
}

function filterCompChannelsRows() {
  const tbody = document.getElementById('compChannelsTableDataBody');
  const badge = document.getElementById('compChannelsBadge');
  if (!tbody) return;

  const f = compChannelsFilters;
  const filtered = compChannelsRows.filter(r => {
    const region = String(r[0] || '').trim();
    const sourceEndpoint = String(r[1] || '').trim();
    const verified = String(r[3] || '').trim();
    const status = String(r[4] || '').trim();

    // Region 멀티 필터 검증
    if (compChannelsMultiFilters.region?.size > 0) {
      if (!region) {
        if (!compChannelsMultiFilters.region.has('(blank)')) return false;
      } else {
        if (!compChannelsMultiFilters.region.has(region)) return false;
      }
    }

    // Status 멀티 필터 검증
    if (compChannelsMultiFilters.status?.size > 0) {
      if (!status) {
        if (!compChannelsMultiFilters.status.has('(blank)')) return false;
      } else {
        if (!compChannelsMultiFilters.status.has(status)) return false;
      }
    }

    // 텍스트 필터 검증
    if (f.source && !sourceEndpoint.toLowerCase().includes(f.source.toLowerCase())) return false;
    if (f.verified && !verified.toLowerCase().includes(f.verified.toLowerCase())) return false;
    return true;
  });

  if (badge) badge.textContent = `${filtered.length} of ${compChannelsRows.length} channels`;

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state-row text-sm">No matching channels found.</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map((r, idx) => {
    const no = idx + 1;
    const region = String(r[0] || '-').trim();
    const sourceEndpoint = String(r[1] || '-').trim();
    const sourceUrl = String(r[2] || '').trim();
    const lastVerified = String(r[3] || '-').trim();
    const status = String(r[4] || '-').trim();

    const isLink = /^https?:\/\//i.test(sourceUrl);
    const sourceHtml = isLink
      ? `<a href="${escapeHtmlAttr(sourceUrl)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration:none;">${escapeHtmlText(sourceEndpoint)}</a>`
      : escapeHtmlText(sourceEndpoint);

    // Active는 기본 색상(#475569), 나머지(Inactive, Error 등)는 빨간색(#dc2626) 배지
    const isActive = status.toLowerCase() === 'active';
    const statusBadge = isActive
      ? `<span class="text-xs font-normal text-muted" style="display:inline-block; padding:2px 8px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:4px;">Active</span>`
      : `<span class="text-xs font-normal text-danger" style="display:inline-block; padding:2px 8px; background:#fef2f2; border:1px solid #fecaca; border-radius:4px;">${escapeHtmlText(status || '-')}</span>`;

    return `
      <tr style="height:36px;">
        <td class="data-cell text-center text-muted text-sm font-normal" style="white-space:nowrap;">${no}</td>
        <td class="data-cell text-center text-sm text-body font-normal" style="padding:4px 6px; white-space:nowrap;">${escapeHtmlText(region)}</td>
        <td class="data-cell text-sm font-normal cell-ellipsis" style="padding:4px 10px;" title="${escapeHtmlAttr(sourceEndpoint)}">${sourceHtml}</td>
        <td class="data-cell text-center font-mono text-sm text-muted font-normal" style="padding:4px 6px; white-space:nowrap;">${escapeHtmlText(lastVerified)}</td>
        <td class="data-cell text-center" style="padding:4px 6px; white-space:nowrap;">${statusBadge}</td>
      </tr>
    `;
  }).join('');
}

function onCompChannelsFilterChange(colKey, val) {
  compChannelsFilters[colKey] = val.trim();
  filterCompChannelsRows();
}

function resetCompChannelsFilters() {
  compChannelsFilters = {};
  compChannelsMultiFilters = { region: new Set(), status: new Set() };
  const srcIn = document.getElementById('filterChannels_source');
  const verIn = document.getElementById('filterChannels_verified');
  if (srcIn) srcIn.value = '';
  if (verIn) verIn.value = '';

  ['region', 'status'].forEach(key => {
    const textEl = document.getElementById(`compChannelsMsText_${key}`);
    if (textEl) textEl.textContent = 'All';
    const chkAll = document.getElementById(`compChannelsChkAll_${key}`);
    if (chkAll) chkAll.checked = true;
    document.querySelectorAll(`#compChannelsMsDropdown_${key} input[type="checkbox"]`).forEach(c => {
      if (c !== chkAll) c.checked = false;
    });
  });

  filterCompChannelsRows();
}

// 8. Save Data (Monitoring Log)
async function saveComplianceData() {
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) {
    return alert("Unauthorized: Administrator permission required.");
  }
  const btn = document.getElementById('btnSaveAllTop');
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey || !btn) return;

  btn.textContent = '⏳ Saving...'; 
  btn.disabled = true;

  try {
    const resp = await fetch(URL_COMPLIANCE, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'save_all_rows', items: compDataset })
    });
    const res = await resp.json();

    if (res.status === 'success') {
      btn.textContent = '✓ Saved!';
      compUnsavedChanges.clear();
      if (res.lastUpdated) {
        const b = document.getElementById('compLastModifiedBadge');
        if (b) b.textContent = `Last Modified: ${res.lastUpdated} KST(UTC+9)`;
      }
      await saveCompToDB(
        compRawHeaders, 
        compDataset, 
        res.lastUpdated || '', 
        compTimelineRawData, 
        { headers: compMonitoringFeedHeaders, data: compMonitoringFeedRows, errors: compMonitoringFeedErrors },
        { headers: compChannelsHeaders, data: compChannelsRows }
      );
      filterCompRows();
    } else {
      alert(res.message || 'Save failed.');
    }
  } catch(e) {
    alert('Network error while saving data.');
  } finally {
    setTimeout(() => { 
      btn.disabled = false; 
      updateSaveButtonState(); 
    }, 1200);
  }
}

// 9. Modals (Link & Notes)
function openLinkModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;
  const nameInput = document.getElementById('modalLinkName');
  const urlInput = document.getElementById('modalLinkUrl');
  if (nameInput) nameInput.value = item.linkName || '';
  if (urlInput) urlInput.value = item.linkUrl || '';
  document.getElementById('linkModal')?.style.setProperty('display', 'flex');
}

const closeLinkModal = () => document.getElementById('linkModal')?.style.setProperty('display', 'none');

function saveLinkModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    const nameInput = document.getElementById('modalLinkName');
    const urlInput = document.getElementById('modalLinkUrl');
    if (nameInput) item.linkName = nameInput.value.trim();
    if (urlInput) item.linkUrl = urlInput.value.trim();
    compUnsavedChanges.add(item.id);
    closeLinkModal();
    filterCompRows();
    updateSaveButtonState();
  }
}

function openNotesModal(id) {
  compEditingItemId = id;
  const item = compDataset.find(d => d.id === id);
  if (!item) return;

  let modal = document.getElementById('compNotesExpandModal');
  if (!modal) {
    document.body.insertAdjacentHTML('beforeend', `
      <div id="compNotesExpandModal" class="modal-overlay" style="display:flex;">
        <div class="modal-card" style="max-width:640px; width:100%;">
          <div class="modal-header-row mb-3">
            <h3 id="compNotesModalTitle" class="modal-title-text">Additional Notes</h3>
            <button type="button" class="drawer-close" onclick="closeNotesModal()">&times;</button>
          </div>
          <textarea id="compNotesModalTextarea" style="width:100%; height:220px; padding:10px; border:1px solid var(--border-darker); border-radius:6px; font-size:0.85rem; font-family:inherit; line-height:1.5; resize:vertical; box-sizing:border-box;"></textarea>
          <div class="modal-footer-row mt-3">
            <button type="button" class="btn-act" onclick="closeNotesModal()">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="saveNotesModal()">Apply</button>
          </div>
        </div>
      </div>`);
    modal = document.getElementById('compNotesExpandModal');
  } else {
    modal.style.display = 'flex';
  }

  document.getElementById('compNotesModalTitle').textContent = `Notes - ${item.source || 'Item'} (${item.linkName || 'No Link'})`;
  document.getElementById('compNotesModalTextarea').value = item.details || '';
}

const closeNotesModal = () => document.getElementById('compNotesExpandModal')?.style.setProperty('display', 'none');

function saveNotesModal() {
  const item = compDataset.find(d => d.id === compEditingItemId);
  if (item) {
    item.details = (document.getElementById('compNotesModalTextarea')?.value || '').trim();
    compUnsavedChanges.add(item.id);
    closeNotesModal();
    filterCompRows();
    updateSaveButtonState();
  }
}

// 드롭다운 외부 클릭 시 자동 닫기 처리
document.addEventListener('click', e => {
  if (!e.target.closest('.multiselect-container')) {
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
  }
});

// Global Window Exports
window.initComplianceModule = initComplianceModule;
window.fetchComplianceData = fetchComplianceData;
window.clearCompIndexedDB = clearCompIndexedDB;
window.toggleCompSummarySection = toggleCompSummarySection;
window.switchCompSubTab = switchCompSubTab;
window.toggleCompDropdown = toggleCompDropdown;
window.selectAllCompDropdown = selectAllCompDropdown;
window.toggleCompDropdownItem = toggleCompDropdownItem;
window.onCompFilterChange = onCompFilterChange;
window.resetComplianceFilters = resetComplianceFilters;
window.saveComplianceData = saveComplianceData;
window.goToCompPage = goToCompPage;
window.changeCompPageSize = changeCompPageSize;
window.openLinkModal = openLinkModal;
window.closeLinkModal = closeLinkModal;
window.saveLinkModal = saveLinkModal;
window.openNotesModal = openNotesModal;
window.closeNotesModal = closeNotesModal;
window.saveNotesModal = saveNotesModal;

// Automated Feed Window Exports
window.renderCompMonitoringFeedTable = renderCompMonitoringFeedTable;
window.filterCompFeedRows = filterCompFeedRows;
window.renderCompMonitoringFeedErrors = renderCompMonitoringFeedErrors;
window.onCompFeedFilterChange = onCompFeedFilterChange;
window.resetCompFeedFilters = resetCompFeedFilters;
window.toggleCompFeedDropdown = toggleCompFeedDropdown;
window.selectAllCompFeedDropdown = selectAllCompFeedDropdown;
window.toggleCompFeedDropdownItem = toggleCompFeedDropdownItem;

// Channels Window Exports
window.renderCompChannelsTable = renderCompChannelsTable;
window.filterCompChannelsRows = filterCompChannelsRows;
window.onCompChannelsFilterChange = onCompChannelsFilterChange;
window.resetCompChannelsFilters = resetCompChannelsFilters;
window.toggleCompChannelsDropdown = toggleCompChannelsDropdown;
window.selectAllCompChannelsDropdown = selectAllCompChannelsDropdown;
window.toggleCompChannelsDropdownItem = toggleCompChannelsDropdownItem;