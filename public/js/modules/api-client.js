(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function runtimeValue(name) {
    if (global && global[name]) return global[name];
    try {
      return globalThis && globalThis[name];
    } catch (e) {
      return null;
    }
  }

  async function apiJson(url, opts) {
    opts = opts || {};
    var timeoutMs = Number(opts.timeoutMs) || 0;
    var fetchOpts = Object.assign({}, opts);
    delete fetchOpts.timeoutMs;
    var timer = null;
    var Controller = runtimeValue('AbortController');
    var fetchFn = runtimeValue('fetch');
    if (!fetchFn) throw new Error('FETCH_UNAVAILABLE');
    if (timeoutMs && Controller && !fetchOpts.signal) {
      var controller = new Controller();
      fetchOpts.signal = controller.signal;
      timer = runtimeValue('setTimeout')(function() { controller.abort(); }, timeoutMs);
    }
    try {
      var res = await fetchFn(url, fetchOpts);
      return res.json();
    } finally {
      if (timer) runtimeValue('clearTimeout')(timer);
    }
  }

  global.MineradioModules.apiClient = {
    apiJson: apiJson
  };
})(typeof window !== 'undefined' ? window : globalThis);
