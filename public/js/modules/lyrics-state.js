(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function isNoLyricText(text) {
    var compact = String(text || '').replace(/\s+/g, '').replace(/[，,。.!！?？、~～]/g, '');
    return !compact ||
      compact === '纯音乐请欣赏' ||
      compact === '暂无歌词' ||
      compact === '暂无歌词敬请期待' ||
      compact === '此歌曲为没有填词的纯音乐请您欣赏' ||
      compact === '绾煶涔愯娆ｈ祻' ||
      compact === '鏆傛棤姝岃瘝' ||
      compact === '鏆傛棤姝岃瘝鏁鏈熷緟' ||
      compact === '姝ゆ瓕鏇蹭负娌℃湁濉瘝鐨勭函闊充箰璇锋偍娆ｈ祻';
  }

  function withLyricFallback(lines, fallbackTextProvider) {
    lines = Array.isArray(lines) ? lines.filter(function(line){ return line && String(line.text || '').trim(); }) : [];
    if (lines.length && !lines.every(function(line){ return isNoLyricText(line.text); })) return lines;
    var text = typeof fallbackTextProvider === 'function'
      ? fallbackTextProvider()
      : String(fallbackTextProvider || '');
    return text ? [{ t:0, text:text, duration:9999, charCount:Math.max(1, text.length), fallback:true }] : [];
  }

  function lyricTagTimeToSeconds(min, sec, frac) {
    var t = (parseInt(min, 10) || 0) * 60 + (parseInt(sec, 10) || 0);
    if (frac) t += (parseInt(frac, 10) || 0) / Math.pow(10, Math.min(3, frac.length));
    return t;
  }

  function finalizeLyricLineDurations(lines) {
    lines = Array.isArray(lines) ? lines : [];
    lines.sort(function(a, b){ return a.t - b.t; });
    for (var i = 0; i < lines.length; i++) {
      var next = lines[i + 1];
      var inferred = next && next.t > lines[i].t ? next.t - lines[i].t : 4.8;
      if (!isFinite(lines[i].duration) || lines[i].duration <= 0) lines[i].duration = inferred;
      lines[i].duration = Math.max(0.45, Math.min(12, lines[i].duration));
      lines[i].charCount = Math.max(1, lines[i].charCount || String(lines[i].text || '').length);
    }
    return lines;
  }

  function parseLyricText(text) {
    var lines = [];
    var reg = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
    String(text || '').split(/\r?\n/).forEach(function(line){
      var times = [], m;
      reg.lastIndex = 0;
      while ((m = reg.exec(line))) times.push(lyricTagTimeToSeconds(m[1], m[2], m[3]));
      if (!times.length) return;
      var txt = line.replace(reg, '').trim();
      if (!txt) return;
      times.forEach(function(t){ lines.push({ t: t, text: txt, source:'lrc' }); });
    });
    return finalizeLyricLineDurations(lines);
  }

  function parseYrcText(text) {
    var lines = [];
    String(text || '').split(/\r?\n/).forEach(function(line){
      var m = line.match(/^\[(\d+),(\d+)\](.*)$/);
      if (!m) return;
      var lineStartMs = parseInt(m[1], 10) || 0;
      var lineDurMs = parseInt(m[2], 10) || 0;
      var body = m[3] || '';
      var words = [], fullText = '';
      var reg = /\((\d+),(\d+),\d+\)([^()]*)/g, wm;
      while ((wm = reg.exec(body))) {
        var txt = (wm[3] || '').replace(/\s+/g, ' ');
        if (!txt) continue;
        var rawStart = parseInt(wm[1], 10) || 0;
        var rawDur = parseInt(wm[2], 10) || 0;
        var absStartMs = rawStart >= lineStartMs - 500 ? rawStart : lineStartMs + rawStart;
        var c0 = fullText.length;
        fullText += txt;
        words.push({ text:txt, t:absStartMs / 1000, d:Math.max(0.06, rawDur / 1000), c0:c0, c1:fullText.length });
      }
      if (!fullText) fullText = body.replace(/\(\d+,\d+,\d+\)/g, '').replace(/\s+/g, ' ');
      var leading = (fullText.match(/^\s+/) || [''])[0].length;
      fullText = fullText.replace(/\s+/g, ' ').trim();
      if (!fullText) return;
      if (words.length) {
        words.forEach(function(w){
          w.c0 = Math.max(0, Math.min(fullText.length, w.c0 - leading));
          w.c1 = Math.max(w.c0, Math.min(fullText.length, w.c1 - leading));
        });
        words = words.filter(function(w){ return w.c1 > w.c0; });
      }
      lines.push({ t:lineStartMs / 1000, duration:lineDurMs / 1000, text:fullText, words:words, charCount:Math.max(1, fullText.length), source: words.length ? 'yrc-word' : 'yrc-line' });
    });
    return finalizeLyricLineDurations(lines);
  }

  function getLyricLineProgress(line, nextLine, now, audioDuration) {
    if (!line) return 0;
    now += line.words && line.words.length ? 0.030 : 0.020;
    if (line.words && line.words.length && line.charCount > 0) {
      var lastP = 0;
      for (var i = 0; i < line.words.length; i++) {
        var w = line.words[i];
        var ws = w.t;
        var we = w.t + Math.max(0.08, w.d || 0.24);
        if (now < ws) return lastP;
        var local = now >= we ? 1 : (now - ws) / Math.max(0.08, we - ws);
        local = Math.max(0, Math.min(1, local));
        var p = (w.c0 + (w.c1 - w.c0) * local) / line.charCount;
        lastP = Math.max(lastP, p);
        if (now < we) return lastP;
      }
      return 1;
    }
    var fallbackEnd = Number(audioDuration) || now + 4;
    var nextT = nextLine && nextLine.t > line.t ? nextLine.t : Math.min(fallbackEnd, line.t + (line.duration || 4.8));
    var span = Math.max(0.75, nextT - line.t);
    var prog = Math.max(0, Math.min(1, (now - line.t) / span));
    return prog * prog * (3 - 2 * prog);
  }

  global.MineradioModules.lyricsState = {
    isNoLyricText: isNoLyricText,
    withLyricFallback: withLyricFallback,
    lyricTagTimeToSeconds: lyricTagTimeToSeconds,
    finalizeLyricLineDurations: finalizeLyricLineDurations,
    parseLyricText: parseLyricText,
    parseYrcText: parseYrcText,
    getLyricLineProgress: getLyricLineProgress
  };
})(typeof window !== 'undefined' ? window : globalThis);
