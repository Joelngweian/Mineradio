'use strict';

const LRCLIB_BASE = 'https://lrclib.net/api';
const LRCLIB_UA = 'Mineradio/1.2.0 (https://github.com/XxHuberrr/Mineradio)';
const LRCLIB_HEADERS = { 'User-Agent': LRCLIB_UA, Accept: 'application/json' };

function createLyricsService(options) {
  const {
    requestJson,
    getYTMusic = async () => { throw new Error('YTM_UNAVAILABLE'); },
    userAgent = 'Mineradio',
    logger = console,
  } = options || {};
  if (typeof requestJson !== 'function') throw new Error('LYRICS_SERVICE_REQUEST_JSON_REQUIRED');

  const lrcLibCache = new Map();
  const neteaseTlyricCache = new Map();
  const neteaseLyricHeaders = { 'User-Agent': userAgent, Referer: 'https://music.163.com/' };

  function primaryArtistName(artist) {
    return String(artist || '').split(/\s*\/\s*|、|,|&|feat\.?|ft\.?/i)[0].trim();
  }

  function cleanTitle(name) {
    let title = String(name || '');
    title = title.split(/\s*[|｜]\s*/)[0];
    title = title.replace(/[『「][^』」]*[』」]/g, ' ');
    title = title.replace(/[\(\[（【][^\)\]）】]*(?:official|video|audio|lyric|lyrics|visuali[sz]er|mv|m\/v|hd|4k|hq|remaster(?:ed)?|live|cover|instrumental|karaoke|full\s*ver(?:sion)?|フルバージョン|完整版|高音质|无损|抖音|热歌|純音[樂楽]|OST|ost)[^\)\]）】]*[\)\]）】]/gi, '');
    title = title.replace(/\s*[\(\[]?\s*(?:feat\.?|ft\.?)\s+[^\)\]]*[\)\]]?/gi, '');
    title = title.replace(/\s*[-–—]\s*(?:アニメ|anime|OST|ost|主題歌|主题歌|オープニング|エンディング|挿入歌|テーマ|opening|ending|theme|插曲|片頭曲|片头曲|片尾曲|名場面)[\s\S]*$/i, '');
    title = title.replace(/\s*-\s*topic\s*$/i, '');
    title = title.replace(/【[^】]*】/g, '');
    return title.replace(/\s{2,}/g, ' ').trim();
  }

  function isPlaceholderArtist(artist) {
    const value = String(artist || '').trim().toLowerCase();
    return !value || value === 'unknown artist' || value === 'unknown' || value === 'various artists'
      || value === 'va' || value === 'v.a.' || value === 'artist' || value === '未知歌手' || value === '未知艺术家' || value === '群星';
  }

  function featArtistFromTitle(name) {
    const match = String(name || '').match(/(?:^|[\s(\[（【「『])(?:feat\.?|ft\.?|featuring)\s+([^\)\]\-|｜、,]+)/i);
    return match ? match[1].replace(/[)\]】』」]/g, '').trim() : '';
  }

  function cleanArtist(artist) {
    const value = primaryArtistName(artist).replace(/\s*-\s*topic\s*$/i, '').replace(/\s*vevo\s*$/i, '').trim();
    return isPlaceholderArtist(value) ? '' : value;
  }

  function normalizeMatchKey(value) {
    return String(value || '').toLowerCase()
      .replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, ' ')
      .replace(/[^0-9a-z぀-ヿ㐀-鿿가-힣]+/g, '')
      .trim();
  }

  function matchKeyContains(a, b) {
    const left = normalizeMatchKey(a);
    const right = normalizeMatchKey(b);
    return !!(left && right && (left.includes(right) || right.includes(left)));
  }

  async function lrcLibGet(artist, track, album, durationSec) {
    const url = new URL(LRCLIB_BASE + '/get');
    url.searchParams.set('artist_name', artist);
    url.searchParams.set('track_name', track);
    if (album) url.searchParams.set('album_name', album);
    if (durationSec > 0) url.searchParams.set('duration', String(durationSec));
    const body = await requestJson(url.toString(), { headers: LRCLIB_HEADERS });
    return body && (body.syncedLyrics || body.plainLyrics)
      ? { synced: body.syncedLyrics || '', plain: body.plainLyrics || '', source: 'lrclib-get' }
      : null;
  }

  async function lrcLibSearch(track, artist, durationSec) {
    const url = new URL(LRCLIB_BASE + '/search');
    url.searchParams.set('track_name', track);
    if (artist) url.searchParams.set('artist_name', artist);
    const list = await requestJson(url.toString(), { headers: LRCLIB_HEADERS });
    if (!Array.isArray(list) || !list.length) return null;
    const best = list.map(item => {
      const titleOk = matchKeyContains(item.trackName || item.name, track);
      const artistOk = artist ? matchKeyContains(item.artistName, artist) : false;
      const diff = durationSec > 0 && item.duration ? Math.abs(Number(item.duration) - durationSec) : 999;
      let score = 0;
      if (item.syncedLyrics) score += 10;
      if (titleOk) score += 4;
      if (artistOk) score += 5;
      if (durationSec > 0 && item.duration) {
        if (diff <= 2) score += 6;
        else if (diff <= 5) score += 3;
        else if (diff > 25) score -= 5;
      }
      return { item, score, titleOk, artistOk, diff };
    }).sort((a, b) => b.score - a.score)[0];
    if (!best || !best.titleOk || (!best.artistOk && !(durationSec > 0 && best.diff <= 8))) return null;
    return best.item && (best.item.syncedLyrics || best.item.plainLyrics)
      ? { synced: best.item.syncedLyrics || '', plain: best.item.plainLyrics || '', source: 'lrclib-search' }
      : null;
  }

  async function fetchLrcLibLyrics(opts) {
    opts = opts || {};
    const rawTrack = String(opts.track || '').trim();
    if (!rawTrack) return null;
    const cleanedTrack = cleanTitle(rawTrack) || rawTrack;
    const artist = cleanArtist(opts.artist);
    const album = String(opts.album || '').trim();
    const durationSec = Math.round(Number(opts.durationSec || 0)) || 0;
    const cacheKey = (cleanedTrack + '|' + artist + '|' + durationSec).toLowerCase();
    if (lrcLibCache.has(cacheKey)) return lrcLibCache.get(cacheKey);

    const tracks = cleanedTrack.toLowerCase() === rawTrack.toLowerCase() ? [cleanedTrack] : [cleanedTrack, rawTrack];
    const attempts = [];
    tracks.forEach(track => {
      if (artist) attempts.push(() => lrcLibGet(artist, track, album, durationSec));
      attempts.push(() => lrcLibSearch(track, artist, durationSec));
    });
    const inflight = attempts.map(attempt => attempt().catch(() => null));
    let result = null;
    for (const pending of inflight) {
      const candidate = await pending;
      if (candidate && (candidate.synced || candidate.plain)) {
        result = candidate;
        break;
      }
    }
    lrcLibCache.set(cacheKey, result);
    if (lrcLibCache.size > 500) lrcLibCache.delete(lrcLibCache.keys().next().value);
    return result;
  }

  function looksCJK(text) {
    return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3]/.test(String(text || ''));
  }

  async function neteaseSearchSongId(track, artist, durationSec) {
    const query = (String(track || '') + ' ' + String(artist || '')).trim();
    if (!query) return null;
    const url = new URL('https://music.163.com/api/search/get');
    url.searchParams.set('s', query);
    url.searchParams.set('type', '1');
    url.searchParams.set('limit', '10');
    const body = await requestJson(url.toString(), { headers: neteaseLyricHeaders, timeoutMs: 5000 });
    const songs = body && body.result && body.result.songs || [];
    let best = null;
    let bestScore = -1;
    for (const song of songs) {
      if (!matchKeyContains(song.name, track)) continue;
      const artistText = (song.artists || []).map(item => item && item.name).filter(Boolean).join(' ');
      if (!artist || !matchKeyContains(artistText, artist)) continue;
      const duration = Number(song.duration) || 0;
      const difference = durationSec > 0 && duration ? Math.abs(duration / 1000 - durationSec) : 999;
      const score = 10 + Math.max(0, 8 - difference);
      if (score > bestScore) {
        best = song;
        bestScore = score;
      }
    }
    return best ? best.id : null;
  }

  async function fetchNeteaseLyric(opts) {
    opts = opts || {};
    const track = cleanTitle(opts.name) || String(opts.name || '').trim();
    const artist = cleanArtist(opts.artist);
    if (!track) return null;
    const durationSec = Math.round(Number(opts.durationSec || 0)) || 0;
    const cacheKey = ('ne|' + track + '|' + artist + '|' + durationSec).toLowerCase();
    if (neteaseTlyricCache.has(cacheKey)) return neteaseTlyricCache.get(cacheKey);
    let result = null;
    try {
      const id = await neteaseSearchSongId(track, artist, durationSec);
      if (id) {
        const url = new URL('https://music.163.com/api/song/lyric');
        url.searchParams.set('id', String(id));
        url.searchParams.set('lv', '1');
        url.searchParams.set('kv', '1');
        url.searchParams.set('tv', '1');
        const body = await requestJson(url.toString(), { headers: neteaseLyricHeaders, timeoutMs: 6000 });
        const transLrc = body && body.tlyric && body.tlyric.lyric ? String(body.tlyric.lyric).trim() : '';
        const origLrc = body && body.lrc && body.lrc.lyric ? String(body.lrc.lyric).trim() : '';
        if ((origLrc && /\[\d+:\d+/.test(origLrc)) || (transLrc && /\[\d+:\d+/.test(transLrc))) {
          result = { origLrc, transLrc, source: 'netease' };
        }
      }
    } catch (error) {
      logger.warn('[NeteaseLyric]', error.message);
    }
    neteaseTlyricCache.set(cacheKey, result);
    if (neteaseTlyricCache.size > 500) neteaseTlyricCache.delete(neteaseTlyricCache.keys().next().value);
    return result;
  }

  async function tryNeteaseOriginal(meta) {
    const lyric = await fetchNeteaseLyric({ name: meta.name, artist: meta.artist, durationSec: meta.durationSec });
    return lyric && lyric.origLrc && /\[\d+:\d+/.test(lyric.origLrc)
      ? { lyric: lyric.origLrc, source: 'netease' }
      : null;
  }

  async function resolve(meta) {
    meta = meta || {};
    if (isPlaceholderArtist(meta.artist)) meta = Object.assign({}, meta, { artist: featArtistFromTitle(meta.name) });
    let result = { lyric: '', source: 'empty' };
    const lrcArgs = { track: meta.name, artist: meta.artist, album: meta.album, durationSec: meta.durationSec };
    if (looksCJK(meta.name) || looksCJK(meta.artist)) {
      result = await tryNeteaseOriginal(meta) || result;
      if (!result.lyric) {
        const lyric = await fetchLrcLibLyrics(lrcArgs);
        if (lyric && lyric.synced) result = { lyric: lyric.synced, source: lyric.source };
        else if (lyric && lyric.plain) result = { lyric: lyric.plain, source: lyric.source + '-plain' };
      }
    } else {
      const lyric = await fetchLrcLibLyrics(lrcArgs);
      if (lyric && lyric.synced) result = { lyric: lyric.synced, source: lyric.source };
      else if (lyric && lyric.plain) result = { lyric: lyric.plain, source: lyric.source + '-plain' };
      if (!result.lyric) result = await tryNeteaseOriginal(meta) || result;
    }
    if (!result.lyric && meta.videoId) {
      try {
        const yt = await getYTMusic();
        const lyrics = await yt.music.getLyrics(meta.videoId);
        const text = lyrics && lyrics.description && lyrics.description.text ? String(lyrics.description.text) : '';
        if (text) result = { lyric: text, source: 'youtube' };
      } catch (error) {
        logger.warn('[Lyric YTM]', error.message);
      }
    }
    const synced = /\[\d+:\d+/.test(result.lyric || '');
    logger.log('[Lyric] "' + (meta.name || '') + '" / "' + (meta.artist || '') + '" -> ' + result.source + (result.lyric ? (synced ? ' (synced)' : ' (plain)') : ' NONE'));
    return result;
  }

  async function googleTranslateLines(lines, to) {
    const target = to || 'zh-CN';
    const output = [];
    const chunkSize = 40;
    for (let offset = 0; offset < lines.length; offset += chunkSize) {
      const chunk = lines.slice(offset, offset + chunkSize);
      let translated = '';
      try {
        const url = new URL('https://translate.googleapis.com/translate_a/single');
        url.searchParams.set('client', 'gtx');
        url.searchParams.set('sl', 'auto');
        url.searchParams.set('tl', target);
        url.searchParams.set('dt', 't');
        url.searchParams.set('q', chunk.join('\n'));
        const body = await requestJson(url.toString(), { headers: { 'User-Agent': userAgent, Accept: 'application/json' } });
        if (Array.isArray(body) && Array.isArray(body[0])) translated = body[0].map(segment => segment && segment[0] || '').join('');
      } catch (error) {
        logger.warn('[Translate]', error.message);
      }
      const parts = translated.split('\n');
      chunk.forEach((line, index) => output.push(parts[index] != null ? String(parts[index]).trim() : ''));
    }
    return output;
  }

  function parseLrcEntries(lrc) {
    const output = [];
    String(lrc || '').split(/\r?\n/).forEach(raw => {
      const tags = raw.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g);
      if (!tags) return;
      const text = raw.replace(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g, '').trim();
      tags.forEach(tag => {
        const match = tag.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/);
        if (match) output.push({ t: Math.round((parseInt(match[1], 10) * 60 + parseFloat(match[2].replace(':', '.'))) * 1000), text });
      });
    });
    return output;
  }

  function normLyricLine(value) {
    return String(value || '').toLowerCase().replace(/[\s\u3000.,!?，。！？、…「」『』"'`\-—~()（）\[\]]+/g, '').trim();
  }

  function buildNeteaseTransMap(origLrc, transLrc) {
    const translatedByTime = {};
    parseLrcEntries(transLrc).forEach(entry => { if (entry.text) translatedByTime[entry.t] = entry.text; });
    const map = {};
    parseLrcEntries(origLrc).forEach(entry => {
      const translated = translatedByTime[entry.t];
      const key = normLyricLine(entry.text);
      if (translated && key && !map[key]) map[key] = translated;
    });
    return map;
  }

  async function translate(input) {
    input = input || {};
    const lines = Array.isArray(input.lines) ? input.lines.map(line => String(line == null ? '' : line)) : [];
    const to = String(input.to || 'zh-CN');
    const name = String(input.name || '');
    const artist = String(input.artist || '');
    const durationSec = Number(input.duration || 0) || 0;
    if (!lines.length) return { translated: [], source: 'empty' };
    if (/^zh/i.test(to) && name) {
      try {
        const netease = await fetchNeteaseLyric({ name, artist, durationSec });
        if (netease && netease.transLrc) {
          const map = netease.origLrc ? buildNeteaseTransMap(netease.origLrc, netease.transLrc) : {};
          const translated = lines.map(line => map[normLyricLine(line)] || '');
          const matched = translated.filter(Boolean).length;
          if (matched >= Math.max(2, Math.floor(lines.length * 0.4))) {
            const missing = translated.map((line, index) => line ? -1 : index).filter(index => index >= 0);
            if (missing.length) {
              const fallback = await googleTranslateLines(missing.map(index => lines[index]), to);
              missing.forEach((index, fallbackIndex) => { translated[index] = fallback[fallbackIndex] || ''; });
            }
            logger.log('[LyricTranslate] 网易云人工翻译命中(对齐 ' + matched + '/' + lines.length + '):', name);
            return { translated, source: 'netease-aligned' };
          }
        }
      } catch (error) {
        logger.warn('[LyricTranslate netease]', error.message);
      }
    }
    return { translated: await googleTranslateLines(lines, to), source: 'google' };
  }

  async function debug(meta) {
    meta = meta || {};
    const name = String(meta.name || '');
    const artist = String(meta.artist || '');
    const album = String(meta.album || '');
    const id = String(meta.videoId || meta.id || '');
    const durationSec = Number(meta.durationSec || meta.duration || 0) || 0;
    const track = cleanTitle(name);
    const clean = cleanArtist(artist);
    const report = { input: { name, artist, album, durationSec, id }, cleaned: { track, artist: clean }, steps: [] };
    try {
      const url = new URL(LRCLIB_BASE + '/get');
      url.searchParams.set('artist_name', clean);
      url.searchParams.set('track_name', track);
      if (durationSec > 0) url.searchParams.set('duration', String(durationSec));
      const body = await requestJson(url.toString(), { headers: LRCLIB_HEADERS });
      report.steps.push({ step: 'lrclib-get', ok: true, hasSynced: !!(body && body.syncedLyrics), hasPlain: !!(body && body.plainLyrics), matchedArtist: body && body.artistName, matchedTrack: body && body.trackName, matchedDuration: body && body.duration });
    } catch (error) {
      report.steps.push({ step: 'lrclib-get', ok: false, error: error.message + (error.statusCode ? ' [HTTP ' + error.statusCode + ']' : '') });
    }
    try {
      const url = new URL(LRCLIB_BASE + '/search');
      url.searchParams.set('track_name', track);
      if (clean) url.searchParams.set('artist_name', clean);
      const list = await requestJson(url.toString(), { headers: LRCLIB_HEADERS });
      report.steps.push({ step: 'lrclib-search', ok: true, count: Array.isArray(list) ? list.length : 0, top: (Array.isArray(list) ? list : []).slice(0, 5).map(item => ({ artist: item.artistName, track: item.trackName, duration: item.duration, synced: !!item.syncedLyrics })) });
    } catch (error) {
      report.steps.push({ step: 'lrclib-search', ok: false, error: error.message + (error.statusCode ? ' [HTTP ' + error.statusCode + ']' : '') });
    }
    const result = await resolve({ name, artist, album, durationSec, videoId: id });
    report.result = { source: result.source, hasLyric: !!result.lyric, synced: /\[\d+:\d+/.test(result.lyric || ''), preview: (result.lyric || '').slice(0, 120) };
    return report;
  }

  return { resolve, translate, debug, cleanTitle, cleanArtist, buildNeteaseTransMap };
}

module.exports = { createLyricsService };
