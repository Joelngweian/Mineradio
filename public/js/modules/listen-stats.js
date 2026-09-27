function emptyState() {
  return { history: [], songs: {}, artists: {}, updatedAt: 0 };
}

function normalizeState(raw) {
  raw = raw || {};
  return {
    history: Array.isArray(raw.history) ? raw.history.slice(0, 180) : [],
    songs: raw.songs && typeof raw.songs === 'object' ? { ...raw.songs } : {},
    artists: raw.artists && typeof raw.artists === 'object' ? { ...raw.artists } : {},
    updatedAt: Number(raw.updatedAt) || 0,
  };
}

function rankEntries(entries) {
  return entries.slice().sort(function(a, b) {
    return (Number(b.plays) || 0) - (Number(a.plays) || 0)
      || (Number(b.listenMs) || 0) - (Number(a.listenMs) || 0)
      || (Number(b.lastPlayedAt) || 0) - (Number(a.lastPlayedAt) || 0);
  });
}

function createListenStatsController(options) {
  options = options || {};
  var storage = options.storage || null;
  var storageKey = String(options.storageKey || 'mineradio-listen-stats-v1');
  var now = typeof options.now === 'function' ? options.now : function() { return Date.now(); };
  var state = load();
  var session = null;

  function load() {
    if (!storage || typeof storage.getItem !== 'function') return emptyState();
    try {
      var raw = storage.getItem(storageKey);
      return raw ? normalizeState(JSON.parse(raw)) : emptyState();
    } catch (error) {
      return emptyState();
    }
  }

  function save() {
    state = { ...state, updatedAt: now() };
    if (!storage || typeof storage.setItem !== 'function') return;
    try {
      storage.setItem(storageKey, JSON.stringify(state));
    } catch (error) {}
  }

  function songKey(song) {
    return typeof options.songKey === 'function' ? options.songKey(song) : '';
  }

  function snapshotSong(song) {
    return typeof options.snapshotSong === 'function' ? options.snapshotSong(song) || {} : {};
  }

  function currentAudio() {
    return typeof options.getAudio === 'function' ? options.getAudio() : null;
  }

  function currentSong() {
    return typeof options.getCurrentSong === 'function' ? options.getCurrentSong() : null;
  }

  function activeContext() {
    return typeof options.getActiveContext === 'function' ? options.getActiveContext() : null;
  }

  function begin(song, context) {
    if (!song) return null;
    var snapshot = snapshotSong(song);
    if (!snapshot.key) snapshot.key = songKey(song);
    if (!snapshot.key) return null;
    if (session && session.key !== snapshot.key) finalize(false);
    var audio = currentAudio();
    var startedAt = now();
    session = {
      key: snapshot.key,
      song: snapshot,
      context: context || activeContext() || null,
      startedAt: startedAt,
      lastWallAt: startedAt,
      lastAudioTime: audio && isFinite(audio.currentTime) ? Number(audio.currentTime) : 0,
      listenMs: 0,
      maxProgress: 0,
    };
    return session;
  }

  function tick(force) {
    var audio = currentAudio();
    if (!audio || !audio.duration || audio.paused) return;
    var song = currentSong();
    if (!song) return;
    var key = songKey(song);
    if (!session || session.key !== key) begin(song, activeContext());
    if (!session) return;
    var at = now();
    var audioTime = isFinite(audio.currentTime) ? Number(audio.currentTime) : 0;
    var deltaByAudio = Math.max(0, audioTime - (session.lastAudioTime || 0)) * 1000;
    var deltaByWall = Math.max(0, at - (session.lastWallAt || at));
    var delta = deltaByAudio > 0 ? Math.min(deltaByAudio, deltaByWall || deltaByAudio, 4200) : 0;
    if (force && delta <= 0) delta = Math.min(deltaByWall, 1500);
    if (delta > 0 && delta < 8000) session.listenMs += delta;
    session.lastWallAt = at;
    session.lastAudioTime = audioTime;
    session.maxProgress = Math.max(session.maxProgress || 0, audio.duration ? audioTime / audio.duration : 0);
  }

  function finalize(completed) {
    if (!session) return null;
    tick(true);
    var finished = session;
    session = null;
    var audio = currentAudio();
    var effective = completed || finished.listenMs >= 45000 || finished.maxProgress >= 0.5
      || (!audio || !audio.duration ? finished.listenMs >= 30000 : false);
    if (!effective) return null;

    var playedAt = now();
    var snapshot = finished.song || {};
    var record = {
      key: finished.key,
      id: snapshot.id || '',
      mid: snapshot.mid || '',
      mediaMid: snapshot.mediaMid || '',
      type: snapshot.type || 'song',
      sourceKey: snapshot.sourceKey || '',
      name: snapshot.name || 'Unknown song',
      artist: snapshot.artist || '',
      cover: snapshot.cover || '',
      source: snapshot.source || '',
      duration: snapshot.duration || 0,
      playedAt: playedAt,
      listenMs: Math.round(finished.listenMs),
      completed: !!completed,
      context: finished.context || null,
    };
    var history = [record].concat((state.history || []).filter(function(item) { return item && item.key !== record.key; })).slice(0, 180);
    var previousSong = state.songs[record.key] || {};
    var song = {
      ...previousSong,
      key: record.key,
      id: record.id || previousSong.id || '',
      mid: record.mid || previousSong.mid || '',
      name: record.name,
      artist: record.artist,
      cover: record.cover || previousSong.cover || '',
      source: record.source || previousSong.source || '',
      sourceKey: record.sourceKey || previousSong.sourceKey || '',
      duration: record.duration || previousSong.duration || 0,
      plays: (Number(previousSong.plays) || 0) + 1,
      listenMs: (Number(previousSong.listenMs) || 0) + record.listenMs,
      completed: (Number(previousSong.completed) || 0) + (completed ? 1 : 0),
      lastPlayedAt: playedAt,
    };
    var songs = { ...state.songs, [record.key]: song };
    var artists = { ...state.artists };
    String(record.artist || '').split(/\s*\/\s*|\s*,\s*|、|&/).forEach(function(name) {
      name = name.trim();
      if (!name) return;
      var previousArtist = artists[name] || { name: name, plays: 0, listenMs: 0, lastPlayedAt: 0 };
      artists[name] = {
        ...previousArtist,
        name: name,
        plays: (Number(previousArtist.plays) || 0) + 1,
        listenMs: (Number(previousArtist.listenMs) || 0) + record.listenMs,
        lastPlayedAt: playedAt,
      };
    });
    state = { ...state, history: history, songs: songs, artists: artists };
    save();
    if (typeof options.onRecorded === 'function') options.onRecorded(record);
    return record;
  }

  function topSongs(limit) {
    return rankEntries(Object.keys(state.songs || {}).map(function(key) { return state.songs[key]; })).slice(0, limit || 8);
  }

  function topArtists(limit) {
    return rankEntries(Object.keys(state.artists || {}).map(function(key) { return state.artists[key]; })).slice(0, limit || 1);
  }

  function summary() {
    return {
      recent: (state.history || [])[0] || null,
      topSong: topSongs(1)[0] || null,
      topArtist: topArtists(1)[0] || null,
      totalPlays: Object.keys(state.songs || {}).reduce(function(total, key) {
        return total + (Number(state.songs[key] && state.songs[key].plays) || 0);
      }, 0),
    };
  }

  function recommendations(discoverSongs) {
    var seen = {};
    var result = [];
    var toSong = typeof options.recordToSong === 'function' ? options.recordToSong : function(record) { return record; };
    var clone = typeof options.cloneSong === 'function' ? options.cloneSong : function(song) { return { ...song }; };
    var normalizeArtist = typeof options.normalizeArtistName === 'function' ? options.normalizeArtistName : function(value) { return String(value || ''); };
    var matchArtist = typeof options.artistMatchScore === 'function' ? options.artistMatchScore : function() { return 0; };
    var topArtistNames = topArtists(4).map(function(item) { return normalizeArtist(item.name); }).filter(Boolean);
    function push(song) {
      song = song && clone(song);
      var key = songKey(song);
      if (!song || !key || seen[key]) return;
      seen[key] = true;
      result.push(song);
    }
    (Array.isArray(discoverSongs) ? discoverSongs.slice() : []).sort(function(a, b) {
      return matchArtist(b && b.artist, topArtistNames) - matchArtist(a && a.artist, topArtistNames);
    }).forEach(push);
    topSongs(10).concat((state.history || []).slice(0, 12)).forEach(function(record) { push(toSong(record)); });
    return result.slice(0, 10);
  }

  return {
    begin: begin,
    tick: tick,
    finalize: finalize,
    getState: function() { return state; },
    summary: summary,
    topSongs: topSongs,
    topArtists: topArtists,
    recommendations: recommendations,
  };
}

export {
  createListenStatsController,
};
