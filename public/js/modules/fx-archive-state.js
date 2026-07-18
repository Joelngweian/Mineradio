(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function clampRange(value, min, max) {
    value = Number(value);
    if (!isFinite(value)) value = min;
    return Math.max(min, Math.min(max, value));
  }

  function helper(config, name, fallback) {
    var fn = config && config.helpers && config.helpers[name];
    return typeof fn === 'function' ? fn : fallback;
  }

  function defaultUserFxArchiveName(index) {
    return '用户存档 ' + (Number(index) + 1);
  }

  function normalizeUserFxArchiveName(name, index) {
    name = String(name || '').replace(/\s+/g, ' ').trim();
    if (!name) name = defaultUserFxArchiveName(index);
    return name.slice(0, 28);
  }

  function archiveNumber(raw, key, fallback, min, max) {
    var value = raw && raw[key] != null ? Number(raw[key]) : fallback;
    if (!isFinite(value)) value = fallback;
    return clampRange(value, min, max);
  }

  function archiveMode(raw, key, pattern, fallback) {
    var value = String(raw && raw[key] != null ? raw[key] : fallback);
    return pattern.test(value) ? value : fallback;
  }

  function normalizeFxArchiveSnapshot(raw, config) {
    if (!raw || typeof raw !== 'object') return null;
    config = config || {};
    var fxDefaults = config.defaults || {};
    var visualPresetSchema = config.visualPresetSchema || '';
    var presetCount = Math.max(1, Number(config.presetCount) || 1);
    var normalizeCoverResolution = helper(config, 'normalizeCoverResolution', function(value) { return value; });
    var normalizeHexColor = helper(config, 'normalizeHexColor', function(value, fallback) { return value || fallback || '#ffffff'; });
    var normalizeLyricFontKey = helper(config, 'normalizeLyricFontKey', function(value) { return value || ''; });
    var normalizeWallpaperRotateMode = helper(config, 'normalizeWallpaperRotateMode', function(value) { return value || 'off'; });
    var normalizeWallpaperRotateMinutes = helper(config, 'normalizeWallpaperRotateMinutes', function(value) { return Number(value) || 0; });
    var normalizeWallpaperRotateItems = helper(config, 'normalizeWallpaperRotateItems', function(value) { return Array.isArray(value) ? value : []; });
    var normalizeWallpaperRotateTransition = helper(config, 'normalizeWallpaperRotateTransition', function(value) { return value || 'crossfade'; });
    var normalizeHomeHeroBg = helper(config, 'normalizeHomeHeroBg', function(value) { return value || ''; });
    var normalizeDesktopLyricsFps = helper(config, 'normalizeDesktopLyricsFps', function(value) { return Number(value) || 30; });
    var normalizePerformanceBackgroundMode = helper(config, 'normalizePerformanceBackgroundMode', function(value, keep) { return keep ? 'keep' : (value || 'auto'); });
    var normalizePerformanceQuality = helper(config, 'normalizePerformanceQuality', function(value) { return value || 'balanced'; });
    var savedPreset = clampRange(Number(raw.preset) || 0, 0, presetCount - 1);
    var performanceBackground = normalizePerformanceBackgroundMode(raw.performanceBackground, raw.liveBackgroundKeep === true);
    if (savedPreset === 3 && raw.visualPresetSchema !== visualPresetSchema) savedPreset = Math.min(5, presetCount - 1);
    return {
      visualPresetSchema: visualPresetSchema,
      preset: savedPreset,
      intensity: archiveNumber(raw, 'intensity', fxDefaults.intensity, 0.2, 1.6),
      cinemaShake: archiveNumber(raw, 'cinemaShake', fxDefaults.cinemaShake, 0, 1.8),
      depth: archiveNumber(raw, 'depth', fxDefaults.depth, 0.2, 1.8),
      coverResolution: normalizeCoverResolution(raw.coverResolution),
      point: archiveNumber(raw, 'point', fxDefaults.point, 0.5, 2.2),
      speed: archiveNumber(raw, 'speed', fxDefaults.speed, 0.2, 2.5),
      twist: archiveNumber(raw, 'twist', fxDefaults.twist, 0, 0.6),
      color: archiveNumber(raw, 'color', fxDefaults.color, 0.5, 2.0),
      scatter: archiveNumber(raw, 'scatter', fxDefaults.scatter, 0, 0.5),
      bgFade: archiveNumber(raw, 'bgFade', fxDefaults.bgFade, 0, 1.2),
      bloomStrength: archiveNumber(raw, 'bloomStrength', fxDefaults.bloomStrength, 0, 1.6),
      lyricGlowStrength: archiveNumber(raw, 'lyricGlowStrength', fxDefaults.lyricGlowStrength, 0, 0.85),
      lyricScale: archiveNumber(raw, 'lyricScale', fxDefaults.lyricScale, 0.35, 1.65),
      lyricOffsetX: archiveNumber(raw, 'lyricOffsetX', fxDefaults.lyricOffsetX, -2.0, 2.0),
      lyricOffsetY: archiveNumber(raw, 'lyricOffsetY', fxDefaults.lyricOffsetY, -1.2, 1.35),
      lyricOffsetZ: archiveNumber(raw, 'lyricOffsetZ', fxDefaults.lyricOffsetZ, -1.6, 1.6),
      lyricTiltX: archiveNumber(raw, 'lyricTiltX', fxDefaults.lyricTiltX, -42, 42),
      lyricTiltY: archiveNumber(raw, 'lyricTiltY', fxDefaults.lyricTiltY, -42, 42),
      lyricCameraLock: !!raw.lyricCameraLock,
      lyricColorMode: raw.lyricColorMode === 'custom' ? 'custom' : 'auto',
      lyricColor: normalizeHexColor(raw.lyricColor || fxDefaults.lyricColor),
      lyricHighlightMode: raw.lyricHighlightMode === 'custom' ? 'custom' : 'auto',
      lyricHighlightColor: normalizeHexColor(raw.lyricHighlightColor || fxDefaults.lyricHighlightColor),
      lyricGlowLinked: raw.lyricGlowLinked !== false,
      lyricGlowColor: normalizeHexColor(raw.lyricGlowColor || fxDefaults.lyricGlowColor),
      lyricFont: normalizeLyricFontKey(raw.lyricFont),
      lyricLetterSpacing: archiveNumber(raw, 'lyricLetterSpacing', fxDefaults.lyricLetterSpacing, -0.04, 0.18),
      lyricLineHeight: archiveNumber(raw, 'lyricLineHeight', fxDefaults.lyricLineHeight, 0.86, 1.35),
      lyricWeight: archiveNumber(raw, 'lyricWeight', fxDefaults.lyricWeight, 500, 900),
      visualTintMode: raw.visualTintMode === 'custom' ? 'custom' : 'auto',
      visualTintColor: normalizeHexColor(raw.visualTintColor || fxDefaults.visualTintColor),
      uiAccentColor: normalizeHexColor(raw.uiAccentColor || fxDefaults.uiAccentColor, fxDefaults.uiAccentColor),
      homeAccentColor: normalizeHexColor(raw.homeAccentColor || fxDefaults.homeAccentColor, fxDefaults.homeAccentColor),
      homeIconColor: normalizeHexColor(raw.homeIconColor || fxDefaults.homeIconColor, fxDefaults.homeIconColor),
      visualIconColor: normalizeHexColor(raw.visualIconColor || fxDefaults.visualIconColor, fxDefaults.visualIconColor),
      backgroundColorMode: raw.backgroundColorMode === 'custom' || raw.backgroundColorCustom ? 'custom' : 'cover',
      backgroundColor: normalizeHexColor(raw.backgroundColor || fxDefaults.backgroundColor, fxDefaults.backgroundColor),
      backgroundOpacity: archiveNumber(raw, 'backgroundOpacity', fxDefaults.backgroundOpacity, 0, 1),
      controlGlassChromaticOffset: archiveNumber(raw, 'controlGlassChromaticOffset', fxDefaults.controlGlassChromaticOffset, 0, 140),
      backgroundColorCustom: raw.backgroundColorMode === 'custom' || !!raw.backgroundColorCustom,
      wallpaperRotateMode: normalizeWallpaperRotateMode(raw.wallpaperRotateMode),
      wallpaperRotateMinutes: normalizeWallpaperRotateMinutes(raw.wallpaperRotateMinutes == null ? fxDefaults.wallpaperRotateMinutes : raw.wallpaperRotateMinutes),
      wallpaperRotateItems: normalizeWallpaperRotateItems(raw.wallpaperRotateItems),
      wallpaperRotateTransition: normalizeWallpaperRotateTransition(raw.wallpaperRotateTransition),
      homeHeroBg: normalizeHomeHeroBg(raw.homeHeroBg) || '',
      floatLayer: !!raw.floatLayer,
      cinema: raw.cinema !== false,
      edge: !!raw.edge,
      aiDepth: !!raw.aiDepth,
      bloom: !!raw.bloom,
      lyricGlow: raw.lyricGlow !== false,
      lyricGlowBeat: raw.lyricGlowBeat !== false,
      lyricGlowParticles: !!raw.lyricGlowParticles,
      desktopLyrics: !!raw.desktopLyrics,
      desktopLyricsSize: archiveNumber(raw, 'desktopLyricsSize', fxDefaults.desktopLyricsSize, 0.72, 1.55),
      desktopLyricsOpacity: archiveNumber(raw, 'desktopLyricsOpacity', fxDefaults.desktopLyricsOpacity, 0.28, 1),
      desktopLyricsY: archiveNumber(raw, 'desktopLyricsY', fxDefaults.desktopLyricsY, 0.08, 0.92),
      desktopLyricsClickThrough: raw.desktopLyricsClickThrough === true,
      desktopLyricsCinema: raw.desktopLyricsCinema !== false,
      desktopLyricsHighlight: raw.desktopLyricsHighlight === true,
      desktopLyricsFps: normalizeDesktopLyricsFps(Object.prototype.hasOwnProperty.call(raw, 'desktopLyricsFps') ? raw.desktopLyricsFps : fxDefaults.desktopLyricsFps),
      performanceBackground: performanceBackground,
      performanceQuality: normalizePerformanceQuality(raw.performanceQuality),
      liveBackgroundKeep: performanceBackground === 'keep',
      particleLyrics: raw.particleLyrics !== false,
      backCover: !!raw.backCover,
      shelf: archiveMode(raw, 'shelf', /^(off|side|stage)$/, fxDefaults.shelf),
      shelfCameraMode: archiveMode(raw, 'shelfCameraMode', /^(dynamic|static)$/, fxDefaults.shelfCameraMode),
      shelfPresence: archiveMode(raw, 'shelfPresence', /^(auto|always)$/, fxDefaults.shelfPresence),
      shelfShowPodcasts: raw.shelfShowPodcasts !== false,
      shelfMergeCollections: raw.shelfMergeCollections === true,
      shelfSize: archiveNumber(raw, 'shelfSize', fxDefaults.shelfSize, 0.65, 1.45),
      shelfOffsetX: archiveNumber(raw, 'shelfOffsetX', fxDefaults.shelfOffsetX, -1.2, 1.2),
      shelfOffsetY: archiveNumber(raw, 'shelfOffsetY', fxDefaults.shelfOffsetY, -0.9, 0.9),
      shelfOffsetZ: archiveNumber(raw, 'shelfOffsetZ', fxDefaults.shelfOffsetZ, -0.9, 0.9),
      shelfAngleY: archiveNumber(raw, 'shelfAngleY', fxDefaults.shelfAngleY, -30, 30),
      shelfAngleYManual: raw.shelfAngleYManual === true,
      shelfOpacity: archiveNumber(raw, 'shelfOpacity', fxDefaults.shelfOpacity, 0.25, 1),
      shelfBgOpacity: archiveNumber(raw, 'shelfBgOpacity', fxDefaults.shelfBgOpacity, 0.25, 0.98),
      shelfAccentColor: normalizeHexColor(raw.shelfAccentColor || fxDefaults.shelfAccentColor, fxDefaults.shelfAccentColor),
      cam: archiveMode(raw, 'cam', /^(off|gesture)$/, fxDefaults.cam)
    };
  }

  function formatUserArchiveTime(ts, now) {
    ts = Number(ts) || 0;
    if (!ts) return '空槽位';
    now = Number(now) || Date.now();
    var diff = now - ts;
    if (diff < 60000) return '刚刚保存';
    if (diff < 3600000) return Math.max(1, Math.round(diff / 60000)) + ' 分钟前';
    var d = new Date(ts);
    function pad(v) { return String(v).padStart(2, '0'); }
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  function safeArchiveFileName(name) {
    return String(name || 'Mineradio 用户存档').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 48) + '.json';
  }

  global.MineradioModules.fxArchiveState = {
    defaultUserFxArchiveName: defaultUserFxArchiveName,
    normalizeUserFxArchiveName: normalizeUserFxArchiveName,
    archiveNumber: archiveNumber,
    archiveMode: archiveMode,
    normalizeFxArchiveSnapshot: normalizeFxArchiveSnapshot,
    formatUserArchiveTime: formatUserArchiveTime,
    safeArchiveFileName: safeArchiveFileName
  };
})(typeof window !== 'undefined' ? window : globalThis);
