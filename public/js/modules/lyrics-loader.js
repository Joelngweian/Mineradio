function createLyricsLoader(options) {
  options = options || {};
  var cache = new Map();
  var cacheMax = Math.max(1, Number(options.cacheMax) || 40);

  function currentTokenMatches(token) {
    return typeof options.isCurrentToken !== 'function' || options.isCurrentToken(token);
  }

  function cacheKey(song) {
    if (!song) return '';
    var provider = typeof options.songProviderKey === 'function' ? options.songProviderKey(song) : '';
    var id = song.id || '';
    return id ? (provider + ':' + id) : '';
  }

  function endpointFor(song, songOrId) {
    var songId = song ? song.id : songOrId;
    var query = '/api/lyric?id=' + encodeURIComponent(songId);
    if (song) {
      if (song.name) query += '&name=' + encodeURIComponent(song.name);
      if (song.artist) query += '&artist=' + encodeURIComponent(song.artist);
      if (song.album) query += '&album=' + encodeURIComponent(song.album);
      if (song.duration) query += '&duration=' + encodeURIComponent(Math.round(Number(song.duration) / 1000));
    }
    return query;
  }

  function cacheResponse(song, response) {
    var key = cacheKey(song);
    if (!key || !response || !(response.lyric || response.yrc)) return;
    cache.set(key, response);
    if (cache.size > cacheMax) cache.delete(cache.keys().next().value);
  }

  async function prefetch(song, signal) {
    try {
      if (!song || song.type === 'podcast') return;
      var key = cacheKey(song);
      if (!key || cache.has(key)) return;
      var response = await options.apiJson(endpointFor(song, song), signal ? { signal: signal } : undefined);
      cacheResponse(song, response);
    } catch (error) {}
  }

  async function fetch(songOrId, token, signal) {
    try {
      var song = songOrId && typeof songOrId === 'object' ? songOrId : null;
      var key = song ? cacheKey(song) : '';
      var response = key && cache.has(key) ? cache.get(key) : null;
      if (!response) {
        response = await options.apiJson(endpointFor(song, songOrId), signal ? { signal: signal } : undefined);
        if (!currentTokenMatches(token)) return;
        cacheResponse(song, response);
      }
      if (!currentTokenMatches(token)) return;
      var nativeLines = options.parseYrcText(response.yrc || '');
      var lrcLines = options.parseLyricText(response.lyric || '');
      var hasNativeKaraoke = nativeLines.some(function(line) { return line.words && line.words.length; });
      var timingSource = hasNativeKaraoke ? 'yrc-word' : (nativeLines.length ? 'yrc-line' : (lrcLines.length ? 'lrc-line' : 'fallback'));
      var lines = options.withLyricFallback(nativeLines.length ? nativeLines : lrcLines);
      if (lines.length && lines[0].fallback) timingSource = 'fallback';
      options.setOriginalLyricsState(lines, hasNativeKaraoke, timingSource);
      options.applyPreferredLyricsForCurrent(true);
      options.resetLyricTranslationForNewSong();
    } catch (error) {
      if (!currentTokenMatches(token)) return;
      var fallbackLines = options.withLyricFallback([]);
      options.setOriginalLyricsState(fallbackLines, false, 'fallback');
      options.applyPreferredLyricsForCurrent(true);
      options.resetLyricTranslationForNewSong();
    }
  }

  return {
    cacheKey: cacheKey,
    endpointFor: endpointFor,
    prefetch: prefetch,
    fetch: fetch,
    getCacheSize: function() { return cache.size; }
  };
}

export {
  createLyricsLoader,
};
