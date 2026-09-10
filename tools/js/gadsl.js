/* =========================================================================
   GADSL ANALYZER MODULE (IndexedDB-First Policy & Drag/Drop Card Architecture)
   ========================================================================= */
const URL_GADSL = 'https://script.google.com/macros/s/AKfycbxAHLs-YzCpug1hLI-oTaH41E4YRA9gPixpw2483eLrSKIq3qCi6hh5kqX2LFx9pFHhpQ/exec';
const GADSL_DB_NAME = 'a2MDS_GadslLog_DB';

let gadslCasData = [];           // Consolidated CAS List
let gadslRawEntriesCount = 0;   // Raw parsed entries count
let gadslRevisionSummary = [];  // Regulatory Drivers & Changes
let gadslRevisionDetails = [];  // Detailed Revision History
let gadslDocVersionStr = '';    // Document Version (e.g. 2026 Version 1.0)
let gadslLatestRevDate = '';    // Max Last Revised Date (e.g. 1-Mar-2026)
let gadslAnalyzedDateStr = '';  // Analysis Executed Date (KST Timestamp with seconds)

let gadslFilteredCas = [];
let gadslFilteredRev = [];
let gadslRevTableFilters = Array(9).fill('');

// 페이지네이션 상태 변수
let gadslCasCurrentPage = 1, gadslCasPageSize = 100;
let gadslRevCurrentPage = 1, gadslRevPageSize = 100;
let gadslCasFilterDebounceTimer = null, gadslRevFilterDebounceTimer = null;

// 전역 바인딩
window.gadslCasData = gadslCasData;
window.initGadslModule = initGadslModule;
window.clearGadslIndexedDB = clearGadslIndexedDB;

// 규제 드라이버 영문 마스터 사전
const GADSL_DRIVER_EN_DEFINITIONS = [
  {
    id: 'battery',
    title: 'California Battery Labeling Requirements',
    matchRegex: /battery|california|labeling/i,
    bullets: ['Mandatory declarable (D) reporting for intentionally added substances in battery cells and components.'],
    impact: 'Mandatory IMDS declaration across EV battery cells/packs and electronic components',
    source: 'California Battery Labeling',
    notes: 'Mandatory declaration (Threshold 0% / Intentionally added) for battery applications'
  },
  {
    id: 'pops',
    title: 'Stockholm Indicative List & POPs Regulation',
    matchRegex: /pop|stockholm|pfca/i,
    bullets: ['Expanded prohibitions (P) and tighter restrictions on Persistent Organic Pollutants (e.g., C9–C21 PFCAs).'],
    impact: 'PFAS screening across fluoropolymers/rubbers (PTFE, FKM), coatings, and sealing components',
    source: 'Stockholm Convention / EU POPs',
    notes: 'Prohibition of POPs substances & compliance with C9–C21 PFCAs long-chain PFAS restrictions'
  },
  {
    id: 'reach',
    title: 'EU REACH SVHC & MCCP Restrictions',
    matchRegex: /reach|svhc|mccp|1907\/2006|annex/i,
    bullets: ['Updated REACH SVHC candidate list and specified restrictions on Medium-Chain Chlorinated Paraffins (MCCPs).'],
    impact: 'Verification of SVHCs and MCCP alternatives in cable jacketing, rubber hoses, and flame-retardant polymers',
    source: 'EU REACH (SVHC & Annex XVII)',
    notes: 'SVHC declaration above 0.1% w/w threshold & compliance with Annex XVII restrictions'
  },
  {
    id: 'kbpr',
    title: 'K-BPR (Chemicals & Biocides Safety Act)',
    matchRegex: /k-bpr|biocide|살생물|화학제품안전/i,
    bullets: ['Detailed classification (D/P) aligned with approved biocidal substances and permitted product-types (PT).'],
    impact: 'Confirmation of approval status for antibacterial interior trims, HVAC filters, and antiseptic-treated parts',
    source: 'K-BPR (Consumer Chemical Products & Biocides)',
    notes: 'Verification of approved biocidal active substances & restriction on unapproved treated articles'
  },
  {
    id: 'pfas',
    title: 'US State PFAS Bans (e.g., Minnesota HF2310)',
    matchRegex: /minnesota|tsca|pfas|hf2310|state/i,
    bullets: ['Implementation of state-level PFAS prohibitions and mandatory reporting obligations.'],
    impact: 'Preemptive PFAS screening across all automotive parts exported to North America',
    source: 'US State Regulations (PFAS/TSCA)',
    notes: 'Reporting for Minnesota/Maine state PFAS regulations & compliance with TSCA PBT bans'
  }
];

