// ====================================================================
//  粒子音乐可视化播放器 — Server v2 (Metrolist YouTube Music Engine)
//  - YouTube Music 原生搜索 / 歌单 / 封面 / 音频流代理
//  - Google Cookie 持久化及认证
// ====================================================================
// Windows 控制台默认代码页(GBK/936)会把 UTF-8 中文日志显示成乱码；切到 UTF-8(65001)
function applyWindowsUtf8Console() {
  if (process.stdout && process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');
  if (process.stderr && process.stderr.setDefaultEncoding) process.stderr.setDefaultEncoding('utf8');
  if (process.platform === 'win32') {
    try { require('child_process').execSync('chcp 65001', { stdio: 'ignore' }); } catch (e) {}
  }
}
applyWindowsUtf8Console();
const vm = require('vm');
const { createYtmSession } = require('./server/services/ytm-session');
const { createYtmAudioService } = require('./server/services/ytm-audio');
const { createRadioService } = require('./server/services/radio-service');
const { createLyricsService } = require('./server/services/lyrics-service');
const { createLoginService } = require('./server/services/login-service');
const { createYtmRouteHandler } = require('./server/routes/ytm-routes');
const { snapshotRuntimeDiagnostics } = require('./server/services/runtime-diagnostics');

let ytmSession = null;
let ytmAudioService = null;
let radioService = null;
let ytmRuntime = null;
let loginService = null;
function getYtmRuntime() {
  if (ytmRuntime) return ytmRuntime;
  const { Innertube, Platform } = require('youtubei.js');
  // 注入 Node 环境下的 JavaScript Evaluator (解决 YouTube 签名解密 No valid URL to decipher 报错)
  Platform.shim.eval = async (data, env) => vm.runInNewContext(`(function() { ${data.output} })()`, env);
  ytmRuntime = { Innertube };
  return ytmRuntime;
}
function LazyJSDOM(...args) {
  const { JSDOM } = require('jsdom');
  return new JSDOM(...args);
}
async function getYTMusic(customCookie) {
  ensureYtmServices();
  return ytmSession.getYTMusic(customCookie);
}
function isYtmLikedPlaylistId(playlistId) {
  const id = String(playlistId || '').trim().toUpperCase();
  return id === 'VLLM' || id === 'LM' || id === 'YOUTUBE-LIKED';
}
function normalizeYtmPlaylistEditId(playlistId) {
  const id = String(playlistId || '').trim();
  if (!id || isYtmLikedPlaylistId(id)) return id;
  return id.startsWith('VL') ? id.slice(2) : id;
}
async function likeYtmSong(yt, videoId, liked) {
  const id = String(videoId || '').trim();
  if (!id) throw new Error('MISSING_SONG_ID');
  if (!yt || !yt.interact) throw new Error('YTM_INTERACTION_UNAVAILABLE');
  try {
    return liked ? await yt.interact.like(id) : await yt.interact.removeRating(id);
  } catch (err) {
    const msg = String(err && err.message || err || '');
    if (liked && /already liked/i.test(msg)) return { already: true };
    if (!liked && /not liked|not liked\/disliked/i.test(msg)) return { already: true };
    throw err;
  }
}
function ytmText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (value.text) return ytmText(value.text);
  if (value.name) return ytmText(value.name);
  if (value.title) return ytmText(value.title);
  if (value.simpleText) return ytmText(value.simpleText);
  if (Array.isArray(value.runs)) return value.runs.map(r => ytmText(r && (r.text || r))).filter(Boolean).join('');
  return '';
}
function ytmRuns(value) {
  if (!value) return [];
  if (Array.isArray(value.runs)) return value.runs;
  if (value.title) return ytmRuns(value.title);
  if (value.text && typeof value.text === 'object') return ytmRuns(value.text);
  return [];
}
function ytmThumbnails(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.thumbnails)) return value.thumbnails;
  if (Array.isArray(value.contents)) return value.contents;
  if (value.thumbnail) return ytmThumbnails(value.thumbnail);
  return [];
}
function ytmPeople(value) {
  const list = Array.isArray(value) ? value : (value ? [value] : []);
  return list.map((a) => {
    const name = ytmText(a);
    return { id: (a && (a.channel_id || a.id || a.browse_id)) || '', name };
  }).filter(a => a.name);
}
function ytmFlexColumnRuns(item, index) {
  const columns = (item && (item.flex_columns || item.flexColumns)) || [];
  const column = columns[index];
  return ytmRuns(column && (column.title || column.text || column));
}
function isYtmMetadataSeparator(text) {
  return /^(?:[•·|]|[-–—])+$/.test(String(text || '').trim());
}
function normalizeYtmArtistName(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*&\s*/g, ' & ')
    .trim();
}
function ytmArtistFallbackFromFlexColumns(item, albumName) {
  const groups = [[]];
  for (const run of ytmFlexColumnRuns(item, 1)) {
    const text = ytmText(run && (run.text || run));
    const trimmed = text.trim();
    if (!trimmed) continue;
    if (isYtmMetadataSeparator(trimmed)) {
      if (groups[groups.length - 1].length) groups.push([]);
      continue;
    }
    if (/^\d{1,2}:\d{2}(?::\d{2})?$/.test(trimmed)) break;
    groups[groups.length - 1].push(text);
  }
  const firstGroup = normalizeYtmArtistName((groups[0] || []).join(''));
  if (!firstGroup || firstGroup === normalizeYtmArtistName(albumName)) return '';
  return firstGroup;
}

function mapYTMItem(item) {
  if (!item || !item.id) return null;
  // 封面来源兼容多种结构：MusicResponsiveListItem 有 thumbnails 取值器（=thumbnail.contents）；
  // MusicTwoRowItem 的 thumbnail 是数组；旧结构是 thumbnail.contents。取最高分辨率那张。
  let thumbs = [];
  if (item.thumbnails && item.thumbnails.length) thumbs = item.thumbnails;
  else thumbs = ytmThumbnails(item.thumbnail);
  const cover = thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url || '') : '';
  const artistList = ytmPeople(item.artists || item.authors || item.author || item.byline);
  const artistStr = artistList.map(a => a.name).join(' / ');
  const durationSec = item.duration ? (item.duration.seconds || 0) : 0;
  const albumName = ytmText(item.album);
  const fallbackArtist = ytmArtistFallbackFromFlexColumns(item, albumName);
  const mappedArtists = artistList.length ? artistList : (fallbackArtist ? [{ id: '', name: fallbackArtist }] : []);
  return {
    provider: 'youtube',
    source: 'youtube',
    type: 'song',
    id: item.id,
    name: ytmText(item.title) || ytmText(item.name) || 'Unknown',
    artist: artistStr || fallbackArtist || 'Unknown Artist',
    artists: mappedArtists,
    artistId: mappedArtists[0] ? (mappedArtists[0].id || '') : '',
    album: albumName,
    cover: cover,
    duration: durationSec * 1000,
    fee: 0,
  };
}
// 映射 getUpNext 电台队列里的 PlaylistPanelVideo 条目
function mapPanelVideo(it) {
  if (!it) return null;
  const id = it.video_id || it.videoId || it.id || '';
  if (!id) return null;
  const name = ytmText(it.title) || ytmText(it.name);
  if (!name) return null;
  let thumbs = it.thumbnails && it.thumbnails.length ? it.thumbnails : ytmThumbnails(it.thumbnail);
  const cover = thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url || '') : '';
  const artists = ytmPeople(it.artists || it.authors || it.author || it.byline);
  const artistStr = artists.length ? artists.map(a => a.name).join(' / ') : 'Unknown Artist';
  const durSec = it.duration ? (it.duration.seconds || 0) : 0;
  return {
    provider: 'youtube', source: 'youtube', type: 'song',
    id,
    name,
    artist: artistStr,
    artists,
    artistId: artists[0] ? artists[0].id : '',
    album: ytmText(it.album),
    cover,
    duration: durSec * 1000,
    fee: 0,
  };
}
const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');
const tls = require('tls');
const { once } = require('events');
const { fileURLToPath } = require('url');
const { analyzePodcastDjStream, analyzePodcastDjIntro } = require('./dj-analyzer');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const COOKIE_FILE = process.env.COOKIE_FILE || path.join(__dirname, '.cookie');
const {
  APP_PACKAGE,
  APP_VERSION,
  UPDATE_CONFIG,
  fetchLatestUpdateInfo,
  localUpdateFallback,
  activeUpdateJobFor,
  startUpdateDownloadJob,
  startUpdatePatchJob,
  publicUpdateJob,
  beatCacheRootInfo,
  readBeatMapCache,
  writeBeatMapCache,
  cancelUpdateJobs,
  updateDownloadJobs,
} = require('./server/update-service');
const API_ROUTE_PATHS = Object.freeze([
  '/api/app/version',
  '/api/artist/detail',
  '/api/audio',
  '/api/beatmap/cache',
  '/api/beatmap/cache/status',
  '/api/cover',
  '/api/debug/audio',
  '/api/debug/lyric',
  '/api/diagnostics/runtime',
  '/api/discover/home',
  '/api/login/cookie',
  '/api/login/profile',
  '/api/login/status',
  '/api/logout',
  '/api/lyric',
  '/api/lyric/translate',
  '/api/playlist/add-song',
  '/api/playlist/create',
  '/api/playlist/tracks',
  '/api/podcast/detail',
  '/api/podcast/dj-beatmap',
  '/api/podcast/hot',
  '/api/podcast/my',
  '/api/podcast/my/items',
  '/api/podcast/programs',
  '/api/podcast/search',
  '/api/radio',
  '/api/search',
  '/api/search/youtube',
  '/api/song/comments',
  '/api/song/like',
  '/api/song/like/check',
  '/api/song/url',
  '/api/update/download',
  '/api/update/download/status',
  '/api/update/latest',
  '/api/update/patch',
  '/api/update/patch/status',
  '/api/user/playlists',
  '/api/wallpaper-engine/debug',
  '/api/wallpaper-engine/list',
  '/api/wallpaper-engine/media',
  '/api/weather/ip-location',
  '/api/weather/radio',
]);
const API_ROUTE_SET = new Set(API_ROUTE_PATHS);
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_IP_LOCATION_URL = 'http://ip-api.com/json/';
const WEATHER_DEFAULT_LOCATION = {
  name: '上海',
  country: 'China',
  latitude: 31.2304,
  longitude: 121.4737,
  timezone: 'Asia/Shanghai',
};


