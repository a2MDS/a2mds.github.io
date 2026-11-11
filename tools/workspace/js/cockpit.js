/**
 * a2MDS Cockpit Module - Finance, Dashboard, Fixed Costs, Accounts, Tax Filing, Contacts & Job Postings Engine
 * Default Strategy Active View,
 * Accounts, Contacts & Job Postings Ledger with In-Table Filter & Dropdown Controls,
 * Direct Google Sheets 'View Data' Integration,
 * Synchronized Interactive Income Tax Strategy Simulation Engine
 */

const COCKPIT_API_URL = window.APP_CONFIG?.COCKPIT_API_URL || 'https://script.google.com/macros/s/AKfycbxwPeAGqxjvBHPRF0S4zrXKOJ-luwhdJk7yFAMYqbDAhS4LR_7s11XWbXM62wERlQkn2A/exec';

let cockpitState = {
  strategy: [],
  finance: [],
  fixedCosts: [],
  accounts: [],
  contacts: [],
  jobPostings: [],
  currentSubTab: 'strategy',
  dashboardYear: String(new Date().getFullYear()),
  isLoaded: false,
  financeFilters: {},
  accountsFilters: {},
  contactsFilters: {},
  jobFilters: {},
  multiFilters: {
    finance: { type: new Set(), category: new Set(), client: new Set(), transaction: new Set(), taxType: new Set() },
    accounts: { site: new Set(), companyId: new Set(), rootOrgUnit: new Set() },
    contacts: { imds: new Set(), regRm: new Set(), inquiry: new Set(), supplyChain: new Set(), koreca: new Set(), mdsk: new Set() },
    job: { source: new Set(), status: new Set(), outreachStatus: new Set() }
  },
  finPagination: { page: 1, pageSize: 50 },
  accPagination: { page: 1, pageSize: 50 },
  conPagination: { page: 1, pageSize: 50 },
  jobPagination: { page: 1, pageSize: 50 },
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

// HTML 특수문자 이스케이프 헬퍼
function escapeCockpitHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

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
    <div class="smelter-sub-tabs-wrapper flex-between" style="margin-top: 4px;">
      <div class="smelter-sub-tabs">
        <button type="button" class="smelter-sub-tab-btn active" id="btnCockpitTabStrategy" onclick="switchCockpitSubTab('strategy')">🎯 Strategy</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabFixed" onclick="switchCockpitSubTab('fixed')">📌 Fixed Costs</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabAccounts" onclick="switchCockpitSubTab('accounts')">🔑 Accounts</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabDashboard" onclick="switchCockpitSubTab('dashboard')">📊 Dashboard</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabFinance" onclick="switchCockpitSubTab('finance')">📋 Financial Records</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabTax" onclick="switchCockpitSubTab('tax')">💰 Tax Filing</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabContacts" onclick="switchCockpitSubTab('contacts')">📇 Contacts</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabJob" onclick="switchCockpitSubTab('job')">💼 Job Postings</button>
      </div>
      <div class="flex-start gap-1" style="padding-right: 4px;">
        <a href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" title="Open Google Calendar in new tab">
          📅 Calendar ↗
        </a>
        <a href="https://docs.google.com/spreadsheets/d/1jm0-PzwiHWIAuUM8PLUWBOs562ruGltmf5hBLZszZyc/edit?usp=drive_fs" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" title="Google Sheets 원본 열기">
          📊 View Data ↗
        </a>
      </div>
    </div>

    <!-- SUB-PANE 0: Strategy (기본 활성 탭) -->
    <div id="cockpitSubPaneStrategy" class="smelter-sub-pane active">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Business Strategy &amp; Roadmap <span class="viewer-badge" id="strategyBadgeCount">4 pillars</span></div>         
        </div>
        <div id="cockpitStrategyGrid" class="strategy-grid"></div>
      </div>
    </div>

    <!-- SUB-PANE 1: Fixed Costs -->
    <div id="cockpitSubPaneFixed" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Fixed Costs Management <span class="viewer-badge" id="fixedBadgeCount">0 items</span></div>
          <div class="viewer-actions flex-start gap-2">
            <span id="fixedTotalCostBadge" class="text-sm font-normal text-main" style="background: #f1f5f9; border: 1px solid var(--border-gray); padding: 4px 10px; border-radius: 6px;">Total Cost: ₩0</span>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitFixedTable" style="table-layout: fixed; width: 100%; min-width: 940px; font-size: 0.78rem;">
            <thead>
              <tr>
                <th class="data-table-th text-center" style="width: 45px;">No</th>
                <th class="data-table-th text-center" style="width: 220px;">Item</th>
                <th class="data-table-th text-center" style="width: 150px;">Vendor</th>
                <th class="data-table-th text-center" style="width: 110px;">Cost</th>
                <th class="data-table-th text-center" style="width: 100px;">VAT</th>
                <th class="data-table-th text-center" style="width: 120px;">First Purchase</th>
                <th class="data-table-th text-center" style="width: 100px;">Interval</th>
                <th class="data-table-th text-center">Remarks</th>
              </tr>
            </thead>
            <tbody id="cockpitFixedTableBody"></tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 1-1: Accounts -->
    <div id="cockpitSubPaneAccounts" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">System &amp; Service Accounts <span class="viewer-badge" id="accountsBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetAccountsFilters()">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitAccountsTable" style="table-layout: fixed; width: 100%; min-width: 950px; font-size: 0.78rem;">
            <thead>
              <tr>
                <th class="data-table-th text-center" style="width: 45px;">No.</th>
                <th class="data-table-th text-center" style="width: 140px;">Site</th>
                <th class="data-table-th text-center" style="width: 130px;">Company ID</th>
                <th class="data-table-th text-center" style="width: 140px;">Root / Org Unit</th>
                <th class="data-table-th text-center" style="width: 240px;">ID / Email</th>
                <th class="data-table-th text-center">Remarks</th>
              </tr>
              <tr id="accTableFilterRow">
                <th class="filter-th" style="width: 45px;"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="accMsBtn_site" onclick="toggleCockpitDropdown('accounts', 'site')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="accMsText_site">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="accMsDropdown_site"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="accMsBtn_companyId" onclick="toggleCockpitDropdown('accounts', 'companyId')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="accMsText_companyId">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="accMsDropdown_companyId"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="accMsBtn_rootOrgUnit" onclick="toggleCockpitDropdown('accounts', 'rootOrgUnit')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="accMsText_rootOrgUnit">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="accMsDropdown_rootOrgUnit"></div>
                  </div>
                </th>
                <th class="filter-th"><input type="text" id="filterAccIdEmail" class="filter-input" placeholder="ID/Email..." oninput="onAccountsFilterChange('idEmail', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterAccRemarks" class="filter-input" placeholder="Remarks..." oninput="onAccountsFilterChange('remarks', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
              </tr>
            </thead>
            <tbody id="cockpitAccountsTableBody"></tbody>
          </table>
        </div>

        <!-- Accounts Pagination Footer -->
        <div class="pagination-bar">
          <div class="flex-start gap-1">
            <span>Show</span>
            <select id="accPageSizeSelect" class="filter-input" onchange="changeAccPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div class="flex-start" style="gap: 10px;">
            <button type="button" class="btn-act" id="btnAccPrevPage" onclick="goToAccPage(cockpitState.accPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="accPageInfoDisplay" class="font-normal text-main">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnAccNextPage" onclick="goToAccPage(cockpitState.accPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 2: Dashboard -->
    <div id="cockpitSubPaneDashboard" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Financial Status &amp; Category Breakdown</div>
          <div class="viewer-actions flex-start gap-2">
            <label class="text-sm font-semibold text-muted">Year Filter:</label>
            <select id="cockpitDashboardYearSelect" class="filter-input font-medium text-sm" onchange="onDashboardYearChange(this.value)" style="padding: 4px 8px; min-width: 110px;"></select>
          </div>
        </div>
        
        <div id="cockpitDashboardContainer" class="flex-col" style="padding: 16px 20px; gap: 20px;">
          <div>
            <div class="flex-between mb-2">
              <h4 class="text-main font-bold" style="margin: 0; font-size: 0.95rem;">📌 Type Summary</h4>
              <span class="text-xs text-muted">💡 카드를 클릭하면 Financial Records 해당 장부로 즉시 이동합니다.</span>
            </div>
            <div id="dashTypeCardsWrap" class="kpi-grid"></div>
          </div>

          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px;">
            <div class="cat-breakdown-box">
              <div class="cat-breakdown-header">
                <h5 class="cat-breakdown-title kpi-val-green">🟢 Revenue by Category (매출)</h5>
                <span id="dashRevTotalBadge" class="cat-breakdown-title kpi-val-green text-sm">₩0</span>
              </div>
              <div id="dashRevCategoryList" class="cat-list"></div>
            </div>

            <div class="cat-breakdown-box">
              <div class="cat-breakdown-header">
                <h5 class="cat-breakdown-title kpi-val-amber">🟠 Expense by Category (매입)</h5>
                <span id="dashExpTotalBadge" class="cat-breakdown-title kpi-val-amber text-sm">₩0</span>
              </div>
              <div id="dashExpCategoryList" class="cat-list"></div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 3: Finance Ledger (Financial Records) -->
    <div id="cockpitSubPaneFinance" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Master Index <span class="viewer-badge" id="finBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetFinanceFilters()">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitFinanceTable" style="table-layout: fixed; width: 100%; min-width: 1030px; font-size: 0.76rem;">
            <thead>
              <tr>
                <th class="data-table-th text-center" style="width: 45px; min-width: 45px;">No.</th>
                <th class="data-table-th text-center" style="width: 90px; min-width: 90px;">Date</th>
                <th class="data-table-th text-center" style="width: 52px; min-width: 52px;">Type</th>
                <th class="data-table-th text-center" style="width: 82px; min-width: 82px;">Category</th>
                <th class="data-table-th text-center" style="width: 130px; min-width: 130px;">Client</th>
                <th class="data-table-th text-center" style="width: 105px; min-width: 105px;">Transaction</th>
                <th class="data-table-th text-center" style="min-width: 140px;">Description</th>
                <th class="data-table-th text-center" style="width: 78px; min-width: 78px;">Tax_Type</th>
                <th class="data-table-th text-center" style="width: 65px; min-width: 65px;">Total($)</th>
                <th class="data-table-th text-center" style="width: 92px; min-width: 92px;">Total(₩)</th>
                <th class="data-table-th text-center" style="width: 88px; min-width: 88px;">Supply</th>
                <th class="data-table-th text-center" style="width: 78px; min-width: 78px;">Tax</th>
              </tr>
              <tr id="finTableFilterRow">
                <th class="filter-th" style="width: 45px;"></th>
                <th class="filter-th"><input type="text" id="filterFinDate" class="filter-input" placeholder="Date..." oninput="onFinFilterChange('date', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="finMsBtn_type" onclick="toggleCockpitDropdown('finance', 'type')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="finMsText_type">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="finMsDropdown_type"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="finMsBtn_category" onclick="toggleCockpitDropdown('finance', 'category')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="finMsText_category">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="finMsDropdown_category"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="finMsBtn_client" onclick="toggleCockpitDropdown('finance', 'client')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="finMsText_client">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="finMsDropdown_client"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="finMsBtn_transaction" onclick="toggleCockpitDropdown('finance', 'transaction')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="finMsText_transaction">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="finMsDropdown_transaction"></div>
                  </div>
                </th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Description..." oninput="onFinFilterChange('description', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="finMsBtn_taxType" onclick="toggleCockpitDropdown('finance', 'taxType')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="finMsText_taxType">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="finMsDropdown_taxType"></div>
                  </div>
                </th>
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
        <div class="pagination-bar">
          <div class="flex-start gap-1">
            <span>Show</span>
            <select id="finPageSizeSelect" class="filter-input" onchange="changeFinPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div class="flex-start" style="gap: 10px;">
            <button type="button" class="btn-act" id="btnFinPrevPage" onclick="goToFinPage(cockpitState.finPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="finPageInfoDisplay" class="font-normal text-main">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnFinNextPage" onclick="goToFinPage(cockpitState.finPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 4: Tax Filing Dashboard -->
    <div id="cockpitSubPaneTax" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Tax Filing Report</div>
          <div class="viewer-actions flex-start" style="gap: 10px;">
            <span class="text-xs" style="color: #64748b; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: nowrap;">
              🗓 부가세 신고: <strong>1월 &amp; 7월</strong> <span style="color: #cbd5e1; margin: 0 4px;">|</span> 종소세 신고: <strong>5월</strong>
            </span>
            <select id="taxFilingPeriodSelect" class="filter-input font-medium" style="padding: 4px 8px; min-width: 230px;" onchange="onTaxPeriodChange(this.value)"></select>
          </div>
        </div>

        <div style="padding: 16px;">
          <!-- 1. VAT Section -->
          <div id="taxVatSectionBlock" style="display: none;">
            <h4 class="text-main flex-between mb-2" style="margin-top: 0; font-size: 0.95rem; font-weight: 600;">
              <span>VAT Declaration</span>
              <span id="taxVatNetBadge" class="text-sm font-medium" style="padding: 2px 8px; border-radius: 4px;">-</span>
            </h4>
            <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; max-height: none !important; height: auto !important; overflow-y: visible !important;">
              <table class="data-table" style="table-layout: fixed; width: 100%;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th class="data-table-th text-center" style="width: 220px;">구분 (Hometax Entry)</th>
                    <th class="data-table-th text-center">세부 내역 및 증빙</th>
                    <th class="data-table-th text-center" style="width: 185px;">공급가액 (Supply Value)</th>
                    <th class="data-table-th text-center" style="width: 145px;">세액 (Tax Amount)</th>
                  </tr>
                </thead>
                <tbody id="taxVatTableBody"></tbody>
              </table>
            </div>
          </div>

          <!-- 2. Income Tax Section & Strategy -->
          <div id="taxIncomeSectionBlock" style="display: none;">
            <div class="flex-between mb-2">
              <h4 class="text-main flex-start gap-2" style="margin: 0; font-size: 0.95rem; font-weight: 600;">
                <span>절세전략비교 (종합소득세 시뮬레이션)</span>
                <span class="text-xs font-normal" style="color: #0369a1; background: #e0f2fe; padding: 2px 8px; border-radius: 12px; border: 1px solid #bae6fd;">간편장부 입력 시 기준경비 자동 반영</span>
              </h4>
              <div class="flex-start gap-2">
                <button type="button" class="btn-act text-xs" onclick="resetTaxInputsToDefault()" style="padding: 3px 8px;" title="시트 원본 기본값으로 복원">↺ 원본값 리셋</button>
                <span id="taxIncomeNetBadge" class="text-sm font-medium" style="padding: 2px 8px; border-radius: 4px;">-</span>
              </div>
            </div>
            
            <div class="table-wrapper mb-4" style="border: 1px solid var(--border-gray); border-radius: 4px; max-height: none !important; height: auto !important; overflow-y: visible !important; overflow-x: hidden;">
              <table class="data-table" id="taxStrategyTable" style="table-layout: fixed; width: 100%; font-size: 0.78rem;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th class="data-table-th text-center" style="width: 175px; padding: 6px 8px;">구분 항목</th>
                    <th class="data-table-th text-center" style="width: 145px; padding: 6px 8px;">간편장부 ✏️</th>
                    <th class="data-table-th text-center" style="width: 155px; padding: 6px 8px;">
                      기준경비 (<input type="number" step="0.1" min="0" max="100" style="width: 48px; padding: 2px 4px; font-size: 0.78rem; text-align: center; border: 1px solid #93c5fd; border-radius: 4px; background: #eff6ff; font-weight: 600; color: #1d4ed8; outline: none;" value="16" onchange="onTaxRateChange(this)">%) ✏️
                    </th>
                    <th class="data-table-th text-center" style="padding: 6px 10px;">비고 및 계산 근거</th>
                  </tr>
                </thead>
                <tbody id="taxStrategyTableBody"></tbody>
              </table>
            </div>

            <div style="background: #f8fafc; border: 1px solid var(--border-gray); border-radius: 4px; padding: 12px 16px; font-size: 0.82rem; line-height: 1.6;">
              <div class="font-semibold mb-1" style="color: #15803d;">💡 무엇이 유리한지 여기서 비교 &amp; 3대 절세 행동 요령</div>
              <div class="text-body">
                1. <strong>간편장부 작성 필수:</strong> 용인시 일반 창업 감면(산출세액 50%)은 간편장부 기장 시에만 적용되며, 기준경비 추계신고 시 전액 배제됩니다.<br>
                2. <strong>공제 한도 최대 채우기:</strong> 노란우산공제(최대 500만 원)와 개인연금저축(최대 600만 원)은 한도까지 납입하여 세액공제를 극대화합니다.<br>
                3. 가계 생활비 등 기타 지출은 <strong>와이프 명의 카드로 집중</strong>하여 대표님 장부 단순성 및 공제 비율을 최적화합니다.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 5: Contacts (Name (Email) 통합 열) -->
    <div id="cockpitSubPaneContacts" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Contacts Directory <span class="viewer-badge" id="conBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetContactsFilters()">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitContactsTable" style="table-layout: fixed; width: 100%; min-width: 1200px; font-size: 0.76rem;">
            <thead>
              <tr>
                <th class="data-table-th text-center" style="width: 3.5%;">No.</th>
                <th class="data-table-th text-center" style="width: 8%;">Name (Email)</th>
                <th class="data-table-th text-center" style="width: 12%;">Company</th>
                <th class="data-table-th text-center" style="width: 8%;">Job Title</th>
                <th class="data-table-th text-center" style="width: 6%;">IMDS</th>
                <th class="data-table-th text-center" style="width: 6%;">Reg/RM</th>
                <th class="data-table-th text-center" style="width: 6%;">Inquiry</th>
                <th class="data-table-th text-center" style="width: 8%;">Supply Chain</th>
                <th class="data-table-th text-center" style="width: 6%;">KORECA</th>
                <th class="data-table-th text-center" style="width: 6%;">MDSK</th>
                <th class="data-table-th text-center" style="width: auto;">Remarks</th>
              </tr>
              <tr id="conTableFilterRow">
                <th class="filter-th" style="width: 40px;"></th>
                <th class="filter-th"><input type="text" id="filterConName" class="filter-input" placeholder="Search Name/Email..." oninput="onContactsFilterChange('name', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterConCompany" class="filter-input" placeholder="Company..." oninput="onContactsFilterChange('company', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterConJobTitle" class="filter-input" placeholder="Title..." oninput="onContactsFilterChange('jobTitle', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_imds" onclick="toggleCockpitDropdown('contacts', 'imds')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_imds">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_imds"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_regRm" onclick="toggleCockpitDropdown('contacts', 'regRm')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_regRm">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_regRm"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_inquiry" onclick="toggleCockpitDropdown('contacts', 'inquiry')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_inquiry">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_inquiry"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_supplyChain" onclick="toggleCockpitDropdown('contacts', 'supplyChain')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_supplyChain">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_supplyChain"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_koreca" onclick="toggleCockpitDropdown('contacts', 'koreca')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_koreca">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_koreca"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="conMsBtn_mdsk" onclick="toggleCockpitDropdown('contacts', 'mdsk')" style="padding: 2px 3px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="conMsText_mdsk">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="conMsDropdown_mdsk"></div>
                  </div>
                </th>
                <th class="filter-th"><input type="text" id="filterConRemarks" class="filter-input" placeholder="Remarks..." oninput="onContactsFilterChange('remarks', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
              </tr>
            </thead>
            <tbody id="cockpitContactsTableBody"></tbody>
          </table>
        </div>

        <!-- Contacts Pagination Footer -->
        <div class="pagination-bar">
          <div class="flex-start gap-1">
            <span>Show</span>
            <select id="conPageSizeSelect" class="filter-input" onchange="changeConPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div class="flex-start" style="gap: 10px;">
            <button type="button" class="btn-act" id="btnConPrevPage" onclick="goToConPage(cockpitState.conPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="conPageInfoDisplay" class="font-normal text-main">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnConNextPage" onclick="goToConPage(cockpitState.conPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 6: Job Postings (Contacts 오른쪽 배치) -->
    <div id="cockpitSubPaneJob" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Job Postings <span class="viewer-badge" id="jobBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetJobPostingsFilters()">🧹 Clear Filters</button>
          </div>
        </div>

        <!-- Screening 현황 (Blank, In Progress & Outreach, Reached out) 고정 섹션 -->
        <div style="border-bottom: 1px solid var(--border-gray); background: #f8fafc;">
          <div class="flex-start gap-2" style="padding: 8px 14px;">
            <span class="text-sm font-semibold text-main">💼 Screening Status Overview</span>
            <span class="viewer-badge text-muted text-xs" id="jobOutreachTotalBadge" style="background: #e2e8f0; padding: 1px 6px;">0 entries</span>
          </div>
          <div id="jobOutreachSummaryBody" class="flex-start gap-1 flex-wrap" style="padding: 6px 14px 12px 14px; background: #ffffff; border-top: 1px solid #f1f5f9;"></div>
        </div>

        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitJobPostingsTable" style="table-layout: fixed; width: 100%; font-size: 0.76rem;">
            <thead>
              <tr>
                <th class="data-table-th text-center" style="width: 3.5%;">No.</th>
                <th class="data-table-th text-center" style="width: 6.5%;">Source</th>
                <th class="data-table-th text-center" style="width: 7%;">Searched</th>
                <th class="data-table-th text-center" style="width: 11%;">Company</th>
                <th class="data-table-th text-center" style="width: 21%;">Job Title (Link)</th>
                <th class="data-table-th text-center" style="width: 8.5%;">Screening</th>
                <th class="data-table-th text-center" style="width: 8.5%;">Outreach Status</th>
                <th class="data-table-th text-center" style="width: 13%;">Contact (E-mail)</th>
                <th class="data-table-th text-center" style="width: 21%;">Remarks</th>
              </tr>
              <tr id="jobTableFilterRow">
                <th class="filter-th"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="jobMsBtn_source" onclick="toggleCockpitDropdown('job', 'source')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="jobMsText_source">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="jobMsDropdown_source"></div>
                  </div>
                </th>
                <th class="filter-th"><input type="text" id="filterJobDateSearched" class="filter-input" placeholder="Date..." oninput="onJobPostingsFilterChange('dateSearched', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterJobCompany" class="filter-input" placeholder="Company..." oninput="onJobPostingsFilterChange('company', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterJobTitle" class="filter-input" placeholder="Title..." oninput="onJobPostingsFilterChange('title', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="jobMsBtn_status" onclick="toggleCockpitDropdown('job', 'status')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="jobMsText_status">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="jobMsDropdown_status"></div>
                  </div>
                </th>
                <th class="filter-th" style="padding: 3px 2px;">
                  <div class="multiselect-container">
                    <button type="button" class="multiselect-btn" id="jobMsBtn_outreachStatus" onclick="toggleCockpitDropdown('job', 'outreachStatus')" style="padding: 2px 4px; font-size: 0.73rem;">
                      <span class="multiselect-btn-text" id="jobMsText_outreachStatus">All</span>
                      <span style="font-size: 0.6rem; color: #64748b;">▼</span>
                    </button>
                    <div class="multiselect-dropdown" id="jobMsDropdown_outreachStatus"></div>
                  </div>
                </th>
                <th class="filter-th"><input type="text" id="filterJobContact" class="filter-input" placeholder="Contact/Email..." oninput="onJobPostingsFilterChange('contact', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
                <th class="filter-th"><input type="text" id="filterJobRemarks" class="filter-input" placeholder="Remarks..." oninput="onJobPostingsFilterChange('remarks', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
              </tr>
            </thead>
            <tbody id="cockpitJobPostingsTableBody"></tbody>
          </table>
        </div>

        <!-- Job Postings Pagination Footer -->
        <div class="pagination-bar">
          <div class="flex-start gap-1">
            <span>Show</span>
            <select id="jobPageSizeSelect" class="filter-input" onchange="changeJobPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div class="flex-start" style="gap: 10px;">
            <button type="button" class="btn-act" id="btnJobPrevPage" onclick="goToJobPage(cockpitState.jobPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="jobPageInfoDisplay" class="font-normal text-main">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnJobNextPage" onclick="goToJobPage(cockpitState.jobPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
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
      cockpitState.strategy = json.data.strategy || [];
      cockpitState.finance = json.data.finance || [];
      cockpitState.accounts = json.data.accounts || [];
      cockpitState.contacts = json.data.contacts || [];
      cockpitState.jobPostings = json.data.jobPostings || [];

      const rawFixed = json.data.fixedCosts || [];
      cockpitState.fixedCosts = rawFixed.map((r, idx) => {
        if (Array.isArray(r)) {
          const cleanCost = parseInt(String(r[3] || '').replace(/[^\d-]/g, ''), 10) || 0;
          const cleanVat = parseInt(String(r[4] || '').replace(/[^\d-]/g, ''), 10) || 0;
          return {
            no: idx + 1,
            item: String(r[0] || '').trim(),
            vendor: String(r[1] || '').trim(),
            vendorLink: String(r[2] || '').trim(),
            cost: cleanCost,
            vat: cleanVat,
            firstPurchase: String(r[5] || '').slice(0, 10),
            interval: String(r[6] || 'Annual').trim(),
            remarks: String(r[7] || '').trim()
          };
        }
        return {
          ...r,
          no: idx + 1
        };
      });

      cockpitState.isLoaded = true;

      populateDynamicFilterOptions();
      populateAccountsFilterOptions();
      populateContactsFilterOptions();
      populateJobPostingsFilterOptions();
      // Job Postings: Screening 기본 필터를 (blank) 및 In Progress로 사전 설정
      setDefaultJobScreeningFilters();

      populateTaxPeriodDropdown();
      populateDashboardYearDropdown();
      renderStrategyView();
      renderFinanceTable();
      renderAccountsTable();
      renderContactsTable();
      renderJobPostingsTable();
      renderDashboardView();
      renderFixedCostsTable();
      renderTaxFilingView();

      switchCockpitSubTab('strategy');
    }
  } catch (err) {
    console.error('Failed to load cockpit data:', err);
  }
}

