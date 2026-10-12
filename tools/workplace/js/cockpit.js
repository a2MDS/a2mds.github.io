/**
 * a2MDS Cockpit Module - Finance, Dashboard, Fixed Costs & Tax Filing Engine
 * Default Financial Records Active View,
 * Integrated Dashboard by Type & Category with Click-to-Filter Navigation,
 * Read-only Fixed Costs Ledger with In-Table Hyperlinks (Sheets SSoT Aligned),
 * Direct Google Sheets 'View Data' Integration,
 * Synchronized Interactive Income Tax Strategy Simulation Engine
 */

const COCKPIT_API_URL = window.APP_CONFIG?.COCKPIT_API_URL || 'https://script.google.com/macros/s/AKfycbxwPeAGqxjvBHPRF0S4zrXKOJ-luwhdJk7yFAMYqbDAhS4LR_7s11XWbXM62wERlQkn2A/exec';

let cockpitState = {
  finance: [],
  fixedCosts: [],
  currentSubTab: 'finance', // 기본 탭: Financial Records
  dashboardYear: String(new Date().getFullYear()),
  isLoaded: false,
  financeFilters: {},
  finPagination: { page: 1, pageSize: 50 },
  taxPeriod: '',
  taxInputs: {
    revenue: 43000000,
    actualExpense: 3000000,
    healthInsurance: 420000,
    baseExpenseRate: 16,
    dedPersonal: 1500000,
    dedYellow: 5000000,
    dedNps: 1600000,
    pensionSavings: 6000000
  }
};

// 보안 토큰 조회 및 인증 오버레이 헬퍼
function getCockpitAuthKey() {
  const key = (typeof getStoredAuthKey === 'function') ? getStoredAuthKey() : '';
  if (!key) {
    document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
  }
  return key;
}

// 모듈 진입점
function initCockpitModule(forceReload = false) {
  const container = document.getElementById('cockpit-module');
  if (!container) return;

  if (!cockpitState.isLoaded || forceReload) {
    renderCockpitBase(container);
    loadCockpitData();
  }
}