function applySystemCertificateAuthorities() {
  try {
    if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') return;
    const bundled = tls.getCACertificates('default') || [];
    const system = tls.getCACertificates('system') || [];
    if (!system.length) return;
    const seen = new Set();
    const merged = [];
    bundled.concat(system).forEach(cert => {
      if (!cert || seen.has(cert)) return;
      seen.add(cert);
      merged.push(cert);
    });
    if (merged.length > bundled.length) tls.setDefaultCACertificates(merged);
  } catch (e) {
    console.warn('[TLS] system CA merge skipped:', e.message);
  }
}

applySystemCertificateAuthorities();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
  '.svg':  'image/svg+xml',
};

// ---------- Cookie 持久化 ----------
const COOKIE_ATTRIBUTE_NAMES = new Set(['path', 'domain', 'expires', 'max-age', 'samesite', 'secure', 'httponly']);
function collectCookiePair(picked, key, value) {
  key = String(key || '').trim();
  if (!key || COOKIE_ATTRIBUTE_NAMES.has(key.toLowerCase())) return;
  if (value === null || value === undefined) return;
  picked.set(key, String(value).trim());
}
function collectCookieInput(input, picked) {
  if (input === null || input === undefined) return;
  if (Array.isArray(input)) {
    input.forEach(item => collectCookieInput(item, picked));
    return;
  }
  if (typeof input === 'object') {
    if (input.name && Object.prototype.hasOwnProperty.call(input, 'value')) {
      collectCookiePair(picked, input.name, input.value);
      return;
    }
    Object.keys(input).forEach(key => {
      const value = input[key];
      if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'value')) {
        collectCookiePair(picked, key, value.value);
      } else if (typeof value !== 'object') {
        collectCookiePair(picked, key, value);
      }
    });
    return;
  }
  String(input).split(/\r?\n/).forEach(line => {
    line.split(';').forEach(part => {
      const raw = String(part || '').trim();
      const idx = raw.indexOf('=');
      if (idx <= 0) return;
      collectCookiePair(picked, raw.slice(0, idx), raw.slice(idx + 1));
    });
  });
}
function normalizeCookieHeader(input) {
  const picked = new Map();
  collectCookieInput(input, picked);
  return Array.from(picked.entries())
    .filter(([key, value]) => key && value != null && String(value) !== '')
    .map(([key, value]) => `${key}=${value}`)
    .join('; ');
}
function rawCookieFallback(input) {
  if (typeof input === 'string') return input.trim();
  if (Array.isArray(input) && input.every(item => typeof item === 'string')) return input.join('; ').trim();
  return '';
}
let userCookie = '';
try { if (fs.existsSync(COOKIE_FILE)) userCookie = fs.readFileSync(COOKIE_FILE, 'utf8').trim(); }
catch (e) { userCookie = ''; }
if (!userCookie) {
  try { const gc = path.join(__dirname, '.google-cookie'); if (fs.existsSync(gc)) userCookie = fs.readFileSync(gc, 'utf8').trim(); } catch(e){}
}
function saveCookie(c) {
  userCookie = normalizeCookieHeader(c) || rawCookieFallback(c);
  if (loginService) loginService.reset();
  try { fs.writeFileSync(COOKIE_FILE, userCookie); } catch (e) {}
  try { fs.writeFileSync(path.join(__dirname, '.google-cookie'), userCookie); } catch (e) {}
}

function ensureYtmServices() {
  if (ytmSession && ytmAudioService && radioService) return;
  const { Innertube } = getYtmRuntime();
  ytmSession = createYtmSession({
    Innertube,
    JSDOM: LazyJSDOM,
    userAgent: UA,
    getCookie: () => userCookie,
    logger: console,
  });
  ytmAudioService = createYtmAudioService({
    Innertube,
    userAgent: UA,
    getCookie: () => userCookie,
    getVisitorData: () => ytmSession.getVisitorData(),
    getContentPoToken: (sid, forceRefresh) => ytmSession.getContentPoToken(sid, forceRefresh),
    requestJson,
    logger: console,
  });
  radioService = createRadioService({
    getYTMusic,
    handleSearch,
    mapPanelVideo,
    logger: console,
  });
}

const lyricsService = createLyricsService({
  requestJson,
  getYTMusic,
  userAgent: UA,
  logger: console,
});

// ---------- 工具 ----------
function serveStatic(res, filePath) {
  const ext = path.extname(filePath);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'text/plain' });
    res.end(data);
  });
}
function sendJSON(res, data, status) {
  res.writeHead(status || 200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0',
  });
  res.end(JSON.stringify(data));
}
function readRequestBody(req) {
  return new Promise(resolve => {
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (raw.length > 8 * 1024 * 1024) req.destroy();
    });
    req.on('end', () => {
      if (!raw) { resolve({}); return; }
      try { resolve(JSON.parse(raw)); }
      catch (e) {
        const params = new URLSearchParams(raw);
        const out = {};
        params.forEach((v, k) => { out[k] = v; });
        resolve(out);
      }
    });
    req.on('error', () => resolve({}));
  });
}
function parseCookieString(cookieText) {
  const out = {};
  String(cookieText || '').split(';').forEach(part => {
    const raw = String(part || '').trim();
    if (!raw) return;
    const idx = raw.indexOf('=');
    if (idx <= 0) return;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (key) out[key] = value;
  });
  return out;
}
function mapArtists(raw) {
  return (raw || [])
    .map(a => ({ id: a && a.id, name: (a && a.name) || '' }))
    .filter(a => a.name);
}
async function requireLogin(res) {
  const info = await getLoginInfo();
  if (!info.loggedIn || !info.userId) {
    sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
    return null;
  }
  return info;
}

// ---------- 业务: 搜索 (YouTube Music 原生) ----------
async function handleSearch(keywords, limit) {
  console.log('[Search YTM]', keywords, 'limit:', limit);
  if (!keywords) return [];
  try {
    const yt = await getYTMusic();
    const result = await yt.music.search(keywords, { type: 'song' });
    const rawList = [];
    const c = result.contents || [];
    for (const item of c) {
      if (item.type === 'MusicShelf' && item.contents) {
        rawList.push(...item.contents);
      } else if (item.type === 'MusicResponsiveListItem') {
        rawList.push(item);
      }
    }
    return rawList.slice(0, limit || 20).map(mapYTMItem).filter(Boolean);
  } catch (err) {
    console.error('[Search YTM Error]', err.message);
    return [];
  }
}

