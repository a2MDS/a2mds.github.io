/* =========================================================================
   GADSL ANALYZER MODULE
   ========================================================================= */
let globalCasData = [];
let globalRevisionData = [];
let globalRegSummaryData = [];
let globalLatestDateStr = "";

const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.innerText = txt; };
const setHtml = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };

function cleanAndJoin(setOfStrings) {
  if (!setOfStrings || setOfStrings.size === 0) return "";
  const items = [];
  setOfStrings.forEach(str => {
    if (!str) return;
    const parts = String(str).split(/[\r\n]+/).map(p => p.trim()).filter(Boolean);
    parts.forEach(p => { if (!items.includes(p)) items.push(p); });
  });
  return items.join(", ");
}

function formatDate(val) {
  if (!val) return "";
  if (val instanceof Date && !isNaN(val)) return val.toISOString().split('T')[0];
  if (typeof val === 'number') {
    const date = new Date(Math.round((val - 25569) * 86400 * 1000));
    if (!isNaN(date)) return date.toISOString().split('T')[0];
  }
  const str = String(val).trim();
  const parsed = new Date(str);
  if (!isNaN(parsed) && str.length >= 8) return parsed.toISOString().split('T')[0];
  return str;
}

document.addEventListener('DOMContentLoaded', () => {
  const gadslDropZone = document.getElementById('gadslDropZone');
  if (gadslDropZone) {
    ['dragenter', 'dragover'].forEach(name => {
      gadslDropZone.addEventListener(name, (e) => { e.preventDefault(); gadslDropZone.style.borderColor = 'var(--primary-green)'; }, false);
    });
    ['dragleave', 'drop'].forEach(name => {
      gadslDropZone.addEventListener(name, (e) => { e.preventDefault(); gadslDropZone.style.borderColor = '#cbd5e1'; }, false);
    });
    gadslDropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) processGadslFile(files[0]);
    });
  }
});

function handleGadslFile(e) {
  const file = e.target.files[0];
  if (file) processGadslFile(file);
}

function processGadslFile(file) {
  setText('gadslUploadTitle', `⏳ Analyzing: ${file.name}`);
  
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array', cellDates: true });
      
      let sheetName = workbook.SheetNames.find(s => s.trim().toLowerCase() === 'reference list') || workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });

      if (rawRows.length < 2) return alert("Excel file contains insufficient data.");

      let headerRowIdx = 0;
      for (let i = 0; i < Math.min(5, rawRows.length); i++) {
        const rowStr = rawRows[i].join(" ").toLowerCase();
        if (rowStr.includes("substance") && (rowStr.includes("cas") || rowStr.includes("ref"))) {
          headerRowIdx = i; break;
        }
      }

      const headers = rawRows[headerRowIdx].map(h => String(h).trim());
      const dataRows = rawRows.slice(headerRowIdx + 1);

      const colIdx = {
        refNo: headers.findIndex(h => /^ref\s*#/i.test(h)),
        substance: headers.findIndex(h => /^substance/i.test(h)),
        cas: headers.findIndex(h => /cas/i.test(h)),
        classification: headers.findIndex(h => /class/i.test(h)),
        reasonCode: headers.findIndex(h => /reason/i.test(h)),
        source: headers.findIndex(h => /source/i.test(h)),
        examples: headers.findIndex(h => /supporting|generic|example/i.test(h)),
        threshold: headers.findIndex(h => /threshold/i.test(h)),
        firstAdded: headers.findIndex(h => /first\s*added/i.test(h)),
        lastRevised: headers.findIndex(h => /last\s*revised/i.test(h))
      };

      if (colIdx.refNo === -1) colIdx.refNo = 1;
      if (colIdx.substance === -1) colIdx.substance = 2;
      if (colIdx.cas === -1) colIdx.cas = 3;
      if (colIdx.classification === -1) colIdx.classification = 4;
      if (colIdx.reasonCode === -1) colIdx.reasonCode = 5;
      if (colIdx.source === -1) colIdx.source = 6;
      if (colIdx.examples === -1) colIdx.examples = 9;
      if (colIdx.threshold === -1) colIdx.threshold = 10;
      if (colIdx.firstAdded === -1) colIdx.firstAdded = 11;
      if (colIdx.lastRevised === -1) colIdx.lastRevised = 12;

      parseAndRenderGadsl(dataRows, colIdx);
      
      setText('gadslUploadTitle', `✅ Completed: ${file.name}`);
      document.getElementById('gadslStatsGrid').style.display = 'grid';
      document.getElementById('gadslTabsContainer').style.display = 'block';
    } catch (err) {
      alert("Error processing GADSL file: " + err.message);
      setText('gadslUploadTitle', "❌ Processing failed. Please try again.");
    }
  };
  reader.readAsArrayBuffer(file);
}

