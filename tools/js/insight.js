/* =========================================================================
   a2MDS WORKSPACE - AI-POWERED REGULATORY INSIGHT & FAQ MODULE (js/insight.js)
   (IndexedDB Local Cache Integration for Instant Page Load)
   ========================================================================= */

const HARDCODED_GAS_URL = "https://script.google.com/macros/s/AKfycbyYAQsRC4m53cgq_GjIzufZttI3paVHRE0x00JakuH75-YRkbNVdWV3qd1S6VZ0LnSqaQ/exec"; 
const INSIGHT_DB_NAME = 'a2MDS_InsightLog_DB';

let currentQaQuestion = "";
let currentQaCategory = "all";

// FAQ 페이지네이션 상태 변수
let currentFaqMasterList = [];
let currentFilteredFaqList = [];
let faqCurrentPage = 1;
let faqPageSize = 20;

/* =========================================================================
   1. INDEXED DB 캐시 로직 (초고속 즉시 로딩)
   ========================================================================= */
function openInsightDB() {
  return new Promise(res => {
    try {
      const req = indexedDB.open(INSIGHT_DB_NAME, 1);
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
   2. 초기화 & 엔드포인트 (core.js 연동)
   ========================================================================= */
async function initInsightModule() {
  const cached = await loadInsightCacheFromDB();
  if (cached) {
    if (Array.isArray(cached.categories) && cached.categories.length > 0) {
      renderCategorySelect(cached.categories);
    }
    if (Array.isArray(cached.faqs) && cached.faqs.length > 0) {
      currentFaqMasterList = cached.faqs;
      currentFilteredFaqList = [...currentFaqMasterList];
      faqCurrentPage = 1;
      renderFaqPage();
    }
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  await initInsightModule();
  initQaCategories();
  loadCachedFaqs();
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

function renderCategorySelect(categories) {
  const select = document.getElementById('qaCategorySelect');
  if (!select || !Array.isArray(categories)) return;
  const currentVal = select.value;
  select.innerHTML = categories.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  if (currentVal && categories.some(c => c.id === currentVal)) {
    select.value = currentVal;
  }
}

// 1. 카테고리(Scope) 로드
async function initQaCategories() {
  const endpoint = getValidGasEndpoint();
  if (!endpoint) return;

  try {
    const token = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'get_categories',
        auth: token
      })
    });

    const rawText = await resp.text();
    if (!rawText) return;
    const data = JSON.parse(rawText);

    if (data.status === 'success' && Array.isArray(data.categories)) {
      renderCategorySelect(data.categories);
      saveInsightCacheToDB(data.categories, currentFaqMasterList);
    }
  } catch (err) {
    console.warn("QA Categories loading skipped:", err);
  }
}

// 2. 캐시된 FAQ 목록 로드 (시트 DB)
async function loadCachedFaqs() {
  const tbody = document.getElementById('faqTableBody');
  const countBadge = document.getElementById('faqBadgeCount');
  if (!tbody) return;

  const endpoint = getValidGasEndpoint();
  if (!endpoint) return;

  try {
    const token = typeof getStoredAuthKey === 'function' ? getStoredAuthKey() : '';
    
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'get_faqs',
        auth: token
      })
    });

    const rawText = await resp.text();
    if (!rawText) return;
    const data = JSON.parse(rawText);

    if (data.status === 'success' && Array.isArray(data.faqs) && data.faqs.length > 0) {
      currentFaqMasterList = data.faqs;
      currentFilteredFaqList = [...currentFaqMasterList];
      renderFaqPage();

      const select = document.getElementById('qaCategorySelect');
      const cats = select ? Array.from(select.options).map(o => ({ id: o.value, name: o.text })) : [];
      saveInsightCacheToDB(cats, data.faqs);
    } else if (!currentFaqMasterList.length) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 24px; color: #94a3b8;">No FAQ data found.</td></tr>`;
      if (countBadge) countBadge.textContent = `0 Q&As`;
      updateFaqPaginationUI(0);
    }
  } catch (e) {
    console.warn("FAQ loading skipped:", e);
    if (!currentFaqMasterList.length) {
      tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 24px; color: #94a3b8;">FAQ 데이터를 불러오지 못했습니다.</td></tr>`;
      updateFaqPaginationUI(0);
    }
  }
}

