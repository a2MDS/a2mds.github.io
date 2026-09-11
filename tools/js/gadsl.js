/* =========================================================================
   GADSL ANALYZER MODULE (Gemini 3.6 Flash Dynamic Sync Engine)
   ========================================================================= */
const URL_GADSL = 'https://script.google.com/macros/s/AKfycbxAHLs-YzCpug1hLI-oTaH41E4YRA9gPixpw2483eLrSKIq3qCi6hh5kqX2LFx9pFHhpQ/exec';
const GADSL_DB_NAME = 'a2MDS_GadslLog_DB';

let gadslCasData = [];           
let gadslRawEntriesCount = 0;   
let gadslRevisionSummary = [];  
let gadslRevisionDetails = [];  
let gadslDocVersionStr = '';    
let gadslLatestRevDate = '';    
let gadslAnalyzedDateStr = '';  

let gadslFilteredCas = [];
let gadslFilteredRev = [];
let gadslActiveClusterIndex = null;
let gadslRevTableFilters = Array(9).fill('');

let gadslCasCurrentPage = 1, gadslCasPageSize = 100;
let gadslRevCurrentPage = 1, gadslRevPageSize = 100;
let gadslCasFilterDebounceTimer = null, gadslRevFilterDebounceTimer = null;

window.gadslCasData = gadslCasData;
window.initGadslModule = initGadslModule;
window.clearGadslIndexedDB = clearGadslIndexedDB;
window.filterRevByClusterIndex = filterRevByClusterIndex;
window.clearGadslClusterFilter = clearGadslClusterFilter;

// Smelter/Substance와 동일한 원클릭 복사 핸들러
async function copyGadslCasToClipboard(cas, el, ev) {
  if (ev) ev.stopPropagation();
  if (!cas || cas === '-' || cas === 'Various') return;

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

function openGadslDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(GADSL_DB_NAME, 10);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('gadsl_data')) db.deleteObjectStore('gadsl_data');
        db.createObjectStore('gadsl_data', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch (e) { res(null); }
  });
}

async function saveGadslToDB(payload) {
  try {
    const db = await openGadslDB();
    if (!db) return;
    const tx = db.transaction('gadsl_data', 'readwrite');
    tx.objectStore('gadsl_data').clear();
    tx.objectStore('gadsl_data').put({ id: 'latest_state', ...payload });
  } catch (e) {}
}

async function loadGadslFromDB() {
  try {
    const db = await openGadslDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('gadsl_data', 'readonly').objectStore('gadsl_data').get('latest_state');
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch (e) { return null; }
}

async function clearGadslIndexedDB() {
  try {
    const db = await openGadslDB();
    if (db) db.transaction('gadsl_data', 'readwrite').objectStore('gadsl_data').clear();
  } catch (e) {}
}

async function initGadslModule() {
  const cached = await loadGadslFromDB();
  if (cached && cached.casData?.length) {
    gadslCasData = cached.casData;
    window.gadslCasData = gadslCasData;
    gadslRawEntriesCount = cached.rawEntriesCount || cached.casData.length;
    gadslRevisionSummary = cached.revisionSummary || [];
    gadslRevisionDetails = cached.revisionDetails || [];
    gadslDocVersionStr = cached.docVersionStr || '';
    gadslLatestRevDate = cached.latestRevDate || '';
    gadslAnalyzedDateStr = cached.analyzedDateStr || '';
    renderGadslAllViews();
  } else {
    const key = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    if (key) fetchGadslData(key);
  }
}

function getKstTimestampWithSeconds() {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  });
  const parts = dtf.formatToParts(now);
  const findPart = t => parts.find(p => p.type === t)?.value || '00';
  return `${findPart('year')}-${findPart('month')}-${findPart('day')} ${findPart('hour')}:${findPart('minute')}:${findPart('second')}`;
}

async function fetchGadslData(authOverride = '', forceReload = false) {
  const key = authOverride || (typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '');
  if (!key) return;

  try {
    const resp = await fetch(URL_GADSL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: key, action: 'fetch_data', clientLastUpdated: forceReload ? '' : gadslAnalyzedDateStr })
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      renderGadslAllViews();
      return res;
    }

    if (res?.status === 'success' && res.data && res.data.casData?.length) {
      const d = res.data;
      gadslCasData = d.casData || [];
      window.gadslCasData = gadslCasData;
      gadslRawEntriesCount = d.rawEntriesCount || d.casData.length;
      gadslRevisionSummary = d.revisionSummary || [];
      gadslRevisionDetails = (d.revisionDetails || []).map(r => ({
        ...r,
        firstAdded: normalizeDateStr(r.firstAdded),
        lastRevised: normalizeDateStr(r.lastRevised)
      }));
      gadslDocVersionStr = d.docVersionStr || '2026 Version 2.0';
      gadslLatestRevDate = normalizeDateStr(d.latestRevDate) || '1-Sep-2026';
      gadslAnalyzedDateStr = res.lastUpdated || d.analyzedDateStr || getKstTimestampWithSeconds();

      await saveGadslToDB({
        ...d,
        revisionSummary: gadslRevisionSummary,
        revisionDetails: gadslRevisionDetails,
        latestRevDate: gadslLatestRevDate,
        analyzedDateStr: gadslAnalyzedDateStr
      });
      renderGadslAllViews();
    }
    return res;
  } catch (e) {
    console.warn("fetchGadslData error:", e);
  }
}