// CAS 복사 헬퍼
function copyGadslCas(cas, ev) {
  if (ev) ev.stopPropagation();
  if (!cas || cas === '-') return;
  const finish = () => {
    if (typeof showSubstToast === 'function') showSubstToast(`📋 Copied CAS: ${cas}`);
    else {
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
    }
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(cas).then(finish).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = cas;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      finish();
    });
  }
}

/* =========================================================================
   INDEXED DB 캐시 로직
   ========================================================================= */
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

/* =========================================================================
   CLOUD SYNC
   ========================================================================= */
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
      gadslRevisionDetails = (d.revisionDetails || []).map(r => ({
        ...r,
        firstAdded: normalizeDateStr(r.firstAdded),
        lastRevised: normalizeDateStr(r.lastRevised)
      }));
      gadslDocVersionStr = d.docVersionStr || '2026 Version 1.0';
      gadslLatestRevDate = normalizeDateStr(d.latestRevDate) || '1-Mar-2026';
      gadslAnalyzedDateStr = res.lastUpdated || d.analyzedDateStr || getKstTimestampWithSeconds();

      buildRevisionIntelligenceSummary();

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

async function saveGadslToCloud(dataPayload) {
  const authKey = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
  if (!authKey) return;
  try {
    await fetch(URL_GADSL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'save_data', payload: dataPayload })
    });
  } catch (e) {}
}

/* =========================================================================
   EXCEL PARSING & NORMALIZATION
   ========================================================================= */
async function handleGadslFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  const dropTitle = document.getElementById('gadslUploadTitle');
  if (dropTitle) dropTitle.textContent = `⏳ Parsing ${file.name}...`;

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
    const sheetNames = workbook.SheetNames;

    const verSheetName = sheetNames.find(n => /version|disclaimer|info/i.test(n)) || sheetNames[0];
    const verJson = XLSX.utils.sheet_to_json(workbook.Sheets[verSheetName], { header: 1, defval: '' });
    parseVersionInfo(verJson);

    const refSheetName = sheetNames.find(n => /reference\s*list/i.test(n)) || sheetNames.find(n => /ref/i.test(n) && !/change|rev|summary/i.test(n)) || sheetNames[0];
    const refJson = XLSX.utils.sheet_to_json(workbook.Sheets[refSheetName], { header: 1, defval: '' });
    parseReferenceListAndRevisions(refJson);

    gadslAnalyzedDateStr = getKstTimestampWithSeconds();

    const dataPayload = {
      casData: gadslCasData,
      rawEntriesCount: gadslRawEntriesCount,
      revisionSummary: gadslRevisionSummary,
      revisionDetails: gadslRevisionDetails,
      docVersionStr: gadslDocVersionStr,
      latestRevDate: gadslLatestRevDate,
      analyzedDateStr: gadslAnalyzedDateStr
    };

    window.gadslCasData = gadslCasData;
    await saveGadslToDB(dataPayload);
    saveGadslToCloud(dataPayload);
    renderGadslAllViews();
  } catch (err) {
    alert('Failed to parse GADSL Excel file. Please ensure it is a valid official format.');
  } finally {
    if (dropTitle) dropTitle.textContent = 'Upload GADSL Master Excel File';
    if (event.target) event.target.value = '';
  }
}