// 3. Cockpit 통합 다중 선택 드롭다운 엔진 (동적 옵션, (blank) 연한 회색 지원)
function getCockpitPrefix(tab) {
  if (tab === 'finance') return 'fin';
  if (tab === 'accounts') return 'acc';
  if (tab === 'contacts') return 'con';
  if (tab === 'job') return 'job';
  return tab;
}

function getCockpitDataset(tab) {
  if (tab === 'finance') return cockpitState.finance || [];
  if (tab === 'accounts') return cockpitState.accounts || [];
  if (tab === 'contacts') return cockpitState.contacts || [];
  if (tab === 'job') return cockpitState.jobPostings || [];
  return [];
}

function populateCockpitDropdown(tab, key) {
  const pfx = getCockpitPrefix(tab);
  const dd = document.getElementById(`${pfx}MsDropdown_${key}`);
  if (!dd) return;

  const dataset = getCockpitDataset(tab);
  const currentSet = cockpitState.multiFilters[tab]?.[key] || new Set();
  const uniqueSet = new Set();
  let hasBlank = false;

  dataset.forEach(item => {
    const rawVal = item[key];
    const val = String(rawVal !== undefined && rawVal !== null ? rawVal : '').trim();
    if (!val || val === '-') {
      hasBlank = true;
    } else {
      uniqueSet.add(val);
    }
  });

  const unique = Array.from(uniqueSet).sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }));
  if (hasBlank) unique.unshift('(blank)');

  const validSet = new Set(unique);
  for (const v of currentSet) {
    if (!validSet.has(v)) currentSet.delete(v);
  }

  const msText = document.getElementById(`${pfx}MsText_${key}`);
  if (msText) msText.textContent = !currentSet.size ? 'All' : `${currentSet.size} selected`;

  dd.innerHTML = `
    <label class="multiselect-item">
      <input type="checkbox" id="${pfx}ChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="selectAllCockpitDropdown('${tab}', '${key}', this)">
      <span>(Select All)</span>
    </label>
    <hr style="margin: 3px 0; border: 0; border-top: 1px solid #e5e7eb;">` +
    unique.map(val => {
      let displayLabel = escapeCockpitHtml(val);
      if (val === '(blank)') displayLabel = '<span class="text-muted font-normal">(blank)</span>';
      const safeVal = escapeCockpitHtml(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" value="${safeVal}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCockpitDropdownItem('${tab}', '${key}', '${safeVal}', this.checked)">
          <span>${displayLabel}</span>
        </label>`;
    }).join('');
}

function toggleCockpitDropdown(tab, key) {
  const pfx = getCockpitPrefix(tab);
  const dd = document.getElementById(`${pfx}MsDropdown_${key}`);
  const btn = document.getElementById(`${pfx}MsBtn_${key}`);
  if (!dd || !btn) return;

  const isShowing = dd.classList.contains('show');
  document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

  if (!isShowing) {
    populateCockpitDropdown(tab, key);
    const r = btn.getBoundingClientRect();
    dd.style.top = `${r.bottom + 4}px`;
    dd.style.left = `${Math.max(10, Math.min(r.left, window.innerWidth - 240))}px`;
    dd.classList.add('show');
  }
}

function selectAllCockpitDropdown(tab, key, chk) {
  const pfx = getCockpitPrefix(tab);
  if (cockpitState.multiFilters[tab]?.[key]) {
    cockpitState.multiFilters[tab][key].clear();
  }
  document.querySelectorAll(`#${pfx}MsDropdown_${key} input[type="checkbox"]`).forEach(c => {
    if (c !== chk) c.checked = false;
  });
  const msText = document.getElementById(`${pfx}MsText_${key}`);
  if (msText) msText.textContent = 'All';

  triggerCockpitTableRender(tab);
}