function normalizeDateStr(v) {
  if (!v) return '';
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  if (v instanceof Date) {
    const safeDate = new Date(v.getTime() + 12 * 3600 * 1000);
    return `${safeDate.getUTCDate()}-${months[safeDate.getUTCMonth()]}-${safeDate.getUTCFullYear()}`;
  }
  const s = String(v).trim();
  if (!s || s === '-' || s === 'null') return '';

  const mStd = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{4})$/);
  if (mStd) return `${parseInt(mStd[1], 10)}-${mStd[2].charAt(0).toUpperCase() + mStd[2].slice(1).toLowerCase()}-${mStd[3]}`;

  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${parseInt(mIso[3], 10)}-${months[parseInt(mIso[2], 10) - 1]}-${parseInt(mIso[1], 10)}`;

  const pDate = new Date(s);
  if (!isNaN(pDate.getTime())) {
    const safeDate = new Date(pDate.getTime() + 12 * 3600 * 1000);
    return `${safeDate.getUTCDate()}-${months[safeDate.getUTCMonth()]}-${safeDate.getUTCFullYear()}`;
  }
  return s;
}

function parseDateToTime(str) {
  if (!str) return 0;
  const m = str.match(/(\d{1,2})[-\s]([A-Za-z]{3})[-\s](\d{4})/);
  if (m) {
    const months = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, oct:9, nov:10, dec:11 };
    const month = months[m[2].toLowerCase()];
    if (month !== undefined) return Date.UTC(parseInt(m[3], 10), month, parseInt(m[1], 10));
  }
  const d = new Date(str);
  return !isNaN(d.getTime()) ? d.getTime() : 0;
}

// ⭐️ CAS 번호 무결성 추출 헬퍼 (셀 원본 텍스트 우선 판별)
function extractCleanCasText(rawVal, cellObj) {
  if (cellObj) {
    if (typeof cellObj.w === 'string' && cellObj.w.trim()) {
      const cleanW = cellObj.w.trim();
      if (!/gmt|utc|[a-z]{4,}/i.test(cleanW)) return cleanW;
    }
    if (typeof cellObj.v === 'string' && cellObj.v.trim()) {
      const cleanV = cellObj.v.trim();
      if (!/gmt|utc|[a-z]{4,}/i.test(cleanV)) return cleanV;
    }
  }

  if (rawVal instanceof Date) {
    const yr = rawVal.getFullYear();
    const mo = rawVal.getMonth() + 1;
    const da = rawVal.getDate();
    return `${yr}-${mo}-${da}`;
  }

  let s = String(rawVal ?? '').trim();
  if (/gmt|utc|[a-z]{3}\s+[a-z]{3}\s+\d+/i.test(s)) {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${parsed.getMonth() + 1}-${parsed.getDate()}`;
    }
  }
  return s;
}

/* =========================================================================
   EXCEL PARSING
   ========================================================================= */
function handleGadslFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const dropTitle = document.getElementById('gadslUploadTitle');
  if (dropTitle) dropTitle.textContent = `⏳ Reading ${file.name}...`;

  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: false });

      const verSheetName = workbook.SheetNames.find(n => /version|disclaimer|info/i.test(n)) || workbook.SheetNames[0];
      const verSheet = workbook.Sheets[verSheetName];
      if (verSheet) {
        const verRows = XLSX.utils.sheet_to_json(verSheet, { header: 1 });
        parseVersionInfo(verRows);
      }

      const refSheetName = workbook.SheetNames.find(n => /reference\s*list/i.test(n)) ||
                           workbook.SheetNames.find(n => /ref/i.test(n) && !/change|rev|summary/i.test(n)) ||
                           workbook.SheetNames[0];
      const refSheet = workbook.Sheets[refSheetName];
      if (!refSheet) throw new Error("Reference List sheet not found.");

      const rawRows = XLSX.utils.sheet_to_json(refSheet, { header: 1 });
      const parseResult = parseReferenceListAndRevisions(rawRows, refSheet);

      gadslCasData = parseResult.casData;
      gadslRawEntriesCount = parseResult.rawEntriesCount;
      gadslRevisionDetails = parseResult.revisionDetails;
      gadslLatestRevDate = parseResult.latestRevDate;
      gadslAnalyzedDateStr = getKstTimestampWithSeconds();
      window.gadslCasData = gadslCasData;

      const regTbody = document.getElementById('regSummaryTableBody');
      if (regTbody) {
        regTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:32px; font-weight:600; color:#0284c7;">
          🤖 Analyzing latest regulatory drivers via Gemini 3.6 Flash... (${parseResult.rawRevisionRows.length} entries)
        </td></tr>`;
      }

      renderGadslAllViews(false);

      if (dropTitle) dropTitle.textContent = `🤖 Analyzing revisions via Gemini 3.6 Flash...`;

      const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
      const resp = await fetch(URL_GADSL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          auth: authKey,
          action: 'analyze_and_save_gadsl',
          payload: {
            casData: gadslCasData,
            rawEntriesCount: gadslRawEntriesCount,
            revisionDetails: gadslRevisionDetails,
            docVersionStr: gadslDocVersionStr,
            latestRevDate: gadslLatestRevDate,
            rawRevisionRows: parseResult.rawRevisionRows
          }
        })
      });

      const resJson = await resp.json();
      if (resJson?.status === 'success' && resJson.revisionSummary) {
        gadslRevisionSummary = resJson.revisionSummary;
        await saveGadslToDB({
          casData: gadslCasData,
          rawEntriesCount: gadslRawEntriesCount,
          revisionSummary: gadslRevisionSummary,
          revisionDetails: gadslRevisionDetails,
          docVersionStr: gadslDocVersionStr,
          latestRevDate: gadslLatestRevDate,
          analyzedDateStr: gadslAnalyzedDateStr
        });
        renderGadslSummaryTab();
      }
    } catch (err) {
      alert('Failed to analyze GADSL file: ' + err.message);
    } finally {
      if (dropTitle) dropTitle.textContent = 'Upload GADSL Master Excel File';
      if (event.target) event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseVersionInfo(rows) {
  gadslDocVersionStr = '2026 Version 2.0';
  if (!rows?.length) return;

  let foundYear = '', foundVer = '';
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] || [];
    const rowStr = row.join(' ').trim();
    if (!foundYear) {
      const yMatch = rowStr.match(/\b(20[2-3]\d)\b/);
      if (yMatch) foundYear = yMatch[1];
    }
    for (let c = 0; c < row.length; c++) {
      const cellVal = String(row[c] || '').trim();
      if (/^version$/i.test(cellVal)) {
        for (let nextC = c + 1; nextC < row.length; nextC++) {
          const nextVal = String(row[nextC] || '').trim();
          const vMatch = nextVal.match(/^([\d\.]+)$/);
          if (vMatch) {
            foundVer = vMatch[1];
            break;
          }
        }
      }
    }
  }

  if (foundYear && foundVer) {
    gadslDocVersionStr = `${foundYear} Version ${foundVer}`;
    return;
  }
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowStr = (rows[r] || []).join(' ').trim();
    const m = rowStr.match(/(\d{4})\s+Version\s+([\d\.]+)/i);
    if (m) {
      gadslDocVersionStr = `${m[1]} Version ${m[2]}`;
      return;
    }
  }
  if (foundVer) gadslDocVersionStr = `${foundYear || '2026'} Version ${foundVer}`;
}

function parseReferenceListAndRevisions(rows, refSheet) {
  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(25, rows.length); r++) {
    const row = rows[r] || [];
    const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
    if (rowStr.includes('cas') && (rowStr.includes('revised') || rowStr.includes('source'))) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = rows[headerRowIdx] || [];
  const colMap = {};

  headerRow.forEach((c, idx) => {
    const t = String(c || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t.includes('ref') || t.includes('number')) colMap.ref = idx;
    else if (t.includes('substance') || t.includes('name')) colMap.substance = idx;
    else if (t.includes('cas')) colMap.cas = idx;
    else if (t.includes('class')) colMap.classification = idx;
    else if (t.includes('reason')) colMap.reason = idx;
    else if ((t.includes('source') || t.includes('legal') || t.includes('regulation')) && !t.includes('effective') && !t.includes('date')) {
      if (colMap.source === undefined) colMap.source = idx;
    }
    else if (t.includes('example') || t.includes('supporting')) colMap.example = idx;
    else if (t.includes('threshold') || t.includes('limit')) colMap.threshold = idx;
    else if (t.includes('firstadded')) colMap.firstAdded = idx;
    else if (t.includes('lastrevised')) colMap.lastRevised = idx;
  });

  if (colMap.source === undefined && headerRow.length > 6) colMap.source = 6;

  const casMap = new Map();
  const allRefRows = [];
  let rawCount = 0;
  let maxRevTime = 0, maxRevDateStr = '';
  let lastRef = '', lastSub = '', lastCls = '', lastRsn = '', lastLegal = '', lastThresh = '', lastAdd = '', lastLst = '';

  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;

    const rawRef = String(row[colMap.ref] ?? '').trim();
    const rawSub = String(row[colMap.substance] ?? '').trim();

    let cellObj = null;
    if (refSheet && colMap.cas !== undefined && XLSX?.utils?.encode_cell) {
      cellObj = refSheet[XLSX.utils.encode_cell({ r: r, c: colMap.cas })] || null;
    }
    const rawCas = extractCleanCasText(row[colMap.cas], cellObj);

    if (!rawRef && !rawSub && !rawCas) continue;

    if (rawRef && rawRef !== '-') lastRef = rawRef;
    if (rawSub && rawSub !== '-') lastSub = rawSub;
    if (colMap.classification !== undefined && row[colMap.classification]) lastCls = String(row[colMap.classification]).trim();
    if (colMap.reason !== undefined && row[colMap.reason]) lastRsn = String(row[colMap.reason]).trim();
    if (colMap.source !== undefined && row[colMap.source]) lastLegal = String(row[colMap.source]).trim();
    if (colMap.threshold !== undefined && row[colMap.threshold]) lastThresh = String(row[colMap.threshold]).trim();
    if (colMap.firstAdded !== undefined && row[colMap.firstAdded]) lastAdd = normalizeDateStr(row[colMap.firstAdded]);
    if (colMap.lastRevised !== undefined && row[colMap.lastRevised]) lastLst = normalizeDateStr(row[colMap.lastRevised]);

    const refNo = rawRef || lastRef;
    const subName = rawSub || lastSub;
    const clsVal = (colMap.classification !== undefined ? String(row[colMap.classification] ?? '').trim() : '') || lastCls || '-';
    const rsnVal = (colMap.reason !== undefined ? String(row[colMap.reason] ?? '').trim() : '') || lastRsn || 'FI';
    const legal = (colMap.source !== undefined ? String(row[colMap.source] ?? '').trim() : '') || lastLegal || '-';
    const example = (colMap.example !== undefined ? String(row[colMap.example] ?? '').trim() : '') || '';
    const thresh = (colMap.threshold !== undefined ? String(row[colMap.threshold] ?? '').trim() : '') || lastThresh || '-';
    const firstAdded = colMap.firstAdded !== undefined ? normalizeDateStr(row[colMap.firstAdded]) : (lastAdd || '-');
    const lastRevised = colMap.lastRevised !== undefined ? normalizeDateStr(row[colMap.lastRevised]) : (lastLst || '-');

    const revTime = parseDateToTime(lastRevised);
    if (revTime > maxRevTime) {
      maxRevTime = revTime;
      maxRevDateStr = lastRevised;
    }

    allRefRows.push({
      ref: refNo,
      substance: subName,
      cas: rawCas || '-',
      classification: clsVal,
      reason: rsnVal,
      source: legal,
      example: example,
      threshold: thresh,
      firstAdded,
      lastRevised,
      revTime
    });

    if (rawCas && rawCas !== '-' && rawCas.toLowerCase() !== 'various') {
      rawCount++;
      let detailStr = '';
      if (subName) detailStr += `[Substance] ${subName}\n`;
      if (refNo) detailStr += `[Ref #] ${refNo}\n`;
      if (legal && legal !== '-') detailStr += `[Source] ${legal}\n`;
      if (example) detailStr += `[Examples] ${example}\n`;
      if (thresh && thresh !== '-') detailStr += `[Threshold] ${thresh}\n`;

      detailStr = detailStr.trim();
      if (!casMap.has(rawCas)) casMap.set(rawCas, { cas: rawCas, details: [detailStr] });
      else {
        const exist = casMap.get(rawCas);
        if (!exist.details.includes(detailStr)) exist.details.push(detailStr);
      }
    }
  }

  const latestRevDate = maxRevDateStr || '1-Sep-2026';
  const revisionDetails = allRefRows.filter(r => r.lastRevised === latestRevDate || (maxRevTime > 0 && r.revTime === maxRevTime));

  const rawRevisionRows = revisionDetails.map(r => ({
    substance: r.substance,
    cas: r.cas,
    classification: r.classification,
    reason: r.reason,
    source: r.source,
    supportingInfo: r.example,
    threshold: r.threshold
  }));

  const casData = Array.from(casMap.values()).map(item => ({ cas: item.cas, details: item.details.join('\n\n---\n\n') }));

  return { casData, rawEntriesCount: rawCount, revisionDetails, rawRevisionRows, latestRevDate };
}

