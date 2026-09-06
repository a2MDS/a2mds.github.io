/* =========================================================================
   a2MDS WORKSPACE - AI-POWERED REGULATORY INSIGHT & FAQ MODULE (js/insight.js)
   (Substance-Grade Stale-While-Revalidate & Ultra-Fast Single Roundtrip)
   ========================================================================= */

var HARDCODED_GAS_URL = "https://script.google.com/macros/s/AKfycbyYAQsRC4m53cgq_GjIzufZttI3paVHRE0x00JakuH75-YRkbNVdWV3qd1S6VZ0LnSqaQ/exec"; 
var INSIGHT_DB_NAME = 'a2MDS_InsightLog_DB';

var currentQaQuestion = "";
var currentQaCategory = "all";

// FAQ 상태 관리
var currentFaqMasterList = [];
var currentFilteredFaqList = [];
var faqCurrentPage = 1;
var faqPageSize = 20;
var expandedFaqGlobalIndex = null;

/* =========================================================================
   1. INDEXED DB 캐시 로직 (Substance 동일 구조)
   ========================================================================= */
function openInsightDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(INSIGHT_DB_NAME, 5);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (db.objectStoreNames.contains('insight_cache')) {
          db.deleteObjectStore('insight_cache');
        }
        db.createObjectStore('insight_cache', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => res(null);
    } catch (e) {
      res(null);
    }
  });
}

async function saveInsightCacheToDB(categories, faqs) {
  try {
    const db = await openInsightDB();
    if (!db) return;
    const tx = db.transaction('insight_cache', 'readwrite');
    const store = tx.objectStore('insight_cache');
    store.put({ id: 'cached_data', categories, faqs, cachedAt: new Date().toISOString() });
  } catch (e) {}
}

async function loadInsightCacheFromDB() {
  try {
    const db = await openInsightDB();
    if (!db) return null;
    return new Promise(res => {
      const req = db.transaction('insight_cache', 'readonly').objectStore('insight_cache').get('cached_data');
      req.onsuccess = () => res(req.result || null);
      req.onerror = () => res(null);
    });
  } catch (e) {
    return null;
  }
}

async function clearInsightIndexedDB() {
  try {
    const db = await openInsightDB();
    if (db) db.transaction('insight_cache', 'readwrite').objectStore('insight_cache').clear();
  } catch (e) {}
}

/* =========================================================================
   2. 초고속 초기화 (0.01초 로컬 렌더링 후 백그라운드 단일 동기화)
   ========================================================================= */
async function initInsightModule() {
  // Step 1: IndexedDB 캐시에서 즉시 복원하여 0초 만에 화면 출력
  const cached = await loadInsightCacheFromDB();
  if (cached) {
    if (Array.isArray(cached.categories) && cached.categories.length > 0) {
      renderCategorySelect(cached.categories);
    }
    if (Array.isArray(cached.faqs) && cached.faqs.length > 0) {
      currentFaqMasterList = cached.faqs;
      currentFilteredFaqList = [...currentFaqMasterList];
      faqCurrentPage = 1;
      expandedFaqGlobalIndex = null;
      renderFaqPage();
    }
  }

  // Step 2: 백그라운드에서 단 1회의 통합 호출(init_insight)로 최신 데이터 동기화
  syncInsightDataFromBackend();
}

document.addEventListener('DOMContentLoaded', () => {
  initInsightModule();
});

function getValidGasEndpoint() {
  if (HARDCODED_GAS_URL && !HARDCODED_GAS_URL.includes("EXAMPLE")) return HARDCODED_GAS_URL;
  if (typeof GAS_API_URL !== 'undefined' && GAS_API_URL) return GAS_API_URL;
  if (typeof GAS_BASE_URL !== 'undefined' && GAS_BASE_URL) return GAS_BASE_URL;
  if (typeof GAS_ENDPOINT !== 'undefined' && GAS_ENDPOINT) return GAS_ENDPOINT;
  if (window.GAS_API_URL) return window.GAS_API_URL;
  if (window.GAS_BASE_URL) return window.GAS_BASE_URL;
  if (window.GAS_ENDPOINT) return window.GAS_ENDPOINT;
  return localStorage.getItem('a2mds_gas_endpoint') || '';
}

