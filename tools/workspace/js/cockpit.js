/**
 * a2MDS Cockpit Module (Refactored Single-File Edition)
 * 4 Main Domains: Strategy | Finance & Tax (Dashboard + Fixed Costs, Financial Records, Tax Filing) | CRM & Outreach (Contacts, Job Postings) | Accounts
 */

const COCKPIT_API_URL = window.APP_CONFIG?.COCKPIT_API_URL || 'https://script.google.com/macros/s/AKfycbxwPeAGqxjvBHPRF0S4zrXKOJ-luwhdJk7yFAMYqbDAhS4LR_7s11XWbXM62wERlQkn2A/exec';

const DEFAULT_TAX_INPUTS = {
  revenue: 43000000,
  actualExpense: 3000000,
  healthInsurance: 420000,
  baseExpenseRate: 16,
  dedPersonal: 1500000,
  dedYellow: 5000000,
  dedNps: 1600000,
  pensionSavings: 6000000
};

const TAB_META = {
  finance: { pfx: 'fin', filterRowId: 'finTableFilterRow', badgeId: 'finBadgeCount' },
  accounts: { pfx: 'acc', filterRowId: 'accTableFilterRow', badgeId: 'accountsBadgeCount' },
  contacts: { pfx: 'con', filterRowId: 'conTableFilterRow', badgeId: 'conBadgeCount' },
  job: { pfx: 'job', filterRowId: 'jobTableFilterRow', badgeId: 'jobBadgeCount' }
};

let cockpitState = {
  strategy: [],
  finance: [],
  fixedCosts: [],
  accounts: [],
  contacts: [],
  jobPostings: [],
  currentGroup: 'strategy',
  currentFinSub: 'dashboard',
  currentCrmSub: 'contacts',
  dashboardYear: String(new Date().getFullYear()),
  isLoaded: false,
  textFilters: { finance: {}, accounts: {}, contacts: {}, job: {} },
  multiFilters: {
    finance: { type: new Set(), category: new Set(), client: new Set(), transaction: new Set(), taxType: new Set() },
    accounts: { site: new Set(), companyId: new Set(), rootOrgUnit: new Set() },
    contacts: { imds: new Set(), regRm: new Set(), inquiry: new Set(), supplyChain: new Set(), koreca: new Set(), mdsk: new Set() },
    job: { source: new Set(), status: new Set(), outreachStatus: new Set() }
  },
  pagination: {
    finance: { page: 1, pageSize: 50 },
    accounts: { page: 1, pageSize: 50 },
    contacts: { page: 1, pageSize: 50 },
    job: { page: 1, pageSize: 50 }
  },
  taxPeriod: '',
  taxInputs: { ...DEFAULT_TAX_INPUTS }
};

// =========================================================================
// 0. COMMON UTILITIES & HTML BUILDERS
// =========================================================================
function escapeCockpitHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanCellVal(v) {
  const s = String(v !== undefined && v !== null ? v : '').trim();
  return (s === '-' || !s) ? '' : s;
}

function getCockpitAuthKey() {
  const key = (typeof getStoredAuthKey === 'function') ? getStoredAuthKey() : '';
  if (!key) document.getElementById('authLockOverlay')?.style.setProperty('display', 'flex');
  return key;
}

function buildMsFilterTh(tab, key) {
  const pfx = TAB_META[tab].pfx;
  return `
    <th class="filter-th" style="padding: 3px 2px;">
      <div class="multiselect-container">
        <button type="button" class="multiselect-btn" id="${pfx}MsBtn_${key}" onclick="toggleCockpitDropdown('${tab}', '${key}')" style="padding: 2px 3px; font-size: 0.73rem;">
          <span class="multiselect-btn-text" id="${pfx}MsText_${key}">All</span>
          <span style="font-size: 0.6rem; color: #64748b;">▼</span>
        </button>
        <div class="multiselect-dropdown" id="${pfx}MsDropdown_${key}"></div>
      </div>
    </th>`;
}

function buildTextFilterTh(tab, col, placeholder, id = '') {
  const idAttr = id ? `id="${id}"` : '';
  return `<th class="filter-th"><input type="text" ${idAttr} class="filter-input" placeholder="${placeholder}" oninput="onCockpitTextFilter('${tab}', '${col}', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>`;
}

function buildPaginationBar(tab) {
  const pfx = TAB_META[tab].pfx;
  return `
    <div class="pagination-bar">
      <div class="flex-start gap-1">
        <span>Show</span>
        <select id="${pfx}PageSizeSelect" class="filter-input" onchange="changeCockpitPageSize('${tab}', this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
          <option value="25">25</option>
          <option value="50" selected>50</option>
          <option value="100">100</option>
        </select>
        <span>per page</span>
      </div>
      <div class="flex-start" style="gap: 10px;">
        <button type="button" class="btn-act" id="${pfx}BtnPrevPage" onclick="goToCockpitPage('${tab}', cockpitState.pagination['${tab}'].page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
        <span id="${pfx}PageInfoDisplay" class="font-normal text-main">Page 1 of 1</span>
        <button type="button" class="btn-act" id="${pfx}BtnNextPage" onclick="goToCockpitPage('${tab}', cockpitState.pagination['${tab}'].page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
      </div>
    </div>`;
}

// =========================================================================
// 1. MODULE ENTRY & BASE LAYOUT (4 MAIN GROUPS)
// =========================================================================
function initCockpitModule(forceReload = false) {
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) return;
  const container = document.getElementById('cockpit-module');
  if (!container) return;

  if (!cockpitState.isLoaded || forceReload) {
    renderCockpitBase(container);
    loadCockpitData();
  }
}

