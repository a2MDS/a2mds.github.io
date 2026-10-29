/**
 * js/minerals_suite.js
 * Responsible Minerals Workspace Controller (v3.0 Refactored)
 * - Pure UI & State Controller (Data processing & Excel engines delegated to MineralsParser)
 * - 100% Persistent Data Consistency (Reload / Re-login Safe via Google Sheets & Drive)
 * - High-Speed Batch DOM Rendering (Inner-HTML Injection replacing tr-appendChild reflows)
 * - 50 Items Standard Pagination Engine for Projects Directory & Vendor Master
 * - Filter Input Debouncing (120ms) for Smooth Typing Experience
 * - Unified Table Copy & Core Clipboard Engine Integration (Delegated to Parser)
 * - Pure Modal & Toast UX (Browser alerts/prompts completely removed)
 * - Completed Status Freeze (Read-only Lock, Dropzone Transformation, Modal Disclaimer)
 * - Unique IDs In-cell Strike-through/Line-break Audit Diff Engine
 */

window.MineralsSuite = (function () {
  'use strict';

  // ==========================================
  // 1. CONFIGURATION (환경 설정 및 상태)
  // ==========================================
  const GAS_ENDPOINT_URL = 'https://script.google.com/macros/s/AKfycbzuiKwnGrxbr15kGq0mRrl8yKcW4OZZBCMDGeMh87zMOEEFOuJhXIXSxWyUEBM8cLQW/exec';

  let state = {
    projects: [],
    submissions: [],
    vendors: [],
    activeProjectId: null,
    activeProjectData: null,
    activeProjectSubTab: 'slots', // 'slots' | 'allSmelters' | 'uniqueSmelters'
    uploadTargetSlotId: null,
    activeModalSlot: null,
    allSmeltersFilterExceptConf: false,
    uniqueSmeltersFilterExceptConf: false,
    uniqueSmeltersFilterChangedOnly: false,
    initialized: false,

    // Projects Directory Pagination State
    projectsCurrentPage: 1,
    projectsPageSize: 50,
    filteredProjectsCount: 0,

    // Vendor Master Pagination State
    vendorsCurrentPage: 1,
    vendorsPageSize: 50,
    filteredVendorsCount: 0,

    filters: {
      projects: { name: '', scope: '', creator: '', date: '', status: '', statusChanged: '', remarks: '' },
      slots: { tmplName: '', masterName: '', version: '', status: '', verify: '', file: '', remarks: '' },
      allSmelters: {
        supplier: new Set(),
        metal: '',
        cid: '',
        status: new Set(),
        cahra: new Set(),
        socs: new Set(),
        level: new Set(),
        facility: '',
        country: ''
      },
      uniqueSmelters: {
        metal: '',
        cid: '',
        status: new Set(),
        cahra: new Set(),
        socs: new Set(),
        level: new Set(),
        facility: '',
        country: '',
        supplier: new Set()
      },
      vendors: { name: '', code: '', status: 'Active', contact: '', remarks: '' }
    }
  };

  let isMrtUploading = false;
  let editingProjectId = null;
  let editingSlotIdForRemarks = null;
  let editingVendorId = null;
  let filterDebounceTimers = {};

  // ==========================================
  // [UI 유틸] 공통 토스트 및 확인 모달
  // ==========================================
  function showToast(message, isError = false) {
    let toast = document.getElementById('toastBox');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toastBox';
      toast.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 1000000;
        background: #1e293b; color: #fff; padding: 10px 16px; border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.18); font-size: 0.82rem; font-weight: 500;
        display: flex; align-items: center; gap: 8px; transition: opacity 0.25s, transform 0.25s;
        opacity: 0; transform: translateY(10px); pointer-events: none;
      `;
      document.body.appendChild(toast);
    }
    toast.style.borderColor = isError ? '#ef4444' : '#16a34a';
    toast.innerHTML = `<span>${isError ? '⚠️' : '✓'}</span><span>${message}</span>`;
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
    }, 2800);
  }

  function openConfirmModal(title, message, onConfirm, isDanger = false) {
    let modal = document.getElementById('modalMineralsConfirm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsConfirm';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:400px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-gray); padding-bottom:8px;">
            <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);" id="lblConfirmModalTitle">Confirm Action</h3>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsConfirm').style.display='none'">&times;</button>
          </div>
          <p id="lblConfirmModalMessage" style="font-size:0.84rem; color:var(--text-body); line-height:1.5; margin:0 0 16px;"></p>
          <div style="display:flex; justify-content:flex-end; gap:8px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsConfirm').style.display='none'">Cancel</button>
            <button type="button" id="btnExecuteModalConfirm" class="btn-act btn-save-all">Confirm</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('lblConfirmModalTitle').textContent = title;
    document.getElementById('lblConfirmModalMessage').textContent = message;

    const confirmBtn = document.getElementById('btnExecuteModalConfirm');
    confirmBtn.className = isDanger ? 'btn-act' : 'btn-act btn-save-all';
    confirmBtn.style.backgroundColor = isDanger ? '#dc2626' : '';
    confirmBtn.style.color = '#fff';
    confirmBtn.onclick = () => {
      modal.style.display = 'none';
      if (typeof onConfirm === 'function') onConfirm();
    };

    modal.style.display = 'flex';
  }

  function populateSelectOptions(selectId, optionsSet, currentVal) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    const sorted = Array.from(optionsSet || []).filter(v => v !== undefined && v !== null && v !== '').sort((a, b) => {
      if (a === '(blank)') return -1;
      if (b === '(blank)') return 1;
      return a.localeCompare(b);
    });
    let html = '<option value="">All</option>';
    sorted.forEach(opt => {
      const selected = (currentVal === opt) ? 'selected' : '';
      const styleAttr = (opt === '(blank)') ? 'style="color: #94a3b8; font-weight: 500;"' : '';
      html += `<option value="${opt}" ${styleAttr} ${selected}>${opt}</option>`;
    });
    sel.innerHTML = html;
    sel.value = currentVal || '';
  }

  // ==========================================
  // 2. 초기화 및 세션 바인딩 (SWR 캐시 & 가드)
  // ==========================================
  const CACHE_KEY_PREFIX = 'a2mds_minerals_cache_';

  function loadLocalCache(companyName) {
    try {
      const raw = localStorage.getItem(CACHE_KEY_PREFIX + companyName);
      if (!raw) return false;
      const cached = JSON.parse(raw);
      if (cached && cached.data) {
        state.projects = cached.data.projects || [];
        state.submissions = cached.data.submissions || [];
        state.vendors = cached.data.vendors || [];
        updateSyncBadge(`Cached (${cached.timestamp ? cached.timestamp.slice(5, 16) : 'Local'})`);
        return true;
      }
    } catch (e) {
      console.warn('[MineralsSuite] Cache Read Warning:', e);
    }
    return false;
  }

  function saveLocalCache(companyName) {
    try {
      localStorage.setItem(CACHE_KEY_PREFIX + companyName, JSON.stringify({
        timestamp: getKstTimestamp(),
        data: {
          projects: state.projects,
          submissions: state.submissions,
          vendors: state.vendors
        }
      }));
    } catch (e) {
      console.warn('[MineralsSuite] Cache Save Warning:', e);
    }
  }

  async function init() {
    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

    setupDropZoneEvents();

    const hasCached = loadLocalCache(companyName);
    if (hasCached) {
      renderProjectsDirectory();
      renderVendorMasterTable();
    }

    await fetchBackendData(companyName);
    state.initialized = true;
  }

  async function fetchBackendData(companyName, isRetry = false) {
    updateSyncBadge(isRetry ? 'Retrying...' : 'Syncing...');
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 9000);

    try {
      const resp = await fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'getInitialData', companyName: companyName }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      const rawText = await resp.text();
      if (rawText.trim().startsWith('<') || rawText.includes('<!DOCTYPE') || rawText.includes('<html')) {
        throw new Error('Google GAS Proxy HTML 404 Response');
      }

      const res = JSON.parse(rawText);
      if (!res.success) throw new Error(res.error || '데이터 로드 실패');

      state.projects = res.data.projects || [];
      state.submissions = res.data.submissions || [];
      state.vendors = res.data.vendors || [];

      saveLocalCache(companyName);
      updateSyncBadge(`Last Synced: ${getKstTimestamp()}`);
      renderProjectsDirectory();
      renderVendorMasterTable();
    } catch (err) {
      clearTimeout(timeoutId);
      console.warn(`[MineralsSuite] Fetch Warning${isRetry ? ' (Retry Failed)' : ''}:`, err);

      if (!isRetry) {
        setTimeout(() => fetchBackendData(companyName, true), 1200);
        return;
      }

      const hasCached = loadLocalCache(companyName);
      if (hasCached) {
        updateSyncBadge('Offline (Cached)');
        renderProjectsDirectory();
        renderVendorMasterTable();
      } else {
        updateSyncBadge('Offline (Failed)');
      }
    }
  }

  function getKstTimestamp() {
    return (typeof window.getKstTimestamp === 'function') ? window.getKstTimestamp() : new Date().toISOString().replace('T', ' ').slice(0, 19) + ' KST';
  }

  function getKstDateOnly() {
    return (typeof window.getKstDateOnly === 'function') ? window.getKstDateOnly() : new Date().toISOString().slice(0, 10);
  }

  function updateSyncBadge(text) {
    const el = document.getElementById('mineralsSyncTimestamp');
    if (el) el.textContent = text;
  }

  // ==========================================
  // 3. 네비게이션 제어 및 상태 동기화
  // ==========================================
  function switchSubTab(tabKey, btnElem) {
    document.querySelectorAll('#viewMinerals > .smelter-sub-tabs-wrapper .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#viewMinerals > .smelter-sub-pane').forEach(p => p.classList.remove('active'));

    if (btnElem) btnElem.classList.add('active');

    if (tabKey === 'workspace') {
      document.getElementById('mineralsSubPaneWorkspace')?.classList.add('active');
    } else if (tabKey === 'vendors') {
      document.getElementById('mineralsSubPaneVendors')?.classList.add('active');
      renderVendorMasterTable();
    }
  }

  function switchProjectSubTab(subTabKey, btnElem) {
    state.activeProjectSubTab = subTabKey;
    document.querySelectorAll('#mineralsProjectDetailView .smelter-sub-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('#mineralsProjectDetailView .smelter-sub-pane').forEach(p => p.classList.remove('active'));

    if (btnElem) btnElem.classList.add('active');

    if (subTabKey === 'slots') {
      document.getElementById('projPaneSlots')?.classList.add('active');
      renderSlotsTable();
    } else if (subTabKey === 'allSmelters') {
      document.getElementById('projPaneAllSmelters')?.classList.add('active');
      renderAllSmeltersTable();
    } else if (subTabKey === 'uniqueSmelters') {
      document.getElementById('projPaneUniqueSmelters')?.classList.add('active');
      renderUniqueSmeltersTable();
    }
  }

  function goToProjectsDirectory() {
    document.getElementById('mineralsProjectDetailView').style.display = 'none';
    document.getElementById('mineralsProjectsListView').style.display = 'block';
    state.activeProjectId = null;
    state.activeProjectData = null;
    renderProjectsDirectory();
  }

  async function openProjectWorkspace(projectId) {
    state.activeProjectId = projectId;
    state.activeProjectData = null;
    state.uniqueSmeltersFilterChangedOnly = false;
    const project = state.projects.find(p => p['Project ID'] === projectId);
    if (!project) return;

    document.getElementById('mineralsProjectsListView').style.display = 'none';
    const detailView = document.getElementById('mineralsProjectDetailView');
    detailView.style.display = 'flex';

    const titleEl = document.getElementById('mineralsActiveProjectTitleDisplay');
    if (titleEl) titleEl.textContent = `${project['Project Name']} (${project['Scope'] || 'CMRT'})`;

    applyProjectLockState(project);
    switchProjectSubTab('slots', document.getElementById('btnProjTabSlots'));
    updateProjectSubTabBadges();

    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

    try {
      const resp = await fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'getProjectJson',
          companyName: companyName,
          projectId: projectId
        })
      });
      const res = await resp.json();
      if (res.success && res.data) {
        state.activeProjectData = res.data;
        applyProjectLockState(project);
        if (state.activeProjectSubTab === 'uniqueSmelters') renderUniqueSmeltersTable();
        else if (state.activeProjectSubTab === 'allSmelters') renderAllSmeltersTable();
      }
    } catch (e) {
      console.warn('[MineralsSuite] Project JSON fetch warning:', e);
    }
  }

  function applyProjectLockState(project) {
    const isCompleted = (project['Status'] === 'Completed');
    const dropZone = document.getElementById('mineralsDropZone');
    const addVendorBtn = document.querySelector("button[onclick*='openAddSlotModal']");

    if (addVendorBtn) {
      addVendorBtn.style.display = isCompleted ? 'none' : 'inline-flex';
    }

    if (!dropZone) return;

    if (isCompleted) {
      dropZone.style.pointerEvents = 'none';
      dropZone.style.cursor = 'default';
      dropZone.style.borderStyle = 'solid';
      dropZone.style.borderColor = '#cbd5e1';
      dropZone.style.backgroundColor = '#f8fafc';

      dropZone.innerHTML = `
        <div class="gadsl-upload-icon-wrap" style="width:42px; height:42px; font-size:1.3rem; background:#ffffff; border-color:#cbd5e1;">
          <span>🔒</span>
        </div>
        <div class="gadsl-upload-content">
          <h4 class="gadsl-upload-title" style="font-size:0.92rem; color:#0f172a; display:flex; align-items:center; gap:8px;">
            <span>Audit Snapshot Locked</span>            
          </h4>
          <p class="gadsl-upload-subtitle" style="font-size:0.78rem; color:#475569; margin:2px 0 0;">
            - The current view is fixed to the snapshot captured at the time of completion.<br>
            - Smelter verification information may differ from the current database records.     
          </p>
        </div>
      `;
    } else {
      dropZone.style.pointerEvents = 'auto';
      dropZone.style.cursor = 'pointer';
      dropZone.style.borderStyle = 'dashed';
      dropZone.style.borderColor = '';
      dropZone.style.backgroundColor = '';

      dropZone.innerHTML = `
        <div class="gadsl-upload-icon-wrap" style="width:42px; height:42px; font-size:1.3rem;">
          <span>📥</span>
        </div>
        <div class="gadsl-upload-content">
          <h4 class="gadsl-upload-title" style="font-size:0.92rem;" id="mineralsDropZoneTitle">Drop Official ${project['Scope'] || 'RMI'} Excel Files Here (.xlsx)</h4>
          <p class="gadsl-upload-subtitle" style="font-size:0.78rem;">Auto-identifies Company Name, Version &amp; Scope, Extracts template data, Evaluates Conformance</p>
        </div>
        <input type="file" id="mineralsFileInput" accept=".xlsx, .xls" style="display:none;" onchange="MineralsSuite.handleFileInputChange(event)">
      `;
    }
  }

  // ==========================================
  // 4. 프로젝트 디렉토리 (Projects Directory - 50개 페이징)
  // ==========================================
  function onProjectFilterChange(field, val) {
    state.filters.projects[field] = val.trim();
    state.projectsCurrentPage = 1;
    clearTimeout(filterDebounceTimers['projects']);
    filterDebounceTimers['projects'] = setTimeout(renderProjectsDirectory, 120);
  }

  function resetProjectFilters() {
    state.filters.projects = { name: '', scope: '', creator: '', date: '', status: '', statusChanged: '', remarks: '' };
    state.projectsCurrentPage = 1;
    document.querySelectorAll('#mineralsProjectsFilterRow input').forEach(inp => inp.value = '');
    document.querySelectorAll('#mineralsProjectsFilterRow select').forEach(sel => sel.value = '');
    renderProjectsDirectory();
  }

  function goToProjectsPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.filteredProjectsCount / state.projectsPageSize));
    if (page < 1 || page > totalPages) return;
    state.projectsCurrentPage = page;
    renderProjectsDirectory();
  }

  function changeProjectsPageSize(newSize) {
    state.projectsPageSize = parseInt(newSize, 10) || 50;
    state.projectsCurrentPage = 1;
    renderProjectsDirectory();
  }

  function renderProjectsDirectory() {
    const tbody = document.getElementById('mineralsProjectsTableBody');
    if (!tbody) return;

    const f = state.filters.projects;
    const optScopes = new Set();
    const optStatuses = new Set();

    state.projects.forEach(proj => {
      const s = String(proj['Scope'] || '').trim();
      const st = String(proj['Status'] || '').trim();
      if (!s || s === '-') optScopes.add('(blank)');
      else optScopes.add(s);

      if (!st || st === '-') optStatuses.add('(blank)');
      else optStatuses.add(st);
    });

    populateSelectOptions('filterProject_scope', optScopes, f.scope);
    populateSelectOptions('filterProject_status', optStatuses, f.status);

    const matchedProjects = state.projects.filter(proj => {
      const pName = proj['Project Name'] || '';
      const rawScope = String(proj['Scope'] || '').trim();
      const pCreator = proj['Created By'] || '';
      const pDate = (proj['Created At'] || '').slice(0, 10);
      const rawStatus = String(proj['Status'] || '').trim();
      const pRemarks = proj['Remarks'] || '';

      let rawStatusChanged = proj['Status Changed'] || proj['StatusChanged'];
      if (!rawStatusChanged) {
        const matchedKey = Object.keys(proj).find(k => /status.*chang/i.test(k));
        if (matchedKey) rawStatusChanged = proj[matchedKey];
      }
      let pStatusChanged = String(rawStatusChanged || '').trim();
      pStatusChanged = pStatusChanged.length >= 10 ? pStatusChanged.slice(0, 10) : (pStatusChanged || '-');

      if (f.name && !pName.toLowerCase().includes(f.name.toLowerCase())) return false;

      if (f.scope) {
        if (f.scope === '(blank)') {
          if (rawScope && rawScope !== '-') return false;
        } else if (rawScope !== f.scope) {
          return false;
        }
      }

      if (f.creator && !pCreator.toLowerCase().includes(f.creator.toLowerCase())) return false;
      if (f.date && !pDate.toLowerCase().includes(f.date.toLowerCase())) return false;

      if (f.status) {
        if (f.status === '(blank)') {
          if (rawStatus && rawStatus !== '-') return false;
        } else if (rawStatus !== f.status) {
          return false;
        }
      }

      if (f.statusChanged && !pStatusChanged.toLowerCase().includes(f.statusChanged.toLowerCase())) return false;
      if (f.remarks && !pRemarks.toLowerCase().includes(f.remarks.toLowerCase())) return false;
      return true;
    });

    state.filteredProjectsCount = matchedProjects.length;
    const totalPages = Math.max(1, Math.ceil(state.filteredProjectsCount / state.projectsPageSize));
    if (state.projectsCurrentPage > totalPages) state.projectsCurrentPage = totalPages;
    if (state.projectsCurrentPage < 1) state.projectsCurrentPage = 1;

    const startIdx = (state.projectsCurrentPage - 1) * state.projectsPageSize;
    const pagedProjects = matchedProjects.slice(startIdx, startIdx + state.projectsPageSize);

    let html = '';

    pagedProjects.forEach(proj => {
      const pName = proj['Project Name'] || '';
      const rawScope = String(proj['Scope'] || '').trim();
      const pCreator = proj['Created By'] || '';
      const pDate = (proj['Created At'] || '').slice(0, 10);
      const rawStatus = String(proj['Status'] || '').trim();
      const pRemarks = proj['Remarks'] || '';

      let rawStatusChanged = proj['Status Changed'] || proj['StatusChanged'];
      if (!rawStatusChanged) {
        const matchedKey = Object.keys(proj).find(k => /status.*chang/i.test(k));
        if (matchedKey) rawStatusChanged = proj[matchedKey];
      }
      let pStatusChanged = String(rawStatusChanged || '').trim();
      pStatusChanged = pStatusChanged.length >= 10 ? pStatusChanged.slice(0, 10) : (pStatusChanged || '-');

      const pId = proj['Project ID'];
      const slots = state.submissions.filter(s => s['Project ID'] === pId);
      const submitted = slots.filter(s => s['Status'] === 'Submitted').length;
      const total = slots.length;

      let progressHtml = `<span style="font-size:0.75rem; color:#94a3b8; font-style:italic;">0/0 (0%)</span>`;
      if (total > 0 && submitted > 0) {
        const pct = Math.round((submitted / total) * 100);
        progressHtml = `
          <div style="display:flex; align-items:center; gap:8px; justify-content:center;">
            <div style="width:70px; height:6px; background:#e2e8f0; border-radius:3px; overflow:hidden;">
              <div style="width:${pct}%; height:100%; background:var(--primary-green);"></div>
            </div>
            <span style="font-family:var(--font-mono); font-size:0.74rem; color:#334155;">${submitted}/${total} (${pct}%)</span>
          </div>
        `;
      }

      let scopeHtml = '';
      if (rawScope === 'CMRT') scopeHtml = '<span style="font-family:var(--font-mono); color:#0284c7; font-weight:500;">CMRT</span>';
      else if (rawScope === 'EMRT') scopeHtml = '<span style="font-family:var(--font-mono); color:#d97706; font-weight:500;">EMRT</span>';
      else if (rawScope === 'AMRT') scopeHtml = '<span style="font-family:var(--font-mono); color:#7c3aed; font-weight:500;">AMRT</span>';
      else if (rawScope && rawScope !== '-') scopeHtml = `<span style="font-family:var(--font-mono); color:#475569;">${rawScope}</span>`;

      let statusHtml = '';
      if (rawStatus === 'Completed') statusHtml = '<span style="color:var(--primary-green); font-weight:600;">Completed</span>';
      else if (rawStatus === 'In Progress') statusHtml = '<span style="color:#0284c7; font-weight:600;">In Progress</span>';
      else if (rawStatus && rawStatus !== '-') statusHtml = `<span style="color:#475569;">${rawStatus}</span>`;

      const creatorClean = (pCreator && pCreator !== '-') ? pCreator : '';
      const dateClean = (pDate && pDate !== '-') ? pDate : '';
      const statusChangedClean = (pStatusChanged && pStatusChanged !== '-') ? pStatusChanged : '';
      const remarksClean = (pRemarks && pRemarks !== '-') ? pRemarks : '';

      html += `
        <tr>
          <td class="cell-left cell-ellipsis" style="padding:8px 12px;">
            <a href="javascript:void(0)" onclick="MineralsSuite.openProjectWorkspace('${pId}')" 
               style="color:#0284c7; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:6px; cursor:pointer;" 
               onmouseover="this.style.textDecoration='underline'" 
               onmouseout="this.style.textDecoration='none'" 
               title="Click to open project workspace">
              <span style="font-size:0.95rem;">📁</span>
              <span class="cell-ellipsis" style="max-width:220px;">${pName}</span>
            </a>
          </td>
          <td class="cell-center">${progressHtml}</td>
          <td class="cell-center">${scopeHtml}</td>
          <td class="cell-center cell-ellipsis" style="color:#475569; font-size:0.78rem;" title="${creatorClean}">${creatorClean}</td>
          <td class="cell-center" style="font-family:var(--font-mono); color:#64748b; font-size:0.75rem;">${dateClean}</td>
          <td class="cell-center" style="font-size:0.78rem;">${statusHtml}</td>
          <td class="cell-center" style="font-family:var(--font-mono); color:#64748b; font-size:0.75rem;">${statusChangedClean}</td>
          <td class="cell-left cell-ellipsis" style="font-size:0.76rem; color:#475569;" title="${remarksClean}">${remarksClean}</td>
          <td class="cell-center">
            <div style="display:inline-flex; align-items:center; gap:6px;">
              <button type="button" class="btn-row-action btn-edit" onclick="MineralsSuite.openEditProjectModal('${pId}')" title="Edit Project Status & Remarks">📝</button>
              <button type="button" class="btn-row-action btn-del" onclick="MineralsSuite.deleteProject('${pId}')" title="Delete Project">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No matching projects found.</td></tr>`;
    
    const badge = document.getElementById('mineralsProjectsCountBadge');
    if (badge) badge.textContent = `${state.filteredProjectsCount} of ${state.projects.length} projects`;

    const pageInfo = document.getElementById('mineralsProjectsPageInfoDisplay');
    if (pageInfo) pageInfo.textContent = `Page ${state.projectsCurrentPage} of ${totalPages}`;

    const btnPrev = document.getElementById('btnMineralsProjectsPrevPage');
    const btnNext = document.getElementById('btnMineralsProjectsNextPage');
    if (btnPrev) btnPrev.disabled = (state.projectsCurrentPage <= 1);
    if (btnNext) btnNext.disabled = (state.projectsCurrentPage >= totalPages);
  }

  // ==========================================
  // 5-A. [서브탭 1] 슬롯 진행 현황 (Slots Table)
  // ==========================================
  function onSlotFilterChange(field, val) {
    state.filters.slots[field] = val.toLowerCase().trim();
    clearTimeout(filterDebounceTimers['slots']);
    filterDebounceTimers['slots'] = setTimeout(renderSlotsTable, 120);
  }

  function resetSlotFilters() {
    state.filters.slots = { tmplName: '', masterName: '', version: '', status: '', verify: '', file: '', remarks: '' };
    document.querySelectorAll('#mineralsSlotsFilterRow input').forEach(inp => inp.value = '');
    renderSlotsTable();
  }

  function renderSlotsTable() {
    const tbody = document.getElementById('mineralsSlotsTableBody');
    if (!tbody) return;

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');
    const slots = state.submissions.filter(s => s['Project ID'] === state.activeProjectId);
    const f = state.filters.slots;

    let html = '';
    let matchCount = 0;

    slots.forEach(slot => {
      const isSubmitted = slot['Status'] === 'Submitted';
      const tmplName = slot['Company Name (Template)'] || '';
      const masterName = slot['Company Name (Master)'] || '';
      const version = slot['Template Version'] || '';
      const status = slot['Status'] || '';
      const verify = slot['Smelter Verification'] || '';
      const fileName = slot['File Name'] || '';
      const remarks = slot['Remarks'] || '';

      if (f.tmplName && !tmplName.toLowerCase().includes(f.tmplName)) return;
      if (f.masterName && !masterName.toLowerCase().includes(f.masterName)) return;
      if (f.version && !version.toLowerCase().includes(f.version)) return;
      if (f.status && !status.toLowerCase().includes(f.status)) return;
      if (f.verify && !verify.toLowerCase().includes(f.verify)) return;
      if (f.file && !fileName.toLowerCase().includes(f.file)) return;
      if (f.remarks && !remarks.toLowerCase().includes(f.remarks)) return;

      matchCount++;

      let verifyBadgeHtml = '';
      if (isSubmitted) {
        verifyBadgeHtml = `
          <a href="javascript:void(0)" onclick="MineralsSuite.openSmelterVerificationModal('${slot['Slot ID']}')"
             style="color:#0284c7; font-weight:600; text-decoration:none; cursor:pointer;"
             onmouseover="this.style.textDecoration='underline'"
             onmouseout="this.style.textDecoration='none'"
             title="Click to inspect reported smelters">
            ${verify || 'Action Needed'}
          </a>
        `;
      }

      let fileCell = '';
      if (slot['Drive File URL']) {
        fileCell = `
          <a href="${slot['Drive File URL']}" target="_blank" rel="noopener noreferrer" 
            style="color:#0284c7; text-decoration:none; font-family:var(--font-mono); font-size:0.75rem; display:inline-flex; align-items:center; gap:4px;">
            <span>📄</span><span class="cell-ellipsis" style="max-width:140px;" title="${fileName}">${fileName}</span>
          </a>
        `;
      }

      let tmplCellHtml = '';
      if (tmplName && tmplName !== '-' && isSubmitted) {
        tmplCellHtml = `
          <a href="javascript:void(0)" onclick="MineralsSuite.openMrtInspectionDrawer('${slot['Slot ID']}')"
             style="color:#0284c7; font-weight:600; text-decoration:none; cursor:pointer;"
             onmouseover="this.style.textDecoration='underline'"
             onmouseout="this.style.textDecoration='none'"
             title="Click to inspect uploaded declaration & products">
            <span class="cell-ellipsis" style="max-width:180px;">${tmplName}</span>
          </a>
        `;
      } else if (tmplName && tmplName !== '-') {
        tmplCellHtml = `<span style="color:#64748b;">${tmplName}</span>`;
      }

      const editMappingBtn = isCompleted ? '' : `<button type="button" class="btn-row-action btn-edit" onclick="MineralsSuite.editSlotMasterMapping('${slot['Slot ID']}')" title="Select Standard Master Vendor">✏️</button>`;
      const actionButtons = isCompleted ? '<span style="color:#cbd5e1; font-size:0.75rem;">🔒 Locked</span>' : `
        <div style="display:inline-flex; align-items:center; gap:6px;">
          <button type="button" class="btn-row-action" style="color:#0284c7;" onclick="MineralsSuite.triggerSlotFileUpload('${slot['Slot ID']}')" title="Replace / Re-upload Revision File">🔄</button>
          <button type="button" class="btn-row-action btn-edit" onclick="MineralsSuite.openEditRemarksModal('${slot['Slot ID']}')" title="Edit Remarks">📝</button>
          <button type="button" class="btn-row-action btn-del" onclick="MineralsSuite.deleteSlot('${slot['Slot ID']}')" title="Delete Slot">🗑️</button>
        </div>
      `;

      const versionClean = (version && version !== '-') ? version : '';
      const remarksClean = (remarks && remarks !== '-') ? remarks : '';

      html += `
        <tr>
          <td class="cell-left cell-ellipsis" style="padding-left:10px;">${tmplCellHtml}</td>
          <td class="cell-left cell-ellipsis" style="color:#334155;">
            <div style="display:inline-flex; align-items:center; gap:6px; max-width:100%;">
              <span class="cell-ellipsis" title="${masterName}">${masterName ? masterName : '<span style="color:#94a3b8; font-style:italic;">(Unmapped)</span>'}</span>
              ${editMappingBtn}
            </div>
          </td>
          <td class="cell-center" style="font-size:0.78rem; color:#334155;">${versionClean}</td>
          <td class="cell-center" style="font-size:0.75rem; color:${isSubmitted ? 'var(--primary-green)' : '#94a3b8'};">${status}</td>
          <td class="cell-center">${verifyBadgeHtml}</td>
          <td class="cell-left">${fileCell}</td>
          <td class="cell-left cell-ellipsis" style="font-size:0.76rem; color:#475569;" title="${remarksClean}">${remarksClean}</td>
          <td class="cell-center">${actionButtons}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="8" style="text-align:center; padding:24px; color:#94a3b8;">No matching slots found.</td></tr>`;
    const badgeEl = document.getElementById('mineralsSlotsCountBadge');
    if (badgeEl) badgeEl.textContent = `${matchCount} slots`;
    updateProjectSubTabBadges();
  }

  // ==========================================
  // 5-B. [서브탭 2] Smelters (All by vendor)
  // ==========================================
  // Minerals 멀티 드롭다운 일치 검사 헬퍼 ('(blank)'는 순수 공백 매칭, '-'는 실제 문자 매칭)
  function checkMineralsMultiMatch(val, selectedSet) {
    if (!selectedSet || !selectedSet.size) return true;
    const s = String(val || '').trim();
    if (!s) {
      return selectedSet.has('(blank)');
    }
    return selectedSet.has(s);
  }

  function onAllSmeltersFilterChange(field, val) {
    state.filters.allSmelters[field] = val.trim();
    clearTimeout(filterDebounceTimers['allSmelters']);
    filterDebounceTimers['allSmelters'] = setTimeout(renderAllSmeltersTable, 120);
  }

  function resetAllSmeltersFilters() {
    state.filters.allSmelters = {
      supplier: new Set(),
      metal: '',
      cid: '',
      status: new Set(),
      cahra: new Set(),
      socs: new Set(),
      level: new Set(),
      facility: '',
      country: ''
    };
    document.querySelectorAll('#mineralsAllSmeltersFilterRow input').forEach(inp => inp.value = '');
    ['supplier', 'status', 'cahra', 'socs', 'level'].forEach(k => {
      const txt = document.getElementById(`allMsText_${k}`);
      if (txt) txt.textContent = 'All';
    });
    state.allSmeltersFilterExceptConf = false;
    renderAllSmeltersTable();
  }

  function filterAllSmeltersExceptConf() {
    state.allSmeltersFilterExceptConf = !state.allSmeltersFilterExceptConf;
    renderAllSmeltersTable();
  }

  function renderAllSmeltersTable() {
    const tbody = document.getElementById('mineralsAllSmeltersTableBody');
    if (!tbody) return;

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');

    let rawRows = [];
    if (isCompleted && state.activeProjectData?.snapshot?.allSmelters) {
      rawRows = state.activeProjectData.snapshot.allSmelters;
    } else {
      const masterDb = window.consolidatedDataStore || [];
      const aggregated = MineralsParser.aggregateAllSmelters(state.submissions, state.activeProjectId, masterDb);
      rawRows = aggregated.rows;
    }

    const f = state.filters.allSmelters;
    let totalRowCount = 0;
    let html = '';

    rawRows.forEach(r => {
      if (state.allSmeltersFilterExceptConf && r.ddStatus === 'Conformant') return;

      if (f.supplier?.size && !checkMineralsMultiMatch(r.supplierLabel, f.supplier)) return;
      if (f.metal && !r.metal.toLowerCase().includes(f.metal.toLowerCase())) return;
      if (f.cid && !r.cid.toLowerCase().includes(f.cid.toLowerCase())) return;
      if (f.status?.size && !checkMineralsMultiMatch(r.ddStatus, f.status)) return;
      if (f.cahra?.size && !checkMineralsMultiMatch(r.cahra, f.cahra)) return;
      if (f.socs?.size && !checkMineralsMultiMatch(r.socs, f.socs)) return;
      if (f.level?.size && !checkMineralsMultiMatch(r.level, f.level)) return;
      if (f.facility && !r.facName.toLowerCase().includes(f.facility.toLowerCase())) return;
      if (f.country && !r.country.toLowerCase().includes(f.country.toLowerCase())) return;

      totalRowCount++;

      const cleanVal = v => (!v || v === '-') ? '' : v;
      const metal = cleanVal(r.metal);
      const level = cleanVal(r.level);
      const country = cleanVal(r.country);
      const facName = cleanVal(r.facName);
      const socVal = (r.socs && r.socs.startsWith('Y')) ? r.socs : '';

      html += `
        <tr>
          <td class="cell-left cell-ellipsis" style="padding-left:10px; color:#0f172a;" title="${r.supplierLabel}">${r.supplierLabel}</td>
          <td class="cell-center">${metal}</td>
          <td class="cell-center" style="font-family:var(--font-mono);">${r.cidHtml}</td>
          <td class="cell-center">${r.statusHtml}</td>
          <td class="cell-center">${r.cahraHtml}</td>
          <td class="cell-center" style="font-size:0.78rem; color:#dc2626; font-weight:600;">${socVal}</td>
          <td class="cell-center" style="font-size:0.76rem; color:#475569;">${level}</td>
          <td class="cell-left cell-ellipsis" title="${facName}">${facName}</td>
          <td class="cell-left cell-ellipsis" title="${country}">${country}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No matching smelters found.</td></tr>`;
    const badge = document.getElementById('mineralsAllSmeltersBadge');
    if (badge) badge.textContent = `${totalRowCount} records`;
  }

  // ==========================================
  // 5-C. [서브탭 3] Smelters (Unique IDs) - In-cell Diff Engine
  // ==========================================
  function onUniqueSmeltersFilterChange(field, val) {
    state.filters.uniqueSmelters[field] = val.trim();
    clearTimeout(filterDebounceTimers['uniqueSmelters']);
    filterDebounceTimers['uniqueSmelters'] = setTimeout(renderUniqueSmeltersTable, 120);
  }

  function resetUniqueSmeltersFilters() {
    state.filters.uniqueSmelters = {
      metal: '',
      cid: '',
      status: new Set(),
      cahra: new Set(),
      socs: new Set(),
      level: new Set(),
      facility: '',
      country: '',
      supplier: new Set()
    };
    document.querySelectorAll('#mineralsUniqueSmeltersFilterRow input').forEach(inp => inp.value = '');
    ['status', 'cahra', 'socs', 'level', 'supplier'].forEach(k => {
      const txt = document.getElementById(`uniqueMsText_${k}`);
      if (txt) txt.textContent = 'All';
    });
    state.uniqueSmeltersFilterExceptConf = false;
    state.uniqueSmeltersFilterChangedOnly = false;
    renderUniqueSmeltersTable();
  }

  function filterUniqueSmeltersExceptConf() {
    state.uniqueSmeltersFilterExceptConf = !state.uniqueSmeltersFilterExceptConf;
    renderUniqueSmeltersTable();
  }

  function toggleUniqueChangedOnlyFilter() {
    state.uniqueSmeltersFilterChangedOnly = !state.uniqueSmeltersFilterChangedOnly;
    renderUniqueSmeltersTable();
  }

  function renderUniqueSmeltersTable() {
    const tbody = document.getElementById('mineralsUniqueSmeltersTableBody');
    if (!tbody) return;

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');
    const masterDb = window.consolidatedDataStore || [];

    let processedRows = [];

    if (isCompleted && state.activeProjectData?.snapshot?.uniqueSmelters) {
      processedRows = MineralsParser.compareUniqueSmeltersDiff(state.activeProjectData.snapshot.uniqueSmelters, masterDb);
    } else {
      const aggregated = MineralsParser.aggregateUniqueSmelters(state.submissions, state.activeProjectId, masterDb);
      processedRows = aggregated.rows;
    }

    updateDiffFilterButtonUI(isCompleted, processedRows);

    const f = state.filters.uniqueSmelters;
    let uniqueRenderedCount = 0;
    let html = '';

    processedRows.forEach(r => {
      if (state.uniqueSmeltersFilterExceptConf && (r.liveStatus || r.ddStatus) === 'Conformant') return;
      if (state.uniqueSmeltersFilterChangedOnly && !r.isChanged) return;

      if (f.metal && !r.metal.toLowerCase().includes(f.metal.toLowerCase())) return;
      if (f.cid && !r.cid.toLowerCase().includes(f.cid.toLowerCase())) return;
      if (f.status?.size && !checkMineralsMultiMatch(r.ddStatus, f.status)) return;
      if (f.cahra?.size && !checkMineralsMultiMatch(r.cahra, f.cahra)) return;
      if (f.socs?.size && !checkMineralsMultiMatch(r.socs, f.socs)) return;
      if (f.level?.size && !checkMineralsMultiMatch(r.level, f.level)) return;
      if (f.facility && !r.facName.toLowerCase().includes(f.facility.toLowerCase())) return;
      if (f.country && !r.country.toLowerCase().includes(f.country.toLowerCase())) return;
      if (f.supplier?.size && !r.suppliersArr.some(s => checkMineralsMultiMatch(s, f.supplier))) return;

      uniqueRenderedCount++;

      const cleanVal = v => (!v || v === '-') ? '' : v;
      const metal = cleanVal(r.metal);
      const level = cleanVal(r.level);
      const country = cleanVal(r.country);
      const facName = cleanVal(r.facName);

      const statusCellHtml = (isCompleted && r.diffStatusHtml) ? r.diffStatusHtml : r.statusHtml;
      const cahraCellHtml = (isCompleted && r.diffCahraHtml) ? r.diffCahraHtml : r.cahraHtml;
      const socsCellHtml = (isCompleted && r.diffSocsHtml) ? r.diffSocsHtml : (r.socs && r.socs.startsWith('Y') ? `<span style="color:#dc2626; font-weight:600;">${r.socs}</span>` : '');

      const trBg = (isCompleted && r.isChanged) ? 'background-color:#fffbeb;' : '';

      html += `
        <tr style="${trBg}">
          <td class="cell-center">${metal}</td>
          <td class="cell-center" style="font-family:var(--font-mono);">${r.cidHtml}</td>
          <td class="cell-center">${statusCellHtml}</td>
          <td class="cell-center">${cahraCellHtml}</td>
          <td class="cell-center" style="font-size:0.78rem;">${socsCellHtml}</td>
          <td class="cell-center" style="font-size:0.76rem; color:#475569;">${level}</td>
          <td class="cell-left cell-ellipsis" title="${facName}">${facName}</td>
          <td class="cell-left cell-ellipsis" title="${country}">${country}</td>
          <td class="cell-left cell-ellipsis" style="padding-left:10px;" title="${r.suppliersText}">
            <span style="color:#64748b;">[${r.suppliersArr.length}]</span> ${r.suppliersText}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="9" style="text-align:center; padding:24px; color:#94a3b8;">No unique smelters found.</td></tr>`;
    const badge = document.getElementById('mineralsUniqueSmeltersBadge');
    if (badge) badge.textContent = `${uniqueRenderedCount} unique CIDs`;
  }

  function updateDiffFilterButtonUI(isCompleted, rows) {
    let btn = document.getElementById('btnUniqueFilterChangedOnly');
    const actionsContainer = document.querySelector('#projPaneUniqueSmelters .viewer-actions');

    if (!isCompleted) {
      if (btn) btn.style.display = 'none';
      return;
    }

    const changedCount = rows.filter(r => r.isChanged).length;
    if (!btn && actionsContainer) {
      btn = document.createElement('button');
      btn.id = 'btnUniqueFilterChangedOnly';
      btn.type = 'button';
      btn.className = 'btn-action-soft';
      btn.onclick = () => MineralsSuite.toggleUniqueChangedOnlyFilter();
      actionsContainer.insertBefore(btn, actionsContainer.firstChild);
    }

    if (btn) {
      btn.style.display = 'inline-flex';
      btn.style.alignItems = 'center';
      btn.style.gap = '5px';
      btn.style.fontWeight = '700';
      btn.style.fontSize = '0.80rem';
      btn.style.transition = 'all 0.15s ease';

      btn.innerHTML = `🔄 Status Changed <span style="background:${changedCount > 0 ? '#dc2626' : '#64748b'}; color:#ffffff; padding:1px 7px; border-radius:10px; font-size:0.72rem; font-weight:700; margin-left:2px;">${changedCount}</span>`;

      if (state.uniqueSmeltersFilterChangedOnly) {
        btn.style.backgroundColor = '#fee2e2';
        btn.style.color = '#b91c1c';
        btn.style.borderColor = '#f87171';
        btn.style.boxShadow = '0 0 0 2px rgba(220, 38, 38, 0.2)';
      } else {
        btn.style.backgroundColor = '#fef3c7';
        btn.style.color = '#92400e';
        btn.style.borderColor = '#f59e0b';
        btn.style.boxShadow = 'none';
      }
    }
  }

  // ==========================================
  // [엑셀 Export & 클립보드 복사 엔진 - Parser 위임]
  // ==========================================
  function exportAllSmeltersExcel() {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const pName = project ? project['Project Name'] : 'Project';
    try {
      const ok = MineralsParser.exportHtmlTableToExcel('mineralsAllSmeltersTable', 'All_Reported_Smelters', 'All Smelters', pName);
      if (!ok) showToast('No data to export.', true);
      else showToast('Exported All Smelters to Excel.');
    } catch (e) {
      showToast(`[Export Error] ${e.message}`, true);
    }
  }

  function exportUniqueSmeltersExcel() {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const pName = project ? project['Project Name'] : 'Project';
    try {
      const ok = MineralsParser.exportHtmlTableToExcel('mineralsUniqueSmeltersTable', 'Unique_Smelters', 'Unique Smelters', pName);
      if (!ok) showToast('No data to export.', true);
      else showToast('Exported Unique Smelters to Excel.');
    } catch (e) {
      showToast(`[Export Error] ${e.message}`, true);
    }
  }

  function copyUniqueCidsOnly() {
    const table = document.getElementById('mineralsUniqueSmeltersTable');
    if (!table) return;

    const cids = [];
    table.querySelectorAll('tbody tr').forEach(tr => {
      const cidEl = tr.querySelector('.clickable-cid');
      const cidText = cidEl ? (cidEl.getAttribute('data-cid') || cidEl.textContent.trim()) : '';
      if (cidText && cidText !== '-') cids.push(cidText);
    });

    if (!cids.length) {
      showToast('No CIDs to copy.', true);
      return;
    }

    navigator.clipboard.writeText(cids.join('\n'))
      .then(() => showToast(`Copied ${cids.length} unique CIDs to clipboard!`))
      .catch(() => showToast('Failed to copy CIDs.', true));
  }

  async function copyUniqueSmeltersAll() {
    const table = document.getElementById('mineralsUniqueSmeltersTable');
    if (!table) return;

    const rowsData = [];
    const headers = ['Metal', 'CID', 'DD Status', 'CAHRA Basis', 'SoCs', 'Level', 'Standard Facility Name', 'Country', 'Reported By (Vendor)'];

    table.querySelectorAll('tbody tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('td').forEach(td => {
        const badgeEl = td.querySelector('.clickable-cid');
        cells.push(badgeEl && badgeEl.getAttribute('data-cid') ? badgeEl.getAttribute('data-cid') : td.textContent.trim().replace(/\s+/g, ' '));
      });
      if (cells.length === headers.length) rowsData.push(cells);
    });

    if (!rowsData.length) {
      showToast('No unique smelters to copy.', true);
      return;
    }

    const btn = document.getElementById('btnCopyUniqueAll');
    const ok = await MineralsParser.copyFormattedTable(headers, rowsData, btn, '📑 Copy (All)');
    if (ok) showToast(`Copied ${rowsData.length} records formatted for Email!`);
  }

  function updateProjectSubTabBadges() {
    const slots = state.submissions.filter(s => s['Project ID'] === state.activeProjectId);
    const submittedSlots = slots.filter(s => s['Status'] === 'Submitted');

    let totalReportedCount = 0;
    const uniqueSet = new Set();

    submittedSlots.forEach(s => {
      const cids = (s['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);
      totalReportedCount += cids.length;
      cids.forEach(c => uniqueSet.add(c.toUpperCase()));
    });

    const bSlots = document.getElementById('badgeProjSlotsCount');
    if (bSlots) bSlots.textContent = slots.length;

    const bAll = document.getElementById('badgeProjAllSmeltersCount');
    if (bAll) bAll.textContent = totalReportedCount;

    const bUni = document.getElementById('badgeProjUniqueSmeltersCount');
    if (bUni) bUni.textContent = uniqueSet.size;
  }
  // ==========================================
  // 6. 엑셀 업로드 핸들러
  // ==========================================
  function setupDropZoneEvents() {
    const dropZone = document.getElementById('mineralsDropZone');
    if (!dropZone) return;

    ['dragenter', 'dragover'].forEach(name => {
      dropZone.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = 'var(--primary-green)';
        dropZone.style.backgroundColor = 'var(--primary-green-subtle)';
      });
    });

    ['dragleave', 'drop'].forEach(name => {
      dropZone.addEventListener(name, e => {
        e.preventDefault();
        e.stopPropagation();
        dropZone.style.borderColor = '';
        dropZone.style.backgroundColor = '';
      });
    });

    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      e.stopPropagation();
      const files = e.dataTransfer.files;
      if (files && files.length > 0) handleIncomingMrtFile(files[0], state.uploadTargetSlotId);
    });
  }

  function handleFileInputChange(e) {
    const files = e.target.files;
    if (files && files.length > 0) handleIncomingMrtFile(files[0], state.uploadTargetSlotId);
    e.target.value = '';
  }

  function triggerSlotFileUpload(slotId) {
    state.uploadTargetSlotId = slotId;
    document.getElementById('mineralsFileInput')?.click();
  }

  async function handleIncomingMrtFile(file, forcedSlotId = null) {
    if (isMrtUploading) return;

    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    if (!project) {
      showToast('No active project found.', true);
      return;
    }

    if (project['Status'] === 'Completed') {
      showToast('Completed project is locked. Upload is not permitted.', true);
      return;
    }

    isMrtUploading = true;
    updateSyncBadge('Parsing Excel...');

    try {
      const masterDb = window.consolidatedDataStore || [];
      const parsed = await MineralsParser.parseMrtFile(file, project['Scope'], masterDb);

      let targetSlotId = forcedSlotId;

      if (!targetSlotId) {
        const parsedCompName = (parsed.summary.companyNameTemplate || '').trim().toLowerCase();
        const duplicateSlot = state.submissions.find(s => {
          if (s['Project ID'] !== state.activeProjectId || s['Status'] !== 'Submitted') return false;
          const sTmpl = String(s['Company Name (Template)'] || '').trim().toLowerCase();
          return (sTmpl && sTmpl === parsedCompName);
        });

        if (duplicateSlot) {
          const compLabel = duplicateSlot['Company Name (Template)'];
          let proceed = await new Promise(resolve => {
            openConfirmModal(
              'Duplicate Submission Detected',
              `A submission from [${compLabel}] already exists.\nOverwrite and replace previous submission with [${file.name}]?`,
              () => resolve(true),
              false
            );
          });

          targetSlotId = proceed ? duplicateSlot['Slot ID'] : `slot-${Date.now()}`;
        } else {
          targetSlotId = `slot-${Date.now()}`;
        }
      }

      const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
      const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
      const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

      let existingSlot = state.submissions.find(s => s['Slot ID'] === targetSlotId);
      let currentMaster = existingSlot ? (existingSlot['Company Name (Master)'] || '') : '';

      if (existingSlot) {
        existingSlot['Company Name (Template)'] = parsed.summary.companyNameTemplate;
        existingSlot['Template Version'] = parsed.summary.templateVersion;
        existingSlot['Status'] = 'Submitted';
        existingSlot['Smelter Verification'] = parsed.summary.verificationResult;
        existingSlot['Reported Smelters Count'] = parsed.summary.smelterCount;
        existingSlot['Reported CIDs'] = parsed.summary.cids.join(', ');
        existingSlot['File Name'] = file.name;
        existingSlot['Updated At'] = nowStr;
      } else {
        state.submissions.push({
          'Company Name': companyName,
          'Slot ID': targetSlotId,
          'Project ID': state.activeProjectId,
          'Project Name': project['Project Name'] || '-',
          'Company Name (Template)': parsed.summary.companyNameTemplate,
          'Company Name (Master)': '',
          'Template Version': parsed.summary.templateVersion,
          'Status': 'Submitted',
          'Smelter Verification': parsed.summary.verificationResult,
          'Reported Smelters Count': parsed.summary.smelterCount,
          'Reported CIDs': parsed.summary.cids.join(', '),
          'File Name': file.name,
          'Drive File URL': '',
          'Remarks': 'Uploaded',
          'Updated At': nowStr
        });
      }

      renderSlotsTable();
      renderAllSmeltersTable();
      renderUniqueSmeltersTable();

      updateSyncBadge('Saving to Cloud...');

      const resp = await fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'uploadMrt',
          companyName: companyName,
          projectId: state.activeProjectId,
          slotId: targetSlotId,
          fileName: file.name,
          fileBase64: parsed.fileBase64,
          summary: Object.assign({}, parsed.summary, { masterName: currentMaster }),
          fullBackup: parsed.fullBackup
        })
      });

      const res = await resp.json();
      if (!res.success) throw new Error(res.error || 'Server Save Error');

      if (res.data?.fileUrl) {
        const updated = state.submissions.find(s => s['Slot ID'] === targetSlotId);
        if (updated) {
          updated['Drive File URL'] = res.data.fileUrl;
          renderSlotsTable();
        }
      }

      showToast(`Uploaded ${parsed.summary.companyNameTemplate} (${parsed.summary.verificationResult})`);
      updateSyncBadge('Saved');
    } catch (err) {
      showToast(`[Upload Error] ${err.message}`, true);
      updateSyncBadge('Sync Error');
    } finally {
      isMrtUploading = false;
      state.uploadTargetSlotId = null;
    }
  }

  // ==========================================
  // 7. 슬롯 관리 & 다중 협력사 추가 모달
  // ==========================================
  function openAddSlotModal() {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    if (project?.['Status'] === 'Completed') {
      showToast('Completed project is locked. Cannot add vendor.', true);
      return;
    }

    let modal = document.getElementById('modalMineralsAddSlot');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsAddSlot';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:540px; width:95%; max-height:85vh; display:flex; flex-direction:column; padding:18px 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.15rem;">🎯</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);">Add Vendor to the Project</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsAddSlot').style.display='none'">&times;</button>
          </div>
          
          <div style="margin-bottom:10px;">
            <input type="text" id="inpAddSlotSearchVendor" class="auth-input-field" placeholder="Search Vendor Name or Code..." oninput="MineralsSuite.filterAddSlotVendorList(this.value)">
          </div>

          <div class="table-wrapper" style="flex:1; max-height:360px; overflow-y:auto; border:1px solid var(--border-gray); border-radius:6px;">
            <table class="data-table" style="table-layout:fixed; width:100%;">
              <colgroup>
                <col style="width: 55%;">
                <col style="width: 33%;">
                <col style="width: 12%;">
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:left; padding-left:10px;">Vendor Name (Master)</th>
                  <th style="text-align:center;">Vendor Code (Internal)</th>
                  <th style="text-align:center;">
                    <input type="checkbox" id="chkAddSlotSelectAll" onchange="MineralsSuite.toggleAddSlotSelectAll(this.checked)" title="Select / Deselect All">
                  </th>
                </tr>
              </thead>
              <tbody id="tblAddSlotVendorBody"></tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; border-top:1px solid var(--border-gray); padding-top:10px;">
            <span id="lblAddSlotSelectedCount" style="font-size:0.78rem; font-weight:600; color:#0284c7;">0 vendor(s) selected</span>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsAddSlot').style.display='none'">Cancel</button>
              <button type="button" class="btn-act btn-save-all" id="btnSubmitAddSlotBatch" onclick="MineralsSuite.submitAddSlotModal()">+ Add Selected Vendor(s)</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('inpAddSlotSearchVendor').value = '';
    const selectAllChk = document.getElementById('chkAddSlotSelectAll');
    if (selectAllChk) selectAllChk.checked = false;

    renderAddSlotVendorList('');
    updateAddSlotSelectedCount();
    modal.style.display = 'flex';
  }

  function filterAddSlotVendorList(query) {
    clearTimeout(filterDebounceTimers['addSlotVendor']);
    filterDebounceTimers['addSlotVendor'] = setTimeout(() => renderAddSlotVendorList(query), 120);
  }

  function renderAddSlotVendorList(query) {
    const tbody = document.getElementById('tblAddSlotVendorBody');
    if (!tbody) return;

    const q = (query || '').toLowerCase().trim();
    const existingSlots = state.submissions.filter(s => s['Project ID'] === state.activeProjectId);
    const existingMasterNames = new Set(existingSlots.map(s => String(s['Company Name (Master)'] || '').trim().toLowerCase()));

    const activeVendors = state.vendors.filter(v => v['Status'] === 'Active');
    let matchCount = 0;
    let html = '';

    activeVendors.forEach(v => {
      const vName = v['Vendor Name (Master)'] || v['Master Vendor Name'] || '';
      const vCode = v['Vendor Code (Internal)'] || v['Internal Code'] || '';

      if (q && !vName.toLowerCase().includes(q) && !vCode.toLowerCase().includes(q)) return;

      matchCount++;
      const isAlreadyAdded = existingMasterNames.has(vName.toLowerCase());
      const rowBg = isAlreadyAdded ? 'background-color:#f8fafc;' : '';

      html += `
        <tr style="${rowBg}">
          <td class="cell-left cell-ellipsis" style="padding-left:10px; color:${isAlreadyAdded ? '#94a3b8' : '#0f172a'};" title="${vName}">
            ${vName} ${isAlreadyAdded ? '<span style="font-size:0.70rem; color:#94a3b8; font-style:italic;">(Already Added)</span>' : ''}
          </td>
          <td class="cell-center" style="font-family:var(--font-mono); font-size:0.76rem; color:${isAlreadyAdded ? '#cbd5e1' : '#475569'};">
            ${vCode || '-'}
          </td>
          <td class="cell-center">
            <input type="checkbox" class="chk-add-slot-item" value="${vName}" 
                   ${isAlreadyAdded ? 'disabled' : ''} 
                   onchange="MineralsSuite.updateAddSlotSelectedCount()">
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="3" style="text-align:center; padding:20px; color:#94a3b8;">No matching active vendors found in Master Pool.</td></tr>`;
  }

  function toggleAddSlotSelectAll(checked) {
    const checkboxes = document.querySelectorAll('#tblAddSlotVendorBody .chk-add-slot-item:not(:disabled)');
    checkboxes.forEach(chk => chk.checked = checked);
    updateAddSlotSelectedCount();
  }

  function updateAddSlotSelectedCount() {
    const checked = document.querySelectorAll('#tblAddSlotVendorBody .chk-add-slot-item:checked');
    const lbl = document.getElementById('lblAddSlotSelectedCount');
    if (lbl) lbl.textContent = `${checked.length} vendor(s) selected`;
  }

  function submitAddSlotModal() {
    const checkedBoxes = Array.from(document.querySelectorAll('#tblAddSlotVendorBody .chk-add-slot-item:checked'));
    if (checkedBoxes.length === 0) {
      showToast('Please select at least one vendor.', true);
      return;
    }

    const selectedVendorNames = checkedBoxes.map(chk => chk.value.trim()).filter(Boolean);
    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
    const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const projectName = currentProject ? currentProject['Project Name'] : '';

    document.getElementById('modalMineralsAddSlot').style.display = 'none';
    updateSyncBadge('Adding Vendors...');

    selectedVendorNames.forEach((vendorName, idx) => {
      const newSlotId = `slot-${Date.now()}-${idx}`;
      state.submissions.push({
        'Company Name': companyName,
        'Slot ID': newSlotId,
        'Project ID': state.activeProjectId,
        'Project Name': projectName,
        'Company Name (Template)': '-',
        'Company Name (Master)': vendorName,
        'Template Version': '-',
        'Status': 'Pending',
        'Smelter Verification': '-',
        'Reported Smelters Count': 0,
        'Reported CIDs': '',
        'File Name': '-',
        'Drive File URL': '',
        'Remarks': '',
        'Updated At': nowStr
      });

      fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'createSlot',
          companyName: companyName,
          projectId: state.activeProjectId,
          projectName: projectName,
          slotId: newSlotId,
          masterName: vendorName
        })
      }).catch(err => console.warn('Slot creation sync error:', err));
    });

    renderSlotsTable();
    showToast(`Added ${selectedVendorNames.length} vendor(s) to project slots.`);
    updateSyncBadge('Saved');
  }

  let selectedMappingVendorName = '';

  function editSlotMasterMapping(slotId) {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    if (project?.['Status'] === 'Completed') {
      showToast('Completed project is locked. Master vendor mapping cannot be modified.', true);
      return;
    }

    const slot = state.submissions.find(s => s['Slot ID'] === slotId);
    if (!slot) return;

    const currentMaster = (slot['Company Name (Master)'] || '').trim();
    const activeVendors = state.vendors.filter(v => v['Status'] === 'Active');
    const isActiveVendor = activeVendors.some(v => {
      const name = v['Vendor Name (Master)'] || v['Master Vendor Name'] || '';
      return name.trim().toLowerCase() === currentMaster.toLowerCase();
    });

    selectedMappingVendorName = isActiveVendor ? currentMaster : '';

    let modal = document.getElementById('modalMineralsEditMapping');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsEditMapping';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:520px; width:95%; max-height:85vh; display:flex; flex-direction:column; padding:18px 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.15rem;">✏️</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);">Map Master Vendor</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsEditMapping').style.display='none'">&times;</button>
          </div>
          
          <div style="margin-bottom:8px;">
            <label style="font-size:0.78rem; font-weight:600; color:var(--text-muted); display:block; margin-bottom:4px;">Select from Vendor Master</label>
            <input type="text" id="inpEditMappingSearch" class="auth-input-field" placeholder="Search Vendor Name or Code..." oninput="MineralsSuite.filterMappingVendorList(this.value)">
          </div>

          <div class="table-wrapper" style="flex:1; max-height:320px; overflow-y:auto; border:1px solid var(--border-gray); border-radius:6px;">
            <table class="data-table" style="table-layout:fixed; width:100%;">
              <colgroup>
                <col style="width: 60%;">
                <col style="width: 40%;">
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:left; padding-left:12px;">Vendor Name (Master)</th>
                  <th style="text-align:center;">Vendor Code (Internal)</th>
                </tr>
              </thead>
              <tbody id="tblEditMappingVendorBody"></tbody>
            </table>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center; margin-top:14px; border-top:1px solid var(--border-gray); padding-top:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span id="lblSelectedMappingName" style="font-size:0.80rem; font-weight:600; color:#0284c7;">Selected: None</span>
              <button type="button" class="btn-action-soft" onclick="MineralsSuite.clearMappingSelection()" style="padding:2px 8px; font-size:0.74rem;" title="Unmap">Unmap</button>
            </div>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsEditMapping').style.display='none'">Cancel</button>
              <button type="button" class="btn-act btn-save-all" id="btnSubmitMappingModal">Apply Mapping</button>
            </div>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('inpEditMappingSearch').value = '';
    renderMappingVendorList('');
    updateMappingSelectionUI();

    document.getElementById('btnSubmitMappingModal').onclick = () => {
      const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
      const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

      slot['Company Name (Master)'] = selectedMappingVendorName;
      renderSlotsTable();
      renderAllSmeltersTable();
      renderUniqueSmeltersTable();
      modal.style.display = 'none';
      showToast(selectedMappingVendorName ? `Master vendor mapped to [${selectedMappingVendorName}]` : 'Master mapping cleared.');

      fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'updateSlotMasterMapping',
          companyName: companyName,
          projectId: state.activeProjectId,
          slotId: slotId,
          masterName: selectedMappingVendorName
        })
      }).catch(e => console.warn('Sync error:', e));
    };

    modal.style.display = 'flex';
  }

  function filterMappingVendorList(query) {
    clearTimeout(filterDebounceTimers['mappingVendor']);
    filterDebounceTimers['mappingVendor'] = setTimeout(() => renderMappingVendorList(query), 120);
  }

  function renderMappingVendorList(query) {
    const tbody = document.getElementById('tblEditMappingVendorBody');
    if (!tbody) return;

    const q = (query || '').toLowerCase().trim();
    const activeVendors = state.vendors.filter(v => v['Status'] === 'Active');
    let matchCount = 0;
    let html = '';

    activeVendors.forEach(v => {
      const vName = (v['Vendor Name (Master)'] || v['Master Vendor Name'] || '').trim();
      const vCode = (v['Vendor Code (Internal)'] || v['Internal Code'] || '').trim();

      if (q && !vName.toLowerCase().includes(q) && !vCode.toLowerCase().includes(q)) return;

      matchCount++;
      const isSelected = (selectedMappingVendorName && selectedMappingVendorName.toLowerCase() === vName.toLowerCase());
      const rowBg = isSelected ? 'background-color:#e0f2fe;' : '';

      html += `
        <tr style="cursor:pointer; ${rowBg}" onclick="MineralsSuite.selectMappingVendor('${vName.replace(/'/g, "\\'")}')">
          <td class="cell-left cell-ellipsis" style="padding-left:12px; font-weight:${isSelected ? '600' : 'normal'}; color:${isSelected ? '#0284c7' : '#0f172a'};" title="${vName}">
            ${isSelected ? '✓ ' : ''}${vName}
          </td>
          <td class="cell-center" style="font-family:var(--font-mono); font-size:0.76rem; color:#475569;">
            ${vCode || '-'}
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="2" style="text-align:center; padding:20px; color:#94a3b8;">No active master vendors available.</td></tr>`;
  }

  function selectMappingVendor(vName) {
    selectedMappingVendorName = vName;
    renderMappingVendorList(document.getElementById('inpEditMappingSearch')?.value || '');
    updateMappingSelectionUI();
  }

  function updateMappingSelectionUI() {
    const lbl = document.getElementById('lblSelectedMappingName');
    if (lbl) {
      lbl.textContent = selectedMappingVendorName ? `Selected: ${selectedMappingVendorName}` : 'Selected: None (Unmapped)';
      lbl.style.color = selectedMappingVendorName ? '#0284c7' : '#94a3b8';
    }
  }

  function clearMappingSelection() {
    selectedMappingVendorName = '';
    renderMappingVendorList(document.getElementById('inpEditMappingSearch')?.value || '');
    updateMappingSelectionUI();
  }

  function openEditRemarksModal(slotId) {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    if (project?.['Status'] === 'Completed') {
      showToast('Completed project is locked. Remarks cannot be modified.', true);
      return;
    }

    const slot = state.submissions.find(s => s['Slot ID'] === slotId);
    if (!slot) return;

    editingSlotIdForRemarks = slotId;
    const companyLabel = slot['Company Name (Template)'] || slot['Company Name (Master)'] || 'Supplier Slot';
    const currentRemarks = slot['Remarks'] || '';

    let modal = document.getElementById('modalMineralsEditRemarks');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsEditRemarks';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:480px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">📝</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);" id="lblEditRemarksTarget">Edit Remarks</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsEditRemarks').style.display='none'">&times;</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:10px;">
            <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted);">Remarks</label>
            <textarea id="taSlotRemarksContent" class="tbl-textarea-details" style="min-height:90px; padding:8px 10px; font-size:0.84rem;"></textarea>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px; border-top:1px solid var(--border-gray); padding-top:12px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsEditRemarks').style.display='none'">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="MineralsSuite.submitEditRemarksModal()">Apply & Save</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('lblEditRemarksTarget').textContent = `Edit Remarks: ${companyLabel}`;
    const ta = document.getElementById('taSlotRemarksContent');
    if (ta) {
      ta.value = currentRemarks;
      setTimeout(() => ta.focus(), 50);
    }
    modal.style.display = 'flex';
  }

  function submitEditRemarksModal() {
    if (!editingSlotIdForRemarks) return;

    const slot = state.submissions.find(s => s['Slot ID'] === editingSlotIdForRemarks);
    if (!slot) return;

    const newRemarks = document.getElementById('taSlotRemarksContent')?.value.trim() || '';
    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

    slot['Remarks'] = newRemarks;
    renderSlotsTable();
    document.getElementById('modalMineralsEditRemarks').style.display = 'none';
    showToast('Remarks updated.');

    fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateSlotRemarks',
        companyName: companyName,
        projectId: state.activeProjectId,
        slotId: editingSlotIdForRemarks,
        remarks: newRemarks
      })
    }).catch(e => console.warn('Remarks sync error:', e));

    editingSlotIdForRemarks = null;
  }

  function deleteSlot(slotId) {
    const project = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    if (project?.['Status'] === 'Completed') {
      showToast('Completed project is locked. Slot deletion is not permitted.', true);
      return;
    }

    const slot = state.submissions.find(s => s['Slot ID'] === slotId);
    const label = slot ? (slot['Company Name (Master)'] || slot['Company Name (Template)'] || 'this slot') : 'this slot';

    openConfirmModal(
      'Delete Slot',
      `Delete supplier slot [${label}] and its reported smelters?`,
      () => {
        const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
        const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

        state.submissions = state.submissions.filter(s => s['Slot ID'] !== slotId);
        renderSlotsTable();
        renderAllSmeltersTable();
        renderUniqueSmeltersTable();
        showToast('Slot deleted.');

        fetch(GAS_ENDPOINT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'deleteSlot', companyName, projectId: state.activeProjectId, slotId })
        }).catch(e => console.warn('Sync error:', e));
      },
      true
    );
  }

  // ==========================================
  // [핵심] 프로젝트 상태 수정 & Completed 스냅샷 처리
  // ==========================================
  function openEditProjectModal(projectId) {
    const project = state.projects.find(p => p['Project ID'] === projectId);
    if (!project) return;

    editingProjectId = projectId;

    let modal = document.getElementById('modalMineralsEditProject');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsEditProject';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:440px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">📝</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);">Edit Project Details</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsEditProject').style.display='none'">&times;</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="modal-field">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted);">Project Identifier (Immutable)</label>
                <span style="font-size:0.70rem; color:#94a3b8;">🔒 Locked</span>
              </div>
              <input type="text" id="inpEditProjName" class="auth-input-field" readonly style="background:#f1f5f9; color:#475569; cursor:not-allowed;">
            </div>
            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); display:block; margin-bottom:4px;">Project Status</label>
              <select id="selEditProjStatus" class="page-select" style="width:100%; height:36px; padding:6px 10px;">
                <option value="In Progress">In Progress</option>
                <option value="Completed">Completed</option>
              </select>
            </div>
            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); display:block; margin-bottom:4px;">Project Remarks</label>
              <textarea id="taEditProjRemarks" class="tbl-textarea-details" style="min-height:90px; padding:8px 10px; font-size:0.84rem;"></textarea>
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:16px; border-top:1px solid var(--border-gray); padding-top:12px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsEditProject').style.display='none'">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="MineralsSuite.submitEditProjectModal()">Save Changes</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('inpEditProjName').value = project['Project Name'] || '';
    document.getElementById('selEditProjStatus').value = project['Status'] || 'In Progress';
    document.getElementById('taEditProjRemarks').value = project['Remarks'] || '';
    modal.style.display = 'flex';
  }

  async function submitEditProjectModal() {
    if (!editingProjectId) return;
    const project = state.projects.find(p => p['Project ID'] === editingProjectId);
    if (!project) return;

    const oldStatus = project['Status'];
    const newStatus = document.getElementById('selEditProjStatus')?.value || 'In Progress';
    const newRemarks = document.getElementById('taEditProjRemarks')?.value.trim() || '';

    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
    const completedBy = String(profile?.name || profile?.userId || 'Admin').trim();

    let generatedSnapshot = null;

    if (newStatus === 'Completed' && oldStatus !== 'Completed') {
      const masterDb = window.consolidatedDataStore || [];
      const harvestDate = document.getElementById('smelterSummaryUpdateDate')?.textContent?.replace('Latest Harvest:', '').trim();
      generatedSnapshot = MineralsParser.buildProjectSnapshot(project, state.submissions, masterDb, completedBy, harvestDate);
    }

    if (newStatus !== oldStatus) {
      project['Status Changed'] = getKstTimestamp();
    }
    project['Status'] = newStatus;
    project['Remarks'] = newRemarks;
    renderProjectsDirectory();

    if (state.activeProjectId === editingProjectId) {
      if (generatedSnapshot) {
        if (!state.activeProjectData) state.activeProjectData = {};
        state.activeProjectData.snapshot = generatedSnapshot;
      } else if (newStatus === 'In Progress' && state.activeProjectData?.snapshot) {
        delete state.activeProjectData.snapshot;
      }
      applyProjectLockState(project);
      renderSlotsTable();
      renderAllSmeltersTable();
      renderUniqueSmeltersTable();
    }

    document.getElementById('modalMineralsEditProject').style.display = 'none';
    showToast(newStatus === 'Completed' ? 'Project marked as Completed & Snapshot Frozen.' : 'Project details updated.');

    fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'updateProjectInfo',
        companyName: companyName,
        projectId: editingProjectId,
        status: newStatus,
        remarks: newRemarks,
        snapshot: generatedSnapshot
      })
    }).catch(e => console.warn('Project update sync error:', e));

    editingProjectId = null;
  }

  function deleteProject(pId) {
    const project = state.projects.find(p => p['Project ID'] === pId);
    const pName = project ? project['Project Name'] : 'this project';

    openConfirmModal(
      'Delete Project',
      `Are you sure you want to delete [${pName}] and all its submission slots?`,
      () => {
        const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
        const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

        state.projects = state.projects.filter(p => p['Project ID'] !== pId);
        state.submissions = state.submissions.filter(s => s['Project ID'] !== pId);
        renderProjectsDirectory();
        showToast('Project deleted.');

        fetch(GAS_ENDPOINT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'deleteProject', companyName, projectId: pId })
        }).catch(e => console.warn('Sync error:', e));
      },
      true
    );
  }

  function openCreateProjectModal() {
    let modal = document.getElementById('modalMineralsCreateProject');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsCreateProject';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:440px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);">📁 Create New Project</h3>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsCreateProject').style.display='none'">&times;</button>
          </div>
          <div style="display:flex; flex-direction:column; gap:12px;">
            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); display:block; margin-bottom:4px;">Project Name</label>
              <input type="text" id="inpNewProjName" class="auth-input-field" placeholder="e.g. Ford_Company Level" autofocus>
            </div>
            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); display:block; margin-bottom:4px;">Reporting Scope</label>
              <select id="selNewProjScope" class="page-select" style="width:100%; height:36px; padding:6px 10px;">
                <option value="CMRT" selected>CMRT (Conflict Minerals: 3TG)</option>
                <option value="EMRT">EMRT (Extended Minerals: Cobalt, Mica, etc.)</option>
                <option value="AMRT">AMRT (Additional Minerals: Aluminum, etc.)</option>
              </select>
            </div>
            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); display:block; margin-bottom:4px;">Remarks (Optional)</label>
              <input type="text" id="inpNewProjRemarks" class="auth-input-field" placeholder="e.g. Due by Sep & Dec">
            </div>
          </div>
          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:18px; border-top:1px solid var(--border-gray); padding-top:12px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsCreateProject').style.display='none'">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="MineralsSuite.submitCreateProject()">Create Project</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('inpNewProjName').value = '';
    document.getElementById('selNewProjScope').value = 'CMRT';
    document.getElementById('inpNewProjRemarks').value = '';
    modal.style.display = 'flex';
  }

  function submitCreateProject() {
    const rawName = document.getElementById('inpNewProjName')?.value.trim();
    const scope = document.getElementById('selNewProjScope')?.value || 'CMRT';
    const remarks = document.getElementById('inpNewProjRemarks')?.value.trim() || '';

    if (!rawName) {
      showToast('Please enter project name.', true);
      return;
    }

    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
    const createdBy = String(profile?.name || profile?.userId || 'Admin').trim();

    updateSyncBadge('Creating Project...');
    document.getElementById('modalMineralsCreateProject').style.display = 'none';

    fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'createProject',
        companyName: companyName,
        projectName: rawName,
        scope: scope,
        createdBy: createdBy,
        remarks: remarks
      })
    })
    .then(r => r.json())
    .then(res => {
      if (!res.success) throw new Error(res.error);
      showToast(`Project Created: ${res.data.projectName}`);
      fetchBackendData(companyName).then(() => {
        renderProjectsDirectory();
        openProjectWorkspace(res.data.projectId);
      });
    })
    .catch(err => showToast(`[Error] ${err.message}`, true))
    .finally(() => updateSyncBadge('Ready'));
  }

  // ==========================================
  // 8. 제련소 검증 상세 모달 (Action Needed)
  // ==========================================
  function openSmelterVerificationModal(slotId) {
    const slot = state.submissions.find(s => s['Slot ID'] === slotId);
    if (!slot) return;

    state.activeModalSlot = slot;
    const cids = (slot['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);

    let modalEl = document.getElementById('mineralsVerificationModal');
    if (!modalEl) {
      modalEl = document.createElement('div');
      modalEl.id = 'mineralsVerificationModal';
      modalEl.className = 'modal-overlay';
      modalEl.innerHTML = `
        <div class="modal-card" style="max-width:960px; width:95%; max-height:85vh; display:flex; flex-direction:column; padding:18px 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.2rem;">🏭</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);" id="minVerifModalTitle">Reported Smelter Inspection</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('mineralsVerificationModal').style.display='none'">&times;</button>
          </div>
          
          <div id="minVerifModalDisclaimerBar" style="display:none; background:#f8fafc; border:1px solid #cbd5e1; border-radius:6px; padding:8px 12px; margin-top:10px; font-size:0.76rem; color:#475569; line-height:1.45;"></div>

          <div style="display:flex; justify-content:flex-end; align-items:center; gap:6px; margin:10px 0 12px;">
            <button type="button" class="btn-action-soft" id="btnModalFilterAll" onclick="MineralsSuite.filterModalSmelters('all')">All</button>
            <button type="button" class="btn-action-soft" id="btnModalFilterExcept" onclick="MineralsSuite.filterModalSmelters('except-conf')">⚠️ Except Conformant</button>
            <button type="button" class="btn-action-soft" onclick="MineralsSuite.copyModalCidsOnly()" data-tooltip="Copy CIDs to paste directly into MRT">📋 Copy (CIDs only)</button>
            <button type="button" class="btn-action-soft" id="btnCopyModalAll" onclick="MineralsSuite.copyModalAll()" data-tooltip="Copy formatted table for Email / Outlook">📑 Copy (All)</button>
          </div>

          <div class="table-wrapper" style="flex:1; max-height:460px; overflow-y:auto; border:1px solid var(--border-gray); border-radius:6px;">
            <table class="data-table" id="minVerifModalTable" style="table-layout:fixed; width:100%;">
              <colgroup>
                <col style="width: 7%;">
                <col style="width: 10%;">
                <col style="width: 10%;">
                <col style="width: 14%;">
                <col style="width: 12%;">
                <col style="width: 9%;">
                <col style="width: auto;">
                <col style="width: 14%;">
              </colgroup>
              <thead>
                <tr>
                  <th style="text-align:center;">Metal</th>
                  <th style="text-align:center;">CID</th>
                  <th style="text-align:center;">DD Status</th>
                  <th style="text-align:center;">CAHRA Basis</th>
                  <th style="text-align:center;">SoCs</th>
                  <th style="text-align:center;">Level</th>
                  <th style="text-align:left;">Standard Facility Name</th>
                  <th style="text-align:left;">Country</th>
                </tr>
              </thead>
              <tbody id="minVerifModalTableBody"></tbody>
            </table>
          </div>
        </div>
      `;
      document.body.appendChild(modalEl);
    }

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');
    const companyLabel = slot['Company Name (Master)'] || slot['Company Name (Template)'] || 'Supplier';

    document.getElementById('minVerifModalTitle').textContent = `${companyLabel} (${cids.length} Facilities)`;

    const disclaimerBar = document.getElementById('minVerifModalDisclaimerBar');
    if (disclaimerBar) {
      if (isCompleted) {
        disclaimerBar.innerHTML = `
          🔒 <strong>Snapshot Record</strong><br>
          The smelter verification details below reflect the statuses at the time of project completion and may differ from current database records.
        `;
        disclaimerBar.style.display = 'block';
      } else {
        disclaimerBar.style.display = 'none';
      }
    }

    renderModalSmelterRows(slotId, cids, 'all');
    modalEl.style.display = 'flex';
  }

  function filterModalSmelters(type) {
    if (!state.activeModalSlot) return;
    const slotId = state.activeModalSlot['Slot ID'];
    const cids = (state.activeModalSlot['Reported CIDs'] || '').split(',').map(c => c.trim()).filter(Boolean);
    renderModalSmelterRows(slotId, cids, type);
  }

  function renderModalSmelterRows(slotId, cids, filterType) {
    const tbody = document.getElementById('minVerifModalTableBody');
    if (!tbody) return;

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');

    let mappedRows = [];
    if (isCompleted && state.activeProjectData?.snapshot?.slotSmelters?.[slotId]) {
      mappedRows = state.activeProjectData.snapshot.slotSmelters[slotId];
    } else {
      const masterDb = window.consolidatedDataStore || [];
      mappedRows = MineralsParser.mapModalSmelterRows(cids, masterDb);
    }

    let html = '';
    mappedRows.forEach(r => {
      if (filterType === 'except-conf' && r.ddStatus === 'Conformant') return;

      const cleanVal = v => (!v || v === '-') ? '' : v;
      const metal = cleanVal(r.metal);
      const level = cleanVal(r.level);
      const country = cleanVal(r.country);
      const facName = cleanVal(r.facName);
      const socVal = (r.socs && r.socs.startsWith('Y')) ? r.socs : '';

      html += `
        <tr>
          <td class="cell-center">${metal}</td>
          <td class="cell-center" style="font-family:var(--font-mono);">${r.cidHtml}</td>
          <td class="cell-center">${r.statusHtml}</td>
          <td class="cell-center">${r.cahraHtml}</td>
          <td class="cell-center" style="font-size:0.78rem; color:#dc2626; font-weight:600;">${socVal}</td>
          <td class="cell-center" style="font-size:0.76rem; color:#475569;">${level}</td>
          <td class="cell-left cell-ellipsis" title="${facName}">${facName}</td>
          <td class="cell-left cell-ellipsis" title="${country}">${country}</td>
        </tr>      
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="8" style="text-align:center; padding:20px; color:#94a3b8;">No facilities matching filter.</td></tr>`;
  }

  function copyModalCidsOnly() {
    const tbody = document.getElementById('minVerifModalTableBody');
    if (!tbody) return;

    const cids = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const cidEl = tr.querySelector('.clickable-cid');
      const text = cidEl ? (cidEl.getAttribute('data-cid') || cidEl.textContent.trim()) : '';
      if (text && text !== '-') cids.push(text);
    });

    if (!cids.length) {
      showToast('No CIDs to copy.', true);
      return;
    }
    navigator.clipboard.writeText(cids.join('\n')).then(() => showToast(`Copied ${cids.length} CIDs to clipboard!`));
  }

  async function copyModalAll() {
    const tbody = document.getElementById('minVerifModalTableBody');
    if (!tbody) return;

    const rowsData = [];
    const headers = ['Metal', 'CID', 'DD Status', 'CAHRA Basis', 'SoCs', 'Level', 'Standard Facility Name', 'Country'];

    tbody.querySelectorAll('tr').forEach(tr => {
      const cells = [];
      tr.querySelectorAll('td').forEach(td => {
        const badgeEl = td.querySelector('.clickable-cid');
        cells.push(badgeEl && badgeEl.getAttribute('data-cid') ? badgeEl.getAttribute('data-cid') : td.textContent.trim().replace(/\s+/g, ' '));
      });
      if (cells.length === headers.length) rowsData.push(cells);
    });

    if (!rowsData.length) {
      showToast('No inspection records to copy.', true);
      return;
    }

    const btn = document.getElementById('btnCopyModalAll');
    const ok = await MineralsParser.copyFormattedTable(headers, rowsData, btn, '📑 Copy (All)');
    if (ok) showToast(`Copied ${rowsData.length} inspection records!`);
  }

  // ==========================================
  // 8-1. 업로드 서류 원본 검증 드로어 (Read-Only)
  // ==========================================
  async function openMrtInspectionDrawer(slotId) {
    const slot = state.submissions.find(s => s['Slot ID'] === slotId);
    if (!slot) return;

    let drawer = document.getElementById('modalMrtInspectionDrawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'modalMrtInspectionDrawer';
      drawer.className = 'modal-overlay';
      drawer.innerHTML = `
        <div class="modal-card" style="max-width:760px; width:95%; max-height:88vh; display:flex; flex-direction:column; padding:18px 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.2rem;">📑</span>
              <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);" id="lblMrtInspectTitle">Template Declaration Details</h3>
            </div>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMrtInspectionDrawer').style.display='none'">&times;</button>
          </div>
          
          <div id="mrtInspectBodyContainer" style="flex:1; overflow-y:auto; padding-right:4px;">
            <div style="text-align:center; padding:35px; color:#0284c7; font-size:0.85rem;">
              <div style="font-size:1.6rem; margin-bottom:8px;">⏳</div>
              <div>Loading declaration details from server...</div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px; border-top:1px solid var(--border-gray); padding-top:10px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMrtInspectionDrawer').style.display='none'">Close</button>
          </div>
        </div>
      `;
      document.body.appendChild(drawer);
    }

    const tmplName = slot['Company Name (Template)'] || 'Supplier';
    document.getElementById('lblMrtInspectTitle').textContent = `Declaration Inspection: ${tmplName}`;
    const container = document.getElementById('mrtInspectBodyContainer');
    drawer.style.display = 'flex';

    if (!state.activeProjectData || !state.activeProjectData.submissions) {
      try {
        const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
        const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
        const resp = await fetch(GAS_ENDPOINT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            action: 'getProjectJson',
            companyName: companyName,
            projectId: state.activeProjectId
          })
        });
        const res = await resp.json();
        if (res.success && res.data) state.activeProjectData = res.data;
      } catch (err) {
        console.warn('[MineralsSuite] Direct JSON fetch error:', err);
      }
    }

    let slotBackup = state.activeProjectData?.submissions?.[slotId];
    if (!slotBackup && state.activeProjectData?.submissions) {
      const subs = state.activeProjectData.submissions;
      const targetComp = String(slot['Company Name (Template)'] || '').trim().toLowerCase();
      const targetFile = String(slot['File Name'] || '').trim().toLowerCase();

      for (const [key, val] of Object.entries(subs)) {
        const vComp = String(val?.summary?.companyNameTemplate || val?.backup?.declaration?.companyName || '').trim().toLowerCase();
        const vFile = String(val?.fileInfo?.name || val?.summary?.fileName || '').trim().toLowerCase();

        if (key.toLowerCase() === slotId.toLowerCase() || (targetComp && vComp === targetComp) || (targetFile && vFile === targetFile)) {
          slotBackup = val;
          break;
        }
      }
    }

    if (slotBackup && window.MineralsParser && typeof window.MineralsParser.renderMrtInspectionHtml === 'function') {
      container.innerHTML = window.MineralsParser.renderMrtInspectionHtml(slot, slotBackup);
    } else {
      container.innerHTML = `
        <div style="background:#fef2f2; border:1px solid #fecaca; border-radius:6px; padding:16px; font-size:0.82rem; color:#991b1b;">
          <p style="margin:0 0 6px; font-weight:700;">⚠️ Detailed Backup Data Not Found.</p>
          <p style="margin:0 0 10px; font-size:0.78rem; color:#b91c1c; line-height:1.4;">
            This document was uploaded before the backup feature was introduced, or the Drive JSON file is missing.
          </p>
          <div style="background:#ffffff; border:1px solid #fed7aa; border-radius:4px; padding:10px; font-size:0.76rem; color:#334155;">
            <div><strong>Company:</strong> ${slot['Company Name (Template)'] || '-'}</div>
            <div><strong>File:</strong> ${slot['File Name'] || '-'}</div>
            <div><strong>Version:</strong> ${slot['Template Version'] || '-'}</div>
            <div><strong>Slot ID:</strong> <span style="font-family:var(--font-mono);">${slotId}</span></div>
          </div>
        </div>
      `;
    }
  }

  // ==========================================
  // 9. 협력사 마스터 (Vendor Master Pool)
  // ==========================================
  function onVendorFilterChange(field, val) {
    state.filters.vendors[field] = (field === 'status') ? val.trim() : val.toLowerCase().trim();
    state.vendorsCurrentPage = 1;
    clearTimeout(filterDebounceTimers['vendors']);
    filterDebounceTimers['vendors'] = setTimeout(renderVendorMasterTable, 120);
  }

  function resetVendorFilters() {
    state.filters.vendors = { name: '', code: '', status: '', contact: '', remarks: '' };
    state.vendorsCurrentPage = 1;
    document.querySelectorAll('#mineralsVendorFilterRow input').forEach(inp => inp.value = '');
    document.querySelectorAll('#mineralsVendorFilterRow select').forEach(sel => sel.value = '');
    renderVendorMasterTable();
  }

  function getFilteredVendors() {
    const f = state.filters.vendors;
    return state.vendors.filter(v => {
      const vName = v['Vendor Name (Master)'] || v['Master Vendor Name'] || '';
      const vCode = v['Vendor Code (Internal)'] || v['Internal Code'] || '';
      const rawStatus = String(v['Status'] || '').trim();
      const vRemarks = v['Remarks'] || '';

      let contactsArr = [];
      for (let i = 1; i <= 4; i++) {
        const name = v[`Contact ${i} Name`];
        const email = v[`Contact ${i} Email`];
        if (name || email) contactsArr.push(`${name || ''} ${email || ''}`);
      }
      const contactsText = contactsArr.join(' ');

      if (f.name && !vName.toLowerCase().includes(f.name)) return false;
      if (f.code && !vCode.toLowerCase().includes(f.code)) return false;

      if (f.status) {
        if (f.status === '(blank)') {
          if (rawStatus && rawStatus !== '-') return false;
        } else if (rawStatus.toLowerCase() !== f.status.toLowerCase()) {
          return false;
        }
      }

      if (f.contact && !contactsText.toLowerCase().includes(f.contact)) return false;
      if (f.remarks && !vRemarks.toLowerCase().includes(f.remarks)) return false;
      return true;
    });
  }

  function exportVendorMaster() {
    const matched = getFilteredVendors();
    if (!matched || matched.length === 0) {
      showToast('No matching vendor data to export.', true);
      return;
    }
    try {
      MineralsParser.exportVendorsToExcel(matched, 'Vendor_Master');
      showToast(`Exported ${matched.length} vendor(s) to Excel.`);
    } catch (err) {
      showToast(`[Export Error] ${err.message}`, true);
    }
  }

  function triggerVendorBulkUpload() {
    let input = document.getElementById('mineralsVendorFileInput');
    if (!input) {
      input = document.createElement('input');
      input.type = 'file';
      input.id = 'mineralsVendorFileInput';
      input.accept = '.xlsx, .xls';
      input.style.display = 'none';
      input.onchange = (e) => MineralsSuite.handleVendorFileInputChange(e);
      document.body.appendChild(input);
    }
    input.value = '';
    input.click();
  }

  async function handleVendorFileInputChange(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    const file = files[0];

    updateSyncBadge('Parsing Vendors...');
    try {
      const parsed = await MineralsParser.parseVendorMasterFile(file, state.vendors);
      const { toInsert, toUpdate, skipped, allPayloadVendors } = parsed;

      if (!allPayloadVendors || allPayloadVendors.length === 0) {
        showToast('No valid vendor records found to upload.', true);
        return;
      }

      const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
      const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();

      allPayloadVendors.forEach(pv => {
        const existingIdx = state.vendors.findIndex(v => v['Vendor ID'] === pv.id);
        const contacts = pv.contacts || [];
        const vendorObj = {
          'Company Name': companyName,
          'Vendor ID': pv.id,
          'Vendor Name (Master)': pv.name,
          'Master Vendor Name': pv.name,
          'Vendor Code (Internal)': pv.code,
          'Internal Code': pv.code,
          'Status': pv.status,
          'Contact 1 Name': contacts[0]?.name || '',
          'Contact 1 Email': contacts[0]?.email || '',
          'Contact 2 Name': contacts[1]?.name || '',
          'Contact 2 Email': contacts[1]?.email || '',
          'Contact 3 Name': contacts[2]?.name || '',
          'Contact 3 Email': contacts[2]?.email || '',
          'Contact 4 Name': contacts[3]?.name || '',
          'Contact 4 Email': contacts[3]?.email || '',
          'Remarks': pv.remarks || ''
        };

        if (existingIdx !== -1) {
          state.vendors[existingIdx] = vendorObj;
        } else {
          state.vendors.push(vendorObj);
        }
      });

      renderVendorMasterTable();
      updateSyncBadge('Saving to Cloud...');

      const resp = await fetch(GAS_ENDPOINT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({
          action: 'bulkSaveVendors',
          companyName: companyName,
          vendors: allPayloadVendors
        })
      });

      const res = await resp.json();
      if (!res.success) throw new Error(res.error || 'Server Save Error');

      const insCount = toInsert.length;
      const updCount = toUpdate.length;
      const skipCount = skipped.length;

      let msg = `Bulk Upload Complete: Added ${insCount}, Updated ${updCount}`;
      if (skipCount > 0) msg += `, Skipped ${skipCount}`;
      showToast(msg);
      updateSyncBadge('Saved');

      if (skipCount > 0) {
        console.warn('[Vendor Bulk Upload Skipped Rows]', skipped);
      }
    } catch (err) {
      showToast(`[Upload Error] ${err.message}`, true);
      updateSyncBadge('Sync Error');
    } finally {
      e.target.value = '';
    }
  }

  function renderVendorMasterTable() {
    const tbody = document.getElementById('mineralsVendorTableBody');
    if (!tbody) return;

    const f = state.filters.vendors;
    const optStatuses = new Set();

    state.vendors.forEach(v => {
      const st = String(v['Status'] || '').trim();
      if (!st || st === '-') optStatuses.add('(blank)');
      else optStatuses.add(st);
    });

    populateSelectOptions('filterVendor_status', optStatuses, f.status);

    const matchedVendors = getFilteredVendors();

    state.filteredVendorsCount = matchedVendors.length;
    const totalPages = Math.max(1, Math.ceil(state.filteredVendorsCount / state.vendorsPageSize));
    if (state.vendorsCurrentPage > totalPages) state.vendorsCurrentPage = totalPages;
    if (state.vendorsCurrentPage < 1) state.vendorsCurrentPage = 1;

    const startIdx = (state.vendorsCurrentPage - 1) * state.vendorsPageSize;
    const pagedVendors = matchedVendors.slice(startIdx, startIdx + state.vendorsPageSize);

    let html = '';

    pagedVendors.forEach(v => {
      const vId = v['Vendor ID'];
      const vName = v['Vendor Name (Master)'] || v['Master Vendor Name'] || '';
      const vCode = v['Vendor Code (Internal)'] || v['Internal Code'] || '';
      const rawStatus = String(v['Status'] || '').trim();
      const vRemarks = v['Remarks'] || '';

      let contactsHtml = '';
      for (let i = 1; i <= 4; i++) {
        const name = v[`Contact ${i} Name`];
        const email = v[`Contact ${i} Email`];
        if (name || email) {
          contactsHtml += `
            <div style="font-size:0.75rem; line-height:1.4;">
              <span style="color:#334155;">${name || 'Contact'}:</span>
              ${email ? `<a href="javascript:void(0)" onclick="MineralsSuite.copyEmail('${email}')" title="Click to copy email" style="font-family:var(--font-mono); color:#0284c7; text-decoration:underline;">${email}</a>` : ''}
            </div>
          `;
        }
      }

      let statusHtml = '';
      if (rawStatus === 'Active') statusHtml = '<span style="color:var(--primary-green); font-weight:500;">Active</span>';
      else if (rawStatus === 'Inactive') statusHtml = '<span style="color:#94a3b8;">Inactive</span>';
      else if (rawStatus && rawStatus !== '-') statusHtml = `<span style="color:#475569;">${rawStatus}</span>`;

      const codeClean = (vCode && vCode !== '-') ? vCode : '';
      const remarksClean = (vRemarks && vRemarks !== '-') ? vRemarks : '';

      html += `
        <tr>
          <td class="cell-left" style="padding-left:12px; color:#0f172a;">${vName}</td>
          <td class="cell-center" style="font-family:var(--font-mono); font-size:0.76rem; color:#475569;">${codeClean}</td>
          <td class="cell-center" style="font-size:0.76rem;">${statusHtml}</td>
          <td class="cell-left">${contactsHtml}</td>
          <td class="cell-left cell-ellipsis" title="${remarksClean}">${remarksClean}</td>
          <td class="cell-center">
            <button type="button" class="btn-row-action btn-edit" onclick="MineralsSuite.openEditVendorModal('${vId}')" title="Edit Vendor Details">📝</button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html || `<tr><td colspan="6" style="text-align:center; padding:24px; color:#94a3b8;">No matching vendors found.</td></tr>`;
    
    const badgeTable = document.getElementById('mineralsVendorTableBadge');
    if (badgeTable) badgeTable.textContent = `${state.filteredVendorsCount} of ${state.vendors.length} vendors`;

    const pageInfo = document.getElementById('mineralsVendorsPageInfoDisplay');
    if (pageInfo) pageInfo.textContent = `Page ${state.vendorsCurrentPage} of ${totalPages}`;

    const btnPrev = document.getElementById('btnMineralsVendorsPrevPage');
    const btnNext = document.getElementById('btnMineralsVendorsNextPage');
    if (btnPrev) btnPrev.disabled = (state.vendorsCurrentPage <= 1);
    if (btnNext) btnNext.disabled = (state.vendorsCurrentPage >= totalPages);
  }

  function copyEmail(email) {
    if (!email) return;
    navigator.clipboard.writeText(email).then(() => showToast(`Copied to clipboard: ${email}`));
  }

  function openAddVendorModal() {
    editingVendorId = null;
    openVendorFormModal('🏭 Add Vendor', '', '', 'Active', '', '', '', '', '', '', '', '', '');
  }

  function openEditVendorModal(vId) {
    const v = state.vendors.find(item => item['Vendor ID'] === vId);
    if (!v) return;

    editingVendorId = vId;
    openVendorFormModal(
      '📝 Edit Vendor',
      v['Vendor Name (Master)'] || v['Master Vendor Name'] || '',
      v['Vendor Code (Internal)'] || v['Internal Code'] || '',
      v['Status'] || 'Active',
      v['Contact 1 Name'] || '',
      v['Contact 1 Email'] || '',
      v['Contact 2 Name'] || '',
      v['Contact 2 Email'] || '',
      v['Contact 3 Name'] || '',
      v['Contact 3 Email'] || '',
      v['Contact 4 Name'] || '',
      v['Contact 4 Email'] || '',
      v['Remarks'] || ''
    );
  }

  function openVendorFormModal(title, name, code, status, c1Name, c1Email, c2Name, c2Email, c3Name, c3Email, c4Name, c4Email, remarks) {
    const isEdit = Boolean(editingVendorId);

    let modal = document.getElementById('modalMineralsVendorForm');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'modalMineralsVendorForm';
      modal.className = 'modal-overlay';
      modal.innerHTML = `
        <div class="modal-card" style="max-width:540px; width:95%; max-height:90vh; display:flex; flex-direction:column; padding:18px 22px;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid var(--border-gray); padding-bottom:10px;">
            <h3 style="margin:0; font-size:1.05rem; font-weight:600; color:var(--text-main);" id="lblVendorFormTitle">Vendor Form</h3>
            <button type="button" class="drawer-close" onclick="document.getElementById('modalMineralsVendorForm').style.display='none'">&times;</button>
          </div>
          
          <div style="overflow-y:auto; padding-right:4px; display:flex; flex-direction:column; gap:10px;">
            <div style="display:flex; gap:8px;">
              <div class="modal-field" style="flex:7;">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                  <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted);">Vendor Name (Master)</label>
                  <span id="badgeVendorNameLock" style="display:none; font-size:0.70rem; color:#94a3b8;">🔒 Locked</span>
                </div>
                <input type="text" id="inpVendorFormName" class="auth-input-field">
              </div>
              <div class="modal-field" style="flex:5;">
                <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); margin-bottom:2px; display:block;">Vendor Code (Internal)</label>
                <input type="text" id="inpVendorFormCode" class="auth-input-field">
              </div>
            </div>

            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); margin-bottom:2px; display:block;">Status</label>
              <select id="selVendorFormStatus" class="page-select" style="width:100%; height:34px; padding:4px 8px;">
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>

            <div style="background:var(--bg-slate); border:1px solid var(--border-gray); border-radius:6px; padding:10px 12px; display:flex; flex-direction:column; gap:8px;">
              <span style="font-size:0.78rem; font-weight:600; color:#334155;">Contacts Directory (Up to 4 Persons)</span>
              <div style="display:flex; gap:6px; align-items:center;">
                <span style="font-size:0.74rem; color:#64748b; width:45px;">#1</span>
                <input type="text" id="inpVendorFormC1Name" class="auth-input-field" placeholder="Name" style="flex:4; background:#fff;">
                <input type="email" id="inpVendorFormC1Email" class="auth-input-field" placeholder="email@domain.com" style="flex:6; background:#fff;">
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <span style="font-size:0.74rem; color:#64748b; width:45px;">#2</span>
                <input type="text" id="inpVendorFormC2Name" class="auth-input-field" placeholder="Name" style="flex:4; background:#fff;">
                <input type="email" id="inpVendorFormC2Email" class="auth-input-field" placeholder="email@domain.com" style="flex:6; background:#fff;">
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <span style="font-size:0.74rem; color:#64748b; width:45px;">#3</span>
                <input type="text" id="inpVendorFormC3Name" class="auth-input-field" placeholder="Name" style="flex:4; background:#fff;">
                <input type="email" id="inpVendorFormC3Email" class="auth-input-field" placeholder="email@domain.com" style="flex:6; background:#fff;">
              </div>
              <div style="display:flex; gap:6px; align-items:center;">
                <span style="font-size:0.74rem; color:#64748b; width:45px;">#4</span>
                <input type="text" id="inpVendorFormC4Name" class="auth-input-field" placeholder="Name" style="flex:4; background:#fff;">
                <input type="email" id="inpVendorFormC4Email" class="auth-input-field" placeholder="email@domain.com" style="flex:6; background:#fff;">
              </div>
            </div>

            <div class="modal-field">
              <label style="font-size:0.78rem; font-weight:500; color:var(--text-muted); margin-bottom:2px; display:block;">Remarks</label>
              <input type="text" id="inpVendorFormRemarks" class="auth-input-field">
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:14px; border-top:1px solid var(--border-gray); padding-top:10px;">
            <button type="button" class="btn-act" onclick="document.getElementById('modalMineralsVendorForm').style.display='none'">Cancel</button>
            <button type="button" class="btn-act btn-save-all" onclick="MineralsSuite.submitVendorFormModal()">Save Vendor</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);
    }

    document.getElementById('lblVendorFormTitle').textContent = title;
    
    const inpName = document.getElementById('inpVendorFormName');
    const lockBadge = document.getElementById('badgeVendorNameLock');
    inpName.value = name;
    if (isEdit) {
      inpName.readOnly = true;
      inpName.style.background = '#f1f5f9';
      inpName.style.color = '#475569';
      inpName.style.cursor = 'not-allowed';
      if (lockBadge) lockBadge.style.display = 'inline';
    } else {
      inpName.readOnly = false;
      inpName.style.background = '#ffffff';
      inpName.style.color = 'inherit';
      inpName.style.cursor = 'auto';
      if (lockBadge) lockBadge.style.display = 'none';
    }

    document.getElementById('inpVendorFormCode').value = code;
    document.getElementById('selVendorFormStatus').value = status;
    document.getElementById('inpVendorFormC1Name').value = c1Name;
    document.getElementById('inpVendorFormC1Email').value = c1Email;
    document.getElementById('inpVendorFormC2Name').value = c2Name;
    document.getElementById('inpVendorFormC2Email').value = c2Email;
    document.getElementById('inpVendorFormC3Name').value = c3Name;
    document.getElementById('inpVendorFormC3Email').value = c3Email;
    document.getElementById('inpVendorFormC4Name').value = c4Name;
    document.getElementById('inpVendorFormC4Email').value = c4Email;
    document.getElementById('inpVendorFormRemarks').value = remarks;

    modal.style.display = 'flex';
  }

  function submitVendorFormModal() {
    const vName = document.getElementById('inpVendorFormName')?.value.trim();
    const vCode = document.getElementById('inpVendorFormCode')?.value.trim();
    const vStatus = document.getElementById('selVendorFormStatus')?.value || 'Active';
    const c1Name = document.getElementById('inpVendorFormC1Name')?.value.trim();
    const c1Email = document.getElementById('inpVendorFormC1Email')?.value.trim();
    const c2Name = document.getElementById('inpVendorFormC2Name')?.value.trim();
    const c2Email = document.getElementById('inpVendorFormC2Email')?.value.trim();
    const c3Name = document.getElementById('inpVendorFormC3Name')?.value.trim();
    const c3Email = document.getElementById('inpVendorFormC3Email')?.value.trim();
    const c4Name = document.getElementById('inpVendorFormC4Name')?.value.trim();
    const c4Email = document.getElementById('inpVendorFormC4Email')?.value.trim();
    const vRemarks = document.getElementById('inpVendorFormRemarks')?.value.trim();

    if (!vName) {
      showToast('Please enter vendor name.', true);
      return;
    }

    // [중복 검사 1순위: Vendor Code]
    if (vCode) {
      const lowerCode = vCode.toLowerCase();
      const duplicateCodeVendor = state.vendors.find(v => {
        if (editingVendorId && v['Vendor ID'] === editingVendorId) return false;
        const code = String(v['Vendor Code (Internal)'] || v['Internal Code'] || '').trim().toLowerCase();
        return code && code === lowerCode;
      });

      if (duplicateCodeVendor) {
        const existingName = duplicateCodeVendor['Vendor Name (Master)'] || duplicateCodeVendor['Master Vendor Name'] || 'Existing Vendor';
        showToast(`Vendor Code [${vCode}] is already in use by [${existingName}].`, true);
        document.getElementById('inpVendorFormCode')?.focus();
        return;
      }
    }

    // [중복 검사 2순위: Vendor Name (신규 등록 시)]
    if (!editingVendorId) {
      const lowerName = vName.toLowerCase();
      const isDuplicateName = state.vendors.some(v => {
        const name = String(v['Vendor Name (Master)'] || v['Master Vendor Name'] || '').trim().toLowerCase();
        return name === lowerName;
      });
      if (isDuplicateName) {
        showToast(`Vendor [${vName}] already exists in master pool.`, true);
        document.getElementById('inpVendorFormName')?.focus();
        return;
      }
    }

    const profile = typeof getStoredUserProfile === 'function' ? getStoredUserProfile() : null;
    const companyName = String(profile?.company || profile?.companyName || 'a2MDS Consulting').trim();
    const vendorId = editingVendorId || `vnd-${Date.now()}`;

    let existing = state.vendors.find(v => v['Vendor ID'] === vendorId);
    if (existing) {
      existing['Vendor Name (Master)'] = vName;
      existing['Master Vendor Name'] = vName;
      existing['Vendor Code (Internal)'] = vCode;
      existing['Internal Code'] = vCode;
      existing['Status'] = vStatus;
      existing['Contact 1 Name'] = c1Name;
      existing['Contact 1 Email'] = c1Email;
      existing['Contact 2 Name'] = c2Name;
      existing['Contact 2 Email'] = c2Email;
      existing['Contact 3 Name'] = c3Name;
      existing['Contact 3 Email'] = c3Email;
      existing['Contact 4 Name'] = c4Name;
      existing['Contact 4 Email'] = c4Email;
      existing['Remarks'] = vRemarks;
    } else {
      state.vendors.push({
        'Company Name': companyName,
        'Vendor ID': vendorId,
        'Vendor Name (Master)': vName,
        'Master Vendor Name': vName,
        'Vendor Code (Internal)': vCode,
        'Internal Code': vCode,
        'Status': vStatus,
        'Contact 1 Name': c1Name,
        'Contact 1 Email': c1Email,
        'Contact 2 Name': c2Name,
        'Contact 2 Email': c2Email,
        'Contact 3 Name': c3Name,
        'Contact 3 Email': c3Email,
        'Contact 4 Name': c4Name,
        'Contact 4 Email': c4Email,
        'Remarks': vRemarks
      });
    }

    renderVendorMasterTable();
    document.getElementById('modalMineralsVendorForm').style.display = 'none';
    showToast(editingVendorId ? 'Vendor updated successfully.' : `Vendor registered: ${vName}`);

    fetch(GAS_ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'saveVendor',
        companyName: companyName,
        vendor: {
          id: vendorId,
          name: vName,
          code: vCode,
          status: vStatus,
          contacts: [
            { name: c1Name, email: c1Email },
            { name: c2Name, email: c2Email },
            { name: c3Name, email: c3Email },
            { name: c4Name, email: c4Email }
          ],
          remarks: vRemarks
        }
      })
    }).catch(e => console.warn('Vendor sync error:', e));

    editingVendorId = null;
  }

  function goToVendorsPage(page) {
    const totalPages = Math.max(1, Math.ceil(state.filteredVendorsCount / state.vendorsPageSize));
    if (page < 1 || page > totalPages) return;
    state.vendorsCurrentPage = page;
    renderVendorMasterTable();
  }

  function changeVendorsPageSize(newSize) {
    state.vendorsPageSize = parseInt(newSize, 10) || 50;
    state.vendorsCurrentPage = 1;
    renderVendorMasterTable();
  }

  // ==========================================
  // [다중 선택 드롭다운 엔진]
  // ==========================================
  function toggleDropdown(tableType, key) {
    const dd = document.getElementById(`${tableType}MsDropdown_${key}`);
    const btn = document.getElementById(`${tableType}MsBtn_${key}`);
    if (!dd || !btn) return;

    const isShowing = dd.classList.contains('show');
    document.querySelectorAll('.multiselect-dropdown.show').forEach(d => d.classList.remove('show'));

    if (!isShowing) {
      populateSingleDropdown(tableType, key);
      const r = btn.getBoundingClientRect();
      let top = (r.bottom + 2 + 250 > window.innerHeight && r.top > 250) ? r.top - 252 : r.bottom + 2;
      let left = (r.left + 240 > window.innerWidth) ? Math.max(10, window.innerWidth - 250) : r.left;
      dd.style.top = `${top}px`;
      dd.style.left = `${left}px`;
      dd.classList.add('show');
    }
  }

  function populateSingleDropdown(tableType, key) {
    const dd = document.getElementById(`${tableType}MsDropdown_${key}`);
    if (!dd) return;

    const currentProject = state.projects.find(p => p['Project ID'] === state.activeProjectId);
    const isCompleted = (currentProject?.['Status'] === 'Completed');
    const masterDb = window.consolidatedDataStore || [];

    let rowsSource = [];
    if (tableType === 'all') {
      rowsSource = (isCompleted && state.activeProjectData?.snapshot?.allSmelters)
        ? state.activeProjectData.snapshot.allSmelters
        : MineralsParser.aggregateAllSmelters(state.submissions, state.activeProjectId, masterDb).rows;
    } else {
      rowsSource = (isCompleted && state.activeProjectData?.snapshot?.uniqueSmelters)
        ? state.activeProjectData.snapshot.uniqueSmelters
        : MineralsParser.aggregateUniqueSmelters(state.submissions, state.activeProjectId, masterDb).rows;
    }

    const f = (tableType === 'all') ? state.filters.allSmelters : state.filters.uniqueSmelters;
    const currentSet = f[key] || new Set();

    let rawList = [];
    rowsSource.forEach(r => {
      if (key === 'supplier') {
        if (tableType === 'all' && r.supplierLabel) rawList.push(r.supplierLabel);
        else if (tableType === 'unique' && Array.isArray(r.suppliersArr)) r.suppliersArr.forEach(s => rawList.push(s));
      } else if (key === 'status') {
        rawList.push(r.ddStatus);
      } else if (key === 'cahra') {
        rawList.push(r.cahra);
      } else if (key === 'socs') {
        rawList.push(r.socs);
      } else if (key === 'level') {
        rawList.push(r.level);
      }
    });

    const uniqueSet = new Set();
    let hasEmpty = false;

    rawList.forEach(v => {
      const s = String(v || '').trim();
      if (!s) {
        hasEmpty = true;
      } else {
        uniqueSet.add(s);
      }
    });

    const unique = Array.from(uniqueSet).sort((a, b) => {
      if (a === '-') return -1;
      if (b === '-') return 1;
      return a.localeCompare(b);
    });
    if (hasEmpty) {
      unique.unshift('(blank)');
    }

    const validSet = new Set(unique);
    for (const v of currentSet) {
      if (v === '(blank)' && !hasEmpty) currentSet.delete(v);
      else if (v !== '(blank)' && !uniqueSet.has(v)) currentSet.delete(v);
    }

    const txt = document.getElementById(`${tableType}MsText_${key}`);
    if (txt) txt.textContent = currentSet.size ? `${currentSet.size} selected` : 'All';

    let itemsHtml = unique.map(v => {
      let lbl = v;
      if (v === '(blank)') {
        lbl = '<span style="color:#94a3b8; font-weight:500;">(blank)</span>';
      } else if (key === 'status') {
        lbl = MineralsParser.getStatusBadge(v);
      } else if (key === 'cahra') {
        lbl = MineralsParser.getCahraBadge(v);
      } else if (key === 'socs' && v.startsWith('Y')) {
        lbl = `<span style="color:#dc2626; font-weight:600;">${v}</span>`;
      }
      return `
        <label class="multiselect-item">
          <input type="checkbox" value="${v}" ${currentSet.has(v) ? 'checked' : ''} onchange="MineralsSuite.toggleDropdownItem('${tableType}', '${key}', '${v.replace(/'/g, "\\'")}', this.checked)">
          <span>${lbl}</span>
        </label>
      `;
    }).join('');

    dd.innerHTML = `
      <label class="multiselect-item">
        <input type="checkbox" id="${tableType}ChkAll_${key}" ${!currentSet.size ? 'checked' : ''} onchange="MineralsSuite.selectAllDropdown('${tableType}', '${key}', this)">
        <span>(Select All)</span>
      </label>
      <hr style="margin:3px 0; border:0; border-top:1px solid #e5e7eb;">
      ${itemsHtml}
    `;
  }

  function selectAllDropdown(tableType, key, chk) {
    const f = (tableType === 'all') ? state.filters.allSmelters : state.filters.uniqueSmelters;
    if (!f[key]) f[key] = new Set();
    f[key].clear();

    document.querySelectorAll(`#${tableType}MsDropdown_${key} input[type="checkbox"]`).forEach(c => {
      if (c !== chk) c.checked = false;
    });

    const txt = document.getElementById(`${tableType}MsText_${key}`);
    if (txt) txt.textContent = 'All';

    if (tableType === 'all') renderAllSmeltersTable();
    else renderUniqueSmeltersTable();
  }

  function toggleDropdownItem(tableType, key, val, checked) {
    const f = (tableType === 'all') ? state.filters.allSmelters : state.filters.uniqueSmelters;
    if (!f[key]) f[key] = new Set();

    if (checked) f[key].add(val);
    else f[key].delete(val);

    const allChk = document.getElementById(`${tableType}ChkAll_${key}`);
    if (allChk) allChk.checked = !f[key].size;

    const txt = document.getElementById(`${tableType}MsText_${key}`);
    if (txt) txt.textContent = f[key].size ? `${f[key].size} selected` : 'All';

    if (tableType === 'all') renderAllSmeltersTable();
    else renderUniqueSmeltersTable();
  }

  // ==========================================
  // Public Interface
  // ==========================================
  return {
    init: init,
    switchSubTab: switchSubTab,
    switchProjectSubTab: switchProjectSubTab,
    goToProjectsDirectory: goToProjectsDirectory,
    openProjectWorkspace: openProjectWorkspace,
    renderProjectsDirectory: renderProjectsDirectory,
    onProjectFilterChange: onProjectFilterChange,
    resetProjectFilters: resetProjectFilters,
    goToProjectsPage: goToProjectsPage,
    changeProjectsPageSize: changeProjectsPageSize,
    getProjectsCurrentPage: () => state.projectsCurrentPage,
    renderSlotsTable: renderSlotsTable,
    onSlotFilterChange: onSlotFilterChange,
    resetSlotFilters: resetSlotFilters,
    renderAllSmeltersTable: renderAllSmeltersTable,
    onAllSmeltersFilterChange: onAllSmeltersFilterChange,
    resetAllSmeltersFilters: resetAllSmeltersFilters,
    filterAllSmeltersExceptConf: filterAllSmeltersExceptConf,
    exportAllSmeltersExcel: exportAllSmeltersExcel,
    renderUniqueSmeltersTable: renderUniqueSmeltersTable,
    onUniqueSmeltersFilterChange: onUniqueSmeltersFilterChange,
    resetUniqueSmeltersFilters: resetUniqueSmeltersFilters,
    filterUniqueSmeltersExceptConf: filterUniqueSmeltersExceptConf,
    toggleUniqueChangedOnlyFilter: toggleUniqueChangedOnlyFilter,
    exportUniqueSmeltersExcel: exportUniqueSmeltersExcel,
    copyUniqueCidsOnly: copyUniqueCidsOnly,
    copyUniqueSmeltersAll: copyUniqueSmeltersAll,
    renderVendorMasterTable: renderVendorMasterTable,
    onVendorFilterChange: onVendorFilterChange,
    resetVendorFilters: resetVendorFilters,
    goToVendorsPage: goToVendorsPage,
    changeVendorsPageSize: changeVendorsPageSize,
    getVendorsCurrentPage: () => state.vendorsCurrentPage,
    exportVendorMaster: exportVendorMaster,
    triggerVendorBulkUpload: triggerVendorBulkUpload,
    handleVendorFileInputChange: handleVendorFileInputChange,
    handleFileInputChange: handleFileInputChange,
    triggerSlotFileUpload: triggerSlotFileUpload,
    openSmelterVerificationModal: openSmelterVerificationModal,
    filterModalSmelters: filterModalSmelters,
    copyModalCidsOnly: copyModalCidsOnly,
    copyModalAll: copyModalAll,
    copyEmail: copyEmail,
    openCreateProjectModal: openCreateProjectModal,
    submitCreateProject: submitCreateProject,
    openEditProjectModal: openEditProjectModal,
    submitEditProjectModal: submitEditProjectModal,
    editSlotMasterMapping: editSlotMasterMapping,
    filterMappingVendorList: filterMappingVendorList,
    selectMappingVendor: selectMappingVendor,
    clearMappingSelection: clearMappingSelection,
    openEditRemarksModal: openEditRemarksModal,
    submitEditRemarksModal: submitEditRemarksModal,
    openAddSlotModal: openAddSlotModal,
    filterAddSlotVendorList: filterAddSlotVendorList,
    toggleAddSlotSelectAll: toggleAddSlotSelectAll,
    updateAddSlotSelectedCount: updateAddSlotSelectedCount,
    submitAddSlotModal: submitAddSlotModal,
    deleteProject: deleteProject,
    deleteSlot: deleteSlot,
    openAddVendorModal: openAddVendorModal,
    openEditVendorModal: openEditVendorModal,
    submitVendorFormModal: submitVendorFormModal,
    openMrtInspectionDrawer: openMrtInspectionDrawer,
    getActiveProjectData: () => state.activeProjectData,
    toggleDropdown: toggleDropdown,
    toggleDropdownItem: toggleDropdownItem,
    selectAllDropdown: selectAllDropdown
  };
})();

window.initMineralsModule = function () {
  MineralsSuite.init();
};