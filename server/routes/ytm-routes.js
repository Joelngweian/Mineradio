'use strict';

const { createRequestAbortScope, isAbortError, pipeWebBodyToResponse } = require('../services/request-lifecycle');

function createYtmRouteHandler(options) {
  const {
    getLoginInfo,
    handleSongUrl,
    radioService,
    audioService,
    getRadioService: getRadioServiceOption,
    getAudioService: getAudioServiceOption,
    sendJSON,
    fetch: fetchImpl = globalThis.fetch,
    userAgent,
    getUserCookie = () => '',
    logger = console,
  } = options || {};
  const getRadioService = typeof getRadioServiceOption === 'function'
    ? getRadioServiceOption
    : (radioService ? () => radioService : null);
  const getAudioService = typeof getAudioServiceOption === 'function'
    ? getAudioServiceOption
    : (audioService ? () => audioService : null);
  if (typeof getLoginInfo !== 'function' || typeof handleSongUrl !== 'function' || typeof getRadioService !== 'function' || typeof getAudioService !== 'function' || typeof sendJSON !== 'function') {
    throw new Error('YTM_ROUTE_DEPENDENCIES_MISSING');
  }

  function playbackSessionId(req, url) {
    const header = req && req.headers && req.headers['x-mineradio-playback-session'];
    const value = String((url && url.searchParams.get('ps')) || header || '').trim();
    return /^[A-Za-z0-9][A-Za-z0-9_.-]{7,95}$/.test(value) ? value : '';
  }

  function attachPlaybackSession(res, sessionId) {
    if (sessionId && res && typeof res.setHeader === 'function') res.setHeader('X-Mineradio-Playback-Session', sessionId);
  }

  function playbackLogPrefix(sessionId) {
    return sessionId ? '[Playback ' + sessionId + ']' : '[Playback]';
  }

  async function handleSongUrlRoute(req, res, url) {
    const sessionId = playbackSessionId(req, url);
    attachPlaybackSession(res, sessionId);
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      logger.log(playbackLogPrefix(sessionId), 'source resolve', sid || '(missing)', quality || 'default');
      const loginInfo = await getLoginInfo();
      const info = await handleSongUrl(sid, loginInfo, quality);
      const payload = {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      };
      if (sessionId) payload.playbackSession = sessionId;
      sendJSON(res, payload);
    } catch (error) {
      logger.error(playbackLogPrefix(sessionId), '[SongUrl]', error);
      sendJSON(res, { error: error.message }, 500);
    }
  }

  async function handleRadioRoute(req, res, url) {
    try {
      const radioService = getRadioService();
      const data = await radioService.getRadioSongs({
        id: url.searchParams.get('id') || '',
        title: url.searchParams.get('title') || '',
        artist: url.searchParams.get('artist') || '',
        limit: parseInt(url.searchParams.get('limit') || '18', 10) || 18,
      });
      sendJSON(res, data);
    } catch (error) {
      logger.error('[Radio]', error && error.message || error);
      sendJSON(res, { error: error.message, songs: [] }, 500);
    }
  }

  async function handleDebugAudioRoute(req, res, url) {
    const sessionId = playbackSessionId(req, url);
    attachPlaybackSession(res, sessionId);
    try {
      const sid = String(url.searchParams.get('id') || '').trim();
      if (!sid) { sendJSON(res, { ok: false, error: 'Missing id（YouTube videoId）' }, 400); return; }
      const started = Date.now();
      try {
        const audioService = getAudioService();
        const fmt = await audioService.resolveAudioFormat(sid, true);
        let upstream = null;
        try {
          const probeStart = fmt.contentLength && fmt.contentLength <= 2097152 ? 0 : 2097152;
          const probeEnd = fmt.contentLength ? Math.min(probeStart + 1023, fmt.contentLength - 1) : probeStart + 1023;
          const probeRange = 'bytes=' + probeStart + '-' + probeEnd;
          const probe = await fetchImpl(fmt.url, { headers: { 'User-Agent': userAgent, Accept: '*/*', Range: probeRange } });
          upstream = { status: probe.status, contentType: probe.headers.get('content-type') || '', range: probeRange };
          try { if (probe.body && probe.body.cancel) await probe.body.cancel(); } catch (error) {}
        } catch (error) {
          upstream = { error: error && error.message || String(error) };
        }
        sendJSON(res, {
          ok: true,
          id: sid,
          client: fmt.client,
          mime: fmt.mime,
          bitrate: fmt.bitrate,
          contentLength: fmt.contentLength,
          poToken: !!fmt.poToken,
          clientFailures: fmt.failures,
          upstream,
          playbackSession: sessionId || undefined,
          loggedIn: !!getUserCookie(),
          ms: Date.now() - started,
        });
      } catch (error) {
        sendJSON(res, { ok: false, id: sid, error: error.message, failures: error.failures || [], loggedIn: !!getUserCookie(), ms: Date.now() - started }, 502);
      }
    } catch (error) {
      sendJSON(res, { ok: false, error: error.message }, 500);
    }
  }

  async function handleAudioRoute(req, res, url) {
    const sessionId = playbackSessionId(req, url);
    attachPlaybackSession(res, sessionId);
    const requestScope = createRequestAbortScope(req, res);
    try {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl) { res.writeHead(400); res.end('Missing url'); return; }
      if (audioUrl.startsWith('ytm:')) {
        const sid = audioUrl.slice(4);
        const range = req.headers.range || '';
        const audioService = getAudioService();
        logger.log(playbackLogPrefix(sessionId), '[YTM Audio Proxy] videoId:', sid, range ? ('range=' + range) : 'full');
        let format = null;
        try {
          format = await audioService.resolveAudioFormat(sid);
        } catch (error) {
          logger.error(playbackLogPrefix(sessionId), '[YTM Audio] resolve failed:', error.message);
        }
        for (let attempt = 0; format && attempt < 2; attempt++) {
          try {
            await audioService.streamDirectFormat(res, format, range, { signal: requestScope.signal });
            return;
          } catch (error) {
            if (requestScope.signal.aborted || isAbortError(error)) return;
            logger.warn(playbackLogPrefix(sessionId), '[YTM Audio] direct proxy failed (' + format.client + '):', error.message);
            audioService.invalidate(sid);
            if (res.headersSent) { try { res.end(); } catch (endError) {} return; }
            if (attempt === 0) {
              try {
                format = await audioService.resolveAudioFormat(sid, true);
                logger.warn(playbackLogPrefix(sessionId), '[YTM Audio] re-resolved fresh url via', format.client, '-> retry');
                continue;
              } catch (retryError) {
                logger.error(playbackLogPrefix(sessionId), '[YTM Audio] re-resolve failed:', retryError.message);
              }
            }
            format = null;
          }
        }
        try {
          await audioService.streamFallback(res, sid, format && format.mime, { signal: requestScope.signal });
          return;
        } catch (error) {
          if (requestScope.signal.aborted || isAbortError(error)) return;
          logger.error(playbackLogPrefix(sessionId), '[YTM Audio] all strategies failed:', error.message);
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'YTM_AUDIO_UNAVAILABLE', message: error.message }));
          return;
        }
      }

      const range = req.headers.range || '';
      const upstreamHeaders = { 'User-Agent': userAgent, Accept: '*/*' };
      if (range) upstreamHeaders.Range = range;
      const upstream = await fetchImpl(audioUrl, { headers: upstreamHeaders, signal: requestScope.signal });
      const headers = {
        'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const length = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      if (length) headers['Content-Length'] = length;
      if (contentRange) headers['Content-Range'] = contentRange;
      res.writeHead(upstream.status, headers);
      await pipeWebBodyToResponse(res, upstream.body, requestScope.signal);
      res.end();
    } catch (error) {
      if (requestScope.signal.aborted || isAbortError(error)) return;
      logger.error('[Audio]', error);
      if (!res.headersSent) res.writeHead(500);
      res.end();
    } finally {
      requestScope.dispose();
    }
  }

  return async function handleYtmRoute(context) {
    const { req, res, url } = context;
    switch (url.pathname) {
      case '/api/song/url':
        await handleSongUrlRoute(req, res, url);
        return true;
      case '/api/radio':
        await handleRadioRoute(req, res, url);
        return true;
      case '/api/debug/audio':
        await handleDebugAudioRoute(req, res, url);
        return true;
      case '/api/audio':
        await handleAudioRoute(req, res, url);
        return true;
      default:
        return false;
    }
  };
}

module.exports = { createYtmRouteHandler };