function renderCockpitBase(container) {
  container.innerHTML = `
    <!-- 1단 메인 서브탭 (4개 그룹) & 외부 링크 -->
    <div class="smelter-sub-tabs-wrapper flex-between" style="margin-top: 4px;">
      <div class="smelter-sub-tabs">
        <button type="button" class="smelter-sub-tab-btn active" id="btnCockpitGroup_strategy" onclick="switchCockpitGroup('strategy')">🎯 Strategy</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitGroup_financeGroup" onclick="switchCockpitGroup('financeGroup')">💰 Finance &amp; Tax</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitGroup_crmGroup" onclick="switchCockpitGroup('crmGroup')">🤝 CRM &amp; Outreach</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitGroup_accounts" onclick="switchCockpitGroup('accounts')">🔑 Accounts</button>
      </div>
      <div class="flex-start gap-1" style="padding-right: 4px;">
        <a href="https://calendar.google.com/" target="_blank" rel="noopener noreferrer" class="btn-action-soft" style="display: inline-flex; align-items: center; gap: 5px; text-decoration: none; font-size: 0.76rem; font-weight: 600; padding: 4px 10px; border-radius: 6px; color: var(--text-main); background: #ffffff; border: 1px solid var(--border-darker);" data-tooltip="Open Google Calendar">
          📅 Calendar ↗
        </a>
      </div>
    </div>

    <!-- GROUP 1: Strategy -->
    <div id="cockpitGroup_strategy" class="smelter-sub-pane active">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">Business Strategy &amp; Roadmap <span class="viewer-badge" id="strategyBadgeCount">4 pillars</span></div>
        </div>
        <div id="cockpitStrategyGrid" class="strategy-grid"></div>
      </div>
    </div>

    <!-- GROUP 2: Finance & Tax (Dashboard + Fixed Costs | Financial Records | Tax Filing) -->
    <div id="cockpitGroup_financeGroup" class="smelter-sub-pane" style="display: none;">
      <div class="flex-start mb-3">
        <div class="gadsl-sub-tabs">
          <button type="button" class="gadsl-sub-tab-btn active" id="btnFinSub_dashboard" onclick="switchFinanceSubView('dashboard')">📊 Dashboard</button>
          <button type="button" class="gadsl-sub-tab-btn" id="btnFinSub_finance" onclick="switchFinanceSubView('finance')">📋 Financial Records</button>
          <button type="button" class="gadsl-sub-tab-btn" id="btnFinSub_tax" onclick="switchFinanceSubView('tax')">💰 Tax Filing</button>
        </div>
      </div>

      <!-- 2-A. Dashboard (+ Fixed Costs 하단 통합) -->
      <div id="cockpitSubPaneDashboard" class="gadsl-tab-pane active">
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

        <!-- Fixed Costs 통합 섹션 -->
        <div class="viewer-box">
          <div class="viewer-header">
            <div class="viewer-title">📌 Fixed Costs Management <span class="viewer-badge" id="fixedBadgeCount">0 items</span></div>
            <div class="viewer-actions flex-start gap-2">
              <span id="fixedTotalCostBadge" class="text-sm font-normal text-main" style="background: #f1f5f9; border: 1px solid var(--border-gray); padding: 4px 10px; border-radius: 6px;">Total Cost: ₩0</span>
            </div>
          </div>
          <div class="table-wrapper" style="min-height: auto; overflow-x: auto;">
            <table class="data-table" id="cockpitFixedTable" style="table-layout: fixed; width: 100%; min-width: 940px; font-size: 0.78rem;">
              <thead>
                <tr>
                  <th class="data-table-th" style="width: 45px;">No</th>
                  <th class="data-table-th" style="width: 220px;">Item</th>
                  <th class="data-table-th" style="width: 150px;">Vendor</th>
                  <th class="data-table-th" style="width: 110px;">Cost</th>
                  <th class="data-table-th" style="width: 100px;">VAT</th>
                  <th class="data-table-th" style="width: 120px;">First Purchase</th>
                  <th class="data-table-th" style="width: 100px;">Interval</th>
                  <th class="data-table-th">Remarks</th>
                </tr>
              </thead>
              <tbody id="cockpitFixedTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- 2-B. Financial Records -->
      <div id="cockpitSubPaneFinance" class="gadsl-tab-pane" style="display: none;">
        <div class="viewer-box">
          <div class="viewer-header">
            <div class="viewer-title">Master Index <span class="viewer-badge" id="finBadgeCount">0 entries</span></div>
            <div class="viewer-actions flex-start gap-2">
              <span id="finFilteredSummaryBadge" class="text-sm font-normal text-main" style="background: #f1f5f9; border: 1px solid var(--border-gray); padding: 4px 10px; border-radius: 6px;">Total(₩): ₩0 | Supply: ₩0 | Tax: ₩0</span>
              <button type="button" class="btn-act" onclick="resetCockpitFilters('finance')">🧹 Clear Filters</button>
            </div>
          </div>
          <div class="table-wrapper" style="overflow-x: auto;">
            <table class="data-table" id="cockpitFinanceTable" style="table-layout: fixed; width: 100%; min-width: 1030px; font-size: 0.76rem;">
              <thead>
                <tr>
                  <th class="data-table-th" style="width: 45px;">No.</th>
                  <th class="data-table-th" style="width: 90px;">Date</th>
                  <th class="data-table-th" style="width: 52px;">Type</th>
                  <th class="data-table-th" style="width: 82px;">Category</th>
                  <th class="data-table-th" style="width: 130px;">Client</th>
                  <th class="data-table-th" style="width: 105px;">Transaction</th>
                  <th class="data-table-th" style="min-width: 140px;">Description</th>
                  <th class="data-table-th" style="width: 78px;">Tax_Type</th>
                  <th class="data-table-th" style="width: 65px;">Total($)</th>
                  <th class="data-table-th" style="width: 92px;">Total(₩)</th>
                  <th class="data-table-th" style="width: 88px;">Supply</th>
                  <th class="data-table-th" style="width: 78px;">Tax</th>
                </tr>
                <tr id="finTableFilterRow">
                  <th class="filter-th"></th>
                  ${buildTextFilterTh('finance', 'date', 'Date...', 'filterFinDate')}
                  ${buildMsFilterTh('finance', 'type')}
                  ${buildMsFilterTh('finance', 'category')}
                  ${buildMsFilterTh('finance', 'client')}
                  ${buildMsFilterTh('finance', 'transaction')}
                  ${buildTextFilterTh('finance', 'description', 'Description...')}
                  ${buildMsFilterTh('finance', 'taxType')}
                  ${buildTextFilterTh('finance', 'usd', '$...')}
                  ${buildTextFilterTh('finance', 'krw', '₩...')}
                  <th class="filter-th"></th>
                  <th class="filter-th"></th>
                </tr>
              </thead>
              <tbody id="cockpitFinanceTableBody"></tbody>
            </table>
          </div>
          ${buildPaginationBar('finance')}
        </div>
      </div>

      <!-- 2-C. Tax Filing -->
      <div id="cockpitSubPaneTax" class="gadsl-tab-pane" style="display: none;">
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
            <div id="taxVatSectionBlock" style="display: none;">
              <h4 class="text-main flex-between mb-2" style="margin-top: 0; font-size: 0.95rem; font-weight: 600;">
                <span>VAT Declaration</span>
                <span id="taxVatNetBadge" class="text-sm font-medium" style="padding: 2px 8px; border-radius: 4px;">-</span>
              </h4>
              <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; min-height: auto; max-height: none; overflow-y: visible;">
                <table class="data-table" style="table-layout: fixed; width: 100%;">
                  <thead>
                    <tr style="background: #f8fafc;">
                      <th class="data-table-th" style="width: 220px;">구분 (Hometax Entry)</th>
                      <th class="data-table-th">세부 내역 및 증빙</th>
                      <th class="data-table-th" style="width: 185px;">공급가액 (Supply Value)</th>
                      <th class="data-table-th" style="width: 145px;">세액 (Tax Amount)</th>
                    </tr>
                  </thead>
                  <tbody id="taxVatTableBody"></tbody>
                </table>
              </div>
            </div>

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
              <div class="table-wrapper mb-4" style="border: 1px solid var(--border-gray); border-radius: 4px; min-height: auto; max-height: none; overflow-y: visible; overflow-x: hidden;">
                <table class="data-table" id="taxStrategyTable" style="table-layout: fixed; width: 100%; font-size: 0.78rem;">
                  <thead><tr style="background: #f8fafc;"></tr></thead>
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
    </div>

    <!-- GROUP 3: CRM & Outreach (Contacts 기본 | Job Postings) -->
    <div id="cockpitGroup_crmGroup" class="smelter-sub-pane" style="display: none;">
      <div class="flex-start mb-3">
        <div class="gadsl-sub-tabs">
          <button type="button" class="gadsl-sub-tab-btn active" id="btnCrmSub_contacts" onclick="switchCrmSubView('contacts')">📇 Contacts</button>
          <button type="button" class="gadsl-sub-tab-btn" id="btnCrmSub_job" onclick="switchCrmSubView('job')">💼 Job Postings</button>
        </div>
      </div>

      <!-- 3-A. Contacts -->
      <div id="cockpitSubPaneContacts" class="gadsl-tab-pane active">
        <div class="viewer-box">
          <div class="viewer-header">
            <div class="viewer-title">Contacts Directory <span class="viewer-badge" id="conBadgeCount">0 entries</span></div>
            <div class="viewer-actions">
              <button type="button" class="btn-act" onclick="resetCockpitFilters('contacts')">🧹 Clear Filters</button>
            </div>
          </div>
          <div class="table-wrapper" style="overflow-x: auto;">
            <table class="data-table" id="cockpitContactsTable" style="table-layout: fixed; width: 100%; min-width: 1200px; font-size: 0.76rem;">
              <thead>
                <tr>
                  <th class="data-table-th" style="width: 3.5%;">No.</th>
                  <th class="data-table-th" style="width: 8%;">Name (Email)</th>
                  <th class="data-table-th" style="width: 12%;">Company</th>
                  <th class="data-table-th" style="width: 8%;">Job Title</th>
                  <th class="data-table-th" style="width: 6%;">IMDS</th>
                  <th class="data-table-th" style="width: 6%;">Reg/RM</th>
                  <th class="data-table-th" style="width: 6%;">Inquiry</th>
                  <th class="data-table-th" style="width: 8%;">Supply Chain</th>
                  <th class="data-table-th" style="width: 6%;">KORECA</th>
                  <th class="data-table-th" style="width: 6%;">MDSK</th>
                  <th class="data-table-th" style="width: auto;">Remarks</th>
                </tr>
                <tr id="conTableFilterRow">
                  <th class="filter-th"></th>
                  ${buildTextFilterTh('contacts', 'name', 'Search Name/Email...')}
                  ${buildTextFilterTh('contacts', 'company', 'Company...')}
                  ${buildTextFilterTh('contacts', 'jobTitle', 'Title...')}
                  ${buildMsFilterTh('contacts', 'imds')}
                  ${buildMsFilterTh('contacts', 'regRm')}
                  ${buildMsFilterTh('contacts', 'inquiry')}
                  ${buildMsFilterTh('contacts', 'supplyChain')}
                  ${buildMsFilterTh('contacts', 'koreca')}
                  ${buildMsFilterTh('contacts', 'mdsk')}
                  ${buildTextFilterTh('contacts', 'remarks', 'Remarks...')}
                </tr>
              </thead>
              <tbody id="cockpitContactsTableBody"></tbody>
            </table>
          </div>
          ${buildPaginationBar('contacts')}
        </div>
      </div>

      <!-- 3-B. Job Postings -->
      <div id="cockpitSubPaneJob" class="gadsl-tab-pane" style="display: none;">
        <div class="viewer-box">
          <div class="viewer-header">
            <div class="viewer-title">Job Postings <span class="viewer-badge" id="jobBadgeCount">0 entries</span></div>
            <div class="viewer-actions">
              <button type="button" class="btn-act" onclick="resetCockpitFilters('job')">🧹 Clear Filters</button>
            </div>
          </div>
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
                  <th class="data-table-th" style="width: 3.5%;">No.</th>
                  <th class="data-table-th" style="width: 6.5%;">Source</th>
                  <th class="data-table-th" style="width: 7%;">Searched</th>
                  <th class="data-table-th" style="width: 11%;">Company</th>
                  <th class="data-table-th" style="width: 21%;">Job Title (Link)</th>
                  <th class="data-table-th" style="width: 8.5%;">Screening</th>
                  <th class="data-table-th" style="width: 8.5%;">Outreach Status</th>
                  <th class="data-table-th" style="width: 13%;">Contact (E-mail)</th>
                  <th class="data-table-th" style="width: 21%;">Remarks</th>
                </tr>
                <tr id="jobTableFilterRow">
                  <th class="filter-th"></th>
                  ${buildMsFilterTh('job', 'source')}
                  ${buildTextFilterTh('job', 'dateSearched', 'Date...')}
                  ${buildTextFilterTh('job', 'company', 'Company...')}
                  ${buildTextFilterTh('job', 'title', 'Title...')}
                  ${buildMsFilterTh('job', 'status')}
                  ${buildMsFilterTh('job', 'outreachStatus')}
                  ${buildTextFilterTh('job', 'contact', 'Contact/Email...')}
                  ${buildTextFilterTh('job', 'remarks', 'Remarks...')}
                </tr>
              </thead>
              <tbody id="cockpitJobPostingsTableBody"></tbody>
            </table>
          </div>
          ${buildPaginationBar('job')}
        </div>
      </div>
    </div>

    <!-- GROUP 4: Accounts -->
    <div id="cockpitGroup_accounts" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">System &amp; Service Accounts <span class="viewer-badge" id="accountsBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act" onclick="resetCockpitFilters('accounts')">🧹 Clear Filters</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitAccountsTable" style="table-layout: fixed; width: 100%; min-width: 950px; font-size: 0.78rem;">
            <thead>
              <tr>
                <th class="data-table-th" style="width: 45px;">No.</th>
                <th class="data-table-th" style="width: 140px;">Site</th>
                <th class="data-table-th" style="width: 130px;">Company ID</th>
                <th class="data-table-th" style="width: 140px;">Root / Org Unit</th>
                <th class="data-table-th" style="width: 240px;">ID / Email</th>
                <th class="data-table-th">Remarks</th>
              </tr>
              <tr id="accTableFilterRow">
                <th class="filter-th"></th>
                ${buildMsFilterTh('accounts', 'site')}
                ${buildMsFilterTh('accounts', 'companyId')}
                ${buildMsFilterTh('accounts', 'rootOrgUnit')}
                ${buildTextFilterTh('accounts', 'idEmail', 'ID/Email...')}
                ${buildTextFilterTh('accounts', 'remarks', 'Remarks...')}
              </tr>
            </thead>
            <tbody id="cockpitAccountsTableBody"></tbody>
          </table>
        </div>
        ${buildPaginationBar('accounts')}
      </div>
    </div>
  `;
}

