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

  global.MineradioModules.updatePanel = {
    formatUpdateBytes: formatUpdateBytes,
    formatUpdateSpeed: formatUpdateSpeed
  };
})(typeof window !== 'undefined' ? window : globalThis);