function switchInsightSubTab(tab, btnElem) {
  document.querySelectorAll('#viewInsight .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('#viewInsight .smelter-sub-pane').forEach(p => p.classList.remove('active'));

  if (btnElem) {
    btnElem.classList.add('active');
  } else {
    const targetId = tab === 'faq' ? 'btnInsightTabFaq' : 'btnInsightTabResearch';
    document.getElementById(targetId)?.classList.add('active');
  }

  const paneId = tab === 'faq' ? 'insightSubPaneFaq' : 'insightSubPaneResearch';
  document.getElementById(paneId)?.classList.add('active');

  if (tab === 'research') {
    setTimeout(() => document.getElementById('qaQuestionInput')?.focus(), 50);
  }
}

function renderCategorySelect(categories) {
  const select = document.getElementById('qaCategorySelect');
  if (!select || !Array.isArray(categories)) return;
  const currentVal = select.value;
  select.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (currentVal && categories.some(c => c.id === currentVal)) {
    select.value = currentVal;
  }
}

// 단 1회의 서버 통신으로 카테고리와 FAQ를 동시 수신 (속도 극대화)
async function syncInsightDataFromBackend() {
  const endpoint = getValidGasEndpoint();
  if (!endpoint) return;

  try {
    const token = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'init_insight', auth: token })
    });

    const rawText = await resp.text();
    if (!rawText) return;
    const data = safeJsonParse(rawText);

    if (data?.status === 'success') {
      let categories = data.categories || [];
      let faqs = data.faqs || [];

      if (categories.length > 0) {
        renderCategorySelect(categories);
      }

      if (faqs.length > 0) {
        currentFaqMasterList = faqs;
        currentFilteredFaqList = [...currentFaqMasterList];
        renderFaqPage();
      }

      saveInsightCacheToDB(categories, faqs);
    }
  } catch (err) {
    console.warn("Background insight sync skipped:", err);
  }
}

/* =========================================================================
   3. FAQ 렌더링 & 단일 아코디언 인라인 뷰
   ========================================================================= */
function renderFaqPage() {
  const tbody = document.getElementById('faqTableBody');
  const countBadge = document.getElementById('faqBadgeCount');
  if (!tbody) return;

  const total = currentFilteredFaqList.length;
  if (countBadge) countBadge.textContent = `${total} Q&As`;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; padding: 24px; color: #94a3b8;">No matching FAQ items found.</td></tr>`;
    updateFaqPaginationUI(0);
    return;
  }

  const totalPages = Math.ceil(total / faqPageSize) || 1;
  if (faqCurrentPage > totalPages) faqCurrentPage = totalPages;
  if (faqCurrentPage < 1) faqCurrentPage = 1;

  const startIdx = (faqCurrentPage - 1) * faqPageSize;
  const pageSlice = currentFilteredFaqList.slice(startIdx, startIdx + faqPageSize);

  let html = '';
  pageSlice.forEach((item, idx) => {
    const globalIdx = startIdx + idx;
    const isExpanded = (expandedFaqGlobalIndex === globalIdx);
    const dateFormatted = formatShortDate(item.timestamp);

    html += `
      <tr class="faq-row ${isExpanded ? 'expanded' : ''}" id="faqRow_${globalIdx}" onclick="toggleFaqAccordion(${globalIdx})">
        <td style="padding: 12px 14px; font-weight: 700; color: #0f172a; line-height: 1.5; white-space: normal !important; word-break: keep-all;" title="${safeInsightAttr(item.question)}">
          ${safeInsightText(item.question)}
        </td>
        <td style="padding: 12px 8px; text-align: center; font-size: 0.78rem; color: #64748b; font-family: var(--font-mono, monospace); white-space: nowrap;">
          ${dateFormatted}
        </td>
        <td style="padding: 12px 8px; text-align: center; white-space: nowrap;">
          <button type="button" class="btn-faq-view ${isExpanded ? 'active' : ''}" id="btnFaqToggle_${globalIdx}" onclick="event.stopPropagation(); toggleFaqAccordion(${globalIdx})">
            ${isExpanded ? 'Close ▴' : 'View ▾'}
          </button>
        </td>
      </tr>
    `;

    if (isExpanded) {
      html += `
        <tr class="faq-accordion-row" id="faqAccordionRow_${globalIdx}">
          <td colspan="3" style="padding: 0 !important;">
            <div class="faq-accordion-panel" id="faqAccordionPanel_${globalIdx}" style="white-space: normal !important; word-break: keep-all;">
              ${generateFaqAccordionContent(item, globalIdx)}
            </div>
          </td>
        </tr>
      `;
    }
  });

  tbody.innerHTML = html;
  updateFaqPaginationUI(totalPages);
}