// =========================================================================
// 2. DATA FETCH & INITIALIZATION
// =========================================================================
async function loadCockpitData() {
  if (typeof isWorkspaceAdmin === 'function' && !isWorkspaceAdmin()) return;
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
      cockpitState.fixedCosts = (json.data.fixedCosts || []).map((r, idx) => Array.isArray(r) ? ({
        no: idx + 1,
        item: String(r[0] || '').trim(),
        vendor: String(r[1] || '').trim(),
        vendorLink: String(r[2] || '').trim(),
        cost: parseCleanInt(r[3], 0),
        vat: parseCleanInt(r[4], 0),
        firstPurchase: String(r[5] || '').slice(0, 10),
        interval: String(r[6] || 'Annual').trim(),
        remarks: String(r[7] || '').trim()
      }) : { ...r, no: idx + 1 });

      cockpitState.isLoaded = true;

      Object.keys(cockpitState.multiFilters).forEach(tab => {
        Object.keys(cockpitState.multiFilters[tab]).forEach(k => populateCockpitDropdown(tab, k));
      });
      setDefaultJobScreeningFilters();
      populateTaxPeriodDropdown();
      populateDashboardYearDropdown();

      renderStrategyView();
      renderDashboardView();
      renderFixedCostsTable();
      renderFinanceTable();
      renderTaxFilingView();
      renderContactsTable();
      renderJobPostingsTable();
      renderAccountsTable();

      switchCockpitGroup('strategy');
    }
  } catch (err) {
    console.error('Failed to load cockpit data:', err);
  }
}

// =========================================================================
// 3. TAB NAVIGATION (2-TIER)
// =========================================================================
function switchCockpitGroup(group) {
  cockpitState.currentGroup = group;
  ['strategy', 'financeGroup', 'crmGroup', 'accounts'].forEach(g => {
    const btn = document.getElementById(`btnCockpitGroup_${g}`);
    const pane = document.getElementById(`cockpitGroup_${g}`);
    if (btn && pane) {
      btn.classList.toggle('active', g === group);
      pane.style.display = (g === group) ? 'block' : 'none';
    }
  });

  if (group === 'strategy') renderStrategyView();
  if (group === 'financeGroup') switchFinanceSubView(cockpitState.currentFinSub || 'dashboard');
  if (group === 'crmGroup') switchCrmSubView(cockpitState.currentCrmSub || 'contacts');
  if (group === 'accounts') renderAccountsTable();
}

function switchFinanceSubView(sub) {
  cockpitState.currentFinSub = sub;
  const map = { dashboard: 'cockpitSubPaneDashboard', finance: 'cockpitSubPaneFinance', tax: 'cockpitSubPaneTax' };
  Object.entries(map).forEach(([k, paneId]) => {
    const btn = document.getElementById(`btnFinSub_${k}`);
    const pane = document.getElementById(paneId);
    if (btn && pane) {
      btn.classList.toggle('active', k === sub);
      pane.style.display = (k === sub) ? 'block' : 'none';
    }
  });

  if (sub === 'dashboard') { renderDashboardView(); renderFixedCostsTable(); }
  if (sub === 'finance') renderFinanceTable();
  if (sub === 'tax') renderTaxFilingView();
}

function switchCrmSubView(sub) {
  cockpitState.currentCrmSub = sub;
  const map = { contacts: 'cockpitSubPaneContacts', job: 'cockpitSubPaneJob' };
  Object.entries(map).forEach(([k, paneId]) => {
    const btn = document.getElementById(`btnCrmSub_${k}`);
    const pane = document.getElementById(paneId);
    if (btn && pane) {
      btn.classList.toggle('active', k === sub);
      pane.style.display = (k === sub) ? 'block' : 'none';
    }
  });

  if (sub === 'contacts') renderContactsTable();
  if (sub === 'job') renderJobPostingsTable();
}

// =========================================================================
// 4. UNIFIED MULTISELECT DROPDOWN & PAGINATION / FILTER ENGINE
// =========================================================================
function getCockpitDataset(tab) {
  if (tab === 'job') return cockpitState.jobPostings || [];
  return cockpitState[tab] || [];
}

function checkCockpitMultiMatch(cellVal, set) {
  if (!set || set.size === 0) return true;
  const v = cleanCellVal(cellVal);
  return v ? set.has(v) : set.has('(blank)');
}

function populateCockpitDropdown(tab, key) {
  const pfx = TAB_META[tab].pfx;
  const dd = document.getElementById(`${pfx}MsDropdown_${key}`);
  if (!dd) return;

  const currentSet = cockpitState.multiFilters[tab][key];
  const uniqueSet = new Set();
  let hasBlank = false;

  getCockpitDataset(tab).forEach(item => {
    const rawVal = (tab === 'job' && key === 'status') ? (item.status || item.screening) : item[key];
    const val = cleanCellVal(rawVal);
    if (!val) hasBlank = true;
    else uniqueSet.add(val);
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
      const label = val === '(blank)' ? '<span class="text-muted font-normal">(blank)</span>' : escapeCockpitHtml(val);
      return `
        <label class="multiselect-item">
          <input type="checkbox" data-tab="${tab}" data-key="${key}" data-val="${escapeCockpitHtml(val)}" ${currentSet.has(val) ? 'checked' : ''} onchange="toggleCockpitDropdownItemElement(this)">
          <span>${label}</span>
        </label>`;
    }).join('');
}

function toggleCockpitDropdown(tab, key) {
  const pfx = TAB_META[tab].pfx;
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
  const pfx = TAB_META[tab].pfx;
  cockpitState.multiFilters[tab][key].clear();
  document.querySelectorAll(`#${pfx}MsDropdown_${key} input[type="checkbox"]`).forEach(c => { if (c !== chk) c.checked = false; });
  const msText = document.getElementById(`${pfx}MsText_${key}`);
  if (msText) msText.textContent = 'All';
  triggerCockpitTableRender(tab);
}

function toggleCockpitDropdownItemElement(chk) {
  if (!chk) return;
  const tab = chk.getAttribute('data-tab');
  const key = chk.getAttribute('data-key');
  const val = chk.getAttribute('data-val');
  const pfx = TAB_META[tab].pfx;
  const set = cockpitState.multiFilters[tab][key];

  chk.checked ? set.add(val) : set.delete(val);
  const chkAll = document.getElementById(`${pfx}ChkAll_${key}`);
  if (chkAll) chkAll.checked = !set.size;
  const msText = document.getElementById(`${pfx}MsText_${key}`);
  if (msText) msText.textContent = !set.size ? 'All' : `${set.size} selected`;
  triggerCockpitTableRender(tab);
}

function triggerCockpitTableRender(tab) {
  cockpitState.pagination[tab].page = 1;
  if (tab === 'finance') renderFinanceTable();
  else if (tab === 'accounts') renderAccountsTable();
  else if (tab === 'contacts') renderContactsTable();
  else if (tab === 'job') renderJobPostingsTable();
}

function onCockpitTextFilter(tab, col, val) {
  cockpitState.textFilters[tab][col] = val.trim();
  triggerCockpitTableRender(tab);
}

function resetCockpitFilters(tab) {
  cockpitState.textFilters[tab] = {};
  Object.values(cockpitState.multiFilters[tab]).forEach(set => set.clear());
  const { filterRowId } = TAB_META[tab];

  document.querySelectorAll(`#${filterRowId} input`).forEach(el => { el.value = ''; });
  document.querySelectorAll(`#${filterRowId} .multiselect-btn-text`).forEach(el => { el.textContent = 'All'; });

  if (tab === 'job') setDefaultJobScreeningFilters();
  triggerCockpitTableRender(tab);
}