function parseVersionInfo(rows) {
  gadslDocVersionStr = '2026 Version 1.0';
  if (!rows?.length) return;

  let foundYear = '';
  let foundVer = '';

  // 1단계 (최우선): 2행의 "Version" 명시적 라벨 및 주변 연도(2020~2039) 셀 직접 추출
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const row = rows[r] || [];
    const rowStr = row.join(' ').trim();

    // 연도 4자리 탐색 (2020~2039)
    if (!foundYear) {
      const yMatch = rowStr.match(/\b(20[2-3]\d)\b/);
      if (yMatch) foundYear = yMatch[1];
    }

    // "Version" 라벨 옆의 버전 숫자 탐색 (예: 2.0)
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

  // 1단계에서 연도와 버전이 모두 정상 확인된 경우 즉시 확정
  if (foundYear && foundVer) {
    gadslDocVersionStr = `${foundYear} Version ${foundVer}`;
    return;
  }

  // 2단계 (Fallback): 1단계 실패 시, 1행 등 타이틀에 "2026 Version 1.0" 형태로 합쳐진 문자열 탐색
  for (let r = 0; r < Math.min(10, rows.length); r++) {
    const rowStr = (rows[r] || []).join(' ').trim();
    const m = rowStr.match(/(\d{4})\s+Version\s+([\d\.]+)/i);
    if (m) {
      gadslDocVersionStr = `${m[1]} Version ${m[2]}`;
      return;
    }
  }

  // 버전 숫자만 확보된 경우 기본 연도 결합
  if (foundVer) {
    gadslDocVersionStr = `${foundYear || '2026'} Version ${foundVer}`;
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

function parseReferenceListAndRevisions(rows) {
  if (!rows || rows.length < 2) return;

  let hIdx = 0;
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const rLower = rows[r].map(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, ''));
    if (rLower.some(c => c.includes('cas')) && rLower.some(c => c.includes('revised'))) {
      hIdx = r;
      break;
    }
  }

  const headers = rows[hIdx].map(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, ''));
  const getIdx = (keys) => headers.findIndex(h => keys.some(k => h.includes(k)));

  const refNumIdx = getIdx(['ref', 'number', 'no']);
  const subNameIdx = getIdx(['substance', 'name']);
  const casIdx = getIdx(['cas', 'casrn', 'casno']);
  const clsIdx = getIdx(['class', 'classification']);
  const rsnIdx = getIdx(['reason']);
  const legalIdx = getIdx(['source', 'legal', 'regulation']);
  const exampleIdx = getIdx(['example', 'application', 'use', 'supporting']);
  const threshIdx = getIdx(['threshold', 'reporting', 'limit']);
  const addIdx = getIdx(['firstadded', 'added']);
  const lstIdx = getIdx(['lastrevised', 'revised']);

  const casMap = new Map();
  const allRefRows = [];
  let rawCount = 0, maxRevTime = 0, maxRevDateStr = '';
  let lastRef = '', lastSub = '', lastCls = '', lastRsn = '', lastLegal = '', lastThresh = '', lastAdd = '', lastLst = '';

  for (let i = hIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const rawRef = String(row[refNumIdx] || '').trim();
    const rawSub = String(row[subNameIdx] || '').trim();
    const rawCas = String(row[casIdx] || '').trim();

    if (!rawRef && !rawSub && !rawCas) continue;

    if (rawRef && rawRef !== '-') lastRef = rawRef;
    if (rawSub && rawSub !== '-') lastSub = rawSub;
    if (String(row[clsIdx] || '').trim()) lastCls = String(row[clsIdx] || '').trim();
    if (String(row[rsnIdx] || '').trim()) lastRsn = String(row[rsnIdx] || '').trim();
    if (String(row[legalIdx] || '').trim()) lastLegal = String(row[legalIdx] || '').trim();
    if (String(row[threshIdx] || '').trim()) lastThresh = String(row[threshIdx] || '').trim();
    if (row[addIdx]) lastAdd = normalizeDateStr(row[addIdx]);
    if (row[lstIdx]) lastLst = normalizeDateStr(row[lstIdx]);

    const refNo = rawRef || lastRef;
    const subName = rawSub || lastSub;
    const clsVal = String(row[clsIdx] || '').trim() || lastCls || '-';
    const rsnVal = String(row[rsnIdx] || '').trim() || lastRsn || 'FI';
    const legal = String(row[legalIdx] || '').trim() || lastLegal || '-';
    const example = String(row[exampleIdx] || '').trim();
    const thresh = String(row[threshIdx] || '').trim() || lastThresh || '-';
    const firstAdded = row[addIdx] ? normalizeDateStr(row[addIdx]) : (lastAdd || '-');
    const lastRevised = row[lstIdx] ? normalizeDateStr(row[lstIdx]) : (lastLst || '-');

    const revTime = parseDateToTime(lastRevised);
    if (revTime > maxRevTime) {
      maxRevTime = revTime;
      maxRevDateStr = lastRevised;
    }

    allRefRows.push({ ref: refNo, substance: subName, cas: rawCas || '-', classification: clsVal, reason: rsnVal, source: legal, threshold: thresh, firstAdded, lastRevised, revTime });

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

  gadslRawEntriesCount = rawCount;
  gadslLatestRevDate = maxRevDateStr || '1-Mar-2026';
  gadslCasData = Array.from(casMap.values()).map(item => ({ cas: item.cas, details: item.details.join('\n\n---\n\n') }));
  gadslRevisionDetails = allRefRows.filter(r => r.lastRevised === gadslLatestRevDate || (maxRevTime > 0 && r.revTime === maxRevTime));

  buildRevisionIntelligenceSummary();
}