// 解析 "3:45" / "1:02:33" 时长文本为秒
function parseDurationText(text) {
  const parts = String(text || '').trim().split(':').map(n => parseInt(n, 10));
  if (!parts.length || parts.some(isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

// 把普通 YouTube 搜索的视频节点映射成与 YTM 一致的歌曲结构（同一套 videoId，走同一条音频管线）
function mapYouTubeVideo(it) {
  if (!it) return null;
  const id = it.video_id || it.videoId || it.id || '';
  if (!id || String(id).length !== 11) return null;      // 只要可直接播放的 11 位视频 id
  if (it.is_live || it.is_upcoming) return null;         // 跳过直播 / 预告
  const name = ytmText(it.title) || ytmText(it.name);
  if (!name) return null;
  const thumbs = (it.thumbnails && it.thumbnails.length) ? it.thumbnails : ytmThumbnails(it.thumbnail);
  const cover = thumbs.length ? (thumbs[thumbs.length - 1].url || thumbs[0].url || '') : '';
  const authors = ytmPeople(it.author || it.authors || it.byline);
  const artistStr = authors.length ? authors.map(a => a.name).join(' / ') : (ytmText(it.author) || 'YouTube');
  let durSec = 0;
  if (it.duration && typeof it.duration === 'object') durSec = Number(it.duration.seconds) || parseDurationText(it.duration.text);
  else if (typeof it.duration === 'number') durSec = it.duration;
  else if (typeof it.duration === 'string') durSec = parseDurationText(it.duration);
  if (!durSec && it.length_seconds) durSec = Number(it.length_seconds) || 0;
  if (!durSec && it.duration_text) durSec = parseDurationText(it.duration_text);
  if (durSec > 3600) return null;                        // 跳过超 1 小时（多为循环 / 合集 / 直播回放）
  return {
    provider: 'youtube', source: 'youtube', type: 'song',
    id,
    name,
    artist: artistStr,
    artists: authors,
    artistId: authors[0] ? (authors[0].id || '') : '',
    album: '',
    cover,
    duration: durSec * 1000,
    fee: 0,
    fromYouTube: true,
  };
}

// ---------- 业务: 普通 YouTube 搜索（补 YTM 曲库没收录、但 YouTube 上有的歌）----------
// 翻页拉更多结果：单页只有约 20 条、且官方版排前面，翻唱/live/其它版本容易被挤到后面，
// 所以往后多翻几页凑够 target，让这些版本也能露出来。
async function handleYouTubeSearch(keywords, limit) {
  console.log('[Search YouTube]', keywords, 'limit:', limit);
  if (!keywords) return [];
  const target = Math.max(1, Math.min(Number(limit) || 40, 60));
  const MAX_PAGES = 4;
  try {
    const yt = await getYTMusic();
    let page = await yt.search(keywords, { type: 'video' });
    const out = [];
    const seen = new Set();
    const collect = (pg) => {
      const raw = [];
      const push = (arr) => { if (Array.isArray(arr)) for (const it of arr) raw.push(it); };
      push(pg && pg.videos);
      push(pg && pg.results);
      if (!raw.length && pg && Array.isArray(pg.contents)) push(pg.contents);
      for (const it of raw) {
        const mapped = mapYouTubeVideo(it);
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        out.push(mapped);
      }
    };
    collect(page);
    for (let p = 1; p < MAX_PAGES && out.length < target; p++) {
      if (!page || !page.has_continuation || typeof page.getContinuation !== 'function') break;
      try { page = await page.getContinuation(); } catch (e) { break; }
      if (!page) break;
      collect(page);
    }
    return out.slice(0, target);
  } catch (err) {
    console.error('[Search YouTube Error]', err.message);
    return [];
  }
}

// 从 YouTube Music 真实首页推荐 feed 里抽取可播放歌曲（Quick Picks / 为你推荐 等 shelf）
function extractHomeFeedSongs(feed, limit) {
  const out = [];
  const seen = new Set();
  const sections = (feed && feed.sections) || [];
  for (const section of sections) {
    const items = (section && (section.contents || section.items)) || [];
    for (const item of items) {
      if (!item) continue;
      const id = item.id || (item.on_tap && item.on_tap.payload && item.on_tap.payload.videoId) || '';
      // 只取可直接播放的 videoId（11 位），跳过专辑/歌单卡
      if (!id || typeof id !== 'string' || id.length !== 11 || seen.has(id)) continue;
      const mapped = mapYTMItem(item);
      if (!mapped || !mapped.id) continue;
      seen.add(id);
      out.push(mapped);
      if (out.length >= (limit || 24)) return out;
    }
  }
  return out;
}

// 「每日推荐」按当天本地日期做种子洗牌：同一天固定、每天不同（真·每日，而非固定取前 N 首）
function todayDateSeed() {
  const d = new Date();
  return (d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate()) >>> 0;
}
function seededRandom(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function seededShuffle(list, seed) {
  const a = Array.isArray(list) ? list.slice() : [];
  const rnd = seededRandom(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function parseCountText(text) {
  const match = String(text || '').replace(/,/g, '').match(/(\d+)\s*(?:tracks|songs|首|支)?/i);
  return match ? parseInt(match[1], 10) : 0;
}
async function countYtmPlaylistItems(yt, playlistId, limit) {
  let page = await yt.music.getPlaylist(playlistId);
  let total = parseCountText(page && page.info && page.info.total_items);
  let counted = 0;
  let guard = 0;
  while (page && guard < 12 && counted < (limit || 1200)) {
    const items = page.items || [];
    counted += items.length;
    if (!page.has_continuation) break;
    try {
      page = await page.getContinuation();
      guard += 1;
    } catch (e) {
      break;
    }
  }
  return total || counted;
}
async function handleDiscoverHome() {
  const info = await getLoginInfo();
  const loggedIn = !!(info && info.loggedIn);
  let dailySongs = [];
  let personalized = false;
  const playlists = [
    { id: 'VLPL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i', name: 'Top 100 Songs Global', cover: '', trackCount: 100, creator: 'YouTube Music' },
    { id: 'VLPLOHoVaTp8R7d3L_pjuwIa6nRh4tH5nI4x', name: 'Top YouTube Music 2026 Hits', cover: '', trackCount: 80, creator: 'YouTube Music' },
    { id: 'VLPLHg022HMFzFCJNn0WN7UM0_0uY109bcv2', name: 'Top 100 Songs 2026', cover: '', trackCount: 100, creator: 'YouTube Music' },
  ];
  // 登录时优先用 YouTube Music 真实个性化首页推荐（每日 Quick Picks / 为你推荐）
  if (loggedIn) {
    try {
      const yt = await getYTMusic();
      if (yt && yt.session && yt.session.logged_in) {
        const feed = await yt.music.getHomeFeed();
        const songs = extractHomeFeedSongs(feed, 60);
        if (songs.length) {
          // 从更大的池子里按当天日期洗牌取 12 首 → 每天不同、当天稳定
          dailySongs = seededShuffle(songs, todayDateSeed()).slice(0, 12);
          personalized = true;
          console.log('[DiscoverHome] 使用真实个性化推荐（每日种子洗牌），池', songs.length, '取', dailySongs.length, '首');
        }
      }
    } catch (e) {
      console.warn('[DiscoverHome HomeFeed]', e.message);
    }
  }
  // 回退：未登录 / 个性化推荐取不到 → 全球热门榜单
  if (!dailySongs.length) {
    try {
      const yt = await getYTMusic();
      const pl = await yt.music.getPlaylist('VLPL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i');
      const pool = (pl.items || []).map(mapYTMItem).filter(Boolean);
      // 回退榜单也按当天日期洗牌取 12 首，避免每次一模一样
      dailySongs = seededShuffle(pool, todayDateSeed()).slice(0, 12);
    } catch(e) {
      console.warn('[DiscoverHome YTM]', e.message);
    }
  }
  return {
    loggedIn,
    user: loggedIn ? { userId: info.userId, nickname: info.nickname || 'YouTube Music 会员', avatar: info.avatar || '' } : null,
    dailySongs,
    personalized,
    playlists,
    podcasts: [],
    mode: loggedIn ? 'vip' : 'starter',
    updatedAt: Date.now(),
  };
}

function requestText(targetUrl, opts, body) {
  opts = opts || {};
  return new Promise((resolve, reject) => {
    const u = new URL(targetUrl);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(u, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode >= 400) {
          const err = new Error('HTTP ' + response.statusCode);
          err.statusCode = response.statusCode;
          err.body = text;
          reject(err);
          return;
        }
        resolve(text);
      });
    });
    req.setTimeout(opts.timeoutMs || 10000, () => req.destroy(new Error('Request timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function requestJson(targetUrl, opts, body) {
  const text = await requestText(targetUrl, opts, body);
  try {
    return JSON.parse(text);
  } catch (e) {
    const err = new Error('Invalid JSON from ' + targetUrl);
    err.cause = e;
    throw err;
  }
}

function clampNumber(value, min, max, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function openMeteoWeatherLabel(code) {
  code = Number(code);
  if (code === 0) return '晴';
  if (code === 1 || code === 2) return '少云';
  if (code === 3) return '阴';
  if (code === 45 || code === 48) return '雾';
  if (code === 51 || code === 53 || code === 55) return '毛毛雨';
  if (code === 56 || code === 57) return '冻雨';
  if (code === 61 || code === 63 || code === 65) return '雨';
  if (code === 66 || code === 67) return '冻雨';
  if (code === 71 || code === 73 || code === 75 || code === 77) return '雪';
  if (code === 80 || code === 81 || code === 82) return '阵雨';
  if (code === 85 || code === 86) return '阵雪';
  if (code === 95 || code === 96 || code === 99) return '雷雨';
  return '天气';
}

function buildWeatherMood(weather, date) {
  const now = date || new Date();
  const hour = now.getHours();
  const code = Number(weather && weather.weatherCode);
  const temp = Number(weather && weather.temperature);
  const apparent = Number(weather && weather.apparentTemperature);
  const rain = Number(weather && weather.precipitation) || 0;
  const humidity = Number(weather && weather.humidity) || 0;
  const wind = Number(weather && weather.windSpeed) || 0;
  const isNight = weather && weather.isDay === 0 || hour < 6 || hour >= 20;
  const isMorning = hour >= 5 && hour < 11;
  const isDusk = hour >= 17 && hour < 20;
  const isRain = rain > 0 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99].includes(code);
  const isSnow = [71, 73, 75, 77, 85, 86].includes(code);
  const isCloud = [2, 3, 45, 48].includes(code);
  const isStorm = [95, 96, 99].includes(code);
  const feels = Number.isFinite(apparent) ? apparent : temp;

  let mood = {
    key: 'clear',
    title: '晴朗电台',
    tagline: '让节奏亮一点，像窗边的光',
    energy: 0.62,
    warmth: 0.58,
    focus: 0.48,
    melancholy: 0.24,
    keywords: ['轻快 华语', 'city pop', 'indie pop', 'chill pop', '阳光 歌单'],
  };
  if (isStorm) {
    mood = {
      key: 'storm',
      title: '雷雨电台',
      tagline: '低频更厚，适合把世界关小一点',
      energy: 0.46,
      warmth: 0.34,
      focus: 0.66,
      melancholy: 0.62,
      keywords: ['暗色 R&B', 'trip hop', '夜晚 电子', '氛围 摇滚', '雨夜 歌单'],
    };
  } else if (isRain) {
    mood = {
      key: 'rain',
      title: '雨天电台',
      tagline: '留一点潮湿的空间给旋律',
      energy: 0.38,
      warmth: 0.42,
      focus: 0.64,
      melancholy: 0.66,
      keywords: ['雨天 R&B', 'lofi rainy', '华语 慢歌', 'dream pop', '雨夜 歌单'],
    };
  } else if (isSnow || feels <= 3) {
    mood = {
      key: 'snow',
      title: '冷空气电台',
      tagline: '干净、慢速、带一点冬天的颗粒感',
      energy: 0.34,
      warmth: 0.28,
      focus: 0.72,
      melancholy: 0.54,
      keywords: ['冬天 民谣', 'ambient piano', '日系 冬天', 'indie folk', '安静 歌单'],
    };
  } else if (feels >= 31 || humidity >= 78) {
    mood = {
      key: 'humid',
      title: '闷热电台',
      tagline: '降低密度，留出一点呼吸',
      energy: 0.48,
      warmth: 0.76,
      focus: 0.46,
      melancholy: 0.30,
      keywords: ['夏日 chill', 'bossa nova', 'city pop 夏天', '轻电子', '海边 歌单'],
    };
  } else if (isCloud) {
    mood = {
      key: 'cloudy',
      title: '阴天电台',
      tagline: '不急着明亮，先让声音变软',
      energy: 0.40,
      warmth: 0.46,
      focus: 0.58,
      melancholy: 0.52,
      keywords: ['阴天 华语', 'indie rock mellow', 'neo soul', 'chillhop', '独立 民谣'],
    };
  }

  if (isNight) {
    mood.key += '-night';
    mood.title = mood.key.startsWith('clear') ? '夜色电台' : mood.title.replace('电台', '夜听');
    mood.tagline = '音量放低一点，让夜色参与编曲';
    mood.energy = Math.min(mood.energy, 0.42);
    mood.focus = Math.max(mood.focus, 0.68);
    mood.melancholy = Math.max(mood.melancholy, 0.52);
    mood.keywords = ['夜晚 R&B', 'late night jazz', 'ambient', 'lofi sleep', '夜跑 歌单'].concat(mood.keywords.slice(0, 3));
  } else if (isMorning) {
    mood.title = mood.key.startsWith('rain') ? '雨晨电台' : '早晨电台';
    mood.energy = Math.max(mood.energy, 0.52);
    mood.keywords = ['早晨 通勤', 'morning acoustic', '清晨 indie', '轻快 华语'].concat(mood.keywords.slice(0, 3));
  } else if (isDusk) {
    mood.title = mood.key.startsWith('rain') ? '黄昏雨声' : '黄昏电台';
    mood.melancholy = Math.max(mood.melancholy, 0.48);
    mood.keywords = ['黄昏 city pop', '日落 歌单', '落日飞车', 'soul pop'].concat(mood.keywords.slice(0, 3));
  }

  if (wind >= 28) {
    mood.energy = Math.max(mood.energy, 0.56);
    mood.keywords = ['公路 摇滚', 'windy day playlist'].concat(mood.keywords.slice(0, 4));
  }
  mood.keywords = Array.from(new Set(mood.keywords)).slice(0, 7);
  return mood;
}

async function resolveOpenMeteoLocation(query) {
  const raw = String(query || '').trim();
  if (!raw) return WEATHER_DEFAULT_LOCATION;
  const u = new URL(OPEN_METEO_GEOCODE_URL);
  u.searchParams.set('name', raw);
  u.searchParams.set('count', '1');
  u.searchParams.set('language', 'zh');
  u.searchParams.set('format', 'json');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const first = body && Array.isArray(body.results) && body.results[0];
  if (!first) return { ...WEATHER_DEFAULT_LOCATION, query: raw, fallback: true };
  return {
    name: first.name || raw,
    country: first.country || '',
    admin1: first.admin1 || '',
    latitude: first.latitude,
    longitude: first.longitude,
    timezone: first.timezone || 'auto',
  };
}

async function fetchOpenMeteoWeather(params) {
  params = params || {};
  let location;
  const lat = clampNumber(params.lat, -90, 90, NaN);
  const lon = clampNumber(params.lon, -180, 180, NaN);
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    location = {
      name: String(params.city || params.name || '当前位置').trim() || '当前位置',
      country: '',
      latitude: lat,
      longitude: lon,
      timezone: params.timezone || 'auto',
    };
  } else {
    location = await resolveOpenMeteoLocation(params.city || params.q || params.location);
  }
  const u = new URL(OPEN_METEO_FORECAST_URL);
  u.searchParams.set('latitude', String(location.latitude));
  u.searchParams.set('longitude', String(location.longitude));
  u.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_gusts_10m');
  u.searchParams.set('hourly', 'precipitation_probability,weather_code,temperature_2m');
  u.searchParams.set('forecast_days', '1');
  u.searchParams.set('timezone', location.timezone || 'auto');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  const cur = body && body.current || {};
  const weather = {
    provider: 'open-meteo',
    location: {
      name: location.name,
      country: location.country || '',
      admin1: location.admin1 || '',
      latitude: location.latitude,
      longitude: location.longitude,
      timezone: body.timezone || location.timezone || '',
      fallback: !!location.fallback,
    },
    label: openMeteoWeatherLabel(cur.weather_code),
    weatherCode: Number(cur.weather_code),
    temperature: Number(cur.temperature_2m),
    apparentTemperature: Number(cur.apparent_temperature),
    humidity: Number(cur.relative_humidity_2m),
    precipitation: Number(cur.precipitation || cur.rain || cur.showers || cur.snowfall || 0),
    cloudCover: Number(cur.cloud_cover),
    windSpeed: Number(cur.wind_speed_10m),
    windGusts: Number(cur.wind_gusts_10m),
    isDay: Number(cur.is_day),
    time: cur.time || '',
    updatedAt: Date.now(),
  };
  weather.mood = buildWeatherMood(weather);
  return weather;
}

async function fetchIpWeatherLocation() {
  const u = new URL(WEATHER_IP_LOCATION_URL);
  u.searchParams.set('fields', 'status,message,country,regionName,city,lat,lon,timezone,query');
  u.searchParams.set('lang', 'zh-CN');
  const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA } });
  if (!body || body.status !== 'success' || !Number.isFinite(Number(body.lat)) || !Number.isFinite(Number(body.lon))) {
    const err = new Error(body && body.message || 'IP_LOCATION_FAILED');
    err.body = body;
    throw err;
  }
  return {
    provider: 'ip-api',
    city: body.city || WEATHER_DEFAULT_LOCATION.name,
    region: body.regionName || '',
    country: body.country || '',
    latitude: Number(body.lat),
    longitude: Number(body.lon),
    timezone: body.timezone || 'auto',
    ip: body.query || '',
  };
}

function weatherRadioSeedQueries(mood) {
  const key = String(mood && mood.key || '');
  if (key.includes('rain') || key.includes('storm')) return ['陈奕迅 阴天快乐', '周杰伦 雨下一整晚', '孙燕姿 遇见', '林宥嘉 说谎', '毛不易 消愁'];
  if (key.includes('snow') || key.includes('cloudy')) return ['陈奕迅 好久不见', '莫文蔚 阴天', '李健 贝加尔湖畔', '朴树 平凡之路', '蔡健雅 达尔文'];
  if (key.includes('humid')) return ['落日飞车 My Jinji', '告五人 爱人错过', '夏日入侵企画 想去海边', '陈绮贞 旅行的意义', '王若琳 Lost in Paradise'];
  if (key.includes('night')) return ['方大同 特别的人', '陶喆 爱很简单', 'Frank Ocean Pink + White', '林忆莲 夜太黑', "Norah Jones Don't Know Why"];
  return ['孙燕姿 天黑黑', '周杰伦 晴天', '五月天 温柔', '陈奕迅 稳稳的幸福', '王菲'];
}

function fallbackWeatherForRadio(params, err) {
  params = params || {};
  const name = String(params.city || params.q || params.location || WEATHER_DEFAULT_LOCATION.name).trim() || WEATHER_DEFAULT_LOCATION.name;
  return {
    provider: 'open-meteo',
    location: {
      name,
      country: '',
      admin1: '',
      latitude: null,
      longitude: null,
      timezone: params.timezone || WEATHER_DEFAULT_LOCATION.timezone,
      fallback: true,
    },
    label: '天气暂不可用',
    weatherCode: null,
    temperature: null,
    apparentTemperature: null,
    humidity: null,
    precipitation: null,
    cloudCover: null,
    windSpeed: null,
    windGusts: null,
    isDay: null,
    time: '',
    updatedAt: Date.now(),
    error: err && err.message || '',
    mood: {
      key: 'fallback',
      title: '临时电台',
      tagline: '天气暂时没有回来，先放一组稳妥的歌',
      energy: 0.54,
      warmth: 0.55,
      focus: 0.55,
      melancholy: 0.35,
      keywords: ['华语 流行', 'indie pop', 'city pop', '轻快 歌单', 'chill pop'],
    },
  };
}

function uniqueSongsByKey(songs) {
  const seen = new Set();
  const out = [];
  (songs || []).forEach(song => {
    const key = String(song && (song.id || song.name + '|' + song.artist) || '').trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(song);
  });
  return out;
}

function tagWeatherPoolSongs(songs, source) {
  return (songs || []).map(song => ({ ...song, weatherSource: source }));
}

async function fetchWeatherPlaylistSongs(playlist, limit) {
  return [];
}

async function filterLikelyPlayableWeatherSongs(songs) {
  const source = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .slice(0, 24);
  const playable = [];
  const fallback = source.slice(0, 24);
  for (let i = 0; i < source.length; i += 4) {
    const chunk = source.slice(i, i + 4);
    const settled = await Promise.allSettled(chunk.map(async song => {
      const info = await handleSongUrl(song.id, { loggedIn: !!userCookie }, 'standard');
      return info && info.url ? song : null;
    }));
    settled.forEach((result, idx) => {
      if (result.status === 'fulfilled' && result.value) playable.push(result.value);
      else if (result.status === 'rejected') console.warn('[WeatherRadio] playable probe failed:', chunk[idx] && chunk[idx].name, result.reason && result.reason.message);
    });
    if (playable.length >= 12) break;
  }
  return (playable.length ? playable : fallback).slice(0, 24);
}

function isLowSignalWeatherSong(song) {
  const text = String([
    song && song.name,
    song && song.artist,
    song && song.album,
  ].filter(Boolean).join(' ')).toLowerCase();
  if (!text) return true;
  if (/(^|[\s\-_/（(])ai(?:\s*(歌|歌曲|音乐|cover|翻唱|生成|作曲|演唱|女声|男声)|$|[\s\-_/）)])/i.test(text)) return true;
  if (/suno|udio|人工智能|生成歌曲|ai歌曲|虚拟歌手|测试音频|demo|beat\s*maker/i.test(text)) return true;
  if (/翻自|翻唱|cover|remix|伴奏|纯音乐|钢琴|dj|live\s*版|live版|唯美钢琴|karaoke|instrumental/i.test(text)) return true;
  if (/白噪音|雨声|睡眠|助眠|冥想|疗愈频率|环境音|自然声音|asmr/i.test(text)) return true;
  if (/[（(](r&b|lofi|jazz|dj|edm|trap|remix|伴奏|纯音乐|钢琴|电子|治愈|古风|女声|男声|英文|中文版|抖音|ai)[）)]/i.test(text)) return true;
  if (/^(纯音乐|轻音乐|治愈系|放松|睡眠|雨天|阴天|夜晚|夏日|海边)$/i.test(String(song.name || '').trim())) return true;
  return false;
}

function scoreWeatherSong(song, mood) {
  const text = String((song && song.name || '') + ' ' + (song && song.artist || '') + ' ' + (song && song.album || '')).toLowerCase();
  let score = 0;
  if (song && song.cover) score += 4;
  if (song && song.duration) score += 2;
  if (song && song.weatherSource === 'daily') score += 6;
  if (song && song.weatherSource === 'private') score += 4;
  if (/周杰伦|陈奕迅|孙燕姿|五月天|王菲|陶喆|方大同|林宥嘉|蔡健雅|莫文蔚|李健|毛不易|告五人|落日飞车|陈绮贞|朴树/.test(text)) score += 10;
  const key = String(mood && mood.key || '');
  if (key.includes('rain') && /雨|阴|夜|慢|r&b|soul|陈奕迅|林宥嘉|孙燕姿/.test(text)) score += 5;
  if (key.includes('humid') && /夏|海|city|pop|落日|告五人|方大同|陶喆/.test(text)) score += 5;
  if (key.includes('night') && /夜|moon|jazz|soul|r&b|方大同|陶喆|王菲/.test(text)) score += 5;
  if (key.includes('cloudy') && /阴|民谣|indie|陈绮贞|朴树|李健/.test(text)) score += 5;
  return score;
}

function weatherArtistKey(song) {
  const raw = String(song && song.artist || song && song.name || '').split(/\s*\/\s*|、|,|&/)[0] || '';
  return raw.trim().toLowerCase() || 'unknown';
}

function weatherTitleKey(song) {
  return String(song && song.name || '')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s._\-·'’"“”「」《》:：/\\|]+/g, '')
    .trim();
}

function uniqueWeatherTitles(sorted) {
  const seen = new Set();
  const out = [];
  (sorted || []).forEach(song => {
    const key = weatherTitleKey(song);
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    out.push(song);
  });
  return out;
}

function diversifyWeatherSongs(sorted, artistLimit) {
  const primary = [];
  const deferred = [];
  const counts = new Map();
  (sorted || []).forEach(song => {
    const key = weatherArtistKey(song);
    const count = counts.get(key) || 0;
    if (count < artistLimit) {
      primary.push(song);
      counts.set(key, count + 1);
    } else {
      deferred.push(song);
    }
  });
  return primary.length >= 8 ? primary : primary.concat(deferred.slice(0, 8 - primary.length));
}

function orderWeatherSongs(songs, mood) {
  const sorted = uniqueSongsByKey(songs)
    .filter(song => song && song.name && song.id && !isLowSignalWeatherSong(song))
    .sort((a, b) => scoreWeatherSong(b, mood) - scoreWeatherSong(a, mood));
  return diversifyWeatherSongs(uniqueWeatherTitles(sorted), 2);
}

async function buildWeatherRadio(params) {
  let weather;
  try {
    weather = await fetchOpenMeteoWeather(params);
  } catch (e) {
    console.warn('[WeatherRadio] weather provider failed, using fallback radio:', e.message);
    weather = fallbackWeatherForRadio(params, e);
  }
  const queries = weatherRadioSeedQueries(weather.mood);
  let songs = [];
  const settled = await Promise.allSettled(queries.slice(0, 4).map(q => handleSearch(q, 6)));
  settled.forEach(result => {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
  });
  if (songs.length < 10 && weather.mood && Array.isArray(weather.mood.keywords)) {
    const more = await Promise.allSettled(weather.mood.keywords.slice(0, 2).map(q => handleSearch(q, 6)));
    more.forEach(result => {
      if (result.status === 'fulfilled' && Array.isArray(result.value)) songs = songs.concat(result.value);
    });
  }
  songs = orderWeatherSongs(songs, weather.mood);
  return {
    ok: true,
    weather,
    radio: {
      title: weather.mood.title,
      subtitle: weather.mood.tagline,
      seedQueries: queries.slice(0, 4),
      songs: songs.slice(0, 18),
      updatedAt: Date.now(),
    },
  };
}

// ---------- YouTube 视频评论（统一评论源） ----------
async function handleYouTubeComments(videoId, limit) {
  const vid = String(videoId || '').trim();
  if (!vid) return [];
  const yt = await getYTMusic();
  const thread = await yt.getComments(vid, 'TOP_COMMENTS');
  const rawList = (thread && thread.contents) || [];
  const comments = [];
  for (const item of rawList) {
    if (comments.length >= (limit || 18)) break;
    const c = item && (item.comment || item);
    if (!c) continue;
    const contentText = c.content && (c.content.text || (typeof c.content.toString === 'function' ? c.content.toString() : '')) || '';
    if (!contentText) continue;
    comments.push({
      id: c.comment_id || '',
      content: String(contentText),
      nickname: (c.author && c.author.name) || 'YouTube 用户',
      avatar: (c.author && c.author.thumbnails && c.author.thumbnails.length && c.author.thumbnails[0].url) || '',
      likedCount: Number(c.like_count) || 0,
      time: (c.published_time != null && String(c.published_time)) || '',
    });
  }
  return comments;
}

// Lyrics resolution and translation live in server/services/lyrics-service.js.
// ---------- YTM 音频流解析：实现位于 server/services/ytm-audio.js ----------
// ---------- Wallpaper Engine 壁纸接入（扫描 Steam 创意工坊已下载壁纸） ----------
const WALLPAPER_ENGINE_APPID = '431960';
let weItemsCache = { at: 0, items: [], dirs: [] };

function readSteamPathFromRegistry() {
  const tries = [
    ['reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath', /SteamPath\s+REG_SZ\s+(.+)/i],
    ['reg query "HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam" /v InstallPath', /InstallPath\s+REG_SZ\s+(.+)/i],
    ['reg query "HKLM\\SOFTWARE\\Valve\\Steam" /v InstallPath', /InstallPath\s+REG_SZ\s+(.+)/i],
  ];
  for (const [cmd, re] of tries) {
    try {
      const out = require('child_process').execSync(cmd, { encoding: 'utf8', windowsHide: true, timeout: 4000 });
      const m = out.match(re);
      if (m && m[1]) return m[1].trim();
    } catch (e) {}
  }
  return '';
}

function parseSteamLibraryRoots(steamPath) {
  const roots = [];
  if (steamPath) roots.push(steamPath);
  if (steamPath) {
    for (const vdf of [
      path.join(steamPath, 'steamapps', 'libraryfolders.vdf'),
      path.join(steamPath, 'config', 'libraryfolders.vdf'),
    ]) {
      try {
        if (fs.existsSync(vdf)) {
          const txt = fs.readFileSync(vdf, 'utf8');
          const re = /"path"\s+"([^"]+)"/g;
          let m;
          while ((m = re.exec(txt))) roots.push(m[1].replace(/\\\\/g, '\\'));
        }
      } catch (e) {}
    }
  }
  return roots;
}

function findWallpaperEngineDirs() {
  const dirs = [];
  const push = p => { try { if (p && fs.existsSync(p) && fs.statSync(p).isDirectory()) dirs.push(p); } catch (e) {} };
  // 手动覆盖：MINERADIO_WE_DIR 直接指向 431960 目录，或指向 Steam 根
  if (process.env.MINERADIO_WE_DIR) {
    push(process.env.MINERADIO_WE_DIR);
    push(path.join(process.env.MINERADIO_WE_DIR, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APPID));
  }
  const roots = [];
  const steamPath = readSteamPathFromRegistry();
  parseSteamLibraryRoots(steamPath).forEach(r => roots.push(r));
  // 常见默认路径兜底
  ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary', 'E:\\Steam', 'E:\\SteamLibrary'].forEach(r => roots.push(r));
  Array.from(new Set(roots)).forEach(root => {
    push(path.join(root, 'steamapps', 'workshop', 'content', WALLPAPER_ENGINE_APPID));
  });
  return Array.from(new Set(dirs));
}

function listWallpaperEngineItems(forceRefresh) {
  if (!forceRefresh && weItemsCache.items.length && (Date.now() - weItemsCache.at) < 60000) return weItemsCache;
  const dirs = findWallpaperEngineDirs();
  const items = [];
  const byId = {};
  for (const dir of dirs) {
    let subs = [];
    try { subs = fs.readdirSync(dir); } catch (e) { continue; }
    for (const sub of subs) {
      const folder = path.join(dir, sub);
      const projPath = path.join(folder, 'project.json');
      try {
        if (!fs.existsSync(projPath)) continue;
        const proj = JSON.parse(fs.readFileSync(projPath, 'utf8'));
        const file = String(proj.file || '');
        const fileLower = file.toLowerCase();
        const isVideo = /\.(mp4|webm|m4v|mov)$/.test(fileLower);
        const isImage = /\.(jpg|jpeg|png|gif|webp)$/.test(fileLower);
        if (!isVideo && !isImage) continue; // scene/web/pkg 类无法在网页背景渲染，跳过
        const filePath = path.join(folder, file);
        if (!fs.existsSync(filePath)) continue;
        const preview = String(proj.preview || '');
        const item = {
          id: sub,
          title: String(proj.title || sub).slice(0, 160),
          type: isVideo ? 'video' : 'image',
          hasPreview: !!(preview && fs.existsSync(path.join(folder, preview))),
        };
        items.push(item);
        byId[sub] = { folder, file, preview };
      } catch (e) {}
    }
  }
  weItemsCache = { at: Date.now(), items, dirs, byId };
  return weItemsCache;
}

function weContentType(fp) {
  const ext = path.extname(fp).toLowerCase();
  return {
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  }[ext] || 'application/octet-stream';
}

// 带 Range 的本地文件流（视频 seek 用）
function serveWallpaperFile(req, res, filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch (e) { res.writeHead(404); res.end('Not found'); return; }
  const total = stat.size;
  const ct = weContentType(filePath);
  const range = req.headers.range || '';
  const baseHeaders = { 'Content-Type': ct, 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=86400' };
  const m = range.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { res.writeHead(416, { 'Content-Range': 'bytes */' + total }); res.end(); return; }
    res.writeHead(206, { ...baseHeaders, 'Content-Range': 'bytes ' + start + '-' + end + '/' + total, 'Content-Length': (end - start + 1) });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...baseHeaders, 'Content-Length': total });
    fs.createReadStream(filePath).pipe(res);
  }
}

