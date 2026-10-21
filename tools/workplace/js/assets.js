/**
 * a2MDS Assets Module - Family Wealth, Cashflow & Real Assets Analytics Engine
 * Sub-Tabs: 고정비용 (Default) | 월별자산현황 | 오피스텔 | 자동차
 * Features: Sheets SSoT Direct Viewer, Dropdown Filters with Blank(-) Support, 
 *           Interactive Multi-Line Chart, Real-Estate 4-Year Summary Chart (Option 1 Layout),
 *           Descending Date Sorting for History Tables, Global .col-multiline & .kpi-card Engine Integrated
 */

const ASSETS_API_URL = window.APP_CONFIG?.ASSETS_API_URL || 'https://script.google.com/macros/s/AKfycbxH-IZXtuaSPWKimEHBilRjiMcXA4ntQkfBAjDXeOvEPV1EzfxtWkvMzvQw3SGbynn1tg/exec';

let assetsState = {
  currentSubTab: 'fixed', // 'fixed' | 'monthly' | 'officetel' | 'car'
  isLoaded: false,
  data: {
    fixed: { headers: [], rows: [] },
    monthly: { headers: [], rows: [] },
    officetel: { headers: [], rows: [] },
    officetel_summary: { headers: [], rows: [] },
    car: { headers: [], rows: [] },
    principles: { headers: [], rows: [] }
  },
  filters: {
    fixed: {},
    monthly: {},
    officetel: {},
    car: {}
  },
  pagination: {
    fixed: { page: 1, pageSize: 50 },
    monthly: { page: 1, pageSize: 50 },
    officetel: { page: 1, pageSize: 50 },
    car: { page: 1, pageSize: 50 }
  }
};

const ASSETS_TAB_MAP = {
  fixed: { key: 'fixed', sheetName: '고정비용', label: '📌 Fixed Costs' },
  monthly: { key: 'monthly', sheetName: '월별자산현황', label: '📊 Monthly Balance' },
  officetel: { key: 'officetel', sheetName: '오피스텔', label: '🏢 Rent' },
  car: { key: 'car', sheetName: '자동차', label: '🚗 Car' }
};

// -------------------------------------------------------------
// 0. 인증 헬퍼 및 진입점
// -------------------------------------------------------------
function getAssetsAuthKey() {
  const key = (typeof getStoredAuthKey === 'function') ? getStoredAuthKey() : '';
  if (!key) {
    document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
  }
  return key;
}