// 3. FAQ 2열 구조 페이지 렌더링
function renderFaqPage() {
  const tbody = document.getElementById('faqTableBody');
  const countBadge = document.getElementById('faqBadgeCount');
  if (!tbody) return;

  const total = currentFilteredFaqList.length;
  if (countBadge) countBadge.textContent = `${total} Q&As`;

  if (total === 0) {
    tbody.innerHTML = `<tr><td colspan="2" style="text-align:center; padding: 24px; color: #94a3b8;">조건에 맞는 FAQ가 없습니다.</td></tr>`;
    updateFaqPaginationUI(0);
    return;
  }

  const totalPages = Math.ceil(total / faqPageSize) || 1;
  if (faqCurrentPage > totalPages) faqCurrentPage = totalPages;
  if (faqCurrentPage < 1) faqCurrentPage = 1;

  const startIdx = (faqCurrentPage - 1) * faqPageSize;
  const pageSlice = currentFilteredFaqList.slice(startIdx, startIdx + faqPageSize);

  tbody.innerHTML = pageSlice.map((item, idx) => {
    const globalIdx = startIdx + idx;
    return `
      <tr style="border-bottom: 1px solid #f1f5f9; transition: background 0.15s;" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='#ffffff'">
        <td style="padding: 13px 16px; font-weight: 700; color: #1e293b; cursor: pointer; line-height: 1.5;" title="${item.question}" onclick="openFaqDetailByIndex(${globalIdx})">
          ${item.question}
        </td>
        <td style="padding: 13px 12px; text-align: center;">
          <button type="button" onclick="openFaqDetailByIndex(${globalIdx})" data-tooltip="View detailed assessment" style="background: #ffffff; color: #16a34a; border: 1px solid #86efac; border-radius: 6px; padding: 5px 12px; font-size: 0.8rem; font-weight: 700; cursor: pointer; transition: background 0.15s;" onmouseover="this.style.background='#f0fdf4'" onmouseout="this.style.background='#ffffff'">
            🔍 View
          </button>
        </td>
      </tr>
    `;
  }).join('');

  updateFaqPaginationUI(totalPages);
}

// 페이지네이션 버튼 상태 업데이트
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

// 페이지 이동
function goToFaqPage(page) {
  faqCurrentPage = page;
  renderFaqPage();
}

// 페이지 크기 변경
function changeFaqPageSize(size) {
  faqPageSize = parseInt(size, 10) || 20;
  faqCurrentPage = 1;
  renderFaqPage();
}

// 4. 질문 키워드 실시간 검색 필터
function onFaqFilterChange() {
  const searchQ = (document.getElementById('filterFaqQuestion')?.value || '').toLowerCase().trim();

  currentFilteredFaqList = currentFaqMasterList.filter(item => {
    const itemQ = (item.question || '').toLowerCase();
    const itemSum = (item.summary || '').toLowerCase();
    return !searchQ || itemQ.includes(searchQ) || itemSum.includes(searchQ);
  });

  faqCurrentPage = 1;
  renderFaqPage();
}

// 필터 초기화
function resetFaqFilters() {
  if (document.getElementById('filterFaqQuestion')) document.getElementById('filterFaqQuestion').value = "";
  currentFilteredFaqList = [...currentFaqMasterList];
  faqCurrentPage = 1;
  renderFaqPage();
}

// FAQ 행 클릭 시 결과 카드 렌더링 및 상단 여백 스크롤
function openFaqDetailByIndex(globalIdx) {
  const item = currentFilteredFaqList[globalIdx] || currentFaqMasterList[globalIdx];
  if (!item) return;

  const input = document.getElementById('qaQuestionInput');
  if (input) input.value = item.question;

  renderQaResult({
    summary: item.summary,
    keyRequirements: item.keyRequirements,
    citedArticles: item.citedArticles,
    generatedAt: formatDisplayTimestamp(item.timestamp)
  });

  setTimeout(() => {
    const targetCard = document.getElementById('qaResultContainer');
    if (targetCard) {
      const topOffset = 180;
      const elementPosition = targetCard.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - topOffset;

      window.scrollTo({
        top: Math.max(0, offsetPosition),
        behavior: 'smooth'
      });
    }
  }, 50);
}