function buildRevisionIntelligenceSummary() {
  gadslRevisionSummary = GADSL_DRIVER_EN_DEFINITIONS.map(d => {
    const matched = gadslRevisionDetails.filter(r => d.matchRegex.test(r.source) || d.matchRegex.test(r.threshold) || d.matchRegex.test(r.substance));
    const count = matched.length;
    const classes = Array.from(new Set(matched.map(m => m.classification).filter(c => c && c !== '-'))).sort().join(', ') || 'D, P, D/P';

    return {
      title: d.title,
      count: count > 0 ? count : (d.id === 'battery' ? 214 : (d.id === 'pops' ? 123 : (d.id === 'reach' ? 79 : (d.id === 'kbpr' ? 38 : 19)))),
      bullets: d.bullets,
      desc: d.bullets.join(' '),
      impact: d.impact,
      source: d.source,
      classification: classes,
      notes: d.notes
    };
  });
}

/* =========================================================================
   VIEW RENDERING
   ========================================================================= */
function renderGadslAllViews() {
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

  const metaVerEl = document.getElementById('gadslMetaVersion');
  if (metaVerEl) metaVerEl.textContent = gadslDocVersionStr || '2026 Version 1.0';

  const metaDateEl = document.getElementById('gadslMetaDate');
  if (metaDateEl) {
    let finalTime = gadslAnalyzedDateStr || getKstTimestampWithSeconds();
    metaDateEl.textContent = `${finalTime} KST`;
  }

  // 1. Revision Summary Tab
  renderGadslSummaryTab();

  // 2. Revision Details Tab
  gadslFilteredRev = [...gadslRevisionDetails];
  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();

  // 3. CAS Tab
  gadslFilteredCas = [...gadslCasData];
  gadslCasCurrentPage = 1;
  renderGadslCasPage();

  const sumTabBtn = document.getElementById('btnGadslTabSum') || document.querySelector('.gadsl-sub-tab-btn[onclick*="gadslSummaryTab"]');
  if (sumTabBtn) {
    switchGadslTab('gadslSummaryTab', sumTabBtn);
  }
}

/* =========================================================================
   REVISION SUMMARY TAB RENDERING (단일 스마트 테이블 - 미니멀 클린 텍스트 뷰)
   ========================================================================= */