// 1. 기본 레이아웃 구성
function renderCockpitBase(container) {
  container.innerHTML = `
    <!-- Sub Tabs & 외부 연결 링크 (Calendar & View Data) -->
    <div class="smelter-sub-tabs-wrapper" style="margin-top: 4px; display: flex; justify-content: space-between; align-items: center;">
      <div class="smelter-sub-tabs">
        <button type="button" class="smelter-sub-tab-btn active" id="btnCockpitTabFinance" onclick="switchCockpitSubTab('finance')">📋 Financial Records</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabDashboard" onclick="switchCockpitSubTab('dashboard')">📊 Dashboard</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabFixed" onclick="switchCockpitSubTab('fixed')">📌 Fixed Costs</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabTax" onclick="switchCockpitSubTab('tax')">💰 Tax Filing</button>
      </div>
      <div style="padding-right: 4px; display: flex; align-items: center; gap: 6px;">
        <a href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" title="Open Google Calendar in new tab">
          📅 Calendar ↗
        </a>
        <a href="https://docs.google.com/spreadsheets/u/0/d/1jm0-PzwiHWIAuUM8PLUWBOs562ruGltmf5hBLZszZyc/edit?usp=drive_fs" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" title="Google Sheets 원본 열기">
          📊 View Data ↗
        </a>
      </div>
    </div>

    <!-- SUB-PANE 1: Finance Ledger (읽기/조회 전용) -->
    <div id="cockpitSubPaneFinance" class="smelter-sub-pane active">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title"> Master Index <span class="viewer-badge" id="finBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetFinanceFilters()">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitFinanceTable" style="table-layout: fixed; width: 100%; min-width: 980px; font-size: 0.76rem;">
            <thead>
              <tr>
                <th style="width: 90px; min-width: 90px; white-space: nowrap; overflow: visible;">Date</th>
                <th style="width: 48px; min-width: 48px; text-align: center; white-space: nowrap; overflow: visible;">Type</th>
                <th style="width: 78px; min-width: 78px; white-space: nowrap; overflow: visible;">Category</th>
                <th style="width: 130px; min-width: 130px; white-space: nowrap; overflow: visible;">Client</th>
                <th style="width: 105px; min-width: 105px; white-space: nowrap; overflow: visible;">Transaction</th>
                <th style="min-width: 140px;">Description</th>
                <th style="width: 78px; min-width: 78px; text-align: center; white-space: nowrap; overflow: visible;">Tax_Type</th>
                <th style="width: 65px; min-width: 65px; text-align: right; white-space: nowrap; overflow: visible;">Total($)</th>
                <th style="width: 92px; min-width: 92px; text-align: right; white-space: nowrap; overflow: visible;">Total(₩)</th>
                <th style="width: 88px; min-width: 88px; text-align: right; white-space: nowrap; overflow: visible;">Supply</th>
                <th style="width: 78px; min-width: 78px; text-align: right; white-space: nowrap; overflow: visible;">Tax</th>
              </tr>
              <tr id="finTableFilterRow">
                <th class="filter-th"><input type="text" id="filterFinDate" class="filter-input" placeholder="Date..." oninput="onFinFilterChange('date', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 1px;"><select id="filterFinType" class="filter-input" onchange="onFinFilterChange('type', this.value)" style="padding: 2px; font-size: 0.73rem;"><option value="">All</option></select></th>
                <th class="filter-th" style="padding: 1px;"><select id="filterFinCategory" class="filter-input" onchange="onFinFilterChange('category', this.value)" style="padding: 2px; font-size: 0.73rem;"><option value="">All</option></select></th>
                <th class="filter-th" style="padding: 1px;"><select id="filterFinClient" class="filter-input" onchange="onFinFilterChange('client', this.value)" style="padding: 2px; font-size: 0.73rem;"><option value="">All</option></select></th>
                <th class="filter-th" style="padding: 1px;"><select id="filterFinTransaction" class="filter-input" onchange="onFinFilterChange('transaction', this.value)" style="padding: 2px; font-size: 0.73rem;"><option value="">All</option></select></th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Description..." oninput="onFinFilterChange('description', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 1px;"><select id="filterFinTaxType" class="filter-input" onchange="onFinFilterChange('taxType', this.value)" style="padding: 2px; font-size: 0.73rem;"><option value="">All</option></select></th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="$..." oninput="onFinFilterChange('usd', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="₩..." oninput="onFinFilterChange('krw', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"></th>
                <th class="filter-th"></th>
              </tr>
            </thead>
            <tbody id="cockpitFinanceTableBody"></tbody>
          </table>
        </div>

        <!-- Finance Pagination Footer -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid var(--border-gray, #e2e8f0); font-size: 0.78rem; color: var(--text-muted, #64748b);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>Show</span>
            <select id="finPageSizeSelect" class="filter-input" onchange="changeFinPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button type="button" class="btn-act" id="btnFinPrevPage" onclick="goToFinPage(cockpitState.finPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="finPageInfoDisplay" style="font-weight: 500; color: var(--text-main, #1e293b);">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnFinNextPage" onclick="goToFinPage(cockpitState.finPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 2: Dashboard -->
    <div id="cockpitSubPaneDashboard" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title"> Financial Status &amp; Category Breakdown</div>
          <div class="viewer-actions" style="display: flex; align-items: center; gap: 8px;">
            <label style="font-size: 0.80rem; font-weight: 600; color: var(--text-muted, #64748b);">Year Filter:</label>
            <select id="cockpitDashboardYearSelect" class="filter-input" onchange="onDashboardYearChange(this.value)" style="padding: 4px 8px; font-size: 0.80rem; min-width: 110px; font-weight: 500;"></select>
          </div>
        </div>
        
        <div id="cockpitDashboardContainer" style="padding: 16px 20px; display: flex; flex-direction: column; gap: 20px;">
          <!-- 1. Type Breakdown Cards -->
          <div>
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; font-size: 0.95rem; font-weight: 700; color: var(--text-main);">📌 Type Summary</h4>
              <span style="font-size: 0.74rem; color: var(--text-muted, #64748b);">💡 카드를 클릭하면 Financial Records 해당 장부로 즉시 이동합니다.</span>
            </div>
            <div id="dashTypeCardsWrap" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px;"></div>
          </div>

          <!-- 2. Dual Breakdown (매출 vs 매입 Category) -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
            <!-- Revenue by Category -->
            <div style="background: #ffffff; border: 1px solid var(--border-gray, #e2e8f0); border-radius: 8px; padding: 14px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h5 style="margin: 0; font-size: 0.88rem; font-weight: 700; color: #16a34a;">🟢 Revenue by Category (매출)</h5>
                <span id="dashRevTotalBadge" style="font-size: 0.80rem; font-weight: 600; color: #16a34a;">₩0</span>
              </div>
              <div id="dashRevCategoryList" style="display: flex; flex-direction: column; gap: 10px; font-size: 0.78rem;"></div>
            </div>

            <!-- Expense by Category -->
            <div style="background: #ffffff; border: 1px solid var(--border-gray, #e2e8f0); border-radius: 8px; padding: 14px 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                <h5 style="margin: 0; font-size: 0.88rem; font-weight: 700; color: #d97706;">🟠 Expense by Category (매입)</h5>
                <span id="dashExpTotalBadge" style="font-size: 0.80rem; font-weight: 600; color: #d97706;">₩0</span>
              </div>
              <div id="dashExpCategoryList" style="display: flex; flex-direction: column; gap: 10px; font-size: 0.78rem;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 3: Fixed Costs (읽기/조회 전용) -->
    <div id="cockpitSubPaneFixed" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title"> Fixed Costs Management <span class="viewer-badge" id="fixedBadgeCount">0 items</span></div>
          <div class="viewer-actions" style="display: flex; gap: 8px; align-items: center;">
            <span id="fixedTotalCostBadge" style="font-size: 0.78rem; font-weight: 600; color: #1e293b; background: #f1f5f9; border: 1px solid var(--border-gray); padding: 4px 10px; border-radius: 6px;">Total Cost: ₩0</span>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitFixedTable" style="table-layout: fixed; width: 100%; min-width: 940px; font-size: 0.78rem;">
            <thead>
              <tr>
                <th style="width: 45px; text-align: center;">No</th>
                <th style="width: 220px; text-align: left;">Item</th>
                <th style="width: 150px; text-align: left;">Vendor</th>
                <th style="width: 110px; text-align: right;">Cost</th>
                <th style="width: 100px; text-align: right;">VAT</th>
                <th style="width: 120px; text-align: center;">First Purchase</th>
                <th style="width: 100px; text-align: center;">Interval</th>
                <th>Remarks</th>
              </tr>
            </thead>
            <tbody id="cockpitFixedTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 4: Tax Filing Dashboard -->
    <div id="cockpitSubPaneTax" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Tax Filing Report</div>
          <div class="viewer-actions" style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 0.76rem; color: #64748b; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: nowrap;">
              🗓 부가세 신고: <strong>1월 &amp; 7월</strong> <span style="color: #cbd5e1; margin: 0 4px;">|</span> 종소세 신고: <strong>5월</strong>
            </span>
            <select id="taxFilingPeriodSelect" class="filter-input" style="padding: 4px 8px; min-width: 230px; font-weight: 500;" onchange="onTaxPeriodChange(this.value)"></select>
          </div>
        </div>

        <div style="padding: 16px;">
          <!-- 1. VAT Section -->
          <div id="taxVatSectionBlock" style="display: none;">
            <h4 style="margin: 0 0 10px; font-size: 0.95rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; justify-content: space-between;">
              <span>VAT Declaration</span>
              <span id="taxVatNetBadge" style="font-size: 0.8rem; font-weight: 500; padding: 2px 8px; border-radius: 4px;">-</span>
            </h4>
            <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; max-height: none !important; height: auto !important; overflow-y: visible !important;">
              <table class="data-table" style="table-layout: fixed; width: 100%;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="width: 220px;">구분 (Hometax Entry)</th>
                    <th>세부 내역 및 증빙</th>
                    <th style="width: 185px; text-align: right;">공급가액 (Supply Value)</th>
                    <th style="width: 145px; text-align: right;">세액 (Tax Amount)</th>
                  </tr>
                </thead>
                <tbody id="taxVatTableBody"></tbody>
              </table>
            </div>
          </div>

          <!-- 2. Income Tax Section & Strategy -->
          <div id="taxIncomeSectionBlock" style="display: none;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <h4 style="margin: 0; font-size: 0.95rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; gap: 8px;">
                <span>절세전략비교 (종합소득세 시뮬레이션)</span>
                <span style="font-size: 0.74rem; font-weight: normal; color: #0369a1; background: #e0f2fe; padding: 2px 8px; border-radius: 12px; border: 1px solid #bae6fd;">간편장부 입력 시 기준경비 자동 반영</span>
              </h4>
              <div style="display: flex; gap: 8px; align-items: center;">
                <button type="button" class="btn-act" onclick="resetTaxInputsToDefault()" style="font-size: 0.74rem; padding: 3px 8px;" title="시트 원본 기본값으로 복원">↺ 원본값 리셋</button>
                <span id="taxIncomeNetBadge" style="font-size: 0.8rem; font-weight: 500; padding: 2px 8px; border-radius: 4px;">-</span>
              </div>
            </div>
            
            <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; margin-bottom: 16px; max-height: none !important; height: auto !important; overflow-y: visible !important; overflow-x: hidden;">
              <table class="data-table" id="taxStrategyTable" style="table-layout: fixed; width: 100%; font-size: 0.78rem;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="width: 175px; padding: 6px 8px;">구분 항목</th>
                    <th style="width: 145px; text-align: right; padding: 6px 8px;">간편장부 ✏️</th>
                    <th style="width: 155px; text-align: right; padding: 6px 8px;">기준경비 (16%) ✏️</th>
                    <th style="padding: 6px 10px;">비고 및 계산 근거</th>
                  </tr>
                </thead>
                <tbody id="taxStrategyTableBody"></tbody>
              </table>
            </div>

            <div style="background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 4px; padding: 12px 16px; font-size: 0.82rem; line-height: 1.6;">
              <div style="font-weight: 600; color: #15803d; margin-bottom: 4px;">💡 무엇이 유리한지 여기서 비교 &amp; 3대 절세 행동 요령</div>
              <div style="color: #334155;">
                1. <strong>간편장부 작성 필수:</strong> 용인시 일반 창업 감면(산출세액 50%)은 간편장부 기장 시에만 적용되며, 기준경비 추계신고 시 전액 배제됩니다.<br>
                2. <strong>공제 한도 최대 채우기:</strong> 노란우산공제(최대 500만 원)와 개인연금저축(최대 600만 원)은 한도까지 납입하여 세액공제를 극대화합니다.<br>
                3. 가계 생활비 등 기타 지출은 <strong>와이프 명의 카드로 집중</strong>하여 대표님 장부 단순성 및 공제 비율을 최적화합니다.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 2. 데이터 조회 및 정규화
async function loadCockpitData() {
  const authKey = getCockpitAuthKey();
  if (!authKey) return;

  try {
    const res = await fetch(COCKPIT_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ auth: authKey, action: 'getCockpitData' })
    });
    const json = await res.json();

    if (json.status === 'auth_failed') {
      if (typeof clearStoredAuthKey === 'function') clearStoredAuthKey();
      document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
      return;
    }

    if (json.success && json.data) {
      cockpitState.finance = json.data.finance || [];

      const rawFixed = json.data.fixedCosts || [];
      cockpitState.fixedCosts = rawFixed.map((r, idx) => {
        if (Array.isArray(r)) {
          const cleanCost = parseInt(String(r[4] || '').replace(/[^\d-]/g, ''), 10) || 0;
          const cleanVat = parseInt(String(r[5] || '').replace(/[^\d-]/g, ''), 10) || 0;
          return {
            no: Number(r[0]) || (idx + 1),
            item: String(r[1] || '').trim(),
            vendor: String(r[2] || '').trim(),
            vendorLink: String(r[3] || '').trim(),
            cost: cleanCost,
            vat: cleanVat,
            firstPurchase: String(r[6] || '').slice(0, 10),
            interval: String(r[7] || 'Annual').trim(),
            remarks: String(r[8] || '').trim()
          };
        }
        return r;
      });

      cockpitState.isLoaded = true;

      populateDynamicFilterOptions();
      populateTaxPeriodDropdown();
      populateDashboardYearDropdown();
      renderFinanceTable();
      renderDashboardView();
      renderFixedCostsTable();
      renderTaxFilingView();
    }
  } catch (err) {
    console.error('Failed to load cockpit data:', err);
  }
}

// 3. 필터 드롭다운 옵션 바인딩
function populateDynamicFilterOptions() {
  const getUniqueSorted = (arr, key) => {
    const set = new Set();
    arr.forEach(item => {
      const val = String(item[key] || '').trim();
      if (val && val !== '-') set.add(val);
    });
    return Array.from(set).sort();
  };

  const populateSelect = (elementId, options) => {
    const sel = document.getElementById(elementId);
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">All</option>' + options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    sel.value = currentVal;
  };

  populateSelect('filterFinType', getUniqueSorted(cockpitState.finance, 'type'));
  populateSelect('filterFinCategory', getUniqueSorted(cockpitState.finance, 'category'));
  const clientOptions = getUniqueSorted(cockpitState.finance, 'client');
  const hasEmptyClient = cockpitState.finance.some(r => !String(r.client || '').trim() || String(r.client).trim() === '-');
  const finalClientOpts = hasEmptyClient ? ['-', ...clientOptions] : clientOptions;
  populateSelect('filterFinClient', finalClientOpts);
  populateSelect('filterFinTransaction', getUniqueSorted(cockpitState.finance, 'transaction'));
  populateSelect('filterFinTaxType', getUniqueSorted(cockpitState.finance, 'taxType'));
}

// 4. 세무 기간 드롭다운 동적 연도 생성
function populateTaxPeriodDropdown() {
  const select = document.getElementById('taxFilingPeriodSelect');
  if (!select) return;

  const currentYearStr = String(new Date().getFullYear());
  const yearsSet = new Set([currentYearStr]);
  const dataYears = new Set();

  cockpitState.finance.forEach(r => {
    if (r.date && r.date.length >= 4) {
      const y = r.date.slice(0, 4);
      if (/^\d{4}$/.test(y)) {
        yearsSet.add(y);
        dataYears.add(y);
      }
    }
  });

  const sortedYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));

  const optionsHtml = sortedYears.map(year => `
    <option value="${year}-FY">${year} 종소세 (연간)</option>
    <option value="${year}-H2">${year} 하반기 부가세 (2기)</option>
    <option value="${year}-H1">${year} 상반기 부가세 (1기)</option>
  `).join('');

  select.innerHTML = optionsHtml;

  if (!cockpitState.taxPeriod || !sortedYears.includes(cockpitState.taxPeriod.slice(0, 4))) {
    if (dataYears.has(currentYearStr)) {
      cockpitState.taxPeriod = `${currentYearStr}-FY`;
    } else if (dataYears.size > 0) {
      const maxDataYear = Array.from(dataYears).sort((a, b) => Number(b) - Number(a))[0];
      cockpitState.taxPeriod = `${maxDataYear}-FY`;
    } else {
      cockpitState.taxPeriod = `${currentYearStr}-FY`;
    }
  }
  select.value = cockpitState.taxPeriod;
}

// 5. 대시보드 연도 선택 드롭다운 생성
function populateDashboardYearDropdown() {
  const select = document.getElementById('cockpitDashboardYearSelect');
  if (!select) return;

  const yearsSet = new Set();
  cockpitState.finance.forEach(r => {
    if (r.date && r.date.length >= 4) {
      const y = r.date.slice(0, 4);
      if (/^\d{4}$/.test(y)) yearsSet.add(y);
    }
  });

  const sortedYears = Array.from(yearsSet).sort((a, b) => Number(b) - Number(a));
  select.innerHTML = `<option value="ALL">All Years</option>` + sortedYears.map(y => `<option value="${y}">${y}</option>`).join('');

  const currentYear = String(new Date().getFullYear());
  const defaultYear = sortedYears.includes(currentYear) ? currentYear : (sortedYears[0] || 'ALL');

  if (cockpitState.dashboardYear && (cockpitState.dashboardYear === 'ALL' || sortedYears.includes(cockpitState.dashboardYear))) {
    select.value = cockpitState.dashboardYear;
  } else {
    select.value = defaultYear;
    cockpitState.dashboardYear = defaultYear;
  }
}

// 6. 서브 탭 전환
function switchCockpitSubTab(tab) {
  cockpitState.currentSubTab = tab;
  ['Finance', 'Dashboard', 'Fixed', 'Tax'].forEach(t => {
    const key = t.toLowerCase();
    const btn = document.getElementById(`btnCockpitTab${t}`);
    const pane = document.getElementById(`cockpitSubPane${t}`);
    if (btn && pane) {
      if (key === tab) {
        btn.classList.add('active');
        pane.style.display = 'block';
      } else {
        btn.classList.remove('active');
        pane.style.display = 'none';
      }
    }
  });

  if (tab === 'dashboard') renderDashboardView();
  if (tab === 'fixed') renderFixedCostsTable();
  if (tab === 'tax') renderTaxFilingView();
}

// 7. Finance 테이블 렌더링 & 페이지네이션 (Edit 열 삭제)
function renderFinanceTable() {
  const tbody = document.getElementById('cockpitFinanceTableBody');
  const badge = document.getElementById('finBadgeCount');
  if (!tbody) return;

  const f = cockpitState.financeFilters;
  const filtered = cockpitState.finance.filter(row => {
    if (f.date && !String(row.date).includes(f.date)) return false;
    if (f.type && String(row.type) !== f.type) return false;
    if (f.category && String(row.category) !== f.category) return false;
    if (f.client) {
      const cVal = String(row.client || '').trim();
      if (f.client === '-') {
        if (cVal !== '' && cVal !== '-') return false;
      } else if (cVal !== f.client) {
        return false;
      }
    }
    if (f.transaction && String(row.transaction) !== f.transaction) return false;
    if (f.description && !String(row.description || '').toLowerCase().includes(f.description.toLowerCase())) return false;
    if (f.taxType && String(row.taxType) !== f.taxType) return false;
    if (f.usd && !String(row.totalUSD || '').includes(f.usd)) return false;
    if (f.krw && !String(Math.round(row.totalKRW)).includes(f.krw)) return false;
    return true;
  });

  filtered.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const totalItems = filtered.length;
  const p = cockpitState.finPagination;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  const pageInfo = document.getElementById('finPageInfoDisplay');
  const btnPrev = document.getElementById('btnFinPrevPage');
  const btnNext = document.getElementById('btnFinNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" style="text-align:center; padding: 24px; color: #94a3b8;">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map(r => {
    const isInc = r.type === '매출';
    const isTax = r.type === '세금';
    const tagBg = isInc ? '#ecfdf5' : (isTax ? '#fef3c7' : '#fef2f2');
    const tagColor = isInc ? '#16a34a' : (isTax ? '#d97706' : '#dc2626');

    const krw = Math.round(Number(r.totalKRW) || 0).toLocaleString('ko-KR');
    const sup = Math.round(Number(r.supply) || 0).toLocaleString('ko-KR');
    const tax = Math.round(Number(r.tax) || 0).toLocaleString('ko-KR');
    const usd = r.totalUSD ? `$${Math.round(Number(r.totalUSD)).toLocaleString('en-US')}` : '-';

    return `
      <tr>
        <td style="white-space: nowrap; word-break: keep-all; overflow: visible;">${r.date || '-'}</td>
        <td style="text-align: center; white-space: nowrap; overflow: visible;"><span style="background: ${tagBg}; color: ${tagColor}; padding: 1px 4px; border-radius: 4px; font-size: 0.72rem; font-weight: 400;">${r.type}</span></td>
        <td style="white-space: nowrap; overflow: visible; color: #475569;">${r.category || '-'}</td>
        <td style="white-space: nowrap; word-break: keep-all; overflow: visible;">${r.client || '-'}</td>
        <td style="white-space: nowrap; overflow: visible; color: #64748b;">${r.transaction || '-'}</td>
        <td style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${r.description || ''}">${r.description || '-'}</td>
        <td style="text-align: center; white-space: nowrap; overflow: visible; color: #64748b; font-size: 0.73rem;">${r.taxType || '-'}</td>
        <td style="text-align: right; white-space: nowrap; overflow: visible; color: #16a34a;">${usd}</td>
        <td style="text-align: right; white-space: nowrap; overflow: visible;">₩${krw}</td>
        <td style="text-align: right; white-space: nowrap; overflow: visible; color: #64748b;">₩${sup}</td>
        <td style="text-align: right; white-space: nowrap; overflow: visible; color: #64748b;">₩${tax}</td>
      </tr>
    `;
  }).join('');
}

function goToFinPage(page) {
  const f = cockpitState.financeFilters;
  const filteredCount = cockpitState.finance.filter(row => {
    if (f.date && !String(row.date).includes(f.date)) return false;
    if (f.type && String(row.type) !== f.type) return false;
    if (f.category && String(row.category) !== f.category) return false;
    if (f.client) {
      const cVal = String(row.client || '').trim();
      if (f.client === '-') {
        if (cVal !== '' && cVal !== '-') return false;
      } else if (cVal !== f.client) {
        return false;
      }
    }
    if (f.transaction && String(row.transaction) !== f.transaction) return false;
    if (f.description && !String(row.description || '').toLowerCase().includes(f.description.toLowerCase())) return false;
    if (f.taxType && String(row.taxType) !== f.taxType) return false;
    if (f.usd && !String(row.totalUSD || '').includes(f.usd)) return false;
    if (f.krw && !String(Math.round(row.totalKRW)).includes(f.krw)) return false;
    return true;
  }).length;

  const totalPages = Math.max(1, Math.ceil(filteredCount / cockpitState.finPagination.pageSize));
  if (page < 1 || page > totalPages) return;
  cockpitState.finPagination.page = page;
  renderFinanceTable();
}

function changeFinPageSize(newSize) {
  cockpitState.finPagination.pageSize = parseInt(newSize, 10) || 50;
  cockpitState.finPagination.page = 1;
  renderFinanceTable();
}

// 8. Dashboard 렌더링 및 자동 필터링 연동
function onDashboardYearChange(year) {
  cockpitState.dashboardYear = year;
  renderDashboardView();
}

function navigateToFinanceWithFilter(type = null, category = null) {
  cockpitState.financeFilters = {};
  cockpitState.finPagination.page = 1;

  document.querySelectorAll('#finTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#finTableFilterRow select').forEach(select => select.value = '');

  if (cockpitState.dashboardYear && cockpitState.dashboardYear !== 'ALL') {
    cockpitState.financeFilters.date = cockpitState.dashboardYear;
    const dateInput = document.getElementById('filterFinDate');
    if (dateInput) dateInput.value = cockpitState.dashboardYear;
  }

  if (type) {
    cockpitState.financeFilters.type = type;
    const typeSelect = document.getElementById('filterFinType');
    if (typeSelect) typeSelect.value = type;
  }

  if (category) {
    cockpitState.financeFilters.category = category;
    const catSelect = document.getElementById('filterFinCategory');
    if (catSelect) catSelect.value = category;
  }

  switchCockpitSubTab('finance');
  renderFinanceTable();
}

function renderDashboardView() {
  const container = document.getElementById('cockpitDashboardContainer');
  if (!container) return;

  const targetYear = cockpitState.dashboardYear || 'ALL';
  const rows = cockpitState.finance.filter(r => {
    if (!r.date) return false;
    if (targetYear === 'ALL') return true;
    return r.date.startsWith(targetYear);
  });

  let revTotal = 0, revSupply = 0, revTax = 0;
  let expTotal = 0, expTaxDeductible = 0;
  let taxTotal = 0;
  const catRevMap = {};
  const catExpMap = {};

  rows.forEach(r => {
    const krw = Math.round(Number(r.totalKRW) || 0);
    const supply = Math.round(Number(r.supply) || 0);
    const tax = Math.round(Number(r.tax) || 0);
    const cat = String(r.category || '기타').trim() || '기타';

    if (r.type === '매출') {
      revTotal += krw;
      revSupply += supply;
      revTax += tax;
      catRevMap[cat] = (catRevMap[cat] || 0) + krw;
    } else if (r.type === '매입') {
      expTotal += krw;
      expTaxDeductible += tax;
      catExpMap[cat] = (catExpMap[cat] || 0) + krw;
    } else if (r.type === '세금') {
      taxTotal += krw;
    }
  });

  const netProfit = revTotal - expTotal;
  const marginPct = revTotal > 0 ? Math.round((netProfit / revTotal) * 100) : 0;

  const typeCardsWrap = document.getElementById('dashTypeCardsWrap');
  if (typeCardsWrap) {
    typeCardsWrap.innerHTML = `
      <!-- 카드 1: 매출 합계 -->
      <div onclick="navigateToFinanceWithFilter('매출', null)" style="background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 6px; padding: 12px 14px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 10px rgba(0,0,0,0.06)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" title="매출 내역 필터링 보기">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.76rem; color: #64748b; font-weight: 600;">매출 합계 (Revenue)</div>
          <span style="font-size: 0.70rem; color: #16a34a; font-weight: 600;">Click ↗</span>
        </div>
        <div style="font-size: 1.15rem; font-weight: 700; color: #16a34a; margin-top: 3px;">₩${revTotal.toLocaleString('ko-KR')}</div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px;">
          Supply ₩${revSupply.toLocaleString('ko-KR')} / Tax ₩${revTax.toLocaleString('ko-KR')}
        </div>
      </div>

      <!-- 카드 2: 매입 합계 -->
      <div onclick="navigateToFinanceWithFilter('매입', null)" style="background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 6px; padding: 12px 14px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 10px rgba(0,0,0,0.06)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" title="매입 내역 필터링 보기">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.76rem; color: #64748b; font-weight: 600;">매입 합계 (Expense)</div>
          <span style="font-size: 0.70rem; color: #d97706; font-weight: 600;">Click ↗</span>
        </div>
        <div style="font-size: 1.15rem; font-weight: 700; color: #d97706; margin-top: 3px;">₩${expTotal.toLocaleString('ko-KR')}</div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          Input Tax Deductible ₩${expTaxDeductible.toLocaleString('ko-KR')}
        </div>
      </div>

      <!-- 카드 3: 순이익 -->
      <div onclick="navigateToFinanceWithFilter(null, null)" style="background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 6px; padding: 12px 14px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 10px rgba(0,0,0,0.06)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" title="전체 장부 목록 보기">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.76rem; color: #64748b; font-weight: 600;">순이익 (Revenue - Expense)</div>
          <span style="font-size: 0.70rem; color: #0284c7; font-weight: 600;">All ↗</span>
        </div>
        <div style="font-size: 1.15rem; font-weight: 700; color: ${netProfit >= 0 ? '#0284c7' : '#dc2626'}; margin-top: 3px;">₩${netProfit.toLocaleString('ko-KR')}</div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          Operating Margin: ${marginPct}%
        </div>
      </div>

      <!-- 카드 4: 세금 납부 합계 -->
      <div onclick="navigateToFinanceWithFilter('세금', null)" style="background: #f8fafc; border: 1px solid var(--border-gray); border-left: 4px solid #dc2626; border-radius: 6px; padding: 12px 14px; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s;" onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 10px rgba(0,0,0,0.06)';" onmouseout="this.style.transform='none'; this.style.boxShadow='none';" title="세금 납부 내역 필터링 보기">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 0.76rem; color: #64748b; font-weight: 600;">세금 납부 합계 (Tax)</div>
          <span style="font-size: 0.70rem; color: #dc2626; font-weight: 600;">Click ↗</span>
        </div>
        <div style="font-size: 1.15rem; font-weight: 700; color: #dc2626; margin-top: 3px;">₩${taxTotal.toLocaleString('ko-KR')}</div>
        <div style="font-size: 0.72rem; color: #94a3b8; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          VAT &amp; Income Tax Paid
        </div>
      </div>
    `;
  }

  const renderCategoryBars = (map, total, containerId, badgeId, color, typeParam) => {
    const listEl = document.getElementById(containerId);
    const badgeEl = document.getElementById(badgeId);
    if (badgeEl) badgeEl.innerText = `₩${total.toLocaleString('ko-KR')}`;
    if (!listEl) return;

    const sortedCats = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (sortedCats.length === 0 || total === 0) {
      listEl.innerHTML = '<div style="color: #94a3b8; text-align: center; padding: 16px;">내역이 없습니다.</div>';
      return;
    }

    listEl.innerHTML = sortedCats.map(([catName, amount]) => {
      const pct = Math.round((amount / total) * 100);
      return `
        <div onclick="navigateToFinanceWithFilter('${typeParam}', '${catName}')" style="cursor: pointer; padding: 4px 6px; border-radius: 4px; transition: background 0.15s;" onmouseover="this.style.background='#f1f5f9';" onmouseout="this.style.background='transparent';" title="${catName} 내역 필터링 보기">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 3px;">
            <span style="font-weight: 600; color: var(--text-main);">${catName}</span>
            <span style="color: #64748b; font-weight: 500;">₩${amount.toLocaleString('ko-KR')} (${pct}%) ↗</span>
          </div>
          <div style="height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
            <div style="width: ${pct}%; height: 100%; background: ${color}; border-radius: 3px; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }).join('');
  };

  renderCategoryBars(catRevMap, revTotal, 'dashRevCategoryList', 'dashRevTotalBadge', '#16a34a', '매출');
  renderCategoryBars(catExpMap, expTotal, 'dashExpCategoryList', 'dashExpTotalBadge', '#d97706', '매입');
}