// 5. 추천 질문 칩 클릭
function setQuickQuestion(questionText) {
  const input = document.getElementById('qaQuestionInput');
  if (input) {
    input.value = questionText;
    executeAskQA();
  }
}

// 날짜 포맷 변환
function formatDisplayTimestamp(rawTs) {
  if (!rawTs) return getFormattedKstTimestamp();
  const tsStr = String(rawTs).trim();
  
  if (tsStr.includes('T')) {
    const dateObj = new Date(tsStr);
    if (!isNaN(dateObj.getTime())) {
      const kstOffset = 9 * 60;
      const utc = dateObj.getTime() + (dateObj.getTimezoneOffset() * 60000);
      const kstDate = new Date(utc + (kstOffset * 60000));

      const yyyy = kstDate.getFullYear();
      const mm = String(kstDate.getMonth() + 1).padStart(2, '0');
      const dd = String(kstDate.getDate()).padStart(2, '0');
      const hh = String(kstDate.getHours()).padStart(2, '0');
      const min = String(kstDate.getMinutes()).padStart(2, '0');
      const ss = String(kstDate.getSeconds()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
    }
  }

  if (tsStr.includes('KST')) return tsStr;
  return `${tsStr} KST`;
}

// KST 타임스탬프 생성
function getFormattedKstTimestamp() {
  const now = new Date();
  const kstOffset = 9 * 60;
  const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
  const kstDate = new Date(utc + (kstOffset * 60000));

  const yyyy = kstDate.getFullYear();
  const mm = String(kstDate.getMonth() + 1).padStart(2, '0');
  const dd = String(kstDate.getDate()).padStart(2, '0');
  const hh = String(kstDate.getHours()).padStart(2, '0');
  const min = String(kstDate.getMinutes()).padStart(2, '0');
  const ss = String(kstDate.getSeconds()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss} KST`;
}

// 6. 질문 실행 함수 (Ask AI)
async function executeAskQA(forceRefresh = false) {
  const input = document.getElementById('qaQuestionInput');
  const question = input ? input.value.trim() : "";
  const select = document.getElementById('qaCategorySelect');
  const categoryId = select ? select.value : "all";

  if (!question) {
    alert("질문 내용을 입력해주세요.");
    if (input) input.focus();
    return;
  }

  const endpoint = getValidGasEndpoint();
  if (!endpoint) {
    alert("GAS 백엔드 URL이 설정되지 않았습니다.");
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
      throw new Error("서버에서 응답을 받지 못했습니다. 잠시 후 Re-evaluate를 눌러주세요.");
    }

    const res = JSON.parse(rawText);
    if (res.status === 'success' && res.data) {
      renderQaResult(res.data);
      loadCachedFaqs();
      
      setTimeout(() => {
        const targetCard = document.getElementById('qaResultContainer');
        if (targetCard) {
          const topOffset = 180;
          const offsetPosition = targetCard.getBoundingClientRect().top + window.pageYOffset - topOffset;
          window.scrollTo({ top: Math.max(0, offsetPosition), behavior: 'smooth' });
        }
      }, 50);
    } else {
      alert("분석 요청 실패: " + (res.message || "Unknown server response"));
    }

  } catch (error) {
    alert("서버 통신 오류가 발생했습니다: " + error.message);
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
    if (loadingBox) loadingBox.style.display = 'none';
  }
}

// 7. 결과 렌더링 함수
function renderQaResult(data) {
  const resultContainer = document.getElementById('qaResultContainer');
  const tsBadge = document.getElementById('qaAnswerTimestamp');
  const summaryUl = document.getElementById('qaAnswerSummary');
  const reqUl = document.getElementById('qaAnswerRequirements');
  const citationsBox = document.getElementById('qaAnswerCitations');

  if (!resultContainer) return;

  if (tsBadge) {
    const timeText = data.generatedAt ? formatDisplayTimestamp(data.generatedAt) : getFormattedKstTimestamp();
    tsBadge.textContent = `Assessed: ${timeText}`;
  }

  // Key Summary 렌더링
  if (summaryUl) {
    let rawSummary = String(data.summary || '');
    rawSummary = rawSummary
      .replace(/^(?:💡\s*)?(?:Key Assessment|Key Summary):\s*/gi, '')
      .replace(/\*\*/g, '')
      .trim();

    let items = [];
    if (rawSummary.includes('\n')) {
      items = rawSummary.split('\n').map(s => s.trim()).filter(s => s.length > 0);
    } else if (rawSummary.includes('[KR]')) {
      const parts = rawSummary.split(/(\[KR\])/i);
      if (parts.length >= 3) {
        items.push(parts[0].trim());
        items.push((parts[1] + parts[2]).trim());
      } else {
        items.push(rawSummary);
      }
    } else {
      items.push(rawSummary);
    }

    summaryUl.innerHTML = items.map(item => {
      let cleanItem = item
        .replace(/^(?:💡\s*)?(?:Key Assessment|Key Summary):\s*/gi, '')
        .replace(/^[•\-\*]\s*/, '')
        .replace(/\*\*/g, '')
        .trim();

      cleanItem = cleanItem
        .replace(/\[EN\]/g, '<strong style="color:#0f172a; font-weight:700;">[EN]</strong>')
        .replace(/\[KR\]/g, '<strong style="color:#0f172a; font-weight:700;">[KR]</strong>');

      return `<li style="margin-bottom: 8px; line-height: 1.65; color: #0f172a;">${cleanItem}</li>`;
    }).join('');
  }

  // Key Requirements 렌더링
  if (reqUl) {
    const reqs = Array.isArray(data.keyRequirements) ? data.keyRequirements : [];
    reqUl.innerHTML = reqs.map(req => {
      let rawReq = typeof req === 'string' ? req : String(req);
      
      if (!rawReq.includes('\n') && rawReq.includes('[KR]')) {
        rawReq = rawReq.replace(/(\[EN\])/i, '\n• $1').replace(/(\[KR\])/i, '\n• $1');
      }

      const lines = rawReq.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      let header = (lines[0] || '').replace(/\*\*/g, '').replace(/:\s*$/, '').trim();
      
      const subBullets = lines.slice(1).map(sub => {
        let cleanSub = sub.replace(/^[•\-\*]\s*/, '').replace(/\*\*/g, '').trim();
        cleanSub = cleanSub
          .replace(/\[EN\]/g, '<strong style="color:#1e293b; font-weight:700;">[EN]</strong>')
          .replace(/\[KR\]/g, '<strong style="color:#1e293b; font-weight:700;">[KR]</strong>');
        
        return `<li style="margin-left: 20px; margin-top: 5px; line-height: 1.6; color: #475569;">${cleanSub}</li>`;
      }).join('');

      return `
        <li style="margin-bottom: 16px;">
          <span style="font-weight: 700; color: #0f172a; font-size: 0.92rem;">${header}</span>
          ${subBullets ? `<ul style="list-style-type: disc; margin-top: 5px; padding-left: 15px;">${subBullets}</ul>` : ''}
        </li>
      `;
    }).join('');
  }

  // Citations 뱃지 렌더링
  if (citationsBox) {
    const citations = Array.isArray(data.citedArticles) ? data.citedArticles : [];
    if (citations.length > 0) {
      citationsBox.innerHTML = citations.map(c => `
        <span class="insight-chip" style="background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; font-size: 0.8rem; padding: 4px 10px; border-radius: 6px;">
          📑 ${String(c).replace(/\*\*/g, '')}
        </span>
      `).join('');
    } else {
      citationsBox.innerHTML = `<span style="font-size: 0.8rem; color: #94a3b8;">No direct citation required.</span>`;
    }
  }

  resultContainer.style.display = 'block';
}
