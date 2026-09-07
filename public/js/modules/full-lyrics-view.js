(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function fallbackEscHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function helperFn(helpers, name, fallback) {
    return helpers && typeof helpers[name] === 'function' ? helpers[name] : fallback;
  }

  function cleanLyricText(text) {
    return String(text || '').replace(/\s+/g, ' ').trim();
  }

  function normalizeLyricLines(lines) {
    return (Array.isArray(lines) ? lines : []).map(function(line, index) {
      return Object.assign({}, line || {}, {
        originalIndex: index,
        text: cleanLyricText(line && line.text)
      });
    }).filter(function(line) {
      return !!line.text;
    });
  }

  function findActiveLyricIndex(lines, currentTime) {
    var t = isFinite(currentTime) ? Number(currentTime) : 0;
    var active = -1;
    for (var i = 0; i < lines.length; i++) {
      if ((Number(lines[i].t) || 0) <= t + 0.05) active = lines[i].originalIndex;
      else break;
    }
    return active;
  }

  function buildFullLyricsViewState(input) {
    input = input || {};
    var lines = normalizeLyricLines(input.lines);
    return {
      visible: !!input.visible,
      title: cleanLyricText(input.title) || '歌词',
      artist: cleanLyricText(input.artist),
      timingSource: input.timingSource || 'none',
      lines: lines,
      activeIndex: findActiveLyricIndex(lines, Number(input.currentTime) || 0)
    };
  }

  function renderFullLyricsHtml(state, helpers) {
    state = state || {};
    helpers = helpers || {};
    var esc = helperFn(helpers, 'escHtml', fallbackEscHtml);
    var lines = Array.isArray(state.lines) ? state.lines : [];
    if (!lines.length) {
      return '<div class="full-lyrics-empty">暂无可显示歌词</div>';
    }
    return lines.map(function(line) {
      var index = Number(line.originalIndex) || 0;
      var className = 'full-lyric-line'
        + (index === state.activeIndex ? ' active' : '')
        + (index < state.activeIndex ? ' passed' : '');
      var time = isFinite(line.t) ? Number(line.t) : 0;
      return '<button class="' + className + '" type="button" data-lyric-index="' + index + '" data-lyric-time="' + time + '">' +
        '<span>' + esc(line.text) + '</span>' +
      '</button>';
    }).join('');
  }

  global.MineradioModules.fullLyricsView = {
    buildFullLyricsViewState: buildFullLyricsViewState,
    findActiveLyricIndex: findActiveLyricIndex,
    renderFullLyricsHtml: renderFullLyricsHtml
  };
})(typeof window !== 'undefined' ? window : globalThis);