// 상단 현황 섹션 토글 헬퍼 (Compliance 양식 일치)
function toggleAssetsFixedSummary() {
  const body = document.getElementById('assetsFixedSummaryBody');
  const icon = document.getElementById('assetsFixedSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'grid' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function toggleAssetsOfficetelSummary() {
  const body = document.getElementById('assetsOfficetelSummaryBody');
  const icon = document.getElementById('assetsOfficetelSummaryToggleIcon');
  if (!body) return;
  const isHidden = body.style.display === 'none';
  body.style.display = isHidden ? 'grid' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

function initAssetsModule(forceReload = false) {
  const container = document.getElementById('assets-module');
  if (!container) return;

  if (!container.hasChildNodes() || forceReload) {
    renderAssetsBase(container);
  }

  if (assetsState.isLoaded && !forceReload) {
    renderActiveTab();
  } else {
    loadAssetsData();
  }
}

// -------------------------------------------------------------
// 1. 기본 레이아웃 구성
// -------------------------------------------------------------
function renderAssetsBase(container) {
  container.innerHTML = `
    <!-- Sub Tabs & 스프레드시트 원본 바로가기 -->
    <div class="smelter-sub-tabs-wrapper" style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
      <div class="smelter-sub-tabs">
        <button type="button" class="smelter-sub-tab-btn active" id="btnAssetsTabFixed" onclick="switchAssetsSubTab('fixed')">📌 Fixed Costs</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnAssetsTabMonthly" onclick="switchAssetsSubTab('monthly')">📊 Monthly Balance</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnAssetsTabOfficetel" onclick="switchAssetsSubTab('officetel')">🏢 Rent</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnAssetsTabCar" onclick="switchAssetsSubTab('car')">🚗 Car</button>
      </div>
      <div style="padding-right: 4px;">
        <a href="https://docs.google.com/spreadsheets/d/1AquazUhKmcucxibRiihA4uFF9bhu7JUQzfKO5_i80Bc/edit#gid=0" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" title="Google Sheets 원본 열기">
          📊 View Data ↗
        </a>
      </div>
    </div>

    <!-- SUB-PANE 1: 고정비용 -->
    <div id="assetsSubPaneFixed" class="smelter-sub-pane active">
      <div id="assetsFixedSummaryCard" class="summary-section" style="margin-bottom: 14px;"></div>
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Fixed Costs <span class="viewer-badge" id="assetsFixedBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetAssetsFilters('fixed')">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="assetsFixedTable" style="table-layout: fixed; width: 100%; min-width: 900px; font-size: 0.78rem;">
            <thead>
              <tr id="assetsFixedTableHeadRow"></tr>
              <tr id="assetsFixedTableFilterRow"></tr>
            </thead>
            <tbody id="assetsFixedTableBody"></tbody>
          </table>
        </div>
        <div class="pagination-bar" id="assetsFixedPaginationBar"></div>
      </div>
    </div>

    <!-- SUB-PANE 2: 월별자산현황 -->
    <div id="assetsSubPaneMonthly" class="smelter-sub-pane" style="display: none;">
      <div id="assetsMonthlySummaryCard" style="margin-bottom: 14px;"></div>
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Monthly Asset Overview <span class="viewer-badge" id="assetsMonthlyBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetAssetsFilters('monthly')">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="assetsMonthlyTable" style="table-layout: fixed; width: 100%; min-width: 1050px; font-size: 0.78rem;">
            <thead>
              <tr id="assetsMonthlyTableHeadRow"></tr>
              <tr id="assetsMonthlyTableFilterRow"></tr>
            </thead>
            <tbody id="assetsMonthlyTableBody"></tbody>
          </table>
        </div>
        <div class="pagination-bar" id="assetsMonthlyPaginationBar"></div>
      </div>
    </div>

    <!-- SUB-PANE 3: 오피스텔 -->
    <div id="assetsSubPaneOfficetel" class="smelter-sub-pane" style="display: none;">
      <div id="assetsOfficetelSummaryCard" class="summary-section" style="margin-bottom: 14px;"></div>
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Property Cash Flow <span class="viewer-badge" id="assetsOfficetelBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetAssetsFilters('officetel')">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="assetsOfficetelTable" style="table-layout: fixed; width: 100%; min-width: 900px; font-size: 0.78rem;">
            <thead>
              <tr id="assetsOfficetelTableHeadRow"></tr>
              <tr id="assetsOfficetelTableFilterRow"></tr>
            </thead>
            <tbody id="assetsOfficetelTableBody"></tbody>
          </table>
        </div>
        <div class="pagination-bar" id="assetsOfficetelPaginationBar"></div>
      </div>
    </div>

    <!-- SUB-PANE 4: 자동차 -->
    <div id="assetsSubPaneCar" class="smelter-sub-pane" style="display: none;">
      <div id="assetsCarSummaryCard" class="summary-section" style="margin-bottom: 14px;"></div>
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Vehicle Maintenance Log <span class="viewer-badge" id="assetsCarBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetAssetsFilters('car')">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="assetsCarTable" style="table-layout: fixed; width: 100%; min-width: 800px; font-size: 0.78rem;">
            <thead>
              <tr id="assetsCarTableHeadRow"></tr>
              <tr id="assetsCarTableFilterRow"></tr>
            </thead>
            <tbody id="assetsCarTableBody"></tbody>
          </table>
        </div>
        <div class="pagination-bar" id="assetsCarPaginationBar"></div>
      </div>
    </div>
  `;
}

// -------------------------------------------------------------
// 2. 백엔드 데이터 조회 & 정규화
// -------------------------------------------------------------
async function loadAssetsData() {
  const authKey = getAssetsAuthKey();
  if (!authKey) return;

  try {
    const res = await fetch(ASSETS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'getAssetsData' })
    });
    const json = await res.json();

    if (json.status === 'auth_failed') {
      if (typeof clearStoredAuthKey === 'function') clearStoredAuthKey();
      document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
      return;
    }

    if (json.success && json.data) {
      const sAssets = json.data.assets || json.data || {};

      assetsState.data.fixed = sAssets.FIXED || sAssets.fixed || { headers: [], rows: [] };
      assetsState.data.monthly = sAssets.MONTHLY || sAssets.monthly || { headers: [], rows: [] };
      assetsState.data.officetel = sAssets.OFFICETEL || sAssets.officetel || { headers: [], rows: [] };
      assetsState.data.officetel_summary = sAssets.OFFICETEL_SUMMARY || sAssets.officetel_summary || { headers: [], rows: [] };
      assetsState.data.car = sAssets.CAR || sAssets.car || { headers: [], rows: [] };
      assetsState.data.principles = sAssets.PRINCIPLES || sAssets.principles || { headers: [], rows: [] };

      assetsState.isLoaded = true;
      renderActiveTab();
    }
  } catch (err) {
    console.error('Failed to load assets data:', err);
  }
}

// -------------------------------------------------------------
// 3. 서브탭 전환 핸들러
// -------------------------------------------------------------
function switchAssetsSubTab(tabKey) {
  assetsState.currentSubTab = tabKey;

  Object.keys(ASSETS_TAB_MAP).forEach(k => {
    const capKey = k.charAt(0).toUpperCase() + k.slice(1);
    const btn = document.getElementById(`btnAssetsTab${capKey}`);
    const pane = document.getElementById(`assetsSubPane${capKey}`);
    if (btn && pane) {
      if (k === tabKey) {
        btn.classList.add('active');
        pane.style.display = 'block';
      } else {
        btn.classList.remove('active');
        pane.style.display = 'none';
      }
    }
  });

  renderActiveTab();
}

