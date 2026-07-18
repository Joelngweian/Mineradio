(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function normalizeRotateMode(mode) {
    return /^(off|loop|shuffle)$/.test(String(mode || '')) ? String(mode) : 'off';
  }

  function normalizeRotateMinutes(value) {
    var minutes = Math.round(Number(value) || 5);
    return Math.max(1, Math.min(60, minutes));
  }

  function normalizeRotateItems(list, normalizeMedia) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.forEach(function(item) {
      var media = typeof normalizeMedia === 'function' ? normalizeMedia(item) : item;
      if (media && media.src) out.push(media);
    });
    return out.slice(0, 60);
  }

  function normalizeRotateTransition(transition) {
    return /^(none|fade|crossfade|zoom|slide)$/.test(String(transition || '')) ? String(transition) : 'crossfade';
  }

  function transitionLabel(transition) {
    return ({
      none: '无',
      fade: '淡入淡出',
      crossfade: '交叉淡化',
      zoom: '缩放',
      slide: '滑入'
    })[normalizeRotateTransition(transition)] || '交叉淡化';
  }

  global.MineradioModules.wallpaperState = {
    normalizeRotateMode: normalizeRotateMode,
    normalizeRotateMinutes: normalizeRotateMinutes,
    normalizeRotateItems: normalizeRotateItems,
    normalizeRotateTransition: normalizeRotateTransition,
    transitionLabel: transitionLabel
  };
})(typeof window !== 'undefined' ? window : globalThis);