function goToCockpitPage(tab, page) {
  const p = cockpitState.pagination[tab];
  const totalPages = p.totalPages || 1;
  if (page < 1 || page > totalPages) return;
  p.page = page;
  if (tab === 'finance') renderFinanceTable();
  else if (tab === 'accounts') renderAccountsTable();
  else if (tab === 'contacts') renderContactsTable();
  else if (tab === 'job') renderJobPostingsTable();
}

function changeCockpitPageSize(tab, newSize) {
  cockpitState.pagination[tab].pageSize = parseInt(newSize, 10) || 50;
  triggerCockpitTableRender(tab);
}

function paginateAndSync(tab, filteredRows) {
  const { pfx, badgeId } = TAB_META[tab];
  const p = cockpitState.pagination[tab];
  const totalItems = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  p.totalPages = totalPages;
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filteredRows.slice(startIdx, startIdx + p.pageSize);

  const badge = document.getElementById(badgeId);
  if (badge) badge.innerText = `${totalItems} entries`;

  const pageInfo = document.getElementById(`${pfx}PageInfoDisplay`);
  const btnPrev = document.getElementById(`${pfx}BtnPrevPage`);
  const btnNext = document.getElementById(`${pfx}BtnNextPage`);
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  return { pagedRows, startIdx };
}