// 9. Fixed Costs 테이블 렌더링 (Edit 열 제거)
function renderFixedCostsTable() {
  const tbody = document.getElementById('cockpitFixedTableBody');
  const badge = document.getElementById('fixedBadgeCount');
  const totalCostBadge = document.getElementById('fixedTotalCostBadge');
  if (!tbody) return;

  const list = cockpitState.fixedCosts || [];
  if (badge) badge.innerText = `${list.length} items`;

  let sumCost = 0;
  list.forEach(item => {
    sumCost += Number(item.cost) || 0;
  });
  if (totalCostBadge) totalCostBadge.innerText = `Total Cost: ₩${sumCost.toLocaleString('ko-KR')}`;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px; color: #94a3b8;">No fixed costs found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(r => {
    const costFormatted = Number(r.cost) ? `₩${Number(r.cost).toLocaleString('ko-KR')}` : '₩0';
    const vatFormatted = Number(r.vat) ? `₩${Number(r.vat).toLocaleString('ko-KR')}` : '-';

    const vendorLinkClean = String(r.vendorLink || '').trim();
    const vendorNameClean = r.vendor || '-';
    let vendorHtml = vendorNameClean;
    if (vendorLinkClean) {
      vendorHtml = `<a href="${vendorLinkClean}" target="_blank" rel="noopener noreferrer" style="color: var(--accent-blue, #0284c7); text-decoration: none; font-weight: 500;" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${vendorNameClean} ↗</a>`;
    }

    return `
      <tr>
        <td style="text-align: center; color: #64748b;">${r.no}</td>
        <td style="font-weight: 600; color: var(--text-main);">${r.item || '-'}</td>
        <td>${vendorHtml}</td>
        <td style="text-align: right; font-weight: 500;">${costFormatted}</td>
        <td style="text-align: right; color: #64748b;">${vatFormatted}</td>
        <td style="text-align: center; color: #64748b;">${r.firstPurchase || '-'}</td>
        <td style="text-align: center;"><span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 500;">${r.interval || 'Annual'}</span></td>
        <td style="color: #64748b; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${(r.remarks || '').replace(/"/g, '&quot;')}">${r.remarks || '-'}</td>
      </tr>
    `;
  }).join('');
}