function generateFaqAccordionContent(item, globalIdx) {
  const timeFormatted = formatDisplayTimestamp(item.timestamp);
  const summaryHtml = formatFaqSummaryHtml(item.summary);
  const reqHtml = formatFaqRequirementsHtml(item.keyRequirements);
  const citationsHtml = formatFaqCitationsHtml(item.citedArticles);

  return `
    <div class="qa-summary-banner" style="margin-bottom: 14px;">
      <div class="qa-summary-top">
        <div class="qa-summary-title"><span>💡</span> Key Summary</div>
        <div class="qa-summary-actions">
          <span class="qa-ts-badge" id="faqItemTsBadge_${globalIdx}">Answered: ${timeFormatted}</span>
          <button type="button" class="btn-qa-refresh" id="btnFaqReEvaluate_${globalIdx}" onclick="reEvaluateFaqItem(${globalIdx})">🔄 Answer Again</button>
        </div>
      </div>
      <ul class="qa-summary-list" id="faqItemSummaryList_${globalIdx}" style="white-space: normal !important;">${summaryHtml}</ul>
    </div>

    <div class="qa-requirements-wrap" id="faqItemReqWrap_${globalIdx}" style="margin-bottom: 14px; ${reqHtml ? '' : 'display:none;'}">
      <div class="qa-section-heading"><span>🛡️</span> Key Requirements & Practical Engineering Guide</div>
      <ul class="qa-req-list" id="faqItemReqList_${globalIdx}" style="white-space: normal !important;">${reqHtml}</ul>
    </div>

    <div class="qa-citations-wrap">
      <div class="qa-citations-heading"><span>📌</span> Referenced Official Documents & Legal Clauses</div>
      <div class="qa-citations-box" id="faqItemCitationsBox_${globalIdx}" style="white-space: normal !important;">${citationsHtml}</div>
    </div>
  `;
}

