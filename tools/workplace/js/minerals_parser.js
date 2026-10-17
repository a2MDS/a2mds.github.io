/**
 * js/minerals_parser.js
 * RMI CMRT / EMRT / AMRT Universal Client-side Parser & Minerals Engine
 * - Zero Coordinate Hardcoding (Dynamic Label & Header Matching)
 * - Scope & Revision Auto-detection
 * - Clean Smelter Extraction (Option A, B, C / [NL], [NYI] Reserved Words)
 * - 3-Tier Smelter Conformance Evaluation (All Conformant / All Conformant or Active / Action Needed)
 * - Data Aggregation Engine (All Reported Smelters & Unique Smelters Master Join)
 * - Standardized HTML / TSV Email Clipboard Table Generator
 * - Badge & Facility Formatter for Clean Audit Viewing
 * - 1:1 Exact Official Template Declaration, Dynamic Q&A & Product List Renderer
 * - Completed Project Snapshot & Inline Diff Engine (Strike-through + Line-break)
 */

window.MineralsParser = (function () {
  'use strict';

  // ==========================================
  // 1. MAIN PARSING ENTRYPOINT
  // ==========================================
  /**
   * 엑셀 파일 파싱 메인 함수
   * @param {File} file - 업로드된 엑셀 파일
   * @param {string} expectedScope - 프로젝트 목표 Scope ('CMRT' | 'EMRT' | 'AMRT')
   * @param {Array} smelterMasterDb - RMI 제련소 마스터 DB 배열
   * @returns {Promise<Object>} summary, fullBackup, fileBase64
   */
  async function parseMrtFile(file, expectedScope, smelterMasterDb) {
    if (!window.XLSX) {
      throw new Error('SheetJS(XLSX) 라이브러리가 로드되지 않았습니다.');
    }

    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true });

    // 1. 템플릿 종류 및 버전 판별
    const templateInfo = detectTemplateAndVersion(workbook);

    // Scope 일치 여부 검증 (불일치 시 반려 처리)
    if (expectedScope && templateInfo.scope !== 'UNKNOWN' && templateInfo.scope !== expectedScope) {
      const err = new Error(`Scope 불일치: 현재 프로젝트는 [${expectedScope}]이나 업로드된 파일은 [${templateInfo.scope} (${templateInfo.version})] 양식입니다.`);
      err.code = 'SCOPE_MISMATCH';
      err.detectedScope = templateInfo.scope;
      err.detectedVersion = templateInfo.version;
      throw err;
    }

    // 2. Declaration 탭 파싱 (Form Engine)
    const declParsed = parseDeclarationSheet(workbook);

    // 3. Table 시트들 파싱 (Table Engine: Smelter, Product, Scope, Mine)
    const smelterParsed = parseTableSheet(workbook, 'smelter list', ['metal', 'smelter look-up', 'smelter identification']);
    const productParsed = parseTableSheet(workbook, 'product list', ['responder product number', 'product number', 'product name']);
    const scopeParsed = parseTableSheet(workbook, 'minerals scope', ['select minerals', 'minerals/metals in scope', 'reasons for inclusion']);
    const mineParsed = parseTableSheet(workbook, 'mine list', ['mine facility', 'name of smelter', 'mine identification']);

    // 4. A열/F열 유효 CID 및 C열 미등재·미식별 예약어([NL], [NYI]) 추출
    const smelterSheetName = findSheetName(workbook, ['smelter list']);
    const smelterSheet = smelterSheetName ? workbook.Sheets[smelterSheetName] : null;
    const extractedCids = extractUniqueCidsFromSheet(smelterSheet);

    // 5. 제련소 3단계 적합성 평가
    const verification = evaluateSmelterConformance(extractedCids, smelterMasterDb);

    // 6. 원본 엑셀 Base64 인코딩
    const fileBase64 = arrayBufferToBase64(arrayBuffer);

    // 7. 요약(summary) 및 백업(backup) 데이터 구조화
    const summary = {
      companyNameTemplate: declParsed.companyName || file.name.replace(/\.[^/.]+$/, '').replace(/[_ -]?(cmrt|emrt|amrt).*/i, ''),
      templateVersion: templateInfo.version || expectedScope,
      scopeClass: declParsed.scopeClass || '-',
      verificationResult: verification.status, // 'All Conformant' | 'All Conformant or Active' | 'Action Needed'
      smelterCount: extractedCids.length,
      cids: extractedCids,
      issueDetails: verification.issues,
      fileName: file.name
    };

    const fullBackup = {
      declaration: declParsed.rawRows,
      smelterList: smelterParsed.rows,
      productList: productParsed.rows,
      mineralsScope: scopeParsed.rows,
      mineList: mineParsed.rows
    };

    return {
      summary: summary,
      fullBackup: fullBackup,
      fileBase64: fileBase64
    };
  }

  // ==========================================
  // 2. TEMPLATE & FORM ENGINES
  // ==========================================
  function detectTemplateAndVersion(workbook) {
    const declSheetName = findSheetName(workbook, ['declaration']) || workbook.SheetNames[0];
    const sheet = workbook.Sheets[declSheetName];
    if (!sheet) return { scope: 'UNKNOWN', version: 'Unknown Version' };

    let headerText = '';
    let versionText = '';

    const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:T20');
    for (let R = range.s.r; R <= Math.min(range.e.r, 15); ++R) {
      for (let C = range.s.c; C <= Math.min(range.e.c, 20); ++C) {
        const cell = sheet[XLSX.utils.encode_cell({ r: R, c: C })];
        if (cell && cell.v) {
          const val = String(cell.v).trim();
          headerText += ' ' + val;
          const revMatch = val.match(/(?:Revision|Release|Rev|Rel)\s*([0-9.]+)/i);
          if (revMatch && !versionText) {
            versionText = revMatch[1];
          }
        }
      }
    }

    const upper = headerText.toUpperCase();
    let scope = 'UNKNOWN';

    if (upper.includes('ADDITIONAL MINERALS') || upper.includes('AMRT')) {
      scope = 'AMRT';
    } else if (upper.includes('EXTENDED MINERALS') || upper.includes('EMRT')) {
      scope = 'EMRT';
    } else if (upper.includes('CONFLICT MINERALS') || upper.includes('CMRT') || (!upper.includes('EXTENDED') && !upper.includes('ADDITIONAL') && versionText.startsWith('6.'))) {
      scope = 'CMRT';
    }

    const versionLabel = versionText ? `${scope} v${versionText}` : scope;
    return { scope, version: versionLabel };
  }

  function parseDeclarationSheet(workbook) {
    const sheetName = findSheetName(workbook, ['declaration']);
    if (!sheetName) return { companyName: '', scopeClass: '', rawRows: [] };

    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    let companyName = '';
    let scopeClass = '';
    const cleanRows = [];

    for (let r = 0; r < jsonRows.length; r++) {
      const row = jsonRows[r];
      if (!Array.isArray(row) || row.every(val => String(val).trim() === '')) {
        continue;
      }

      const trimmedRow = row.map(v => (v !== null && v !== undefined ? String(v).trim() : ''));
      if (trimmedRow.some(Boolean)) {
        cleanRows.push(trimmedRow);
      }

      for (let c = 0; c < row.length; c++) {
        const cellVal = String(row[c] || '').trim();

        if (!companyName && /company\s*name\s*\(\*\)|기업명/i.test(cellVal)) {
          for (let nextC = c + 1; nextC < row.length; nextC++) {
            const nextVal = String(row[nextC] || '').trim();
            if (nextVal && !nextVal.includes('*')) {
              companyName = nextVal;
              break;
            }
          }
        }

        if (!scopeClass && /declaration\s*scope|선언\s*범위/i.test(cellVal)) {
          for (let nextC = c + 1; nextC < row.length; nextC++) {
            const nextVal = String(row[nextC] || '').trim();
            if (nextVal) {
              scopeClass = nextVal;
              break;
            }
          }
        }
      }
    }

    return {
      companyName: companyName,
      scopeClass: scopeClass,
      rawRows: cleanRows
    };
  }

  function parseTableSheet(workbook, targetSheetNamePattern, headerKeywords) {
    const sheetName = findSheetName(workbook, [targetSheetNamePattern]);
    if (!sheetName) return { headers: [], rows: [] };

    const sheet = workbook.Sheets[sheetName];
    const rawData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawData || rawData.length === 0) return { headers: [], rows: [] };

    let headerRowIdx = -1;
    let headers = [];

    for (let r = 0; r < Math.min(rawData.length, 15); r++) {
      const row = rawData[r];
      if (!Array.isArray(row)) continue;

      const matchingCols = row.filter(cell => {
        const str = String(cell || '').trim().toLowerCase();
        return str.length > 0 && str.length < 80 && headerKeywords.some(kw => str.includes(kw));
      });

      if (matchingCols.length >= 2) {
        headerRowIdx = r;
        headers = row.map(h => String(h || '').trim());
        break;
      }
    }

    if (headerRowIdx === -1) {
      return { headers: [], rows: [] };
    }

    const cleanRows = [];
    for (let r = headerRowIdx + 1; r < rawData.length; r++) {
      const row = rawData[r];
      if (!Array.isArray(row)) continue;

      const hasUserData = row.slice(0, 6).some(cell => {
        const str = String(cell || '').trim();
        return str !== '' && str !== '0' && str !== '-' && str !== 'Unknown' && !str.startsWith('©');
      });

      if (!hasUserData) continue;

      const rowObj = {};
      let hasValidKey = false;
      for (let c = 0; c < Math.min(headers.length, row.length); c++) {
        const headerName = headers[c];
        const cellValue = String(row[c] || '').trim();
        if (headerName && cellValue !== '') {
          rowObj[headerName] = cellValue;
          hasValidKey = true;
        }
      }

      if (hasValidKey) {
        cleanRows.push(rowObj);
      }
    }

    return {
      headers: headers.filter(Boolean),
      rows: cleanRows
    };
  }

  // ==========================================
  // 3. SMELTER EXTRACTION & CONFORMANCE EVALUATION
  // ==========================================
  function extractUniqueCidsFromSheet(sheet) {
    if (!sheet) return [];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const cidSet = new Set();
    const cidRegex = /CID\d{6}/i;

    for (let r = 3; r < rows.length; r++) {
      const row = rows[r];
      if (!Array.isArray(row)) continue;

      let foundCid = false;

      // A열 (Smelter Identification Number Input Column - 인덱스 0)
      const valA = String(row[0] || '').trim();
      const matchA = valA.match(cidRegex);
      if (matchA) {
        cidSet.add(matchA[0].toUpperCase());
        foundCid = true;
      }

      // F열 (Smelter Identification Look-up - 인덱스 5)
      const valF = String(row[5] || '').trim();
      const matchF = valF.match(cidRegex);
      if (matchF) {
        cidSet.add(matchF[0].toUpperCase());
        foundCid = true;
      }

      // C열 (Smelter Look-up - 인덱스 2) 미등재/미식별 예약어 검사
      if (!foundCid) {
        const valC = String(row[2] || '').trim();
        if (/smelter\s*not\s*yet\s*identified/i.test(valC)) {
          cidSet.add('Smelter not yet identified');
        } else if (/smelter\s*not\s*listed/i.test(valC)) {
          cidSet.add('Smelter not listed');
        }
      }
    }

    return Array.from(cidSet);
  }

  function evaluateSmelterConformance(cids, masterDb) {
    if (!cids || cids.length === 0) {
      return { status: 'Action Needed', issues: ['보고된 제련소(CID)가 없습니다.'] };
    }

    const issues = [];
    let hasNonConformantOrIdentified = false;
    let hasActive = false;
    let hasSanctioned = false;

    const idIdx = typeof getColIndex === 'function' ? getColIndex('cid') : 3;
    const nameIdx = typeof getColIndex === 'function' ? getColIndex('name') : 7;

    cids.forEach(item => {
      const cleanItem = String(item || '').trim();

      if (/^smelter\s*not\s*yet\s*identified$/i.test(cleanItem)) {
        issues.push('공급망 내 미식별 제련소 기재 (Smelter not yet identified)');
        hasNonConformantOrIdentified = true;
        return;
      }
      if (/^smelter\s*not\s*listed$/i.test(cleanItem)) {
        issues.push('RMI 미등재 제련소 기재 (Smelter not listed)');
        hasNonConformantOrIdentified = true;
        return;
      }

      const master = (masterDb || []).find(m => {
        const dbCid = String(m[idIdx] || m.cid || '').trim().toUpperCase();
        return dbCid === cleanItem.toUpperCase();
      });

      if (!master) {
        issues.push(`${cleanItem}: RMI Master DB에 등록되지 않은 제련소 (Unmatched)`);
        hasNonConformantOrIdentified = true;
        return;
      }

      const socVal = String(master._socs || master.soc || '').trim();
      if (socVal.startsWith('Y') || master.sanctioned === 'Sanctioned') {
        issues.push(`${cleanItem}: 제재 및 우려(SoCs) 대상 제련소`);
        hasSanctioned = true;
      }

      const status = master._rmap || master.ddStatus || 'Identified';
      if (status === 'Conformant') {
        // 정상 적합
      } else if (status === 'Active') {
        hasActive = true;
      } else {
        const facName = master[nameIdx] || master.standardName || 'Unknown';
        issues.push(`${cleanItem} (${facName}): ${status}`);
        hasNonConformantOrIdentified = true;
      }
    });

    let status = 'Action Needed';
    if (!hasSanctioned && !hasNonConformantOrIdentified) {
      status = hasActive ? 'All Conformant or Active' : 'All Conformant';
    }

    return {
      status: status,
      issues: issues
    };
  }

  // ==========================================
  // 4. DATA AGGREGATION & MASTER JOIN ENGINE
  // ==========================================
  /**
   * [서브탭 2] Smelters (All by vendor) 데이터 집계
   */
  function aggregateAllSmelters(submissions, activeProjectId, masterDb) {
    const slots = (submissions || []).filter(s => s['Project ID'] === activeProjectId && s['Status'] === 'Submitted');
    const db = masterDb || [];

    const idIdx = typeof getColIndex === 'function' ? getColIndex('cid') : 3;
    const metalIdx = typeof getColIndex === 'function' ? getColIndex('metal') : 2;
    const nameIdx = typeof getColIndex === 'function' ? getColIndex('name') : 7;
    const countryIdx = typeof getColIndex === 'function' ? getColIndex('country') : 8;
    const levelIdx = typeof getColIndex === 'function' ? getColIndex('level') : 5;

    const optSuppliers = new Set();
    const optStatuses = new Set();
    const optCahras = new Set();
    const optSocs = new Set();
    const optLevels = new Set();

    const rows = [];

    slots.forEach(slot => {
      const supplierLabel = slot['Company Name (Master)'] || slot['Company Name (Template)'] || 'Unknown';
      const cids = (slot['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);

      cids.forEach(cid => {
        const match = db.find(m => String(m[idIdx] || '').trim().toUpperCase() === cid.toUpperCase());
        const ddStatus = match ? (match._rmap || 'Identified') : 'Unmatched';
        const metal = match ? (match[metalIdx] || '-') : '-';
        const facName = resolveFacilityName(cid, match ? match[nameIdx] : null);
        const country = match ? (match[countryIdx] || '-') : '-';
        const cahra = match ? (match._cahra || '-') : '-';
        const socs = match ? (match._socs || '-') : '-';
        const level = match ? (match[levelIdx] || '-') : '-';

        optSuppliers.add(supplierLabel);
        optStatuses.add(ddStatus);
        optCahras.add(cahra);
        optSocs.add(socs);
        optLevels.add(level);

        rows.push({
          slotId: slot['Slot ID'],
          supplierLabel,
          metal,
          cid,
          ddStatus,
          cahra,
          socs,
          level,
          facName,
          country,
          cidHtml: formatCidBadge(cid),
          statusHtml: getStatusBadge(ddStatus),
          cahraHtml: getCahraBadge(cahra)
        });
      });
    });

    return {
      rows,
      filterOptions: {
        suppliers: optSuppliers,
        statuses: optStatuses,
        cahras: optCahras,
        socs: optSocs,
        levels: optLevels
      }
    };
  }

  /**
   * [서브탭 3] Smelters (Unique IDs) 중복제거 데이터 집계
   */
  function aggregateUniqueSmelters(submissions, activeProjectId, masterDb) {
    const slots = (submissions || []).filter(s => s['Project ID'] === activeProjectId && s['Status'] === 'Submitted');
    const db = masterDb || [];

    const idIdx = typeof getColIndex === 'function' ? getColIndex('cid') : 3;
    const metalIdx = typeof getColIndex === 'function' ? getColIndex('metal') : 2;
    const nameIdx = typeof getColIndex === 'function' ? getColIndex('name') : 7;
    const countryIdx = typeof getColIndex === 'function' ? getColIndex('country') : 8;
    const levelIdx = typeof getColIndex === 'function' ? getColIndex('level') : 5;

    const uniqueMap = new Map();

    slots.forEach(slot => {
      const supplierLabel = slot['Company Name (Master)'] || slot['Company Name (Template)'] || 'Unknown';
      const cids = (slot['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);

      cids.forEach(cid => {
        const uKey = cid.toUpperCase();
        if (!uniqueMap.has(uKey)) {
          uniqueMap.set(uKey, { rawCid: cid, suppliers: new Set() });
        }
        uniqueMap.get(uKey).suppliers.add(supplierLabel);
      });
    });

    const optSuppliers = new Set();
    const optStatuses = new Set();
    const optCahras = new Set();
    const optSocs = new Set();
    const optLevels = new Set();

    const rows = [];

    Array.from(uniqueMap.keys()).sort().forEach(uKey => {
      const entry = uniqueMap.get(uKey);
      const cid = entry.rawCid;
      const suppliersArr = Array.from(entry.suppliers);
      const suppliersText = suppliersArr.join(', ');

      const match = db.find(m => String(m[idIdx] || '').trim().toUpperCase() === uKey);
      const ddStatus = match ? (match._rmap || 'Identified') : 'Unmatched';
      const metal = match ? (match[metalIdx] || '-') : '-';
      const facName = resolveFacilityName(cid, match ? match[nameIdx] : null);
      const country = match ? (match[countryIdx] || '-') : '-';
      const cahra = match ? (match._cahra || '-') : '-';
      const socs = match ? (match._socs || '-') : '-';
      const level = match ? (match[levelIdx] || '-') : '-';

      suppliersArr.forEach(s => optSuppliers.add(s));
      optStatuses.add(ddStatus);
      optCahras.add(cahra);
      optSocs.add(socs);
      optLevels.add(level);

      rows.push({
        metal,
        cid,
        ddStatus,
        cahra,
        socs,
        level,
        facName,
        country,
        suppliersArr,
        suppliersText,
        cidHtml: formatCidBadge(cid),
        statusHtml: getStatusBadge(ddStatus),
        cahraHtml: getCahraBadge(cahra)
      });
    });

    return {
      rows,
      filterOptions: {
        suppliers: optSuppliers,
        statuses: optStatuses,
        cahras: optCahras,
        socs: optSocs,
        levels: optLevels
      }
    };
  }

  /**
   * [검증 모달] 단일 슬롯 제련소 상세 검증 데이터 행 매핑
   */
  function mapModalSmelterRows(cids, masterDb) {
    const db = masterDb || [];
    const idIdx = typeof getColIndex === 'function' ? getColIndex('cid') : 3;
    const metalIdx = typeof getColIndex === 'function' ? getColIndex('metal') : 2;
    const nameIdx = typeof getColIndex === 'function' ? getColIndex('name') : 7;
    const countryIdx = typeof getColIndex === 'function' ? getColIndex('country') : 8;
    const levelIdx = typeof getColIndex === 'function' ? getColIndex('level') : 5;

    return (cids || []).map(cid => {
      const match = db.find(m => String(m[idIdx] || '').trim().toUpperCase() === cid.toUpperCase());
      const ddStatus = match ? (match._rmap || 'Identified') : 'Unmatched';
      const cahraVal = match ? (match._cahra || '-') : '-';
      const socsVal = match ? (match._socs || '-') : '-';
      const levelVal = match ? (match[levelIdx] || '-') : '-';
      const metalVal = match ? (match[metalIdx] || '-') : '-';
      const facName = resolveFacilityName(cid, match ? match[nameIdx] : null);
      const countryVal = match ? (match[countryIdx] || '-') : '-';

      return {
        metal: metalVal,
        cid: cid,
        ddStatus: ddStatus,
        cahra: cahraVal,
        socs: socsVal,
        level: levelVal,
        facName: facName,
        country: countryVal,
        cidHtml: formatCidBadge(cid),
        statusHtml: getStatusBadge(ddStatus),
        cahraHtml: getCahraBadge(cahraVal)
      };
    });
  }

  // ==========================================
  // 5. CLIPBOARD FORMATTER ENGINE (Email Table & TSV)
  // ==========================================
  function buildEmailTableHtml(headers, rowsData) {
    let tableHtml = `<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse; font-family:'Pretendard','Inter',sans-serif,Arial; font-size:12px; color:#334155; border:1px solid #cbd5e1; width:100%;">
      <thead style="background-color:#f8fafc;">
        <tr>${headers.map(h => `<th style="border:1px solid #cbd5e1; padding:7px 8px; font-weight:600; color:#0f172a; text-align:center;">${h}</th>`).join('')}</tr>
      </thead>
      <tbody>`;

    rowsData.forEach((r, i) => {
      const bg = (i % 2 === 1) ? '#fafafa' : '#ffffff';
      tableHtml += `<tr style="background-color:${bg};">`;

      r.forEach((cellVal, colIdx) => {
        const header = headers[colIdx] || '';
        let align = 'center';
        let styleStr = 'border:1px solid #cbd5e1;';

        if (header.includes('Facility') || header.includes('Country') || header.includes('Vendor')) {
          align = 'left';
        }

        if (header === 'CID') {
          styleStr += ' font-family:monospace; color:#0284c7; font-weight:600;';
        } else if (header.includes('Status')) {
          let statusColor = (cellVal === 'Conformant') ? '#16a34a' : '#334155';
          styleStr += ` color:${statusColor}; font-weight:500;`;
        } else if (header === 'SoCs') {
          styleStr += cellVal.startsWith('Y') ? ' color:#dc2626; font-weight:600;' : ' color:#94a3b8;';
        }

        tableHtml += `<td style="${styleStr} text-align:${align};">${cellVal}</td>`;
      });

      tableHtml += `</tr>`;
    });

    tableHtml += '</tbody></table>';
    return tableHtml;
  }

  function buildTsvText(headers, rowsData) {
    let plain = headers.join('\t') + '\n';
    rowsData.forEach(r => {
      plain += r.join('\t') + '\n';
    });
    return plain;
  }

  // ==========================================
  // 6. UI BADGES & TEXT FORMATTERS
  // ==========================================
  function formatCidBadge(cid) {
    const clean = String(cid || '').trim();
    if (/^smelter\s*not\s*listed$/i.test(clean)) {
      return `<span class="clickable-cid" data-cid="Smelter not listed" onclick="copyTextToClipboard('Smelter not listed', this)" title="Smelter not listed">[NL]</span>`;
    }
    if (/^smelter\s*not\s*yet\s*identified$/i.test(clean)) {
      return `<span class="clickable-cid" data-cid="Smelter not yet identified" onclick="copyTextToClipboard('Smelter not yet identified', this)" title="Smelter not yet identified">[NYI]</span>`;
    }
    return `<span class="clickable-cid" data-cid="${clean}" onclick="copyTextToClipboard('${clean}', this)" title="Click to copy">${clean}</span>`;
  }

  function resolveFacilityName(cid, rawFacName) {
    const clean = String(cid || '').trim();
    if (/^smelter\s*not\s*listed$/i.test(clean)) return 'Smelter not listed';
    if (/^smelter\s*not\s*yet\s*identified$/i.test(clean)) return 'Smelter not yet identified';
    return rawFacName || 'Unregistered Facility';
  }

  function getStatusBadge(status) {
    const s = String(status || '').trim();
    if (s === 'Conformant') return '<span style="color:#16a34a; font-weight:500;">Conformant</span>';
    if (s === 'Removed') return '<span style="color:#dc2626; font-weight:500;">Removed</span>';
    if (s === 'Active') return '<span style="color:#0284c7; font-weight:500;">Active</span>';
    return `<span style="color:#334155; font-weight:400;">${s || '-'}</span>`;
  }

  function getCahraBadge(cahra) {
    const c = String(cahra || '').trim();
    if (!c || c === '-') return '<span style="color:#94a3b8;">-</span>';
    return `<span style="color:#334155; font-weight:400;">${c}</span>`;
  }

  // ==========================================
  // 7. UTILITIES
  // ==========================================
  function findSheetName(workbook, candidates) {
    return workbook.SheetNames.find(name => {
      const lower = name.toLowerCase().trim();
      return candidates.some(c => lower.includes(c.toLowerCase()));
    });
  }

  function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary);
  }

  /**
   * 날짜 문자열 정제 함수 (시간/타임존 제거 -> YYYY-MM-DD 또는 원본 일자 형식 유지)
   */
  function cleanDateString(rawDate) {
    if (!rawDate) return '-';
    const str = String(rawDate).trim();
    if (!str) return '-';

    // 14-Sep-2026 형태는 그대로 반환
    if (/^\d{1,2}-[A-Za-z]{3}-\d{4}$/.test(str)) {
      return str;
    }

    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    }

    return str.split(' GMT')[0].split('T')[0];
  }

  // ==========================================
  // 8. OFFICIAL RMI TEMPLATE 1:1 INSPECTION RENDERER
  // ==========================================
  /**
   * 공식 RMI 양식 1:1 매핑 상세 검증 뷰 HTML 렌더러
   * @param {Object} slot - Submissions 시트 슬롯 메타
   * @param {Object} slotBackup - JSON 백업본 (summary, backup, fileInfo)
   * @returns {string} 완성된 HTML 문자열
   */
  function renderMrtInspectionHtml(slot, slotBackup) {
    const backup = slotBackup?.backup || {};
    const declRows = Array.isArray(backup.declaration) ? backup.declaration : [];
    const products = Array.isArray(backup.productList) ? backup.productList : [];
    const summary = slotBackup?.summary || {};
    const templateVer = slot['Template Version'] || summary.templateVersion || '-';

    // -------------------------------------------------------------
    // [섹션 1] Company Information 14개 공식 필드 정밀 추출
    // -------------------------------------------------------------
    const getFieldVal = (labelRegex) => {
      for (let r = 0; r < declRows.length; r++) {
        const row = declRows[r];
        if (!Array.isArray(row)) continue;
        for (let c = 0; c < row.length; c++) {
          const cell = String(row[c] || '').trim();
          if (labelRegex.test(cell)) {
            for (let nextC = c + 1; nextC < row.length; nextC++) {
              const val = String(row[nextC] || '').trim();
              if (val && !val.startsWith('(*)') && !labelRegex.test(val)) {
                return val;
              }
            }
          }
        }
      }
      return '';
    };

    const companyInfoFields = [
      { label: 'Company Name (*):', val: getFieldVal(/^company\s*name\s*\(\*\):?$/i) || slot['Company Name (Template)'] || summary.companyNameTemplate || '-' },
      { label: 'Declaration Scope or Class (*):', val: getFieldVal(/^declaration\s*scope\s*or\s*class\s*\(\*\):?$/i) || summary.scopeClass || '-' },
      { label: 'Description of Scope:', val: getFieldVal(/^description\s*of\s*scope:?$/i) || '-' },
      { label: 'Company Unique ID:', val: getFieldVal(/^company\s*unique\s*id:?$/i) || '-' },
      { label: 'Company Unique ID Authority:', val: getFieldVal(/^company\s*unique\s*id\s*authority:?$/i) || '-' },
      { label: 'Address:', val: getFieldVal(/^address:?$/i) || '-' },
      { label: 'Contact Name (*):', val: getFieldVal(/^contact\s*name\s*\(\*\):?$/i) || '-' },
      { label: 'Email – Contact (*):', val: getFieldVal(/^email\s*[–-]\s*contact\s*\(\*\):?$/i) || '-' },
      { label: 'Phone – Contact (*):', val: getFieldVal(/^phone\s*[–-]\s*contact\s*\(\*\):?$/i) || '-' },
      { label: 'Authorizer (*):', val: getFieldVal(/^authorizer\s*\(\*\):?$/i) || '-' },
      { label: 'Title - Authorizer:', val: getFieldVal(/^title\s*[–-]\s*authorizer:?$/i) || '-' },
      { label: 'Email - Authorizer (*):', val: getFieldVal(/^email\s*[–-]\s*authorizer\s*\(\*\):?$/i) || '-' },
      { label: 'Phone - Authorizer:', val: getFieldVal(/^phone\s*[–-]\s*authorizer:?$/i) || '-' },
      { label: 'Effective Date (*):', val: cleanDateString(getFieldVal(/^effective\s*date\s*\(\*\):?$/i)) }
    ];

    let companyInfoHtml = '';
    companyInfoFields.forEach(f => {
      const valStr = f.val === '' ? '-' : f.val;
      companyInfoHtml += `
        <div style="display:flex; padding:5px 0; border-bottom:1px solid #f1f5f9; font-size:0.77rem;">
          <span style="width:230px; min-width:230px; font-weight:600; color:#475569;">${f.label}</span>
          <span style="flex:1; color:#0f172a; word-break:break-all;">${valStr}</span>
        </div>
      `;
    });

    // -------------------------------------------------------------
    // [섹션 2] Due Diligence Q&A (헤더 위치 기반 100% 동적 추출 엔진)
    // -------------------------------------------------------------
    const mineralQuestions = [];
    const companyQuestions = [];

    let currentMineralQ = null;
    let parsingCompanyLevel = false;

    let ansColIdx = -1;
    let commColIdx = -1;

    for (let r = 0; r < declRows.length; r++) {
      const row = declRows[r];
      if (!Array.isArray(row) || row.length === 0) continue;

      for (let c = 0; c < row.length; c++) {
        const val = String(row[c] || '').trim().toLowerCase();
        if (val === 'answer') ansColIdx = c;
        if (val === 'comments' || val === 'comment') commColIdx = c;
      }

      const nonEmpties = row.map((v, idx) => ({ val: String(v || '').trim(), idx: idx })).filter(item => item.val !== '');
      if (nonEmpties.length === 0) continue;

      const firstCell = nonEmpties[0].val;

      if (/answer\s*the\s*following\s*questions\s*at\s*a\s*company\s*level|company\s*level\s*questions/i.test(firstCell)) {
        if (currentMineralQ) {
          mineralQuestions.push(currentMineralQ);
          currentMineralQ = null;
        }
        parsingCompanyLevel = true;
        continue;
      }

      if (!parsingCompanyLevel) {
        const qNumMatch = firstCell.match(/^(\d+[\.\)])\s*(.+)/);
        if (qNumMatch) {
          if (currentMineralQ) {
            mineralQuestions.push(currentMineralQ);
          }
          currentMineralQ = {
            title: firstCell,
            minerals: []
          };
          continue;
        }

        if (currentMineralQ) {
          const alphaCheck = firstCell.match(/^([A-J][\.\)])\s*(.+)/i);
          if (alphaCheck) {
            mineralQuestions.push(currentMineralQ);
            currentMineralQ = null;
            parsingCompanyLevel = true;
            r--;
            continue;
          }

          let mineralLabel = '';
          const targetAnsCol = (ansColIdx >= 0) ? ansColIdx : 1;
          const targetCommCol = (commColIdx >= 0) ? commColIdx : targetAnsCol + 1;

          for (let c = targetAnsCol - 1; c >= 0; c--) {
            const cellStr = String(row[c] || '').trim();
            if (cellStr && !/^(mineral\s*\/\s*metal|answer|comments|\d+[\.\)])$/i.test(cellStr)) {
              if (cellStr.length < 50 && (cellStr.includes('(*)') || /^[A-Za-z\s\(\)\-\/]+$/.test(cellStr))) {
                mineralLabel = cellStr;
                break;
              }
            }
          }

          const rawAns = String(row[targetAnsCol] || '').trim();
          const rawComm = (targetCommCol >= 0 && row[targetCommCol] !== undefined) ? String(row[targetCommCol] || '').trim() : '';

          if (mineralLabel && rawAns && !/^(answer|comments)$/i.test(rawAns)) {
            currentMineralQ.minerals.push({
              name: mineralLabel,
              answer: rawAns || '-',
              comments: rawComm || '-'
            });
          }
        }
      } else {
        const alphaMatch = firstCell.match(/^([A-J][\.\)])\s*(.+)/i);
        if (alphaMatch) {
          const qText = firstCell;
          let ans = '-';
          let comm = '-';

          const isInvalidValue = (val) => {
            if (!val || val === '-' || val === '0') return true;
            if (/^\d{1,4}$/.test(val)) return true;
            if (/change\s*drop\s*down\s*menu/i.test(val)) return true;
            if (/^(answer|comments?|yes\s*\/\s*no)$/i.test(val)) return true;
            return false;
          };

          const targetAnsCol = (ansColIdx >= 0) ? ansColIdx : 1;
          const targetCommCol = (commColIdx >= 0) ? commColIdx : targetAnsCol + 1;

          let rawAns = (row[targetAnsCol] !== undefined) ? String(row[targetAnsCol]).trim() : '';
          let rawComm = (targetCommCol >= 0 && row[targetCommCol] !== undefined) ? String(row[targetCommCol]).trim() : '';

          if (!isInvalidValue(rawAns)) {
            ans = rawAns;
          }

          if (!isInvalidValue(rawComm)) {
            comm = rawComm;
          }

          if (ans === '-' || isInvalidValue(ans)) {
            for (let i = 1; i < nonEmpties.length; i++) {
              const itemVal = nonEmpties[i].val;
              if (isInvalidValue(itemVal)) continue;

              if (/^(yes|no|unknown)/i.test(itemVal)) {
                ans = itemVal;
                for (let j = i + 1; j < nonEmpties.length; j++) {
                  const candidateComm = nonEmpties[j].val;
                  if (!isInvalidValue(candidateComm) && candidateComm !== ans) {
                    comm = candidateComm;
                    break;
                  }
                }
                break;
              }
            }
          }

          if (comm === '-' || isInvalidValue(comm)) {
            for (let i = 1; i < nonEmpties.length; i++) {
              const itemVal = nonEmpties[i].val;
              if (!isInvalidValue(itemVal) && itemVal !== ans) {
                comm = itemVal;
                break;
              }
            }
          }

          companyQuestions.push({
            qText: qText,
            answer: ans,
            comments: isInvalidValue(comm) ? '-' : comm
          });
        }
      }
    }

    if (currentMineralQ) {
      mineralQuestions.push(currentMineralQ);
    }

    let mineralQuestionsHtml = '';
    mineralQuestions.forEach(q => {
      let mineralRowsHtml = '';
      q.minerals.forEach(m => {
        mineralRowsHtml += `
          <tr>
            <td style="padding:6px 8px; color:#334155; border-bottom:1px solid #f1f5f9;">${m.name}</td>
            <td style="padding:6px 8px; text-align:center; color:#0f172a; font-weight:600; border-bottom:1px solid #f1f5f9;">${m.answer}</td>
            <td style="padding:6px 8px; color:#64748b; font-size:0.75rem; border-bottom:1px solid #f1f5f9;">${m.comments}</td>
          </tr>
        `;
      });

      mineralQuestionsHtml += `
        <div style="margin-bottom:12px; border:1px solid #e2e8f0; border-radius:6px; overflow:hidden;">
          <div style="background:#f8fafc; padding:7px 10px; font-size:0.78rem; font-weight:600; color:#0f172a; border-bottom:1px solid #e2e8f0;">
            ${q.title}
          </div>
          <table style="width:100%; border-collapse:collapse; font-size:0.77rem;">
            <thead>
              <tr style="background:#ffffff; color:#64748b; font-size:0.71rem; text-transform:uppercase; border-bottom:1px solid #f1f5f9;">
                <th style="padding:5px 8px; text-align:left; width:35%;">Mineral / Metal</th>
                <th style="padding:5px 8px; text-align:center; width:20%;">Answer</th>
                <th style="padding:5px 8px; text-align:left; width:45%;">Comments</th>
              </tr>
            </thead>
            <tbody>
              ${mineralRowsHtml || '<tr><td colspan="3" style="padding:8px; text-align:center; color:#94a3b8;">No response</td></tr>'}
            </tbody>
          </table>
        </div>
      `;
    });

    let companyQuestionsHtml = '';
    companyQuestions.forEach(cq => {
      companyQuestionsHtml += `
        <div style="padding:8px 0; border-bottom:1px dashed #e2e8f0; font-size:0.76rem;">
          <div style="font-weight:500; color:#1e293b; margin-bottom:4px;">${cq.qText}</div>
          <div style="display:flex; align-items:center; gap:12px; padding-left:8px;">
            <span style="font-weight:600; color:#0f172a;">${cq.answer}</span>
            ${cq.comments !== '-' ? `<span style="color:#64748b; font-size:0.74rem;">(${cq.comments})</span>` : ''}
          </div>
        </div>
      `;
    });

    // -------------------------------------------------------------
    // [섹션 3] Product List (공식 헤더 5개 열 1:1 일치)
    // -------------------------------------------------------------
    let productsRowsHtml = '';
    if (products.length > 0) {
      products.slice(0, 100).forEach((p, idx) => {
        const respNum = p['Responder Product Number (*)'] || p['Responder Product Number'] || p.itemNumber || '-';
        const respName = p['Responder Product Name'] || p.itemName || '-';
        const reqNum = p['Requester Product Number'] || p.reqItemNumber || '-';
        const reqName = p['Requester Product Name'] || p.reqItemName || '-';
        const comments = p['Comments'] || p.comments || '-';

        productsRowsHtml += `
          <tr>
            <td style="text-align:center; padding:5px 4px; font-size:0.74rem; color:#64748b; border-bottom:1px solid #f1f5f9;">${idx + 1}</td>
            <td style="padding:5px 8px; font-family:var(--font-mono); font-size:0.74rem; color:#0f172a; font-weight:600; border-bottom:1px solid #f1f5f9;">${respNum}</td>
            <td style="padding:5px 8px; font-size:0.74rem; color:#334155; border-bottom:1px solid #f1f5f9;">${respName}</td>
            <td style="padding:5px 8px; font-family:var(--font-mono); font-size:0.74rem; color:#334155; border-bottom:1px solid #f1f5f9;">${reqNum}</td>
            <td style="padding:5px 8px; font-size:0.74rem; color:#334155; border-bottom:1px solid #f1f5f9;">${reqName}</td>
            <td style="padding:5px 8px; font-size:0.73rem; color:#64748b; border-bottom:1px solid #f1f5f9;">${comments}</td>
          </tr>
        `;
      });
      if (products.length > 100) {
        productsRowsHtml += `<tr><td colspan="6" style="text-align:center; padding:8px; font-size:0.74rem; color:#94a3b8; font-style:italic;">Showing first 100 parts out of ${products.length} registered parts.</td></tr>`;
      }
    } else {
      productsRowsHtml = `<tr><td colspan="6" style="text-align:center; padding:16px; color:#94a3b8; font-size:0.76rem;">No item rows registered in Product List sheet (Completion required only if reporting level "Product" selected).</td></tr>`;
    }

    // -------------------------------------------------------------
    // 최종 HTML 조립
    // -------------------------------------------------------------
    return `
      <div style="display:flex; flex-direction:column; gap:14px; font-family:'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;">
        
        <!-- 1. Company Information -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #cbd5e1; padding-bottom:8px;">
            <strong style="font-size:0.88rem; color:#0f172a; text-transform:uppercase;">Company Information</strong>
            <span style="font-size:0.74rem; font-family:var(--font-mono); color:#0284c7; background:#e0f2fe; padding:2px 8px; border-radius:4px; font-weight:600;">${templateVer}</span>
          </div>
          <div style="display:flex; flex-direction:column;">
            ${companyInfoHtml}
          </div>
        </div>

        <!-- 2. Due Diligence Questions (광물별 1~8번) -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
          <strong style="display:block; font-size:0.88rem; color:#0f172a; margin-bottom:10px; text-transform:uppercase;">Due Diligence Questions</strong>
          <div style="display:flex; flex-direction:column;">
            ${mineralQuestionsHtml || '<div style="color:#94a3b8; font-size:0.75rem; padding:10px;">No mineral question responses found.</div>'}
          </div>
        </div>

        <!-- 3. Answer the Following Questions at a Company Level (Questions A ~ H) -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
          <strong style="display:block; font-size:0.88rem; color:#0f172a; margin-bottom:8px; text-transform:uppercase;">Answer the Following Questions at a Company Level</strong>
          <div style="display:flex; flex-direction:column;">
            ${companyQuestionsHtml || '<div style="color:#94a3b8; font-size:0.75rem; padding:10px;">No company-level question responses found.</div>'}
          </div>
        </div>

        <!-- 4. Product List -->
        <div style="background:#ffffff; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <strong style="font-size:0.88rem; color:#0f172a; text-transform:uppercase;">Product List</strong>
            <span style="font-size:0.75rem; font-weight:600; color:#64748b;">Total: ${products.length} item(s)</span>
          </div>
          <div style="max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px;">
            <table class="data-table" style="width:100%; table-layout:fixed; font-size:0.75rem; border-collapse:collapse;">
              <colgroup>
                <col style="width: 5%;">
                <col style="width: 22%;">
                <col style="width: 25%;">
                <col style="width: 18%;">
                <col style="width: 18%;">
                <col style="width: 12%;">
              </colgroup>
              <thead style="background:#f8fafc; position:sticky; top:0; z-index:1;">
                <tr style="border-bottom:1px solid #cbd5e1; color:#475569;">
                  <th style="text-align:center; padding:6px 4px;">No.</th>
                  <th style="text-align:left; padding:6px 8px;">Responder Product Number (*)</th>
                  <th style="text-align:left; padding:6px 8px;">Responder Product Name</th>
                  <th style="text-align:left; padding:6px 8px;">Requester Product Number</th>
                  <th style="text-align:left; padding:6px 8px;">Requester Product Name</th>
                  <th style="text-align:left; padding:6px 8px;">Comments</th>
                </tr>
              </thead>
              <tbody>
                ${productsRowsHtml}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;
  }

  // ==========================================
  // 9. SNAPSHOT & AUDIT DIFF ENGINE
  // ==========================================
  /**
   * Completed 전환 시점의 프로젝트 전체 스냅샷 생성
   * @param {Object} project - 프로젝트 메타 객체
   * @param {Array} submissions - 해당 프로젝트에 속한 submissions 슬롯 배열
   * @param {Array} masterDb - 현재 브라우저 메모리의 RMI 제련소 마스터 DB
   * @param {string} completedBy - 완료 처리자명
   * @param {string} harvestDate - 기준 RMI 마스터 Harvest 일시 문자열
   * @returns {Object} snapshot 객체
   */
  function buildProjectSnapshot(project, submissions, masterDb, completedBy, harvestDate) {
    const projectId = project['Project ID'];
    const now = new Date();
    const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (9 * 3600000));
    const pad = n => String(n).padStart(2, '0');
    const completedAt = `${kst.getFullYear()}-${pad(kst.getMonth() + 1)}-${pad(kst.getDate())} ${pad(kst.getHours())}:${pad(kst.getMinutes())}:${pad(kst.getSeconds())} KST`;

    const allAggregated = aggregateAllSmelters(submissions, projectId, masterDb);
    const uniqueAggregated = aggregateUniqueSmelters(submissions, projectId, masterDb);

    // 슬롯별 제련소 검증 모달용 스냅샷 매핑
    const slotSmeltersMap = {};
    (submissions || []).filter(s => s['Project ID'] === projectId).forEach(s => {
      const cids = (s['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);
      slotSmeltersMap[s['Slot ID']] = mapModalSmelterRows(cids, masterDb);
    });

    const projectSlots = (submissions || []).filter(s => s['Project ID'] === projectId);

    return {
      completedAt: completedAt,
      completedDate: `${kst.getFullYear()}-${pad(kst.getMonth() + 1)}-${pad(kst.getDate())}`,
      completedBy: completedBy || 'Admin',
      masterHarvestDate: harvestDate || 'Current Harvest',
      summary: {
        totalSlots: projectSlots.length,
        submittedSlots: projectSlots.filter(s => s['Status'] === 'Submitted').length,
        totalSmelters: allAggregated.rows.length,
        uniqueSmelters: uniqueAggregated.rows.length
      },
      allSmelters: allAggregated.rows,
      uniqueSmelters: uniqueAggregated.rows,
      slotSmelters: slotSmeltersMap
    };
  }

  /**
   * 스냅샷 Unique 제련소와 최신 RMI Master DB 간의 인라인 Diff 연산 (취소선/줄바꿈 방식)
   * @param {Array} snapshotUniqueRows - 스냅샷에 저장된 Unique 제련소 행 배열
   * @param {Array} masterDb - 현재 브라우저 메모리의 RMI 제련소 마스터 DB
   * @returns {Array} Diff 정보가 추가된 행 배열
   */
  function compareUniqueSmeltersDiff(snapshotUniqueRows, masterDb) {
    const db = masterDb || [];
    const idIdx = typeof getColIndex === 'function' ? getColIndex('cid') : 3;

    return (snapshotUniqueRows || []).map(r => {
      const uKey = String(r.cid || '').trim().toUpperCase();
      const match = db.find(m => String(m[idIdx] || '').trim().toUpperCase() === uKey);

      const liveStatus = match ? (match._rmap || 'Identified') : 'Unmatched';
      const liveCahra = match ? (match._cahra || '-') : '-';
      const liveSocs = match ? (match._socs || '-') : '-';

      const statusChanged = (r.ddStatus !== liveStatus);
      const cahraChanged = (r.cahra !== liveCahra);
      const socsChanged = (r.socs !== liveSocs);

      const isChanged = statusChanged || cahraChanged || socsChanged;

 // 과거 값이 '-' 또는 빈값인 경우 '(None)'으로 치환하여 취소선 식별력 확보
      const formatOldVal = val => (!val || val === '-') ? '(None)' : val;

      // 1. DD Status: 변동 시 <s><em>과거</em></s><br>신규
      let diffStatusHtml = r.statusHtml;
      if (statusChanged) {
        diffStatusHtml = `<s><em>${formatOldVal(r.ddStatus)}</em></s><br>${getStatusBadge(liveStatus)}`;
      }

      // 2. CAHRA Basis: 변동 시 <s><em>과거</em></s><br>신규
      let diffCahraHtml = r.cahraHtml;
      if (cahraChanged) {
        diffCahraHtml = `<s><em>${formatOldVal(r.cahra)}</em></s><br>${getCahraBadge(liveCahra)}`;
      }

      // 3. SoCs: 변동 시 <s><em>과거</em></s><br>신규
      let diffSocsHtml = r.socs.startsWith('Y') 
        ? `<span style="color:#dc2626; font-weight:600;">${r.socs}</span>` 
        : `<span style="color:#94a3b8;">${r.socs || '-'}</span>`;
      if (socsChanged) {
        const liveSocsFormatted = liveSocs.startsWith('Y') 
          ? `<span style="color:#dc2626; font-weight:600;">${liveSocs}</span>` 
          : `<span style="color:#475569;">${liveSocs || '-'}</span>`;
        diffSocsHtml = `<s><em>${formatOldVal(r.socs)}</em></s><br>${liveSocsFormatted}`;
      }

      return Object.assign({}, r, {
        isChanged: isChanged,
        liveStatus: liveStatus,
        liveCahra: liveCahra,
        liveSocs: liveSocs,
        diffStatusHtml: diffStatusHtml,
        diffCahraHtml: diffCahraHtml,
        diffSocsHtml: diffSocsHtml
      });
    });
  }

  // ==========================================
  // Public Interface
  // ==========================================
  return {
    parseMrtFile: parseMrtFile,
    detectTemplateAndVersion: detectTemplateAndVersion,
    aggregateAllSmelters: aggregateAllSmelters,
    aggregateUniqueSmelters: aggregateUniqueSmelters,
    mapModalSmelterRows: mapModalSmelterRows,
    buildEmailTableHtml: buildEmailTableHtml,
    buildTsvText: buildTsvText,
    formatCidBadge: formatCidBadge,
    resolveFacilityName: resolveFacilityName,
    getStatusBadge: getStatusBadge,
    getCahraBadge: getCahraBadge,
    renderMrtInspectionHtml: renderMrtInspectionHtml,
    buildProjectSnapshot: buildProjectSnapshot,
    compareUniqueSmeltersDiff: compareUniqueSmeltersDiff
  };
})();