function mapPodcastRadio(r) {
  r = r || {};
  const dj = r.dj || r.djSimple || r.djUser || r.creator || {};
  const id = r.id || r.rid || r.radioId;
  return {
    id,
    rid: id,
    name: r.name || r.radioName || '',
    cover: r.picUrl || r.picURL || r.coverUrl || r.coverImgUrl || r.avatarUrl || '',
    desc: r.desc || r.description || r.rcmdText || '',
    djName: dj.nickname || r.djName || r.nickname || '',
    category: r.category || r.categoryName || '',
    programCount: r.programCount || r.programNum || r.programCnt || 0,
    subCount: r.subCount || r.subedCount || r.subscriberCount || 0,
  };
}

function mapPodcastProgram(p, fallbackRadio) {
  p = p || {};
  const mainSong = p.mainSong || p.song || p.mainTrack || {};
  const radio = p.radio || fallbackRadio || {};
  const mappedRadio = mapPodcastRadio(radio);
  const artists = mapArtists(mainSong.ar || mainSong.artists || []);
  const album = mainSong.al || mainSong.album || {};
  const dj = p.dj || radio.dj || {};
  const playableId = mainSong.id || p.mainSongId || p.songId;
  return {
    type: 'podcast',
    source: 'podcast',
    id: playableId,
    programId: p.id || p.programId,
    radioId: mappedRadio.id,
    name: p.name || mainSong.name || '',
    artist: mappedRadio.name || dj.nickname || artists.map(a => a.name).join(' / ') || mappedRadio.djName || '',
    artists,
    artistId: artists[0] && artists[0].id,
    album: mappedRadio.name || album.name || 'Podcast',
    cover: p.coverUrl || p.cover || p.blurCoverUrl || mappedRadio.cover || album.picUrl || '',
    duration: p.duration || mainSong.dt || mainSong.duration || 0,
    fee: mainSong.fee,
    djName: mappedRadio.djName || dj.nickname || '',
    radioName: mappedRadio.name || '',
    desc: p.description || p.desc || '',
    createTime: p.createTime || 0,
    serialNum: p.serialNum || p.serial || 0,
  };
}