async function reEvaluateFaqItem(globalIdx) {
  const item = currentFilteredFaqList[globalIdx];
  if (!item || !item.question) return;

  const btn = document.getElementById(`btnFaqReEvaluate_${globalIdx}`);
  const tsBadge = document.getElementById(`faqItemTsBadge_${globalIdx}`);
  const summaryList = document.getElementById(`faqItemSummaryList_${globalIdx}`);
  const reqList = document.getElementById(`faqItemReqList_${globalIdx}`);
  const reqWrap = document.getElementById(`faqItemReqWrap_${globalIdx}`);
  const citationsBox = document.getElementById(`faqItemCitationsBox_${globalIdx}`);

  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `⏳ Analyzing...`;
  }

  const endpoint = getValidGasEndpoint();
  if (!endpoint) {
    alert("Backend API URL is not configured.");
    if (btn) { btn.disabled = false; btn.innerHTML = `🔄 Answer Again`; }
    return;
  }

  try {
    const token = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'ask_qa',
        auth: token,
        question: item.question,
        folderCategory: 'all',
        forceRefresh: true
      })
    });

    const rawText = await response.text();
    const res = safeJsonParse(rawText);

    if (res && res.status === 'success' && res.data) {
      const data = res.data;
      
      item.summary = data.summary;
      item.keyRequirements = data.keyRequirements;
      item.citedArticles = data.citedArticles;
      item.timestamp = data.generatedAt || getFormattedKstTimestamp();

      if (tsBadge) tsBadge.textContent = `Answered: ${formatDisplayTimestamp(item.timestamp)}`;
      if (summaryList) summaryList.innerHTML = formatFaqSummaryHtml(item.summary);
      
      const newReqHtml = formatFaqRequirementsHtml(item.keyRequirements);
      if (reqList) reqList.innerHTML = newReqHtml;
      if (reqWrap) reqWrap.style.display = newReqHtml ? 'block' : 'none';
      if (citationsBox) citationsBox.innerHTML = formatFaqCitationsHtml(item.citedArticles);

      const select = document.getElementById('qaCategorySelect');
      const cats = select ? Array.from(select.options).map(o => ({ id: o.value, name: o.text })) : [];
      saveInsightCacheToDB(cats, currentFaqMasterList);
    } else {
      alert("Re-evaluation failed: " + ((res && res.message) || "Unknown server response"));
    }
  } catch (err) {
    alert("Server error during re-evaluation: " + err.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `🔄 Answer Again`;
    }
  }
}

function toggleFaqAccordion(globalIdx) {
  if (expandedFaqGlobalIndex === globalIdx) {
    expandedFaqGlobalIndex = null;
  } else {
    expandedFaqGlobalIndex = globalIdx;
  }
  renderFaqPage();
}

function updateFaqPaginationUI(totalPages) {
  const infoDisplay = document.getElementById('faqPageInfoDisplay');
  const btnPrev = document.getElementById('btnFaqPrevPage');
  const btnNext = document.getElementById('btnFaqNextPage');

  if (infoDisplay) {
    infoDisplay.textContent = totalPages === 0 ? 'Page 0 of 0' : `Page ${faqCurrentPage} of ${totalPages}`;
  }

  if (btnPrev) btnPrev.disabled = (faqCurrentPage <= 1 || totalPages === 0);
  if (btnNext) btnNext.disabled = (faqCurrentPage >= totalPages || totalPages === 0);
}

function goToFaqPage(page) {
  faqCurrentPage = page;
  expandedFaqGlobalIndex = null;
  renderFaqPage();
}

function changeFaqPageSize(size) {
  faqPageSize = parseInt(size, 10) || 20;
  faqCurrentPage = 1;
  expandedFaqGlobalIndex = null;
  renderFaqPage();
}

function onFaqFilterChange() {
  const searchQ = (document.getElementById('filterFaqQuestion')?.value || '').toLowerCase().trim();

  currentFilteredFaqList = currentFaqMasterList.filter(item => {
    const itemQ = (item.question || '').toLowerCase();
    const itemSum = (item.summary || '').toLowerCase();
    return !searchQ || itemQ.includes(searchQ) || itemSum.includes(searchQ);
  });

  faqCurrentPage = 1;
  expandedFaqGlobalIndex = null;
  renderFaqPage();
}

function resetFaqFilters() {
  const input = document.getElementById('filterFaqQuestion');
  if (input) input.value = "";
  currentFilteredFaqList = [...currentFaqMasterList];
  faqCurrentPage = 1;
  expandedFaqGlobalIndex = null;
  renderFaqPage();
}

/* =========================================================================
   4. 질문 실행 (RESEARCH & ASK AI)
   ========================================================================= */
function showQaInlineNotice(msg) {
  const box = document.getElementById('qaInlineNotice');
  if (!box) return;
  box.textContent = msg;
  box.style.display = 'block';
  setTimeout(() => { box.style.display = 'none'; }, 4500);
}