/* =========================================================================
   CLUSTER-BASED DRILL DOWN (식별자 1:1 매핑)
   ========================================================================= */
function filterRevByClusterIndex(clusterIdx) {
  const cluster = gadslRevisionSummary[clusterIdx];
  if (!cluster) return;

  gadslActiveClusterIndex = clusterIdx;

  const revTabBtn = document.getElementById('btnGadslTabRev');
  switchGadslTab('gadslDetailTab', revTabBtn);

  document.querySelectorAll('#revTableFilterRow .filter-input').forEach(inp => inp.value = '');
  gadslRevTableFilters = Array(9).fill('');

  const badgeWrap = document.getElementById('gadslActiveClusterFilter');
  const nameEl = document.getElementById('gadslActiveClusterName');
  const countEl = document.getElementById('gadslActiveClusterCount');
  if (badgeWrap && nameEl && countEl) {
    nameEl.textContent = cluster.title;
    countEl.textContent = `${cluster.count} substances`;
    badgeWrap.style.display = 'flex';
  }

  if (cluster.casList && cluster.casList.length > 0) {
    const targetCasSet = new Set(cluster.casList.map(c => String(c).trim().toLowerCase()));
    gadslFilteredRev = gadslRevisionDetails.filter(r => {
      const c = String(r.cas || '').trim().toLowerCase();
      return targetCasSet.has(c);
    });
  } else {
    const kw = cluster.title.toLowerCase();
    gadslFilteredRev = gadslRevisionDetails.filter(r => 
      r.source.toLowerCase().includes(kw) || r.substance.toLowerCase().includes(kw)
    );
  }

  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();
}