// 10. TAX FILING 연산 및 자동 동기화 시뮬레이션 테이블 렌더링
function onTaxPeriodChange(period) {
  cockpitState.taxPeriod = period;
  renderTaxFilingView();
}

function getPeriodDateRange(period) {
  const currentFallbackYear = String(new Date().getFullYear());
  const fallbackPeriod = cockpitState.taxPeriod || `${currentFallbackYear}-FY`;
  const parts = (period || fallbackPeriod).split('-');
  const y = parts[0] || currentFallbackYear;
  const type = parts[1] || 'FY';

  if (type === 'H1') return { start: `${y}-01-01`, end: `${y}-06-30`, isVat: true, isIncome: false };
  if (type === 'H2') return { start: `${y}-07-01`, end: `${y}-12-31`, isVat: true, isIncome: false };
  return { start: `${y}-01-01`, end: `${y}-12-31`, isVat: false, isIncome: true };
}

function parseCleanInt(val, fallback = 0) {
  const num = parseInt(String(val || '').replace(/[^\d-]/g, ''), 10);
  return isNaN(num) ? fallback : num;
}

function onTaxInputChange(field, el) {
  const val = parseCleanInt(el.value, 0);
  cockpitState.taxInputs[field] = val;
  el.value = val.toLocaleString('ko-KR');
  renderTaxFilingView();
}