function setQuickQuestion(questionText) {
  const input = document.getElementById('qaQuestionInput');
  if (input) {
    input.value = questionText;
    switchInsightSubTab('research');
    executeAskQA();
  }
}

async function executeAskQA(forceRefresh = false) {
  const input = document.getElementById('qaQuestionInput');
  const question = input ? input.value.trim() : "";
  const select = document.getElementById('qaCategorySelect');
  const categoryId = select ? select.value : "all";

  if (!question) {
    showQaInlineNotice("Please enter a question or keywords to analyze.");
    if (input) input.focus();
    return;
  }

  const endpoint = getValidGasEndpoint();
  if (!endpoint) {
    showQaInlineNotice("Backend API URL is not configured. Please verify system credentials.");
    return;
  }

  currentQaQuestion = question;
  currentQaCategory = categoryId;

  const btnSubmit = document.getElementById('btnSubmitQa');
  const loadingBox = document.getElementById('qaLoadingContainer');
  const resultCard = document.getElementById('qaResultContainer');

  if (btnSubmit) btnSubmit.disabled = true;
  if (loadingBox) loadingBox.style.display = 'block';
  if (resultCard) resultCard.style.display = 'none';

  try {
    const token = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'ask_qa',
        auth: token,
        question: question,
        folderCategory: categoryId,
        forceRefresh: forceRefresh
      })
    });

    const rawText = await response.text();
    if (!rawText || !rawText.trim()) {
      throw new Error("Empty response received from server. Please retry.");
    }

    const res = safeJsonParse(rawText);

    if (res && res.status === 'success' && res.data) {
      renderQaResult(res.data);
      // 질문 완료 후 백그라운드 동기화 호출
      syncInsightDataFromBackend();
      
      setTimeout(() => {
        const targetCard = document.getElementById('qaResultContainer');
        if (targetCard) {
          const topOffset = 180;
          const offsetPosition = targetCard.getBoundingClientRect().top + window.pageYOffset - topOffset;
          window.scrollTo({ top: Math.max(0, offsetPosition), behavior: 'smooth' });
        }
      }, 50);
    } else {
      showQaInlineNotice("Analysis failed: " + ((res && res.message) || "Invalid server response"));
    }

  } catch (error) {
    showQaInlineNotice("Server connection error: " + error.message);
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
    if (loadingBox) loadingBox.style.display = 'none';
  }
}

function safeJsonParse(text) {
  if (!text || typeof text !== 'string') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    let clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    try {
      return JSON.parse(clean);
    } catch (e2) {
      try {
        clean = clean.replace(/[\u0000-\u001F]+/g, ' ');
        return JSON.parse(clean);
      } catch (e3) {
        console.error("JSON parse failed completely:", text);
        return null;
      }
    }
  }
}

function renderQaResult(data) {
  const resultContainer = document.getElementById('qaResultContainer');
  const tsBadge = document.getElementById('qaAnswerTimestamp');
  const summaryUl = document.getElementById('qaAnswerSummary');
  const reqUl = document.getElementById('qaAnswerRequirements');
  const citationsBox = document.getElementById('qaAnswerCitations');

  if (!resultContainer) return;

  if (tsBadge) {
    const timeText = data.generatedAt ? formatDisplayTimestamp(data.generatedAt) : getFormattedKstTimestamp();
    tsBadge.textContent = `Answered: ${timeText}`;
  }

  if (summaryUl) {
    summaryUl.innerHTML = formatFaqSummaryHtml(data.summary);
  }

  if (reqUl) {
    reqUl.innerHTML = formatFaqRequirementsHtml(data.keyRequirements);
  }

  if (citationsBox) {
    citationsBox.innerHTML = formatFaqCitationsHtml(data.citedArticles);
  }

  resultContainer.style.display = 'block';
}

/* =========================================================================
   5. 텍스트 파싱 & 포맷터 헬퍼 (누락 원천 차단 완벽 정밀 파서)
   ========================================================================= */
