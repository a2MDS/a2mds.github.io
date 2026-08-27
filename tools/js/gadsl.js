/* =========================================================================
   GADSL ANALYZER MODULE (Google Sheets Synced + Strict English Summary)
   ========================================================================= */
const URL_GADSL = 'https://script.google.com/macros/s/AKfycbxAHLs-YzCpug1hLI-oTaH41E4YRA9gPixpw2483eLrSKIq3qCi6hh5kqX2LFx9pFHhpQ/exec';
const GADSL_DB_NAME = 'a2MDS_GadslLog_DB';

let gadslCasData = [];          // Consolidated CAS List
let gadslRawEntriesCount = 0;   // Raw parsed entries count
let gadslRevisionSummary = [];  // Regulatory Drivers & Changes
let gadslRevisionDetails = [];  // Detailed Revision History (최신 Last revised 일치 항목)
let gadslDocVersionStr = '';    // Document Version (e.g. 2026 Version 1.0)
let gadslLatestRevDate = '';    // Max Last Revised Date (e.g. 1-Mar-2026)
let gadslAnalyzedDateStr = '';  // Analysis Executed Date (KST Timestamp with seconds)

let gadslFilteredCas = [];
let gadslFilteredRev = [];
let gadslRevTableFilters = Array(9).fill('');

// CAS Info 페이지네이션 상태 변수
let gadslCasCurrentPage = 1;
let gadslCasPageSize = 100;

// Revision Details 페이지네이션 상태 변수
let gadslRevCurrentPage = 1;
let gadslRevPageSize = 100;

// 규제 드라이버 영문 마스터 사전
const GADSL_DRIVER_EN_DEFINITIONS = [
  {
    id: 'battery',
    title: 'California Battery Labeling Requirements',
    matchRegex: /battery|california|labeling/i,
    bullets: [
      'Mandatory declarable (D) reporting for intentionally added substances in battery cells and components.'
    ],
    impact: 'Mandatory IMDS declaration across EV battery cells/packs and electronic components',
    source: 'California Battery Labeling',
    notes: 'Mandatory declaration (Threshold 0% / Intentionally added) for battery applications'
  },
  {
    id: 'pops',
    title: 'Stockholm Indicative List & POPs Regulation',
    matchRegex: /pop|stockholm|pfca/i,
    bullets: [
      'Expanded prohibitions (P) and tighter restrictions on Persistent Organic Pollutants (e.g., C9–C21 PFCAs).'
    ],
    impact: 'PFAS screening across fluoropolymers/rubbers (PTFE, FKM), coatings, and sealing components',
    source: 'Stockholm Convention / EU POPs',
    notes: 'Prohibition of POPs substances & compliance with C9–C21 PFCAs long-chain PFAS restrictions'
  },
  {
    id: 'reach',
    title: 'EU REACH SVHC & MCCP Restrictions',
    matchRegex: /reach|svhc|mccp|1907\/2006|annex/i,
    bullets: [
      'Updated REACH SVHC candidate list and specified restrictions on Medium-Chain Chlorinated Paraffins (MCCPs).'
    ],
    impact: 'Verification of SVHCs and MCCP alternatives in cable jacketing, rubber hoses, and flame-retardant polymers',
    source: 'EU REACH (SVHC & Annex XVII)',
    notes: 'SVHC declaration above 0.1% w/w threshold & compliance with Annex XVII restrictions'
  },
  {
    id: 'kbpr',
    title: 'K-BPR (Chemicals & Biocides Safety Act)',
    matchRegex: /k-bpr|biocide|살생물|화학제품안전/i,
    bullets: [
      'Detailed classification (D/P) aligned with approved biocidal substances and permitted product-types (PT).'
    ],
    impact: 'Confirmation of approval status for antibacterial interior trims, HVAC filters, and antiseptic-treated parts',
    source: 'K-BPR (Consumer Chemical Products & Biocides)',
    notes: 'Verification of approved biocidal active substances & restriction on unapproved treated articles'
  },
  {
    id: 'pfas',
    title: 'US State PFAS Bans (e.g., Minnesota HF2310)',
    matchRegex: /minnesota|tsca|pfas|hf2310|state/i,
    bullets: [
      'Implementation of state-level PFAS prohibitions and mandatory reporting obligations.'
    ],
    impact: 'Preemptive PFAS screening across all automotive parts exported to North America',
    source: 'US State Regulations (PFAS/TSCA)',
    notes: 'Reporting for Minnesota/Maine state PFAS regulations & compliance with TSCA PBT bans'
  }
];

function openGadslDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(GADSL_DB_NAME, 9);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (db.objectStoreNames.contains('gadsl_data')) {
        db.deleteObjectStore('gadsl_data');
      }
      db.createObjectStore('gadsl_data', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveGadslToDB(dataPayload) {
  try {
    const db = await openGadslDB();
    const tx = db.transaction('gadsl_data', 'readwrite');
    const store = tx.objectStore('gadsl_data');
    store.clear();
    store.put({ id: 'latest_state', ...dataPayload });
  } catch (e) {}
}

async function loadGadslFromDB() {
  try {
    const db = await openGadslDB();
    return new Promise(resolve => {
      const req = db.transaction('gadsl_data', 'readonly').objectStore('gadsl_data').get('latest_state');
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    return null;
  }
}

async function clearGadslIndexedDB() {
  try {
    const db = await openGadslDB();
    db.transaction('gadsl_data', 'readwrite').objectStore('gadsl_data').clear();
  } catch (e) {}
}

async function initGadslModule() {
  const cached = await loadGadslFromDB();
  if (cached && cached.casData?.length) {
    gadslCasData = cached.casData;
    gadslRawEntriesCount = cached.rawEntriesCount || cached.casData.length;
    gadslRevisionSummary = cached.revisionSummary || [];
    gadslRevisionDetails = cached.revisionDetails || [];
    gadslDocVersionStr = cached.docVersionStr || '';
    gadslLatestRevDate = cached.latestRevDate || '';
    gadslAnalyzedDateStr = cached.analyzedDateStr || '';

    renderGadslAllViews();
  } else {
    const key = getStoredAuthKey();
    if (key) {
      fetchGadslData(key);
    }
  }
}

function getKstTimestampWithSeconds() {
  const now = new Date();
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = dtf.formatToParts(now);
  const findPart = t => parts.find(p => p.type === t)?.value || '00';
  return `${findPart('year')}-${findPart('month')}-${findPart('day')} ${findPart('hour')}:${findPart('minute')}:${findPart('second')}`;
}

/* =========================================================================
   GOOGLE SHEETS CLOUD SYNC & CACHE HANDSHAKE
   ========================================================================= */
async function fetchGadslData(authOverride = '', forceReload = false) {
  const key = authOverride || getStoredAuthKey();
  if (!key) return;

  const syncBanner = document.getElementById('gadslSyncBanner');
  const metaBadge = document.getElementById('gadslCombinedMetaBadge');

  if (syncBanner) {
    syncBanner.style.display = 'flex';
    const bannerText = document.getElementById('gadslSyncBannerText');
    if (bannerText) bannerText.textContent = '⏳ Synchronizing latest GADSL master records from Cloud DB...';
  }

  try {
    const payload = {
      auth: key,
      action: 'fetch_data',
      clientLastUpdated: forceReload ? '' : gadslAnalyzedDateStr
    };

    const resp = await fetch(URL_GADSL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      renderGadslAllViews();
      return res;
    }

    if (res?.status === 'success' && res.data && res.data.casData?.length) {
      const d = res.data;
      gadslCasData = d.casData || [];
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
    if (metaBadge && !gadslCasData.length) {
      metaBadge.textContent = 'Sync Failed';
    }
  } finally {
    if (syncBanner) syncBanner.style.display = 'none';
  }
}

async function saveGadslToCloud(dataPayload) {
  const authKey = getStoredAuthKey();
  if (!authKey) return;

  try {
    await fetch(URL_GADSL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        auth: authKey,
        action: 'save_data',
        payload: dataPayload
      })
    });
  } catch (e) {}
}

/* =========================================================================
   FILE PARSING & DATA NORMALIZATION
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

    // 1. Version Sheet
    const verSheetName = sheetNames.find(n => /version|disclaimer|info/i.test(n)) || sheetNames[0];
    const verSheet = workbook.Sheets[verSheetName];
    const verJson = XLSX.utils.sheet_to_json(verSheet, { header: 1, defval: '' });
    parseVersionInfo(verJson);

    // 2. Reference List Sheet 파싱
    const refSheetName = sheetNames.find(n => /reference\s*list/i.test(n)) 
                      || sheetNames.find(n => /ref/i.test(n) && !/change|rev|summary/i.test(n)) 
                      || sheetNames[0];
    const refSheet = workbook.Sheets[refSheetName];
    const refJson = XLSX.utils.sheet_to_json(refSheet, { header: 1, defval: '' });
    
    parseReferenceListAndRevisions(refJson);

    // 분석 실시일 (KST 초단위)
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

    // 로컬 IndexedDB 저장 + 구글 시트 클라우드 백업 전송
    await saveGadslToDB(dataPayload);
    saveGadslToCloud(dataPayload);

    renderGadslAllViews();
  } catch (err) {
    alert('Failed to parse GADSL Excel file. Please ensure it is a valid official format.');
  } finally {
    if (dropTitle) dropTitle.textContent = '📁 Click or Drag & Drop GADSL Master Excel (.xlsx) here to Parse';
  }
}

function parseVersionInfo(rows) {
  gadslDocVersionStr = '';
  if (!rows || !rows.length) return;

  for (let r = 0; r < Math.min(25, rows.length); r++) {
    const rowStr = rows[r].join(' ').trim();
    const verMatch = rowStr.match(/(\d{4}\s+Version\s+[\d\.]+)/i);
    if (verMatch) {
      gadslDocVersionStr = verMatch[1].replace(/\s+/g, ' ');
      break;
    }
  }

  if (!gadslDocVersionStr) {
    gadslDocVersionStr = '2026 Version 1.0';
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
  if (!s || s === '-' || s === 'null' || s === 'undefined') return '';

  const mStd = s.match(/^(\d{1,2})[-\/\s]([A-Za-z]{3})[-\/\s](\d{4})$/);
  if (mStd) {
    const mName = mStd[2].charAt(0).toUpperCase() + mStd[2].slice(1).toLowerCase();
    return `${parseInt(mStd[1], 10)}-${mName}-${mStd[3]}`;
  }

  const mWeekday = s.match(/(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)[,\s]+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/i);
  if (mWeekday) {
    const mName = mWeekday[1].charAt(0).toUpperCase() + mWeekday[1].slice(1).toLowerCase();
    return `${parseInt(mWeekday[2], 10)}-${mName}-${mWeekday[3]}`;
  }

  const mText = s.match(/([A-Za-z]{3})\s+(\d{1,2})[,\s]+(\d{4})/i);
  if (mText) {
    const mName = mText[1].charAt(0).toUpperCase() + mText[1].slice(1).toLowerCase();
    return `${parseInt(mText[2], 10)}-${mName}-${mText[3]}`;
  }

  const mIso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) {
    const y = parseInt(mIso[1], 10);
    const mIdx = parseInt(mIso[2], 10) - 1;
    const d = parseInt(mIso[3], 10);
    return `${d}-${months[mIdx]}-${y}`;
  }

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
    if (month !== undefined) {
      return Date.UTC(parseInt(m[3], 10), month, parseInt(m[1], 10));
    }
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d.getTime();
  return 0;
}

function parseReferenceListAndRevisions(rows) {
  if (!rows || rows.length < 2) return;

  let hIdx = -1;
  for (let r = 0; r < Math.min(30, rows.length); r++) {
    const rLower = rows[r].map(c => String(c).toLowerCase().replace(/[^a-z0-9]/g, ''));
    const hasCas = rLower.some(c => c === 'cas' || c.includes('casno') || c.includes('casrn'));
    const hasLastRev = rLower.some(c => c.includes('lastrevised') || c.includes('revised'));
    if (hasCas && hasLastRev) {
      hIdx = r;
      break;
    }
  }
  if (hIdx === -1) hIdx = 0;

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
  const addIdx = getIdx(['firstadded', 'added', 'datefirst']);
  const lstIdx = getIdx(['lastrevised', 'revised', 'datelast']);

  const casMap = new Map();
  const allRefRows = [];
  let rawCount = 0;

  let maxRevTime = 0;
  let maxRevDateStr = '';

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

    allRefRows.push({
      ref: refNo,
      substance: subName,
      cas: rawCas || '-',
      classification: clsVal,
      reason: rsnVal,
      source: legal,
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

      if (!casMap.has(rawCas)) {
        casMap.set(rawCas, { cas: rawCas, details: [detailStr] });
      } else {
        const existing = casMap.get(rawCas);
        if (!existing.details.includes(detailStr)) {
          existing.details.push(detailStr);
        }
      }
    }
  }

  gadslRawEntriesCount = rawCount;
  gadslLatestRevDate = maxRevDateStr || '1-Mar-2026';
  gadslCasData = Array.from(casMap.values()).map(item => ({
    cas: item.cas,
    details: item.details.join('\n\n---\n\n')
  }));

  gadslRevisionDetails = allRefRows.filter(r => r.lastRevised === gadslLatestRevDate || (maxRevTime > 0 && r.revTime === maxRevTime));

  buildRevisionIntelligenceSummary();
}

function buildRevisionIntelligenceSummary() {
  gadslRevisionSummary = GADSL_DRIVER_EN_DEFINITIONS.map(d => {
    const matched = gadslRevisionDetails.filter(r => 
      d.matchRegex.test(r.source) || d.matchRegex.test(r.threshold) || d.matchRegex.test(r.substance)
    );
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
   VIEW RENDERING & AUTO RESTORE
   ========================================================================= */
function renderGadslAllViews() {
  const container = document.getElementById('gadslTabsContainer');
  if (container) container.style.display = 'block';

  const dropZone = document.getElementById('gadslDropZone');
  if (dropZone) dropZone.style.display = 'block';

  const casBadge = document.getElementById('casBadge');
  if (casBadge) casBadge.textContent = `${gadslCasData.length.toLocaleString()}`;

  const revBadge = document.getElementById('revBadge');
  if (revBadge) revBadge.textContent = `${gadslRevisionDetails.length.toLocaleString()}`;

  // 단일 통합 뱃지 적용: Version & Date Analyzed
  const metaBadge = document.getElementById('gadslCombinedMetaBadge');
  if (metaBadge) {
    let finalTime = gadslAnalyzedDateStr;
    if (!finalTime || finalTime.length <= 10) {
      finalTime = getKstTimestampWithSeconds();
    }
    const verStr = gadslDocVersionStr || '2026 Version 1.0';
    metaBadge.textContent = `Version & Date Analyzed: ${verStr} & ${finalTime} KST`;
  }

  const countText = document.getElementById('casBannerCountText');
  const rawText = document.getElementById('casBannerRawText');
  if (countText) countText.textContent = gadslCasData.length.toLocaleString();
  if (rawText) rawText.textContent = gadslRawEntriesCount.toLocaleString();

  // 1. CAS Tab
  gadslFilteredCas = [...gadslCasData];
  gadslCasCurrentPage = 1;
  renderGadslCasPage();

  // 2. Summary Tab
  renderGadslSummaryTab();

  // 3. Revision Details Tab
  gadslFilteredRev = [...gadslRevisionDetails];
  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();
}

/* =========================================================================
   CAS INFO PAGINATION & RENDERING
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
        <td style="text-align: center; vertical-align: top; font-weight: 600; color: var(--text-main); font-family: monospace;">${item.cas}</td>
        <td style="white-space: pre-wrap; line-height: 1.5;" class="gadsl-plain-text">${item.details}</td>
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

function goToGadslCasPage(page) {
  gadslCasCurrentPage = page;
  renderGadslCasPage();
}

function changeGadslCasPageSize(size) {
  gadslCasPageSize = parseInt(size, 10);
  gadslCasCurrentPage = 1;
  renderGadslCasPage();
}

function renderGadslSummaryTab() {
  const grid = document.getElementById('insightsGrid');
  const regTbody = document.getElementById('regSummaryTableBody');

  if (!gadslRevisionSummary.length || !gadslRevisionSummary[0].bullets) {
    buildRevisionIntelligenceSummary();
  }

  if (grid) {
    let cardHtml = '';
    gadslRevisionSummary.forEach(d => {
      const bulletsList = (d.bullets && d.bullets.length) ? d.bullets : [
        'Mandatory reporting and regulatory compliance requirements updated in latest release.'
      ];
      const bulletsHtml = bulletsList
        .map(b => `<li style="margin-bottom: 4px; line-height: 1.45;">${b}</li>`)
        .join('');

      cardHtml += `
        <div class="driver-card">
          <h4>
            <span>${d.title}</span>
            <span class="driver-count" style="background:#dcfce7; color:#15803d; padding:2px 8px; border-radius:12px; font-size:0.76rem;">${d.count}</span>
          </h4>
          <ul class="driver-desc" style="font-size:0.82rem; color:var(--text-body); margin: 0 0 10px 0; padding-left: 18px;">
            ${bulletsHtml}
          </ul>
          <div class="driver-impact" style="font-size:0.76rem; background:var(--bg-slate); padding:6px 10px; border-radius:6px; border:1px solid var(--border-gray); color:var(--text-body);">
            <strong>Part Impact:</strong> ${d.impact}
          </div>
        </div>`;
    });
    grid.innerHTML = cardHtml;
  }

  if (regTbody) {
    let tHtml = '';
    gadslRevisionSummary.forEach(r => {
      tHtml += `
        <tr>
          <td style="font-weight: 600; color: var(--text-main);">${r.source}</td>
          <td style="text-align: center; font-weight: 700; color: var(--text-main);">${r.count}</td>
          <td style="text-align: center;"><span class="badge-tag-dp" style="background:#f3e8ff; color:#7e22ce; padding:2px 6px; border-radius:4px; font-size:0.74rem; font-weight:700;">${r.classification}</span></td>
          <td style="font-size:0.80rem; color:var(--text-body);">${r.notes}</td>
        </tr>`;
    });
    regTbody.innerHTML = tHtml;
  }
}

/* =========================================================================
   REVISION DETAILS PAGINATION & RENDERING
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
        <td style="text-align:center;">${r.ref}</td>
        <td title="${r.substance}">${r.substance}</td>
        <td style="text-align:center; font-family:monospace;" title="${r.cas}">${r.cas}</td>
        <td style="text-align:center;">${r.classification}</td>
        <td style="text-align:center;">${r.reason}</td>
        <td title="${r.source}">${r.source}</td>
        <td title="${r.threshold}">${r.threshold}</td>
        <td style="text-align:center;">${r.firstAdded}</td>
        <td style="text-align:center;">${r.lastRevised}</td>
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

function goToGadslRevPage(page) {
  gadslRevCurrentPage = page;
  renderGadslRevisionPage();
}

function changeGadslRevPageSize(size) {
  gadslRevPageSize = parseInt(size, 10);
  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();
}

/* =========================================================================
   TAB SWITCHING & FILTERING
   ========================================================================= */
function switchGadslTab(tabId, btnElem) {
  document.querySelectorAll('.gadsl-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.gadsl-tab-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) btnElem.classList.add('active');
  const targetPane = document.getElementById(tabId);
  if (targetPane) targetPane.classList.add('active');
}

function onGadslCasFilterChange() {
  const casKw = (document.getElementById('filterCasInput')?.value || '').toLowerCase().trim();
  const detKw = (document.getElementById('filterCasDetailsInput')?.value || '').toLowerCase().trim();

  gadslFilteredCas = gadslCasData.filter(item => {
    const matchCas = !casKw || item.cas.toLowerCase().includes(casKw) || item.cas.replace(/-/g, '').includes(casKw);
    const matchDet = !detKw || item.details.toLowerCase().includes(detKw);
    return matchCas && matchDet;
  });

  gadslCasCurrentPage = 1;
  renderGadslCasPage();
}

function onGadslRevFilterChange(colIdx, val) {
  gadslRevTableFilters[colIdx] = val.toLowerCase().trim();

  gadslFilteredRev = gadslRevisionDetails.filter(r => {
    const rowValues = [r.ref, r.substance, r.cas, r.classification, r.reason, r.source, r.threshold, r.firstAdded, r.lastRevised];
    return gadslRevTableFilters.every((kw, idx) => {
      if (!kw) return true;
      const cellText = String(rowValues[idx] || '').toLowerCase();
      if (idx === 2) {
        return cellText.includes(kw) || cellText.replace(/-/g, '').includes(kw);
      }
      return cellText.includes(kw);
    });
  });

  gadslRevCurrentPage = 1;
  renderGadslRevisionPage();
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
   EXCEL EXPORT (3 SHEETS)
   ========================================================================= */
async function exportGadslExcel() {
  if (!gadslCasData.length && !gadslRevisionDetails.length) return;

  const workbook = new ExcelJS.Workbook();
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');

  // Sheet 1: CAS Info
  const ws1 = workbook.addWorksheet("CAS Info", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws1.columns = [
    { header: 'CAS RN', key: 'cas', width: 16 },
    { header: 'Consolidated Regulatory Details', key: 'details', width: 85 }
  ];
  gadslFilteredCas.forEach(item => ws1.addRow({ cas: item.cas, details: item.details }));

  // Sheet 2: Revision Summary
  const ws2 = workbook.addWorksheet("Revision Summary", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws2.columns = [
    { header: 'Regulation / Legal Source', key: 'source', width: 32 },
    { header: 'Substances', key: 'count', width: 15 },
    { header: 'Classification', key: 'classification', width: 18 },
    { header: 'Key Regulatory Changes & Part Compliance Points', key: 'notes', width: 65 }
  ];
  gadslRevisionSummary.forEach(item => ws2.addRow(item));

  // Sheet 3: Revision Details
  const ws3 = workbook.addWorksheet("Revision Details", { views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2' }] });
  ws3.columns = [
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
  gadslFilteredRev.forEach(item => ws3.addRow(item));

  [ws1, ws2, ws3].forEach(ws => {
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

/* =========================================================================
   DRAG & DROP EVENT LISTENERS
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
      dropZone.style.borderColor = '#cbd5e1';
      dropZone.style.backgroundColor = 'var(--bg-slate)';
    }, false);
  });

  dropZone.addEventListener('drop', e => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files && files.length > 0) {
      handleGadslFile({ target: { files } });
    }
  }, false);
});
