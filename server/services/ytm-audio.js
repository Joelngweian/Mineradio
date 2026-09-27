'use strict';

// Audio resolution is kept separate from the request router so retries and
// expiring YouTube URLs have one owner and one cache.

const { Readable } = require('stream');
const { isAbortError, pipeWebBodyToResponse, throwIfAborted, waitForWritable } = require('./request-lifecycle');

const YTM_PLAYER_URL = 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false';
const YTM_PLAYER_CLIENTS = [
  { key: 'WEB_CREATOR_DECIPHER', youtubeiClient: 'WEB_CREATOR' },
  { key: 'WEB_DECIPHER', youtubeiClient: 'WEB' },
  {
    key: 'ANDROID_VR_1.43.32', clientName: 'ANDROID_VR', clientVersion: '1.43.32', clientId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)',
    context: { osName: 'Android', osVersion: '12', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32 },
  },
  {
    key: 'ANDROID_VR_1.61.48', clientName: 'ANDROID_VR', clientVersion: '1.61.48', clientId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
    context: { osName: 'Android', osVersion: '12', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32 },
  },
  {
    key: 'TVHTML5_EMBEDDED', clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', clientId: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    context: {}, embedded: true,
  },
];

function createYtmAudioService(options) {
  const {
    Innertube,
    fetch: fetchImpl = globalThis.fetch,
    requestJson,
    getCookie = () => '',
    getVisitorData,
    getContentPoToken,
    userAgent,
    logger = console,
  } = options || {};
  if (!Innertube || typeof fetchImpl !== 'function' || typeof requestJson !== 'function') {
    throw new Error('YTM_AUDIO_DEPENDENCIES_MISSING');
  }

  const formatCache = new Map();

  function cacheGet(sid) {
    const hit = formatCache.get(sid);
    if (hit && Date.now() < hit.expiresAt) return hit;
    if (hit) formatCache.delete(sid);
    return null;
  }

  function invalidate(sid) {
    formatCache.delete(String(sid || ''));
  }

  function appendPoToken(url, poToken) {
    if (!poToken) return url;
    try {
      const parsed = new URL(url);
      parsed.searchParams.set('pot', poToken);
      return parsed.toString();
    } catch (error) {
      return url + (url.includes('?') ? '&' : '?') + 'pot=' + encodeURIComponent(poToken);
    }
  }

  function mime(fmt) {
    return String((fmt && (fmt.mimeType || fmt.mime_type)) || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  }

  function contentLength(fmt) {
    return Number(fmt && (fmt.contentLength || fmt.content_length) || 0) || 0;
  }

  function normalizeFormat(sid, clientKey, fmt, urlOverride) {
    const directUrl = String(urlOverride || (fmt && fmt.url) || '').trim();
    if (!directUrl || !/^https?:\/\//i.test(directUrl)) throw new Error('NO_DECIPHERED_AUDIO_URL');
    return {
      url: directUrl,
      mime: mime(fmt),
      contentLength: contentLength(fmt),
      bitrate: Number(fmt && fmt.bitrate || 0) || 0,
      itag: (fmt && fmt.itag) || 0,
      client: clientKey,
      sid,
    };
  }

  function pickBestAudioFormat(streamingData) {
    const all = []
      .concat(streamingData && streamingData.adaptiveFormats || [])
      .concat(streamingData && streamingData.formats || []);
    const audio = all.filter(f => f && String(f.mimeType || f.mime_type || '').toLowerCase().startsWith('audio/') &&
      (f.url || f.signatureCipher || f.signature_cipher || f.cipher));
    if (!audio.length) return null;
    const plain = audio.filter(f => f.url);
    const pool = plain.length ? plain : audio;
    const itagRank = { 251: 5, 141: 5, 250: 4, 140: 4, 249: 3, 139: 2 };
    pool.sort((a, b) => {
      const ra = itagRank[a.itag] || 0;
      const rb = itagRank[b.itag] || 0;
      if (rb !== ra) return rb - ra;
      return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
    });
    return pool[0];
  }

  async function fetchYoutubeiFormat(sid, clientDef) {
    const cookie = String(getCookie() || '');
    if (!cookie) throw new Error('LOGIN_REQUIRED_COOKIE_MISSING');
    const poToken = await getContentPoToken(sid);
    const yt = await Innertube.create({ cookie, po_token: poToken });
    const fmt = await yt.getStreamingData(sid, {
      client: clientDef.youtubeiClient,
      type: 'audio',
      quality: 'best',
      po_token: poToken,
    });
    const resolved = normalizeFormat(sid, clientDef.key, fmt);
    resolved.url = appendPoToken(resolved.url, poToken);
    resolved.poToken = true;
    return resolved;
  }

  async function fetchPlayerFormat(sid, clientDef, visitorData) {
    if (clientDef.youtubeiClient) return fetchYoutubeiFormat(sid, clientDef);
    const clientCtx = Object.assign({
      clientName: clientDef.clientName,
      clientVersion: clientDef.clientVersion,
      gl: 'US',
      hl: 'en',
    }, clientDef.context || {});
    if (visitorData) clientCtx.visitorData = visitorData;
    const body = {
      context: { client: clientCtx, user: {} },
      videoId: sid,
      playlistId: null,
      contentCheckOk: true,
      racyCheckOk: true,
    };
    if (clientDef.embedded) body.context.thirdParty = { embedUrl: 'https://www.youtube.com/watch?v=' + sid };
    const headers = {
      'Content-Type': 'application/json',
      'X-Goog-Api-Format-Version': '1',
      'X-YouTube-Client-Name': clientDef.clientId,
      'X-YouTube-Client-Version': clientDef.clientVersion,
      'X-Origin': 'https://music.youtube.com',
      Referer: 'https://music.youtube.com/',
      'User-Agent': clientDef.userAgent,
    };
    if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
    const json = await requestJson(YTM_PLAYER_URL, { method: 'POST', headers }, JSON.stringify(body));
    const status = json && json.playabilityStatus && json.playabilityStatus.status;
    if (status && status !== 'OK') {
      const reason = json.playabilityStatus.reason || json.playabilityStatus.status || 'UNPLAYABLE';
      throw new Error('PLAYABILITY_' + status + ': ' + reason);
    }
    const fmt = pickBestAudioFormat(json && json.streamingData);
    if (!fmt || !fmt.url) throw new Error('NO_PLAIN_AUDIO_URL');
    return normalizeFormat(sid, clientDef.key, fmt);
  }

  async function resolveAudioFormat(sid, forceRefresh) {
    const key = String(sid || '').trim();
    if (!key) throw new Error('MISSING_YTM_VIDEO_ID');
    if (!forceRefresh) {
      const cached = cacheGet(key);
      if (cached) return cached;
    }
    const visitorData = await getVisitorData();
    const failures = [];
    for (const clientDef of YTM_PLAYER_CLIENTS) {
      try {
        const fmt = await fetchPlayerFormat(key, clientDef, visitorData);
        const resolved = {
          sid: key,
          client: clientDef.key,
          url: fmt.url,
          mime: fmt.mime,
          contentLength: fmt.contentLength,
          bitrate: fmt.bitrate,
          itag: fmt.itag,
          poToken: !!fmt.poToken,
          expiresAt: Date.now() + 40 * 60 * 1000,
          failures: failures.slice(),
        };
        formatCache.set(key, resolved);
        if (formatCache.size > 300) formatCache.delete(formatCache.keys().next().value);
        if (failures.length) logger.warn('[YTM Audio] resolved via', clientDef.key, 'after failures:', failures.map(f => f.client + '=' + f.error).join(' | '));
        return resolved;
      } catch (error) {
        failures.push({ client: clientDef.key, error: error && error.message || String(error) });
      }
    }
    const error = new Error('YTM_AUDIO_RESOLVE_FAILED: ' + failures.map(f => f.client + '=' + f.error).join(' | '));
    error.failures = failures;
    throw error;
  }

  async function streamDirectFormat(res, fmt, range, options) {
    const signal = options && options.signal;
    throwIfAborted(signal);
    if (range) {
      const upstream = await fetchImpl(fmt.url, { headers: { 'User-Agent': userAgent, Accept: '*/*', Range: range }, signal });
      if (upstream.status >= 400) throw new Error('UPSTREAM_HTTP_' + upstream.status);
      const headers = {
        'Content-Type': upstream.headers.get('content-type') || fmt.mime,
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      };
      const length = upstream.headers.get('content-length');
      const contentRange = upstream.headers.get('content-range');
      if (length) headers['Content-Length'] = length;
      if (contentRange) headers['Content-Range'] = contentRange;
      res.writeHead(upstream.status, headers);
      await pipeWebBodyToResponse(res, upstream.body, signal);
      res.end();
      return true;
    }

    const chunkSize = 1024 * 1024;
    const total = Number(fmt.contentLength) || 0;
    let position = 0;
    const firstEnd = total ? Math.min(chunkSize - 1, total - 1) : chunkSize - 1;
    let upstream = await fetchImpl(fmt.url, { headers: { 'User-Agent': userAgent, Accept: '*/*', Range: 'bytes=0-' + firstEnd }, signal });
    if (upstream.status >= 400) throw new Error('UPSTREAM_HTTP_' + upstream.status);
    const headers = {
      'Content-Type': fmt.mime,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    if (total) headers['Content-Length'] = String(total);
    res.writeHead(200, headers);
    let buffer = Buffer.from(await upstream.arrayBuffer());
    throwIfAborted(signal);
    if (!res.write(buffer)) await waitForWritable(res, signal);
    position += buffer.length;
    while (total ? position < total : buffer.length >= chunkSize) {
      throwIfAborted(signal);
      const end = total ? Math.min(position + chunkSize - 1, total - 1) : position + chunkSize - 1;
      upstream = await fetchImpl(fmt.url, { headers: { 'User-Agent': userAgent, Accept: '*/*', Range: 'bytes=' + position + '-' + end }, signal });
      if (upstream.status >= 400) break;
      buffer = Buffer.from(await upstream.arrayBuffer());
      if (!buffer.length) break;
      throwIfAborted(signal);
      if (!res.write(buffer)) await waitForWritable(res, signal);
      position += buffer.length;
    }
    res.end();
    return true;
  }

  async function streamFallback(res, sid, fallbackMime, options) {
    const signal = options && options.signal;
    throwIfAborted(signal);
    const poToken = await getContentPoToken(sid, true).catch(() => '');
    const cookie = String(getCookie() || '');
    const yt = poToken
      ? await Innertube.create({ cookie: cookie || undefined, po_token: poToken })
      : await Innertube.create({ cookie: cookie || undefined });
    const stream = await yt.download(sid, {
      client: 'WEB_CREATOR',
      type: 'audio',
      quality: 'best',
      po_token: poToken || undefined,
    });
    const nodeStream = Readable.fromWeb(stream);
    res.writeHead(200, {
      'Content-Type': fallbackMime || 'audio/webm',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache',
    });
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        nodeStream.removeListener('end', onEnd);
        nodeStream.removeListener('close', onClose);
        nodeStream.removeListener('error', onError);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve(true);
      };
      const onEnd = () => finish();
      const onClose = () => finish(signal && signal.aborted ? signal.reason : null);
      const onError = error => {
        if (!isAbortError(error)) logger.error('[YTM Audio Pipe Error]', error && error.message || error);
        finish(error);
      };
      const onAbort = () => {
        try { nodeStream.destroy(signal.reason); } catch (_) {}
      };
      nodeStream.once('end', onEnd);
      nodeStream.once('close', onClose);
      nodeStream.once('error', onError);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      nodeStream.pipe(res);
    });
  }

  function clear() {
    formatCache.clear();
  }

  return {
    resolveAudioFormat,
    streamDirectFormat,
    streamFallback,
    invalidate,
    clear,
    getState: () => ({ cachedFormats: formatCache.size }),
    getClientKeys: () => YTM_PLAYER_CLIENTS.map(client => client.key),
  };
}

module.exports = { createYtmAudioService, YTM_PLAYER_CLIENTS };