function formatFaqSummaryHtml(rawSummary) {
  let text = String(rawSummary || '')
    .replace(/\\n/g, '\n')
    .replace(/^(?:💡\s*)?(?:Key Assessment|Key Summary):\s*/gi, '')
    .replace(/\*\*/g, '')
    .trim();

  let items = [];
  if (text.includes('\n')) {
    items = text.split('\n').map(s => s.trim()).filter(Boolean);
  } else if (text.includes('[KR]')) {
    const parts = text.split(/(\[KR\])/i);
    if (parts.length >= 3) {
      items.push(parts[0].trim());
      items.push((parts[1] + parts[2]).trim());
    } else {
      items.push(text);
    }
  } else {
    items.push(text);
  }

  return items.map(item => {
    let cleanItem = item
      .replace(/^(?:💡\s*)?(?:Key Assessment|Key Summary):\s*/gi, '')
      .replace(/^[•\-\*]\s*/, '')
      .replace(/\*\*/g, '')
      .trim();

    cleanItem = cleanItem
      .replace(/\[EN\]/g, '<strong style="color:#0f172a; font-weight:700;">[EN]</strong>')
      .replace(/\[KR\]/g, '<strong style="color:#0f172a; font-weight:700;">[KR]</strong>');

    return `<li style="margin-bottom: 8px; line-height: 1.65; color: #0f172a; white-space: normal !important; word-break: keep-all;">${cleanItem}</li>`;
  }).join('');
}

function formatFaqRequirementsHtml(keyRequirements) {
  const reqs = Array.isArray(keyRequirements) ? keyRequirements : [];
  if (!reqs.length) return '';

  return reqs.map(req => {
    let raw = (typeof req === 'string' ? req : JSON.stringify(req))
      .replace(/\\n/g, '\n')
      .trim();

    // 1. 헤더(대제목) 추출
    let header = "Key Requirements / 주요 요건";
    let body = raw;

    const colonIdx = raw.indexOf(':');
    if (colonIdx !== -1 && colonIdx < 80 && !raw.substring(0, colonIdx).includes('[EN]')) {
      header = raw.substring(0, colonIdx).replace(/\*\*/g, '').replace(/^[•\-\*\s]+/, '').trim();
      body = raw.substring(colonIdx + 1).trim();
    }

    // 2. 본문에서 [EN]과 [KR] 분리
    let enContent = "";
    let krContent = "";

    const enIdx = body.search(/\[EN\]/i);
    const krIdx = body.search(/\[KR\]/i);

    if (enIdx !== -1 && krIdx !== -1) {
      if (enIdx < krIdx) {
        enContent = body.substring(enIdx + 4, krIdx).replace(/^[•\-\*\s]+/, '').trim();
        krContent = body.substring(krIdx + 4).replace(/^[•\-\*\s]+/, '').trim();
      } else {
        krContent = body.substring(krIdx + 4, enIdx).replace(/^[•\-\*\s]+/, '').trim();
        enContent = body.substring(enIdx + 4).replace(/^[•\-\*\s]+/, '').trim();
      }

      return `
        <li style="margin-bottom: 16px; white-space: normal !important; word-break: keep-all;">
          <span style="font-weight: 700; color: #0f172a; font-size: 0.92rem;">${header}</span>
          <ul style="list-style-type: disc; margin-top: 4px; padding-left: 15px; white-space: normal !important;">
            ${enContent ? `<li style="margin-left: 20px; margin-top: 6px; line-height: 1.65; color: #334155;"><strong style="color:#1e293b; font-weight:700;">[EN]</strong> ${enContent}</li>` : ''}
            ${krContent ? `<li style="margin-left: 20px; margin-top: 6px; line-height: 1.65; color: #334155;"><strong style="color:#1e293b; font-weight:700;">[KR]</strong> ${krContent}</li>` : ''}
          </ul>
        </li>
      `;
    }

    // 3. Fallback: 태그가 없거나 단순 줄바꿈 형태일 때
    const lines = raw.split('\n').map(l => l.replace(/^[•\-\*\s]+/, '').trim()).filter(Boolean);
    const displayHeader = (lines.length > 1) ? lines[0].replace(/\*\*/g, '') : header;
    const contentLines = (lines.length > 1) ? lines.slice(1) : lines;

    return `
      <li style="margin-bottom: 16px; white-space: normal !important; word-break: keep-all;">
        <span style="font-weight: 700; color: #0f172a; font-size: 0.92rem;">${displayHeader}</span>
        <ul style="list-style-type: disc; margin-top: 4px; padding-left: 15px; white-space: normal !important;">
          ${contentLines.map(line => `
            <li style="margin-left: 20px; margin-top: 6px; line-height: 1.65; color: #334155;">
              ${line.replace(/\[EN\]/g, '<strong style="color:#1e293b; font-weight:700;">[EN]</strong>').replace(/\[KR\]/g, '<strong style="color:#1e293b; font-weight:700;">[KR]</strong>')}
            </li>
          `).join('')}
        </ul>
      </li>
    `;
  }).join('');
}