function firstArrayFrom(obj, keys) {
  obj = obj || {};
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.list)) return value.list;
    if (value && Array.isArray(value.data)) return value.data;
    if (value && Array.isArray(value.resources)) return value.resources;
  }
  return [];
}

function mapPodcastVoice(v) {
  v = v || {};
  const raw = v.resource || v.voice || v.data || v.program || v;
  const mainSong = raw.mainSong || raw.song || raw.track || {};
  const radio = raw.radio || raw.djRadio || raw.voiceList || raw.podcast || {};
  const playableId = raw.trackId || raw.songId || raw.mainSongId || mainSong.id || raw.id;
  return {
    type: 'podcast',
    source: 'podcast',
    sourceType: 'podcast-voice',
    id: playableId,
    programId: raw.programId || raw.voiceId || raw.id,
    radioId: radio.id || radio.radioId || radio.voiceListId || raw.radioId || raw.voiceListId,
    name: raw.name || raw.songName || raw.title || mainSong.name || '',
    artist: (radio.name || radio.radioName || radio.voiceListName || raw.podcastName || raw.djName || 'Voice'),
    album: radio.name || radio.radioName || raw.podcastName || 'Podcast',
    cover: raw.coverUrl || raw.cover || raw.picUrl || raw.coverImgUrl || radio.picUrl || radio.coverUrl || '',
    duration: raw.duration || raw.durationMs || mainSong.dt || mainSong.duration || 0,
    djName: raw.djName || (radio.dj && radio.dj.nickname) || '',
    radioName: radio.name || radio.radioName || raw.podcastName || '',
    desc: raw.desc || raw.description || '',
  };
}

