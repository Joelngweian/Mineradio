(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function formatUpdateBytes(bytes) {
    bytes = Number(bytes) || 0;
    if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2).replace(/\.00$/, '') + ' GB';
    if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '') + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  function formatUpdateSpeed(bytesPerSecond) {
    bytesPerSecond = Number(bytesPerSecond) || 0;
    return bytesPerSecond > 0 ? (formatUpdateBytes(bytesPerSecond) + '/s') : '';
  }

  function helperFn(helpers, name, fallback) {
    return helpers && typeof helpers[name] === 'function' ? helpers[name] : fallback;
  }

  function fallbackEscHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function progressDetailText(state, helpers) {
    state = state || {};
    helpers = helpers || {};
    var bytes = helperFn(helpers, 'formatUpdateBytes', formatUpdateBytes);
    var speed = helperFn(helpers, 'formatUpdateSpeed', formatUpdateSpeed);
    var parts = [];
    if (state.attempts > 1 && state.attempt > 0) parts.push('线路 ' + state.attempt + '/' + state.attempts);
    if (state.sourceLabel) parts.push(state.sourceLabel);
    if (state.received) {
      parts.push(state.total > 0 ? (bytes(state.received) + ' / ' + bytes(state.total)) : ('已下载 ' + bytes(state.received)));
    }
    if (state.speedBps) parts.push(speed(state.speedBps));
    if (state.etaSeconds) parts.push('约 ' + state.etaSeconds + ' 秒');
    return parts.filter(Boolean).join(' · ');
  }

  function renderUpdateNotesHtml(notes, escHtml) {
    var esc = typeof escHtml === 'function' ? escHtml : fallbackEscHtml;
    var items = Array.isArray(notes) && notes.length ? notes : ['更新检测已就绪'];
    return items.map(function(text, i) {
      return '<div class="update-item"><span class="update-item-dot" data-index="' + String(i + 1).padStart(2, '0') + '"></span><div class="update-item-text">' + esc(text) + '</div></div>';
    }).join('');
  }

  function previewView(state, opts) {
    state = state || {};
    opts = opts || {};
    var isDownloading = state.status === 'downloading';
    var isReady = state.status === 'ready';
    var isError = state.status === 'error';
    var isOpening = state.status === 'opening';
    var isPatch = state.mode === 'patch';
    var canPatchUpdate = !!(state.configured && state.updateAvailable && state.patchAvailable && state.patchUrl && !state.patchFallbackTried);
    var canOpenRelease = !!opts.manualReleaseAvailable;
    var detail = typeof opts.progressDetailText === 'string'
      ? opts.progressDetailText
      : progressDetailText(state, opts);
    var label = '';
    var footnote = '';

    if (isDownloading) label = (isPatch ? '快速补丁 ' : '正在下载 ') + Math.round(Number(state.progress) || 0) + '%';
    else if (isOpening) label = '正在打开发布页';
    else if (isError && state.mode === 'patch' && canOpenRelease) label = '打开发布页';
    else if (isError) label = state.mode === 'installer' ? '重试下载' : '重试更新';
    else if (isReady && isPatch && state.restartRequired) label = '重启生效';
    else if (isReady && isPatch) label = '补丁已应用';
    else if (isReady && state.installerOpened) label = '发布页已打开';
    else if (isReady && state.installerPath) label = state.cached ? '打开已下载安装包' : '打开安装包';
    else if (isReady) label = state.configured ? '打开发布页' : '预览完成';
    else label = canPatchUpdate ? '安装快速补丁' : (canOpenRelease ? '打开发布页' : '立即更新');

    if (isDownloading) footnote = (state.message || (isPatch ? '正在下载快速补丁' : '正在准备更新')) + (detail ? ' · ' + detail : '');
    else if (isError) footnote = '下载失败：' + (state.errorReason || state.errorDetail || state.message || '请稍后重试') + (state.failedAttempts && state.failedAttempts.length ? ' · 已尝试 ' + state.failedAttempts.length + ' 条线路' : '');
    else if (isReady && isPatch) footnote = state.restartRequired ? '快速补丁已应用，重启 Mineradio 后生效。' : '快速补丁已应用。';
    else if (isReady) footnote = state.cached ? '已复用上次校验通过的安装包，不会重复下载。' : '更新页面已准备好，完整安装包仅作为手动兜底。';
    else if (state.patchAvailable) footnote = '优先使用轻量补丁，只更新缺失或变更的资源文件。';
    else footnote = state.updateAvailable ? '当前版本暂无快速补丁，完整安装包仅作为发布页手动下载兜底。' : '当前版本已是最新。';

    return {
      label: label,
      footnote: footnote,
      isDownloading: isDownloading,
      isReady: isReady,
      isError: isError,
      isOpening: isOpening,
      isPatch: isPatch,
      canPatchUpdate: canPatchUpdate,
      canOpenRelease: canOpenRelease
    };
  }

  global.MineradioModules.updatePanel = {
    formatUpdateBytes: formatUpdateBytes,
    formatUpdateSpeed: formatUpdateSpeed,
    progressDetailText: progressDetailText,
    renderUpdateNotesHtml: renderUpdateNotesHtml,
    previewView: previewView
  };
})(typeof window !== 'undefined' ? window : globalThis);