function clearGadslClusterFilter() {
  gadslActiveClusterIndex = null;
  const badgeWrap = document.getElementById('gadslActiveClusterFilter');
  if (badgeWrap) badgeWrap.style.display = 'none';

  gadslFilteredRev = [...gadslRevisionDetails];
  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();
}

/* =========================================================================
   VIEW RENDERING
   ========================================================================= */
function renderGadslAllViews(renderSummary = true) {
  const container = document.getElementById('gadslTabsContainer');
  if (container) container.style.display = 'block';

  const dropZone = document.getElementById('gadslDropZone');
  if (dropZone) dropZone.style.display = 'flex';

  const casBadge = document.getElementById('casBadge');
  if (casBadge) casBadge.textContent = gadslCasData.length.toLocaleString();

  const revBadge = document.getElementById('revBadge');
  if (revBadge) revBadge.textContent = gadslRevisionDetails.length.toLocaleString();

  const countText = document.getElementById('casBannerCountText');
  const rawText = document.getElementById('casBannerRawText');
  if (countText) countText.textContent = gadslCasData.length.toLocaleString();
  if (rawText) rawText.textContent = gadslRawEntriesCount.toLocaleString();

  const revBannerText = document.getElementById('casBannerRevText');
  if (revBannerText) revBannerText.textContent = gadslRevisionDetails.length.toLocaleString();

  const metaVerEl = document.getElementById('gadslMetaVersion');
  if (metaVerEl) metaVerEl.textContent = gadslDocVersionStr || '2026 Version 2.0';

  const metaDateEl = document.getElementById('gadslMetaDate');
  if (metaDateEl) {
    let finalTime = gadslAnalyzedDateStr || getKstTimestampWithSeconds();
    metaDateEl.textContent = `${finalTime} KST`;
  }

  if (renderSummary) renderGadslSummaryTab();

  gadslFilteredRev = [...gadslRevisionDetails];
  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();

  gadslFilteredCas = [...gadslCasData];
  gadslCasCurrentPage = 1;
  renderGadslCasPage();
}