// =========================================================================
// 5. STRATEGY VIEW
// =========================================================================
function renderStrategyView() {
  const container = document.getElementById('cockpitStrategyGrid');
  const badge = document.getElementById('strategyBadgeCount');
  if (!container) return;

  const list = cockpitState.strategy || [];
  if (badge) badge.innerText = `${list.length} pillars`;

  if (!list.length) {
    container.innerHTML = '<div class="empty-state-row" style="grid-column: 1 / -1; padding: 40px;">등록된 전략 데이터가 없습니다. Google Sheets의 Strategy 탭을 확인해 주세요.</div>';
    return;
  }

  const getTheme = (title) => {
    const t = String(title || '').toLowerCase();
    if (t.includes('목표') || t.includes('objective')) return { cls: 'theme-objective', badge: 'Core Missions' };
    if (t.includes('기본') || t.includes('fundamental')) return { cls: 'theme-activities', badge: 'Daily Operations' };
    if (t.includes('단기') || t.includes('short')) return { cls: 'theme-shortterm', badge: 'Immediate Execution' };
    if (t.includes('장기') || t.includes('long')) return { cls: 'theme-longterm', badge: 'Growth & Expansion' };
    return { cls: 'theme-objective', badge: 'Strategy' };
  };

  container.innerHTML = list.map(item => {
    const meta = getTheme(item.title);
    const korItems = String(item.detailsKor || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const engItems = String(item.detailsEng || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const count = Math.max(korItems.length, engItems.length);

    let itemsHtml = '';
    for (let i = 0; i < count; i++) {
      itemsHtml += `
        <li class="strategy-item-box">
          <div class="strategy-item-kor"><span class="strategy-bullet-icon">▪</span><span>${escapeCockpitHtml(korItems[i] || '')}</span></div>
          ${engItems[i] ? `<div class="strategy-item-eng">${escapeCockpitHtml(engItems[i])}</div>` : ''}
        </li>`;
    }

    return `
      <div class="strategy-card ${meta.cls}">
        <div class="strategy-card-header">
          <h4 class="strategy-card-title"><span>${escapeCockpitHtml(item.title)}</span></h4>
          <span class="strategy-card-badge">${meta.badge}</span>
        </div>
        <ul class="strategy-items-list">${itemsHtml || '<li class="text-muted text-xs">내역 없음</li>'}</ul>
      </div>`;
  }).join('');
}

// =========================================================================
// 6. DASHBOARD & FIXED COSTS (INTEGRATED)
// =========================================================================
function populateDashboardYearDropdown() {
  const select = document.getElementById('cockpitDashboardYearSelect');
  if (!select) return;

  const years = Array.from(new Set(
    cockpitState.finance.map(r => (r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y))
  )).sort((a, b) => Number(b) - Number(a));

  select.innerHTML = `<option value="ALL">All Years</option>` + years.map(y => `<option value="${y}">${y}</option>`).join('');
  const currentYear = String(new Date().getFullYear());
  const defaultYear = years.includes(currentYear) ? currentYear : (years[0] || 'ALL');
  cockpitState.dashboardYear = (cockpitState.dashboardYear === 'ALL' || years.includes(cockpitState.dashboardYear)) ? cockpitState.dashboardYear : defaultYear;
  select.value = cockpitState.dashboardYear;
}

function onDashboardYearChange(year) {
  cockpitState.dashboardYear = year;
  renderDashboardView();
}

function navigateToFinanceWithFilter(type = null, category = null) {
  resetCockpitFilters('finance');

  if (cockpitState.dashboardYear && cockpitState.dashboardYear !== 'ALL') {
    cockpitState.textFilters.finance.date = cockpitState.dashboardYear;
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

  switchCockpitGroup('financeGroup');
  switchFinanceSubView('finance');
}

function renderDashboardView() {
  const targetYear = cockpitState.dashboardYear || 'ALL';
  const rows = cockpitState.finance.filter(r => r.date && (targetYear === 'ALL' || r.date.startsWith(targetYear)));

  let revTotal = 0, revSupply = 0, revTax = 0, expTotal = 0, expTaxDeductible = 0, taxTotal = 0;
  const catRevMap = {}, catExpMap = {};

  rows.forEach(r => {
    const krw = Math.round(Number(r.totalKRW) || 0);
    const supply = Math.round(Number(r.supply) || 0);
    const tax = Math.round(Number(r.tax) || 0);
    const cat = String(r.category || '기타').trim() || '기타';

    if (r.type === '매출') {
      revTotal += krw; revSupply += supply; revTax += tax;
      catRevMap[cat] = (catRevMap[cat] || 0) + krw;
    } else if (r.type === '매입') {
      expTotal += krw; expTaxDeductible += tax;
      catExpMap[cat] = (catExpMap[cat] || 0) + krw;
    } else if (r.type === '세금') {
      taxTotal += krw;
    }
  });

  const netProfit = revTotal - expTotal;
  const marginPct = revTotal > 0 ? Math.round((netProfit / revTotal) * 100) : 0;

  const cards = [
    { title: '매출 합계 (Revenue)', badge: 'Click ↗', cls: 'kpi-val-green', val: revTotal, sub: `Supply ₩${revSupply.toLocaleString('ko-KR')} / Tax ₩${revTax.toLocaleString('ko-KR')}`, type: "'매출'" },
    { title: '매입 합계 (Expense)', badge: 'Click ↗', cls: 'kpi-val-amber', val: expTotal, sub: `Input Tax Deductible ₩${expTaxDeductible.toLocaleString('ko-KR')}`, type: "'매입'" },
    { title: '순이익 (Revenue - Expense)', badge: 'All ↗', cls: netProfit >= 0 ? 'kpi-val-blue' : 'kpi-val-red', val: netProfit, sub: `Operating Margin: ${marginPct}%`, type: 'null' },
    { title: '세금 납부 합계 (Tax)', badge: 'Click ↗', cls: 'kpi-val-red', val: taxTotal, sub: 'VAT & Income Tax Paid', type: "'세금'" }
  ];

  const wrap = document.getElementById('dashTypeCardsWrap');
  if (wrap) {
    wrap.innerHTML = cards.map(c => `
      <div class="kpi-card clickable" onclick="navigateToFinanceWithFilter(${c.type}, null)">
        <div class="kpi-card-header">
          <span class="kpi-card-title text-body font-bold" style="font-size: 0.82rem;">${c.title}</span>
          <span class="kpi-card-badge ${c.cls}">${c.badge}</span>
        </div>
        <div class="kpi-card-value ${c.cls}">₩${c.val.toLocaleString('ko-KR')}</div>
        <div class="kpi-card-sub">${c.sub}</div>
      </div>`).join('');
  }

  const renderBars = (map, total, listId, badgeId, color, typeParam) => {
    const listEl = document.getElementById(listId);
    const badgeEl = document.getElementById(badgeId);
    if (badgeEl) badgeEl.innerText = `₩${total.toLocaleString('ko-KR')}`;
    if (!listEl) return;

    const sorted = Object.entries(map).sort((a, b) => b[1] - a[1]);
    if (!sorted.length || !total) {
      listEl.innerHTML = '<div class="empty-state-row text-sm" style="padding: 16px;">내역이 없습니다.</div>';
      return;
    }

    listEl.innerHTML = sorted.map(([name, amt]) => {
      const pct = Math.round((amt / total) * 100);
      return `
        <div class="cat-item" onclick="navigateToFinanceWithFilter('${typeParam}', '${escapeCockpitHtml(name)}')">
          <div class="cat-item-top">
            <span class="cat-item-name">${escapeCockpitHtml(name)}</span>
            <span class="cat-item-val">₩${amt.toLocaleString('ko-KR')} (${pct}%) ↗</span>
          </div>
          <div class="cat-bar-bg"><div class="cat-bar-fill" style="width: ${pct}%; background: ${color};"></div></div>
        </div>`;
    }).join('');
  };

  renderBars(catRevMap, revTotal, 'dashRevCategoryList', 'dashRevTotalBadge', '#16a34a', '매출');
  renderBars(catExpMap, expTotal, 'dashExpCategoryList', 'dashExpTotalBadge', '#d97706', '매입');
}

function renderFixedCostsTable() {
  const tbody = document.getElementById('cockpitFixedTableBody');
  const badge = document.getElementById('fixedBadgeCount');
  const totalBadge = document.getElementById('fixedTotalCostBadge');
  if (!tbody) return;

  const list = cockpitState.fixedCosts || [];
  const sumCost = list.reduce((acc, item) => acc + (Number(item.cost) || 0), 0);
  if (badge) badge.innerText = `${list.length} items`;
  if (totalBadge) totalBadge.innerText = `Total Cost: ₩${sumCost.toLocaleString('ko-KR')}`;

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state-row text-sm">No fixed costs found.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((r, idx) => {
    const vLink = cleanCellVal(r.vendorLink);
    const vName = escapeCockpitHtml(r.vendor || '');
    const vendorHtml = vLink ? `<a href="${escapeCockpitHtml(vLink)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration: none;">${vName}</a>` : vName;

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${idx + 1}</td>
        <td class="data-cell text-main font-normal">${escapeCockpitHtml(r.item || '')}</td>
        <td class="data-cell font-normal">${vendorHtml}</td>
        <td class="data-cell cell-right font-normal">₩${(Number(r.cost) || 0).toLocaleString('ko-KR')}</td>
        <td class="data-cell cell-right text-muted font-normal">${Number(r.vat) ? `₩${Number(r.vat).toLocaleString('ko-KR')}` : ''}</td>
        <td class="data-cell cell-center text-muted font-normal">${escapeCockpitHtml(r.firstPurchase || '')}</td>
        <td class="data-cell cell-center"><span class="text-xs text-muted font-normal" style="background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">${escapeCockpitHtml(r.interval || 'Annual')}</span></td>
        <td class="data-cell text-muted font-normal cell-ellipsis" title="${escapeCockpitHtml(r.remarks || '')}">${escapeCockpitHtml(r.remarks || '')}</td>
      </tr>`;
  }).join('');
}

// =========================================================================
// 7. DATA TABLES (FINANCE, ACCOUNTS, CONTACTS, JOB POSTINGS)
// =========================================================================
function renderFinanceTable() {
  const tbody = document.getElementById('cockpitFinanceTableBody');
  if (!tbody) return;

  const f = cockpitState.textFilters.finance;
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
  }).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const totals = filtered.reduce((acc, r) => {
    acc.usd += Math.round(Number(r.totalUSD) || 0);
    acc.krw += Math.round(Number(r.totalKRW) || 0);
    acc.supply += Math.round(Number(r.supply) || 0);
    acc.tax += Math.round(Number(r.tax) || 0);
    return acc;
  }, { usd: 0, krw: 0, supply: 0, tax: 0 });

  const sumBadge = document.getElementById('finFilteredSummaryBadge');
  if (sumBadge) {
    const usdPart = totals.usd ? `Total($): $${totals.usd.toLocaleString('en-US')} | ` : '';
    sumBadge.innerText = `${usdPart}Total(₩): ₩${totals.krw.toLocaleString('ko-KR')} | Supply: ₩${totals.supply.toLocaleString('ko-KR')} | Tax: ₩${totals.tax.toLocaleString('ko-KR')}`;
  }

  const { pagedRows, startIdx } = paginateAndSync('finance', filtered);
  if (!pagedRows.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const isInc = r.type === '매출', isTax = r.type === '세금';
    const tagBg = isInc ? '#ecfdf5' : (isTax ? '#fef3c7' : '#fef2f2');
    const tagColor = isInc ? '#16a34a' : (isTax ? '#d97706' : '#dc2626');
    const usd = r.totalUSD ? `$${Math.round(Number(r.totalUSD)).toLocaleString('en-US')}` : '';

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${startIdx + idx + 1}</td>
        <td class="data-cell font-normal" style="white-space: nowrap;">${escapeCockpitHtml(r.date)}</td>
        <td class="data-cell cell-center font-normal"><span style="background: ${tagBg}; color: ${tagColor}; padding: 1px 4px; border-radius: 4px; font-size: 0.72rem;">${escapeCockpitHtml(r.type)}</span></td>
        <td class="data-cell text-body font-normal">${escapeCockpitHtml(r.category)}</td>
        <td class="data-cell font-normal" style="white-space: nowrap;">${escapeCockpitHtml(r.client)}</td>
        <td class="data-cell text-muted font-normal">${escapeCockpitHtml(r.transaction)}</td>
        <td class="data-cell cell-ellipsis font-normal" title="${escapeCockpitHtml(r.description)}">${escapeCockpitHtml(r.description)}</td>
        <td class="data-cell cell-center text-muted font-normal text-xs">${escapeCockpitHtml(r.taxType)}</td>
        <td class="data-cell cell-right kpi-val-green font-normal">${usd}</td>
        <td class="data-cell cell-right font-normal">₩${Math.round(Number(r.totalKRW) || 0).toLocaleString('ko-KR')}</td>
        <td class="data-cell cell-right text-muted font-normal">₩${Math.round(Number(r.supply) || 0).toLocaleString('ko-KR')}</td>
        <td class="data-cell cell-right text-muted font-normal">₩${Math.round(Number(r.tax) || 0).toLocaleString('ko-KR')}</td>
      </tr>`;
  }).join('');
}

function renderAccountsTable() {
  const tbody = document.getElementById('cockpitAccountsTableBody');
  if (!tbody) return;

  const f = cockpitState.textFilters.accounts;
  const mf = cockpitState.multiFilters.accounts;

  const filtered = cockpitState.accounts.filter(row => {
    if (!checkCockpitMultiMatch(row.site, mf.site)) return false;
    if (!checkCockpitMultiMatch(row.companyId, mf.companyId)) return false;
    if (!checkCockpitMultiMatch(row.rootOrgUnit, mf.rootOrgUnit)) return false;
    if (f.idEmail && !cleanCellVal(row.idEmail).toLowerCase().includes(f.idEmail.toLowerCase())) return false;
    if (f.remarks && !cleanCellVal(row.remarks).toLowerCase().includes(f.remarks.toLowerCase())) return false;
    return true;
  });

  const { pagedRows, startIdx } = paginateAndSync('accounts', filtered);
  if (!pagedRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => `
    <tr>
      <td class="data-cell cell-center text-muted font-normal text-sm">${startIdx + idx + 1}</td>
      <td class="data-cell font-normal text-main">${escapeCockpitHtml(cleanCellVal(r.site))}</td>
      <td class="data-cell cell-center font-normal">${escapeCockpitHtml(cleanCellVal(r.companyId))}</td>
      <td class="data-cell cell-center font-normal">${escapeCockpitHtml(cleanCellVal(r.rootOrgUnit))}</td>
      <td class="data-cell font-normal">${escapeCockpitHtml(cleanCellVal(r.idEmail))}</td>
      <td class="data-cell col-multiline font-normal">${escapeCockpitHtml(cleanCellVal(r.remarks))}</td>
    </tr>`).join('');
}

function copyContactEmail(email) {
  if (!email || email === '-') return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(email).catch(() => fallbackCopyText(email));
  } else {
    fallbackCopyText(email);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function renderContactsTable() {
  const tbody = document.getElementById('cockpitContactsTableBody');
  if (!tbody) return;

  const f = cockpitState.textFilters.contacts;
  const mf = cockpitState.multiFilters.contacts;

  const filtered = cockpitState.contacts.filter(row => {
    if (f.name) {
      const q = f.name.toLowerCase();
      if (!String(row.name || '').toLowerCase().includes(q) && !String(row.email || '').toLowerCase().includes(q)) return false;
    }
    if (f.company && !String(row.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.jobTitle && !String(row.jobTitle || '').toLowerCase().includes(f.jobTitle.toLowerCase())) return false;
    if (['imds', 'regRm', 'inquiry', 'supplyChain', 'koreca', 'mdsk'].some(k => !checkCockpitMultiMatch(row[k], mf[k]))) return false;
    if (f.remarks && !String(row.remarks || '').toLowerCase().includes(f.remarks.toLowerCase())) return false;
    return true;
  });

  const { pagedRows, startIdx } = paginateAndSync('contacts', filtered);
  if (!pagedRows.length) {
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state-row text-sm">No records found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const name = cleanCellVal(r.name), email = cleanCellVal(r.email);
    const nameHtml = email
      ? `<span class="clickable-cid font-normal" style="max-width: 100%; overflow: hidden; text-overflow: ellipsis; vertical-align: middle;" data-email="${escapeCockpitHtml(email)}" onclick="copyContactEmail(this.getAttribute('data-email'))" data-tooltip="Click to copy email">${escapeCockpitHtml(name || email)}</span>`
      : `<span class="cell-ellipsis" style="display: inline-block; max-width: 100%; vertical-align: middle;" title="${escapeCockpitHtml(name)}">${escapeCockpitHtml(name || '-')}</span>`;

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${startIdx + idx + 1}</td>
        <td class="data-cell font-normal">${nameHtml}</td>
        <td class="data-cell text-body font-normal">${escapeCockpitHtml(r.company)}</td>
        <td class="data-cell cell-center text-muted font-normal">${escapeCockpitHtml(r.jobTitle)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(r.imds)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(r.regRm)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(r.inquiry)}</td>
        <td class="data-cell cell-center text-primary font-normal">${escapeCockpitHtml(r.supplyChain)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(r.koreca)}</td>
        <td class="data-cell cell-center font-normal" style="color: #1e293b;">${escapeCockpitHtml(r.mdsk)}</td>
        <td class="data-cell col-multiline font-normal">${escapeCockpitHtml(r.remarks)}</td>
      </tr>`;
  }).join('');
}

function renderJobPostingsTable() {
  const tbody = document.getElementById('cockpitJobPostingsTableBody');
  if (!tbody) return;

  const f = cockpitState.textFilters.job;
  const mf = cockpitState.multiFilters.job;

  const filtered = cockpitState.jobPostings.filter(row => {
    if (!checkCockpitMultiMatch(row.source, mf.source)) return false;
    if (f.dateSearched && !String(row.dateSearched || '').includes(f.dateSearched)) return false;
    if (f.company && !String(row.company || '').toLowerCase().includes(f.company.toLowerCase())) return false;
    if (f.title && !String(row.title || '').toLowerCase().includes(f.title.toLowerCase())) return false;
    if (!checkCockpitMultiMatch(row.status || row.screening, mf.status)) return false;
    if (!checkCockpitMultiMatch(row.outreachStatus, mf.outreachStatus)) return false;
    if (f.contact) {
      const q = f.contact.toLowerCase();
      if (!String(row.contactName || '').toLowerCase().includes(q) && !String(row.contactEmail || '').toLowerCase().includes(q)) return false;
    }
    if (f.remarks && !String(row.remarks || '').toLowerCase().includes(f.remarks.toLowerCase())) return false;
    return true;
  }).sort((a, b) => String(b.dateSearched || '').localeCompare(String(a.dateSearched || '')));

  const { pagedRows, startIdx } = paginateAndSync('job', filtered);
  if (!pagedRows.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state-row text-sm">No records found.</td></tr>';
    updateJobOutreachSummary();
    return;
  }

  tbody.innerHTML = pagedRows.map((r, idx) => {
    const link = cleanCellVal(r.link), title = cleanCellVal(r.title);
    const status = cleanCellVal(r.status || r.screening), outreach = cleanCellVal(r.outreachStatus);
    const cName = cleanCellVal(r.contactName), cEmail = cleanCellVal(r.contactEmail);

    const titleHtml = link
      ? `<a href="${escapeCockpitHtml(link)}" target="_blank" rel="noopener noreferrer" class="text-info font-normal" style="text-decoration: none;" title="Open Job Link">${escapeCockpitHtml(title || 'Link')}</a>`
      : escapeCockpitHtml(title);

    const contactHtml = cEmail
      ? `<span class="clickable-cid font-normal" data-email="${escapeCockpitHtml(cEmail)}" onclick="copyContactEmail(this.getAttribute('data-email'))" data-tooltip="Click to copy email">${escapeCockpitHtml(cName || cEmail)}</span>`
      : (cName ? `<span class="text-body font-normal">${escapeCockpitHtml(cName)}</span>` : '');

    const stClean = status.toLowerCase().replace(/[\s-_]+/g, '');
    const statusColor = stClean === 'inprogress' ? '#16a34a' : (stClean === 'reachedout' ? '#7c3aed' : '#64748b');

    return `
      <tr>
        <td class="data-cell cell-center text-muted text-sm font-normal">${startIdx + idx + 1}</td>
        <td class="data-cell text-main font-normal">${escapeCockpitHtml(cleanCellVal(r.source))}</td>
        <td class="data-cell cell-center text-muted font-mono font-normal">${escapeCockpitHtml(cleanCellVal(r.dateSearched))}</td>
        <td class="data-cell text-body font-normal">${escapeCockpitHtml(cleanCellVal(r.company))}</td>
        <td class="data-cell font-normal" style="white-space: normal; word-break: break-word;">${titleHtml}</td>
        <td class="data-cell cell-center font-normal" style="color: ${statusColor};">${escapeCockpitHtml(status)}</td>
        <td class="data-cell cell-center font-normal">${outreach ? `<span class="text-body font-normal">${escapeCockpitHtml(outreach)}</span>` : ''}</td>
        <td class="data-cell font-normal">${contactHtml}</td>
        <td class="data-cell col-multiline font-normal" style="white-space: normal; word-break: break-word;">${escapeCockpitHtml(cleanCellVal(r.remarks))}</td>
      </tr>`;
  }).join('');

  updateJobOutreachSummary();
}

// =========================================================================
// 8. JOB POSTINGS SCREENING OVERVIEW CHIPS
// =========================================================================
function setDefaultJobScreeningFilters() {
  const statusSet = cockpitState.multiFilters.job.status;
  statusSet.clear();
  statusSet.add('(blank)');

  cockpitState.jobPostings.forEach(r => {
    const raw = cleanCellVal(r.status || r.screening);
    if (raw.toLowerCase().replace(/[\s-_]+/g, '') === 'inprogress') statusSet.add(raw);
  });

  const msText = document.getElementById('jobMsText_status');
  if (msText) msText.textContent = `${statusSet.size} selected`;
}

function getSummaryChipStyle(theme, active) {
  const styles = {
    blank: active
      ? { chip: 'background:#475569;color:#fff;border:1px solid #334155;', badge: 'background:rgba(255,255,255,0.25);color:#fff;' }
      : { chip: 'background:#f8fafc;color:#64748b;border:1px solid #cbd5e1;', badge: 'background:#e2e8f0;color:#475569;' },
    inprogress: active
      ? { chip: 'background:#16a34a;color:#fff;border:1px solid #15803d;', badge: 'background:rgba(255,255,255,0.25);color:#fff;' }
      : { chip: 'background:#f0fdf4;color:#16a34a;border:1px solid #86efac;', badge: 'background:#dcfce7;color:#15803d;' },
    reachedout: active
      ? { chip: 'background:#7c3aed;color:#fff;border:1px solid #6d28d9;', badge: 'background:rgba(255,255,255,0.25);color:#fff;' }
      : { chip: 'background:#faf5ff;color:#7c3aed;border:1px solid #d8b4fe;', badge: 'background:#ede9fe;color:#6d28d9;' },
    outreach_sub: active
      ? { chip: 'background:#0d9488;color:#fff;border:1px solid #0f766e;', badge: 'background:rgba(255,255,255,0.25);color:#fff;' }
      : { chip: 'background:#f0fdfa;color:#0f766e;border:1px solid #99f6e4;', badge: 'background:#ccfbf1;color:#0f766e;' }
  };
  return styles[theme] || styles.blank;
}

function updateJobOutreachSummary() {
  const container = document.getElementById('jobOutreachSummaryBody');
  const badge = document.getElementById('jobOutreachTotalBadge');
  if (!container) return;

  const allJobs = cockpitState.jobPostings || [];
  if (badge) badge.textContent = `${allJobs.length} total`;

  let blankCount = 0, reachedOutCount = 0, inProgressCount = 0;
  const outreachCounts = {};

  allJobs.forEach(r => {
    const rawSt = cleanCellVal(r.status || r.screening);
    const stClean = rawSt.toLowerCase().replace(/[\s-_]+/g, '');
    if (!rawSt) blankCount++;
    else if (stClean === 'inprogress') {
      inProgressCount++;
      const ov = cleanCellVal(r.outreachStatus);
      if (ov) outreachCounts[ov] = (outreachCounts[ov] || 0) + 1;
    } else if (stClean === 'reachedout') reachedOutCount++;
  });

  const statusSet = cockpitState.multiFilters.job.status;
  const outreachSet = cockpitState.multiFilters.job.outreachStatus;
  const normArr = Array.from(statusSet).map(s => s.toLowerCase().replace(/[\s-_]+/g, ''));

  const isBlank = statusSet.size === 1 && statusSet.has('(blank)');
  const isReached = statusSet.size === 1 && normArr.includes('reachedout');
  const isInProg = statusSet.size > 0 && normArr.every(s => s === 'inprogress') && !outreachSet.size;

  const chipHtml = (label, count, theme, active, action) => {
    const st = getSummaryChipStyle(theme, active);
    return `<span class="insight-chip tag" style="cursor:pointer;font-size:0.74rem;padding:3px 9px;border-radius:6px;${st.chip}" onclick="${action}">${label} <span class="insight-chip-badge font-semibold text-xs" style="border-radius:4px;padding:1px 5px;margin-left:4px;${st.badge}">${count}</span></span>`;
  };

  const subChips = Object.keys(outreachCounts).sort((a, b) => a.localeCompare(b, 'ko-KR', { numeric: true })).map(k => {
    const active = normArr.includes('inprogress') && outreachSet.has(k);
    return chipHtml(`↳ ${escapeCockpitHtml(k)}`, outreachCounts[k], 'outreach_sub', active, `filterJobSummaryGroup('OUTREACH', '${escapeCockpitHtml(k)}')`);
  }).join('');

  container.innerHTML = [
    chipHtml('Blank (공란)', blankCount, 'blank', isBlank, "filterJobSummaryGroup('BLANK')"),
    '<span style="color:#cbd5e1;margin:0 4px;align-self:center;">|</span>',
    chipHtml('In Progress', inProgressCount, 'inprogress', isInProg, "filterJobSummaryGroup('IN_PROGRESS')"),
    subChips,
    '<span style="color:#cbd5e1;margin:0 4px;align-self:center;">|</span>',
    chipHtml('Reached out', reachedOutCount, 'reachedout', isReached, "filterJobSummaryGroup('REACHED_OUT')")
  ].join('');
}

function filterJobSummaryGroup(type, subVal = null) {
  const statusSet = cockpitState.multiFilters.job.status;
  const outreachSet = cockpitState.multiFilters.job.outreachStatus;
  const normArr = Array.from(statusSet).map(s => s.toLowerCase().replace(/[\s-_]+/g, ''));

  const addMatchingStatus = (targetClean) => {
    statusSet.clear();
    cockpitState.jobPostings.forEach(r => {
      const raw = cleanCellVal(r.status || r.screening);
      if (raw.toLowerCase().replace(/[\s-_]+/g, '') === targetClean) statusSet.add(raw);
    });
  };

  if (type === 'BLANK') {
    (statusSet.size === 1 && statusSet.has('(blank)')) ? statusSet.clear() : (statusSet.clear(), statusSet.add('(blank)'));
    outreachSet.clear();
  } else if (type === 'IN_PROGRESS') {
    (statusSet.size > 0 && normArr.every(s => s === 'inprogress') && !outreachSet.size) ? statusSet.clear() : addMatchingStatus('inprogress');
    outreachSet.clear();
  } else if (type === 'OUTREACH' && subVal) {
    if (normArr.includes('inprogress') && outreachSet.has(subVal)) {
      statusSet.clear(); outreachSet.clear();
    } else {
      addMatchingStatus('inprogress');
      outreachSet.clear(); outreachSet.add(subVal);
    }
  } else if (type === 'REACHED_OUT') {
    (statusSet.size === 1 && normArr.includes('reachedout')) ? statusSet.clear() : addMatchingStatus('reachedout');
    outreachSet.clear();
  }

  const stTxt = document.getElementById('jobMsText_status');
  if (stTxt) stTxt.textContent = !statusSet.size ? 'All' : `${statusSet.size} selected`;
  const outTxt = document.getElementById('jobMsText_outreachStatus');
  if (outTxt) outTxt.textContent = !outreachSet.size ? 'All' : `${outreachSet.size} selected`;

  triggerCockpitTableRender('job');
}

// =========================================================================
// 9. TAX FILING ENGINE (VAT & INCOME TAX SIMULATION)
// =========================================================================
function parseCleanInt(val, fallback = 0) {
  const num = parseInt(String(val || '').replace(/[^\d-]/g, ''), 10);
  return isNaN(num) ? fallback : num;
}

function populateTaxPeriodDropdown() {
  const select = document.getElementById('taxFilingPeriodSelect');
  if (!select) return;

  const curYear = String(new Date().getFullYear());
  const dataYears = new Set(cockpitState.finance.map(r => (r.date || '').slice(0, 4)).filter(y => /^\d{4}$/.test(y)));
  const allYears = Array.from(new Set([curYear, ...dataYears])).sort((a, b) => Number(b) - Number(a));

  select.innerHTML = allYears.map(y => `
    <option value="${y}-FY">${y} 종소세 (연간)</option>
    <option value="${y}-H2">${y} 하반기 부가세 (2기)</option>
    <option value="${y}-H1">${y} 상반기 부가세 (1기)</option>`).join('');

  if (!cockpitState.taxPeriod || !allYears.includes(cockpitState.taxPeriod.slice(0, 4))) {
    const latestYear = dataYears.has(curYear) ? curYear : (Array.from(dataYears).sort((a, b) => Number(b) - Number(a))[0] || curYear);
    cockpitState.taxPeriod = `${latestYear}-FY`;
  }
  select.value = cockpitState.taxPeriod;
}

function onTaxPeriodChange(period) { cockpitState.taxPeriod = period; renderTaxFilingView(); }
function onTaxInputChange(field, el) {
  const val = parseCleanInt(el.value, 0);
  cockpitState.taxInputs[field] = val;
  el.value = val.toLocaleString('ko-KR');
  renderTaxFilingView();
}
function onTaxRateChange(el) {
  const v = parseFloat(el.value);
  cockpitState.taxInputs.baseExpenseRate = isNaN(v) ? 0 : Math.min(100, Math.max(0, v));
  renderTaxFilingView();
}
function resetTaxInputsToDefault() {
  cockpitState.taxInputs = { ...DEFAULT_TAX_INPUTS };
  renderTaxFilingView();
}

function renderTaxFilingView() {
  const curY = String(new Date().getFullYear());
  const [y = curY, type = 'FY'] = (cockpitState.taxPeriod || `${curY}-FY`).split('-');
  const isVat = type === 'H1' || type === 'H2';
  const start = type === 'H2' ? `${y}-07-01` : `${y}-01-01`;
  const end = type === 'H1' ? `${y}-06-30` : `${y}-12-31`;

  document.getElementById('taxVatSectionBlock')?.style.setProperty('display', isVat ? 'block' : 'none');
  document.getElementById('taxIncomeSectionBlock')?.style.setProperty('display', isVat ? 'none' : 'block');

  const won = n => `₩${Math.round(n).toLocaleString('ko-KR')}`;

  if (isVat) {
    let sTaxSup = 0, sTax = 0, sZero = 0, sEx = 0, pInvSup = 0, pInvTax = 0, pCardSup = 0, pCardTax = 0, pNon = 0;
    cockpitState.finance.filter(r => r.date >= start && r.date <= end).forEach(r => {
      const sup = Math.round(Number(r.supply) || 0), tax = Math.round(Number(r.tax) || 0);
      if (r.type === '매출') {
        if (r.taxType === '과세') { sTaxSup += sup; sTax += tax; }
        else if (r.taxType === '영세') sZero += sup;
        else sEx += sup;
      } else if (r.type === '매입') {
        if (r.transaction === '전자세금계산서' && r.taxType === '과세') { pInvSup += sup; pInvTax += tax; }
        else if (r.transaction === '사업자카드' && r.taxType === '과세') { pCardSup += sup; pCardTax += tax; }
        else pNon += sup;
      }
    });

    const totalPurchTax = pInvTax + pCardTax;
    const netVat = sTax - totalPurchTax;
    const vatTbody = document.getElementById('taxVatTableBody');
    if (vatTbody) {
      vatTbody.innerHTML = `
        <tr style="background:#fafafa;"><td colspan="4" class="data-cell" style="color:#1e293b;">[과세표준 및 매출세액]</td></tr>
        <tr><td class="data-cell font-normal" style="padding-left:20px;">과세 세금계산서 발급분 (10%)</td><td class="data-cell text-muted font-normal">국내 일반 용역</td><td class="data-cell cell-right font-normal">${won(sTaxSup)}</td><td class="data-cell cell-right text-primary font-normal">${won(sTax)}</td></tr>
        <tr><td class="data-cell font-normal" style="padding-left:20px;">영세율 (외화획득 용역)</td><td class="data-cell text-muted font-normal">해외 기술자문 (APA 등 외화 수임)</td><td class="data-cell cell-right font-normal">${won(sZero)}</td><td class="data-cell cell-right text-muted font-normal">₩0</td></tr>
        <tr><td class="data-cell font-normal" style="padding-left:20px;">면세 / 비과세 매출</td><td class="data-cell text-muted font-normal">협회 강의 등 소득세 원천징수분</td><td class="data-cell cell-right font-normal">${won(sEx)}</td><td class="data-cell cell-right text-muted font-normal">₩0</td></tr>
        <tr style="background:#f1f5f9;"><td colspan="2" class="data-cell cell-right text-body font-normal">매출세액 합계</td><td class="data-cell cell-right font-normal">${won(sTaxSup + sZero + sEx)}</td><td class="data-cell cell-right text-primary font-normal">${won(sTax)}</td></tr>
        <tr style="background:#fafafa;"><td colspan="4" class="data-cell" style="color:#1e293b;">[매입세액 및 경비공제]</td></tr>
        <tr><td class="data-cell font-normal" style="padding-left:20px;">세금계산서 수취분 (일반매입)</td><td class="data-cell text-muted font-normal">사무실 임대료 등 과세 세금계산서</td><td class="data-cell cell-right font-normal">${won(pInvSup)}</td><td class="data-cell cell-right text-warning font-normal">${won(pInvTax)}</td></tr>
        <tr><td class="data-cell font-normal" style="padding-left:20px;">신용카드매출전표 수령명세 (과세)</td><td class="data-cell text-muted font-normal">사업자카드 결제 (소모품, 비품, 과세 구독)</td><td class="data-cell cell-right font-normal">${won(pCardSup)}</td><td class="data-cell cell-right text-warning font-normal">${won(pCardTax)}</td></tr>
        <tr><td class="data-cell text-muted font-normal" style="padding-left:20px;">불공제 / 비과세 매입 (공제제외)</td><td class="data-cell text-muted font-normal">금융수수료, 비과세 해외결제, 세금 납부</td><td class="data-cell cell-right text-muted font-normal">${won(pNon)}</td><td class="data-cell cell-right text-muted font-normal">₩0</td></tr>
        <tr style="background:#f1f5f9;"><td colspan="2" class="data-cell cell-right text-body font-normal">공제대상 매입세액 합계</td><td class="data-cell cell-right font-normal">${won(pInvSup + pCardSup)}</td><td class="data-cell cell-right text-warning font-normal">${won(totalPurchTax)}</td></tr>
        <tr style="background:#fff;border-top:2px solid var(--border-gray);">
          <td colspan="2" class="data-cell font-semibold text-main" style="font-size:0.95rem;">차감 납부(환급) 세액 (Tax Due / Refund)</td>
          <td colspan="2" class="data-cell cell-right font-semibold" style="font-size:1.05rem;color:${netVat >= 0 ? '#dc2626' : '#16a34a'};">${netVat >= 0 ? `납부 예상 ${won(netVat)}` : `환급 예상 ${won(Math.abs(netVat))}`}</td>
        </tr>`;
    }

    const vatBadge = document.getElementById('taxVatNetBadge');
    if (vatBadge) {
      vatBadge.style.background = netVat >= 0 ? '#fef2f2' : '#ecfdf5';
      vatBadge.style.color = netVat >= 0 ? '#dc2626' : '#16a34a';
      vatBadge.innerText = netVat >= 0 ? `납부 예상: ${won(netVat)}` : `환급 예상: ${won(Math.abs(netVat))}`;
    }
    return;
  }

  // Income Tax Simulation
  const inp = cockpitState.taxInputs;
  const baseRate = inp.baseExpenseRate ?? 16;
  const expBase = Math.round(inp.revenue * (baseRate / 100));
  const incSimp = Math.max(0, inp.revenue - inp.actualExpense - inp.healthInsurance);
  const incBase = Math.max(0, inp.revenue - expBase);
  const dedTotal = inp.dedPersonal + inp.dedYellow + inp.dedNps;
  const tbSimp = Math.max(0, incSimp - dedTotal);
  const tbBase = Math.max(0, incBase - dedTotal);

  const calcTax = b => b <= 0 ? 0 : (b <= 14000000 ? Math.round(b * 0.06) : (b <= 50000000 ? Math.round(b * 0.15 - 1260000) : Math.round(b * 0.24 - 5760000)));
  const cSimp = calcTax(tbSimp), cBase = calcTax(tbBase);
  const redSimp = Math.round(cSimp * 0.5);
  const creditPen = Math.round(inp.pensionSavings * 0.15);
  const itSimp = Math.max(0, (cSimp - redSimp) - creditPen);
  const itBase = Math.max(0, cBase - creditPen);
  const penBase = inp.revenue >= 48000000 ? Math.round(cBase * 0.2) : 0;
  const locSimp = Math.round(itSimp * 0.1), locBase = Math.round((itBase + penBase) * 0.1);
  const finalSimp = itSimp + locSimp, finalBase = itBase + penBase + locBase;
  const diffSaving = finalBase - finalSimp;

  const numInput = (field, val) => `<input type="text" style="width:110px;padding:3px 6px;font-size:0.78rem;text-align:right;border:1px solid #cbd5e1;border-radius:4px;background:#fff;outline:none;" value="${val.toLocaleString('ko-KR')}" onchange="onTaxInputChange('${field}', this)" oninput="this.value=this.value.replace(/[^0-9]/g,'')">`;

  const theadRow = document.querySelector('#taxStrategyTable thead tr');
  if (theadRow) {
    theadRow.innerHTML = `
      <th class="data-table-th" style="width:175px;padding:6px 8px;">구분 항목</th>
      <th class="data-table-th" style="width:145px;padding:6px 8px;">간편장부 ✏️</th>
      <th class="data-table-th" style="width:155px;padding:6px 8px;">기준경비 (<input type="number" step="0.1" min="0" max="100" style="width:48px;padding:2px 4px;font-size:0.78rem;text-align:center;border:1px solid #93c5fd;border-radius:4px;background:#eff6ff;font-weight:600;color:#1d4ed8;outline:none;" value="${baseRate}" onchange="onTaxRateChange(this)">%) ✏️</th>
      <th class="data-table-th" style="padding:6px 10px;">비고 및 계산 근거</th>`;
  }

  const rows = [
    ['총 매출액 (a)', numInput('revenue', inp.revenue), won(inp.revenue), '외화(USD) 매출 동일 반영'],
    ['인정 경비 (b)', numInput('actualExpense', inp.actualExpense), won(expBase), `간편장부: 실제 지출액 (3대 비용 포함)<br>기준경비적용: 정부인정경비(기타 전문 서비스업[749942] ${baseRate}%) 자동 연산`],
    ['건강 보험 (c)', numInput('healthInsurance', inp.healthInsurance), '₩0', '지역 건강보험료 납부액은 간편장부 시 필요경비 전액 산입 (기준경비 제외)'],
    ['종합소득금액 (A)(a-b-c)', won(incSimp), `<span style="color:#2563eb;">${won(incBase)}</span>`, '경비율 적용 시 소득 차이 발생', 'background:#f8fafc;'],
    ['&nbsp;&nbsp;인적공제 (d)', numInput('dedPersonal', inp.dedPersonal), won(inp.dedPersonal), '본인 기본공제 (150만 원)'],
    ['&nbsp;&nbsp;노란우산공제 (e)', numInput('dedYellow', inp.dedYellow), won(inp.dedYellow), '소기업·소상공인 공제부금 최대 불입'],
    ['&nbsp;&nbsp;국민연금 공제 (f)', numInput('dedNps', inp.dedNps), won(inp.dedNps), '전액(100%) 과세표준에서 차감'],
    ['소득공제 (B)(d+e+f)', won(dedTotal), won(dedTotal), '본인 공제 + 노란우산공제 + 국민연금공제 자동 동기화', 'background:#f8fafc;'],
    ['과세표준 (A-B)', won(tbSimp), won(tbBase), '세금을 매기는 기준 금액', 'background:#f1f5f9;'],
    ['세율 및 산출세액 (C)', won(cSimp), won(cBase), '1400만까지 6%, 5000만까지 15% 세율 구간 적용'],
    ['<span class="text-primary">창업중소기업 세액감면 (D)</span>', `<span class="text-primary">${won(redSimp)}</span>`, '₩0', '<span class="text-primary">\'창업중소기업 세액감면 신청서\' 필수 제출 | 기준경비 시 적용 불가 | 용인시 일반 창업자 50% 감면 (5년간)</span>'],
    ['개인연금저축 (g)', numInput('pensionSavings', inp.pensionSavings), won(inp.pensionSavings), '개인연금저축 연간 납입액 자동 동기화'],
    ['세액공제 (E)(g*0.15)', `<span class="text-primary">${won(creditPen)}</span>`, `<span class="text-primary">${won(creditPen)}</span>`, `개인연금저축 (${(inp.pensionSavings / 10000).toLocaleString('ko-KR')}만 × 15% 공제율)`],
    ['종합소득세 (F)(C-D-E)', won(itSimp), won(itBase), '산출세액 - 세액감면 - 세액공제'],
    ['무기장 가산세 (G)', '₩0', `<span style="color:${penBase > 0 ? '#dc2626' : '#94a3b8'};">${won(penBase)}</span>`, '매출 4,800만 원 미만 면제, 이상은 20% 추가 (간편장부 없음)'],
    ['지방소득세 (H) ((F+G)*0.1)', won(locSimp), won(locBase), '종합소득세 + 가산세의 10% 별도 부과'],
    ['최종 세액 (I)(F+G+H)', `<span style="color:#16a34a;font-size:0.92rem;">${won(finalSimp)}</span>`, `<span style="color:#dc2626;font-size:0.92rem;">${won(finalBase)}</span>`, '<span class="text-info">납부 예상 합계액 (국세 + 지방세)</span>', 'background:#fff;border-top:2px solid var(--border-gray);'],
    ['<span style="color:#15803d;">간편장부 대비 절감</span>', '- (기준)', `<span style="color:#15803d;font-size:0.98rem;">+${won(diffSaving)}</span>`, '<span style="color:#15803d;">무엇이 유리한지 여기서 비교! (간편장부 선택 시 절세 효과)</span>', 'background:#f0fdf4;']
  ];

  const strTbody = document.getElementById('taxStrategyTableBody');
  if (strTbody) {
    strTbody.innerHTML = rows.map(([label, col1, col2, note, trStyle = '']) => `
      <tr style="${trStyle}">
        <td class="data-cell font-normal" style="padding:5px 8px;">${label}</td>
        <td class="data-cell cell-right font-normal" style="padding:5px 8px;">${col1}</td>
        <td class="data-cell cell-right font-normal" style="padding:5px 8px;">${col2}</td>
        <td class="data-cell text-muted font-normal" style="padding:5px 10px;font-size:0.74rem;line-height:1.4;white-space:normal;word-break:keep-all;">${note}</td>
      </tr>`).join('');
  }

  const incBadge = document.getElementById('taxIncomeNetBadge');
  if (incBadge) {
    incBadge.style.background = '#ecfdf5';
    incBadge.style.color = '#16a34a';
    incBadge.innerText = `간편장부 절세 효과: ${won(diffSaving)}`;
  }
}

// 외부 클릭 시 다중 선택 드롭다운 닫기
document.addEventListener('click', e => {
  if (!e.target.closest('.multiselect-container')) {
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));
  }
});

// 전역 노출
Object.assign(window, {
  initCockpitModule, loadCockpitData,
  switchCockpitGroup, switchFinanceSubView, switchCrmSubView,
  onDashboardYearChange, navigateToFinanceWithFilter,
  onTaxPeriodChange, onTaxInputChange, onTaxRateChange, resetTaxInputsToDefault,
  toggleCockpitDropdown, selectAllCockpitDropdown, toggleCockpitDropdownItemElement,
  onCockpitTextFilter, resetCockpitFilters, goToCockpitPage, changeCockpitPageSize,
  copyContactEmail, filterJobSummaryGroup
});