  function createRadioQueueController(options) {
    options = options || {};
    var state = {
      fetching: false,
      seedId: '',
      primeSerial: 0,
      status: 'idle',
      seed: null,
      attempt: 0,
      retryable: false,
      lastPrimeError: null,
    };

    function snapshotState() {
      return {
        fetching: !!state.fetching,
        seedId: state.seedId,
        primeSerial: state.primeSerial,
        status: state.status,
        seed: state.seed ? Object.assign({}, state.seed) : null,
        attempt: state.attempt,
        retryable: !!state.retryable,
      };
    }

    function setPrimeState(status, song, attempt, error) {
      state = Object.assign({}, state, {
        status: status,
        seed: song ? Object.assign({}, song) : null,
        attempt: Math.max(0, Number(attempt) || 0),
        retryable: status === 'error',
        lastPrimeError: error || null,
      });
      if (typeof options.onStateChange === 'function') options.onStateChange(snapshotState());
    }

    function enabled() {
      return typeof options.isEnabled !== 'function' || options.isEnabled() !== false;
    }

    function providerKey(song) {
      return typeof options.songProviderKey === 'function' ? options.songProviderKey(song) : 'youtube';
    }

    function requestSignal() {
      return typeof options.getSignal === 'function' ? options.getSignal() : null;
    }

    function isLocalOrPodcast(song) {
      return !!(song && (song.type === 'podcast' || song.type === 'local' || song.source === 'local'));
    }

    async function fetchForSeed(song, signal) {
      if (!enabled() || !song || isLocalOrPodcast(song)) return [];
      var seed = providerKey(song) === 'youtube' ? (song.id || '') : '';
      var title = song.name || '';
      var artist = song.artist || '';
      if (!seed && !title) return [];
      var params = [];
      if (seed) params.push('id=' + encodeURIComponent(seed));
      params.push('title=' + encodeURIComponent(title));
      params.push('artist=' + encodeURIComponent(artist));
      params.push('limit=18');
      var requestOptions = { signal: signal === undefined ? requestSignal() : signal };
      var response = await options.apiJson('/api/radio?' + params.join('&'), requestOptions);
      var songs = response && response.songs || [];
      var isUseful = typeof options.isUsefulRadioSong === 'function' ? options.isUsefulRadioSong : function(item) { return !!item; };
      return Array.isArray(songs) ? songs.filter(isUseful) : [];
    }

    function schedulePrimeRetry(song, serial, attempt) {
      attempt = Number(attempt) || 0;
      if (serial !== state.primeSerial || !song) return;
      if (attempt >= 3 || typeof options.setTimeout !== 'function') {
        setPrimeState('error', song, attempt, state.lastPrimeError || new Error('RADIO_RECOMMENDATIONS_EMPTY'));
        return;
      }
      var delay = [700, 1800, 3600][attempt] || 3600;
      setPrimeState('loading', song, attempt + 1, null);
      options.setTimeout(function() {
        if (serial !== state.primeSerial) return;
        var findSeed = typeof options.findSeedIndex === 'function' ? options.findSeedIndex : function() { return 0; };
        var hasRecommendation = typeof options.hasRecommendationAfterSeed === 'function' ? options.hasRecommendationAfterSeed : function() { return false; };
        if (findSeed(song) < 0 || hasRecommendation(song)) return;
        prime(song, attempt + 1);
      }, delay);
    }

    async function prime(song, attempt) {
      attempt = Number(attempt) || 0;
      var serial = ++state.primeSerial;
      var signal = requestSignal();
      setPrimeState('loading', song, attempt, null);
      try {
        var recommendations = await fetchForSeed(song, signal);
        if (serial !== state.primeSerial || (signal && signal.aborted)) return 0;
        var apply = typeof options.applyRecommendations === 'function' ? options.applyRecommendations : function() { return 0; };
        var added = apply(song, recommendations, { replaceTail: true, requireCurrent: false, reason: 'radio-prime' }) || 0;
        if (added) {
          state = Object.assign({}, state, { seedId: song && song.id || state.seedId });
          setPrimeState('ready', song, attempt, null);
        } else {
          state = Object.assign({}, state, { lastPrimeError: new Error('RADIO_RECOMMENDATIONS_EMPTY') });
          schedulePrimeRetry(song, serial, attempt);
        }
        return added;
      } catch (error) {
        if (serial === state.primeSerial && !(signal && signal.aborted) && !(error && error.isAbort)) {
          state = Object.assign({}, state, { lastPrimeError: error });
          schedulePrimeRetry(song, serial, attempt);
          if (typeof options.onError === 'function') options.onError(error, 'prime');
        }
        return 0;
      }
    }

    async function extend(song) {
      if (!enabled() || state.fetching || !song || providerKey(song) !== 'youtube' || isLocalOrPodcast(song)) return 0;
      var getCurrentIndex = typeof options.getCurrentIndex === 'function' ? options.getCurrentIndex : function() { return -1; };
      var getQueueLength = typeof options.getQueueLength === 'function' ? options.getQueueLength : function() { return 0; };
      if (getCurrentIndex() < 0 || getCurrentIndex() < getQueueLength() - 1) return 0;
      var seed = song.id || '';
      if (!seed || state.seedId === seed) return 0;
      state.fetching = true;
      var signal = requestSignal();
      try {
        var recommendations = await fetchForSeed(song, signal);
        if (signal && signal.aborted) return 0;
        var apply = typeof options.applyRecommendations === 'function' ? options.applyRecommendations : function() { return 0; };
        var added = apply(song, recommendations, { replaceTail: false, requireCurrent: true, reason: 'radio-extend' }) || 0;
        if (added) state.seedId = seed;
        return added;
      } catch (error) {
        if (!(signal && signal.aborted) && !(error && error.isAbort) && typeof options.onError === 'function') options.onError(error, 'extend');
        return 0;
      } finally {
        state.fetching = false;
      }
    }

    function reset() {
      state = Object.assign({}, state, { fetching: false, seedId: '', primeSerial: state.primeSerial + 1 });
      setPrimeState('idle', null, 0, null);
    }

    function retry() {
      if (state.status === 'loading' || !state.seed) return Promise.resolve(0);
      return prime(Object.assign({}, state.seed), 0);
    }

    return {
      fetchForSeed: fetchForSeed,
      prime: prime,
      extend: extend,
      reset: reset,
      retry: retry,
      getState: snapshotState,
    };
  }

export {
  createRadioQueueController as create,
};