function renderActiveTab() {
  const tab = assetsState.currentSubTab;
  if (tab === 'fixed') {
    renderFixedSummary();
    renderTabTable('fixed', 'assetsFixed', [
      { col: '구분', width: '65px', align: 'center' },
      { col: '지불자', width: '75px', align: 'center', isDropdown: true },
      { col: '대상', width: '75px', align: 'center', isDropdown: true },
      { col: '사용처', width: '180px', align: 'left', isMultiline: true },
      { col: '분류', width: '80px', align: 'center', isDropdown: true },
      { col: '금액', width: '100px', align: 'right', isNumber: true },
      { col: '결제방식', width: '80px', align: 'center', isDropdown: true },
      { col: '메모', width: 'auto', align: 'left', isMultiline: true }
    ], ['활성여부'], false);
  } else if (tab === 'monthly') {
    renderMonthlySummary();
    renderTabTable('monthly', 'assetsMonthly', [
      { col: '년-월', width: '82px', align: 'center' },
      { col: '현금 추가', width: '58px', align: 'right', isFloat: true },
      { col: '인출', width: '52px', align: 'right', isFloat: true },
      { col: '투자원금', width: '60px', align: 'right', isFloat: true },
      { col: '투자금액', width: '60px', align: 'right', isFloat: true },
      { col: '평가금액', width: '60px', align: 'right', isFloat: true },
      { col: '평가손익', width: '60px', align: 'right', isFloat: true },
      { col: '실현손익', width: '60px', align: 'right', isFloat: true },
      { col: '누적손익', width: '60px', align: 'right', isFloat: true },
      { col: '잔고(계좌)', width: '68px', align: 'right', isFloat: true },
      { col: '잔고(누계)', width: '68px', align: 'right', isFloat: true },
      { col: '투자 노트', width: 'auto', align: 'left', isMultiline: true }
    ], [], true);
  } else if (tab === 'officetel') {
    renderOfficetelSummary();
    renderTabTable('officetel', 'assetsOfficetel', [
      { col: '날짜', width: '95px', align: 'center' },
      { col: '호실', width: '80px', align: 'center', isDropdown: true },
      { col: '임차인', width: '90px', align: 'center', isDropdown: true },
      { col: '항목(1)', width: '80px', align: 'center', isDropdown: true },
      { col: '항목(2)', width: '160px', align: 'left', isDropdown: true },
      { col: '비용', width: '105px', align: 'right', isNumber: true },
      { col: '상세', width: 'auto', align: 'left', isMultiline: true }
    ], [], true);
  } else if (tab === 'car') {
    renderCarSummary();
    renderTabTable('car', 'assetsCar', [
      { col: '날짜', width: '105px', align: 'center' },
      { col: '차량', width: '150px', align: 'center', isDropdown: true },
      { col: '마일리지(km)', width: '120px', align: 'right', isNumber: true },
      { col: '이력', width: 'auto', align: 'left', isMultiline: true }
    ], [], true);
  }
}

// -------------------------------------------------------------
// 4. 유틸리티 함수
// -------------------------------------------------------------
function parseNum(val) {
  if (typeof val === 'number') return val;
  if (!val) return 0;
  const clean = String(val).replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
}

function cleanFloat(val) {
  if (val === null || val === undefined || val === '') return '-';
  const n = parseNum(val);
  if (isNaN(n)) return String(val);
  return String(parseFloat(n.toFixed(2)));
}

function formatKmOrNumber(val) {
  if (val === null || val === undefined || val === '') return '-';
  const clean = String(val).trim();
  if (clean === '???') return '???';
  const n = parseNum(clean);
  return n.toLocaleString('ko-KR');
}

// -------------------------------------------------------------
// 5. 상단 요약 카드 & 인터랙티브 그래프 엔진 (.kpi-card & 볼드 라벨 적용)
// -------------------------------------------------------------