function renderGadslSummaryTab() {
  const regTbody = document.getElementById('regSummaryTableBody');
  if (!regTbody) return;

  if (!gadslRevisionSummary.length) {
    regTbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:24px; color:#94a3b8;">No regulatory analysis summary available.</td></tr>`;
    return;
  }

  regTbody.innerHTML = gadslRevisionSummary.map((r, idx) => {
    const bulletsList = (r.bullets && r.bullets.length) ? r.bullets : [r.desc || 'Regulatory requirements updated.'];
    const bulletsHtml = `<ul class="gadsl-table-bullets">${bulletsList.map(b => `<li>${b}</li>`).join('')}</ul>`;

    return `
      <tr>
        <td style="vertical-align:top; padding:12px 8px;">
          <div style="font-weight:700; color:var(--text-main); font-size:0.86rem; line-height:1.4;">${r.title}</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;">Source: ${r.source}</div>
        </td>
        <td style="text-align:center; vertical-align:top; padding:12px 8px;">
          <button type="button" onclick="filterRevByClusterIndex(${idx})" title="Drill-down ${r.count} substances" style="background:#f0fdf4; border:1px solid #86efac; border-radius:6px; color:#16a34a; font-weight:700; font-size:0.92rem; padding:4px 10px; cursor:pointer; transition:all 0.15s ease;" onmouseover="this.style.background='#dcfce7'" onmouseout="this.style.background='#f0fdf4'">
            ${r.count} ➔
          </button>
        </td>
        <td style="vertical-align:top; padding:12px 8px;">
          ${bulletsHtml}
        </td>
        <td style="vertical-align:top; padding:12px 8px; font-size:0.81rem; line-height:1.5;">
          <div style="margin-bottom:8px;">
            <strong style="color:var(--text-main); display:block; margin-bottom:2px;">Part Impact:</strong>
            <div style="color:var(--text-body);">${r.impact}</div>
          </div>
          <div>
            <strong style="color:var(--text-main); display:block; margin-bottom:2px;">Action Points:</strong>
            <div style="color:var(--text-body);">${r.notes}</div>
          </div>
        </td>
      </tr>`;
  }).join('');
}

function renderGadslRevisionPage() {
  const tbody = document.getElementById('revTableBody');
  if (!tbody) return;

  const totalMatches = gadslFilteredRev.length;
  const totalPages = Math.ceil(totalMatches / gadslRevPageSize) || 1;

  if (gadslRevCurrentPage > totalPages) gadslRevCurrentPage = totalPages;
  if (gadslRevCurrentPage < 1) gadslRevCurrentPage = 1;

  const start = (gadslRevCurrentPage - 1) * gadslRevPageSize;
  const end = Math.min(start + gadslRevPageSize, totalMatches);

  let html = '';
  for (let i = start; i < end; i++) {
    const r = gadslFilteredRev[i];
    html += `
      <tr>
        <td style="text-align:center; padding:6px;">${r.ref}</td>
        <td style="padding:6px;" title="${r.substance}">${r.substance}</td>
        <td style="text-align:center; padding:6px;">
          ${r.cas && r.cas !== '-' ? `<span class="clickable-cid" onclick="copyGadslCasToClipboard('${r.cas}', this, event)" title="Click to copy">${r.cas}</span>` : '-'}
        </td>
        <td style="text-align:center; padding:6px;"><span style="color:#334155; font-size:0.75rem; font-weight:600;">${r.classification}</span></td>
        <td style="text-align:center; padding:6px;">${r.reason}</td>
        <td style="padding:6px; font-size:0.80rem; line-height:1.4;" title="${r.source}">${r.source}</td>
        <td style="padding:6px;" title="${r.threshold}">${r.threshold}</td>
        <td style="text-align:center; padding:6px;">${r.firstAdded}</td>
        <td style="text-align:center; padding:6px;">${r.lastRevised}</td>
      </tr>`;
  }

  tbody.innerHTML = html || '<tr><td colspan="9" style="text-align:center; padding:20px; color:#94a3b8;">No revision history matching filters.</td></tr>';

  const pageInfo = document.getElementById('gadslRevPageInfo');
  if (pageInfo) pageInfo.textContent = `Page ${gadslRevCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()} (${totalMatches.toLocaleString()} items)`;

  const btnPrev = document.getElementById('btnGadslRevPrev');
  if (btnPrev) btnPrev.disabled = (gadslRevCurrentPage <= 1);

  const btnNext = document.getElementById('btnGadslRevNext');
  if (btnNext) btnNext.disabled = (gadslRevCurrentPage >= totalPages);
}

function goToGadslRevPage(page) { gadslRevCurrentPage = page; renderGadslRevisionPage(); }
function changeGadslRevPageSize(size) { gadslRevPageSize = parseInt(size, 10); gadslRevCurrentPage = 1; renderGadslRevisionPage(); }

