/* =========================================================================
   GOOGLE SHEETS CLOUD SYNC & CACHE HANDSHAKE
   ========================================================================= */
async function fetchGadslData(authOverride = '', forceReload = false) {
  const key = authOverride || getStoredAuthKey();
  if (!key) return;

  const syncBanner = document.getElementById('gadslSyncBanner');
  const btnReload = document.getElementById('btnSyncCloudGadsl');
  const casBadge = document.getElementById('casBadge');
  const revBadge = document.getElementById('revBadge');
  const analyzedLabel = document.getElementById('gadslAnalyzedDateLabel');

  // 1. 동기화 중 UI 상태 표시
  if (syncBanner) syncBanner.style.display = 'flex';
  if (btnReload) { btnReload.textContent = '⏳ Syncing...'; btnReload.disabled = true; }
  if (casBadge && !gadslCasData.length) casBadge.textContent = 'Syncing...';
  if (revBadge && !gadslRevisionDetails.length) revBadge.textContent = 'Syncing...';
  if (analyzedLabel && !gadslAnalyzedDateStr) analyzedLabel.textContent = 'Syncing...';

  try {
    const payload = {
      auth: key,
      action: 'fetch_data',
      clientLastUpdated: forceReload ? '' : gadslAnalyzedDateStr
    };

    const resp = await fetch(URL_GADSL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });
    const res = await resp.json();

    if (res?.status === 'not_modified') {
      return res;
    }

    if (res?.status === 'success' && res.data && res.data.casData?.length) {
      const d = res.data;
      gadslCasData = d.casData || [];
      gadslRawEntriesCount = d.rawEntriesCount || d.casData.length;
      gadslRevisionDetails = (d.revisionDetails || []).map(r => ({
        ...r,
        firstAdded: normalizeDateStr(r.firstAdded),
        lastRevised: normalizeDateStr(r.lastRevised)
      }));
      gadslDocVersionStr = d.docVersionStr || '2026 Version 1.0';
      gadslLatestRevDate = normalizeDateStr(d.latestRevDate) || '1-Mar-2026';
      gadslAnalyzedDateStr = res.lastUpdated || d.analyzedDateStr || getKstTimestampWithSeconds();

      buildRevisionIntelligenceSummary();

      await saveGadslToDB({
        ...d,
        revisionSummary: gadslRevisionSummary,
        revisionDetails: gadslRevisionDetails,
        latestRevDate: gadslLatestRevDate,
        analyzedDateStr: gadslAnalyzedDateStr
      });
      renderGadslAllViews();
    }
    return res;
  } catch (e) {
    if (casBadge && !gadslCasData.length) casBadge.textContent = 'Sync Failed';
  } finally {
    // 2. 동기화 완료 후 UI 복구
    if (syncBanner) syncBanner.style.display = 'none';
    if (btnReload) { btnReload.textContent = '🔄 Reload'; btnReload.disabled = false; }
  }
}