// (1) 고정비용 상단 요약
function renderFixedSummary() {
  const container = document.getElementById('assetsFixedSummaryCard');
  if (!container) return;

  const rows = (assetsState.data.fixed.rows || []).filter(r => String(r['활성여부'] || 'Y').toUpperCase() === 'Y');
  let expTotal = 0, incTotal = 0;
  let jpExp = 0, jennyExp = 0;
  let allTarget = 0, jpTarget = 0, jennyTarget = 0, simonTarget = 0;

  rows.forEach(r => {
    const amt = parseNum(r['금액']);
    const type = String(r['구분'] || '').trim();
    const payer = String(r['지불자'] || '').trim();
    const target = String(r['대상'] || '').trim();

    if (type === '수입') {
      incTotal += amt;
    } else {
      expTotal += amt;
      if (payer === 'JP') jpExp += amt;
      if (payer === 'Jenny') jennyExp += amt;

      if (target === 'All') allTarget += amt;
      else if (target === 'JP') jpTarget += amt;
      else if (target === 'Jenny') jennyTarget += amt;
      else if (target === 'Simon') simonTarget += amt;
    }
  });

  const netFixed = incTotal - expTotal;

  container.innerHTML = `
    <div class="summary-header" style="cursor: pointer; user-select: none; margin-bottom: 0;" onclick="toggleAssetsFixedSummary()">
      <h3 class="summary-title">
        <span>🏷️ 고정비용 현금흐름 요약</span>
        <span id="assetsFixedSummaryToggleIcon" style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px; transition: transform 0.2s ease;">▼</span>
      </h3>
    </div>
    <div class="kpi-grid" id="assetsFixedSummaryBody" style="display: none; margin-top: 14px;">
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-card-title" style="font-size: 0.82rem; font-weight: 700; color: #334155;">월 고정지출 (Expense)</span>
        </div>
        <div class="kpi-card-value kpi-val-red">₩${expTotal.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">Jenny: ₩${jennyExp.toLocaleString('ko-KR')} | JP: ₩${jpExp.toLocaleString('ko-KR')}</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-card-title" style="font-size: 0.82rem; font-weight: 700; color: #334155;">월 고정수입 (Income)</span>
        </div>
        <div class="kpi-card-value kpi-val-green">₩${incTotal.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">메디팰리스 602호 &amp; 904호 월세</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-card-title" style="font-size: 0.82rem; font-weight: 700; color: #334155;">순 고정 유출 (수입 - 지출)</span>
        </div>
        <div class="kpi-card-value ${netFixed >= 0 ? 'kpi-val-green' : 'kpi-val-blue'}">₩${netFixed.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">실제 가계 순부담액</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-card-header">
          <span class="kpi-card-title" style="font-size: 0.82rem; font-weight: 700; color: #334155;">대상별 지출 비중</span>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; margin-top: 8px;">
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
            <span style="color: var(--text-muted); font-weight: 600;">공통</span>
            <strong style="color: var(--text-main); font-weight: 700;">₩${allTarget.toLocaleString('ko-KR')}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
            <span style="color: var(--text-muted); font-weight: 600;">JP</span>
            <strong style="color: var(--text-main); font-weight: 700;">₩${jpTarget.toLocaleString('ko-KR')}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
            <span style="color: var(--text-muted); font-weight: 600;">Jenny</span>
            <strong style="color: var(--text-main); font-weight: 700;">₩${jennyTarget.toLocaleString('ko-KR')}</strong>
          </div>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 0.74rem;">
            <span style="color: var(--text-muted); font-weight: 600;">Simon</span>
            <strong style="color: var(--text-main); font-weight: 700;">₩${simonTarget.toLocaleString('ko-KR')}</strong>
          </div>
        </div>
      </div>
    </div>
  `;
}