function parseAndRenderGadsl(rows, colIdx) {
  const casMap = new Map();
  let totalCasEntries = 0;
  let validRows = [];
  let maxRevisedDate = null;
  let maxRevisedDateStr = "";

  rows.forEach(r => {
    const rawSub = String(r[colIdx.substance] || "").trim();
    const rawCas = String(r[colIdx.cas] || "").trim();
    const rawRef = String(r[colIdx.refNo] || "").trim();
    const rawClass = String(r[colIdx.classification] || "").trim();
    const rawReason = String(r[colIdx.reasonCode] || "").trim();
    const rawSource = String(r[colIdx.source] || "").trim();
    const rawExamples = String(r[colIdx.examples] || "").trim();
    const rawThreshold = String(r[colIdx.threshold] || "").trim();
    const firstAddedStr = formatDate(r[colIdx.firstAdded]);
    const lastRevisedStr = formatDate(r[colIdx.lastRevised]);

    if (!rawSub && !rawCas) return;

    if (lastRevisedStr) {
      const d = new Date(lastRevisedStr);
      if (!isNaN(d)) {
        if (!maxRevisedDate || d > maxRevisedDate) {
          maxRevisedDate = d;
          maxRevisedDateStr = lastRevisedStr;
        }
      }
    }

    const item = {
      refNo: rawRef, substance: rawSub, cas: rawCas, classification: rawClass,
      reasonCode: rawReason, source: rawSource, examples: rawExamples,
      threshold: rawThreshold, firstAdded: firstAddedStr, lastRevised: lastRevisedStr
    };
    validRows.push(item);

    if (rawCas && rawCas.toLowerCase() !== 'none') {
      totalCasEntries++;
      if (!casMap.has(rawCas)) {
        casMap.set(rawCas, { cas: rawCas, refs: new Set(), sources: new Set(), examples: new Set(), thresholds: new Set() });
      }
      const entry = casMap.get(rawCas);
      if (rawRef) entry.refs.add(rawRef);
      if (rawSource) entry.sources.add(rawSource);
      if (rawExamples) entry.examples.add(rawExamples);
      if (rawThreshold) entry.thresholds.add(rawThreshold);
    }
  });

  globalCasData = [];
  casMap.forEach((val, key) => {
    let lines = [];
    if (val.refs.size > 0) { const refText = cleanAndJoin(val.refs); if (refText) lines.push(`[Ref #] ${refText}`); }
    if (val.sources.size > 0) { const srcText = cleanAndJoin(val.sources); if (srcText) lines.push(`[Source] ${srcText}`); }
    if (val.examples.size > 0) { const exText = cleanAndJoin(val.examples); if (exText) lines.push(`[Examples] ${exText}`); }
    if (val.thresholds.size > 0) { const thrText = cleanAndJoin(val.thresholds); if (thrText) lines.push(`[Threshold] ${thrText}`); }

    globalCasData.push({ cas: key, details: lines.join("\n") });
  });

  globalLatestDateStr = maxRevisedDateStr;
  globalRevisionData = validRows.filter(r => r.lastRevised === maxRevisedDateStr);

  analyzeRevisionSummary(globalRevisionData);

  setText('statCasCount', `${globalCasData.length.toLocaleString()}`);
  setText('statCasSub', `Merged from ${totalCasEntries.toLocaleString()} raw entries`);
  setText('statLatestDate', globalLatestDateStr || "N/A");
  
  const newAdditions = globalRevisionData.filter(r => r.firstAdded === globalLatestDateStr).length;
  setText('statRevisionCount', `${globalRevisionData.length.toLocaleString()}`);
  setText('statRevisionSub', `New: ${newAdditions} / Revised: ${globalRevisionData.length - newAdditions}`);

  const dCount = globalRevisionData.filter(r => r.classification === 'D').length;
  const pCount = globalRevisionData.filter(r => r.classification === 'P').length;
  const dpCount = globalRevisionData.filter(r => r.classification === 'D/P' || r.classification === 'D-P').length;
  setHtml('statClassBreakdown', `
    <span class="badge-tag-d">D: ${dCount}</span> 
    <span class="badge-tag-p">P: ${pCount}</span> 
    <span class="badge-tag-dp">D/P: ${dpCount}</span>
  `);

  setText('casBadge', globalCasData.length.toLocaleString());
  setText('revBadge', globalRevisionData.length.toLocaleString());

  renderCasTable(globalCasData);
  renderRevTable(globalRevisionData);
}

