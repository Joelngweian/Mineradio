function copySong(song) {
  return Object.assign({}, song || {});
}

function distinctSeeds(records, options) {
  options = options || {};
  var songKey = typeof options.songKey === 'function' ? options.songKey : function(song) { return song && song.id || ''; };
  var artistKey = typeof options.artistKey === 'function' ? options.artistKey : function(song) { return song && song.artist || ''; };
  var limit = Math.max(1, Number(options.limit) || 2);
  var usedArtists = {};
  var usedSongs = {};
  var seeds = [];
  (Array.isArray(records) ? records : []).some(function(record) {
    var song = copySong(record);
    var key = String(songKey(song) || '');
    var artist = String(artistKey(song) || '');
    if (!key || !song.id || usedSongs[key] || usedArtists[artist]) return false;
    usedSongs[key] = true;
    if (artist) usedArtists[artist] = true;
    seeds.push(song);
    return seeds.length >= limit;
  });
  return seeds;
}

function interleave(groups, limit) {
  var output = [];
  var max = Math.max(1, Number(limit) || 10);
  var index = 0;
  while (output.length < max) {
    var added = false;
    groups.forEach(function(group) {
      if (output.length >= max || !group || index >= group.length) return;
      output.push(group[index]);
      added = true;
    });
    if (!added) break;
    index += 1;
  }
  return output;
}

function createPersonalizedRadioController(options) {
  options = options || {};
  var state = { loading: false, loaded: false, songs: [], seedKeys: [], error: '', updatedAt: 0, requestId: 0 };

  function songKey(song) {
    return typeof options.songKey === 'function' ? String(options.songKey(song) || '') : String(song && song.id || '');
  }

  function snapshot() {
    return {
      loading: !!state.loading,
      loaded: !!state.loaded,
      songs: state.songs.map(copySong),
      seedKeys: state.seedKeys.slice(),
      error: state.error,
      updatedAt: state.updatedAt,
    };
  }

  function publish(next) {
    state = Object.assign({}, state, next || {});
    if (typeof options.onStateChange === 'function') options.onStateChange(snapshot());
  }

  function usableCandidate(seed, song, known) {
    if (!song || !song.id) return false;
    var key = songKey(song);
    if (!key || known[key]) return false;
    return typeof options.isCandidateRelevant !== 'function' || options.isCandidateRelevant(seed, song) !== false;
  }

  async function load(records, loadOptions) {
    loadOptions = loadOptions || {};
    var seeds = distinctSeeds(records, {
      songKey: songKey,
      artistKey: options.artistKey,
      limit: loadOptions.seedLimit || 2,
    });
    var seedKeys = seeds.map(songKey);
    if (!seeds.length) {
      publish({ loading: false, loaded: true, songs: [], seedKeys: [], error: '', updatedAt: Date.now() });
      return snapshot();
    }
    if (!loadOptions.force && state.loaded && !state.loading && seedKeys.join('|') === state.seedKeys.join('|')) return snapshot();

    var requestId = state.requestId + 1;
    publish({ loading: true, loaded: false, songs: [], seedKeys: seedKeys, error: '', requestId: requestId });
    var fetchRadio = typeof options.fetchRadio === 'function' ? options.fetchRadio : async function() { return []; };
    var known = {};
    (Array.isArray(records) ? records : []).forEach(function(record) {
      var key = songKey(record);
      if (key) known[key] = true;
    });
    try {
      var failures = [];
      var groups = await Promise.all(seeds.map(async function(seed) {
        var songs;
        try {
          songs = await fetchRadio(copySong(seed), loadOptions.signal);
        } catch (error) {
          failures.push(error);
          return [];
        }
        var seen = {};
        return (Array.isArray(songs) ? songs : []).filter(function(song) {
          var key = songKey(song);
          if (!usableCandidate(seed, song, known) || seen[key]) return false;
          seen[key] = true;
          known[key] = true;
          return true;
        }).map(copySong);
      }));
      if (requestId !== state.requestId) return snapshot();
      var songs = interleave(groups, loadOptions.limit || 10);
      publish({
        loading: false,
        loaded: true,
        songs: songs,
        error: songs.length || !failures.length ? '' : failures[0] && failures[0].message || 'PERSONAL_RADIO_FAILED',
        updatedAt: Date.now(),
      });
    } catch (error) {
      if (requestId !== state.requestId) return snapshot();
      publish({ loading: false, loaded: true, songs: [], error: error && error.message || 'PERSONAL_RADIO_FAILED', updatedAt: Date.now() });
    }
    return snapshot();
  }

  function reset() {
    publish({ loading: false, loaded: false, songs: [], seedKeys: [], error: '', requestId: state.requestId + 1, updatedAt: 0 });
  }

  return { load: load, reset: reset, getState: snapshot };
}

export {
  createPersonalizedRadioController,
  distinctSeeds,
};
