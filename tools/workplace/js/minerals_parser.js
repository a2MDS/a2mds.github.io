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

      const trimmedRow = row.map(v => (v !== null && v !== undefined ? String(v).trim() : '')).filter(Boolean);
      if (trimmedRow.length > 0) {
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
          let statusColor = '#475569';
          if (cellVal === 'Conformant') statusColor = '#16a34a';
          else if (cellVal === 'Active') statusColor = '#0284c7';
          else if (cellVal === 'Removed' || cellVal === 'Unmatched') statusColor = '#dc2626';
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
    if (s === 'Active') return '<span style="color:#0284c7; font-weight:500;">Active</span>';
    if (s === 'Removed') return '<span style="color:#dc2626; font-weight:500;">Removed</span>';
    if (s === 'Unmatched') return '<span style="color:#dc2626; font-weight:500;">Unmatched</span>';
    return `<span style="color:#475569; font-weight:400;">${s || '-'}</span>`;
  }

  function getCahraBadge(cahra) {
    const c = String(cahra || '').trim();
    if (c === 'EU & US') return '<span style="color:#dc2626; font-weight:500;">EU & US</span>';
    if (c === 'EU CAHRA') return '<span style="color:#059669; font-weight:500;">EU CAHRA</span>';
    if (c === 'US Dodd-Frank') return '<span style="color:#7c3aed; font-weight:500;">US Dodd-Frank</span>';
    if (c === 'User-defined') return '<span style="color:#0284c7; font-weight:500;">User-defined</span>';
    return '<span style="color:#94a3b8;">-</span>';
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
    getCahraBadge: getCahraBadge
  };
})();