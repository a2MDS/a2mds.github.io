/* =========================================================================
   GADSL ANALYZER MODULE (Gemini 3.6 Cloud Intelligence Sync Engine)
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
let gadslRevTableFilters = Array(9).fill('');

let gadslCasCurrentPage = 1, gadslCasPageSize = 100;
let gadslRevCurrentPage = 1, gadslRevPageSize = 100;
let gadslCasFilterDebounceTimer = null, gadslRevFilterDebounceTimer = null;

window.gadslCasData = gadslCasData;
window.initGadslModule = initGadslModule;
window.clearGadslIndexedDB = clearGadslIndexedDB;

function copyGadslCas(cas, ev) {
  if (ev) ev.stopPropagation();
  if (!cas || cas === '-') return;
  const finish = () => {
    let toast = document.getElementById('substGlobalToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'substGlobalToast';
      toast.style.cssText = 'position:fixed; bottom:24px; right:24px; background:#1e293b; color:#fff; padding:10px 18px; border-radius:8px; font-size:0.84rem; font-weight:600; z-index:10000;';
      document.body.appendChild(toast);
    }
    toast.textContent = `📋 Copied CAS: ${cas}`;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 2000);
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(cas).then(finish).catch(() => finish());
  }
}

function openGadslDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(GADSL_DB_NAME, 9);
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
      gadslDocVersionStr = d.docVersionStr || '2026 Version 1.0';
      gadslLatestRevDate = normalizeDateStr(d.latestRevDate) || '1-Mar-2026';
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

/* =========================================================================
   EXCEL PARSING VIA XLSX (Pure-Text Extraction & Gemini 3.6 Trigger)
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
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });

      // 1. Version 파싱
      const verSheetName = workbook.SheetNames.find(n => /version|disclaimer|info/i.test(n)) || workbook.SheetNames[0];
      const verSheet = workbook.Sheets[verSheetName];
      if (verSheet) {
        const verRows = XLSX.utils.sheet_to_json(verSheet, { header: 1 });
        parseVersionInfo(verRows);
      }

      // 2. Reference List 파싱
      const refSheetName = workbook.SheetNames.find(n => /reference\s*list/i.test(n)) ||
                           workbook.SheetNames.find(n => /ref/i.test(n) && !/change|rev|summary/i.test(n)) ||
                           workbook.SheetNames[0];
      const refSheet = workbook.Sheets[refSheetName];
      if (!refSheet) throw new Error("Reference List sheet not found.");

      const rawRows = XLSX.utils.sheet_to_json(refSheet, { header: 1 });
      const parseResult = parseReferenceListAndRevisions(rawRows);

      gadslCasData = parseResult.casData;
      gadslRawEntriesCount = parseResult.rawEntriesCount;
      gadslRevisionDetails = parseResult.revisionDetails;
      gadslLatestRevDate = parseResult.latestRevDate;
      gadslAnalyzedDateStr = getKstTimestampWithSeconds();
      window.gadslCasData = gadslCasData;

      // 요약 테이블 로딩 인디케이터 표출
      const regTbody = document.getElementById('regSummaryTableBody');
      if (regTbody) {
        regTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:32px; font-weight:600; color:#0284c7;">
          🤖 Analyzing latest regulatory drivers via Gemini 3.6... (${parseResult.rawRevisionRows.length} entries)
        </td></tr>`;
      }

      // 배너 및 Details, CAS 목록 우선 렌더링
      renderGadslAllViews(false);

      if (dropTitle) dropTitle.textContent = `🤖 Analyzing revisions via Gemini 3.6...`;

      // 3. 백엔드 Gemini 3.6 분석 요청 및 저장
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
  gadslDocVersionStr = '2026 Version 1.0';
  if (!rows?.length) return;

  let foundYear = '';
  let foundVer = '';

  // 1단계 (최우선): "Version" 명시적 라벨 및 주변 연도(2020~2039) 추출
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

  // 2단계 (Fallback): 1행 등 타이틀에 "2026 Version 1.0" 형태가 있는 경우
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowStr = (rows[r] || []).join(' ').trim();
    const m = rowStr.match(/(\d{4})\s+Version\s+([\d\.]+)/i);
    if (m) {
      gadslDocVersionStr = `${m[1]} Version ${m[2]}`;
      return;
    }
  }

  if (foundVer) {
    gadslDocVersionStr = `${foundYear || '2026'} Version ${foundVer}`;
  }
}

function parseReferenceListAndRevisions(rows) {
  let headerRowIdx = 0;
  for (let r = 0; r < Math.min(25, rows.length); r++) {
    const row = rows[r] || [];
    const rowStr = row.map(c => String(c).toLowerCase()).join(' ');
    if (rowStr.includes('cas') && rowStr.includes('revised')) {
      headerRowIdx = r;
      break;
    }
  }

  const headerRow = rows[headerRowIdx] || [];
  const colMap = {};
  const colNames = {};

  headerRow.forEach((c, idx) => {
    const origTitle = String(c || '').trim();
    colNames[idx] = origTitle;
    const t = origTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t.includes('ref') || t.includes('number')) colMap.ref = idx;
    else if (t.includes('substance') || t.includes('name')) colMap.substance = idx;
    else if (t.includes('cas')) colMap.cas = idx;
    else if (t.includes('class')) colMap.classification = idx;
    else if (t.includes('reason')) colMap.reason = idx;
    else if (t.includes('source') || t.includes('legal') || t.includes('regulation')) colMap.source = idx;
    else if (t.includes('example') || t.includes('supporting')) colMap.example = idx;
    else if (t.includes('threshold') || t.includes('limit')) colMap.threshold = idx;
    else if (t.includes('firstadded')) colMap.firstAdded = idx;
    else if (t.includes('lastrevised')) colMap.lastRevised = idx;
  });

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
    const rawCas = String(row[colMap.cas] ?? '').trim();

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

    // 행의 전체 열 텍스트 데이터 맵 구성
    const fullRowMap = {};
    row.forEach((cellVal, cIdx) => {
      const hTitle = colNames[cIdx] || `Col_${cIdx}`;
      const vStr = String(cellVal ?? '').trim();
      if (vStr) fullRowMap[hTitle] = vStr;
    });

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
      revTime,
      fullRowMap
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

  const latestRevDate = maxRevDateStr || '1-Mar-2026';
  const revisionDetails = allRefRows.filter(r => r.lastRevised === latestRevDate || (maxRevTime > 0 && r.revTime === maxRevTime));

// Gemini 3.6-flash 입력용: 중첩 객체 제거 및 경량 텍스트 포맷 유지
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
   VIEW RENDERING & TABLES
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
  if (metaVerEl) metaVerEl.textContent = gadslDocVersionStr || '2026 Version 1.0';

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
    regTbody.innerHTML = `<tr><td colspan="5" style="text-align:center; padding:24px; color:#94a3b8;">No regulatory analysis summary available.</td></tr>`;
    return;
  }

  regTbody.innerHTML = gadslRevisionSummary.map(r => {
    const bulletsList = (r.bullets && r.bullets.length) ? r.bullets : [r.desc || 'Regulatory requirements updated.'];
    const bulletsHtml = `<ul class="gadsl-table-bullets">${bulletsList.map(b => `<li>${b}</li>`).join('')}</ul>`;

    const rawCls = String(r.classification || '').trim();
    const hasP = /P/i.test(rawCls);
    const clsColor = hasP ? '#dc2626' : '#2563eb';

    return `
      <tr>
        <td style="vertical-align:top; padding:12px 8px;">
          <div style="font-weight:700; color:var(--text-main); font-size:0.86rem; line-height:1.4;">${r.title}</div>
          <div style="font-size:0.75rem; color:var(--text-muted); margin-top:3px;">Source: ${r.source}</div>
        </td>
        <td style="text-align:center; vertical-align:top; padding:12px 8px;">
          <span style="color:#16a34a; font-weight:700; font-size:0.88rem;">${r.count}</span>
        </td>
        <td style="text-align:center; vertical-align:top; padding:12px 8px;">
          <span style="color:${clsColor}; font-weight:700; font-size:0.82rem;">${r.classification}</span>
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
        <td style="text-align:center; font-family:monospace; min-width:140px !important; white-space:nowrap !important; padding:6px; font-weight:400;" title="${r.cas}">
          ${r.cas}
          ${r.cas && r.cas !== '-' ? `<button type="button" onclick="copyGadslCas('${r.cas}', event)" title="Copy CAS" style="margin-left:4px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; padding:1px 4px; font-size:0.65rem; color:#475569;">📋</button>` : ''}
        </td>
        <td style="text-align:center; padding:6px;"><span style="color:#334155; font-size:0.75rem; font-weight:600;">${r.classification}</span></td>
        <td style="text-align:center; padding:6px;">${r.reason}</td>
        <td style="padding:6px;" title="${r.source}">${r.source}</td>
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
        <td style="text-align:center; vertical-align:top; font-weight:400; color:var(--text-main); font-family:monospace; min-width:140px !important; width:140px !important; white-space:nowrap !important; padding:8px 6px;">
          <div style="display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>${item.cas}</span>
            ${item.cas && item.cas !== '-' ? `<button type="button" onclick="copyGadslCas('${item.cas}', event)" title="Copy CAS" style="background:#f1f5f9; border:1px solid #cbd5e1; border-radius:3px; cursor:pointer; padding:1px 4px; font-size:0.68rem; color:#475569;">📋</button>` : ''}
          </div>
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

  gadslFilteredCas = [...gadslCasData];
  gadslFilteredRev = [...gadslRevisionDetails];
  gadslCasCurrentPage = 1;
  gadslRevCurrentPage = 1;

  renderGadslCasPage();
  renderGadslRevisionPage();
}

async function exportGadslExcel() {
  if (!gadslCasData.length && !gadslRevisionDetails.length) return;

  const workbook = new ExcelJS.Workbook();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  const ws1 = workbook.addWorksheet("Revision Summary", { views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }] });

  ws1.addRow(['GADSL Version', gadslDocVersionStr || '2026 Version 1.0']);
  ws1.addRow(['Analyzed Date', (gadslAnalyzedDateStr || getKstTimestampWithSeconds()) + ' KST']);
  ws1.addRow(['Consolidated Unique CAS', gadslCasData.length]);
  ws1.addRow(['Total Raw Entries', gadslRawEntriesCount]);
  ws1.addRow(['Latest Revision Date', gadslLatestRevDate || '1-Mar-2026']);
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
    'Classification',
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

  ws1.getColumn(1).width = 36;
  ws1.getColumn(2).width = 14;
  ws1.getColumn(3).width = 16;
  ws1.getColumn(4).width = 50;
  ws1.getColumn(5).width = 60;

  gadslRevisionSummary.forEach(item => {
    const bulletsText = (item.bullets && item.bullets.length)
      ? item.bullets.map(b => `• ${b}`).join('\n')
      : '• Regulatory compliance requirements updated.';

    const impactActionText = `Part Impact:\n${item.impact || '-'}\n\nAction Points:\n${item.notes || '-'}`;

    const addedRow = ws1.addRow([
      `${item.title}\n(Source: ${item.source || item.title})`,
      item.count,
      item.classification,
      bulletsText,
      impactActionText
    ]);

    addedRow.getCell(1).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    addedRow.getCell(2).alignment = { vertical: 'top', horizontal: 'center' };
    addedRow.getCell(3).alignment = { vertical: 'top', horizontal: 'center' };
    addedRow.getCell(4).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
    addedRow.getCell(5).alignment = { vertical: 'top', horizontal: 'left', wrapText: true };

    addedRow.getCell(1).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF1E293B' } };
    addedRow.getCell(2).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF16A34A' } };

    const hasP = /P/i.test(String(item.classification || ''));
    addedRow.getCell(3).font = { name: 'Inter', size: 9, bold: true, color: { argb: hasP ? 'FFDC2626' : 'FF2563EB' } };
    addedRow.getCell(4).font = { name: 'Inter', size: 9, color: { argb: 'FF334155' } };
    addedRow.getCell(5).font = { name: 'Inter', size: 9, color: { argb: 'FF334155' } };

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
    { header: 'Source / Regulation', key: 'source', width: 34 },
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
