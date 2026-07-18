(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function normalizeVersionText(value) {
    return String(value || '').trim().replace(/^v/i, '');
  }

  function applyAppVersionState(state, data) {
    state = state || {};
    data = data || {};
    var version = normalizeVersionText(data.version || data.currentVersion || data.latestVersion);
    if (!version) return state;
    state.currentVersion = version;
    if (!state.updateAvailable) state.version = version;
    if (data.update && data.update.preview != null) state.preview = !!data.update.preview;
    return state;
  }

  async function refreshAppVersionState(state, apiJson, onApply) {
    if (typeof apiJson !== 'function') return state;
    var data = await apiJson('/api/app/version?t=' + Date.now());
    var next = applyAppVersionState(state, data);
    if (typeof onApply === 'function') onApply(next, data);
    return next;
  }

  global.MineradioModules.appVersion = {
    normalizeVersionText: normalizeVersionText,
    applyAppVersionState: applyAppVersionState,
    refreshAppVersionState: refreshAppVersionState
  };
})(typeof window !== 'undefined' ? window : globalThis);