function mapPodcastCollectionRadio(r, key) {
  const radio = mapPodcastRadio(r);
  return {
    ...radio,
    type: 'podcast-radio',
    sourceType: 'podcast-radio',
    collectionKey: key || '',
    radioId: radio.id,
    name: radio.name,
    artist: radio.djName || radio.category || 'Podcast',
    album: radio.category || 'Podcast',
  };
}

function podcastCollectionMeta(key, items) {
  const meta = {
    collect: { key: 'collect', title: '收藏播客', sub: '你收藏的播客', itemType: 'radio' },
    created: { key: 'created', title: '创建播客', sub: '你创建的播客', itemType: 'radio' },
    liked: { key: 'liked', title: '喜欢的声音', sub: '收藏或最近喜欢的声音', itemType: 'voice' },
  }[key] || { key, title: key, sub: '', itemType: 'radio' };
  const first = (items || [])[0] || {};
  return {
    ...meta,
    count: (items || []).length,
    cover: first.cover || first.picUrl || first.coverUrl || '',
  };
}

async function fetchMyPodcastItems(key, info, limit, offset) {
  return { itemType: key === 'liked' ? 'voice' : 'radio', items: [] };
}

// ---------- 业务: 取歌曲URL (探测试听) ----------
//   返回 { url, trial, level, br }
//   trial=true 表示这是试听片段 (freeTrialInfo 非空)
async function handleSongUrl(id, loginInfo, qualityPreference) {
  console.log('[SongUrl YTM] id:', id);
  if (!id) {
    return { url: null, playable: false, message: 'Missing song ID' };
  }
  const proxyUrl = 'ytm:' + id;
  return {
    url: proxyUrl,
    trial: false,
    playable: true,
    level: 'standard',
    quality: 'YouTube Music Stream',
    br: 128000,
    requestedQuality: qualityPreference || 'standard',
  };
}

// ---------- 业务: 登录态/用户信息 ----------
loginService = createLoginService({
  getCookie: () => userCookie,
  parseCookieString,
  getYTMusic,
  logger: console,
});
async function getLoginInfo(options) {
  return loginService.getInfo(options);
}

const ytmRouteHandler = createYtmRouteHandler({
  getLoginInfo,
  handleSongUrl,
  getRadioService: function() { ensureYtmServices(); return radioService; },
  getAudioService: function() { ensureYtmServices(); return ytmAudioService; },
  sendJSON,
  userAgent: UA,
  getUserCookie: () => userCookie,
  logger: console,
});