function analyzeRevisionSummary(revData) {
  const drivers = [
    { name: "California Battery Labeling Requirements", keywords: ["battery labeling", "california battery"], desc: "캘리포니아 배터리 라벨링 규제 반영. 배터리 셀/구성 부품 내 의도적 첨가 물질 신고(D) 의무화.", impact: "EV 배터리 셀/팩 및 전장품 공급망 IMDS 신고 필수" },
    { name: "Stockholm Indicative List & POPs Regulation", keywords: ["stockholm", "2020/784", "pops"], desc: "스톡홀름 협약 및 EU POPs 잔류성 유기오염물질(PFAS 계열 C9-C21 PFCAs 등) 규제 강화 및 금지(P) 범위 확대.", impact: "불소수지/고무(PTFE, FKM), 코팅제, 발수/씰링 부품 PFAS 점검" },
    { name: "K-BPR (한국 화학제품안전법 / 살생물제)", keywords: ["k-bpr", "biocide"], desc: "국내 살생물제 관리법 승인 품목 및 제품유형 허용 용도에 따른 분류(D/P) 세분화.", impact: "항균 내장재, 공조 필터, 방부/살균 처리 부품의 승인 여부 확인" },
    { name: "EU REACH SVHC & MCCP Restrictions", keywords: ["reach candidate", "mccp", "1907/2006"], desc: "REACH SVHC 후보물질 업데이트 및 중쇄 염화파라핀(MCCP) 난연/가소제 제한 규제 구체화.", impact: "전선 피복재, 고무 호스, 난연 폴리머 내 SVHC 및 MCCP 대체재 검토" },
    { name: "US State PFAS Bans (Minnesota HF2310 등)", keywords: ["minnesota", "pfas"], desc: "미국 미네소타주 등 주정부 단위 PFAS 사용 금지 및 보고 의무 시행.", impact: "북미 수출용 부품 전반의 PFAS 함유 여부 선제적 스크리닝" }
  ];

  let driverCounts = {};
  let regMap = new Map();

  revData.forEach(item => {
    const src = item.source.toLowerCase();
    const cls = item.classification || "N/A";

    drivers.forEach(d => {
      if (d.keywords.some(kw => src.includes(kw))) {
        driverCounts[d.name] = (driverCounts[d.name] || 0) + 1;
      }
    });

    let category = "기타 법적 규제 개정";
    if (src.includes("battery labeling")) category = "California Battery Labeling";
    else if (src.includes("stockholm") || src.includes("2020/784")) category = "Stockholm POPs (PFAS C9-C21)";
    else if (src.includes("k-bpr") || src.includes("biocide")) category = "K-BPR (살생물제 규제)";
    else if (src.includes("reach") || src.includes("mccp")) category = "EU REACH (SVHC & MCCP)";
    else if (src.includes("minnesota")) category = "US State PFAS Restrictions";

    if (!regMap.has(category)) regMap.set(category, { count: 0, classes: new Set() });
    const regEntry = regMap.get(category);
    regEntry.count++;
    regEntry.classes.add(cls);
  });

  const insightsGrid = document.getElementById('insightsGrid');
  if (insightsGrid) {
    insightsGrid.innerHTML = "";
    drivers.forEach(d => {
      const count = driverCounts[d.name] || 0;
      if (count > 0) {
        const card = document.createElement('div');
        card.className = "driver-card";
        card.innerHTML = `
          <h4>${d.name} <span class="driver-count">${count}건</span></h4>
          <div class="driver-desc">${d.desc}</div>
          <div class="driver-impact"><strong>부품 영향:</strong> ${d.impact}</div>
        `;
        insightsGrid.appendChild(card);
      }
    });
  }

  const tbody = document.getElementById('regSummaryTableBody');
  if (tbody) {
    tbody.innerHTML = "";
    globalRegSummaryData = [];

    regMap.forEach((val, key) => {
      const classStr = Array.from(val.classes).join(", ");
      let points = "해당 규제에 따른 최신 Threshold 및 금지/신고 조건 준수 확인";
      if (key.includes("Battery")) points = "배터리 용도 부품에 대한 의도적 첨가 신고(Threshold 0% / Intentionally added) 대응";
      else if (key.includes("PFAS") || key.includes("Stockholm")) points = "C9-C21 PFCAs 1,000 ppb(0.0001%) 초과 여부 정밀 확인 및 금지(P) 대응";
      else if (key.includes("K-BPR")) points = "살생물 처리 부품의 국내 허용 제품유형(Type) 및 승인 여부 검증";
      else if (key.includes("MCCP")) points = "사슬 길이 C14-C17 염화파라핀 함유 여부 및 IMDS Chemistry Manager 확인";

      globalRegSummaryData.push({ regulation: key, count: val.count, classes: classStr, points: points });

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-weight:600; color:var(--text-main);">${key}</td>
        <td style="text-align:center; font-weight:700;">${val.count}</td>
        <td style="text-align:center;"><span class="badge-tag-dp">${classStr}</span></td>
        <td style="font-size:0.8rem;">${points}</td>
      `;
      tbody.appendChild(tr);
    });
  }
}

function renderCasTable(data) {
  const tbody = document.getElementById('casTableBody');
  if (!tbody) return;
  tbody.innerHTML = "";
  
  const displayLimit = 500;
  const itemsToRender = data.slice(0, displayLimit);

  itemsToRender.forEach(row => {
    const tr = document.createElement('tr');
    let detailsHtml = escapeHtml(row.details)
      .replace(/\[Ref #\]/g, '<span class="tag-lead">[Ref #]</span>')
      .replace(/\[Source\]/g, '<span class="tag-lead">[Source]</span>')
      .replace(/\[Examples\]/g, '<span class="tag-lead">[Examples]</span>')
      .replace(/\[Threshold\]/g, '<span class="tag-lead">[Threshold]</span>');

    tr.innerHTML = `
      <td style="font-family:monospace; font-weight:600; text-align:center;"><button type="button" class="cas-trigger-btn">${escapeHtml(row.cas)}</button></td>
      <td style="white-space:pre-line; line-height:1.6; font-size:0.8rem;">${detailsHtml || '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  setText('casTableInfo', `Showing ${Math.min(displayLimit, data.length).toLocaleString()} of ${data.length.toLocaleString()} items`);
}

function renderRevTable(data) {
  const tbody = document.getElementById('revTableBody');
  if (!tbody) return;
  tbody.innerHTML = "";

  data.forEach(row => {
    const tr = document.createElement('tr');
    let classBadge = "-";
    if (row.classification === 'D') classBadge = `<span class="badge-tag-d">D</span>`;
    else if (row.classification === 'P') classBadge = `<span class="badge-tag-p">P</span>`;
    else if (row.classification) classBadge = `<span class="badge-tag-dp">${escapeHtml(row.classification)}</span>`;

    tr.innerHTML = `
      <td style="font-weight:600; text-align:center;">${escapeHtml(row.refNo) || '-'}</td>
      <td style="font-weight:600; color:var(--text-main);">${escapeHtml(row.substance)}</td>
      <td style="font-family:monospace; text-align:center;">${escapeHtml(row.cas) || '<span style="color:#94a3b8;">(Group)</span>'}</td>
      <td style="text-align:center;">${classBadge}</td>
      <td style="text-align:center; font-size:0.75rem; color:#64748b;">${escapeHtml(row.reasonCode) || '-'}</td>
      <td style="font-size:0.78rem; white-space:pre-line;">${escapeHtml(row.source) || '-'}</td>
      <td style="font-size:0.78rem; white-space:pre-line;">${escapeHtml(row.threshold) || '-'}</td>
      <td style="font-size:0.78rem; text-align:center; color:#64748b;">${escapeHtml(row.firstAdded) || '-'}</td>
      <td style="font-size:0.78rem; text-align:center; font-weight:600; color:var(--accent-blue);">${escapeHtml(row.lastRevised) || '-'}</td>
    `;
    tbody.appendChild(tr);
  });

  setText('revTableInfo', `Latest revision (${globalLatestDateStr}) : ${data.length.toLocaleString()} items`);
}

function filterCasTable() {
  const query = (document.getElementById('casSearchInput')?.value || '').toLowerCase().trim();
  if (!query) return renderCasTable(globalCasData);
  const filtered = globalCasData.filter(d => d.cas.toLowerCase().includes(query) || d.details.toLowerCase().includes(query));
  renderCasTable(filtered);
}

function filterRevTable() {
  const query = (document.getElementById('revSearchInput')?.value || '').toLowerCase().trim();
  if (!query) return renderRevTable(globalRevisionData);
  const filtered = globalRevisionData.filter(d => 
    d.substance.toLowerCase().includes(query) || d.cas.toLowerCase().includes(query) || 
    d.refNo.toLowerCase().includes(query) || d.source.toLowerCase().includes(query) || 
    d.threshold.toLowerCase().includes(query)
  );
  renderRevTable(filtered);
}

function switchGadslTab(tabId, btn) {
  document.querySelectorAll('.gadsl-tab-pane').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.gadsl-sub-tab-btn').forEach(el => el.classList.remove('active'));
  document.getElementById(tabId)?.classList.add('active');
  if (btn) btn.classList.add('active');
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function exportGadslExcel() {
  if (globalCasData.length === 0) return alert("No parsed data to export.");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'a2MDS Consulting GADSL Analyzer';
  workbook.created = new Date();

  // 1. CAS Info Sheet
  const wsCas = workbook.addWorksheet('CAS Info');
  wsCas.columns = [{ header: 'CAS', key: 'cas', width: 20 }, { header: 'Details', key: 'details', width: 100 }];
  wsCas.getRow(1).font = { bold: true };
  globalCasData.forEach(r => {
    const row = wsCas.addRow({ cas: r.cas, details: r.details });
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
  });

  // 2. Revision_Summary Sheet
  const wsSummary = workbook.addWorksheet('Revision_Summary');
  wsSummary.columns = [
    { header: '규제 / 법적 근거 (Source Category)', key: 'regulation', width: 35 },
    { header: '영향 물질 수', key: 'count', width: 15 },
    { header: '적용 분류', key: 'classes', width: 18 },
    { header: '핵심 변경 내용 및 대응 포인트', key: 'points', width: 75 }
  ];
  wsSummary.getRow(1).font = { bold: true };
  globalRegSummaryData.forEach(r => {
    const row = wsSummary.addRow(r);
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'center' };
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
  });

  // 3. Revision_Detail Sheet
  const wsRev = workbook.addWorksheet('Revision_Detail');
  wsRev.columns = [
    { header: 'Ref #', key: 'refNo', width: 12 }, { header: 'Substance', key: 'substance', width: 35 },
    { header: 'CAS RN', key: 'cas', width: 18 }, { header: 'Classification', key: 'classification', width: 15 },
    { header: 'Reason Code', key: 'reasonCode', width: 14 }, { header: 'Source', key: 'source', width: 45 },
    { header: 'Reporting threshold', key: 'threshold', width: 45 }, { header: 'First added', key: 'firstAdded', width: 15 },
    { header: 'Last revised', key: 'lastRevised', width: 15 }
  ];
  wsRev.getRow(1).font = { bold: true };
  globalRevisionData.forEach(r => {
    const row = wsRev.addRow(r);
    row.getCell(6).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(7).alignment = { wrapText: true, vertical: 'top' };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `GADSL_Analysis_${globalLatestDateStr || 'Export'}.xlsx`);
}
