(function(global) {
  'use strict';

  global.MineradioModules = global.MineradioModules || {};

  function queueTextKey(text) {
    var queueState = global.MineradioModules && global.MineradioModules.queueState;
    if (queueState && typeof queueState.queueTextKey === 'function') return queueState.queueTextKey(text);
    return String(text || '').trim().toLowerCase().replace(/[\s._()[\]{}'"|/\\:-]+/g, '');
  }

  function defaultProviderKey(song) {
    return song && (song.provider || song.source || song.platform) || 'youtube';
  }

  function helperFn(helpers, name, fallback) {
    return helpers && typeof helpers[name] === 'function' ? helpers[name] : fallback;
  }

  function queueItemKey(song, helpers) {
    if (!song) return '';
    if (song.type === 'podcast' || song.source === 'podcast') {
      return 'podcast:' + (song.programId || song.id || '');
    }
    if (song.type === 'local' || song.source === 'local') {
      return 'local:' + (song.localKey || song.path || song.filePath || song.url || '');
    }
    var id = song.id || song.mid || song.videoId || song.songmid;
    if (id) return 'song:' + id;
    var name = queueTextKey(song.name || song.title);
    var artist = queueTextKey(song.artist);
    return name ? 'text:' + name + '|' + artist : '';
  }

  function sameQueueSeedSong(a, b, helpers) {
    if (!a || !b) return false;
    var ak = queueItemKey(a, helpers);
    var bk = queueItemKey(b, helpers);
    if (ak && bk && ak === bk) return true;
    var at = queueTextKey(a.name || a.title);
    var bt = queueTextKey(b.name || b.title);
    if (!at || !bt || at !== bt) return false;
    var aa = queueTextKey(a.artist);
    var ba = queueTextKey(b.artist);
    return !aa || !ba || aa.indexOf(ba) >= 0 || ba.indexOf(aa) >= 0;
  }

  function findQueueSeedIndex(queue, currentIndex, seedSong, helpers) {
    if (!Array.isArray(queue) || !seedSong) return -1;
    if (currentIndex >= 0 && currentIndex < queue.length && sameQueueSeedSong(queue[currentIndex], seedSong, helpers)) return currentIndex;
    for (var i = 0; i < queue.length; i++) {
      if (sameQueueSeedSong(queue[i], seedSong, helpers)) return i;
    }
    return -1;
  }

  function radioRecommendationKey(song, helpers) {
    if (!song) return '';
    var providerKey = helperFn(helpers, 'songProviderKey', defaultProviderKey);
    var id = song.id || song.mid || song.videoId || song.songmid;
    if (id) return providerKey(song) + ':' + id;
    return queueItemKey(song, helpers);
  }

  function queueHasRecommendationAfterSeed(queue, currentIndex, seedSong, helpers) {
    var seedIndex = findQueueSeedIndex(queue, currentIndex, seedSong, helpers);
    return seedIndex >= 0 && Array.isArray(queue) && queue.length > seedIndex + 1;
  }

  function createSearchSeedQueue(song, cloneSong) {
    var clone = typeof cloneSong === 'function' ? cloneSong : function(item) { return Object.assign({}, item); };
    var seedSong = clone(song || {});
    return {
      queue: [seedSong],
      currentIdx: 0,
      seedSong: seedSong,
      radioSeedId: ''
    };
  }

  function mergeRadioRecommendations(queue, currentIndex, seedSong, recs, opts) {
    opts = opts || {};
    var nextQueue = Array.isArray(queue) ? queue.slice() : [];
    if (!Array.isArray(recs) || !recs.length) return { queue: nextQueue, added: 0, seedIndex: -1 };
    var seedIndex = findQueueSeedIndex(nextQueue, currentIndex, seedSong, opts);
    if (seedIndex < 0) return { queue: nextQueue, added: 0, seedIndex: seedIndex };
    if (opts.requireCurrent !== false && !sameQueueSeedSong(nextQueue[currentIndex], seedSong, opts)) {
      return { queue: nextQueue, added: 0, seedIndex: seedIndex };
    }

    var isValid = helperFn(opts, 'isValidQueueSong', function(song) { return !!song; });
    var hydrate = helperFn(opts, 'hydrateCustomCover', function(song) { return song; });
    var existing = {};
    nextQueue.forEach(function(song) {
      var key = radioRecommendationKey(song, opts);
      if (key) existing[key] = true;
      var qk = queueItemKey(song, opts);
      if (qk) existing[qk] = true;
    });

    var additions = [];
    recs.forEach(function(song) {
      if (!isValid(song) || sameQueueSeedSong(seedSong, song, opts)) return;
      var key = radioRecommendationKey(song, opts);
      var qk = queueItemKey(song, opts);
      if ((key && existing[key]) || (qk && existing[qk])) return;
      if (key) existing[key] = true;
      if (qk) existing[qk] = true;
      additions.push(hydrate(song));
    });

    if (!additions.length) return { queue: nextQueue, added: 0, seedIndex: seedIndex };
    if (opts.replaceTail) nextQueue.splice.apply(nextQueue, [seedIndex + 1, nextQueue.length - seedIndex - 1].concat(additions));
    else nextQueue.splice.apply(nextQueue, [seedIndex + 1, 0].concat(additions));
    return { queue: nextQueue, added: additions.length, seedIndex: seedIndex };
  }

  global.MineradioModules.queueController = {
    queueTextKey: queueTextKey,
    queueItemKey: queueItemKey,
    sameQueueSeedSong: sameQueueSeedSong,
    findQueueSeedIndex: findQueueSeedIndex,
    radioRecommendationKey: radioRecommendationKey,
    queueHasRecommendationAfterSeed: queueHasRecommendationAfterSeed,
    createSearchSeedQueue: createSearchSeedQueue,
    mergeRadioRecommendations: mergeRadioRecommendations
  };
})(typeof window !== 'undefined' ? window : globalThis);
