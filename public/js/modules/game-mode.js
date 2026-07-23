(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  // ====================================================================
  //  游戏模式控制器（CS2 优先）
  //  - 订阅 /api/gsi/stream 的 SSE，拿到归一化的对局状态
  //  - 结合用户设置推导「是否压制音乐」，带防抖，边沿触发
  //  - 通过 onIntent 回调把「压制/放开」交给宿主(app.js)执行真正的暂停/压音量
  //  该模块不直接操作 DOM / 音频，保持与其它 state 模块一致的解耦风格。
  // ====================================================================

  var STORAGE_KEY = 'mineradio-game-mode';
  var STALE_MS = 35000;          // SSE 沉默超过此时长 → 视作无游戏
  var DEFAULT_DEBOUNCE_MS = 450; // 状态切换防抖，避开交火瞬间的抖动

  var DEFAULTS = {
    enabled: false,
    cs2: true,
    behavior: 'pause',   // 'pause' 完全暂停 | 'duck' 压低音量
    duckVolume: 0.25,    // duck 时音量占用户音量的比例
    playWhenDead: true,  // 阵亡观战时是否放歌
  };

  function clamp(v, min, max) {
    v = Number(v);
    if (isNaN(v)) v = min;
    return Math.max(min, Math.min(max, v));
  }

  function normalizeSettings(s) {
    s = s || {};
    return {
      enabled: s.enabled === true,
      cs2: s.cs2 !== false,
      behavior: s.behavior === 'duck' ? 'duck' : 'pause',
      duckVolume: clamp(typeof s.duckVolume === 'number' ? s.duckVolume : DEFAULTS.duckVolume, 0.05, 1),
      playWhenDead: s.playWhenDead !== false,
    };
  }

  function loadSettings() {
    var raw = {};
    try { raw = JSON.parse(global.localStorage.getItem(STORAGE_KEY) || '{}') || {}; } catch (e) { raw = {}; }
    return normalizeSettings(raw);
  }

  function saveSettings(s) {
    try { global.localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch (e) {}
  }

  // 由游戏状态 + 设置推导是否应压制音乐
  //   engaged: 功能已启用且检测到游戏（用于 UI「接管中」指示）
  //   suppress: 此刻是否应暂停 / 压低音乐
  function derive(state, s) {
    if (!s || !s.enabled) return { engaged: false, suppress: false, reason: 'off' };
    if (!s.cs2) return { engaged: false, suppress: false, reason: 'game-off' };
    if (!state || !state.running) return { engaged: false, suppress: false, reason: 'no-game' };

    var inWarmup = state.mapPhase === 'warmup';
    var liveCombat = !!state.inMatch && state.activity === 'playing' && state.roundPhase === 'live' && !inWarmup;

    if (!liveCombat) {
      var reason = state.activity !== 'playing'
        ? 'menu'
        : (inWarmup ? 'warmup' : (state.roundPhase || 'wait'));
      return { engaged: true, suppress: false, reason: reason };
    }
    if (state.alive) return { engaged: true, suppress: true, reason: 'combat' };
    // 本人已阵亡（观战中）
    if (s.playWhenDead) return { engaged: true, suppress: false, reason: 'dead-play' };
    return { engaged: true, suppress: true, reason: 'dead-mute' };
  }

  function reasonLabel(reason, running) {
    switch (reason) {
      case 'off': return '已关闭';
      case 'game-off': return 'CS2 未启用';
      case 'no-game': return '未检测到游戏';
      case 'menu': return 'CS2 · 菜单中 · 播放';
      case 'warmup': return 'CS2 · 热身 · 播放';
      case 'freezetime': return 'CS2 · 买枪/候场 · 播放';
      case 'over': return 'CS2 · 回合结束 · 播放';
      case 'wait': return 'CS2 · 候场 · 播放';
      case 'combat': return 'CS2 · 交火中 · 暂停';
      case 'dead-play': return 'CS2 · 阵亡观战 · 播放';
      case 'dead-mute': return 'CS2 · 阵亡 · 暂停';
      default: return running ? 'CS2 · 进行中' : '未检测到游戏';
    }
  }

  function createController(opts) {
    opts = opts || {};
    var onIntent = typeof opts.onIntent === 'function' ? opts.onIntent : function() {};
    var onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function() {};
    var debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;

    var settings = loadSettings();
    var state = { running: false };
    var es = null;
    var appliedSuppress = false;   // 当前已下发给宿主的压制状态
    var pending = null;            // { suppress, timer }
    var staleTimer = 0;

    function copy(o) { return Object.assign({}, o); }

    function buildStatus() {
      var d = derive(state, settings);
      return {
        settings: copy(settings),
        state: copy(state),
        derived: d,
        applied: appliedSuppress,
        label: reasonLabel(d.reason, state.running),
        connected: !!(es && es.readyState === 1),
      };
    }
    function emitStatus() {
      try { onStatus(buildStatus()); } catch (e) {}
    }

    function fireIntent(suppress) {
      try {
        onIntent({ suppress: suppress, behavior: settings.behavior, duckVolume: settings.duckVolume });
      } catch (e) {}
    }

    function scheduleApply() {
      var want = derive(state, settings).suppress;
      if (want === appliedSuppress) {
        if (pending) { clearTimeout(pending.timer); pending = null; }
        emitStatus();
        return;
      }
      if (pending && pending.suppress === want) { emitStatus(); return; }
      if (pending) clearTimeout(pending.timer);
      pending = {
        suppress: want,
        timer: setTimeout(function() {
          pending = null;
          appliedSuppress = want;
          fireIntent(want);
          emitStatus();
        }, debounceMs),
      };
      emitStatus();
    }

    function armStale() {
      if (staleTimer) clearTimeout(staleTimer);
      staleTimer = setTimeout(function() {
        state = { running: false };
        scheduleApply();
      }, STALE_MS);
    }

    function onData(raw) {
      var next;
      try { next = JSON.parse(raw); } catch (e) { return; }
      if (!next || typeof next !== 'object') return;
      state = next;
      armStale();
      scheduleApply();
    }

    function connect() {
      if (es || typeof global.EventSource !== 'function') return;
      try {
        es = new global.EventSource('/api/gsi/stream');
        es.addEventListener('state', function(e) { onData(e.data); });
        es.onmessage = function(e) { onData(e.data); };
        es.onopen = function() { emitStatus(); };
        es.onerror = function() { emitStatus(); }; // EventSource 会自动重连
      } catch (e) { es = null; }
    }

    function disconnect() {
      if (es) { try { es.close(); } catch (e) {} es = null; }
      if (staleTimer) { clearTimeout(staleTimer); staleTimer = 0; }
    }

    function releaseIfNeeded() {
      if (pending) { clearTimeout(pending.timer); pending = null; }
      if (appliedSuppress) {
        appliedSuppress = false;
        fireIntent(false);
      }
    }

    function applyEnabledState() {
      if (settings.enabled) {
        connect();
        scheduleApply();
      } else {
        disconnect();
        state = { running: false };
        releaseIfNeeded();
      }
      emitStatus();
    }

    return {
      init: function() { applyEnabledState(); },
      getSettings: function() { return copy(settings); },
      update: function(partial) {
        settings = normalizeSettings(Object.assign({}, settings, partial || {}));
        saveSettings(settings);
        applyEnabledState();
      },
      // 用户手动播放/暂停时调用：把当前游戏态视作「已应用」，
      // 直到游戏状态再次变化才继续自动接管，避免与用户对着干。
      noteManualToggle: function() {
        if (pending) { clearTimeout(pending.timer); pending = null; }
        appliedSuppress = derive(state, settings).suppress;
        emitStatus();
      },
      status: buildStatus,
      derive: function() { return derive(state, settings); },
    };
  }

  global.MineradioModules.gameMode = {
    createController: createController,
    derive: derive,
    reasonLabel: reasonLabel,
    normalizeSettings: normalizeSettings,
    DEFAULTS: DEFAULTS,
  };
})(typeof window !== 'undefined' ? window : globalThis);