// (2) 월별자산현황 상단: 차트 압축(약 58%) + 우측 투자원칙 2열 구조(약 42%)
function renderMonthlySummary() {
  const container = document.getElementById('assetsMonthlySummaryCard');
  if (!container) return;

  const allRows = assetsState.data.monthly.rows || [];
  if (allRows.length === 0) {
    container.innerHTML = `<div style="padding: 16px; color: #94a3b8;">월별자산현황 데이터가 존재하지 않습니다.</div>`;
    return;
  }

  // --- [A. 좌측 차트: 가로폭 압축(540px)으로 변동성 높낮이 극대화] ---
  const rows12 = allRows.slice(-12);
  const labels = rows12.map(r => String(r['년-월'] || '').replace('20', '').trim());

  const series = [
    { key: '실현손익', label: '실현손익', color: '#10b981', isDashed: true, width: 1.2, vals: rows12.map(r => parseNum(r['실현손익'])) },
    { key: '누적손익', label: '누적손익', color: '#f59e0b', isDashed: false, width: 1.5, vals: rows12.map(r => parseNum(r['누적손익'])) },
    { key: '잔고(계좌)', label: '잔고(계좌)', color: '#06b6d4', isDashed: false, width: 1.6, vals: rows12.map(r => parseNum(r['잔고(계좌)'])) },
    { key: '잔고(누계)', label: '잔고(누적)', color: '#3b82f6', isDashed: true, width: 1.2, vals: rows12.map(r => parseNum(r['잔고(누계)'])) }
  ];

  let minVal = 0;
  let maxVal = 1;
  series.forEach(s => {
    s.vals.forEach(v => {
      if (v < minVal) minVal = v;
      if (v > maxVal) maxVal = v;
    });
  });
  maxVal = Math.ceil(maxVal * 1.15);
  if (minVal < 0) minVal = Math.floor(minVal * 1.15);

  const w = 540, h = 230;
  const padLeft = 45, padRight = 18, padTop = 15, padBottom = 28;
  const chartW = w - padLeft - padRight;
  const chartH = h - padTop - padBottom;

  const getX = (idx) => padLeft + (chartW / (labels.length - 1 || 1)) * idx;
  const getY = (val) => padTop + chartH - ((val - minVal) / ((maxVal - minVal) || 1)) * chartH;

  let gridLines = '';
  for (let i = 0; i <= 4; i++) {
    const val = minVal + ((maxVal - minVal) / 4) * i;
    const y = getY(val);
    const valInEok = (val / 10).toFixed(1);
    gridLines += `
      <line x1="${padLeft}" y1="${y}" x2="${w - padRight}" y2="${y}" stroke="#e2e8f0" stroke-width="1" stroke-dasharray="3,3" />
      <text x="${padLeft - 6}" y="${y + 3}" text-anchor="end" font-size="9.5" fill="#94a3b8">${valInEok}억</text>
    `;
  }

  const xLabels = labels.map((lbl, idx) => `
    <text x="${getX(idx)}" y="${h - 8}" text-anchor="middle" font-size="9" font-weight="500" fill="#64748b">${lbl}</text>
  `).join('');

  let paths = '';
  let points = '';
  series.forEach(s => {
    const coords = s.vals.map((v, idx) => ({ x: getX(idx), y: getY(v), val: v, month: labels[idx] }));
    const d = coords.map((c, i) => (i === 0 ? `M ${c.x} ${c.y}` : `L ${c.x} ${c.y}`)).join(' ');
    const strokeDash = s.isDashed ? 'stroke-dasharray="3,3"' : '';

    paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width}" ${strokeDash} stroke-linecap="round" stroke-linejoin="round" />`;

    coords.forEach(c => {
      points += `
        <circle cx="${c.x}" cy="${c.y}" r="2.8" fill="#ffffff" stroke="${s.color}" stroke-width="${s.width}" class="chart-point">
          <title>${c.month} [${s.label}]: ${(c.val / 10).toFixed(2)}억</title>
        </circle>
      `;
    });
  });

  const legendHtml = series.map(s => `
    <div style="display: flex; align-items: center; gap: 4px; font-size: 0.70rem; font-weight: 600; color: #475569;">
      <span style="display: inline-block; width: 12px; height: ${s.isDashed ? '2px' : '3px'}; border-radius: 2px; background: ${s.color}; ${s.isDashed ? 'border-top: 2px dashed ' + s.color : ''}"></span>
      ${s.label}
    </div>
  `).join('');

  // --- [B. 우측 투자원칙: [타이틀 좌측 : 세부사항 우측] 2열 슬림 그리드] ---
  const principleRows = assetsState.data.principles.rows || [];
  const groupedPrinciples = {};

  principleRows.forEach(r => {
    const title = String(r['Title'] || '').trim();
    const desc = String(r['Description'] || '').trim();
    if (!title && !desc) return;
    if (!groupedPrinciples[title]) groupedPrinciples[title] = [];
    if (desc) groupedPrinciples[title].push(desc);
  });

  let principlesRowsHtml = '';
  const groupEntries = Object.entries(groupedPrinciples);

  if (groupEntries.length === 0) {
    principlesRowsHtml = `<div style="font-size: 0.78rem; color: #94a3b8; text-align: center; padding: 30px 0;">등록된 투자원칙 데이터가 없습니다.</div>`;
  } else {
    principlesRowsHtml = groupEntries.map(([title, descList]) => `
      <div style="display: flex; align-items: stretch; background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 6px; overflow: hidden; min-height: 48px;">
        <!-- 좌측: 타이틀 라벨 (고정 너비 & 중앙 정렬) -->
        <div style="width: 140px; min-width: 140px; background: #f1f5f9; border-right: 1px solid var(--border-gray); padding: 6px 10px; display: flex; align-items: center; font-size: 0.76rem; font-weight: 700; color: #1e293b; line-height: 1.3;">
          ${title}
        </div>
        <!-- 우측: 세부사항 목록 -->
        <div style="flex: 1; padding: 6px 12px; display: flex; flex-direction: column; justify-content: center; gap: 3px; font-size: 0.75rem; color: #334155; line-height: 1.35;">
          ${descList.map(d => `<div>• ${d}</div>`).join('')}
        </div>
      </div>
    `).join('');
  }

  // --- [C. 1.4fr : 1fr 비율로 단정하게 분할 배치] ---
  container.innerHTML = `
    <div style="display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; align-items: stretch;">
      <!-- 좌측: 차트 패널 -->
      <div style="background: #ffffff; border: 1px solid var(--border-gray); border-radius: 8px; padding: 12px 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; justify-content: space-between;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; flex-wrap: wrap; gap: 8px;">
          <h3 class="summary-title" style="margin: 0; font-size: 0.86rem;"><span>📈 최근 12개월 손익 및 자산 추이 (단위: 억)</span></h3>
          <div style="display: flex; gap: 8px; flex-wrap: wrap;">
            ${legendHtml}
          </div>
        </div>
        <div style="width: 100%; overflow-x: auto;">
          <svg viewBox="0 0 ${w} ${h}" style="width: 100%; height: auto; min-width: 440px; max-height: 220px; display: block;">
            ${gridLines}
            ${paths}
            ${points}
            ${xLabels}
          </svg>
        </div>
      </div>

      <!-- 우측: 투자원칙 4개 항목 균등 카드 (헤더 없이 꽉 채움) -->
      <div style="background: #ffffff; border: 1px solid var(--border-gray); border-radius: 8px; padding: 10px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); display: flex; flex-direction: column; justify-content: space-between; gap: 6px;">
        ${principlesRowsHtml}
      </div>
    </div>
  `;
}

