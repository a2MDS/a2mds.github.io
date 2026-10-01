/**
 * a2MDS Cockpit Module - Finance, Schedule & Tax Filing Engine
 * Fully Dynamic Year Selector, Mutual Exclusive Tax Views, Full Tax Strategy Comparison,
 * No Horizontal/Vertical Scroll in Tax Filing (Full Visibility), Correct Multiplier (2.8x),
 * Pension Row & Non-Bookkeeping Penalty Included, Filter Out Past Schedules,
 * Direct Link to Google Calendar & Total($)/Total(₩)/Edit Full Visibility,
 * Readonly Transaction ID & Safe Delete Record Support,
 * Schedule Sub-text Notes & Real-time Live Status Engine ('종료' / '진행중'),
 * Dual Table Pagination (Finance & Schedule 50 items/page default)
 */

const COCKPIT_API_URL = 'https://script.google.com/macros/s/AKfycbxwPeAGqxjvBHPRF0S4zrXKOJ-luwhdJk7yFAMYqbDAhS4LR_7s11XWbXM62wERlQkn2A/exec';

let cockpitState = {
  finance: [],
  schedule: [],
  validationRules: {
    type: [],
    category: [],
    client: [],
    transaction: [],
    taxType: []
  },
  currentSubTab: 'finance',
  isLoaded: false,
  financeFilters: {},
  scheduleFilters: {},
  finPagination: { page: 1, pageSize: 50 },
  schPagination: { page: 1, pageSize: 50 },
  taxPeriod: '',
  editingTxId: null
};

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
    <!-- Top Summary Accordion Section -->
    <div class="summary-section" style="margin-bottom: 16px;">
      <div class="summary-header" onclick="toggleCockpitSummarySection()" style="cursor: pointer; user-select: none; margin-bottom: 0;">
        <h3 class="summary-title" style="display: flex; align-items: center; gap: 8px;">
          <span>💼 Executive Overview</span>
          <span id="cockpitSummaryToggleIcon" style="font-size: 0.8rem; color: var(--text-muted, #64748b); transition: transform 0.2s;">▼</span>
        </h3>
        <span class="last-modified-badge" id="cockpitLastSyncBadge">Status: Ready</span>
      </div>
      
      <!-- Collapsible Body (Default: Hidden) -->
      <div id="cockpitSummaryBody" style="display: none; margin-top: 14px;">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; background: var(--bg-slate, #f8fafc); border: 1px solid var(--border-gray, #e2e8f0); border-radius: 6px; padding: 12px 16px;">
          <div>
            <div style="font-size: 0.76rem; color: var(--text-muted, #64748b);">YTD Revenue (KRW)</div>
            <div id="kpi-krw-rev" style="font-size: 1.05rem; font-weight: 500; color: var(--text-main, #1e293b); margin-top: 2px;">-</div>
            <div id="kpi-krw-sub" style="font-size: 0.72rem; color: #94a3b8;">Supply - / Tax -</div>
          </div>
          <div>
            <div style="font-size: 0.76rem; color: var(--text-muted, #64748b);">Foreign Currency (USD)</div>
            <div id="kpi-usd-rev" style="font-size: 1.05rem; font-weight: 500; color: #16a34a; margin-top: 2px;">-</div>
            <div id="kpi-usd-sub" style="font-size: 0.72rem; color: #94a3b8;">Converted KRW -</div>
          </div>
          <div>
            <div style="font-size: 0.76rem; color: var(--text-muted, #64748b);">YTD Expense (KRW)</div>
            <div id="kpi-krw-exp" style="font-size: 1.05rem; font-weight: 500; color: #d97706; margin-top: 2px;">-</div>
            <div id="kpi-exp-sub" style="font-size: 0.72rem; color: #94a3b8;">Deductible Input Tax -</div>
          </div>
          <div>
            <div style="font-size: 0.76rem; color: var(--text-muted, #64748b);">Pending Schedules</div>
            <div id="kpi-pending-sch" style="font-size: 1.05rem; font-weight: 500; color: #2563eb; margin-top: 2px;">-</div>
            <div style="font-size: 0.72rem; color: #94a3b8;">Upcoming (Next 60 Days)</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Sub Tabs (3 Tabs) -->
    <div class="smelter-sub-tabs-wrapper">
      <div class="smelter-sub-tabs">
        <button type="button" class="smelter-sub-tab-btn active" id="btnCockpitTabFinance" onclick="switchCockpitSubTab('finance')">📋 Financial Records</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabSchedule" onclick="switchCockpitSubTab('schedule')">📅 Schedules & Tasks</button>
        <button type="button" class="smelter-sub-tab-btn" id="btnCockpitTabTax" onclick="switchCockpitSubTab('tax')">💰 Tax Filing</button>
      </div>
    </div>

    <!-- SUB-PANE 1: Finance Ledger (Pagination 탑재) -->
    <div id="cockpitSubPaneFinance" class="smelter-sub-pane active">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">📋 Income & Expense <span class="viewer-badge" id="finBadgeCount">0 entries</span></div>
          <div class="viewer-actions">
            <button type="button" class="btn-act btn-save-all" onclick="openFinanceModal()">+ New Transaction</button>
            <button type="button" class="btn-act" onclick="resetFinanceFilters()">🧹 Clear</button>
          </div>
        </div>
        <div class="table-wrapper" style="overflow-x: auto;">
          <table class="data-table" id="cockpitFinanceTable" style="table-layout: fixed; width: 100%; min-width: 1020px; font-size: 0.76rem;">
            <thead>
              <tr>
                <th style="width: 90px; min-width: 90px; white-space: nowrap; overflow: visible;">Date</th>
                <th style="width: 48px; min-width: 48px; text-align: center; white-space: nowrap; overflow: visible;">Type</th>
                <th style="width: 78px; min-width: 78px; white-space: nowrap; overflow: visible;">Category</th>
                <th style="width: 130px; min-width: 130px; white-space: nowrap; overflow: visible;">Client</th>
                <th style="width: 105px; min-width: 105px; white-space: nowrap; overflow: visible;">Transaction</th>
                <th style="min-width: 120px;">Description</th>
                <th style="width: 78px; min-width: 78px; text-align: center; white-space: nowrap; overflow: visible;">Tax_Type</th>
                <th style="width: 65px; min-width: 65px; text-align: right; white-space: nowrap; overflow: visible;">Total($)</th>
                <th style="width: 92px; min-width: 92px; text-align: right; white-space: nowrap; overflow: visible;">Total(₩)</th>
                <th style="width: 88px; min-width: 88px; text-align: right; white-space: nowrap; overflow: visible;">Supply</th>
                <th style="width: 78px; min-width: 78px; text-align: right; white-space: nowrap; overflow: visible;">Tax</th>
                <th style="width: 38px; min-width: 38px; text-align: center; white-space: nowrap; overflow: visible; padding: 0;">Edit</th>
              </tr>
              <tr id="finTableFilterRow">
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Date..." oninput="onFinFilterChange('date', this.value)" style="padding: 2px 4px; font-size: 0.73rem;"></th>
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
                <th class="filter-th"></th>
              </tr>
            </thead>
            <tbody id="cockpitFinanceTableBody"></tbody>
          </table>
        </div>

        <!-- Finance Pagination Bar -->
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

    <!-- SUB-PANE 2: Executive Schedule (Pagination 탑재) -->
    <div id="cockpitSubPaneSchedule" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">📅 Schedules &amp; Tasks <span class="viewer-badge" id="schBadgeCount">0 entries</span></div>
          <div class="viewer-actions" style="display: flex; gap: 8px; align-items: center;">
            <a href="https://calendar.google.com" target="_blank" rel="noopener noreferrer" class="btn-act" style="text-decoration: none; display: inline-flex; align-items: center; gap: 4px; color: var(--text-main);">📅 Open Calendar</a>
            <button type="button" class="btn-action-soft" id="btnSyncCal" onclick="syncCalendarFromWeb()">🔄 Google Sync</button>
            <button type="button" class="btn-act" onclick="resetScheduleFilters()">🧹 Clear</button>
          </div>
        </div>
        <div class="table-wrapper">
          <table class="data-table" id="cockpitScheduleTable" style="table-layout: fixed; width: 100%; font-size: 0.78rem;">
            <thead>
              <tr>
                <th style="width: 100px;">Date</th>
                <th style="width: 70px; text-align: center;">Type</th>
                <th>Title &amp; Notes</th>
                <th style="width: 115px;">Time</th>
                <th style="width: 70px; text-align: center;">Status</th>
              </tr>
              <tr id="schTableFilterRow">
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Date..." oninput="onSchFilterChange('date', this.value)"></th>
                <th class="filter-th" style="padding: 2px;"><select id="filterSchType" class="filter-input" onchange="onSchFilterChange('type', this.value)"><option value="">All</option></select></th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Title/Notes..." oninput="onSchFilterChange('title', this.value)"></th>
                <th class="filter-th"><input type="text" class="filter-input" placeholder="Time..." oninput="onSchFilterChange('time', this.value)"></th>
                <th class="filter-th" style="padding: 2px;"><select id="filterSchStatus" class="filter-input" onchange="onSchFilterChange('status', this.value)"><option value="">All</option></select></th>
              </tr>
            </thead>
            <tbody id="cockpitScheduleTableBody"></tbody>
          </table>
        </div>

        <!-- Schedule Pagination Bar -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; border-top: 1px solid var(--border-gray, #e2e8f0); font-size: 0.78rem; color: var(--text-muted, #64748b);">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span>Show</span>
            <select id="schPageSizeSelect" class="filter-input" onchange="changeSchPageSize(this.value)" style="padding: 2px 6px; font-size: 0.76rem; border: 1px solid #cbd5e1; border-radius: 4px;">
              <option value="25">25</option>
              <option value="50" selected>50</option>
              <option value="100">100</option>
            </select>
            <span>per page</span>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button type="button" class="btn-act" id="btnSchPrevPage" onclick="goToSchPage(cockpitState.schPagination.page - 1)" style="padding: 3px 8px; font-size: 0.75rem;">◀ Prev</button>
            <span id="schPageInfoDisplay" style="font-weight: 500; color: var(--text-main, #1e293b);">Page 1 of 1</span>
            <button type="button" class="btn-act" id="btnSchNextPage" onclick="goToSchPage(cockpitState.schPagination.page + 1)" style="padding: 3px 8px; font-size: 0.75rem;">Next ▶</button>
          </div>
        </div>
      </div>
    </div>

    <!-- SUB-PANE 3: Tax Filing Dashboard (세로 스크롤 완전 제거 및 풀 가시성 확보) -->
    <div id="cockpitSubPaneTax" class="smelter-sub-pane" style="display: none;">
      <div class="viewer-box">
        <div class="viewer-header">
          <div class="viewer-title">📊 Tax Filing &amp; Hometax Report</div>
          <div class="viewer-actions" style="display: flex; gap: 10px; align-items: center;">
            <span style="font-size: 0.76rem; color: #64748b; background: #f1f5f9; padding: 4px 8px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: nowrap;">
              🗓️ 부가세 신고: <strong>1월 &amp; 7월</strong> <span style="color: #cbd5e1; margin: 0 4px;">|</span> 종소세 신고: <strong>5월</strong>
            </span>
            <select id="taxFilingPeriodSelect" class="filter-input" style="padding: 4px 8px; min-width: 230px; font-weight: 500;" onchange="onTaxPeriodChange(this.value)"></select>
            <button type="button" class="btn-act" onclick="exportTaxFilingCsv()">📥 Export CSV</button>
          </div>
        </div>

        <div style="padding: 16px;">
          <!-- 1. VAT Section -->
          <div id="taxVatSectionBlock" style="display: none;">
            <h4 style="margin: 0 0 10px; font-size: 0.95rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; justify-content: space-between;">
              <span>VAT Declaration</span>
              <span id="taxVatNetBadge" style="font-size: 0.8rem; font-weight: 500; padding: 2px 8px; border-radius: 4px;">-</span>
            </h4>
            <!-- max-height 제거 및 overflow visible 지정으로 세로 스크롤 방지 -->
            <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; max-height: none !important; height: auto !important; overflow-y: visible !important;">
              <table class="data-table" style="table-layout: fixed; width: 100%;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="width: 230px;">구분 (Hometax Entry)</th>
                    <th>세부 내역 및 증빙</th>
                    <th style="width: 140px; text-align: right;">공급가액 (Supply Value)</th>
                    <th style="width: 120px; text-align: right;">세액 (Tax Amount)</th>
                  </tr>
                </thead>
                <tbody id="taxVatTableBody"></tbody>
              </table>
            </div>
          </div>

          <!-- 2. Income Tax Section & Strategy (세로 스크롤 완전 제거) -->
          <div id="taxIncomeSectionBlock" style="display: none;">
            <h4 style="margin: 0 0 10px; font-size: 0.95rem; font-weight: 600; color: var(--text-main); display: flex; align-items: center; justify-content: space-between;">
              <span>Income Tax Strategy Simulation</span>
              <span id="taxIncomeNetBadge" style="font-size: 0.8rem; font-weight: 500; padding: 2px 8px; border-radius: 4px;">-</span>
            </h4>
            
            <!-- max-height 제거 및 overflow visible 강제 적용 -->
            <div class="table-wrapper" style="border: 1px solid var(--border-gray); border-radius: 4px; margin-bottom: 16px; max-height: none !important; height: auto !important; overflow-y: visible !important; overflow-x: hidden;">
              <table class="data-table" id="taxStrategyTable" style="table-layout: fixed; width: 100%; font-size: 0.78rem;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="width: 155px; padding: 6px 8px;">구분 항목</th>
                    <th style="width: 120px; text-align: right; padding: 6px 8px;">간편장부(실제)</th>
                    <th style="width: 120px; text-align: right; padding: 6px 8px;">기준경비율(25%)</th>
                    <th style="width: 120px; text-align: right; padding: 6px 8px;">단순경비(2.8배)</th>
                    <th style="padding: 6px 10px;">비고 및 계산 근거</th>
                  </tr>
                </thead>
                <tbody id="taxStrategyTableBody"></tbody>
              </table>
            </div>

            <div style="background: #f8fafc; border: 1px solid var(--border-gray); border-left: 4px solid #16a34a; border-radius: 4px; padding: 12px 16px; font-size: 0.82rem; line-height: 1.6;">
              <div style="font-weight: 600; color: #15803d; margin-bottom: 4px;">💡 무엇이 유리한지 여기서 비교 &amp; 3대 절세 행동 요령</div>
              <div style="color: #334155;">
                1. <strong>사업 비용</strong>은 현재처럼 철저히 최소화 유지<br>
                2. <strong>노란우산공제</strong>(최대 500만원)와 <strong>개인연금저축</strong>(최대 600만원) 배분은 한도까지 최대 납입<br>
                3. 가계 생활비 등 기타 지출은 모두 <strong>와이프 명의 카드로 집중</strong>하여 대표님 장부 단순성 및 공제 최적화
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- New & Edit Transaction Modal -->
    <div id="cockpitFinanceModal" class="modal-overlay" style="display: none;">
      <div class="modal-card" style="max-width: 520px;">
        <h3 id="modalFinanceTitle" style="margin: 0 0 16px; font-size: 1.15rem; font-weight: 500; color: var(--text-main);">➕ New Transaction</h3>
        
        <div style="display: flex; flex-direction: column; gap: 12px; font-size: 0.85rem;">
          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Transaction ID</label>
            <input type="text" id="modalFinId" readonly placeholder="Auto-generated on Save (e.g. YYMM_XX)" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px; background: #f8fafc; color: #64748b; cursor: not-allowed; font-family: monospace; font-weight: 500;">
          </div>

          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Date</label>
              <input type="date" id="modalFinDate" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;">
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Type</label>
              <select id="modalFinType" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;"></select>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Category</label>
              <select id="modalFinCategory" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;"></select>
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Client</label>
              <select id="modalFinClient" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;"></select>
            </div>
          </div>

          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Transaction</label>
              <select id="modalFinTransaction" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;"></select>
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Tax_Type</label>
              <select id="modalFinTaxType" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;"></select>
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Description</label>
            <input type="text" id="modalFinDesc" placeholder="e.g. Monthly Retainer, Subscription fee" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;">
          </div>

          <div style="display: flex; gap: 10px;">
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Total($)</label>
              <input type="number" id="modalFinUsd" placeholder="0" oninput="calculateModalKrw()" onchange="calculateModalKrw()" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;">
            </div>
            <div style="flex: 1;">
              <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">EX_Rate</label>
              <input type="number" id="modalFinExRate" placeholder="1400" oninput="calculateModalKrw()" onchange="calculateModalKrw()" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;">
            </div>
          </div>

          <div>
            <label style="display: block; margin-bottom: 4px; color: var(--text-muted);">Total(₩)</label>
            <input type="number" id="modalFinTotalKrw" placeholder="0" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border-gray); border-radius: 4px;">
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 20px; border-top: 1px solid var(--border-gray); padding-top: 12px;">
          <div>
            <button type="button" class="btn-act" id="btnDeleteFin" onclick="deleteFinanceRecord()" style="display: none; color: #dc2626; border-color: #fecaca; background: #fef2f2;">🗑️ Delete Record</button>
          </div>
          <div style="display: flex; gap: 8px;">
            <button type="button" class="btn-act" onclick="closeFinanceModal()">Cancel</button>
            <button type="button" class="btn-act btn-save-all" id="btnSubmitFin" onclick="submitFinanceRecord()">Save Record</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

// 아코디언 토글 핸들러
function toggleCockpitSummarySection() {
  const body = document.getElementById('cockpitSummaryBody');
  const icon = document.getElementById('cockpitSummaryToggleIcon');
  if (!body) return;

  const isHidden = (body.style.display === 'none' || !body.style.display);
  body.style.display = isHidden ? 'block' : 'none';
  if (icon) icon.textContent = isHidden ? '▲' : '▼';
}

// 2. 데이터 조회
async function loadCockpitData() {
  const badge = document.getElementById('cockpitLastSyncBadge');
  if (badge) badge.innerText = 'Syncing...';

  try {
    const res = await fetch(`${COCKPIT_API_URL}?action=getCockpitData`);
    const json = await res.json();
    if (json.success && json.data) {
      cockpitState.finance = json.data.finance || [];
      cockpitState.schedule = json.data.schedule || [];
      cockpitState.validationRules = json.data.validationRules || {};
      cockpitState.isLoaded = true;

      updateCockpitKPIs();
      populateDynamicFilterOptions();
      populateModalDropdowns();
      populateTaxPeriodDropdown();
      renderFinanceTable();
      renderScheduleTable();
      renderTaxFilingView();

      if (badge) badge.innerText = `Synced: ${new Date().toLocaleTimeString('en-US', { hour12: false })}`;
    }
  } catch (err) {
    console.error('Failed to load cockpit data:', err);
    if (badge) badge.innerText = 'Sync Error';
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
  populateSelect('filterFinClient', getUniqueSorted(cockpitState.finance, 'client'));
  populateSelect('filterFinTransaction', getUniqueSorted(cockpitState.finance, 'transaction'));
  populateSelect('filterFinTaxType', getUniqueSorted(cockpitState.finance, 'taxType'));

  const todayStr = new Date().toISOString().slice(0, 10);
  const upcomingSchedules = cockpitState.schedule.filter(s => (s.date >= todayStr) && s.status !== '완료');
  populateSelect('filterSchType', getUniqueSorted(upcomingSchedules, 'type'));
  populateSelect('filterSchStatus', ['진행전', '진행중', '종료', '완료']);
}

// 4. 모달 드롭다운 바인딩
function populateModalDropdowns() {
  const rules = cockpitState.validationRules || {};
  
  const getList = (ruleList, key) => {
    if (ruleList && Array.isArray(ruleList) && ruleList.length > 0) return ruleList;
    const set = new Set();
    cockpitState.finance.forEach(r => {
      const v = String(r[key] || '').trim();
      if (v) set.add(v);
    });
    return Array.from(set);
  };

  const fill = (id, items) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.innerHTML = items.map(v => `<option value="${v}">${v}</option>`).join('');
  };

  fill('modalFinType', getList(rules.type, 'type'));
  fill('modalFinCategory', getList(rules.category, 'category'));
  fill('modalFinClient', getList(rules.client, 'client'));
  fill('modalFinTransaction', getList(rules.transaction, 'transaction'));
  fill('modalFinTaxType', getList(rules.taxType, 'taxType'));
}

// 5. 세무 기간 드롭다운 동적 연도 생성
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

// 6. KPI 연산
function updateCockpitKPIs() {
  let krwRev = 0, supRev = 0, taxRev = 0;
  let usdRev = 0, usdToKrw = 0;
  let krwExp = 0, taxExp = 0;

  cockpitState.finance.forEach(r => {
    const total = Math.round(Number(r.totalKRW) || 0);
    const supply = Math.round(Number(r.supply) || 0);
    const tax = Math.round(Number(r.tax) || 0);

    if (r.type === '매출') {
      krwRev += total;
      supRev += supply;
      taxRev += tax;
      if (r.totalUSD) {
        usdRev += Number(r.totalUSD);
        usdToKrw += total;
      }
    } else if (r.type === '매입') {
      krwExp += total;
      taxExp += tax;
    }
  });

  const todayStr = new Date().toISOString().slice(0, 10);
  const pendingCount = cockpitState.schedule.filter(s => (s.date >= todayStr) && s.status === '진행전').length;

  document.getElementById('kpi-krw-rev').innerText = `₩${krwRev.toLocaleString('ko-KR')}`;
  document.getElementById('kpi-krw-sub').innerText = `Supply ₩${supRev.toLocaleString('ko-KR')} / Tax ₩${taxRev.toLocaleString('ko-KR')}`;

  document.getElementById('kpi-usd-rev').innerText = `$${Math.round(usdRev).toLocaleString('en-US')}`;
  document.getElementById('kpi-usd-sub').innerText = `KRW Equiv. ₩${usdToKrw.toLocaleString('ko-KR')}`;

  document.getElementById('kpi-krw-exp').innerText = `₩${krwExp.toLocaleString('ko-KR')}`;
  document.getElementById('kpi-exp-sub').innerText = `Input Tax Deductible ₩${taxExp.toLocaleString('ko-KR')}`;

  document.getElementById('kpi-pending-sch').innerText = `${pendingCount}`;
}

// 7. 서브 탭 전환
function switchCockpitSubTab(tab) {
  cockpitState.currentSubTab = tab;
  ['Finance', 'Schedule', 'Tax'].forEach(t => {
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

  if (tab === 'tax') renderTaxFilingView();
}

// 8. Finance 테이블 렌더링 & 페이지네이션
function renderFinanceTable() {
  const tbody = document.getElementById('cockpitFinanceTableBody');
  const badge = document.getElementById('finBadgeCount');
  if (!tbody) return;

  const f = cockpitState.financeFilters;
  const filtered = cockpitState.finance.filter(row => {
    if (f.date && !String(row.date).includes(f.date)) return false;
    if (f.type && String(row.type) !== f.type) return false;
    if (f.category && String(row.category) !== f.category) return false;
    if (f.client && String(row.client) !== f.client) return false;
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

  // 페이지네이션 컨트롤러 UI 갱신
  const pageInfo = document.getElementById('finPageInfoDisplay');
  const btnPrev = document.getElementById('btnFinPrevPage');
  const btnNext = document.getElementById('btnFinNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center; padding: 24px; color: #94a3b8;">No records found.</td></tr>';
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
        <td style="text-align: center; overflow: visible; padding: 0;">
          <button type="button" class="btn-act" style="padding: 2px 4px; font-size: 0.75rem; border: none; background: transparent; cursor: pointer;" title="Edit Transaction" onclick="openFinanceModal('${r.id}')">✏️</button>
        </td>
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
    if (f.client && String(row.client) !== f.client) return false;
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

// 9. Schedule 테이블 렌더링 & 페이지네이션
function renderScheduleTable() {
  const tbody = document.getElementById('cockpitScheduleTableBody');
  const badge = document.getElementById('schBadgeCount');
  if (!tbody) return;

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const curHours = String(now.getHours()).padStart(2, '0');
  const curMinutes = String(now.getMinutes()).padStart(2, '0');
  const curTimeStr = `${curHours}:${curMinutes}`;

  const f = cockpitState.scheduleFilters;

  const computeLiveStatus = (row) => {
    if (row.status === '완료') return '완료';
    if (!row.date || row.date > todayStr) return row.status || '진행전';
    if (row.date < todayStr) return '종료';

    const timeStr = String(row.time || '').trim();
    if (timeStr === '종일' || !timeStr.includes(':')) {
      return row.status || '진행전';
    }

    if (timeStr.includes('-')) {
      const parts = timeStr.split('-').map(s => s.trim());
      const startTime = parts[0];
      const endTime = parts[1];

      if (endTime && curTimeStr > endTime) return '종료';
      if (startTime && endTime && curTimeStr >= startTime && curTimeStr <= endTime) return '진행중';
    } else {
      if (curTimeStr > timeStr) return '종료';
    }

    return row.status || '진행전';
  };

  const processed = cockpitState.schedule.map(row => ({
    ...row,
    displayStatus: computeLiveStatus(row)
  }));

  const filtered = processed.filter(row => {
    if (row.date && row.date < todayStr) return false;
    if (row.status === '완료') return false;

    if (f.date && !String(row.date).includes(f.date)) return false;
    if (f.type && String(row.type) !== f.type) return false;
    
    if (f.title) {
      const q = f.title.toLowerCase();
      const matchTitle = String(row.title || '').toLowerCase().includes(q);
      const matchDesc = String(row.description || '').toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }

    if (f.time && !String(row.time).includes(f.time)) return false;
    if (f.status && String(row.displayStatus) !== f.status) return false;
    return true;
  });

  const totalItems = filtered.length;
  const p = cockpitState.schPagination;
  const totalPages = Math.max(1, Math.ceil(totalItems / p.pageSize));
  if (p.page > totalPages) p.page = totalPages;

  const startIdx = (p.page - 1) * p.pageSize;
  const pagedRows = filtered.slice(startIdx, startIdx + p.pageSize);

  if (badge) badge.innerText = `${totalItems} entries`;

  // 일정 페이지네이션 컨트롤러 UI 갱신
  const pageInfo = document.getElementById('schPageInfoDisplay');
  const btnPrev = document.getElementById('btnSchPrevPage');
  const btnNext = document.getElementById('btnSchNextPage');
  if (pageInfo) pageInfo.innerText = `Page ${p.page} of ${totalPages}`;
  if (btnPrev) btnPrev.disabled = (p.page <= 1);
  if (btnNext) btnNext.disabled = (p.page >= totalPages);

  if (pagedRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 24px; color: #94a3b8;">No upcoming schedules found.</td></tr>';
    return;
  }

  tbody.innerHTML = pagedRows.map(r => {
    const descText = (r.description || '').trim();
    const descHtml = descText ? `
      <div style="font-size: 0.74rem; color: #64748b; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 580px;" title="${descText.replace(/"/g, '&quot;')}">
        ${descText}
      </div>
    ` : '';

    let statusStyle = 'background: #e0e7ff; color: #4338ca;';
    if (r.displayStatus === '종료') {
      statusStyle = 'background: #f1f5f9; color: #94a3b8; border: 1px solid #e2e8f0;';
    } else if (r.displayStatus === '진행중') {
      statusStyle = 'background: #ecfdf5; color: #16a34a; font-weight: 500;';
    } else if (r.displayStatus === '완료') {
      statusStyle = 'background: #f8fafc; color: #cbd5e1;';
    }

    return `
      <tr>
        <td style="white-space: nowrap;">${r.date || '-'}</td>
        <td style="text-align: center;"><span style="background: #f1f5f9; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; font-weight: 400;">${r.type}</span></td>
        <td>
          <div style="color: ${r.displayStatus === '종료' ? '#64748b' : 'var(--text-main)'}; font-weight: 500;">${r.title || '(제목 없음)'}</div>
          ${descHtml}
        </td>
        <td style="color: #64748b; white-space: nowrap;">${r.time || '-'}</td>
        <td style="text-align: center;"><span style="${statusStyle} padding: 2px 7px; border-radius: 4px; font-size: 0.75rem;">${r.displayStatus}</span></td>
      </tr>
    `;
  }).join('');
}

function goToSchPage(page) {
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const f = cockpitState.scheduleFilters;

  const filteredCount = cockpitState.schedule.filter(row => {
    if (row.date && row.date < todayStr) return false;
    if (row.status === '완료') return false;
    if (f.date && !String(row.date).includes(f.date)) return false;
    if (f.type && String(row.type) !== f.type) return false;
    if (f.title) {
      const q = f.title.toLowerCase();
      const matchTitle = String(row.title || '').toLowerCase().includes(q);
      const matchDesc = String(row.description || '').toLowerCase().includes(q);
      if (!matchTitle && !matchDesc) return false;
    }
    if (f.time && !String(row.time).includes(f.time)) return false;
    return true;
  }).length;

  const totalPages = Math.max(1, Math.ceil(filteredCount / cockpitState.schPagination.pageSize));
  if (page < 1 || page > totalPages) return;
  cockpitState.schPagination.page = page;
  renderScheduleTable();
}

function changeSchPageSize(newSize) {
  cockpitState.schPagination.pageSize = parseInt(newSize, 10) || 50;
  cockpitState.schPagination.page = 1;
  renderScheduleTable();
}

// 10. TAX FILING 연산 및 상호 배타적 뷰 렌더링
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

  let actualRevenue = 0;
  let actualExpense = 0;

  periodRows.forEach(r => {
    const supply = Math.round(Number(r.supply) || 0);
    const tax = Math.round(Number(r.tax) || 0);
    const isInc = r.type === '매출';
    const isExp = r.type === '매입';

    if (isInc) {
      actualRevenue += supply;
      if (r.taxType === '과세') {
        vatTaxableSalesSupply += supply;
        vatTaxableSalesTax += tax;
      } else if (r.taxType === '영세') {
        vatZeroSalesSupply += supply;
      } else {
        vatExemptSalesSupply += supply;
      }
    } else if (isExp) {
      actualExpense += supply;

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

  // (1) 부가세 테이블 렌더링
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

  // (2) 종합소득세 및 절세전략비교 렌더링
  if (range.isIncome) {
    const revenue = actualRevenue;
    const expense = actualExpense;

    // 1) 인정 경비 (B)
    const expSimp = expense;
    const expBase = Math.round(revenue * 0.25);
    const expStdLimit = Math.round(revenue * 0.80);

    // 2) 3대 경비 (C)
    const threeExp = 0;

    // 3) 종합소득금액 (A - B - C)
    const incSimp = Math.max(0, revenue - expSimp - threeExp);
    const incBase = Math.max(0, revenue - expBase - threeExp);
    const incStdLimit = Math.round(Math.max(0, (revenue - expStdLimit - threeExp) * 2.8));

    // 4) 소득공제 (D)
    const dedPersonal = 1500000;
    const dedYellow = 5000000;
    const dedTotal = dedPersonal + dedYellow;

    // 5) 과세표준 (A - B - C - D)
    const taxBaseSimp = Math.max(0, incSimp - dedTotal);
    const taxBaseBase = Math.max(0, incBase - dedTotal);
    const taxBaseStdLimit = Math.max(0, incStdLimit - dedTotal);

    // 6) 산출세액 함수 (E)
    const calcTax = (base) => {
      if (base <= 0) return 0;
      if (base <= 14000000) return Math.round(base * 0.06);
      if (base <= 50000000) return Math.round(base * 0.15 - 1260000);
      return Math.round(base * 0.24 - 5760000);
    };

    const calcTaxSimp = calcTax(taxBaseSimp);
    const calcTaxBase = calcTax(taxBaseBase);
    const calcTaxStdLimit = calcTax(taxBaseStdLimit);

    // 7) 창업중소기업 세액감면 (G): 산출세액(E)의 50% 즉시 감면
    const redSimp = Math.round(calcTaxSimp * 0.5);
    const redBase = Math.round(calcTaxBase * 0.5);
    const redStdLimit = Math.round(calcTaxStdLimit * 0.5);

    // 8) 개인연금저축 납입액 및 세액공제 (F)
    const pensionBase = 6000000;
    const taxCreditPension = 900000;

    // 9) 종합소득세 (G - F): 감면 후 산출세액 - 세액공제
    const itSimp = (calcTaxSimp - redSimp) - taxCreditPension;
    const itBase = (calcTaxBase - redBase) - taxCreditPension;
    const itStdLimit = (calcTaxStdLimit - redStdLimit) - taxCreditPension;

    // 10) 무기장 가산세 (매출 4,800만 미만은 면제: 0원)
    const penaltySimp = (revenue >= 48000000) ? Math.round(calcTaxSimp * 0.2) : 0;
    const penaltyBase = (revenue >= 48000000) ? Math.round(calcTaxBase * 0.2) : 0;
    const penaltyStdLimit = (revenue >= 48000000) ? Math.round(calcTaxStdLimit * 0.2) : 0;

    // 11) 지방소득세 (H): 종합소득세의 10%
    const localTaxSimp = Math.round(itSimp * 0.1);
    const localTaxBase = Math.round(itBase * 0.1);
    const localTaxStdLimit = Math.round(itStdLimit * 0.1);

    // 12) 최종 총 부담 세액 (G + H)
    const finalTaxSimp = itSimp + penaltySimp + localTaxSimp;
    const finalTaxBase = itBase + penaltyBase + localTaxBase;
    const finalTaxStdLimit = itStdLimit + penaltyStdLimit + localTaxStdLimit;

    const diffBase = finalTaxBase - finalTaxSimp;
    const diffStdLimit = finalTaxStdLimit - finalTaxSimp;

    const strTbody = document.getElementById('taxStrategyTableBody');
    if (strTbody) {
      strTbody.innerHTML = `
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">총 매출액 (A)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${revenue.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${revenue.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${revenue.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px;">외화(USD) 매출 동일 반영</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">인정 경비 (B)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${expSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${expBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${expStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; font-size: 0.74rem; line-height: 1.4; padding: 5px 10px; word-break: keep-all;">
            <strong>간편장부:</strong> 실제 지출액<br>
            <strong>기준경비:</strong> 정부인정경비(전문서비스업 25%)<br>
            <strong>단순경비:</strong> 80% 적용 후 최대 2.8배율 상한 적용
          </td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">3대 경비 (C)</td>
          <td style="text-align: right; padding: 5px 8px;">₩0</td>
          <td style="text-align: right; padding: 5px 8px;">₩0</td>
          <td style="text-align: right; padding: 5px 8px;">₩0</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">인건비/임대료/강의료 등 증빙 필요 비용</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 500;">
          <td style="padding: 5px 8px;">종합소득금액 (A-B-C)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${incSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${incBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #2563eb; padding: 5px 8px;">₩${incStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #475569; padding: 5px 10px; font-size: 0.74rem;">경비율 적용 시 소득 차이 발생 (단순경비는 2.8배수)</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 16px; color: #64748b;">인적공제</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedPersonal.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedPersonal.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedPersonal.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 4px 10px; font-size: 0.74rem;">본인 기본공제 (150만 원)</td>
        </tr>
        <tr>
          <td style="padding: 4px 8px 4px 16px; color: #64748b;">노란우산공제</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedYellow.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedYellow.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 4px 8px;">₩${dedYellow.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 4px 10px; font-size: 0.74rem;">소기업·소상공인 공제부금 최대 불입</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 500;">
          <td style="padding: 5px 8px;">소득공제 (D)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${dedTotal.toLocaleString('ko-KR')}</td>
          <td style="color: #475569; padding: 5px 10px; font-size: 0.74rem;">본인 공제(150만) + 노란우산(500만)</td>
        </tr>
        <tr style="background: #f1f5f9; font-weight: 600;">
          <td style="padding: 5px 8px;">과세표준 (A-B-C-D)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${taxBaseSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${taxBaseBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${taxBaseStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #1e293b; padding: 5px 10px; font-size: 0.74rem;">세금을 매기는 기준 금액</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">세율 및 산출세액 (E)</td>
          <td style="text-align: right; padding: 5px 8px;">₩${calcTaxSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${calcTaxBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${calcTaxStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">1400만 이하 6%, 5000만 이하 15% 구간</td>
        </tr>
        <tr>
          <td style="font-weight: 500; color: #15803d; padding: 5px 8px;">창업중소기업 감면 (G)</td>
          <td style="text-align: right; color: #15803d; padding: 5px 8px;">₩${redSimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #15803d; padding: 5px 8px;">₩${redBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #15803d; padding: 5px 8px;">₩${redStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #15803d; font-size: 0.74rem; line-height: 1.3; padding: 5px 10px; word-break: keep-all;">
            <strong>신청서 필수 제출</strong> (용인시 일반창업 종합소득세 50% 감면, 5년간 산출세액 기준)
          </td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">개인연금저축</td>
          <td style="text-align: right; padding: 5px 8px;">₩${pensionBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${pensionBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${pensionBase.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">개인연금저축 연간 최대 불입액</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">세액공제 (F)</td>
          <td style="text-align: right; color: #16a34a; padding: 5px 8px;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #16a34a; padding: 5px 8px;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; color: #16a34a; padding: 5px 8px;">₩${taxCreditPension.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">개인연금저축 (600만 × 15% 공제율)</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">종합소득세 (G - F)</td>
          <td style="text-align: right; padding: 5px 8px;">${itSimp < 0 ? `-₩${Math.abs(itSimp).toLocaleString('ko-KR')}` : `₩${itSimp.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; padding: 5px 8px;">${itBase < 0 ? `-₩${Math.abs(itBase).toLocaleString('ko-KR')}` : `₩${itBase.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; color: ${itStdLimit < 0 ? '#dc2626' : '#1e293b'}; padding: 5px 8px;">${itStdLimit < 0 ? `-₩${Math.abs(itStdLimit).toLocaleString('ko-KR')}` : `₩${itStdLimit.toLocaleString('ko-KR')}`}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">산출세액(감면반영) - 세액공제</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">무기장 가산세</td>
          <td style="text-align: right; padding: 5px 8px;">₩${penaltySimp.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${penaltyBase.toLocaleString('ko-KR')}</td>
          <td style="text-align: right; padding: 5px 8px;">₩${penaltyStdLimit.toLocaleString('ko-KR')}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">매출 4,800만 원 미만 면제</td>
        </tr>
        <tr>
          <td style="font-weight: 500; padding: 5px 8px;">지방소득세 (H)</td>
          <td style="text-align: right; padding: 5px 8px;">${localTaxSimp < 0 ? `-₩${Math.abs(localTaxSimp).toLocaleString('ko-KR')}` : `₩${localTaxSimp.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; padding: 5px 8px;">${localTaxBase < 0 ? `-₩${Math.abs(localTaxBase).toLocaleString('ko-KR')}` : `₩${localTaxBase.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; color: ${localTaxStdLimit < 0 ? '#dc2626' : '#1e293b'}; padding: 5px 8px;">${localTaxStdLimit < 0 ? `-₩${Math.abs(localTaxStdLimit).toLocaleString('ko-KR')}` : `₩${localTaxStdLimit.toLocaleString('ko-KR')}`}</td>
          <td style="color: #64748b; padding: 5px 10px; font-size: 0.74rem;">종합소득세의 10% 별도 부과</td>
        </tr>
        <tr style="background: #ffffff; border-top: 2px solid var(--border-gray); font-size: 0.88rem; font-weight: 700;">
          <td style="color: var(--text-main); padding: 6px 8px;">최종 총 부담 세액</td>
          <td style="text-align: right; color: #1e293b; padding: 6px 8px;">${finalTaxSimp < 0 ? `-₩${Math.abs(finalTaxSimp).toLocaleString('ko-KR')}` : `₩${finalTaxSimp.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; color: #1e293b; padding: 6px 8px;">${finalTaxBase < 0 ? `-₩${Math.abs(finalTaxBase).toLocaleString('ko-KR')}` : `₩${finalTaxBase.toLocaleString('ko-KR')}`}</td>
          <td style="text-align: right; color: #1e293b; padding: 6px 8px;">${finalTaxStdLimit < 0 ? `-₩${Math.abs(finalTaxStdLimit).toLocaleString('ko-KR')}` : `₩${finalTaxStdLimit.toLocaleString('ko-KR')}`}</td>
          <td style="color: #2563eb; padding: 6px 10px; font-size: 0.74rem;">납부 예상 합계액 (G + H)</td>
        </tr>
        <tr style="background: #f8fafc; font-weight: 600;">
          <td style="color: #d97706; padding: 5px 8px;">간편장부 대비 절감</td>
          <td style="text-align: right; color: #64748b; padding: 5px 8px;">- (기준)</td>
          <td style="text-align: right; color: ${diffBase <= 0 ? '#16a34a' : '#dc2626'}; padding: 5px 8px;">
            ${diffBase <= 0 ? `-₩${Math.abs(diffBase).toLocaleString('ko-KR')}` : `+₩${diffBase.toLocaleString('ko-KR')}`}
          </td>
          <td style="text-align: right; color: ${diffStdLimit <= 0 ? '#16a34a' : '#dc2626'}; padding: 5px 8px;">
            ${diffStdLimit <= 0 ? `-₩${Math.abs(diffStdLimit).toLocaleString('ko-KR')}` : `+₩${diffStdLimit.toLocaleString('ko-KR')}`}
          </td>
          <td style="color: #16a34a; padding: 5px 10px; font-size: 0.74rem;">단순/기준경비 선택 시 절세 효과 비교</td>
        </tr>
      `;
    }
  }
}

// 11. 세무 데이터 CSV 내보내기
function exportTaxFilingCsv() {
  const range = getPeriodDateRange(cockpitState.taxPeriod);
  const rows = cockpitState.finance.filter(r => r.date && r.date >= range.start && r.date <= range.end);
  if (rows.length === 0) {
    alert('해당 기간에 내보낼 데이터가 없습니다.');
    return;
  }

  const headers = ['Date', 'Type', 'Category', 'Client', 'Transaction', 'Description', 'Tax_Type', 'Total($)', 'Total(₩)', 'Supply', 'Tax'];
  const csvContent = [
    headers.join(','),
    ...rows.map(r => [
      `"${r.date || ''}"`,
      `"${r.type || ''}"`,
      `"${r.category || ''}"`,
      `"${r.client || ''}"`,
      `"${r.transaction || ''}"`,
      `"${(r.description || '').replace(/"/g, '""')}"`,
      `"${r.taxType || ''}"`,
      r.totalUSD || '',
      Math.round(Number(r.totalKRW) || 0),
      Math.round(Number(r.supply) || 0),
      Math.round(Number(r.tax) || 0)
    ].join(','))
  ].join('\r\n');

  const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', `a2MDS_TaxFiling_${cockpitState.taxPeriod}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// 12. 필터 핸들러 (페이지 1로 자동 리셋)
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

function onSchFilterChange(col, val) {
  cockpitState.scheduleFilters[col] = val.trim();
  cockpitState.schPagination.page = 1;
  renderScheduleTable();
}

function resetScheduleFilters() {
  cockpitState.scheduleFilters = {};
  cockpitState.schPagination.page = 1;
  document.querySelectorAll('#schTableFilterRow input').forEach(input => input.value = '');
  document.querySelectorAll('#schTableFilterRow select').forEach(select => select.value = '');
  renderScheduleTable();
}

// 13. 캘린더 동기화 트리거
async function syncCalendarFromWeb() {
  const btn = document.getElementById('btnSyncCal');
  btn.innerText = 'Syncing...';
  btn.disabled = true;

  try {
    const res = await fetch(COCKPIT_API_URL, {
      method: 'POST',
      body: JSON.stringify({ action: 'syncSchedule' })
    });
    const json = await res.json();
    if (json.success) {
      alert(`Google Calendar & Tasks synchronized.\n(Inserted: ${json.data.insertedCount}, Updated: ${json.data.updatedCount})`);
      loadCockpitData();
    } else {
      alert('Sync failed: ' + json.error);
    }
  } catch (err) {
    alert('Communication error: ' + err.message);
  } finally {
    btn.innerText = '🔄 Google Sync';
    btn.disabled = false;
  }
}

// 14. 신규 등록 & 기존 편집 통합 모달 제어
function openFinanceModal(txId = null) {
  const modal = document.getElementById('cockpitFinanceModal');
  const titleEl = document.getElementById('modalFinanceTitle');
  const submitBtn = document.getElementById('btnSubmitFin');
  const deleteBtn = document.getElementById('btnDeleteFin');
  const idInput = document.getElementById('modalFinId');
  if (!modal) return;

  cockpitState.editingTxId = txId;

  if (txId) {
    const record = cockpitState.finance.find(r => String(r.id) === String(txId));
    if (!record) {
      alert('해당 거래 데이터를 찾을 수 없습니다.');
      return;
    }
    if (titleEl) titleEl.innerText = `✏️ Edit Transaction (ID: ${record.id})`;
    if (submitBtn) submitBtn.innerText = 'Update Record';
    if (deleteBtn) {
      deleteBtn.style.display = 'inline-block';
      deleteBtn.disabled = false;
      deleteBtn.innerText = '🗑️ Delete Record';
    }

    if (idInput) idInput.value = record.id || '';
    document.getElementById('modalFinDate').value = record.date || '';
    document.getElementById('modalFinType').value = record.type || '';
    document.getElementById('modalFinCategory').value = record.category || '';
    document.getElementById('modalFinClient').value = record.client || '';
    document.getElementById('modalFinTransaction').value = record.transaction || '';
    document.getElementById('modalFinTaxType').value = record.taxType || '';
    document.getElementById('modalFinDesc').value = record.description || '';
    document.getElementById('modalFinUsd').value = record.totalUSD || '';
    document.getElementById('modalFinExRate').value = record.exRate || '';
    document.getElementById('modalFinTotalKrw').value = Math.round(Number(record.totalKRW) || 0);
  } else {
    if (titleEl) titleEl.innerText = '➕ New Transaction';
    if (submitBtn) submitBtn.innerText = 'Save Record';
    if (deleteBtn) deleteBtn.style.display = 'none';

    if (idInput) idInput.value = '';
    document.getElementById('modalFinDate').value = new Date().toISOString().slice(0, 10);
    document.getElementById('modalFinDesc').value = '';
    document.getElementById('modalFinUsd').value = '';
    document.getElementById('modalFinExRate').value = '';
    document.getElementById('modalFinTotalKrw').value = '';
  }

  modal.style.display = 'flex';
}

function closeFinanceModal() {
  const modal = document.getElementById('cockpitFinanceModal');
  if (modal) modal.style.display = 'none';
  cockpitState.editingTxId = null;
}

function calculateModalKrw() {
  const usdInput = document.getElementById('modalFinUsd');
  const exInput = document.getElementById('modalFinExRate');
  const krwInput = document.getElementById('modalFinTotalKrw');

  const usd = parseFloat(usdInput.value) || 0;
  const ex = parseFloat(exInput.value) || 0;

  if (usd > 0 && ex > 0) {
    krwInput.value = Math.round(usd * ex);
  }
}

// 15. 저장 및 실시간 자동 동기화
async function submitFinanceRecord() {
  const date = document.getElementById('modalFinDate').value;
  const type = document.getElementById('modalFinType').value;
  const category = document.getElementById('modalFinCategory').value;
  const client = document.getElementById('modalFinClient').value;
  const transaction = document.getElementById('modalFinTransaction').value;
  const taxType = document.getElementById('modalFinTaxType').value;
  const desc = document.getElementById('modalFinDesc').value.trim();
  const usd = document.getElementById('modalFinUsd').value;
  const exRate = document.getElementById('modalFinExRate').value;
  const totalKRW = document.getElementById('modalFinTotalKrw').value;

  if (!date || !totalKRW || Number(totalKRW) <= 0) {
    alert('Please enter valid Date and Total(₩).');
    return;
  }

  const isEdit = Boolean(cockpitState.editingTxId);
  const btn = document.getElementById('btnSubmitFin');
  btn.innerText = isEdit ? 'Updating...' : 'Saving...';
  btn.disabled = true;

  try {
    const payload = {
      id: cockpitState.editingTxId || '',
      date,
      type,
      category,
      client,
      method: transaction,
      description: desc,
      taxType,
      usd,
      exRate,
      totalKRW
    };

    const action = isEdit ? 'updateFinanceTx' : 'addFinanceTx';

    const res = await fetch(COCKPIT_API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, payload })
    });
    const json = await res.json();

    if (json.success) {
      alert(isEdit ? 'Transaction successfully updated.' : 'Transaction successfully created.');
      closeFinanceModal();
      loadCockpitData();
    } else {
      alert((isEdit ? 'Update failed: ' : 'Save failed: ') + json.error);
    }
  } catch (err) {
    alert('Communication error: ' + err.message);
  } finally {
    btn.innerText = isEdit ? 'Update Record' : 'Save Record';
    btn.disabled = false;
  }
}

// 16. 구글 시트 행 삭제 엔진 연동
async function deleteFinanceRecord() {
  const targetId = cockpitState.editingTxId;
  if (!targetId) return;

  const confirmed = confirm(`[경고] 거래 ID (${targetId}) 내역을 구글 시트에서 영구 삭제하시겠습니까?\n삭제 후에는 복구할 수 없습니다.`);
  if (!confirmed) return;

  const deleteBtn = document.getElementById('btnDeleteFin');
  const submitBtn = document.getElementById('btnSubmitFin');
  if (deleteBtn) {
    deleteBtn.innerText = 'Deleting...';
    deleteBtn.disabled = true;
  }
  if (submitBtn) submitBtn.disabled = true;

  try {
    const res = await fetch(COCKPIT_API_URL, {
      method: 'POST',
      body: JSON.stringify({
        action: 'deleteFinanceTx',
        payload: { id: targetId }
      })
    });
    const json = await res.json();

    if (json.success) {
      alert(`거래 내역 (ID: ${targetId})이 정상적으로 삭제되었습니다.`);
      closeFinanceModal();
      loadCockpitData();
    } else {
      alert('Delete failed: ' + json.error);
    }
  } catch (err) {
    alert('Communication error: ' + err.message);
  } finally {
    if (deleteBtn) {
      deleteBtn.innerText = '🗑️ Delete Record';
      deleteBtn.disabled = false;
    }
    if (submitBtn) submitBtn.disabled = false;
  }
}