function renderGadslCasPage() {
  const tbody = document.getElementById('casTableBody');
  if (!tbody) return;

  const totalMatches = gadslFilteredCas.length;
  const totalPages = Math.ceil(totalMatches / gadslCasPageSize) || 1;

  if (gadslCasCurrentPage > totalPages) gadslCasCurrentPage = totalPages;
  if (gadslCasCurrentPage < 1) gadslCasCurrentPage = 1;

  const start = (gadslCasCurrentPage - 1) * gadslCasPageSize;
  const end = Math.min(start + gadslCasPageSize, totalMatches);

  let html = '';
  for (let i = start; i < end; i++) {
    const item = gadslFilteredCas[i];
    html += `
      <tr>
        <td style="text-align:center; vertical-align:top; padding:8px 6px;">
          ${item.cas && item.cas !== '-' ? `<span class="clickable-cid" onclick="copyGadslCasToClipboard('${item.cas}', this, event)" title="Click to copy">${item.cas}</span>` : '-'}
        </td>
        <td style="white-space:pre-wrap; line-height:1.5; padding:8px 10px;" class="gadsl-plain-text">${item.details}</td>
      </tr>`;
  }

  tbody.innerHTML = html || '<tr><td colspan="2" style="text-align:center; padding:20px; color:#94a3b8;">No matching CAS records found.</td></tr>';

  const pageInfo = document.getElementById('gadslCasPageInfo');
  if (pageInfo) pageInfo.textContent = `Page ${gadslCasCurrentPage.toLocaleString()} of ${totalPages.toLocaleString()} (${totalMatches.toLocaleString()} items)`;

  const btnPrev = document.getElementById('btnGadslCasPrev');
  if (btnPrev) btnPrev.disabled = (gadslCasCurrentPage <= 1);

  const btnNext = document.getElementById('btnGadslCasNext');
  if (btnNext) btnNext.disabled = (gadslCasCurrentPage >= totalPages);
}

function goToGadslCasPage(page) { gadslCasCurrentPage = page; renderGadslCasPage(); }
function changeGadslCasPageSize(size) { gadslCasPageSize = parseInt(size, 10); gadslCasCurrentPage = 1; renderGadslCasPage(); }

function switchGadslTab(tabId, btnElem) {
  document.querySelectorAll('.gadsl-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.gadsl-tab-pane').forEach(p => p.classList.remove('active'));
  if (btnElem) btnElem.classList.add('active');
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');
}

function onGadslCasFilterChange() {
  clearTimeout(gadslCasFilterDebounceTimer);
  gadslCasFilterDebounceTimer = setTimeout(() => {
    const casKw = (document.getElementById('filterCasInput')?.value || '').toLowerCase().trim();
    const detKw = (document.getElementById('filterCasDetailsInput')?.value || '').toLowerCase().trim();

    gadslFilteredCas = gadslCasData.filter(item => {
      const matchCas = !casKw || item.cas.toLowerCase().includes(casKw) || item.cas.replace(/-/g, '').includes(casKw);
      const matchDet = !detKw || item.details.toLowerCase().includes(detKw);
      return matchCas && matchDet;
    });

    gadslCasCurrentPage = 1;
    renderGadslCasPage();
  }, 150);
}

function onGadslRevFilterChange(colIdx, val) {
  gadslRevTableFilters[colIdx] = val.toLowerCase().trim();
  clearTimeout(gadslRevFilterDebounceTimer);
  gadslRevFilterDebounceTimer = setTimeout(() => {
    if (gadslActiveClusterIndex !== null) {
      gadslActiveClusterIndex = null;
      const badgeWrap = document.getElementById('gadslActiveClusterFilter');
      if (badgeWrap) badgeWrap.style.display = 'none';
    }

    gadslFilteredRev = gadslRevisionDetails.filter(r => {
      const rowValues = [r.ref, r.substance, r.cas, r.classification, r.reason, r.source, r.threshold, r.firstAdded, r.lastRevised];
      return gadslRevTableFilters.every((kw, idx) => {
        if (!kw) return true;
        const cellText = String(rowValues[idx] || '').toLowerCase();
        return (idx === 2) ? (cellText.includes(kw) || cellText.replace(/-/g, '').includes(kw)) : cellText.includes(kw);
      });
    });

    gadslRevCurrentPage = 1;
    renderGadslRevisionPage();
  }, 150);
}

function resetGadslAllFilters() {
  const fCas = document.getElementById('filterCasInput');
  const fDet = document.getElementById('filterCasDetailsInput');
  if (fCas) fCas.value = '';
  if (fDet) fDet.value = '';
  document.querySelectorAll('#revTableFilterRow .filter-input').forEach(inp => inp.value = '');
  gadslRevTableFilters = Array(9).fill('');

  clearGadslClusterFilter();

  gadslFilteredCas = [...gadslCasData];
  gadslCasCurrentPage = 1;
  renderGadslCasPage();
}