// (3) 오피스텔 최신 4개년 (높낮이 증폭 막대 + 텍스트 인라인 요약)
function renderOfficetelSummary() {
  const container = document.getElementById('assetsOfficetelSummaryCard');
  if (!container) return;

  const summaryData = assetsState.data.officetel_summary?.rows || [];
  const rows4 = summaryData.slice(-4);

  if (rows4.length === 0) {
    container.innerHTML = `
      <div style="padding: 14px; background: #ffffff; border: 1px solid var(--border-gray); border-radius: 6px; color: #64748b; font-size: 0.8rem;">
        🏢 <strong>오피스텔_요약</strong> 시트 데이터를 집계 중이거나 불러오는 중입니다.
      </div>
    `;
    return;
  }

  let minCost = Infinity;
  let maxIncome = 0;
  rows4.forEach(r => {
    const inc = parseNum(r['Income']);
    const exp = parseNum(r['Expense(General)']) + parseNum(r['Expense(Interest)']);
    if (exp < minCost) minCost = exp;
    if (inc > maxIncome) maxIncome = inc;
  });
  const baseline = Math.floor(minCost * 0.65);

  const yearCardsHtml = rows4.map(r => {
    const year = r['Year'] || '-';
    const inc = parseNum(r['Income']);
    const expGen = parseNum(r['Expense(General)']);
    const expInt = parseNum(r['Expense(Interest)']);
    const totalExp = expGen + expInt;
    const net = parseNum(r['Net Income']);
    const roi = r['RoI'] ? (typeof r['RoI'] === 'number' ? (r['RoI'] * 100).toFixed(2) + '%' : String(r['RoI'])) : '-';
    const loan = parseNum(r['Outstanding Loan Balance']);

    const incRatio = Math.max(0.25, Math.min(0.95, (inc - baseline) / (maxIncome - baseline || 1)));
    const expRatio = Math.max(0.25, Math.min(0.95, (totalExp - baseline) / (maxIncome - baseline || 1)));

    const incHeightPct = Math.round(incRatio * 100);
    const expHeightPct = Math.round(expRatio * 100);

    return `
      <div class="kpi-card" style="padding: 10px 12px;">
        <div>
          <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #f1f5f9; padding-bottom: 4px; margin-bottom: 6px;">
            <span style="font-size: 0.92rem; font-weight: 700; color: var(--text-main);">${year}년</span>
            <span style="font-size: 0.72rem; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 1px 6px; border-radius: 4px;">RoI: ${roi}</span>
          </div>
          
          <div style="height: 65px; display: flex; align-items: flex-end; gap: 14px; margin: 8px 0 10px 0; padding-bottom: 4px; border-bottom: 1px solid #e2e8f0;">
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
              <div style="width: 100%; background: #22c55e; height: ${incHeightPct}%; border-radius: 3px 3px 0 0;" title="수입: ₩${inc.toLocaleString('ko-KR')}"></div>
              <div style="font-size: 0.65rem; color: #16a34a; font-weight: 600; margin-top: 3px;">수입</div>
            </div>
            <div style="flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end;">
              <div style="width: 100%; background: #ef4444; height: ${expHeightPct}%; border-radius: 3px 3px 0 0;" title="총비용: ₩${totalExp.toLocaleString('ko-KR')}"></div>
              <div style="font-size: 0.65rem; color: #dc2626; font-weight: 600; margin-top: 3px;">지출</div>
            </div>
          </div>

          <div style="font-size: 0.72rem; color: #64748b; line-height: 1.5;">
            <div style="display: flex; justify-content: space-between; border-bottom: 1px dashed #f1f5f9; padding-bottom: 3px;">
              <span>수입: <strong class="kpi-val-green">₩${inc.toLocaleString('ko-KR')}</strong></span>
              <span>지출: <strong class="kpi-val-red">₩${totalExp.toLocaleString('ko-KR')}</strong></span>
            </div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
              <span>순수익:</span> 
              <strong class="kpi-val-blue" style="font-size: 0.8rem;">₩${net.toLocaleString('ko-KR')}</strong>
            </div>
          </div>
        </div>

        <div style="margin-top: 8px; background: #f8fafc; padding: 5px 8px; border-radius: 4px; font-size: 0.72rem; color: #64748b; display: flex; justify-content: space-between; align-items: center;">
          <span>대출잔액</span>
          <strong style="color: #334155;">₩${loan.toLocaleString('ko-KR')}</strong>
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="summary-header" style="cursor: pointer; user-select: none; margin-bottom: 0;" onclick="toggleAssetsOfficetelSummary()">
      <h3 class="summary-title">
        <span>🏢 메디팰리스 4개년 종합 손익 현황</span>
        <span id="assetsOfficetelSummaryToggleIcon" style="font-size: 0.75rem; color: var(--text-muted); margin-left: 6px; transition: transform 0.2s ease;">▼</span>
      </h3>
    </div>
    <div id="assetsOfficetelSummaryBody" style="display: none; margin-top: 14px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px;">
      ${yearCardsHtml}
    </div>
  `;
}

// (4) 자동차 상단 요약
function renderCarSummary() {
  const container = document.getElementById('assetsCarSummaryCard');
  if (!container) return;

  const rows = assetsState.data.car.rows || [];
  const carMap = {};

  rows.forEach(r => {
    const carName = String(r['차량'] || '').trim();
    if (!carMap[carName]) {
      carMap[carName] = { latestMileage: '-', latestHistory: '-', latestDate: '-' };
    }
    if (r['마일리지(km)']) {
      carMap[carName].latestMileage = formatKmOrNumber(r['마일리지(km)']);
    }
    carMap[carName].latestHistory = r['이력'] || '-';
    carMap[carName].latestDate = r['날짜'] || '-';
  });

  const cardsHtml = Object.entries(carMap).map(([car, info]) => `
    <div class="kpi-card">
      <div class="kpi-card-header">
        <span class="kpi-card-title" style="font-size: 0.82rem; font-weight: 700; color: #334155;">🚗 ${car}</span>
      </div>
      <div class="kpi-card-value kpi-val-main">${info.latestMileage} km</div>
      <div class="kpi-card-sub" title="${info.latestHistory}">
        최근(${info.latestDate}): ${info.latestHistory}
      </div>
    </div>
  `).join('');

  container.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <h3 class="summary-title"><span>🏷️ 차량별 정비 이력</span></h3>      
    </div>
    <div class="kpi-grid" style="grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));">
      ${cardsHtml || '<div style="color: #94a3b8; font-size: 0.8rem;">등록된 차량 데이터가 없습니다.</div>'}
    </div>
  `;
}

// -------------------------------------------------------------
// 6. 공통 동적 테이블 렌더링 (CSS 클래스 .col-multiline 표준 연동)
// -------------------------------------------------------------
function renderTabTable(tabKey, domPrefix, colConfigs = [], excludeCols = [], sortDescending = false) {
  const tableData = assetsState.data[tabKey];
  const allHeaders = tableData.headers || [];
  const headers = allHeaders.filter(h => !excludeCols.includes(h));
  let rows = [...(tableData.rows || [])];

  if (sortDescending) {
    rows.reverse();
  }

  const filters = assetsState.filters[tabKey] || {};
  const p = assetsState.pagination[tabKey];

  const theadRow = document.getElementById(`${domPrefix}TableHeadRow`);
  const filterRow = document.getElementById(`${domPrefix}TableFilterRow`);
  const tbody = document.getElementById(`${domPrefix}TableBody`);
  const badge = document.getElementById(`${domPrefix}BadgeCount`);
  const paginationBar = document.getElementById(`${domPrefix}PaginationBar`);

  if (!theadRow || !filterRow || !tbody) return;

  const configMap = {};
  colConfigs.forEach(c => configMap[c.col] = c);

  // 헤더 렌더링
  theadRow.innerHTML = headers.map(h => {
    const conf = configMap[h] || { width: 'auto', align: 'left' };
    return `<th style="width: ${conf.width}; text-align: ${conf.align};">${h}</th>`;
  }).join('');

  // 필터 행 렌더링
  filterRow.innerHTML = headers.map(h => {
    const conf = configMap[h] || {};
    const curVal = filters[h] || '';

    if (conf.isDropdown) {
      const uniqueVals = new Set();
      let hasBlank = false;

      rows.forEach(r => {
        const raw = r[h];
        if (raw === undefined || raw === null || String(raw).trim() === '') {
          hasBlank = true;
        } else {
          uniqueVals.add(String(raw).trim());
        }
      });

      const sortedVals = Array.from(uniqueVals).sort((a, b) => a.localeCompare(b, 'ko-KR'));
      let optHtml = `<option value="">All</option>`;

      if (hasBlank) {
        optHtml += `<option value="__BLANK__" ${curVal === '__BLANK__' ? 'selected' : ''}>- (공란)</option>`;
      }

      sortedVals.forEach(v => {
        optHtml += `<option value="${v}" ${curVal === v ? 'selected' : ''}>${v}</option>`;
      });

      return `
        <th class="filter-th">
          <select class="filter-input" onchange="onAssetsFilterChange('${tabKey}', '${h}', this.value)" style="padding: 2px 2px; font-size: 0.72rem; width: 100%; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff;">
            ${optHtml}
          </select>
        </th>
      `;
    } else {
      return `
        <th class="filter-th">
          <input type="text" class="filter-input" placeholder="${h}..." value="${curVal}" oninput="onAssetsFilterChange('${tabKey}', '${h}', this.value)" style="padding: 2px 3px; font-size: 0.72rem; width: 100%;">
        </th>
      `;
    }
  }).join('');

  // 필터링 적용
  const filteredRows = rows.filter(r => {
    for (const [col, filterVal] of Object.entries(filters)) {
      if (!filterVal) continue;
      const rawCell = r[col];
      const isCellBlank = rawCell === undefined || rawCell === null || String(rawCell).trim() === '';

      if (filterVal === '__BLANK__') {
        if (!isCellBlank) return false;
      } else {
        const conf = configMap[col] || {};
        if (conf.isDropdown) {
          if (String(rawCell || '').trim() !== filterVal) return false;
        } else {
          const cellVal = String(rawCell || '').toLowerCase();
          if (!cellVal.includes(String(filterVal).toLowerCase())) return false;
        }
      }
    }
    return true;
  });

  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filteredRows.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  if (pagedRows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${headers.length}" style="text-align: center; padding: 24px; color: #94a3b8;">No records found.</td></tr>`;
  } else {
    tbody.innerHTML = pagedRows.map(r => {
      const cells = headers.map(h => {
        const conf = configMap[h] || { align: 'left' };
        let rawVal = r[h];
        let val = rawVal !== undefined && rawVal !== null ? String(rawVal) : '-';

        if (conf.isFloat && val !== '-' && val !== '') {
          val = cleanFloat(val);
        }

        if (conf.isNumber && val !== '-' && val !== '') {
          val = formatKmOrNumber(val);
        }

        // 전용 클래스 .col-multiline 적용
        if (conf.isMultiline) {
          return `<td class="col-multiline" title="${val.replace(/"/g, '&quot;')}">${val}</td>`;
        }

        const alignCls = conf.align === 'center' ? 'cell-center' : (conf.align === 'right' ? 'cell-right' : '');
        return `<td class="${alignCls}" title="${val.replace(/"/g, '&quot;')}">${val}</td>`;
      }).join('');

      return `<tr>${cells}</tr>`;
    }).join('');
  }

  // 페이지네이션 바
  if (paginationBar) {
    paginationBar.innerHTML = `
      <div style="display: flex; align-items: center; gap: 6px;">
        <span>Show</span>
        <select class="filter-input" onchange="changeAssetsPageSize('${tabKey}', this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
          <option value="25" ${p.pageSize === 25 ? 'selected' : ''}>25</option>
          <option value="50" ${p.pageSize === 50 ? 'selected' : ''}>50</option>
          <option value="100" ${p.pageSize === 100 ? 'selected' : ''}>100</option>
        </select>
        <span>per page</span>
      </div>
      <div style="display: flex; align-items: center; gap: 10px;">
        <button type="button" class="btn-act" ${p.page <= 1 ? 'disabled' : ''} onclick="goToAssetsPage('${tabKey}', ${p.page - 1})" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
        <span style="font-weight: 500; color: var(--text-main);">Page ${p.page} of ${totalPages}</span>
        <button type="button" class="btn-act" ${p.page >= totalPages ? 'disabled' : ''} onclick="goToAssetsPage('${tabKey}', ${p.page + 1})" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
      </div>
    `;
  }
}

function onAssetsFilterChange(tabKey, col, val) {
  assetsState.filters[tabKey][col] = val.trim();
  assetsState.pagination[tabKey].page = 1;
  renderActiveTab();
}

function resetAssetsFilters(tabKey) {
  assetsState.filters[tabKey] = {};
  assetsState.pagination[tabKey].page = 1;
  renderActiveTab();
}

function goToAssetsPage(tabKey, targetPage) {
  assetsState.pagination[tabKey].page = targetPage;
  renderActiveTab();
}

function changeAssetsPageSize(tabKey, newSize) {
  assetsState.pagination[tabKey].pageSize = parseInt(newSize, 10) || 50;
  assetsState.pagination[tabKey].page = 1;
  renderActiveTab();
}

// Window 전역 export
window.initAssetsModule = initAssetsModule;
window.loadAssetsData = loadAssetsData;
window.switchAssetsSubTab = switchAssetsSubTab;
window.toggleAssetsFixedSummary = toggleAssetsFixedSummary;
window.toggleAssetsOfficetelSummary = toggleAssetsOfficetelSummary;
window.onAssetsFilterChange = onAssetsFilterChange;
window.resetAssetsFilters = resetAssetsFilters;
window.goToAssetsPage = goToAssetsPage;
window.changeAssetsPageSize = changeAssetsPageSize;