function onTaxRateChange(el) {
  let val = parseFloat(el.value);
  if (isNaN(val) || val < 0) val = 0;
  if (val > 100) val = 100;
  cockpitState.taxInputs.baseExpenseRate = val;
  renderTaxFilingView();
}

function resetTaxInputsToDefault() {
  cockpitState.taxInputs = {
    revenue: 43000000,
    actualExpense: 3000000,
    healthInsurance: 420000,
    baseExpenseRate: 16,
    dedPersonal: 1500000,
    dedYellow: 5000000,
    dedNps: 1600000,
    pensionSavings: 6000000
  };
  renderTaxFilingView();
}

function renderTaxFilingView() {
  const range = getPeriodDateRange(cockpitState.taxPeriod);
  
  const vatBlock = document.getElementById('taxVatSectionBlock');
  const incBlock = document.getElementById('taxIncomeSectionBlock');

  if (range.isVat) {
    if (vatBlock) vatBlock.style.display = 'block';
    if (incBlock) incBlock.style.display = 'none';
  } else {
    if (vatBlock) vatBlock.style.display = 'none';
    if (incBlock) incBlock.style.display = 'block';
  }

  const periodRows = cockpitState.finance.filter(r => {
    if (!r.date) return false;
    return r.date >= range.start && r.date <= range.end;
  });

  let vatTaxableSalesSupply = 0, vatTaxableSalesTax = 0;
  let vatZeroSalesSupply = 0;
  let vatExemptSalesSupply = 0;

  let vatInvoicePurchSupply = 0, vatInvoicePurchTax = 0;
  let vatCardPurchSupply = 0, vatCardPurchTax = 0;
  let vatNonDeductPurchSupply = 0;

  periodRows.forEach(r => {
    const supply = Math.round(Number(r.supply) || 0);
    const tax = Math.round(Number(r.tax) || 0);
    const isInc = r.type === '매출';
    const isExp = r.type === '매입';

    if (isInc) {
      if (r.taxType === '과세') {
        vatTaxableSalesSupply += supply;
        vatTaxableSalesTax += tax;
      } else if (r.taxType === '영세') {
        vatZeroSalesSupply += supply;
      } else {
        vatExemptSalesSupply += supply;
      }
    } else if (isExp) {
      if (r.transaction === '전자세금계산서' && r.taxType === '과세') {
        vatInvoicePurchSupply += supply;
        vatInvoicePurchTax += tax;
      } else if (r.transaction === '사업자카드' && r.taxType === '과세') {
        vatCardPurchSupply += supply;
        vatCardPurchTax += tax;
      } else {
        vatNonDeductPurchSupply += supply;
      }
    }
  });

  if (range.isVat) {
    const totalSalesTax = vatTaxableSalesTax;
    const totalPurchTax = vatInvoicePurchTax + vatCardPurchTax;
    const netVatDue = totalSalesTax - totalPurchTax;

    const vatTbody = document.getElementById('taxVatTableBody');
    if (vatTbody) {
      vatTbody.innerHTML = `
        <tr style="background: #fafafa; font-weight: 500;">
          <td colspan="4" style="color: #1e293b;">[과세표준 및 매출세액]</td>
        </tr>
        <tr>
          <td style="padding-left: 20px;">과세 세금계산서 발급분 (10%)</td>
          <td style="color: #64748b;">국내 일반 용역</td>
          <td style="text-align: right;">₩${vatTaxableSalesSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #16a34a;">₩${vatTaxableSalesTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td style="padding-left: 20px;">영세율 (외화획득 용역)</td>
          <td style="color: #64748b;">해외 기술자문 (APA 등 외화 수임)</td>
          <td style="text-align: right;">₩${vatZeroSalesSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #64748b;">₩0</td>
        </tr>
        <tr>
          <td style="padding-left: 20px;">면세 / 비과세 매출</td>
          <td style="color: #64748b;">협회 강의 등 소득세 원천징수분</td>
          <td style="text-align: right;">₩${vatExemptSalesSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #64748b;">₩0</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: 500;">
          <td colspan="2" style="text-align: right; color: #475569;">매출세액 합계</td>
          <td style="text-align: right;">₩${(vatTaxableSalesSupply + vatZeroSalesSupply + vatExemptSalesSupply).toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #16a34a;">₩${totalSalesTax.toLocaleString('ko-KR')}</td>
        </tr>

        <tr style="background: #fafafa; font-weight: 500;">
          <td colspan="4" style="color: #1e293b;">[매입세액 및 경비공제]</td>
        </tr>
        <tr>
          <td style="padding-left: 20px;">세금계산서 수취분 (일반매입)</td>
          <td style="color: #64748b;">사무실 임대료 등 과세 세금계산서</td>
          <td style="text-align: right;">₩${vatInvoicePurchSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #d97706;">₩${vatInvoicePurchTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td style="padding-left: 20px;">신용카드매출전표 수령명세 (과세)</td>
          <td style="color: #64748b;">사업자카드 결제 (소모품, 비품, 과세 구독)</td>
          <td style="text-align: right;">₩${vatCardPurchSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #d97706;">₩${vatCardPurchTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td style="padding-left: 20px; color: #94a3b8;">불공제 / 비과세 매입 (공제제외)</td>
          <td style="color: #94a3b8;">금융수수료, 비과세 해외결제, 세금 납부</td>
          <td style="text-align: right; color: #94a3b8;">₩${vatNonDeductPurchSupply.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #94a3b8;">₩0</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: 500;">
          <td colspan="2" style="text-align: right; color: #475569;">공제대상 매입세액 합계</td>
          <td style="text-align: right;">₩${(vatInvoicePurchSupply + vatCardPurchSupply).toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #d97706;">₩${totalPurchTax.toLocaleString('ko-KR')}</td>
        </tr>

        <tr style="background: #ffffff; border-top: 2px solid var(--border-gray);">
          <td colspan="2" style="font-size: 0.95rem; font-weight: 600; color: var(--text-main);">차감 납부(환급) 세액 (Tax Due / Refund)</td>
          <td colspan="2" style="text-align: right; font-size: 1.05rem; font-weight: 600; color: ${netVatDue >= 0 ? '#dc2626' : '#16a34a'};">
            ${netVatDue >= 0 ? `납부 예상 ₩${netVatDue.toLocaleString('ko-KR')}` : `환급 예상 ₩${Math.abs(netVatDue).toLocaleString('ko-KR')}`}
          </td>
        </tr>
      `;
    }

    const vatBadge = document.getElementById('taxVatNetBadge');
    if (vatBadge) {
      if (netVatDue >= 0) {
        vatBadge.style.background = '#fef2f2';
        vatBadge.style.color = '#dc2626';
        vatBadge.innerText = `납부 예상: ₩${netVatDue.toLocaleString('ko-KR')}`;
      } else {
        vatBadge.style.background = '#ecfdf5';
        vatBadge.style.color = '#16a34a';
        vatBadge.innerText = `환급 예상: ₩${Math.abs(netVatDue).toLocaleString('ko-KR')}`;
      }
    }
  }

  if (range.isIncome) {
    const inputs = cockpitState.taxInputs;

    const revenue = inputs.revenue;
    const expSimp = inputs.actualExpense;
    const baseRate = (inputs.baseExpenseRate !== undefined) ? inputs.baseExpenseRate : 16;
    const expBase = Math.round(revenue * (baseRate / 100));
    const healthInsSimp = inputs.healthInsurance;
    const healthInsBase = 0;

    const incSimp = Math.max(0, revenue - expSimp - healthInsSimp);
    const incBase = Math.max(0, revenue - expBase - healthInsBase);

    const dedPersonal = inputs.dedPersonal;
    const dedYellow = inputs.dedYellow;
    const dedNps = inputs.dedNps;
    const dedTotal = dedPersonal + dedYellow + dedNps;

    const taxBaseSimp = Math.max(0, incSimp - dedTotal);
    const taxBaseBase = Math.max(0, incBase - dedTotal);

    const calcTax = (base) => {
      if (base <= 0) return 0;
      if (base <= 14000000) return Math.round(base * 0.06);
      if (base <= 50000000) return Math.round(base * 0.15 - 1260000);
      return Math.round(base * 0.24 - 5760000);
    };

    const calcTaxSimp = calcTax(taxBaseSimp);
    const calcTaxBase = calcTax(taxBaseBase);

    const redSimp = Math.round(calcTaxSimp * 0.5);
    const redBase = 0;

    const pensionSavings = inputs.pensionSavings;
    const taxCreditPension = Math.round(pensionSavings * 0.15);

    const itSimp = Math.max(0, (calcTaxSimp - redSimp) - taxCreditPension);
    const itBase = Math.max(0, (calcTaxBase - redBase) - taxCreditPension);

    const penaltySimp = 0;
    const penaltyBase = (revenue >= 48000000) ? Math.round(calcTaxBase * 0.2) : 0;

    const localTaxSimp = Math.round((itSimp + penaltySimp) * 0.1);
    const localTaxBase = Math.round((itBase + penaltyBase) * 0.1);

    const finalTaxSimp = itSimp + penaltySimp + localTaxSimp;
    const finalTaxBase = itBase + penaltyBase + localTaxBase;

    const diffSaving = finalTaxBase - finalTaxSimp;

    const inputStyle = "width: 110px; padding: 3px 6px; font-size: 0.78rem; text-align: right; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; font-weight: 500; outline: none;";
    const rateInputStyle = "width: 48px; padding: 2px 4px; font-size: 0.78rem; text-align: center; border: 1px solid #93c5fd; border-radius: 4px; background: #eff6ff; font-weight: 600; color: #1d4ed8; outline: none;";

    const strTbody = document.getElementById('taxStrategyTableBody');
    if (strTbody) {
      const tableHead = document.querySelector('#taxStrategyTable thead tr');
      if (tableHead) {
        tableHead.innerHTML = `
          <th style="width: 175px; padding: 6px 8px;">구분 항목</th>
          <th style="width: 145px; text-align: right; padding: 6px 8px;">간편장부 ✏️</th>
          <th style="width: 155px; text-align: right; padding: 6px 8px;">
            기준경비 (<input type="number" step="0.1" min="0" max="100" style="${rateInputStyle}" value="${baseRate}" onchange="onTaxRateChange(this)">%) ✏️
          </th>
          <th style="padding: 6px 10px;">비고 및 계산 근거</th>
        `;
      }

      strTbody.innerHTML = `
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">총 매출액 (a)</td>
          <td style="text-align: right; padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${revenue.toLocaleString('ko-KR')}" onchange="onTaxInputChange('revenue', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 5px 8px; color: #475569; font-weight: 500;">₩${revenue.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px;">외화(USD) 매출 동일 반영</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">인정 경비 (b)</td>
          <td style="text-align: right; padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${expSimp.toLocaleString('ko-KR')}" onchange="onTaxInputChange('actualExpense', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 5px 8px; color: #475569; font-weight: 500;">₩${expBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; font-size: 0.74rem; line-height: 1.4; padding: 5px 10px; word-break: keep-all;">
            <strong>간편장부:</strong> 실제 지출액 (3대 비용 포함)<br>
            <strong>기준경비적용:</strong> 정부인정경비(업태: 전문, 과학 및 기술서비스업 / 종목: 기타 전문 서비스업[749942] ${baseRate}%) 자동 연산
          </td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">건강 보험 (c)</td>
          <td style="text-align: right; padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${healthInsSimp.toLocaleString('ko-KR')}" onchange="onTaxInputChange('healthInsurance', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 5px 8px; color: #94a3b8; font-weight: 500;">₩0</td>
          <td style="color: #64748b; font-size: 0.74rem; padding: 5px 10px;">지역 건강보험료 납부액은 종합소득세 계산 시 사업장의 필요경비(b)로 전액 털어낼 수 있음 (단, 기준경비 적용 시 제외)</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 500;">
          <td style="padding: 5px 8px;">종합소득금액 (A)(a-b-c)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 600; color: #0f172a;">₩${incSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; color: #2563eb; font-weight: 600;">₩${incBase.toLocaleString('ko-KR')}</td>
          <td style="color: #475569; padding: 5px 10px; font-size: 0.74rem;">경비율 적용 시 소득 차이 발생</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 16px; color: #64748b;">인적공제 (d)</td>
          <td style="text-align: right; padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedPersonal.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedPersonal', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 4px 8px; color: #475569; font-weight: 500;">₩${dedPersonal.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">본인 기본공제 (150만 원)</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 16px; color: #64748b;">노란우산공제 (e)</td>
          <td style="text-align: right; padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedYellow.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedYellow', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 4px 8px; color: #475569; font-weight: 500;">₩${dedYellow.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">소기업·소상공인 공제부금 최대 불입</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 16px; color: #64748b;">국민연금 공제 (f)</td>
          <td style="text-align: right; padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedNps.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedNps', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 4px 8px; color: #475569; font-weight: 500;">₩${dedNps.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">전액(100%) 과세표준에서 차감</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 500;">
          <td style="padding: 5px 8px;">소득공제 (B)(d+e+f)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 600;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; color: #475569; font-weight: 600;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td style="color: #475569; padding: 5px 10px; font-size: 0.74rem;">본인 공제(150만) + 노란우산공제(500만) + 국민연금공제(160만) 자동 동기화</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: 600;">
          <td style="padding: 5px 8px;">과세표준 (A-B)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 600; color: #0f172a;">₩${taxBaseSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 600; color: #0f172a;">₩${taxBaseBase.toLocaleString('ko-KR')}</td>
          <td style="color: #1e293b; padding: 5px 10px; font-size: 0.74rem;">세금을 매기는 기준 금액</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">세율 및 산출세액 (C)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500;">₩${calcTaxSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500; color: #475569;">₩${calcTaxBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">1400만까지 6%, 5000만까지 15% 세율 구간 적용</td>
        </tr>
        <tr>
          <td style="font-weight: 500; color: #15803d; padding: 5px 8px;">창업중소기업 세액감면 (D)</td>
          <td style="text-align: right; color: #15803d; padding: 5px 8px; font-weight: 600;">₩${redSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #94a3b8; padding: 5px 8px; font-weight: 500;">₩0</td>
          <td style="color: #15803d; font-size: 0.74rem; line-height: 1.35; padding: 5px 10px; word-break: keep-all;">
            <strong>'창업중소기업 세액감면 신청서'를 반드시 함께 제출 | 기준경비 사용 시 적용 안 됨 | 무조건 간편 장부 작성!</strong><br>
            용인시 일반 창업자 (만 34세 초과) 종합소득세 50% 감면 (산출세액 기준 5년간 감면)
          </td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">개인연금저축 (g)</td>
          <td style="text-align: right; padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${pensionSavings.toLocaleString('ko-KR')}" onchange="onTaxInputChange('pensionSavings', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td style="text-align: right; padding: 5px 8px; color: #475569; font-weight: 500;">₩${pensionSavings.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">개인연금저축 연간 납입액 자동 동기화</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">세액공제 (E)(g*0.15)</td>
          <td style="text-align: right; color: #16a34a; padding: 5px 8px; font-weight: 500;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #16a34a; padding: 5px 8px; font-weight: 500;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">개인연금저축 (${(pensionSavings / 10000).toLocaleString('ko-KR')}만 × 15% 공제율)</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">종합소득세 (F)(C-D-E)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500;">₩${itSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500; color: #475569;">₩${itBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">산출세액 - 세액감면 - 세액공제</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">무기장 가산세 (G)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500; color: #94a3b8;">₩0</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500; color: ${penaltyBase > 0 ? '#dc2626' : '#94a3b8'};">₩${penaltyBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">매출 4,800만 원 미만은 가산세 면제, 이상은 20% 추가 (간편장부는 가산세 없음)</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">지방소득세 (H) ((F+G)*0.1)</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500;">₩${localTaxSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px; font-weight: 500; color: #475569;">₩${localTaxBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">종합소득세 + 가산세의 10% 별도 부과</td>
        </tr>
        <tr style="background: #ffffff; border-top: 2px solid var(--border-gray); font-size: 0.88rem; font-weight: 700;">
          <td style="color: var(--text-main); padding: 6px 8px;">최종 세액 (I)(F+G+H)</td>
          <td style="text-align: right; color: #16a34a; padding: 6px 8px; font-size: 0.92rem;">₩${finalTaxSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #dc2626; padding: 6px 8px; font-size: 0.92rem;">₩${finalTaxBase.toLocaleString('ko-KR')}</td>
          <td style="color: #2563eb; padding: 6px 10px; font-size: 0.74rem;">납부 예상 합계액 (국세 + 지방세)</td>
        </tr>
        <tr style="background: #f0fdf4; font-weight: 700;">
          <td style="color: #15803d; padding: 6px 8px;">간편장부 대비 절감</td>
          <td style="text-align: right; color: #64748b; padding: 6px 8px;">- (기준)</td>
          <td style="text-align: right; color: #15803d; padding: 6px 8px; font-size: 0.98rem;">
            +₩${diffSaving.toLocaleString('ko-KR')}
          </td>
          <td style="color: #15803d; padding: 6px 10px; font-size: 0.78rem;">무엇이 유리한지 여기서 비교! (간편장부 선택 시 절세 효과)</td>
        </tr>
      `;
    }

    const incBadge = document.getElementById('taxIncomeNetBadge');
    if (incBadge) {
      incBadge.style.background = '#ecfdf5';
      incBadge.style.color = '#16a34a';
      incBadge.innerText = `간편장부 절세 효과: ₩${diffSaving.toLocaleString('ko-KR')}`;
    }
  }
}

// 11. 필터 핸들러
function onFinFilterChange(col, val) {
  cockpitState.financeFilters[col] = val.trim();
  cockpitState.finPagination.page = 1;
  renderFinanceTable();
}

function resetFinanceFilters() {
  cockpitState.financeFilters = {};
  cockpitState.finPagination.page = 1;
  document.querySelectorAll('#finTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#finTableFilterRow select').forEach(select => select.value = '');
  renderFinanceTable();
}

// Window 전역 export
window.initCockpitModule = initCockpitModule;
window.loadCockpitData = loadCockpitData;
window.switchCockpitSubTab = switchCockpitSubTab;
window.onTaxPeriodChange = onTaxPeriodChange;
window.onDashboardYearChange = onDashboardYearChange;
window.navigateToFinanceWithFilter = navigateToFinanceWithFilter;
window.onTaxInputChange = onTaxInputChange;
window.onTaxRateChange = onTaxRateChange;
window.resetTaxInputsToDefault = resetTaxInputsToDefault;
window.onFinFilterChange = onFinFilterChange;
window.resetFinanceFilters = resetFinanceFilters;
window.goToFinPage = goToFinPage;
window.changeFinPageSize = changeFinPageSize;
