function runtimeNow(options) {
  if (options && typeof options.now === 'function') return options.now;
  return function() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
    return Date.now();
  };
}

function boundedText(value, maxLength) {
  var text = String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? text.slice(0, maxLength - 1) + '...' : text;
}

function finiteNumber(value, fallback) {
  var number = Number(value);
  return isFinite(number) ? number : fallback;
}

function mediaErrorName(code) {
  return {
    1: 'MEDIA_ERR_ABORTED',
    2: 'MEDIA_ERR_NETWORK',
    3: 'MEDIA_ERR_DECODE',
    4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
  }[Number(code)] || 'MEDIA_ERR_UNKNOWN';
}

function snapshotTrack(song) {
  song = song || {};
  return {
    id: boundedText(song.id || song.videoId || song.bvid, 100),
    name: boundedText(song.name || song.title, 160),
    artist: boundedText(song.artist || song.author || song.creator, 120),
    source: boundedText(song.source || song.provider || song.platform, 48),
    type: boundedText(song.type, 48),
  };
}

function snapshotError(error) {
  error = error || {};
  return {
    name: boundedText(error.name, 80) || 'Error',
    code: boundedText(error.code, 80),
    status: finiteNumber(error.status, 0),
    message: boundedText(error.message || error, 240),
  };
}

function snapshotMedia(audio) {
  var mediaError = audio && audio.error;
  return {
    readyState: finiteNumber(audio && audio.readyState, 0),
    networkState: finiteNumber(audio && audio.networkState, 0),
    currentTime: Math.max(0, finiteNumber(audio && audio.currentTime, 0)),
    duration: Math.max(0, finiteNumber(audio && audio.duration, 0)),
    paused: !!(audio && audio.paused),
    ended: !!(audio && audio.ended),
    error: mediaError ? {
      code: finiteNumber(mediaError.code, 0),
      name: mediaErrorName(mediaError.code),
      message: boundedText(mediaError.message, 180),
    } : null,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createPlaybackObservability(options) {
  options = options || {};
  var now = runtimeNow(options);
  var maxSessions = Math.max(1, finiteNumber(options.maxSessions, 8));
  var maxEventsPerSession = Math.max(1, finiteNumber(options.maxEventsPerSession, 72));
  var sessions = [];
  var active = null;

  function addEvent(session, type, stage, details) {
    if (!session) return false;
    var event = {
      atMs: Math.max(0, Math.round(now() - session.startedAt)),
      type: boundedText(type, 32),
      stage: boundedText(stage, 80),
    };
    if (details && Object.keys(details).length) event.details = details;
    session.events.push(event);
    if (session.events.length > maxEventsPerSession) session.events.splice(0, session.events.length - maxEventsPerSession);
    return true;
  }

  function isActiveToken(token) {
    return !!active && (token == null || Number(token) === Number(active.token));
  }

  function closeActive(status, details) {
    if (!active || active.finishedAt != null) return false;
    active.status = boundedText(status || 'finished', 48);
    active.finishedAt = now();
    addEvent(active, 'session', 'session-' + active.status, details || null);
    return true;
  }

  function begin(meta) {
    meta = meta || {};
    if (active) closeActive('superseded');
    var token = finiteNumber(meta.token, 0);
    active = {
      token: token,
      sessionId: boundedText(meta.sessionId || meta.id, 100),
      startedAt: now(),
      finishedAt: null,
      status: 'active',
      index: finiteNumber(meta.index, -1),
      track: snapshotTrack(meta.song || meta.track || meta),
      events: [],
    };
    sessions.push(active);
    if (sessions.length > maxSessions) sessions.splice(0, sessions.length - maxSessions);
    addEvent(active, 'session', 'session-start', { context: boundedText(meta.context, 48) });
    return active.token;
  }

  function mark(stage, details, token) {
    if (!isActiveToken(token)) return false;
    return addEvent(active, 'phase', stage, details || null);
  }

  function fail(stage, error, details, token) {
    if (!isActiveToken(token)) return false;
    var eventDetails = Object.assign({}, details || {}, { error: snapshotError(error) });
    return addEvent(active, 'failure', stage, eventDetails);
  }

  function finish(status, details, token) {
    if (!isActiveToken(token)) return false;
    return closeActive(status, details);
  }

  function bindAudio(audio, getToken) {
    if (!audio || typeof audio.addEventListener !== 'function' || audio._mineradioObservabilityBound) return function() {};
    audio._mineradioObservabilityBound = true;
    var names = ['loadstart', 'loadedmetadata', 'canplay', 'playing', 'waiting', 'stalled', 'suspend', 'abort', 'pause', 'ended', 'emptied', 'error'];
    var listeners = [];
    names.forEach(function(name) {
      var listener = function() {
        var token = typeof getToken === 'function' ? getToken() : null;
        var media = snapshotMedia(audio);
        if (name === 'error') {
          fail('media-error', media.error || { name: 'MediaError', message: '音频元素报告错误' }, { media: media }, token);
          return;
        }
        mark('media-' + name, { media: media }, token);
      };
      audio.addEventListener(name, listener);
      listeners.push({ name: name, listener: listener });
    });
    return function() {
      listeners.forEach(function(item) {
        if (typeof audio.removeEventListener === 'function') audio.removeEventListener(item.name, item.listener);
      });
      audio._mineradioObservabilityBound = false;
    };
  }

  function snapshot() {
    return clone({
      activeToken: active && active.finishedAt == null ? active.token : null,
      sessions: sessions,
    });
  }

  function clear() {
    sessions.length = 0;
    active = null;
  }

  return {
    begin: begin,
    mark: mark,
    fail: fail,
    finish: finish,
    bindAudio: bindAudio,
    snapshot: snapshot,
    clear: clear,
  };
}

export {
  createPlaybackObservability,
};