function toggleCockpitDropdownItem(tab, key, val, checked) {
  const pfx = getCockpitPrefix(tab);
  if (!cockpitState.multiFilters[tab]) cockpitState.multiFilters[tab] = {};
  if (!cockpitState.multiFilters[tab][key]) cockpitState.multiFilters[tab][key] = new Set();

  const set = cockpitState.multiFilters[tab][key];
  checked ? set.add(val) : set.delete(val);

  const chkAll = document.getElementById(`${pfx}ChkAll_${key}`);
  if (chkAll) chkAll.checked = !set.size;
  const msText = document.getElementById(`${pfx}MsText_${key}`);
  if (msText) msText.textContent = !set.size ? 'All' : `${set.size} selected`;

  triggerCockpitTableRender(tab);
}

function triggerCockpitTableRender(tab) {
  if (tab === 'finance') {
    cockpitState.finPagination.page = 1;
    renderFinanceTable();
  } else if (tab === 'accounts') {
    cockpitState.accPagination.page = 1;
    renderAccountsTable();
  } else if (tab === 'contacts') {
    cockpitState.conPagination.page = 1;
    renderContactsTable();
  } else if (tab === 'job') {
    cockpitState.jobPagination.page = 1;
    renderJobPostingsTable();
  }
}

function populateDynamicFilterOptions() {
  ['type', 'category', 'client', 'transaction', 'taxType'].forEach(k => populateCockpitDropdown('finance', k));
}
function populateAccountsFilterOptions() {
  ['site', 'companyId', 'rootOrgUnit'].forEach(k => populateCockpitDropdown('accounts', k));
}
function populateContactsFilterOptions() {
  ['imds', 'regRm', 'inquiry', 'supplyChain', 'koreca', 'mdsk'].forEach(k => populateCockpitDropdown('contacts', k));
}
function populateJobPostingsFilterOptions() {
  ['source', 'status', 'outreachStatus'].forEach(k => populateCockpitDropdown('job', k));
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
  ['Strategy', 'Fixed', 'Accounts', 'Dashboard', 'Finance', 'Tax', 'Contacts', 'Job'].forEach(t => {
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

  if (tab === 'strategy') renderStrategyView();
  if (tab === 'fixed') renderFixedCostsTable();
  if (tab === 'accounts') renderAccountsTable();
  if (tab === 'dashboard') renderDashboardView();
  if (tab === 'finance') renderFinanceTable();
  if (tab === 'tax') renderTaxFilingView();
  if (tab === 'contacts') renderContactsTable();
  if (tab === 'job') renderJobPostingsTable();
}

// 6-1. Strategy 뷰 렌더링
function renderStrategyView() {
  const container = document.getElementById('cockpitStrategyGrid');
  const badge = document.getElementById('strategyBadgeCount');
  if (!container) return;

  const list = cockpitState.strategy || [];
  if (badge) badge.innerText = `${list.length} pillars`;

  if (list.length === 0) {
    container.innerHTML = '<div class="empty-state-row" style="grid-column: 1 / -1; padding: 40px;">등록된 전략 데이터가 없습니다. Google Sheets의 Strategy 탭을 확인해 주세요.</div>';
    return;
  }

  const getThemeClass = (title) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('목표') || t.includes('objective')) return { cls: 'theme-objective', icon: '', badge: 'Core Missions' };
    if (t.includes('기본') || t.includes('fundamental')) return { cls: 'theme-activities', icon: '', badge: 'Daily Operations' };
    if (t.includes('단기') || t.includes('short')) return { cls: 'theme-shortterm', icon: '', badge: 'Immediate Execution' };
    if (t.includes('장기') || t.includes('long')) return { cls: 'theme-longterm', icon: '', badge: 'Growth & Expansion' };
    return { cls: 'theme-objective', icon: '📌', badge: 'Strategy' };
  };

  container.innerHTML = list.map(item => {
    const meta = getThemeClass(item.title);

    const korItems = String(item.detailsKor || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const engItems = String(item.detailsEng || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const count = Math.max(korItems.length, engItems.length);

    let itemsHtml = '';
    for (let i = 0; i < count; i++) {
      const kor = korItems[i] || '';
      const eng = engItems[i] || '';
      itemsHtml += `
        <li class="strategy-item-box">
          <div class="strategy-item-kor">
            <span class="strategy-bullet-icon">▪</span>
            <span>${kor}</span>
          </div>
          ${eng ? `<div class="strategy-item-eng">${eng}</div>` : ''}
        </li>
      `;
    }

    return `
      <div class="strategy-card ${meta.cls}">
        <div class="strategy-card-header">
          <h4 class="strategy-card-title">
            <span>${meta.icon}</span>
            <span>${item.title}</span>
          </h4>
          <span class="strategy-card-badge">${meta.badge}</span>
        </div>
        <ul class="strategy-items-list">
          ${itemsHtml || '<li class="text-muted text-xs">내역 없음</li>'}
        </ul>
      </div>
    `;
  }).join('');
}

// 다중 선택 Set 매칭 헬퍼
function checkCockpitMultiMatch(cellVal, set) {
  if (!set || set.size === 0) return true;
  const v = String(cellVal !== undefined && cellVal !== null ? cellVal : '').trim();
  if (!v || v === '-') {
    return set.has('(blank)');
  }
  return set.has(v);
}

// 7. Finance 테이블 렌더링 & 페이지네이션 (다중선택 연동)
function renderFinanceTable() {
  const tbody = document.getElementById('cockpitFinanceTableBody');
  const badge = document.getElementById('finBadgeCount');
  if (!tbody) return;

  const f = cockpitState.financeFilters;
  const mf = cockpitState.multiFilters.finance;

  const filtered = cockpitState.finance.filter(row => {
    if (f.date && !String(row.date || '').includes(f.date)) return false;
    if (!checkCockpitMultiMatch(row.type, mf.type)) return false;
    if (!checkCockpitMultiMatch(row.category, mf.category)) return false;
    if (!checkCockpitMultiMatch(row.client, mf.client)) return false;
    if (!checkCockpitMultiMatch(row.transaction, mf.transaction)) return false;
    if (f.description && !String(row.description || '').toLowerCase().includes(f.description.toLowerCase())) return false;
    if (!checkCockpitMultiMatch(row.taxType, mf.taxType)) return false;
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
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const isInc = r.type === '매출';
    const isTax = r.type === '세금';
    const tagBg = isInc ? '#ecfdf5' : (isTax ? '#fef3c7' : '#fef2f2');
    const tagColor = isInc ? '#16a34a' : (isTax ? '#d97706' : '#dc2626');

    const krw = Math.round(Number(r.totalKRW) || 0).toLocaleString('ko-KR');
    const sup = Math.round(Number(r.supply) || 0).toLocaleString('ko-KR');
    const tax = Math.round(Number(r.tax) || 0).toLocaleString('ko-KR');
    const usd = r.totalUSD ? `$${Math.round(Number(r.totalUSD)).toLocaleString('en-US')}` : '';

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${actualNo}</td>
        <td class="data-cell font-normal" style="white-space: nowrap;">${r.date || ''}</td>
        <td class="data-cell cell-center font-normal"><span style="background: ${tagBg}; color: ${tagColor}; padding: 1px 4px; border-radius: 4px; font-size: 0.72rem;">${r.type}</span></td>
        <td class="data-cell text-body font-normal">${r.category || ''}</td>
        <td class="data-cell font-normal" style="white-space: nowrap;">${r.client || ''}</td>
        <td class="data-cell text-muted font-normal">${r.transaction || ''}</td>
        <td class="data-cell cell-ellipsis font-normal" title="${r.description || ''}">${r.description || ''}</td>
        <td class="data-cell cell-center text-muted font-normal text-xs">${r.taxType || ''}</td>
        <td class="data-cell cell-right kpi-val-green font-normal">${usd}</td>
        <td class="data-cell cell-right font-normal">₩${krw}</td>
        <td class="data-cell cell-right text-muted font-normal">₩${sup}</td>
        <td class="data-cell cell-right text-muted font-normal">₩${tax}</td>
      </tr>
    `;
  }).join('');
}

function goToFinPage(page) {
  const f = cockpitState.financeFilters;
  const mf = cockpitState.multiFilters.finance;
  const filteredCount = cockpitState.finance.filter(row => {
    if (f.date && !String(row.date || '').includes(f.date)) return false;
    if (!checkCockpitMultiMatch(row.type, mf.type)) return false;
    if (!checkCockpitMultiMatch(row.category, mf.category)) return false;
    if (!checkCockpitMultiMatch(row.client, mf.client)) return false;
    if (!checkCockpitMultiMatch(row.transaction, mf.transaction)) return false;
    if (f.description && !String(row.description || '').toLowerCase().includes(f.description.toLowerCase())) return false;
    if (!checkCockpitMultiMatch(row.taxType, mf.taxType)) return false;
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

function filterAccountsList(accounts, f, mf) {
  return accounts.filter(row => {
    if (!checkCockpitMultiMatch(row.site, mf.site)) return false;
    if (!checkCockpitMultiMatch(row.companyId, mf.companyId)) return false;
    if (!checkCockpitMultiMatch(row.rootOrgUnit, mf.rootOrgUnit)) return false;
    if (f.idEmail) {
      const idStr = String(row.idEmail || '').trim();
      if (idStr === '-') return false;
      if (!idStr.toLowerCase().includes(f.idEmail.toLowerCase())) return false;
    }
    if (f.remarks) {
      const remStr = String(row.remarks || '').trim();
      if (remStr === '-') return false;
      if (!remStr.toLowerCase().includes(f.remarks.toLowerCase())) return false;
    }
    return true;
  });
}

// 7-1. Accounts 테이블 렌더링 & 페이지네이션
function renderAccountsTable() {
  const tbody = document.getElementById('cockpitAccountsTableBody');
  const badge = document.getElementById('accountsBadgeCount');
  if (!tbody) return;

  const filtered = filterAccountsList(cockpitState.accounts, cockpitState.accountsFilters, cockpitState.multiFilters.accounts);

  const totalItems = filtered.length;
  const p = cockpitState.accPagination;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  const pageInfo = document.getElementById('accPageInfoDisplay');
  const btnPrev = document.getElementById('btnAccPrevPage');
  const btnNext = document.getElementById('btnAccNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const cleanCell = v => {
      const s = String(v || '').trim();
      return (s === '-' || !s) ? '' : s;
    };

    const site = cleanCell(r.site);
    const compId = cleanCell(r.companyId);
    const rootOrg = cleanCell(r.rootOrgUnit);
    const idEmail = cleanCell(r.idEmail);
    const remarks = cleanCell(r.remarks);

    return `
      <tr>
        <td class="data-cell cell-center text-muted font-normal text-sm">${actualNo}</td>
        <td class="data-cell font-normal text-main">${escapeCockpitHtml(site)}</td>
        <td class="data-cell cell-center font-mono font-normal text-body">${escapeCockpitHtml(compId)}</td>
        <td class="data-cell cell-center text-muted font-normal">${escapeCockpitHtml(rootOrg)}</td>
        <td class="data-cell font-mono font-normal" style="color: #1e293b;">${escapeCockpitHtml(idEmail)}</td>
        <td class="data-cell col-multiline font-normal">${escapeCockpitHtml(remarks)}</td>
      </tr>
    `;
  }).join('');
}

function goToAccPage(page) {
  const filteredCount = filterAccountsList(cockpitState.accounts, cockpitState.accountsFilters, cockpitState.multiFilters.accounts).length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / cockpitState.accPagination.pageSize));
  if (page < 1 || page > totalPages) return;
  cockpitState.accPagination.page = page;
  renderAccountsTable();
}

function onAccountsFilterChange(col, val) {
  cockpitState.accountsFilters[col] = val.trim();
  cockpitState.accPagination.page = 1;
  renderAccountsTable();
}

function resetAccountsFilters() {
  cockpitState.accountsFilters = {};
  Object.keys(cockpitState.multiFilters.accounts).forEach(k => cockpitState.multiFilters.accounts[k].clear());
  cockpitState.accPagination.page = 1;
  document.querySelectorAll('#accTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#accTableFilterRow .multiselect-btn-text').forEach(t => t.textContent = 'All');
  renderAccountsTable();
}

function changeAccPageSize(newSize) {
  cockpitState.accPagination.pageSize = parseInt(newSize, 10) || 50;
  cockpitState.accPagination.page = 1;
  renderAccountsTable();
}

// 7-2. Contacts 테이블 렌더링 & 페이지네이션 & 클립보드 복사
function copyContactEmail(email) {
  if (!email || email === '-') return;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(email).catch(() => {
      fallbackCopyText(email);
    });
  } else {
    fallbackCopyText(email);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function filterContactsList(contacts, f, mf) {
  return contacts.filter(row => {
    if (f.name) {
      const q = f.name.toLowerCase();
      const matchName = String(row.name || '').toLowerCase().includes(q);
      const matchEmail = String(row.email || '').toLowerCase().includes(q);
      if (!matchName && !matchEmail) return false;
    }
    if (f.company && !String(row.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.jobTitle && !String(row.jobTitle || '').toLowerCase().includes(f.jobTitle.toLowerCase())) return false;
    if (!checkCockpitMultiMatch(row.imds, mf.imds)) return false;
    if (!checkCockpitMultiMatch(row.regRm, mf.regRm)) return false;
    if (!checkCockpitMultiMatch(row.inquiry, mf.inquiry)) return false;
    if (!checkCockpitMultiMatch(row.supplyChain, mf.supplyChain)) return false;
    if (!checkCockpitMultiMatch(row.koreca, mf.koreca)) return false;
    if (!checkCockpitMultiMatch(row.mdsk, mf.mdsk)) return false;
    if (f.remarks && !String(row.remarks || '').toLowerCase().includes(f.remarks.toLowerCase())) return false;
    return true;
  });
}

function renderContactsTable() {
  const tbody = document.getElementById('cockpitContactsTableBody');
  const badge = document.getElementById('conBadgeCount');
  if (!tbody) return;

  const filtered = filterContactsList(cockpitState.contacts, cockpitState.contactsFilters, cockpitState.multiFilters.contacts);

  const totalItems = filtered.length;
  const p = cockpitState.conPagination;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  const pageInfo = document.getElementById('conPageInfoDisplay');
  const btnPrev = document.getElementById('btnConPrevPage');
  const btnNext = document.getElementById('btnConNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const name = String(r.name || '').trim();
    const company = r.company || '';
    const jobTitle = r.jobTitle || '';
    const email = String(r.email || '').trim();
    const imds = r.imds || '';
    const regRm = r.regRm || '';
    const inquiry = r.inquiry || '';
    const supplyChain = r.supplyChain || '';
    const koreca = r.koreca || '';
    const mdsk = r.mdsk || '';
    const remarks = r.remarks || '';

    let nameHtml = escapeCockpitHtml(name || '-');
    if (email && email !== '-') {
      nameHtml = `<a href="mailto:${escapeCockpitHtml(email)}" class="text-info font-normal" style="text-decoration: none;" title="Send Email to ${escapeCockpitHtml(email)}">${escapeCockpitHtml(name || email)}</a>`;
    }

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${actualNo}</td>
        <td class="data-cell font-normal cell-ellipsis" title="${name} (${email})">${nameHtml}</td>
        <td class="data-cell text-body font-normal">${escapeCockpitHtml(company)}</td>
        <td class="data-cell cell-center text-muted font-normal">${escapeCockpitHtml(jobTitle)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(imds)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(regRm)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(inquiry)}</td>
        <td class="data-cell cell-center text-primary font-normal">${escapeCockpitHtml(supplyChain)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(koreca)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(mdsk)}</td>
        <td class="data-cell col-multiline font-normal">${escapeCockpitHtml(remarks)}</td>
      </tr>
    `;
  }).join('');
}

function onContactsFilterChange(col, val) {
  cockpitState.contactsFilters[col] = val.trim();
  cockpitState.conPagination.page = 1;
  renderContactsTable();
}

function resetContactsFilters() {
  cockpitState.contactsFilters = {};
  Object.keys(cockpitState.multiFilters.contacts).forEach(k => cockpitState.multiFilters.contacts[k].clear());
  cockpitState.conPagination.page = 1;
  document.querySelectorAll('#conTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#conTableFilterRow .multiselect-btn-text').forEach(t => t.textContent = 'All');
  renderContactsTable();
}

function goToConPage(page) {
  const filteredCount = filterContactsList(cockpitState.contacts, cockpitState.contactsFilters, cockpitState.multiFilters.contacts).length;
  const totalPages = Math.max(1, Math.ceil(filteredCount / cockpitState.conPagination.pageSize));
  if (page < 1 || page > totalPages) return;
  cockpitState.conPagination.page = page;
  renderContactsTable();
}

function changeConPageSize(newSize) {
  cockpitState.conPagination.pageSize = parseInt(newSize, 10) || 50;
  cockpitState.conPagination.page = 1;
  renderContactsTable();
}

// 7-3. Job Postings 테이블 렌더링 & 페이지네이션 (Title 클릭 시 Link 이동 연동)
function filterJobPostingsList(list, f, mf) {
  return list.filter(row => {
    if (!checkCockpitMultiMatch(row.source, mf.source)) return false;
    if (f.dateSearched && !String(row.dateSearched || '').includes(f.dateSearched)) return false;
    if (f.company && !String(row.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.title && !String(row.title || '').toLowerCase().includes(f.title.toLowerCase())) return false;
    if (!checkCockpitMultiMatch(row.status || row.screening, mf.status)) return false;
    if (!checkCockpitMultiMatch(row.outreachStatus, mf.outreachStatus)) return false;
    if (f.contact) {
      const q = f.contact.toLowerCase();
      const matchName = String(row.contactName || '').toLowerCase().includes(q);
      const matchEmail = String(row.contactEmail || '').toLowerCase().includes(q);
      if (!matchName && !matchEmail) return false;
    }
    if (f.remarks && !String(row.remarks || '').toLowerCase().includes(f.remarks.toLowerCase())) return false;
    return true;
  });
}

function renderJobPostingsTable() {
  const tbody = document.getElementById('cockpitJobPostingsTableBody');
  const badge = document.getElementById('jobBadgeCount');
  if (!tbody) return;

  const filtered = filterJobPostingsList(cockpitState.jobPostings, cockpitState.jobFilters, cockpitState.multiFilters.job);
  filtered.sort((a, b) => String(b.dateSearched || '').localeCompare(String(a.dateSearched || '')));

  const totalItems = filtered.length;
  const p = cockpitState.jobPagination;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  const pageInfo = document.getElementById('jobPageInfoDisplay');
  const btnPrev = document.getElementById('btnJobPrevPage');
  const btnNext = document.getElementById('btnJobNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state-row text-sm">No records found.</td></tr>';
    updateJobOutreachSummary();
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const actualNo = startIdx + idx + 1;
    const cleanCell = v => {
      const s = String(v || '').trim();
      return (s === '-' || !s) ? '' : s;
    };

    const source = cleanCell(r.source);
    const dateSearched = cleanCell(r.dateSearched);
    const company = cleanCell(r.company);
    const link = cleanCell(r.link);
    const title = cleanCell(r.title);
    const status = cleanCell(r.status || r.screening);
    const outreachStatus = cleanCell(r.outreachStatus);
    const contactName = cleanCell(r.contactName);
    const contactEmail = cleanCell(r.contactEmail);
    const remarks = cleanCell(r.remarks);

    let titleHtml = escapeCockpitHtml(title);
    if (link) {
      titleHtml = `<a href="${escapeCockpitHtml(link)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration: none;" title="Open Job Link">${escapeCockpitHtml(title || 'Link')}</a>`;
    }

    let contactHtml = '';
    const contactDisplay = contactName || contactEmail;
    if (contactEmail && contactEmail !== '-') {
      contactHtml = `<span class="clickable-cid font-normal" data-email="${escapeCockpitHtml(contactEmail)}" onclick="copyContactEmail(this.getAttribute('data-email'))" title="Click to copy email (${escapeCockpitHtml(contactEmail)})">${escapeCockpitHtml(contactDisplay)}</span>`;
    } else if (contactName) {
      contactHtml = `<span class="text-body font-normal">${escapeCockpitHtml(contactName)}</span>`;
    }

    const stClean = status.toLowerCase().replace(/[\s-_]+/g, '');
    let statusColor = '#64748b';
    if (stClean === 'inprogress') {
      statusColor = '#16a34a'; // In Progress: 초록색
    } else if (stClean === 'reachedout') {
      statusColor = '#7c3aed'; // Reached out: 링크 오인 없는 보라색 강조
    }

    // Outreach Status: 배지화 제거, 순수 텍스트 표시 (공란 시 완전 빈칸)
    const outreachHtml = outreachStatus ? `<span class="text-body font-normal">${escapeCockpitHtml(outreachStatus)}</span>` : '';

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${actualNo}</td>
        <td class="data-cell text-main font-normal">${escapeCockpitHtml(source)}</td>
        <td class="data-cell cell-center text-muted font-mono font-normal">${escapeCockpitHtml(dateSearched)}</td>
        <td class="data-cell text-body font-normal">${escapeCockpitHtml(company)}</td>
        <td class="data-cell font-normal" style="white-space: normal; word-break: break-word;">${titleHtml}</td>
        <td class="data-cell cell-center font-normal" style="color: ${statusColor};">${escapeCockpitHtml(status)}</td>
        <td class="data-cell cell-center font-normal">${outreachHtml}</td>
        <td class="data-cell font-normal">${contactHtml}</td>
        <td class="data-cell col-multiline font-normal" style="white-space: normal; word-break: break-word;">${escapeCockpitHtml(remarks)}</td>
      </tr>
    `;
  }).join('');

  updateJobOutreachSummary();
}

function onJobPostingsFilterChange(col, val) {
  cockpitState.jobFilters[col] = val.trim();
  cockpitState.jobPagination.page = 1;
  renderJobPostingsTable();
}

function resetJobPostingsFilters() {
  cockpitState.jobFilters = {};
  Object.keys(cockpitState.multiFilters.job).forEach(k => cockpitState.multiFilters.job[k].clear());
  
  // 리셋 시에도 기본값인 (blank) & In Progress 상태로 복원
  setDefaultJobScreeningFilters();

  cockpitState.jobPagination.page = 1;
  document.querySelectorAll('#jobTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#jobTableFilterRow .multiselect-btn-text').forEach(t => {
    if (t.id !== 'jobMsText_status') t.textContent = 'All';
  });
  renderJobPostingsTable();
}

// 7-4. Job Postings: Screening (Blank, In Progress, Reached out) 현황 엔진 및 기본 필터
function setDefaultJobScreeningFilters() {
  if (!cockpitState.multiFilters.job) cockpitState.multiFilters.job = {};
  if (!cockpitState.multiFilters.job.status) cockpitState.multiFilters.job.status = new Set();
  cockpitState.multiFilters.job.status.clear();

  // (blank) 추가
  cockpitState.multiFilters.job.status.add('(blank)');

  // 원본 데이터에서 In Progress에 해당하는 표기 형태를 찾아 추가
  (cockpitState.jobPostings || []).forEach(r => {
    const raw = String(r.status || r.screening || '').trim();
    if (raw.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') {
      cockpitState.multiFilters.job.status.add(raw);
    }
  });

  const statusMsText = document.getElementById('jobMsText_status');
  if (statusMsText) {
    statusMsText.textContent = `${cockpitState.multiFilters.job.status.size} selected`;
  }
}

function getSummaryChipStyle(theme, isActive) {
  if (theme === 'blank') {
    if (isActive) {
      return {
        chip: 'background: #475569; color: #ffffff; border: 1px solid #334155; box-shadow: 0 1px 2px rgba(71,85,105,0.3);',
        badge: 'background: rgba(255,255,255,0.25); color: #ffffff;'
      };
    }
    return {
      chip: 'background: #f8fafc; color: #64748b; border: 1px solid #cbd5e1;',
      badge: 'background: #e2e8f0; color: #475569;'
    };
  }

  if (theme === 'inprogress') {
    if (isActive) {
      return {
        chip: 'background: #16a34a; color: #ffffff; border: 1px solid #15803d; box-shadow: 0 1px 2px rgba(22,163,74,0.3);',
        badge: 'background: rgba(255,255,255,0.25); color: #ffffff;'
      };
    }
    return {
      chip: 'background: #f0fdf4; color: #16a34a; border: 1px solid #86efac;',
      badge: 'background: #dcfce7; color: #15803d;'
    };
  }

  if (theme === 'reachedout') {
    if (isActive) {
      return {
        chip: 'background: #7c3aed; color: #ffffff; border: 1px solid #6d28d9; box-shadow: 0 1px 2px rgba(124,58,237,0.3);',
        badge: 'background: rgba(255,255,255,0.25); color: #ffffff;'
      };
    }
    return {
      chip: 'background: #faf5ff; color: #7c3aed; border: 1px solid #d8b4fe;',
      badge: 'background: #ede9fe; color: #6d28d9;'
    };
  }

  // In Progress 하위 Outreach 세부 칩
  if (isActive) {
    return {
      chip: 'background: #0d9488; color: #ffffff; border: 1px solid #0f766e; box-shadow: 0 1px 2px rgba(13,148,136,0.3);',
      badge: 'background: rgba(255,255,255,0.25); color: #ffffff;'
    };
  }
  return {
    chip: 'background: #f0fdfa; color: #0f766e; border: 1px solid #99f6e4;',
    badge: 'background: #ccfbf1; color: #0f766e;'
  };
}

function updateJobOutreachSummary() {
  const container = document.getElementById('jobOutreachSummaryBody');
  const badge = document.getElementById('jobOutreachTotalBadge');
  if (!container) return;

  const allJobs = cockpitState.jobPostings || [];
  if (badge) badge.textContent = `${allJobs.length} total`;

  let blankCount = 0;
  let reachedOutCount = 0;
  const inProgressList = [];

  allJobs.forEach(r => {
    const rawSt = String(r.status || r.screening || '').trim();
    const stClean = rawSt.toLowerCase().replace(/[\s-_]+/g, '');

    if (!rawSt || rawSt === '-') {
      blankCount++;
    } else if (stClean === 'inprogress') {
      inProgressList.push(r);
    } else if (stClean === 'reachedout') {
      reachedOutCount++;
    }
  });

  const outreachCounts = {};
  inProgressList.forEach(r => {
    const rawVal = String(r.outreachStatus || '').trim();
    if (rawVal && rawVal !== '-') {
      outreachCounts[rawVal] = (outreachCounts[rawVal] || 0) + 1;
    }
  });

  const statusSet = cockpitState.multiFilters.job.status || new Set();
  const outreachSet = cockpitState.multiFilters.job.outreachStatus || new Set();

  const isBlankOnlyActive = statusSet.size === 1 && statusSet.has('(blank)');
  const isReachedOutOnlyActive = statusSet.size === 1 && Array.from(statusSet).some(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'reachedout');
  const isInProgressOnlyActive = statusSet.size > 0 &&
    Array.from(statusSet).every(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') &&
    outreachSet.size === 0;

  const blankStyle = getSummaryChipStyle('blank', isBlankOnlyActive);
  const inProgressStyle = getSummaryChipStyle('inprogress', isInProgressOnlyActive);
  const reachedOutStyle = getSummaryChipStyle('reachedout', isReachedOutOnlyActive);

  let html = `
    <!-- 1. Blank 현황 -->
    <span class="insight-chip tag" style="cursor: pointer; font-size: 0.74rem; padding: 3px 9px; border-radius: 6px; transition: all 0.15s ease; ${blankStyle.chip}" onclick="filterJobSummaryGroup('BLANK')">
      Blank (공란) <span class="insight-chip-badge font-semibold text-xs" style="border-radius: 4px; padding: 1px 5px; margin-left: 4px; ${blankStyle.badge}">${blankCount}</span>
    </span>

    <span style="color: #cbd5e1; margin: 0 4px; align-self: center;">|</span>

    <!-- 2. In Progress 전체 -->
    <span class="insight-chip tag" style="cursor: pointer; font-size: 0.74rem; padding: 3px 9px; border-radius: 6px; transition: all 0.15s ease; ${inProgressStyle.chip}" onclick="filterJobSummaryGroup('IN_PROGRESS')">
      In Progress <span class="insight-chip-badge font-semibold text-xs" style="border-radius: 4px; padding: 1px 5px; margin-left: 4px; ${inProgressStyle.badge}">${inProgressList.length}</span>
    </span>
  `;

  // In Progress 하위 세부 Outreach 현황 칩
  const sortedOutreach = Object.keys(outreachCounts).sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true }));
  sortedOutreach.forEach(k => {
    const isChipActive = Array.from(statusSet).some(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') && outreachSet.has(k);
    const subStyle = getSummaryChipStyle('outreach_sub', isChipActive);

    html += `
      <span class="insight-chip tag" style="cursor: pointer; font-size: 0.74rem; padding: 3px 8px; border-radius: 6px; transition: all 0.15s ease; ${subStyle.chip}" onclick="filterJobSummaryGroup('OUTREACH', '${escapeCockpitHtml(k)}')">
        ↳ ${escapeCockpitHtml(k)} <span class="insight-chip-badge font-semibold text-xs" style="border-radius: 4px; padding: 1px 4px; margin-left: 3px; ${subStyle.badge}">${outreachCounts[k]}</span>
      </span>
    `;
  });

  html += `
    <span style="color: #cbd5e1; margin: 0 4px; align-self: center;">|</span>

    <!-- 3. Reached out 현황 -->
    <span class="insight-chip tag" style="cursor: pointer; font-size: 0.74rem; padding: 3px 9px; border-radius: 6px; transition: all 0.15s ease; ${reachedOutStyle.chip}" onclick="filterJobSummaryGroup('REACHED_OUT')">
      Reached out <span class="insight-chip-badge font-semibold text-xs" style="border-radius: 4px; padding: 1px 5px; margin-left: 4px; ${reachedOutStyle.badge}">${reachedOutCount}</span>
    </span>
  `;

  container.innerHTML = html;
}

function filterJobSummaryGroup(type, subVal = null) {
  const statusSet = cockpitState.multiFilters.job.status;
  const outreachSet = cockpitState.multiFilters.job.outreachStatus;

  if (type === 'BLANK') {
    if (statusSet.size === 1 && statusSet.has('(blank)')) {
      statusSet.clear();
    } else {
      statusSet.clear();
      statusSet.add('(blank)');
    }
    outreachSet.clear();
  } else if (type === 'IN_PROGRESS') {
    const isInProgressOnly = statusSet.size > 0 &&
      Array.from(statusSet).every(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') &&
      outreachSet.size === 0;

    if (isInProgressOnly) {
      statusSet.clear();
    } else {
      statusSet.clear();
      (cockpitState.jobPostings || []).forEach(r => {
        const raw = String(r.status || r.screening || '').trim();
        if (raw.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') {
          statusSet.add(raw);
        }
      });
    }
    outreachSet.clear();
  } else if (type === 'OUTREACH' && subVal) {
    const isThisSubActive = Array.from(statusSet).some(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') && outreachSet.has(subVal);

    if (isThisSubActive) {
      statusSet.clear();
      outreachSet.clear();
    } else {
      statusSet.clear();
      (cockpitState.jobPostings || []).forEach(r => {
        const raw = String(r.status || r.screening || '').trim();
        if (raw.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') {
          statusSet.add(raw);
        }
      });
      outreachSet.clear();
      outreachSet.add(subVal);
    }
  } else if (type === 'REACHED_OUT') {
    const isReachedOutOnly = statusSet.size === 1 && Array.from(statusSet).some(s => s.toLowerCase().replace(/[\s-_]+/g, '') === 'reachedout');

    if (isReachedOutOnly) {
      statusSet.clear();
    } else {
      statusSet.clear();
      (cockpitState.jobPostings || []).forEach(r => {
        const raw = String(r.status || r.screening || '').trim();
        if (raw.toLowerCase().replace(/[\s-_]+/g, '') === 'reachedout') {
          statusSet.add(raw);
        }
      });
    }
    outreachSet.clear();
  }

  // 드롭다운 텍스트 동기화
  const statusMsText = document.getElementById('jobMsText_status');
  if (statusMsText) statusMsText.textContent = !statusSet.size ? 'All' : `${statusSet.size} selected`;
  const outMsText = document.getElementById('jobMsText_outreachStatus');
  if (outMsText) outMsText.textContent = !outreachSet.size ? 'All' : `${outreachSet.size} selected`;

  cockpitState.jobPagination.page = 1;
  renderJobPostingsTable();
}

function changeJobPageSize(newSize) {
  cockpitState.jobPagination.pageSize = parseInt(newSize, 10) || 50;
  cockpitState.jobPagination.page = 1;
  renderJobPostingsTable();
}

// 8. Dashboard 렌더링 및 자동 필터링 연동
function onDashboardYearChange(year) {
  cockpitState.dashboardYear = year;
  renderDashboardView();
}

function navigateToFinanceWithFilter(type = null, category = null) {
  resetFinanceFilters();

  if (cockpitState.dashboardYear && cockpitState.dashboardYear !== 'ALL') {
    cockpitState.financeFilters.date = cockpitState.dashboardYear;
    const dateInput = document.getElementById('filterFinDate');
    if (dateInput) dateInput.value = cockpitState.dashboardYear;
  }

  if (type) {
    cockpitState.multiFilters.finance.type.add(type);
    const msText = document.getElementById('finMsText_type');
    if (msText) msText.textContent = '1 selected';
  }

  if (category) {
    cockpitState.multiFilters.finance.category.add(category);
    const msText = document.getElementById('finMsText_category');
    if (msText) msText.textContent = '1 selected';
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
      <div class="kpi-card clickable" onclick="navigateToFinanceWithFilter('매출', null)" title="매출 내역 필터링 보기">
        <div class="kpi-card-header">
          <span class="kpi-card-title text-body font-bold" style="font-size: 0.82rem;">매출 합계 (Revenue)</span>
          <span class="kpi-card-badge kpi-val-green">Click ↗</span>
        </div>
        <div class="kpi-card-value kpi-val-green">₩${revTotal.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">
          Supply ₩${revSupply.toLocaleString('ko-KR')} / Tax ₩${revTax.toLocaleString('ko-KR')}
        </div>
      </div>

      <div class="kpi-card clickable" onclick="navigateToFinanceWithFilter('매입', null)" title="매입 내역 필터링 보기">
        <div class="kpi-card-header">
          <span class="kpi-card-title text-body font-bold" style="font-size: 0.82rem;">매입 합계 (Expense)</span>
          <span class="kpi-card-badge kpi-val-amber">Click ↗</span>
        </div>
        <div class="kpi-card-value kpi-val-amber">₩${expTotal.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">
          Input Tax Deductible ₩${expTaxDeductible.toLocaleString('ko-KR')}
        </div>
      </div>

      <div class="kpi-card clickable" onclick="navigateToFinanceWithFilter(null, null)" title="전체 장부 목록 보기">
        <div class="kpi-card-header">
          <span class="kpi-card-title text-body font-bold" style="font-size: 0.82rem;">순이익 (Revenue - Expense)</span>
          <span class="kpi-card-badge kpi-val-blue">All ↗</span>
        </div>
        <div class="kpi-card-value ${netProfit >= 0 ? 'kpi-val-blue' : 'kpi-val-red'}">₩${netProfit.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">
          Operating Margin: ${marginPct}%
        </div>
      </div>

      <div class="kpi-card clickable" onclick="navigateToFinanceWithFilter('세금', null)" title="세금 납부 내역 필터링 보기">
        <div class="kpi-card-header">
          <span class="kpi-card-title text-body font-bold" style="font-size: 0.82rem;">세금 납부 합계 (Tax)</span>
          <span class="kpi-card-badge kpi-val-red">Click ↗</span>
        </div>
        <div class="kpi-card-value kpi-val-red">₩${taxTotal.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">
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
      listEl.innerHTML = '<div class="empty-state-row text-sm" style="padding: 16px;">내역이 없습니다.</div>';
      return;
    }

    listEl.innerHTML = sortedCats.map(([catName, amount]) => {
      const pct = Math.round((amount / total) * 100);
      return `
        <div class="cat-item" onclick="navigateToFinanceWithFilter('${typeParam}', '${catName}')" title="${catName} 내역 필터링 보기">
          <div class="cat-item-top">
            <span class="cat-item-name">${catName}</span>
            <span class="cat-item-val">₩${amount.toLocaleString('ko-KR')} (${pct}%) ↗</span>
          </div>
          <div class="cat-bar-bg">
            <div class="cat-bar-fill" style="width: ${pct}%; background: ${color};"></div>
          </div>
        </div>
      `;
    }).join('');
  };

  renderCategoryBars(catRevMap, revTotal, 'dashRevCategoryList', 'dashRevTotalBadge', '#16a34a', '매출');
  renderCategoryBars(catExpMap, expTotal, 'dashExpCategoryList', 'dashExpTotalBadge', '#d97706', '매입');
}

// 9. Fixed Costs 테이블 렌더링 (가상 No. 연동 및 일반 웨이트 스타일 통일)
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
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state-row text-sm">No fixed costs found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((r, idx) => {
    const costFormatted = Number(r.cost) ? `₩${Number(r.cost).toLocaleString('ko-KR')}` : '₩0';
    const vatFormatted = Number(r.vat) ? `₩${Number(r.vat).toLocaleString('ko-KR')}` : '';

    const vendorLinkClean = String(r.vendorLink || '').trim();
    const vendorNameClean = r.vendor || '';
    let vendorHtml = escapeCockpitHtml(vendorNameClean);
    if (vendorLinkClean) {
      vendorHtml = `<a href="${escapeCockpitHtml(vendorLinkClean)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration: none;">${escapeCockpitHtml(vendorNameClean)}</a>`;
    }

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${idx + 1}</td>
        <td class="data-cell text-main font-normal">${escapeCockpitHtml(r.item || '')}</td>
        <td class="data-cell font-normal">${vendorHtml}</td>
        <td class="data-cell cell-right font-normal">${costFormatted}</td>
        <td class="data-cell cell-right text-muted font-normal">${vatFormatted}</td>
        <td class="data-cell cell-center text-muted font-normal">${escapeCockpitHtml(r.firstPurchase || '')}</td>
        <td class="data-cell cell-center"><span class="text-xs text-muted font-normal" style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeCockpitHtml(r.interval || 'Annual')}</span></td>
        <td class="data-cell text-muted font-normal cell-ellipsis" title="${escapeCockpitHtml(r.remarks || '')}">${escapeCockpitHtml(r.remarks || '')}</td>
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
        <tr style="background: #fafafa; font-weight: normal;">
          <td colspan="4" class="data-cell" style="color: #1e293b;">[과세표준 및 매출세액]</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding-left: 20px;">과세 세금계산서 발급분 (10%)</td>
          <td class="data-cell text-muted font-normal">국내 일반 용역</td>
          <td class="data-cell cell-right font-normal">₩${vatTaxableSalesSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-primary font-normal">₩${vatTaxableSalesTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding-left: 20px;">영세율 (외화획득 용역)</td>
          <td class="data-cell text-muted font-normal">해외 기술자문 (APA 등 외화 수임)</td>
          <td class="data-cell cell-right font-normal">₩${vatZeroSalesSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-muted font-normal">₩0</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding-left: 20px;">면세 / 비과세 매출</td>
          <td class="data-cell text-muted font-normal">협회 강의 등 소득세 원천징수분</td>
          <td class="data-cell cell-right font-normal">₩${vatExemptSalesSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-muted font-normal">₩0</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: normal;">
          <td colspan="2" class="data-cell cell-right text-body font-normal">매출세액 합계</td>
          <td class="data-cell cell-right font-normal">₩${(vatTaxableSalesSupply + vatZeroSalesSupply + vatExemptSalesSupply).toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-primary font-normal">₩${totalSalesTax.toLocaleString('ko-KR')}</td>
        </tr>

        <tr style="background: #fafafa; font-weight: normal;">
          <td colspan="4" class="data-cell" style="color: #1e293b;">[매입세액 및 경비공제]</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding-left: 20px;">세금계산서 수취분 (일반매입)</td>
          <td class="data-cell text-muted font-normal">사무실 임대료 등 과세 세금계산서</td>
          <td class="data-cell cell-right font-normal">₩${vatInvoicePurchSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-warning font-normal">₩${vatInvoicePurchTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding-left: 20px;">신용카드매출전표 수령명세 (과세)</td>
          <td class="data-cell text-muted font-normal">사업자카드 결제 (소모품, 비품, 과세 구독)</td>
          <td class="data-cell cell-right font-normal">₩${vatCardPurchSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-warning font-normal">₩${vatCardPurchTax.toLocaleString('ko-KR')}</td>
        </tr>
        <tr>
          <td class="data-cell text-muted font-normal" style="padding-left: 20px;">불공제 / 비과세 매입 (공제제외)</td>
          <td class="data-cell text-muted font-normal">금융수수료, 비과세 해외결제, 세금 납부</td>
          <td class="data-cell cell-right text-muted font-normal">₩${vatNonDeductPurchSupply.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-muted font-normal">₩0</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: normal;">
          <td colspan="2" class="data-cell cell-right text-body font-normal">공제대상 매입세액 합계</td>
          <td class="data-cell cell-right font-normal">₩${(vatInvoicePurchSupply + vatCardPurchSupply).toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-warning font-normal">₩${totalPurchTax.toLocaleString('ko-KR')}</td>
        </tr>

        <tr style="background: #ffffff; border-top: 2px solid var(--border-gray);">
          <td colspan="2" class="data-cell font-semibold text-main" style="font-size: 0.95rem;">차감 납부(환급) 세액 (Tax Due / Refund)</td>
          <td colspan="2" class="data-cell cell-right font-semibold" style="font-size: 1.05rem; color: ${netVatDue >= 0 ? '#dc2626' : '#16a34a'};">
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

    const inputStyle = "width: 110px; padding: 3px 6px; font-size: 0.78rem; text-align: right; border: 1px solid #cbd5e1; border-radius: 4px; background: #ffffff; font-weight: normal; outline: none;";
    const rateInputStyle = "width: 48px; padding: 2px 4px; font-size: 0.78rem; text-align: center; border: 1px solid #93c5fd; border-radius: 4px; background: #eff6ff; font-weight: 600; color: #1d4ed8; outline: none;";

    const strTbody = document.getElementById('taxStrategyTableBody');
    if (strTbody) {
      const tableHead = document.querySelector('#taxStrategyTable thead tr');
      if (tableHead) {
        tableHead.innerHTML = `
          <th class="data-table-th text-center" style="width: 175px; padding: 6px 8px;">구분 항목</th>
          <th class="data-table-th text-center" style="width: 145px; padding: 6px 8px;">간편장부 ✏️</th>
          <th class="data-table-th text-center" style="width: 155px; padding: 6px 8px;">
            기준경비 (<input type="number" step="0.1" min="0" max="100" style="${rateInputStyle}" value="${baseRate}" onchange="onTaxRateChange(this)">%) ✏️
          </th>
          <th class="data-table-th text-center" style="padding: 6px 10px;">비고 및 계산 근거</th>
        `;
      }

      strTbody.innerHTML = `
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">총 매출액 (a)</td>
          <td class="data-cell cell-right" style="padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${revenue.toLocaleString('ko-KR')}" onchange="onTaxInputChange('revenue', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${revenue.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px;">외화(USD) 매출 동일 반영</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">인정 경비 (b)</td>
          <td class="data-cell cell-right" style="padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${expSimp.toLocaleString('ko-KR')}" onchange="onTaxInputChange('actualExpense', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${expBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="font-size: 0.74rem; line-height: 1.4; padding: 5px 10px; word-break: keep-all;">
            <strong>간편장부:</strong> 실제 지출액 (3대 비용 포함)<br>
            <strong>기준경비적용:</strong> 정부인정경비(업태: 전문, 과학 및 기술서비스업 / 종목: 기타 전문 서비스업[749942] ${baseRate}%) 자동 연산
          </td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">건강 보험 (c)</td>
          <td class="data-cell cell-right" style="padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${healthInsSimp.toLocaleString('ko-KR')}" onchange="onTaxInputChange('healthInsurance', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-muted font-normal" style="padding: 5px 8px;">₩0</td>
          <td class="data-cell text-muted" style="font-size: 0.74rem; padding: 5px 10px;">지역 건강보험료 납부액은 종합소득세 계산 시 사업장의 필요경비(b)로 전액 털어낼 수 있음 (단, 기준경비 적용 시 제외)</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: normal;">
          <td class="data-cell font-normal" style="padding: 5px 8px;">종합소득금액 (A)(a-b-c)</td>
          <td class="data-cell cell-right text-main font-normal" style="padding: 5px 8px;">₩${incSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px; color: #2563eb;">₩${incBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-body" style="padding: 5px 10px; font-size: 0.74rem;">경비율 적용 시 소득 차이 발생</td>
        </tr>
        <tr>
          <td class="data-cell text-muted font-normal" style="padding: 4px 8px 4px 16px;">인적공제 (d)</td>
          <td class="data-cell cell-right" style="padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedPersonal.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedPersonal', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 4px 8px;">₩${dedPersonal.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">본인 기본공제 (150만 원)</td>
        </tr>
        <tr>
          <td class="data-cell text-muted font-normal" style="padding: 4px 8px 4px 16px;">노란우산공제 (e)</td>
          <td class="data-cell cell-right" style="padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedYellow.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedYellow', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 4px 8px;">₩${dedYellow.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">소기업·소상공인 공제부금 최대 불입</td>
        </tr>
        <tr>
          <td class="data-cell text-muted font-normal" style="padding: 4px 8px 4px 16px;">국민연금 공제 (f)</td>
          <td class="data-cell cell-right" style="padding: 4px 8px;">
            <input type="text" style="${inputStyle}" value="${dedNps.toLocaleString('ko-KR')}" onchange="onTaxInputChange('dedNps', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 4px 8px;">₩${dedNps.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">전액(100%) 과세표준에서 차감</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: normal;">
          <td class="data-cell font-normal" style="padding: 5px 8px;">소득공제 (B)(d+e+f)</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-body" style="padding: 5px 10px; font-size: 0.74rem;">본인 공제(150만) + 노란우산공제(500만) + 국민연금공제(160만) 자동 동기화</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: normal;">
          <td class="data-cell font-normal" style="padding: 5px 8px;">과세표준 (A-B)</td>
          <td class="data-cell cell-right text-main font-normal" style="padding: 5px 8px;">₩${taxBaseSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-main font-normal" style="padding: 5px 8px;">₩${taxBaseBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell" style="color: #1e293b; padding: 5px 10px; font-size: 0.74rem;">세금을 매기는 기준 금액</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">세율 및 산출세액 (C)</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px;">₩${calcTaxSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${calcTaxBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">1400만까지 6%, 5000만까지 15% 세율 구간 적용</td>
        </tr>
        <tr>
          <td class="data-cell font-normal text-primary" style="padding: 5px 8px;">창업중소기업 세액감면 (D)</td>
          <td class="data-cell cell-right text-primary font-normal" style="padding: 5px 8px;">₩${redSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-muted font-normal" style="padding: 5px 8px;">₩0</td>
          <td class="data-cell text-primary" style="font-size: 0.74rem; line-height: 1.35; padding: 5px 10px; word-break: keep-all;">
            <strong>'창업중소기업 세액감면 신청서'를 반드시 함께 제출 | 기준경비 사용 시 적용 안 됨 | 무조건 간편 장부 작성!</strong><br>
            용인시 일반 창업자 (만 34세 초과) 종합소득세 50% 감면 (산출세액 기준 5년간 감면)
          </td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">개인연금저축 (g)</td>
          <td class="data-cell cell-right" style="padding: 5px 8px;">
            <input type="text" style="${inputStyle}" value="${pensionSavings.toLocaleString('ko-KR')}" onchange="onTaxInputChange('pensionSavings', this)" oninput="this.value = this.value.replace(/[^0-9]/g, '')">
          </td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${pensionSavings.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">개인연금저축 연간 납입액 자동 동기화</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">세액공제 (E)(g*0.15)</td>
          <td class="data-cell cell-right text-primary font-normal" style="padding: 5px 8px;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-primary font-normal" style="padding: 5px 8px;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">개인연금저축 (${(pensionSavings / 10000).toLocaleString('ko-KR')}만 × 15% 공제율)</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">종합소득세 (F)(C-D-E)</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px;">₩${itSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${itBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">산출세액 - 세액감면 - 세액공제</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">무기장 가산세 (G)</td>
          <td class="data-cell cell-right text-muted font-normal" style="padding: 5px 8px;">₩0</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px; color: ${penaltyBase > 0 ? '#dc2626' : '#94a3b8'};">₩${penaltyBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">매출 4,800만 원 미만은 가산세 면제, 이상은 20% 추가 (간편장부는 가산세 없음)</td>
        </tr>
        <tr>
          <td class="data-cell font-normal" style="padding: 5px 8px;">지방소득세 (H) ((F+G)*0.1)</td>
          <td class="data-cell cell-right font-normal" style="padding: 5px 8px;">₩${localTaxSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right text-body font-normal" style="padding: 5px 8px;">₩${localTaxBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-muted" style="padding: 5px 10px; font-size: 0.74rem;">종합소득세 + 가산세의 10% 별도 부과</td>
        </tr>
        <tr style="background: #ffffff; border-top: 2px solid var(--border-gray); font-size: 0.88rem; font-weight: 700;">
          <td class="data-cell text-main font-bold" style="padding: 6px 8px;">최종 세액 (I)(F+G+H)</td>
          <td class="data-cell cell-right font-bold" style="color: #16a34a; padding: 6px 8px; font-size: 0.92rem;">₩${finalTaxSimp.toLocaleString('ko-KR')}</td>
          <td class="data-cell cell-right font-bold" style="color: #dc2626; padding: 6px 8px; font-size: 0.92rem;">₩${finalTaxBase.toLocaleString('ko-KR')}</td>
          <td class="data-cell text-info font-normal" style="padding: 6px 10px; font-size: 0.74rem;">납부 예상 합계액 (국세 + 지방세)</td>
        </tr>
        <tr style="background: #f0fdf4; font-weight: 700;">
          <td class="data-cell font-bold" style="color: #15803d; padding: 6px 8px;">간편장부 대비 절감</td>
          <td class="data-cell cell-right text-muted font-normal" style="padding: 6px 8px;">- (기준)</td>
          <td class="data-cell cell-right font-bold" style="color: #15803d; padding: 6px 8px; font-size: 0.98rem;">
            +₩${diffSaving.toLocaleString('ko-KR')}
          </td>
          <td class="data-cell font-normal" style="color: #15803d; padding: 6px 10px; font-size: 0.78rem;">무엇이 유리한지 여기서 비교! (간편장부 선택 시 절세 효과)</td>
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
  Object.keys(cockpitState.multiFilters.finance).forEach(k => cockpitState.multiFilters.finance[k].clear());
  cockpitState.finPagination.page = 1;

  document.querySelectorAll('#finTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#finTableFilterRow .multiselect-btn-text').forEach(t => t.textContent = 'All');
  renderFinanceTable();
}

// 팝오버 외부 클릭 시 자동 닫기 핸들러 연동
document.addEventListener('click', e => {
  if (!e.target.closest('.multiselect-container')) {
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
  }
});

// Window 전역 export
window.initCockpitModule = initCockpitModule;
window.loadCockpitData = loadCockpitData;
window.switchCockpitSubTab = switchCockpitSubTab;
window.renderStrategyView = renderStrategyView;
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
window.renderAccountsTable = renderAccountsTable;
window.onAccountsFilterChange = onAccountsFilterChange;
window.resetAccountsFilters = resetAccountsFilters;
window.goToAccPage = goToAccPage;
window.changeAccPageSize = changeAccPageSize;
window.renderContactsTable = renderContactsTable;
window.populateContactsFilterOptions = populateContactsFilterOptions;
window.onContactsFilterChange = onContactsFilterChange;
window.resetContactsFilters = resetContactsFilters;
window.goToConPage = goToConPage;
window.changeConPageSize = changeConPageSize;
window.copyContactEmail = copyContactEmail;
window.renderJobPostingsTable = renderJobPostingsTable;
window.populateJobPostingsFilterOptions = populateJobPostingsFilterOptions;
window.onJobPostingsFilterChange = onJobPostingsFilterChange;
window.resetJobPostingsFilters = resetJobPostingsFilters;
window.goToJobPage = goToJobPage;
window.changeJobPageSize = changeJobPageSize;
window.toggleCockpitDropdown = toggleCockpitDropdown;
window.updateJobOutreachSummary = updateJobOutreachSummary;
window.onJobOutreachChipClick = onJobOutreachChipClick;
window.selectAllCockpitDropdown = selectAllCockpitDropdown;
window.toggleCockpitDropdownItem = toggleCockpitDropdownItem;
window.filterJobSummaryGroup = filterJobSummaryGroup;
window.setDefaultJobScreeningFilters = setDefaultJobScreeningFilters;