function formatFaqCitationsHtml(citedArticles) {
  const citations = Array.isArray(citedArticles) ? citedArticles : [];
  if (!citations.length) {
    return `<span style="font-size: 0.8rem; color: #94a3b8;">No direct citation required.</span>`;
  }
  return citations.map(c => `
    <span class="insight-chip" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 0.78rem; padding: 3px 8px; border-radius: 6px; white-space: normal !important; word-break: break-all;">
      📑 ${String(c).replace(/\*\*/g, '')}
    </span>
  `).join('');
}

function formatShortDate(rawTs) {
  if (!rawTs) return '-';
  const s = String(rawTs).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return s.slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const kstOffset = 9 * 60;
    const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
    const kst = new Date(utc + (kstOffset * 60000));
    const yyyy = kst.getFullYear();
    const mm = String(kst.getMonth() + 1).padStart(2, '0');
    const dd = String(kst.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  return s.split(' ')[0] || '-';
}

function formatDisplayTimestamp(rawTs) {
  if (!rawTs) return getFormattedKstTimestamp();
  const tsStr = String(rawTs).trim();
  if (tsStr.includes('T')) {
    const d = new Date(tsStr);
    if (!isNaN(d.getTime())) {
      const kstOffset = 9 * 60;
      const utc = d.getTime() + (d.getTimezoneOffset() * 60000);
      const kst = new Date(utc + (kstOffset * 60000));
      const yyyy = kst.getFullYear();
      const mm = String(kst.getMonth() + 1).padStart(2, '0');
      const dd = String(kst.getDate()).padStart(2, '0');
      const hh = String(kst.getHours()).padStart(2, '0');
      const min = String(kst.getMinutes()).padStart(2, '0');
      const ss = String(kst.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
    }
  }
  if (tsStr.includes('KST')) return tsStr;
  return `${tsStr} KST`;
}

function getFormattedKstTimestamp() {
  const now = new Date();
  const kstOffset = 9 * 60;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kst = new Date(utc + (kstOffset * 60000));
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, '0');
  const dd = String(kst.getDate()).padStart(2, '0');
  const hh = String(kst.getHours()).padStart(2, '0');
  const min = String(kst.getMinutes()).padStart(2, '0');
  const ss = String(kst.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
}

function safeInsightAttr(str) {
  return String(str || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeInsightText(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 전역 바인딩
window.switchInsightSubTab = switchInsightSubTab;
window.toggleFaqAccordion = toggleFaqAccordion;
window.reEvaluateFaqItem = reEvaluateFaqItem;
window.setQuickQuestion = setQuickQuestion;
window.executeAskQA = executeAskQA;
window.onFaqFilterChange = onFaqFilterChange;
window.resetFaqFilters = resetFaqFilters;
window.goToFaqPage = goToFaqPage;
window.changeFaqPageSize = changeFaqPageSize;
window.clearInsightIndexedDB = clearInsightIndexedDB;