// ====================================================================
//  HTTP Server
// ====================================================================
// ---------- 推荐电台：实现位于 server/services/radio-service.js ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

  if (await ytmRouteHandler({ req, res, url })) return;

  if (pn === '/api/app/version') {
    sendJSON(res, {
      name: APP_PACKAGE.name || 'mineradio',
      productName: APP_PACKAGE.productName || 'Mineradio',
      version: APP_VERSION,
      update: {
        provider: UPDATE_CONFIG.provider,
        configured: UPDATE_CONFIG.configured,
        owner: UPDATE_CONFIG.owner,
        repo: UPDATE_CONFIG.repo,
        preview: UPDATE_CONFIG.preview,
        manifestOverride: !!UPDATE_CONFIG.manifest,
      },
    });
    return;
  }

  if (pn === '/api/diagnostics/runtime') {
    sendJSON(res, snapshotRuntimeDiagnostics({
      version: APP_VERSION,
      hasCookie: !!userCookie,
      ytmSession,
      ytmAudioService,
      updateJobs: updateDownloadJobs,
    }));
    return;
  }

  if (pn === '/api/update/latest') {
    try {
      sendJSON(res, await fetchLatestUpdateInfo());
    } catch (err) {
      sendJSON(res, {
        ...localUpdateFallback(err.message || 'Update check failed', { configured: UPDATE_CONFIG.configured }),
        error: err.message || 'Update check failed',
      });
    }
    return;
  }

  if (pn === '/api/update/download') {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdateDownloadJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdateDownload]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_DOWNLOAD_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/download/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0];
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/update/patch') {
    try {
      const info = await fetchLatestUpdateInfo();
      const job = startUpdatePatchJob(info);
      sendJSON(res, job, job.ok ? 200 : 400);
    } catch (err) {
      console.error('[UpdatePatch]', err);
      sendJSON(res, { ok: false, error: err.message || 'UPDATE_PATCH_START_FAILED' }, 500);
    }
    return;
  }

  if (pn === '/api/update/patch/status') {
    const id = url.searchParams.get('id') || '';
    const job = id
      ? updateDownloadJobs.get(id)
      : Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).find(item => item.mode === 'patch');
    sendJSON(res, publicUpdateJob(job), job ? 200 : 404);
    return;
  }

  if (pn === '/api/beatmap/cache/status') {
    const info = beatCacheRootInfo();
    sendJSON(res, {
      enabled: info.allowed && info.available,
      dir: info.dir,
      drive: info.drive,
      reason: !info.allowed ? 'C_DRIVE_DISABLED' : (!info.available ? 'TARGET_DRIVE_UNAVAILABLE' : ''),
      mode: info.allowed && info.available ? 'disk' : 'memory-only',
    });
    return;
  }

  if (pn === '/api/beatmap/cache') {
    if (req.method === 'GET') {
      const key = url.searchParams.get('key') || '';
      try {
        const entry = readBeatMapCache(key);
        sendJSON(res, entry
          ? { ok: true, hit: true, key: entry.key || key, map: entry.map, meta: entry.meta || {}, savedAt: entry.savedAt || 0 }
          : { ok: true, hit: false, key });
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          hit: false,
          enabled: false,
          mode: 'memory-only',
          key,
          reason: err.code || err.message || 'BEAT_CACHE_READ_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    if (req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        sendJSON(res, writeBeatMapCache(body));
      } catch (err) {
        const info = err.info || beatCacheRootInfo();
        sendJSON(res, {
          ok: false,
          enabled: false,
          mode: 'memory-only',
          reason: err.code || err.message || 'BEAT_CACHE_WRITE_FAILED',
          dir: info.dir,
        });
      }
      return;
    }

    sendJSON(res, { ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
    return;
  }

  if (pn === '/api/discover/home') {
    try {
      sendJSON(res, await handleDiscoverHome());
    } catch (err) {
      console.error('[DiscoverHome]', err);
      sendJSON(res, { error: err.message, loggedIn: false, dailySongs: [], playlists: [], podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/weather/radio') {
    try {
      const data = await buildWeatherRadio({
        city: url.searchParams.get('city') || url.searchParams.get('q') || '',
        lat: url.searchParams.get('lat'),
        lon: url.searchParams.get('lon'),
        timezone: url.searchParams.get('timezone') || '',
      });
      sendJSON(res, data);
    } catch (err) {
      console.error('[WeatherRadio]', err);
      sendJSON(res, {
        ok: false,
        error: err.message,
        weather: null,
        radio: { title: '天气电台', subtitle: '天气暂时没有回来，可以先听今日推荐。', seedQueries: [], songs: [] },
      }, 500);
    }
    return;
  }

  if (pn === '/api/weather/ip-location') {
    try {
      sendJSON(res, { ok: true, location: await fetchIpWeatherLocation() });
    } catch (err) {
      console.error('[WeatherIpLocation]', err);
      sendJSON(res, { ok: false, error: err.message, location: null }, 500);
    }
    return;
  }

  // ---------- Wallpaper Engine: 列出已下载的可用壁纸 ----------
  if (pn === '/api/wallpaper-engine/list') {
    try {
      const data = listWallpaperEngineItems(url.searchParams.get('refresh') === '1');
      sendJSON(res, { items: data.items, count: data.items.length, dirs: data.dirs });
    } catch (err) {
      console.error('[WE list]', err.message);
      sendJSON(res, { error: err.message, items: [] }, 500);
    }
    return;
  }

  // ---------- Wallpaper Engine: 诊断（看扫描到哪些目录） ----------
  if (pn === '/api/wallpaper-engine/debug') {
    try {
      const steamPath = readSteamPathFromRegistry();
      const dirs = findWallpaperEngineDirs();
      const data = listWallpaperEngineItems(true);
      sendJSON(res, { platform: process.platform, steamPath, workshopDirs: dirs, itemCount: data.items.length, envOverride: process.env.MINERADIO_WE_DIR || '' });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- Wallpaper Engine: 提供壁纸文件/预览图（带 Range） ----------
  if (pn === '/api/wallpaper-engine/media') {
    try {
      const id = url.searchParams.get('id') || '';
      const kind = url.searchParams.get('kind') === 'preview' ? 'preview' : 'file';
      const data = listWallpaperEngineItems(false);
      const entry = data.byId && data.byId[id];
      if (!entry) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('Wallpaper not found'); return; }
      const rel = kind === 'preview' ? entry.preview : entry.file;
      if (!rel) { res.writeHead(404, { 'Access-Control-Allow-Origin': '*' }); res.end('No ' + kind); return; }
      const target = path.join(entry.folder, rel);
      // 安全校验：解析后的路径必须仍在该壁纸目录内
      if (!path.resolve(target).startsWith(path.resolve(entry.folder))) { res.writeHead(403); res.end('Forbidden'); return; }
      serveWallpaperFile(req, res, target);
    } catch (err) {
      console.error('[WE media]', err.message);
      res.writeHead(500, { 'Access-Control-Allow-Origin': '*' }); res.end('Error');
    }
    return;
  }

  if (pn === '/api/search') {
    try {
      const kw    = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const songs = await handleSearch(kw, limit);
      sendJSON(res, { songs });
    } catch (err) { console.error('[Search]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
    return;
  }

  if (pn === '/api/search/youtube') {
    try {
      const kw    = url.searchParams.get('keywords') || '';
      const limit = parseInt(url.searchParams.get('limit') || '20');
      const songs = await handleYouTubeSearch(kw, limit);
      sendJSON(res, { songs });
    } catch (err) { console.error('[Search YouTube]', err); sendJSON(res, { error: err.message, songs: [] }, 500); }
    return;
  }

  if (pn === '/api/podcast/search') {
    try {
      const kw = String(url.searchParams.get('keywords') || '').trim();
      if (!kw) { sendJSON(res, { podcasts: [] }); return; }
      const yt = await getYTMusic();
      const r = await yt.music.search(kw, { type: 'podcast' });
      const podcasts = (r.items || []).slice(0, 18).map(p => ({
        id: p.id,
        name: p.title || 'Untitled Podcast',
        dj: { nickname: ((p.authors || []).map(a => a.name).join(' / ')) || 'YouTube Creator' },
        cover: (p.thumbnails && p.thumbnails.length && p.thumbnails[p.thumbnails.length - 1].url) || '',
        subCount: 0
      })).filter(p => p.id);
      sendJSON(res, { podcasts, total: podcasts.length });
    } catch (err) {
      console.error('[PodcastSearch]', err);
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/hot') {
    try {
      sendJSON(res, { podcasts: [], more: false });
    } catch (err) {
      sendJSON(res, { error: err.message, podcasts: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/detail') {
    try {
      sendJSON(res, { podcast: null });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/programs') {
    try {
      sendJSON(res, { radio: null, programs: [], more: false, total: 0 });
    } catch (err) {
      sendJSON(res, { error: err.message, programs: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) {
        const empty = ['collect', 'created', 'liked'].map(k => podcastCollectionMeta(k, []));
        sendJSON(res, { loggedIn: false, collections: empty });
        return;
      }
      const keys = ['collect', 'created', 'liked'];
      const collections = await Promise.all(keys.map(async key => {
        try {
          const data = await fetchMyPodcastItems(key, info, 12, 0);
          return podcastCollectionMeta(key, data.items || []);
        } catch (e) {
          console.warn('[MyPodcast]', key, e.message);
          return podcastCollectionMeta(key, []);
        }
      }));
      sendJSON(res, { loggedIn: true, collections });
    } catch (err) {
      console.error('[MyPodcast]', err);
      sendJSON(res, { error: err.message, collections: [] }, 500);
    }
    return;
  }

  if (pn === '/api/podcast/my/items') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn || !info.userId) { sendJSON(res, { loggedIn: false, items: [] }); return; }
      const key = String(url.searchParams.get('key') || 'collect');
      const limit = parseInt(url.searchParams.get('limit') || '36', 10) || 36;
      const offset = parseInt(url.searchParams.get('offset') || '0', 10) || 0;
      const data = await fetchMyPodcastItems(key, info, limit, offset);
      sendJSON(res, { loggedIn: true, key, ...podcastCollectionMeta(key, data.items || []), itemType: data.itemType, items: data.items || [] });
    } catch (err) {
      console.error('[MyPodcastItems]', err);
      sendJSON(res, { error: err.message, items: [] }, 500);
    }
    return;
  }

  if (pn === '/api/login/cookie') {
    try {
      const body = await readRequestBody(req);
      const raw = body.cookie || body.data || body.text || '';
      const normalized = normalizeCookieHeader(raw);
      if (!normalized) {
        sendJSON(res, { loggedIn: false, error: 'INVALID_COOKIE', message: '未检测到有效的 Google 会话 Cookie' }, 400);
        return;
      }
      saveCookie(normalized);
      const info = await getLoginInfo({ hydrate: false });
      sendJSON(res, { ...info, loggedIn: true, saved: true, hasCookie: true });
    } catch (err) {
      console.error('[LoginCookie]', err);
      sendJSON(res, { loggedIn: false, error: err.message }, 500);
    }
    return;
  }

  // ---------- 播客 DJ 长音频后端离线锁拍 ----------
  if (pn === '/api/podcast/dj-beatmap') {
    try {
      const audioUrl = url.searchParams.get('url');
      const durationSec = Math.max(0, Number(url.searchParams.get('duration') || 0) || 0);
      if (!audioUrl || !/^https?:\/\//i.test(audioUrl)) {
        sendJSON(res, { error: 'Invalid audio url' }, 400);
        return;
      }
      console.log('[PodcastDjBeatmap] start', Math.round(durationSec || 0) + 's');
      const started = Date.now();
      const introSec = Math.max(0, Number(url.searchParams.get('intro') || 0) || 0);
      const map = introSec
        ? await analyzePodcastDjIntro(audioUrl, { durationSec, introSec, userAgent: UA })
        : await analyzePodcastDjStream(audioUrl, { durationSec, userAgent: UA });
      console.log('[PodcastDjBeatmap] done beats:', map.visualBeatCount || 0, 'ms:', Date.now() - started, 'decode:', map.decode || {});
      sendJSON(res, { ok: true, map });
    } catch (err) {
      console.error('[PodcastDjBeatmap]', err);
      sendJSON(res, { ok: false, error: err.message || String(err) }, 500);
    }
    return;
  }

  // ---------- 登录态查询 ----------
  if (pn === '/api/login/status') {
    const info = await getLoginInfo({ hydrate: false });
    sendJSON(res, info);
    return;
  }

  if (pn === '/api/login/profile') {
    const info = await getLoginInfo({ hydrate: true });
    sendJSON(res, info);
    return;
  }

  // ---------- 登出 ----------
  if (pn === '/api/logout') {
    saveCookie('');
    sendJSON(res, { ok: true });
    return;
  }

  // ---------- 用户歌单 (YouTube Music 原生) ----------
  if (pn === '/api/user/playlists') {
    try {
      const info = await getLoginInfo();
      if (!info.loggedIn) { sendJSON(res, { loggedIn: false, playlists: [] }); return; }
      let list = [];
      try {
        const yt = await getYTMusic();
        if (yt && yt.session.logged_in) {
          console.log('[UserPlaylists] Fetching real library playlists from YTM...');
          const lib = await yt.music.getLibrary();
          for (const section of (lib.contents || [])) {
            const items = section.items || section.contents || [];
            for (const pl of items) {
              const browseId = pl.id || (pl.endpoint && pl.endpoint.payload && pl.endpoint.payload.browseId) || '';
              if (!browseId) continue;
              const subtitle = (pl.subtitle && pl.subtitle.text) || (typeof pl.subtitle === 'string' ? pl.subtitle : '') || '';
              if (browseId.startsWith('UC') || /artist|艺人|歌手|subscribers/i.test(subtitle)) continue;
              const isLikedSongs = browseId === 'VLLM';
              const title = isLikedSongs ? '点赞的歌曲' : ((pl.title && pl.title.text) || (typeof pl.title === 'string' ? pl.title : '') || 'Untitled Playlist');
              let trackCount = 0;
              const tcMatch = subtitle.match(/(\d+)\s*(?:tracks|songs|首)/i);
              if (tcMatch) trackCount = parseInt(tcMatch[1], 10);
              if (isLikedSongs) {
                try {
                  trackCount = await countYtmPlaylistItems(yt, browseId, 1200);
                } catch (countErr) {
                  console.warn('[UserPlaylists] liked songs count warning:', countErr.message);
                }
              }
              let cover = '';
              const thumbs = pl.thumbnail || pl.thumbnails || [];
              if (Array.isArray(thumbs) && thumbs.length > 0) cover = thumbs[thumbs.length - 1].url || '';
              list.push({
                id: browseId,
                name: title,
                cover: cover,
                trackCount: trackCount,
                creator: info.nickname || 'YouTube Music',
                specialType: browseId === 'VLLM' ? 5 : 0
              });
            }
          }
        }
      } catch(e) {
        console.warn('[UserPlaylists] YTM library fetch warning:', e.message);
      }
      if (!list.length) {
        list = [
          { id: 'VLPL4fGSI1pDJn6puJdseH2Rt9sMvt9E2M4i', name: 'Top 100 Songs Global', cover: '', trackCount: 100, creator: 'YouTube Music', specialType: 0 },
          { id: 'VLPLOHoVaTp8R7d3L_pjuwIa6nRh4tH5nI4x', name: 'Top YouTube Music 2026 Hits', cover: '', trackCount: 80, creator: 'YouTube Music', specialType: 0 },
          { id: 'VLPLHg022HMFzFCJNn0WN7UM0_0uY109bcv2', name: 'Top 100 Songs 2026', cover: '', trackCount: 100, creator: 'YouTube Music', specialType: 0 },
          { id: 'VLPL4fGSI1pDJn5kI81J1fYWK5eZRl1zJ5k', name: 'J-Pop Hotlist', cover: '', trackCount: 50, creator: 'YouTube Music', specialType: 0 },
        ];
      }
      sendJSON(res, { loggedIn: true, provider: 'youtube', userId: info.userId, playlists: list });
    } catch (err) {
      console.error('[UserPlaylists]', err);
      sendJSON(res, { error: err.message, loggedIn: false, playlists: [] }, 500);
    }
    return;
  }

  // ---------- 红心状态 ----------
  if (pn === '/api/song/like/check') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const ids = String(url.searchParams.get('ids') || url.searchParams.get('id') || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const liked = {};
      ids.forEach(id => { liked[id] = false; });
      sendJSON(res, { loggedIn: true, ids, liked });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 红心/取消红心 ----------
  if (pn === '/api/song/like') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const id = body.id || url.searchParams.get('id');
      const nextLike = String(body.like != null ? body.like : (url.searchParams.get('like') || 'true')) !== 'false';
      if (!id) { sendJSON(res, { error: 'MISSING_SONG_ID' }, 400); return; }
      const yt = await getYTMusic();
      if (!yt || !yt.session || !yt.session.logged_in) {
        sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
        return;
      }
      await likeYtmSong(yt, id, nextLike);
      sendJSON(res, { loggedIn: true, id, liked: nextLike, provider: 'youtube', code: 200 });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 创建歌单 ----------
  if (pn === '/api/playlist/create') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const name = String(body.name || url.searchParams.get('name') || '').trim().slice(0, 80);
      if (!name) { sendJSON(res, { error: 'MISSING_PLAYLIST_NAME' }, 400); return; }
      const yt = await getYTMusic();
      if (!yt || !yt.session || !yt.session.logged_in) {
        sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false }, 401);
        return;
      }
      const created = await yt.playlist.create(name, []);
      const id = created && created.playlist_id;
      if (!id) throw new Error('CREATE_PLAYLIST_FAILED');
      sendJSON(res, {
        loggedIn: true,
        code: 200,
        success: true,
        playlist: { id, name, cover: '', trackCount: 0, creator: info.nickname || 'YouTube Music' }
      });
    } catch (err) {
      sendJSON(res, { error: err.message }, 500);
    }
    return;
  }

  // ---------- 收藏歌曲到歌单 ----------
  if (pn === '/api/playlist/add-song') {
    try {
      const info = await requireLogin(res);
      if (!info) return;
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      const pid = String(body.pid || body.playlistId || url.searchParams.get('pid') || url.searchParams.get('playlistId') || '').trim();
      const id = String(body.id || body.videoId || url.searchParams.get('id') || url.searchParams.get('videoId') || '').trim();
      if (!pid) { sendJSON(res, { error: 'MISSING_PLAYLIST_ID', success: false }, 400); return; }
      if (!id) { sendJSON(res, { error: 'MISSING_SONG_ID', success: false }, 400); return; }
      const yt = await getYTMusic();
      if (!yt || !yt.session || !yt.session.logged_in) {
        sendJSON(res, { error: 'LOGIN_REQUIRED', loggedIn: false, success: false }, 401);
        return;
      }
      if (isYtmLikedPlaylistId(pid)) {
        await likeYtmSong(yt, id, true);
        sendJSON(res, { loggedIn: true, code: 200, success: true, playlistId: pid, id, liked: true });
        return;
      }
      const editablePid = normalizeYtmPlaylistEditId(pid);
      await yt.playlist.addVideos(editablePid, [id]);
      sendJSON(res, { loggedIn: true, code: 200, success: true, playlistId: pid, editPlaylistId: editablePid, id });
    } catch (err) {
      sendJSON(res, { error: err.message, success: false }, 500);
    }
    return;
  }


  // ---------- 歌词 (YouTube Music 原生) ----------
  if (pn === '/api/lyric') {
    try {
      const id = url.searchParams.get('id') || '';
      const name = url.searchParams.get('name') || '';
      const artist = url.searchParams.get('artist') || '';
      const album = url.searchParams.get('album') || '';
      const durationSec = Number(url.searchParams.get('duration') || 0) || 0;
      const out = await lyricsService.resolve({ name, artist, album, durationSec, videoId: id });
      sendJSON(res, { lyric: out.lyric, tlyric: '', yrc: '', source: out.source });
    } catch (err) {
      console.error('[Lyric]', err.message);
      sendJSON(res, { error: err.message, lyric: '' }, 500);
    }
    return;
  }

  // ---------- 歌词翻译成中文（网易云人工翻译优先，机器翻译兜底） ----------
  if (pn === '/api/lyric/translate') {
    try {
      const body = req.method === 'POST' ? await readRequestBody(req) : {};
      sendJSON(res, await lyricsService.translate(body));
    } catch (err) {
      console.error('[LyricTranslate]', err.message);
      sendJSON(res, { error: err.message, translated: [] }, 500);
    }
    return;
  }

  // ---------- 歌曲评论 (YouTube 评论源) ----------
  if (pn === '/api/song/comments') {
    try {
      const id = String(url.searchParams.get('id') || '').trim();
      const limit = Math.max(4, Math.min(36, parseInt(url.searchParams.get('limit') || '18', 10) || 18));
      if (!id) { sendJSON(res, { id: '', total: 0, comments: [], hot: false }); return; }
      const comments = await handleYouTubeComments(id, limit);
      sendJSON(res, { provider: 'youtube', id, total: comments.length, comments, hot: false });
    } catch (err) {
      console.warn('[SongComments YTM]', err.message);
      sendJSON(res, { id: url.searchParams.get('id') || '', total: 0, comments: [], hot: false });
    }
    return;
  }

  // ---------- 歌手主页 / 热门歌曲 (YouTube Music 原生) ----------
  if (pn === '/api/artist/detail') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing artist id', songs: [] }, 400); return; }
      let artistName = 'Artist';
      let songs = [];
      try {
        const yt = await getYTMusic();
        if (id.startsWith('UC') || id.startsWith('MPLA')) {
          const art = await yt.music.getArtist(id);
          artistName = art && art.header && art.header.title ? String(art.header.title) : 'Artist';
          const topSongsShelf = (art && art.sections || []).find(s => s.type === 'MusicShelf');
          if (topSongsShelf && topSongsShelf.contents) {
            songs = topSongsShelf.contents.map(mapYTMItem).filter(Boolean);
          }
        }
      } catch (e) {
        console.warn('[ArtistDetail YTM]', e.message);
      }
      sendJSON(res, {
        id,
        artist: { id, name: artistName, avatar: '', brief: 'YouTube Music Artist', musicSize: songs.length, albumSize: 0 },
        songs
      });
    } catch (err) {
      console.error('[ArtistDetail]', err);
      sendJSON(res, { error: err.message, songs: [] }, 500);
    }
    return;
  }

  // ---------- 歌单曲目详情 (YouTube Music 原生) ----------
  if (pn === '/api/playlist/tracks') {
    try {
      const id = url.searchParams.get('id');
      if (!id) { sendJSON(res, { error: 'Missing playlist id', tracks: [] }, 400); return; }
      const yt = await getYTMusic();
      const pl = await yt.music.getPlaylist(id);
      const items = pl.items || [];
      const tracks = items.map(mapYTMItem).filter(Boolean);
      const plTitle = pl.header && pl.header.title ? String(pl.header.title) : 'YouTube Music Playlist';
      sendJSON(res, {
        playlist: { id, name: plTitle, cover: '', trackCount: tracks.length },
        tracks
      });
    } catch (err) {
      console.error('[PlaylistTracks YTM]', err.message);
      sendJSON(res, { error: err.message, tracks: [] }, 500);
    }
    return;
  }

  // ---------- 封面代理 (带 CORS 头, 给 canvas 提取像素用) ----------
  if (pn === '/api/cover') {
    try {
      const coverUrl = url.searchParams.get('url');
      // URL 校验: 必须是 http(s) 开头, 否则直接 404 (不要让 fetch 抛错)
      if (!coverUrl || !/^https?:\/\//i.test(coverUrl)) {
        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
        res.end('Invalid cover url');
        return;
      }
      const resp = await fetch(coverUrl, { headers: { 'User-Agent': UA } });
      const ct  = resp.headers.get('content-type') || 'image/jpeg';
      const cl  = resp.headers.get('content-length');
      const hdr = {
        'Content-Type': ct,
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': 'public, max-age=86400',
      };
      if (cl) hdr['Content-Length'] = cl;
      res.writeHead(resp.status, hdr);
      const reader = resp.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Cover]', err); res.writeHead(500); res.end(); }
    return;
  }

  // ---------- 诊断: YTM 音频链路排查 ----------
  // ---------- 诊断: 歌词匹配排查（看每首歌卡在哪一步） ----------
  if (pn === '/api/debug/lyric') {
    try {
      sendJSON(res, await lyricsService.debug({
        name: url.searchParams.get('name') || '',
        artist: url.searchParams.get('artist') || '',
        album: url.searchParams.get('album') || '',
        id: url.searchParams.get('id') || '',
        durationSec: Number(url.searchParams.get('duration') || 0) || 0,
      }));
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // ---------- 静态资源 ----------
  if (pn.startsWith('/api/') && !API_ROUTE_SET.has(pn)) {
    sendJSON(res, { ok: false, error: 'API_ROUTE_NOT_FOUND', path: pn }, 404);
    return;
  }

  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(__dirname, 'public', filePath);
  serveStatic(res, filePath);
});

function startServer() {
  server.listen(PORT, HOST, () => {
    console.log('======================================================');
    console.log(' Mineradio v2 -> http://localhost:' + PORT);
    console.log(' Login: ' + (userCookie ? 'cookie loaded' : 'not logged in'));
    console.log('======================================================');
  });
  return server;
}

function releaseServerResources(reason) {
  const cancelledJobs = cancelUpdateJobs(reason || 'SERVER_SHUTDOWN');
  if (loginService) loginService.reset();
  if (ytmAudioService) ytmAudioService.clear();
  if (ytmSession) ytmSession.clear();
  ytmAudioService = null;
  radioService = null;
  ytmSession = null;
  return cancelledJobs;
}

function shutdownServer(callback) {
  releaseServerResources('SERVER_SHUTDOWN');
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  if (!server.listening) {
    if (typeof callback === 'function') queueMicrotask(callback);
    return server;
  }
  return server.close(callback);
}

server.on('close', () => releaseServerResources('SERVER_CLOSED'));

if (require.main === module) startServer();

module.exports = { server, startServer, shutdownServer, releaseServerResources };