async function exportGadslExcel() {
  if (!gadslCasData.length && !gadslRevisionDetails.length) return;

  const workbook = new ExcelJS.Workbook();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const ws1 = workbook.addWorksheet("Revision Summary", { views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }] });

  ws1.addRow(['GADSL Version', gadslDocVersionStr || '2026 Version 2.0']);
  ws1.addRow(['Analyzed Date', (gadslAnalyzedDateStr || getKstTimestampWithSeconds()) + ' KST']);
  ws1.addRow(['Consolidated Unique CAS', gadslCasData.length]);
  ws1.addRow(['Total Raw Entries', gadslRawEntriesCount]);
  ws1.addRow(['Latest Revision Date', gadslLatestRevDate || '1-Sep-2026']);
  ws1.addRow([]);

  for (let r = 1; r <= 5; r++) {
    const row = ws1.getRow(r);
    row.getCell(1).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF475569' } };
    row.getCell(2).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF0284C7' } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
  }

  const hRow1 = ws1.getRow(7);
  hRow1.values = [
    'Regulation / Legal Source',
    'Substances',
    'Key Regulatory Drivers & Updates',
    'Part Impact & Action Points'
  ];
  hRow1.height = 28;
  hRow1.eachCell(cell => {
    cell.font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF0F172A' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
      bottom: { style: 'medium', color: { argb: 'FF94A3B8' } },
      left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
      right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
    };
  });

  ws1.getColumn(1).width = 38;
  ws1.getColumn(2).width = 14;
  ws1.getColumn(3).width = 52;
  ws1.getColumn(4).width = 60;

  gadslRevisionSummary.forEach(item => {
    const bulletsText = (item.bullets && item.bullets.length)
      ? item.bullets.map(b => `• ${b}`).join('\n')
      : '• Regulatory compliance requirements updated.';

    const impactActionText = `Part Impact:\n${item.impact || '-'}\n\nAction Points:\n${item.notes || '-'}`;

    const addedRow = ws1.addRow([
      `${item.title}\n(Source: ${item.source || item.title})`,
      item.count,
      bulletsText,
      impactActionText
    ]);

    addedRow.getCell(1).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    addedRow.getCell(2).alignment = { vertical: 'top', horizontal: 'center' };
    addedRow.getCell(3).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    addedRow.getCell(4).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

    addedRow.getCell(1).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    addedRow.getCell(2).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF16A34A' } };
    addedRow.getCell(3).font = { name: 'Inter', size: 9, color: { argb: 'FF334155' } };
    addedRow.getCell(4).font = { name: 'Inter', size: 9, color: { argb: 'FF334155' } };

    addedRow.eachCell(cell => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        right: { style: 'thin', color: { argb: 'FFF1F5F9' } }
      };
    });
  });

  const ws2 = workbook.addWorksheet("Revision Details", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws2.columns = [
    { header: 'Ref #', key: 'ref', width: 10 },
    { header: 'Substance', key: 'substance', width: 28 },
    { header: 'CAS RN', key: 'cas', width: 15 },
    { header: 'Class', key: 'classification', width: 10 },
    { header: 'Reason', key: 'reason', width: 10 },
    { header: 'Source / Regulation', key: 'source', width: 45 },
    { header: 'Reporting Threshold', key: 'threshold', width: 32 },
    { header: 'First Added', key: 'firstAdded', width: 15 },
    { header: 'Last Revised', key: 'lastRevised', width: 15 }
  ];
  gadslFilteredRev.forEach(item => ws2.addRow(item));

  const ws3 = workbook.addWorksheet("CAS Info", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws3.columns = [
    { header: 'CAS RN', key: 'cas', width: 16 },
    { header: 'Consolidated Regulatory Details', key: 'details', width: 85 }
  ];
  gadslFilteredCas.forEach(item => ws3.addRow({ cas: item.cas, details: item.details }));

  [ws2, ws3].forEach(ws => {
    const hRow = ws.getRow(1);
    hRow.height = 25;
    hRow.eachCell(cell => {
      cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    });
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `a2MDS_GADSL_Analysis_Report_${dateStr}.xlsx`);
}

document.addEventListener('DOMContentLoaded', () => {
  const dropZone = document.getElementById('gadslDropZone');
  if (!dropZone) return;

  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, e => {
      e.preventDefault();
      e.stopPropagation();
    }, false);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.style.borderColor = 'var(--primary-green)';
      dropZone.style.backgroundColor = 'var(--primary-green-subtle)';
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => {
      dropZone.style.borderColor = 'var(--border-darker)';
      dropZone.style.backgroundColor = '#ffffff';
    }, false);
  });

  dropZone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    if (dt.files?.length > 0) {
      handleGadslFile({ target: { files: dt.files } });
    }
  }, false);
});