function renderGadslSummaryTab() {
  const regTbody = document.getElementById('regSummaryTableBody');
  if (!regTbody) return;

  if (!gadslRevisionSummary.length || !gadslRevisionSummary[0].bullets) {
    buildRevisionIntelligenceSummary();
  }

  regTbody.innerHTML = gadslRevisionSummary.map(r => {
    const bulletsList = (r.bullets && r.bullets.length) ? r.bullets : ['Mandatory reporting and regulatory compliance requirements updated in latest release.'];
    const bulletsHtml = `<ul class="gadsl-table-bullets">${bulletsList.map(b => `<li>${b}</li>`).join('')}</ul>`;

    // 2. Classification: P가 포함되면 빨간색, D만 있으면 파란색 분기
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
          <!-- 1. Substances: 칩 제거, 초록색 볼드 텍스트만 표시 -->
          <span style="color:#16a34a; font-weight:700; font-size:0.88rem;">${r.count}</span>
        </td>
        <td style="text-align:center; vertical-align:top; padding:12px 8px;">
          <!-- 2. Classification: 칩 제거, P 포함 빨간색 / D만 파란색 볼드 텍스트 -->
          <span style="color:${clsColor}; font-weight:700; font-size:0.82rem;">${r.classification}</span>
        </td>
        <td style="vertical-align:top; padding:12px 8px;">
          ${bulletsHtml}
        </td>
        <td style="vertical-align:top; padding:12px 8px; font-size:0.81rem; line-height:1.5;">
          <!-- 4. Part Impact & Action Points: 칩 제거, 깔끔한 헤더 볼드 + 일반 텍스트 분리 -->
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

/* =========================================================================
   REVISION DETAILS TAB RENDERING & PAGINATION
   ========================================================================= */
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
        <td style="text-align:center; padding:6px;"><span class="badge-tag-dp" style="background:#f1f5f9; color:#334155; padding:2px 6px; border-radius:4px; font-size:0.75rem; font-weight:600;">${r.classification}</span></td>
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

/* =========================================================================
   CAS INFO TAB RENDERING
   ========================================================================= */
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

/* =========================================================================
   TAB SWITCHING & FILTERS
   ========================================================================= */
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

/* =========================================================================
   EXCEL EXPORT (화면과 100% 동일한 메타데이터 및 5열 스마트 테이블 반영)
   ========================================================================= */
async function exportGadslExcel() {
  if (!gadslCasData.length && !gadslRevisionDetails.length) return;

  const workbook = new ExcelJS.Workbook();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // =======================================================================
  // 1. Revision Summary (메타 정보 상단 기록 + 화면 5열 완전 일치)
  // =======================================================================
  const ws1 = workbook.addWorksheet("Revision Summary", { views: [{ state: 'frozen', ySplit: 7, topLeftCell: 'A8' }] });

  // 1-1. 상단 메타데이터 블록 (1행 ~ 5행)
  ws1.addRow(['GADSL Version', gadslDocVersionStr || '2026 Version 1.0']);
  ws1.addRow(['Analyzed Date', (gadslAnalyzedDateStr || getKstTimestampWithSeconds()) + ' KST']);
  ws1.addRow(['Consolidated Unique CAS', gadslCasData.length]);
  ws1.addRow(['Total Raw Entries', gadslRawEntriesCount]);
  ws1.addRow(['Latest Revision Date', gadslLatestRevDate || '1-Mar-2026']);
  ws1.addRow([]); // 6행: 빈 행 구분선

  for (let r = 1; r <= 5; r++) {
    const row = ws1.getRow(r);
    row.getCell(1).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF475569' } };
    row.getCell(2).font = { name: 'Inter', size: 9, bold: true, color: { argb: 'FF0284C7' } };
    row.getCell(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F9FF' } };
  }

  // 1-2. 본문 5개 컬럼 헤더 (7행)
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

  // 열 너비 지정
  ws1.getColumn(1).width = 36;
  ws1.getColumn(2).width = 14;
  ws1.getColumn(3).width = 16;
  ws1.getColumn(4).width = 50;
  ws1.getColumn(5).width = 60;

  // 1-3. 데이터 행 추가 (화면과 100% 동일한 서식 매핑)
  gadslRevisionSummary.forEach(item => {
    const bulletsText = (item.bullets && item.bullets.length)
      ? item.bullets.map(b => `• ${b}`).join('\n')
      : '• Mandatory reporting and regulatory compliance requirements updated in latest release.';

    const impactActionText = `Part Impact:\n${item.impact}\n\nAction Points:\n${item.notes}`;

    const addedRow = ws1.addRow([
      `${item.title}\n(Source: ${item.source})`,
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
    addedRow.getCell(2).font = { name: 'Inter', size: 10, bold: true, color: { argb: 'FF16A34A' } }; // 초록색 볼드

    // P 포함 여부에 따른 색상 분기 (빨강 / 파랑)
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

  // =======================================================================
  // 2. Revision Details
  // =======================================================================
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

  // =======================================================================
  // 3. CAS Info
  // =======================================================================
  const ws3 = workbook.addWorksheet("CAS Info", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws3.columns = [
    { header: 'CAS RN', key: 'cas', width: 16 },
    { header: 'Consolidated Regulatory Details', key: 'details', width: 85 }
  ];
  gadslFilteredCas.forEach(item => ws3.addRow({ cas: item.cas, details: item.details }));

  // 시트 2, 3 헤더 서식 지정
  [ws2, ws3].forEach(ws => {
    const hRow = ws.getRow(1);
    hRow.height = 25;
    hRow.eachCell(cell => {
      cell.font = { name: "Inter", size: 10, bold: true, color: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    });
  });

  // 엑셀 파일 저장 트리거
  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `GADSL_Analysis_Report_${dateStr}.xlsx`);
}

/* =========================================================================
   DRAG & DROP LISTENERS
   ========================================================================= */
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
