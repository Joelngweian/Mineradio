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
const { Innertube, Platform } = require('youtubei.js');
const { Readable } = require('stream');

// 注入 Node 环境下的 JavaScript Evaluator (解决 YouTube 签名解密 No valid URL to decipher 报错)
Platform.shim.eval = async (data, env) => vm.runInNewContext(`(function() { ${data.output} })()`, env);

let ytInstance = null;
let lastCookieUsed = null;

async function getYTMusic(customCookie) {
  const cookieToUse = customCookie !== undefined ? customCookie : userCookie;
  if (!ytInstance || lastCookieUsed !== cookieToUse) {
    try {
      ytInstance = await Innertube.create({ cookie: cookieToUse || undefined });
      lastCookieUsed = cookieToUse;
    } catch(e) {
      console.warn('[YTM Engine Init Warning]', e.message);
      if (!ytInstance) ytInstance = await Innertube.create();
    }
  }
  return ytInstance;
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
const UPDATE_WORK_DIR = process.env.MINERADIO_UPDATE_DIR || path.join(__dirname, 'updates');
const UPDATE_DOWNLOAD_DIR = process.env.MINERADIO_UPDATE_DOWNLOAD_DIR || path.join(UPDATE_WORK_DIR, 'downloads');
const UPDATE_PATCH_BACKUP_DIR = process.env.MINERADIO_PATCH_BACKUP_DIR || path.join(UPDATE_WORK_DIR, 'backups', 'patches');
const BEATMAP_CACHE_DIR = process.env.MINERADIO_BEAT_CACHE_DIR || 'D:\\MineradioCache\\beatmaps';
const APP_PACKAGE = readPackageInfo();
const APP_VERSION = process.env.MINERADIO_VERSION || APP_PACKAGE.version || '0.9.11';
const UPDATE_CONFIG = readUpdateConfig(APP_PACKAGE);
const PATCH_MAX_BYTES = 12 * 1024 * 1024;
const UPDATE_PROBE_BYTES = 512 * 1024;
const UPDATE_PROBE_TIMEOUT_MS = 5000;
const MIN_UPDATE_DOWNLOAD_SWITCH_BPS = 768 * 1024;
const UPDATE_SLOW_SWITCH_GRACE_MS = 8000;
const UPDATE_SLOW_SWITCH_WINDOW_MS = 6000;
const PATCH_ALLOWED_ROOTS = new Set(['public', 'desktop', 'build']);
const PATCH_ALLOWED_FILES = new Set(['server.js', 'dj-analyzer.js', 'package.json', 'package-lock.json']);
const UPDATE_FALLBACK_NOTES = [
  '电影镜头节奏更松',
  '音源失败自动换源',
  '右上角更新提示',
];
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

const updateDownloadJobs = new Map();

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
  try { fs.writeFileSync(COOKIE_FILE, userCookie); } catch (e) {}
  try { fs.writeFileSync(path.join(__dirname, '.google-cookie'), userCookie); } catch (e) {}
}

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
function readPackageInfo() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function parseGitHubRepository(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;
  const direct = raw.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (direct) return { owner: direct[1], repo: direct[2].replace(/\.git$/i, '') };
  const github = raw.match(/github\.com[:/]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?(?:[#/?].*)?$/i);
  if (github) return { owner: github[1], repo: github[2].replace(/\.git$/i, '') };
  return null;
}
function readUpdateConfig(pkg) {
  const local = (pkg && pkg.mineradio && pkg.mineradio.update) || {};
  const repoHint = process.env.MINERADIO_UPDATE_REPOSITORY
    || process.env.GITHUB_REPOSITORY
    || local.repository
    || local.github
    || (pkg && pkg.repository && (pkg.repository.url || pkg.repository))
    || '';
  const parsed = parseGitHubRepository(repoHint) || {};
  const owner = process.env.MINERADIO_UPDATE_OWNER || local.owner || parsed.owner || '';
  const repo = process.env.MINERADIO_UPDATE_REPO || local.repo || parsed.repo || '';
  return {
    provider: local.provider || 'github',
    owner,
    repo,
    configured: !!(owner && repo),
    preview: local.preview !== false,
    preferMirrors: local.preferMirrors !== false,
    mirrors: readUpdateMirrors(local),
    manifest: process.env.MINERADIO_UPDATE_MANIFEST
      || process.env.MINERADIO_UPDATE_MANIFEST_URL
      || process.env.MINERADIO_UPDATE_MANIFEST_FILE
      || '',
  };
}
function parseUpdateMirrorList(value) {
  if (Array.isArray(value)) return value;
  return String(value || '').split(/[\n,;]/);
}
function readUpdateMirrors(local) {
  const envMirrors = process.env.MINERADIO_UPDATE_MIRRORS || process.env.MINERADIO_UPDATE_MIRROR || '';
  const raw = envMirrors
    ? parseUpdateMirrorList(envMirrors)
    : parseUpdateMirrorList(local.mirrors || local.downloadMirrors || []);
  const seen = new Set();
  const mirrors = [];
  raw.forEach(item => {
    const url = String(item || '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    const key = url.replace(/\/+$/, '').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    mirrors.push(url);
  });
  return mirrors.slice(0, 6);
}
function normalizeDigest(value, algorithm) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const prefix = new RegExp('^' + algorithm + ':', 'i');
  return raw.replace(prefix, '').trim().replace(/^['"]|['"]$/g, '');
}
function assetDigestInfo(asset) {
  const digest = String(asset && asset.digest || '').trim();
  return {
    sha256: normalizeDigest((asset && asset.sha256) || (/^sha256:/i.test(digest) ? digest : ''), 'sha256').toLowerCase(),
    sha512: normalizeDigest((asset && asset.sha512) || (/^sha512:/i.test(digest) ? digest : ''), 'sha512'),
  };
}
function buildMirrorUrl(originalUrl, mirror) {
  const source = String(originalUrl || '').trim();
  const base = String(mirror || '').trim();
  if (!/^https?:\/\//i.test(source) || !/^https?:\/\//i.test(base)) return '';
  if (base.includes('{encodedUrl}')) return base.replace(/\{encodedUrl\}/g, encodeURIComponent(source));
  if (base.includes('{url}')) return base.replace(/\{url\}/g, source);
  return base.replace(/\/+$/, '/') + source;
}
function uniqueDownloadCandidates(urls, opts) {
  opts = opts || {};
  const directUrls = (Array.isArray(urls) ? urls : [urls])
    .map(url => String(url || '').trim())
    .filter(url => /^https?:\/\//i.test(url));
  const directSet = new Set(directUrls.map(url => url.toLowerCase()));
  const mirrors = opts.useMirrors === false ? [] : (UPDATE_CONFIG.mirrors || []);
  const mirrored = [];
  directUrls.forEach(source => {
    mirrors.forEach((mirror, index) => {
      const url = buildMirrorUrl(source, mirror);
      if (url) mirrored.push({
        url,
        label: '国内加速线路 ' + (index + 1),
        mirrored: true,
      });
    });
  });
  const direct = directUrls.map(url => ({
    url,
    label: directSet.has(url.toLowerCase()) ? 'GitHub 直连' : '下载线路',
    mirrored: false,
  }));
  const ordered = UPDATE_CONFIG.preferMirrors === false ? direct.concat(mirrored) : mirrored.concat(direct);
  const seen = new Set();
  return ordered.filter(item => {
    const key = item.url.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function publicDownloadUrls(candidates) {
  return (Array.isArray(candidates) ? candidates : [])
    .map(item => item && item.url)
    .filter(Boolean);
}
function normalizeVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').replace(/[+].*$/, '').replace(/-.+$/, '');
}
function compareVersions(a, b) {
  const aa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const bb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(aa.length, bb.length, 3);
  for (let i = 0; i < len; i++) {
    const left = aa[i] || 0;
    const right = bb[i] || 0;
    if (left > right) return 1;
    if (left < right) return -1;
  }
  return 0;
}
function cleanReleaseLine(line) {
  return String(line || '')
    .replace(/^\s*#{1,6}\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}
function extractReleaseNotes(body) {
  const notes = [];
  String(body || '').split(/\r?\n/).forEach(line => {
    const text = cleanReleaseLine(line);
    if (!text) return;
    if (/^(what'?s changed|changes|changelog|full changelog|更新日志)$/i.test(text)) return;
    if (/^https?:\/\//i.test(text)) return;
    if (text.length > 72) return;
    notes.push(text);
  });
  return notes.slice(0, 4);
}
function pickReleaseAsset(assets) {
  const list = Array.isArray(assets) ? assets : [];
  const preferred = list.find(a => /\.(exe|msi)$/i.test(a && a.name || ''))
    || list.find(a => /\.(zip|7z)$/i.test(a && a.name || ''))
    || list[0];
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function patchAssetVersions(name) {
  const matches = String(name || '').match(/\d+(?:[._-]\d+){1,3}/g) || [];
  return matches.map(item => normalizeVersion(item.replace(/[._-]/g, '.'))).filter(Boolean);
}
function pickPatchAsset(assets, currentVersion, latestVersion) {
  const list = Array.isArray(assets) ? assets : [];
  const current = normalizeVersion(currentVersion || APP_VERSION);
  const latest = normalizeVersion(latestVersion || '');
  const preferred = list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    if (latest) return versions[0] === current && versions[versions.length - 1] === latest;
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => {
    const name = String(a && a.name || '');
    if (!/\.(patch\.json|patch|json)$/i.test(name)) return false;
    const versions = patchAssetVersions(name);
    return versions[0] === current && name.toLowerCase().includes('patch');
  }) || list.find(a => /\.(patch\.json|patch)$/i.test(a && a.name || ''));
  if (!preferred) return null;
  const digest = assetDigestInfo(preferred);
  const candidates = uniqueDownloadCandidates(preferred.browser_download_url || '');
  return {
    name: preferred.name || '',
    size: preferred.size || 0,
    contentType: preferred.content_type || '',
    downloadUrl: preferred.browser_download_url || '',
    downloadUrls: publicDownloadUrls(candidates),
    sha256: digest.sha256 || '',
    sha512: digest.sha512 || '',
  };
}
function updateAssetNameFromUrl(value) {
  try {
    const u = new URL(String(value || ''));
    const base = path.basename(decodeURIComponent(u.pathname || ''));
    if (base) return base;
  } catch (_) {}
  return path.basename(String(value || '').split('?')[0]) || '';
}
function normalizeManifestUpdateInfo(data) {
  data = data || {};
  const release = data.release || {};
  const asset = release.asset || data.asset || {};
  const latestVersion = normalizeVersion(
    data.latestVersion
    || data.version
    || release.version
    || release.tagName
    || release.tag_name
    || release.name
    || APP_VERSION
  ) || APP_VERSION;
  const downloadUrl = release.downloadUrl || data.downloadUrl || asset.downloadUrl || asset.browser_download_url || '';
  const patch = release.patch || data.patch || null;
  const assetUrls = [downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []);
  const patchUrls = patch ? [patch.downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []) : [];
  const patchInfo = patch && patch.downloadUrl ? {
    name: patch.name || updateAssetNameFromUrl(patch.downloadUrl) || `Mineradio-${APP_VERSION}→${latestVersion}.patch.json`,
    size: Number(patch.size || 0) || 0,
    contentType: patch.contentType || patch.content_type || 'application/json',
    downloadUrl: patch.downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(patchUrls)),
    from: normalizeVersion(patch.from || APP_VERSION),
    to: normalizeVersion(patch.to || latestVersion),
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
  } : null;
  const notes = Array.isArray(release.notes) && release.notes.length
    ? release.notes.slice(0, 4).map(cleanReleaseLine).filter(Boolean)
    : (extractReleaseNotes(release.body || data.body).length ? extractReleaseNotes(release.body || data.body) : UPDATE_FALLBACK_NOTES);
  const assetInfo = downloadUrl ? {
    name: asset.name || updateAssetNameFromUrl(downloadUrl) || `Mineradio-${latestVersion}-Setup.exe`,
    size: Number(asset.size || 0) || 0,
    contentType: asset.contentType || asset.content_type || '',
    downloadUrl,
    downloadUrls: publicDownloadUrls(uniqueDownloadCandidates(assetUrls)),
    sha256: normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(asset.sha512 || release.sha512 || data.sha512 || '', 'sha512'),
  } : null;
  return {
    configured: true,
    preview: false,
    updateAvailable: data.updateAvailable != null ? !!data.updateAvailable : compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: release.tagName || release.tag_name || data.tagName || ('v' + latestVersion),
      name: release.name || data.name || ('Mineradio v' + latestVersion),
      version: latestVersion,
      publishedAt: release.publishedAt || release.published_at || data.publishedAt || '',
      htmlUrl: release.htmlUrl || release.html_url || data.htmlUrl || '',
      downloadUrl,
      asset: assetInfo,
      patch: patchInfo,
      patchAvailable: !!(patchInfo && patchInfo.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
      summary: release.summary || data.summary || notes[0] || '发现新版本，建议更新。',
      notes,
    },
    source: 'manifest',
  };
}
async function readUpdateManifest(ref) {
  const value = String(ref || '').trim();
  if (!value) throw new Error('UPDATE_MANIFEST_MISSING');
  if (/^https?:\/\//i.test(value)) {
    const resp = await fetch(value, {
      headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
    });
    if (!resp.ok) throw new Error('Update manifest ' + resp.status);
    return resp.json();
  }
  const file = /^file:/i.test(value) ? fileURLToPath(value) : path.resolve(value);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
async function fetchManifestUpdateInfo(ref) {
  try {
    const data = await readUpdateManifest(ref);
    return normalizeManifestUpdateInfo(data);
  } catch (err) {
    return localUpdateFallback(err.message || 'Update manifest failed', { configured: true });
  }
}
function beatCacheRootInfo() {
  const dir = path.resolve(BEATMAP_CACHE_DIR);
  const root = path.parse(dir).root;
  const drive = root ? root.replace(/[\\\/]+$/, '').toUpperCase() : '';
  const allowed = !!root && !/^C:$/i.test(drive);
  const available = allowed && fs.existsSync(root);
  return { dir, root, drive, allowed, available };
}
function ensureBeatMapCacheDir() {
  const info = beatCacheRootInfo();
  if (!info.allowed) {
    const err = new Error('BEAT_CACHE_ON_C_DRIVE_DISABLED');
    err.code = 'BEAT_CACHE_ON_C_DRIVE_DISABLED';
    err.info = info;
    throw err;
  }
  if (!info.available) {
    const err = new Error('BEAT_CACHE_DRIVE_UNAVAILABLE');
    err.code = 'BEAT_CACHE_DRIVE_UNAVAILABLE';
    err.info = info;
    throw err;
  }
  fs.mkdirSync(info.dir, { recursive: true });
  return info.dir;
}
function safeBeatMapCacheFile(key) {
  const raw = String(key || '').trim();
  if (!raw || raw.length > 240) return null;
  const hash = crypto.createHash('sha1').update(raw).digest('hex');
  const label = raw.replace(/[^a-z0-9_.-]+/gi, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'beatmap';
  return path.join(ensureBeatMapCacheDir(), `${label}-${hash}.json`);
}
function compactBeatMapCachePayload(body) {
  const key = String(body && body.key || '').trim();
  const map = body && body.map;
  if (!key || !map || typeof map !== 'object') return null;
  return {
    v: 1,
    key,
    savedAt: Date.now(),
    meta: {
      provider: String(body.provider || '').slice(0, 32),
      title: String(body.title || '').slice(0, 160),
      artist: String(body.artist || '').slice(0, 160),
      mode: String(body.mode || 'mr').slice(0, 32),
    },
    map,
  };
}
function readBeatMapCache(key) {
  const file = safeBeatMapCacheFile(key);
  if (!file || !fs.existsSync(file)) return null;
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  return raw && raw.map ? raw : null;
}
function writeBeatMapCache(body) {
  const payload = compactBeatMapCachePayload(body);
  if (!payload) return { ok: false, error: 'INVALID_BEATMAP_CACHE_PAYLOAD' };
  const file = safeBeatMapCacheFile(payload.key);
  if (!file) return { ok: false, error: 'INVALID_BEATMAP_CACHE_KEY' };
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload));
  fs.renameSync(tmp, file);
  return { ok: true, key: payload.key, savedAt: payload.savedAt, dir: path.dirname(file) };
}
function localUpdateFallback(reason, opts) {
  opts = opts || {};
  const configured = !!(opts.configured != null ? opts.configured : false);
  return {
    configured,
    preview: UPDATE_CONFIG.preview,
    updateAvailable: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    release: {
      tagName: 'v' + APP_VERSION,
      name: 'Mineradio v' + APP_VERSION,
      version: APP_VERSION,
      htmlUrl: '',
      downloadUrl: '',
      summary: '当前版本，更新检测已就绪。',
      notes: UPDATE_FALLBACK_NOTES,
    },
    reason: reason || '',
  };
}
function updateError(code, message, cause) {
  const err = new Error(message || code);
  err.code = code;
  if (cause) err.cause = cause;
  return err;
}
function classifyUpdateError(err) {
  const code = String(err && err.code || '').trim();
  const message = String(err && err.message || err || '').trim();
  const detail = message || code || '未知错误';
  if (/HASH|DIGEST|CHECKSUM/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_HASH_MISMATCH', reason: '文件校验失败，可能是线路缓存异常，已拦截该安装包。', detail };
  }
  if (/SIZE_MISMATCH|content length/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_SIZE_MISMATCH', reason: '下载文件大小不一致，可能是网络中断或线路缓存不完整。', detail };
  }
  if (/AbortError|TIMEOUT|ETIMEDOUT|timeout/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_TIMEOUT', reason: '连接超时，当前网络到更新线路不稳定。', detail };
  }
  if (/ENOTFOUND|EAI_AGAIN|DNS|fetch failed|getaddrinfo/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_DNS_FAILED', reason: '域名解析失败，可能是当前网络无法连接该更新线路。', detail };
  }
  if (/ECONNRESET|ECONNREFUSED|socket|network/i.test(code + ' ' + message)) {
    return { code: code || 'UPDATE_NETWORK_FAILED', reason: '网络连接被中断，已尝试切换更新线路。', detail };
  }
  const http = message.match(/\bHTTP[_\s-]?(\d{3})\b/i) || message.match(/\b(\d{3})\b/);
  if (http) {
    const status = Number(http[1]);
    if (status === 403) return { code: code || 'UPDATE_HTTP_403', reason: '更新线路返回 403，可能被限流或拦截。', detail };
    if (status === 404) return { code: code || 'UPDATE_HTTP_404', reason: '更新文件不存在，可能 release 资源还没有同步完成。', detail };
    if (status >= 500) return { code: code || 'UPDATE_HTTP_5XX', reason: '更新线路服务器异常，请稍后重试。', detail };
    return { code: code || ('UPDATE_HTTP_' + status), reason: '更新线路返回 HTTP ' + status + '。', detail };
  }
  return { code: code || 'UPDATE_FAILED', reason: '更新失败：' + detail, detail };
}
async function fetchWithTimeout(url, opts, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 12000);
  try {
    return await fetch(url, Object.assign({}, opts || {}, { signal: controller.signal }));
  } finally {
    clearTimeout(timer);
  }
}
async function probeUpdateCandidateSpeed(candidate) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPDATE_PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  let received = 0;
  try {
    const resp = await fetch(candidate.url, {
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Range': 'bytes=0-' + (UPDATE_PROBE_BYTES - 1),
      },
      signal: controller.signal,
    });
    if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
    if (!resp.body || !resp.body.getReader) return 0;
    const reader = resp.body.getReader();
    try {
      while (received < UPDATE_PROBE_BYTES) {
        const chunk = await reader.read();
        if (chunk.done) break;
        received += Buffer.from(chunk.value).length;
      }
    } finally {
      try { await reader.cancel(); } catch (_) {}
    }
    const seconds = Math.max(0.1, (Date.now() - startedAt) / 1000);
    return received > 0 ? Math.round(received / seconds) : 0;
  } finally {
    clearTimeout(timer);
  }
}
async function prioritizeUpdateDownloadCandidates(job, candidates) {
  const list = Array.isArray(candidates) ? candidates.filter(item => item && item.url) : [];
  if (list.length < 2) return list;
  job.sourceLabel = '测速选择线路';
  job.attempt = 0;
  job.attempts = list.length;
  job.message = '正在测速更新线路';
  job.updatedAt = Date.now();
  const probed = await Promise.all(list.map(async (candidate, index) => {
    try {
      const probeSpeedBps = await probeUpdateCandidateSpeed(candidate);
      return Object.assign({}, candidate, { probeSpeedBps, probeFailed: false, originalIndex: index });
    } catch (err) {
      return Object.assign({}, candidate, { probeSpeedBps: 0, probeFailed: true, originalIndex: index });
    }
  }));
  if (!probed.some(item => item.probeSpeedBps > 0)) return list;
  probed.sort((a, b) => b.probeSpeedBps - a.probeSpeedBps);
  const ordered = probed.filter(item => item.probeSpeedBps > 0)
    .concat(probed.filter(item => item.probeSpeedBps <= 0).sort((a, b) => a.originalIndex - b.originalIndex));
  return ordered.map(item => ({
    url: item.url,
    label: item.label,
    mirrored: item.mirrored,
  }));
}
async function fetchTextFromCandidates(candidates, timeoutMs) {
  const list = Array.isArray(candidates) && candidates.length ? candidates : [];
  const failures = [];
  for (let i = 0; i < list.length; i++) {
    const candidate = list[i];
    try {
      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, timeoutMs || 6500);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);
      return { text: await resp.text(), candidate };
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push(candidate.label + ': ' + info.reason);
    }
  }
  throw updateError('UPDATE_ALL_LINES_FAILED', failures.join('；') || 'All update lines failed');
}
function yamlScalar(text, key) {
  const pattern = new RegExp('^\\s*' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:\\s*(.+?)\\s*$', 'm');
  const match = String(text || '').match(pattern);
  if (!match) return '';
  return match[1].trim().replace(/^['"]|['"]$/g, '');
}
function githubReleaseDownloadUrl(version, fileName) {
  const tag = 'v' + normalizeVersion(version);
  const encodedOwner = encodeURIComponent(UPDATE_CONFIG.owner);
  const encodedRepo = encodeURIComponent(UPDATE_CONFIG.repo);
  const encodedName = String(fileName || '').split('/').map(part => encodeURIComponent(part)).join('/');
  return `https://github.com/${encodedOwner}/${encodedRepo}/releases/download/${tag}/${encodedName}`;
}
function parseLatestYmlUpdateInfo(text, reason) {
  const latestVersion = normalizeVersion(yamlScalar(text, 'version') || APP_VERSION) || APP_VERSION;
  const assetPath = yamlScalar(text, 'path') || yamlScalar(text, 'url') || `Mineradio-${latestVersion}-Setup.exe`;
  const sha512 = normalizeDigest(yamlScalar(text, 'sha512'), 'sha512');
  const size = Number(yamlScalar(text, 'size') || 0) || 0;
  const releaseDate = yamlScalar(text, 'releaseDate');
  const downloadUrl = githubReleaseDownloadUrl(latestVersion, assetPath);
  const candidates = uniqueDownloadCandidates(downloadUrl);
  const asset = {
    name: updateAssetNameFromUrl(downloadUrl) || assetPath,
    size,
    contentType: 'application/octet-stream',
    downloadUrl,
    downloadUrls: publicDownloadUrls(candidates),
    sha256: '',
    sha512,
  };
  return {
    configured: true,
    preview: false,
    updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
    currentVersion: APP_VERSION,
    latestVersion,
    release: {
      tagName: 'v' + latestVersion,
      name: 'Mineradio v' + latestVersion,
      version: latestVersion,
      publishedAt: releaseDate,
      htmlUrl: `https://github.com/${UPDATE_CONFIG.owner}/${UPDATE_CONFIG.repo}/releases/tag/v${latestVersion}`,
      downloadUrl,
      asset,
      patch: null,
      patchAvailable: false,
      summary: '发现新版本，已启用备用更新线路。',
      notes: ['更新检测已切换到备用线路', '下载时会自动选择国内加速线路', '下载失败会显示具体原因和当前速度'],
    },
    source: 'latest-yml',
    reason: reason || '',
  };
}
async function fetchLatestYmlUpdateInfo(reason) {
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') throw updateError('UPDATE_REPOSITORY_NOT_CONFIGURED');
  const latestYmlUrl = `https://github.com/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest/download/latest.yml`;
  const candidates = uniqueDownloadCandidates(latestYmlUrl);
  const result = await fetchTextFromCandidates(candidates, 6500);
  return parseLatestYmlUpdateInfo(result.text, reason);
}
async function fetchLatestUpdateInfo() {
  if (UPDATE_CONFIG.manifest) return fetchManifestUpdateInfo(UPDATE_CONFIG.manifest);
  if (!UPDATE_CONFIG.configured || UPDATE_CONFIG.provider !== 'github') return localUpdateFallback();
  const apiUrl = `https://api.github.com/repos/${encodeURIComponent(UPDATE_CONFIG.owner)}/${encodeURIComponent(UPDATE_CONFIG.repo)}/releases/latest`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8500);
  try {
    const resp = await fetch(apiUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
        'Accept': 'application/vnd.github+json',
      },
    });
    if (!resp.ok) {
      try { return await fetchLatestYmlUpdateInfo('GitHub Releases ' + resp.status); }
      catch (_) { return localUpdateFallback('GitHub Releases ' + resp.status, { configured: true }); }
    }
    const data = await resp.json();
    const latestVersion = normalizeVersion(data.tag_name || data.name || APP_VERSION) || APP_VERSION;
    const asset = pickReleaseAsset(data.assets);
    const patch = pickPatchAsset(data.assets, APP_VERSION, latestVersion);
    const notes = extractReleaseNotes(data.body).length ? extractReleaseNotes(data.body) : UPDATE_FALLBACK_NOTES;
    return {
      configured: true,
      preview: false,
      updateAvailable: compareVersions(latestVersion, APP_VERSION) > 0,
      currentVersion: APP_VERSION,
      latestVersion,
      release: {
        tagName: data.tag_name || ('v' + latestVersion),
        name: data.name || ('Mineradio v' + latestVersion),
        version: latestVersion,
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || '',
        downloadUrl: asset ? asset.downloadUrl : '',
        asset,
        patch,
        patchAvailable: !!(patch && patch.downloadUrl && compareVersions(latestVersion, APP_VERSION) > 0),
        summary: notes[0] || '发现新版本，建议更新。',
        notes,
      },
    };
  } catch (err) {
    const reason = err && err.message || 'Update check failed';
    try { return await fetchLatestYmlUpdateInfo(reason); }
    catch (fallbackErr) { return localUpdateFallback((fallbackErr && fallbackErr.message) || reason, { configured: true }); }
  } finally {
    clearTimeout(timer);
  }
}
function safeUpdateFileName(name, version) {
  const raw = String(name || '').trim() || `Mineradio-${version || APP_VERSION}.exe`;
  const cleaned = raw
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || `Mineradio-${version || APP_VERSION}.exe`;
}
function publicUpdateJob(job) {
  if (!job) return { ok: false, error: 'UPDATE_JOB_NOT_FOUND' };
  return {
    ok: job.status !== 'error',
    id: job.id,
    status: job.status,
    progress: job.progress || 0,
    received: job.received || 0,
    total: job.total || 0,
    speedBps: job.speedBps || 0,
    etaSeconds: job.etaSeconds || 0,
    sourceLabel: job.sourceLabel || '',
    attempt: job.attempt || 0,
    attempts: job.attempts || 0,
    mode: job.mode || 'installer',
    message: job.message || '',
    restartRequired: !!job.restartRequired,
    cached: !!job.cached,
    fileName: job.fileName || '',
    filePath: job.status === 'ready' ? job.filePath : '',
    version: job.version || '',
    releaseUrl: job.releaseUrl || '',
    error: job.error || '',
    errorReason: job.errorReason || '',
    errorDetail: job.errorDetail || '',
    failedAttempts: Array.isArray(job.failedAttempts) ? job.failedAttempts.slice(0, 6) : [],
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
function activeUpdateJobFor(version) {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return jobs.find(job => job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
}
function trimUpdateJobs() {
  const jobs = Array.from(updateDownloadJobs.values()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  jobs.slice(8).forEach(job => updateDownloadJobs.delete(job.id));
}
async function downloadUpdateAsset(job) {
  const tmpPath = job.filePath + '.download';
  try {
    fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
    job.status = 'downloading';
    job.updatedAt = Date.now();

    const resp = await fetch(job.downloadUrl, {
      headers: {
        'User-Agent': `Mineradio/${APP_VERSION}`,
      },
    });
    if (!resp.ok) throw new Error('Download failed ' + resp.status);

    const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
    job.total = totalHeader || job.total || 0;
    job.received = 0;
    job.progress = 0;
    job.speedBps = 0;
    job.etaSeconds = 0;
    job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';
    job.updatedAt = Date.now();
    let speedWindowAt = Date.now();
    let speedWindowBytes = 0;

    const writer = fs.createWriteStream(tmpPath);
    const reader = resp.body.getReader();
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const buf = Buffer.from(chunk.value);
        job.received += buf.length;
        speedWindowBytes += buf.length;
        const now = Date.now();
        if (now - speedWindowAt >= 900) {
          job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
          speedWindowAt = now;
          speedWindowBytes = 0;
        }
        if (job.total > 0) {
          job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
          job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
        } else {
          const kb = Math.max(1, job.received / 1024);
          job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
        }
        job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
        job.updatedAt = Date.now();
        if (!writer.write(buf)) await once(writer, 'drain');
      }
    } finally {
      writer.end();
      await once(writer, 'finish').catch(() => {});
    }

    if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
    fs.renameSync(tmpPath, job.filePath);
    job.status = 'ready';
    job.progress = 100;
    job.message = '安装包已下载';
    job.updatedAt = Date.now();
  } catch (e) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    job.status = 'error';
    job.error = e.message || 'UPDATE_DOWNLOAD_FAILED';
    job.updatedAt = Date.now();
  }
}
function sha512Base64(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('base64');
}
function sha512Hex(buffer) {
  return crypto.createHash('sha512').update(buffer).digest('hex');
}
function verifyUpdateBuffer(buffer, job) {
  const expectedSize = Number(job.expectedSize || job.total || 0) || 0;
  if (expectedSize > 0 && buffer.length !== expectedSize) {
    throw updateError('UPDATE_SIZE_MISMATCH', `Expected ${expectedSize} bytes, got ${buffer.length}`);
  }
  const expectedSha256 = normalizeDigest(job.sha256 || '', 'sha256').toLowerCase();
  if (expectedSha256 && sha256Hex(buffer) !== expectedSha256) {
    throw updateError('UPDATE_SHA256_MISMATCH', 'Downloaded sha256 mismatch');
  }
  const expectedSha512 = normalizeDigest(job.sha512 || '', 'sha512');
  if (expectedSha512) {
    const actualBase64 = sha512Base64(buffer);
    const actualHex = sha512Hex(buffer).toLowerCase();
    if (actualBase64 !== expectedSha512 && actualHex !== expectedSha512.toLowerCase()) {
      throw updateError('UPDATE_SHA512_MISMATCH', 'Downloaded sha512 mismatch');
    }
  }
}
function verifyUpdateFile(filePath, job) {
  verifyUpdateBuffer(fs.readFileSync(filePath), job);
}
function moveInvalidUpdateFile(filePath, reason) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return;
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);
    const invalidPath = path.join(dir, `${base}.invalid-${Date.now()}${ext || '.bin'}`);
    fs.renameSync(filePath, invalidPath);
    console.warn('[UpdateDownload] cached installer moved aside:', reason || 'invalid', invalidPath);
  } catch (e) {
    console.warn('[UpdateDownload] failed to move invalid cached installer:', e.message);
  }
}
function reuseVerifiedInstallerJob(opts) {
  if (!opts || !opts.filePath || !fs.existsSync(opts.filePath)) return null;
  if (!opts.expectedSize && !opts.sha256 && !opts.sha512) return null;
  const now = Date.now();
  const stat = fs.statSync(opts.filePath);
  const job = {
    id: 'cached-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'ready',
    progress: 100,
    received: stat.size || 0,
    total: opts.expectedSize || stat.size || 0,
    speedBps: 0,
    etaSeconds: 0,
    sourceLabel: '本地缓存',
    attempt: 0,
    attempts: opts.attempts || 0,
    mode: 'installer',
    message: '安装包已下载，可直接打开安装',
    fileName: opts.fileName || path.basename(opts.filePath),
    filePath: opts.filePath,
    version: opts.version || '',
    downloadUrl: opts.downloadUrl || '',
    downloadCandidates: opts.downloadCandidates || [],
    expectedSize: opts.expectedSize || 0,
    sha256: opts.sha256 || '',
    sha512: opts.sha512 || '',
    releaseUrl: opts.releaseUrl || '',
    failedAttempts: [],
    cached: true,
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  try {
    verifyUpdateFile(opts.filePath, job);
    updateDownloadJobs.set(job.id, job);
    trimUpdateJobs();
    return job;
  } catch (err) {
    moveInvalidUpdateFile(opts.filePath, (err && err.message) || 'cache verification failed');
    return null;
  }
}
function setUpdateJobError(job, err, fallbackMessage) {
  const info = classifyUpdateError(err);
  job.status = 'error';
  job.error = info.code;
  job.errorReason = info.reason;
  job.errorDetail = info.detail;
  job.message = fallbackMessage || info.reason;
  job.updatedAt = Date.now();
}
function trackUpdateSlowDownload(job, now) {
  if (!job.speedBps || job.speedBps >= MIN_UPDATE_DOWNLOAD_SWITCH_BPS) {
    job.slowSince = 0;
    return false;
  }
  if (!job.slowSince) {
    job.slowSince = now;
    return false;
  }
  return now - job.slowSince >= UPDATE_SLOW_SWITCH_WINDOW_MS;
}
function prepareUpdateJobAttempt(job, candidate, index, total) {
  job.status = 'downloading';
  job.sourceLabel = candidate.label || '下载线路';
  job.attempt = index + 1;
  job.attempts = total;
  job.received = 0;
  job.speedBps = 0;
  job.etaSeconds = 0;
  job.slowSince = 0;
  job.attemptStartedAt = Date.now();
  job.error = '';
  job.errorReason = '';
  job.errorDetail = '';
  job.updatedAt = Date.now();
}
function ensureMirrorCanBeVerified(job, candidate) {
  if (!candidate || !candidate.mirrored) return;
  if (job.sha256 || job.sha512) return;
  throw updateError('MIRROR_HASH_MISSING', 'Mirror download skipped because no digest is available');
}
async function downloadUpdateAssetWithMirrors(job) {
  const tmpPath = job.filePath + '.download';
  const baseCandidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const candidates = await prioritizeUpdateDownloadCandidates(job, baseCandidates);
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      ensureMirrorCanBeVerified(job, candidate);
      prepareUpdateJobAttempt(job, candidate, i, candidates.length);
      job.message = job.total ? '正在下载完整安装包' : '正在下载完整安装包，等待服务器返回大小';

      const resp = await fetchWithTimeout(candidate.url, {
        headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
      }, 14000);
      if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

      const totalHeader = parseInt(resp.headers.get('content-length') || '0', 10) || 0;
      job.total = totalHeader || job.expectedSize || job.total || 0;
      job.progress = 0;
      job.updatedAt = Date.now();
      let speedWindowAt = Date.now();
      let speedWindowBytes = 0;

      const writer = fs.createWriteStream(tmpPath);
      const reader = resp.body.getReader();
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          const buf = Buffer.from(chunk.value);
          job.received += buf.length;
          speedWindowBytes += buf.length;
          const now = Date.now();
          if (now - speedWindowAt >= 900) {
            job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
            speedWindowAt = now;
            speedWindowBytes = 0;
            if (now - (job.attemptStartedAt || now) >= UPDATE_SLOW_SWITCH_GRACE_MS && trackUpdateSlowDownload(job, now)) {
              try { await reader.cancel(); } catch (_) {}
              throw updateError('UPDATE_LINE_TOO_SLOW', '当前线路速度过慢，正在切换线路');
            }
          }
          if (job.total > 0) {
            job.progress = Math.max(1, Math.min(99, Math.round((job.received / job.total) * 100)));
            job.etaSeconds = job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
          } else {
            const kb = Math.max(1, job.received / 1024);
            job.progress = Math.max(1, Math.min(88, Math.round(Math.log10(kb + 1) * 24)));
          }
          job.message = job.total > 0 ? '正在下载完整安装包' : '正在下载完整安装包，服务器未提供总大小';
          job.updatedAt = Date.now();
          if (!writer.write(buf)) await once(writer, 'drain');
        }
      } finally {
        writer.end();
        await once(writer, 'finish').catch(() => {});
      }

      verifyUpdateFile(tmpPath, job);
      if (fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      fs.renameSync(tmpPath, job.filePath);
      job.status = 'ready';
      job.progress = 100;
      job.etaSeconds = 0;
      job.message = '安装包已下载';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '下载失败：' + info.reason);
    }
  }
}
function startUpdateDownloadJob(info) {
  const release = info && info.release ? info.release : {};
  const asset = release.asset || {};
  const downloadUrl = release.downloadUrl || asset.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'UPDATE_ASSET_MISSING' };

  const version = info.latestVersion || release.version || '';
  const existing = activeUpdateJobFor(version);
  if (existing) return publicUpdateJob(existing);

  const fileName = safeUpdateFileName(asset.name || '', version);
  const filePath = path.join(UPDATE_DOWNLOAD_DIR, fileName);
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(asset.downloadUrls) ? asset.downloadUrls : []));
  const expectedSize = asset.size || 0;
  const sha256 = normalizeDigest(asset.sha256 || '', 'sha256').toLowerCase();
  const sha512 = normalizeDigest(asset.sha512 || '', 'sha512');
  const cached = reuseVerifiedInstallerJob({
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    attempts: downloadCandidates.length,
  });
  if (cached) return publicUpdateJob(cached);

  const now = Date.now();
  const job = {
    id: now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: expectedSize,
    mode: 'installer',
    fileName,
    filePath,
    version,
    downloadUrl,
    downloadCandidates,
    expectedSize,
    sha256,
    sha512,
    releaseUrl: release.htmlUrl || '',
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadUpdateAssetWithMirrors(job).catch(function(err) {
    setUpdateJobError(job, err, '更新下载失败：' + classifyUpdateError(err).reason);
  });
  return publicUpdateJob(job);
}
function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
function safePatchRelativePath(value) {
  const rel = String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!rel || rel.includes('\0')) return '';
  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some(part => part === '..' || part === '.')) return '';
  const root = parts[0];
  if (PATCH_ALLOWED_FILES.has(rel)) return rel;
  if (!PATCH_ALLOWED_ROOTS.has(root)) return '';
  if (/\.(exe|dll|node|msi|bat|cmd|ps1|pfx|pem|key)$/i.test(rel)) return '';
  return parts.join('/');
}
function patchTargetPath(rel) {
  const safeRel = safePatchRelativePath(rel);
  if (!safeRel) return null;
  const target = path.resolve(__dirname, safeRel);
  const root = path.resolve(__dirname);
  if (target !== root && !target.startsWith(root + path.sep)) return null;
  return target;
}
function decodePatchFile(file) {
  if (!file || typeof file !== 'object') return null;
  if (typeof file.contentBase64 === 'string') return Buffer.from(file.contentBase64, 'base64');
  if (typeof file.content === 'string') return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8');
  return null;
}
function patchBackupPath(job, rel) {
  return path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
}
function backupPatchTarget(job, rel, target) {
  if (!fs.existsSync(target)) return;
  const backup = patchBackupPath(job, rel);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  fs.copyFileSync(target, backup);
}
function writePatchFile(job, file) {
  const rel = safePatchRelativePath(file.path || file.name);
  const target = rel ? patchTargetPath(rel) : null;
  const content = decodePatchFile(file);
  if (!rel || !target || !content) throw new Error('INVALID_PATCH_FILE');
  if (content.length > PATCH_MAX_BYTES) throw new Error('PATCH_FILE_TOO_LARGE');
  const expected = String(file.sha256 || '').trim().toLowerCase();
  const actual = sha256Hex(content);
  if (expected && expected !== actual) throw new Error('PATCH_HASH_MISMATCH:' + rel);
  backupPatchTarget(job, rel, target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = target + '.mineradio-patch';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
  if (expected && sha256Hex(fs.readFileSync(target)) !== expected) throw new Error('PATCH_WRITE_VERIFY_FAILED:' + rel);
  return rel;
}
function rollbackPatchBackups(job, changed) {
  const restored = [];
  const list = Array.isArray(changed) ? changed.slice().reverse() : [];
  list.forEach(rel => {
    const target = patchTargetPath(rel);
    const backup = path.join(UPDATE_PATCH_BACKUP_DIR, job.id, rel);
    if (!target || !fs.existsSync(backup)) return;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(backup, target);
    restored.push(rel);
  });
  job.rollbackFiles = restored;
  job.updatedAt = Date.now();
  return restored;
}
function applyPatchFilesWithRollback(job, files) {
  const changed = [];
  try {
    files.forEach(file => changed.push(writePatchFile(job, file)));
    return changed;
  } catch (err) {
    rollbackPatchBackups(job, changed);
    throw err;
  }
}
function normalizePatchPayload(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_PATCH_PAYLOAD');
  const type = String(payload.type || payload.kind || '');
  if (type && type !== 'mineradio-resource-patch') throw new Error('UNSUPPORTED_PATCH_TYPE');
  const from = normalizeVersion(payload.from || payload.baseVersion || '');
  const to = normalizeVersion(payload.to || payload.version || payload.targetVersion || '');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!from || compareVersions(from, APP_VERSION) !== 0) throw new Error('PATCH_VERSION_MISMATCH');
  if (!to || compareVersions(to, APP_VERSION) <= 0) throw new Error('PATCH_TARGET_VERSION_INVALID');
  if (!files.length) throw new Error('PATCH_EMPTY');
  if (files.length > 40) throw new Error('PATCH_TOO_MANY_FILES');
  return { from, to, files, restartRequired: payload.restartRequired !== false };
}
async function downloadPatchBufferFromCandidate(job, candidate, index, total) {
  ensureMirrorCanBeVerified(job, candidate);
  prepareUpdateJobAttempt(job, candidate, index, total);
  job.mode = 'patch';
  job.message = '正在下载快速补丁';
  job.progress = 0;
  job.updatedAt = Date.now();

  const resp = await fetchWithTimeout(candidate.url, {
    headers: { 'User-Agent': `Mineradio/${APP_VERSION}` },
  }, 12000);
  if (!resp.ok) throw updateError('HTTP_' + resp.status, 'HTTP ' + resp.status);

  job.total = parseInt(resp.headers.get('content-length') || '0', 10) || job.expectedSize || job.total || 0;
  job.received = 0;
  const chunks = [];
  const reader = resp.body.getReader();
  let speedWindowAt = Date.now();
  let speedWindowBytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    const buf = Buffer.from(chunk.value);
    job.received += buf.length;
    speedWindowBytes += buf.length;
    if (job.received > PATCH_MAX_BYTES) throw updateError('PATCH_TOO_LARGE', 'Patch package is too large');
    chunks.push(buf);
    const now = Date.now();
    if (now - speedWindowAt >= 700) {
      job.speedBps = Math.round(speedWindowBytes / Math.max(0.001, (now - speedWindowAt) / 1000));
      speedWindowAt = now;
      speedWindowBytes = 0;
    }
    job.progress = job.total > 0
      ? Math.max(1, Math.min(84, Math.round((job.received / job.total) * 84)))
      : Math.max(1, Math.min(76, Math.round(Math.log10(job.received / 1024 + 1) * 24)));
    job.etaSeconds = job.total > 0 && job.speedBps > 0 ? Math.max(0, Math.round((job.total - job.received) / job.speedBps)) : 0;
    job.updatedAt = Date.now();
  }
  const raw = Buffer.concat(chunks);
  verifyUpdateBuffer(raw, job);
  return raw;
}
async function downloadAndApplyPatchWithMirrors(job) {
  const candidates = Array.isArray(job.downloadCandidates) && job.downloadCandidates.length
    ? job.downloadCandidates
    : uniqueDownloadCandidates(job.downloadUrl || '');
  const failures = [];
  fs.mkdirSync(UPDATE_DOWNLOAD_DIR, { recursive: true });
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    try {
      const raw = await downloadPatchBufferFromCandidate(job, candidate, i, candidates.length);
      const patch = normalizePatchPayload(JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')));
      job.version = patch.to;
      job.message = '正在应用快速补丁';
      job.progress = 88;
      job.etaSeconds = 0;
      job.updatedAt = Date.now();
      const changed = applyPatchFilesWithRollback(job, patch.files);
      job.changedFiles = changed;
      job.status = 'ready';
      job.progress = 100;
      job.restartRequired = patch.restartRequired;
      job.message = patch.restartRequired ? '快速补丁已应用，重启后生效' : '快速补丁已应用';
      job.updatedAt = Date.now();
      return;
    } catch (err) {
      const info = classifyUpdateError(err);
      failures.push({ source: candidate.label || '下载线路', reason: info.reason, detail: info.detail });
      job.failedAttempts = failures.slice(-6);
      job.message = i < candidates.length - 1 ? ((candidate.label || '当前线路') + '失败，正在切换线路') : info.reason;
      job.updatedAt = Date.now();
      if (i >= candidates.length - 1) setUpdateJobError(job, err, '快速补丁失败：' + info.reason);
    }
  }
}
function startUpdatePatchJob(info) {
  const release = info && info.release ? info.release : {};
  const patch = release.patch || {};
  const downloadUrl = patch.downloadUrl || '';
  if (!info || !info.configured) return { ok: false, error: 'UPDATE_REPOSITORY_NOT_CONFIGURED' };
  if (!info.updateAvailable) return { ok: false, error: 'NO_UPDATE_AVAILABLE' };
  if (!release.patchAvailable || !/^https?:\/\//i.test(downloadUrl)) return { ok: false, error: 'PATCH_ASSET_MISSING' };

  const version = info.latestVersion || release.version || patch.to || '';
  const existing = Array.from(updateDownloadJobs.values())
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .find(job => job.mode === 'patch' && job.version === version && (job.status === 'queued' || job.status === 'downloading' || job.status === 'ready'));
  if (existing) return publicUpdateJob(existing);

  const now = Date.now();
  const downloadCandidates = uniqueDownloadCandidates([downloadUrl].concat(Array.isArray(patch.downloadUrls) ? patch.downloadUrls : []));
  const job = {
    id: 'patch-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 8),
    status: 'queued',
    progress: 0,
    received: 0,
    total: patch.size || 0,
    mode: 'patch',
    fileName: patch.name || safeUpdateFileName('', version).replace(/\.exe$/i, '.patch.json'),
    filePath: '',
    version,
    downloadUrl,
    downloadCandidates,
    releaseUrl: release.htmlUrl || '',
    expectedSize: patch.size || 0,
    sha256: normalizeDigest(patch.sha256 || '', 'sha256').toLowerCase(),
    sha512: normalizeDigest(patch.sha512 || '', 'sha512'),
    restartRequired: true,
    sourceLabel: '',
    attempt: 0,
    attempts: downloadCandidates.length,
    failedAttempts: [],
    message: '等待下载快速补丁',
    createdAt: now,
    updatedAt: now,
    error: '',
  };
  updateDownloadJobs.set(job.id, job);
  trimUpdateJobs();
  downloadAndApplyPatchWithMirrors(job).catch(function(err) {
    setUpdateJobError(job, err, '快速补丁失败：' + classifyUpdateError(err).reason);
  });
  return publicUpdateJob(job);
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

// ---------- LrcLib 时间轴歌词（Metrolist 主力歌词源） ----------
const LRCLIB_BASE = 'https://lrclib.net/api';
const LRCLIB_UA = 'Mineradio/1.2.0 (https://github.com/XxHuberrr/Mineradio)';
const LRCLIB_HEADERS = { 'User-Agent': LRCLIB_UA, Accept: 'application/json' };
const lrcLibCache = new Map();

function primaryArtistName(artist) {
  return String(artist || '').split(/\s*\/\s*|、|,|&|feat\.?|ft\.?/i)[0].trim();
}

// 清洗歌名：去掉 YouTube 标题里的噪音（官方视频/歌词版/OST/竖线后缀/フルバージョン/抖音热歌/动画描述 等）
function cleanLyricTitle(name) {
  let t = String(name || '');
  t = t.split(/\s*[|｜]\s*/)[0]; // 取竖线前的主标题
  t = t.replace(/[『「][^』」]*[』」]/g, ' '); // 去掉日文书名号内容（多为动画/专辑名）
  // 去掉含噪音关键词的括号段
  t = t.replace(/[\(\[（【][^\)\]）】]*(?:official|video|audio|lyric|lyrics|visuali[sz]er|mv|m\/v|hd|4k|hq|remaster(?:ed)?|live|cover|instrumental|karaoke|full\s*ver(?:sion)?|フルバージョン|完整版|高音质|无损|抖音|热歌|純音[樂楽]|OST|ost)[^\)\]）】]*[\)\]）】]/gi, '');
  t = t.replace(/\s*[\(\[]?\s*(?:feat\.?|ft\.?)\s+[^\)\]]*[\)\]]?/gi, ''); // feat. xxx
  // 去掉描述性尾巴：从 “- アニメ / - OST / - Theme / - 主題歌 …” 起到结尾
  t = t.replace(/\s*[-–—]\s*(?:アニメ|anime|OST|ost|主題歌|主题歌|オープニング|エンディング|挿入歌|テーマ|opening|ending|theme|插曲|片頭曲|片头曲|片尾曲|名場面)[\s\S]*$/i, '');
  t = t.replace(/\s*-\s*topic\s*$/i, '');
  t = t.replace(/【[^】]*】/g, ''); // 残留全角方括号段
  return t.replace(/\s{2,}/g, ' ').trim();
}

// 占位歌手名（YTM 无 author 时填的默认值 / 各种“未知”），匹配歌词时应视作“无歌手”，否则污染查询。
function isPlaceholderArtist(a) {
  const s = String(a || '').trim().toLowerCase();
  return !s || s === 'unknown artist' || s === 'unknown' || s === 'various artists'
    || s === 'va' || s === 'v.a.' || s === 'artist' || s === '未知歌手' || s === '未知艺术家' || s === '群星';
}
// 从标题里抢救 feat./ft. 后面的演出者（歌手是占位符时用它当匹配歌手，命中率高很多）。
function featArtistFromTitle(name) {
  const m = String(name || '').match(/(?:^|[\s(\[（【「『])(?:feat\.?|ft\.?|featuring)\s+([^)\]\-|｜、,]+)/i);
  return m ? m[1].replace(/[)\]】』」]/g, '').trim() : '';
}
function cleanLyricArtist(artist) {
  const a = primaryArtistName(artist).replace(/\s*-\s*topic\s*$/i, '').replace(/\s*vevo\s*$/i, '').trim();
  return isPlaceholderArtist(a) ? '' : a;
}
// 归一化匹配键：小写、去括号内容(feat/版本)、只保留字母数字与 CJK，用来校验歌名/歌手是否真的对得上。
function normalizeMatchKey(s) {
  return String(s || '').toLowerCase()
    .replace(/[\(\[（【][^\)\]）】]*[\)\]）】]/g, ' ')
    .replace(/[^0-9a-z぀-ヿ㐀-鿿가-힣]+/g, '')
    .trim();
}
// 一方包含另一方即算匹配（容忍多余的版本/feat 信息）。任一侧为空则不算匹配。
function matchKeyContains(a, b) {
  a = normalizeMatchKey(a); b = normalizeMatchKey(b);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

async function lrcLibGet(artist, track, album, durationSec) {
  const u = new URL(LRCLIB_BASE + '/get');
  u.searchParams.set('artist_name', artist);
  u.searchParams.set('track_name', track);
  if (album) u.searchParams.set('album_name', album);
  if (durationSec > 0) u.searchParams.set('duration', String(durationSec));
  const body = await requestJson(u.toString(), { headers: LRCLIB_HEADERS });
  if (body && (body.syncedLyrics || body.plainLyrics)) {
    return { synced: body.syncedLyrics || '', plain: body.plainLyrics || '', source: 'lrclib-get' };
  }
  return null;
}

async function lrcLibSearch(track, artist, durationSec) {
  const u = new URL(LRCLIB_BASE + '/search');
  u.searchParams.set('track_name', track);
  if (artist) u.searchParams.set('artist_name', artist);
  const list = await requestJson(u.toString(), { headers: LRCLIB_HEADERS });
  if (!Array.isArray(list) || !list.length) return null;
  const best = list.map(item => {
    const titleOk = matchKeyContains(item.trackName || item.name, track);
    const artistOk = artist ? matchKeyContains(item.artistName, artist) : false;
    const diff = (durationSec > 0 && item.duration) ? Math.abs(Number(item.duration) - durationSec) : 999;
    let score = 0;
    if (item.syncedLyrics) score += 10;
    if (titleOk) score += 4;
    if (artistOk) score += 5;
    if (durationSec > 0 && item.duration) {
      if (diff <= 2) score += 6; else if (diff <= 5) score += 3; else if (diff > 25) score -= 5;
    }
    return { item, score, titleOk, artistOk, diff };
  }).sort((a, b) => b.score - a.score)[0];
  // 置信门槛：歌名必须匹配，且(歌手匹配 或 时长很接近≤8s)，否则不采信——
  // 避免无歌手/纯歌名搜索时配到同名的另一首歌。
  if (!best || !best.titleOk) return null;
  if (!best.artistOk && !(durationSec > 0 && best.diff <= 8)) return null;
  if (best.item && (best.item.syncedLyrics || best.item.plainLyrics)) {
    return { synced: best.item.syncedLyrics || '', plain: best.item.plainLyrics || '', source: 'lrclib-search' };
  }
  return null;
}

// 多候选瀑布：清洗名/原名 × 精确匹配/搜索/无歌手搜索
async function fetchLrcLibLyrics(opts) {
  opts = opts || {};
  const rawTrack = String(opts.track || '').trim();
  if (!rawTrack) return null;
  const cleanTrack = cleanLyricTitle(rawTrack) || rawTrack;
  const artist = cleanLyricArtist(opts.artist);
  const album = String(opts.album || '').trim();
  const durationSec = Math.round(Number(opts.durationSec || 0)) || 0;
  const cacheKey = (cleanTrack + '|' + artist + '|' + durationSec).toLowerCase();
  if (lrcLibCache.has(cacheKey)) return lrcLibCache.get(cacheKey);

  const tracks = cleanTrack.toLowerCase() === rawTrack.toLowerCase() ? [cleanTrack] : [cleanTrack, rawTrack];
  // 候选按优先级排列：精确匹配 > 带歌手搜索 > 无歌手搜索，清洗名优先于原始名。
  // lrclib.net 每次请求都要 ~7s（服务端 TTFB），串行会把延迟叠加到十几秒；改为全部并发发出，
  // 再按优先级挑第一个命中的，延迟从 N×7s 降到约 1×7s。
  const attempts = [];
  for (const tk of tracks) {
    if (artist) attempts.push(() => lrcLibGet(artist, tk, album, durationSec)); // 1) 精确匹配（需歌手）
    attempts.push(() => lrcLibSearch(tk, artist, durationSec));                  // 2) 搜索（歌手已知时带歌手；未知时才纯歌名）
  }
  // 注：不再对“已知歌手”做无歌手的纯歌名兜底搜索——它会把同名的另一首歌（甚至别的语言）
  // 靠时长凑上来，造成“歌词是错的”。歌手已知却搜不到，就宁可没有歌词。
  // 全部并发发出，再按优先级顺序取结果：高优先级一旦命中就立刻返回，不等低优先级的慢请求
  // （避免精确匹配已命中却还要干等两个慢搜索）。
  const inflight = attempts.map(fn => fn().catch(() => null));
  let result = null;
  for (const p of inflight) {
    const r = await p;
    if (r && (r.synced || r.plain)) { result = r; break; }
  }
  lrcLibCache.set(cacheKey, result);
  if (lrcLibCache.size > 500) lrcLibCache.delete(lrcLibCache.keys().next().value);
  return result;
}

// CJK（假名 + 中日韩汉字 + 谚文）：网易云对这类歌覆盖远好于 LrcLib，优先网易云原词。
// 罗马字标题的日语歌也能靠汉字歌手名命中；纯西方歌不含 CJK，仍走 LrcLib 优先。
function looksCJK(text) {
  return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7A3]/.test(String(text || ''));
}
async function tryNeteaseOriginal(meta) {
  try {
    const ne = await fetchNeteaseLyric({ name: meta.name, artist: meta.artist, durationSec: meta.durationSec });
    if (ne && ne.origLrc && /\[\d+:\d+/.test(ne.origLrc)) return { lyric: ne.origLrc, source: 'netease' };
  } catch (e) {}
  return null;
}
// 统一歌词解析：LrcLib 优先(按时长匹配，时间轴最贴合正在播放的版本) → 同步歌词没有时
// CJK 用网易云补覆盖(日语等) → LrcLib 纯文本 → 非 CJK 网易云兜底 → YTM 内置纯文本。
async function resolveLyrics(meta) {
  meta = meta || {};
  // 歌手是占位符(Unknown Artist/未知歌手/群星…)会污染匹配：优先从标题里的 feat./ft. 抢救真正的
  // 演出者当匹配歌手，否则当“无歌手”(仅靠歌名+时长匹配)。
  if (isPlaceholderArtist(meta.artist)) {
    meta = Object.assign({}, meta, { artist: featArtistFromTitle(meta.name) });
  }
  let out = { lyric: '', source: 'empty' };
  const cjk = looksCJK(meta.name) || looksCJK(meta.artist);
  const lrcArgs = { track: meta.name, artist: meta.artist, album: meta.album, durationSec: meta.durationSec };
  if (cjk) {
    // 华语/日韩：网易云覆盖好、且在亚洲区快得多（实测 ~0.6s vs lrclib.net 每次请求约 9s）。
    // 优先网易云原词 → 歌词几乎即时出现；网易缺了才回退 LrcLib（按时长匹配的时间轴）。
    const ne = await tryNeteaseOriginal(meta);
    if (ne) out = ne;
    if (!out.lyric) {
      const lrc = await fetchLrcLibLyrics(lrcArgs);
      if (lrc && lrc.synced) out = { lyric: lrc.synced, source: lrc.source };
      else if (lrc && lrc.plain) out = { lyric: lrc.plain, source: lrc.source + '-plain' };
    }
  } else {
    // 非 CJK（欧美）：网易云基本没有，LrcLib 优先（按时长匹配，时间轴最准），网易云仅兜底。
    const lrc = await fetchLrcLibLyrics(lrcArgs);
    if (lrc && lrc.synced) out = { lyric: lrc.synced, source: lrc.source };
    else if (lrc && lrc.plain) out = { lyric: lrc.plain, source: lrc.source + '-plain' };
    if (!out.lyric) {
      const ne = await tryNeteaseOriginal(meta);
      if (ne) out = ne;
    }
  }
  if (!out.lyric && meta.videoId) {
    try {
      const yt = await getYTMusic();
      const l = await yt.music.getLyrics(meta.videoId);
      const text = l && l.description && l.description.text ? String(l.description.text) : '';
      if (text) out = { lyric: text, source: 'youtube' };
    } catch (e) { console.warn('[Lyric YTM]', e.message); }
  }
  const synced = /\[\d+:\d+/.test(out.lyric || '');
  console.log('[Lyric] "' + (meta.name || '') + '" / "' + (meta.artist || '') + '" -> ' + out.source + (out.lyric ? (synced ? ' (synced)' : ' (plain)') : ' NONE'));
  return out;
}

// ---------- 歌词翻译（Google 免费翻译端点，分块 + 逐行对齐） ----------
async function googleTranslateLines(lines, to) {
  to = to || 'zh-CN';
  const out = [];
  const CHUNK = 40;
  for (let i = 0; i < lines.length; i += CHUNK) {
    const chunk = lines.slice(i, i + CHUNK);
    const q = chunk.join('\n');
    let translatedText = '';
    try {
      const u = new URL('https://translate.googleapis.com/translate_a/single');
      u.searchParams.set('client', 'gtx');
      u.searchParams.set('sl', 'auto');
      u.searchParams.set('tl', to);
      u.searchParams.set('dt', 't');
      u.searchParams.set('q', q);
      const body = await requestJson(u.toString(), { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (Array.isArray(body) && Array.isArray(body[0])) {
        translatedText = body[0].map(seg => (seg && seg[0]) || '').join('');
      }
    } catch (e) {
      console.warn('[Translate]', e.message);
    }
    const parts = translatedText.split('\n');
    for (let k = 0; k < chunk.length; k++) {
      out.push(parts[k] != null ? String(parts[k]).trim() : '');
    }
  }
  return out;
}

// ---------- 网易云社区人工翻译歌词（质量优于机器翻译，尤其日语；带时间轴） ----------
const NETEASE_LYRIC_HEADERS = { 'User-Agent': UA, Referer: 'https://music.163.com/' };
const neteaseTlyricCache = new Map();

async function neteaseSearchSongId(track, artist, durationSec) {
  const query = (String(track || '') + ' ' + String(artist || '')).trim();
  if (!query) return null;
  const u = new URL('https://music.163.com/api/search/get');
  u.searchParams.set('s', query);
  u.searchParams.set('type', '1');
  u.searchParams.set('limit', '10');
  const body = await requestJson(u.toString(), { headers: NETEASE_LYRIC_HEADERS, timeoutMs: 5000 });
  const songs = (body && body.result && body.result.songs) || [];
  if (!songs.length) return null;
  // 置信门槛：歌名必须匹配；再要求(歌手匹配 或 时长很接近≤5s)。都不满足就不采信——
  // 宁可没有歌词，也不要配到同名的另一首歌（否则会显示完全无关的错词）。
  let best = null, bestScore = -1;
  for (const song of songs) {
    if (!matchKeyContains(song.name, track)) continue;
    const artistStr = (song.artists || []).map(a => a && a.name).filter(Boolean).join(' ');
    const artistOk = artist ? matchKeyContains(artistStr, artist) : false;
    // 必须歌名 + 歌手都对上才采信网易——只靠“时长接近”会把同名的另一首歌（甚至别的语言）凑成错词。
    if (!artistOk) continue;
    const durMs = Number(song.duration) || 0;
    const durDiff = (durationSec > 0 && durMs) ? Math.abs(durMs / 1000 - durationSec) : 999;
    const score = 10 + Math.max(0, 8 - durDiff);
    if (score > bestScore) { bestScore = score; best = song; }
  }
  return best ? best.id : null;
}

async function fetchNeteaseLyric(opts) {
  opts = opts || {};
  const track = cleanLyricTitle(opts.name) || String(opts.name || '').trim();
  const artist = cleanLyricArtist(opts.artist);
  if (!track) return null;
  const durationSec = Math.round(Number(opts.durationSec || 0)) || 0;
  const cacheKey = ('ne|' + track + '|' + artist + '|' + durationSec).toLowerCase();
  if (neteaseTlyricCache.has(cacheKey)) return neteaseTlyricCache.get(cacheKey);
  let result = null;
  try {
    const id = await neteaseSearchSongId(track, artist, durationSec);
    if (id) {
      const u = new URL('https://music.163.com/api/song/lyric');
      u.searchParams.set('id', String(id));
      u.searchParams.set('lv', '1');
      u.searchParams.set('kv', '1');
      u.searchParams.set('tv', '1');
      const body = await requestJson(u.toString(), { headers: NETEASE_LYRIC_HEADERS, timeoutMs: 6000 });
      const tlyric = body && body.tlyric && body.tlyric.lyric ? String(body.tlyric.lyric).trim() : '';
      const olyric = body && body.lrc && body.lrc.lyric ? String(body.lrc.lyric).trim() : '';
      if ((olyric && /\[\d+:\d+/.test(olyric)) || (tlyric && /\[\d+:\d+/.test(tlyric))) {
        result = { origLrc: olyric, transLrc: tlyric, source: 'netease' };
      }
    }
  } catch (e) {
    console.warn('[NeteaseLyric]', e.message);
  }
  neteaseTlyricCache.set(cacheKey, result);
  if (neteaseTlyricCache.size > 500) neteaseTlyricCache.delete(neteaseTlyricCache.keys().next().value);
  return result;
}
async function fetchNeteaseTranslatedLyric(opts) {
  const ne = await fetchNeteaseLyric(opts);
  return (ne && ne.transLrc && /\[\d+:\d+/.test(ne.transLrc)) ? { transLrc: ne.transLrc, origLrc: ne.origLrc, source: 'netease-tlyric' } : null;
}

// LRC → [{t(ms), text}]
function parseLrcEntries(lrc) {
  const out = [];
  String(lrc || '').split(/\r?\n/).forEach(raw => {
    const tags = raw.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g);
    if (!tags) return;
    const text = raw.replace(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g, '').trim();
    tags.forEach(tag => {
      const m = tag.match(/\[(\d+):(\d+(?:[.:]\d+)?)\]/);
      if (m) {
        const tsec = parseInt(m[1], 10) * 60 + parseFloat(m[2].replace(':', '.'));
        out.push({ t: Math.round(tsec * 1000), text });
      }
    });
  });
  return out;
}
function normLyricLine(str) {
  return String(str || '').toLowerCase().replace(/[\s\u3000.,!?，。！？、…「」『』"'`\-—~()（）\[\]]+/g, '').trim();
}
// 把网易云 原词↔译词 按时间戳配对，返回 归一化原词 -> 译词 的映射
function buildNeteaseTransMap(origLrc, transLrc) {
  const orig = parseLrcEntries(origLrc);
  const trans = parseLrcEntries(transLrc);
  const transByTime = {};
  trans.forEach(e => { if (e.text) transByTime[e.t] = e.text; });
  const map = {};
  orig.forEach(e => {
    const tr = transByTime[e.t];
    if (tr) { const k = normLyricLine(e.text); if (k && !map[k]) map[k] = tr; }
  });
  return map;
}

// ---------- YTM 音频流解析（Metrolist 方式：直接手写 InnerTube player 请求） ----------
// 背景：2024-2025 起 YouTube 对 ANDROID/IOS/WEB 客户端强制 PoToken，youtubei.js 默认客户端
// 会返回 400 或无法解密的加密 URL。参照 Metrolist（活跃维护的 YT Music 客户端）的做法：
//   1) 用 ANDROID_VR（Oculus Quest）客户端，loginSupported=false，请求时【不带任何 cookie/
//      Authorization 头】，YouTube 对该客户端免 PoToken 且返回明文直链，无需签名解密；
//   2) 客户端版本用 Metrolist 选定的旧版（1.43.32 非自适应码率、修复 YT Music 卡顿；1.61.48 兜底），
//      不用 youtubei.js 硬编码的 1.65.10（新版易被封）；
//   3) 年龄限制内容用 TVHTML5_SIMPLY_EMBEDDED_PLAYER 嵌入式客户端兜底。
const YTM_PLAYER_URL = 'https://music.youtube.com/youtubei/v1/player?prettyPrint=false';
const YTM_PLAYER_CLIENTS = [
  {
    key: 'ANDROID_VR_1.43.32',
    clientName: 'ANDROID_VR', clientVersion: '1.43.32', clientId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.43.32 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/107.0.5284.2)',
    context: { osName: 'Android', osVersion: '12', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32 },
  },
  {
    key: 'ANDROID_VR_1.61.48',
    clientName: 'ANDROID_VR', clientVersion: '1.61.48', clientId: '28',
    userAgent: 'com.google.android.apps.youtube.vr.oculus/1.61.48 (Linux; U; Android 12; en_US; Quest 3; Build/SQ3A.220605.009.A1; Cronet/132.0.6808.3)',
    context: { osName: 'Android', osVersion: '12', deviceMake: 'Oculus', deviceModel: 'Quest 3', androidSdkVersion: 32 },
  },
  {
    key: 'TVHTML5_EMBEDDED',
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', clientId: '85',
    userAgent: 'Mozilla/5.0 (PlayStation; PlayStation 4/12.02) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
    context: {}, embedded: true,
  },
];
const ytmFormatCache = new Map();
let ytmVisitorData = '';

async function getYtmVisitorData() {
  if (ytmVisitorData) return ytmVisitorData;
  try {
    const yt = await getYTMusic();
    const vd = yt && yt.session && yt.session.context && yt.session.context.client && yt.session.context.client.visitorData;
    if (vd) ytmVisitorData = vd;
  } catch (e) {}
  return ytmVisitorData;
}

function ytmFormatCacheGet(sid) {
  const hit = ytmFormatCache.get(sid);
  if (hit && Date.now() < hit.expiresAt) return hit;
  if (hit) ytmFormatCache.delete(sid);
  return null;
}

// 从 streamingData 中挑最优纯音频格式：优先高码率、优先带 url 的（ANDROID_VR 返回明文 url）
function pickBestAudioFormat(streamingData) {
  const all = []
    .concat(streamingData && streamingData.adaptiveFormats || [])
    .concat(streamingData && streamingData.formats || []);
  const audio = all.filter(f => f && String(f.mimeType || '').toLowerCase().startsWith('audio/') && (f.url || f.signatureCipher || f.cipher));
  if (!audio.length) return null;
  // 只取带明文 url 的（免解密）；ANDROID_VR 全是明文 url
  const plain = audio.filter(f => f.url);
  const pool = plain.length ? plain : audio;
  // itag 优先级：251/250/249 = opus webm，140/139/141 = m4a；否则按 bitrate
  const itagRank = { 251: 5, 141: 5, 250: 4, 140: 4, 249: 3, 139: 2 };
  pool.sort((a, b) => {
    const ra = itagRank[a.itag] || 0, rb = itagRank[b.itag] || 0;
    if (rb !== ra) return rb - ra;
    return (Number(b.bitrate) || 0) - (Number(a.bitrate) || 0);
  });
  return pool[0];
}

async function fetchYtmPlayerFormat(sid, clientDef, visitorData) {
  const clientCtx = Object.assign({
    clientName: clientDef.clientName,
    clientVersion: clientDef.clientVersion,
    gl: 'US',
    hl: 'en',
  }, clientDef.context || {});
  if (visitorData) clientCtx.visitorData = visitorData;
  const body = {
    context: {
      client: clientCtx,
      user: {},
    },
    videoId: sid,
    playlistId: null,
    contentCheckOk: true,
    racyCheckOk: true,
  };
  if (clientDef.embedded) {
    body.context.thirdParty = { embedUrl: 'https://www.youtube.com/watch?v=' + sid };
  }
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Format-Version': '1',
    'X-YouTube-Client-Name': clientDef.clientId,
    'X-YouTube-Client-Version': clientDef.clientVersion,
    'X-Origin': 'https://music.youtube.com',
    'Referer': 'https://music.youtube.com/',
    'User-Agent': clientDef.userAgent,
    // 关键：ANDROID_VR / 嵌入式客户端 loginSupported=false，绝不附加 cookie/Authorization，才能免 PoToken
  };
  if (visitorData) headers['X-Goog-Visitor-Id'] = visitorData;
  const json = await requestJson(YTM_PLAYER_URL, { method: 'POST', headers }, JSON.stringify(body));
  const status = json && json.playabilityStatus && json.playabilityStatus.status;
  if (status && status !== 'OK') {
    const reason = (json.playabilityStatus.reason || json.playabilityStatus.status || 'UNPLAYABLE');
    throw new Error('PLAYABILITY_' + status + ': ' + reason);
  }
  const fmt = pickBestAudioFormat(json && json.streamingData);
  if (!fmt || !fmt.url) throw new Error('NO_PLAIN_AUDIO_URL');
  return {
    url: fmt.url,
    mime: String(fmt.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm',
    contentLength: Number(fmt.contentLength || 0) || 0,
    bitrate: Number(fmt.bitrate || 0) || 0,
    itag: fmt.itag || 0,
  };
}

async function resolveYtmAudioFormat(sid, forceRefresh) {
  if (!forceRefresh) {
    const cached = ytmFormatCacheGet(sid);
    if (cached) return cached;
  }
  const visitorData = await getYtmVisitorData();
  const failures = [];
  for (const clientDef of YTM_PLAYER_CLIENTS) {
    try {
      const fmt = await fetchYtmPlayerFormat(sid, clientDef, visitorData);
      const resolved = {
        sid,
        client: clientDef.key,
        url: fmt.url,
        mime: fmt.mime,
        contentLength: fmt.contentLength,
        bitrate: fmt.bitrate,
        itag: fmt.itag,
        expiresAt: Date.now() + 40 * 60 * 1000,
        failures: failures.slice(),
      };
      ytmFormatCache.set(sid, resolved);
      if (ytmFormatCache.size > 300) ytmFormatCache.delete(ytmFormatCache.keys().next().value);
      if (failures.length) console.warn('[YTM Audio] resolved via', clientDef.key, 'after failures:', failures.map(f => f.client + '=' + f.error).join(' | '));
      return resolved;
    } catch (e) {
      failures.push({ client: clientDef.key, error: (e && e.message) || String(e) });
    }
  }
  const err = new Error('YTM_AUDIO_RESOLVE_FAILED: ' + failures.map(f => f.client + '=' + f.error).join(' | '));
  err.failures = failures;
  throw err;
}

// 用给定明文直链把音频代理给客户端，成功发送完毕返回 true。
// 关键：只要还没调用 res.writeHead（即上游一开始就 4xx，如直链过期 403），失败时抛错，
// 交给上层换一个新解析的直链重试；一旦开始流式发送就无法重试（res.headersSent 会为真）。
async function streamYtmDirectFormat(res, fmt, range) {
  if (range) {
    // 播放 / 进度条 seek：客户端带 Range，单次透传
    const up = await fetch(fmt.url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: range } });
    if (up.status >= 400) throw new Error('UPSTREAM_HTTP_' + up.status);
    const out = {
      'Content-Type': up.headers.get('content-type') || fmt.mime,
      'Access-Control-Allow-Origin': '*',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    };
    const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
    const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
    res.writeHead(up.status, out);
    const reader = up.body.getReader();
    while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
    res.end();
    return true;
  }
  // 完整下载（节奏分析等，无 Range）：分块 Range 顺序拉取绕过 Google 限速
  const CHUNK = 1024 * 1024; // 1MB / 块
  const total = Number(fmt.contentLength) || 0;
  let pos = 0;
  const firstEnd = total ? Math.min(CHUNK - 1, total - 1) : (CHUNK - 1);
  let r = await fetch(fmt.url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-' + firstEnd } });
  if (r.status >= 400) throw new Error('UPSTREAM_HTTP_' + r.status);
  const out = {
    'Content-Type': fmt.mime,
    'Access-Control-Allow-Origin': '*',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
  };
  if (total) out['Content-Length'] = String(total);
  res.writeHead(200, out);
  let buf = Buffer.from(await r.arrayBuffer());
  res.write(buf); pos += buf.length;
  while (total ? pos < total : buf.length >= CHUNK) {
    const end = total ? Math.min(pos + CHUNK - 1, total - 1) : (pos + CHUNK - 1);
    r = await fetch(fmt.url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=' + pos + '-' + end } });
    if (r.status >= 400) break;
    buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) break;
    res.write(buf); pos += buf.length;
  }
  res.end();
  return true;
}

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
let cachedAccountInfo = null;
let cachedAccountCookie = null;
let cachedAccountTime = 0;

async function getLoginInfo() {
  if (!userCookie) return { loggedIn: false, provider: 'youtube', vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
  const obj = parseCookieString(userCookie);
  const isGoogle = obj.SID || obj.__Secure_3PSID || obj['__Secure-3PSID'] || obj.SAPISID || obj.SSID || userCookie.includes('google') || userCookie.includes('youtube');
  if (isGoogle || userCookie) {
    if (cachedAccountCookie === userCookie && cachedAccountInfo && (Date.now() - cachedAccountTime < 15 * 60 * 1000)) {
      return cachedAccountInfo;
    }
    let nickname = 'YouTube Music 会员';
    let email = '';
    let handle = '';
    let avatar = '';
    try {
      const yt = await getYTMusic();
      if (yt && yt.account) {
        const acc = await yt.account.getInfo();
        const list = acc.contents && acc.contents.contents ? acc.contents.contents : [];
        const item = list.find(x => x.type === 'AccountItem' && x.is_selected) || list.find(x => x.type === 'AccountItem') || {};
        if (item) {
          nickname = (item.account_name && item.account_name.text) || (item.channel_handle && item.channel_handle.text) || nickname;
          email = (item.account_byline && item.account_byline.text) || '';
          handle = (item.channel_handle && item.channel_handle.text) || '';
          if (item.account_photo && item.account_photo.length) {
            avatar = item.account_photo[0].url || '';
          }
        }
      }
    } catch (e) {
      console.warn('[GetLoginInfo Profile]', e.message);
    }
    const info = {
      loggedIn: true,
      provider: 'youtube',
      userId: handle || email || (obj.SID ? ('ytm_' + obj.SID.slice(0, 8)) : 'ytm_user'),
      nickname: nickname,
      email: email,
      handle: handle,
      avatar: avatar,
      vipType: 0,
      vipLevel: 'none',
      isVip: false,
      isSvip: false,
      vipLabel: 'YouTube Music',
      hasCookie: true,
    };
    cachedAccountCookie = userCookie;
    cachedAccountInfo = info;
    cachedAccountTime = Date.now();
    return info;
  }
  return { loggedIn: false, provider: 'youtube', hasCookie: !!userCookie, vipType: 0, vipLevel: 'none', isVip: false, isSvip: false, vipLabel: '无VIP' };
}

// ====================================================================
//  HTTP Server
// ====================================================================
function radioSongKey(song) {
  return song && (song.id || ((song.name || '') + '|' + (song.artist || '')));
}
function radioNormText(text) {
  return String(text || '').toLowerCase().replace(/[\s._()[\]{}'"|/\\:-]+/g, '');
}
function isPlaceholderRadioText(text) {
  return /^(unknown|unknownartist|未知|未知歌手|variousartists)$/i.test(radioNormText(text));
}
function isValidRadioSong(song) {
  return !!(song && song.id && song.name && song.artist && song.cover &&
    !isPlaceholderRadioText(song.name) && !isPlaceholderRadioText(song.artist));
}
function radioSeedMatchesSong(song, title, artist) {
  const seedTitle = radioNormText(title);
  if (!song || !seedTitle) return false;
  const songTitle = radioNormText(song.name);
  if (songTitle !== seedTitle) return false;
  const seedArtist = radioNormText(artist);
  const songArtist = radioNormText(song.artist);
  return !seedArtist || !songArtist || songArtist.includes(seedArtist) || seedArtist.includes(songArtist);
}
async function findRadioSeedBySearch(title, artist) {
  const query = [title, artist].filter(Boolean).join(' ');
  if (!query) return null;
  const found = await handleSearch(query, 8);
  return found.find(song => radioSeedMatchesSong(song, title, artist)) || found[0] || null;
}
async function fillRadioWithSearchFallback(songs, seen, seed, title, artist, limit) {
  const target = Math.max(6, Math.min(Number(limit) || 18, 30));
  if (songs.length >= target) return songs;
  const exactQueries = [
    [title, artist].filter(Boolean).join(' '),
    artist ? `${artist} songs` : '',
    title || '',
  ].filter(Boolean);
  const artistQueries = [
    artist ? `${artist} songs` : '',
    [title, artist].filter(Boolean).join(' '),
    title || '',
  ].filter(Boolean);
  const queries = seed ? exactQueries : artistQueries;
  for (const query of queries) {
    if (songs.length >= target) break;
    const found = await handleSearch(query, target + 6);
    for (const song of found) {
      const key = radioSongKey(song);
      if (!isValidRadioSong(song) || song.id === seed || radioSeedMatchesSong(song, title, artist) || seen.has(key) || seen.has(song.id)) continue;
      seen.add(song.id);
      seen.add(key);
      songs.push(song);
      if (songs.length >= target) break;
    }
  }
  return songs;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:' + PORT);
  const pn = url.pathname;

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

  // ---------- 搜索 ----------
  // ---------- 电台接续：基于某首歌的相关推荐（YTM 自动电台/Up Next） ----------
  if (pn === '/api/radio') {
    try {
      let id = url.searchParams.get('id') || '';
      const title = url.searchParams.get('title') || '';
      const artist = url.searchParams.get('artist') || '';
      const limit = Math.max(6, Math.min(parseInt(url.searchParams.get('limit') || '18', 10) || 18, 30));
      if (!id && !title && !artist) { sendJSON(res, { songs: [] }); return; }
      if (!id && title) {
        const seedMatch = await findRadioSeedBySearch(title, artist);
        if (seedMatch && seedMatch.id) id = seedMatch.id;
      }
      let items = [];
      if (id) {
        try {
          const yt = await getYTMusic();
          const panel = await yt.music.getUpNext(id, true);
          items = (panel && panel.contents) || [];
        } catch (upNextErr) {
          console.warn('[RadioUpNext]', id, upNextErr.message);
        }
      }
      const seen = new Set(id ? [id] : []);
      const songs = [];
      for (const it of items) {
        const m = mapPanelVideo(it);
        if (!m || !isValidRadioSong(m) || seen.has(m.id)) continue;
        seen.add(m.id);
        songs.push(m);
      }
      if (songs.length < Math.min(6, limit)) await fillRadioWithSearchFallback(songs, seen, id, title, artist, limit);
      console.log('[Radio]', id || '-', title || '-', '/', artist || '-', 'upNext:', items.length, 'songs:', songs.length);
      sendJSON(res, { seed: id, songs: songs.filter(isValidRadioSong).slice(0, limit) });
    } catch (err) {
      console.error('[Radio]', err.message);
      sendJSON(res, { error: err.message, songs: [] }, 500);
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

  if (pn === '/api/song/url') {
    try {
      const sid = url.searchParams.get('id');
      const quality = url.searchParams.get('quality') || '';
      const loginInfo = await getLoginInfo();
      const info = await handleSongUrl(sid, loginInfo, quality);
      sendJSON(res, {
        ...info,
        loggedIn: loginInfo.loggedIn,
        vipType: loginInfo.vipType || 0,
        vipLevel: loginInfo.vipLevel || 'none',
        isVip: !!loginInfo.isVip,
        isSvip: !!loginInfo.isSvip,
        vipLabel: loginInfo.vipLabel || '无VIP',
      });
    } catch (err) { console.error('[SongUrl]', err); sendJSON(res, { error: err.message }, 500); }
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
      const info = await getLoginInfo();
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
    const info = await getLoginInfo();
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
      const out = await resolveLyrics({ name, artist, album, durationSec, videoId: id });
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
      const lines = Array.isArray(body.lines) ? body.lines.map(x => String(x == null ? '' : x)) : [];
      const to = String(body.to || 'zh-CN');
      const name = String(body.name || '');
      const artist = String(body.artist || '');
      const durationSec = Number(body.duration || 0) || 0;
      if (!lines.length) { sendJSON(res, { translated: [], source: 'empty' }); return; }
      // 1) 只翻中文且有原词行时：优先网易云人工翻译，但【文字对齐到前端 LrcLib 原词行】，
      //    时间轴始终用 LrcLib（=按你播放版本时长匹配，和音频对齐），规避版本/翻唱时间轴错位。
      if (/^zh/i.test(to) && name) {
        try {
          const ne = await fetchNeteaseTranslatedLyric({ name, artist, durationSec });
          if (ne && ne.transLrc) {
            const map = ne.origLrc ? buildNeteaseTransMap(ne.origLrc, ne.transLrc) : {};
            const translated = new Array(lines.length).fill('');
            let matched = 0;
            for (let i = 0; i < lines.length; i++) {
              const tr = map[normLyricLine(lines[i])];
              if (tr) { translated[i] = tr; matched++; }
            }
            // 匹配足够多才认为是同一版本歌词；否则退回全机器翻译
            if (matched >= Math.max(2, Math.floor(lines.length * 0.4))) {
              const missing = [];
              for (let i = 0; i < translated.length; i++) if (!translated[i]) missing.push(i);
              if (missing.length) {
                const g = await googleTranslateLines(missing.map(i => lines[i]), to);
                missing.forEach((idx, j) => { translated[idx] = g[j] || ''; });
              }
              console.log('[LyricTranslate] 网易云人工翻译命中(对齐 ' + matched + '/' + lines.length + '):', name);
              sendJSON(res, { translated, source: 'netease-aligned' });
              return;
            }
          }
        } catch (e) { console.warn('[LyricTranslate netease]', e.message); }
      }
      // 2) 机器翻译兜底（逐行，套原词时间轴）
      const translated = await googleTranslateLines(lines, to);
      sendJSON(res, { translated, source: 'google' });
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
      const name = url.searchParams.get('name') || '';
      const artist = url.searchParams.get('artist') || '';
      const album = url.searchParams.get('album') || '';
      const id = url.searchParams.get('id') || '';
      const durationSec = Number(url.searchParams.get('duration') || 0) || 0;
      const cleanTrack = cleanLyricTitle(name);
      const cleanArtist = cleanLyricArtist(artist);
      const report = {
        input: { name, artist, album, durationSec, id },
        cleaned: { track: cleanTrack, artist: cleanArtist },
        steps: [],
      };
      // lrclib get
      try {
        const u = new URL(LRCLIB_BASE + '/get');
        u.searchParams.set('artist_name', cleanArtist);
        u.searchParams.set('track_name', cleanTrack);
        if (durationSec > 0) u.searchParams.set('duration', String(durationSec));
        const body = await requestJson(u.toString(), { headers: LRCLIB_HEADERS });
        report.steps.push({ step: 'lrclib-get', ok: true, hasSynced: !!(body && body.syncedLyrics), hasPlain: !!(body && body.plainLyrics), matchedArtist: body && body.artistName, matchedTrack: body && body.trackName, matchedDuration: body && body.duration });
      } catch (e) { report.steps.push({ step: 'lrclib-get', ok: false, error: e.message + (e.statusCode ? ' [HTTP ' + e.statusCode + ']' : '') }); }
      // lrclib search
      try {
        const u = new URL(LRCLIB_BASE + '/search');
        u.searchParams.set('track_name', cleanTrack);
        if (cleanArtist) u.searchParams.set('artist_name', cleanArtist);
        const list = await requestJson(u.toString(), { headers: LRCLIB_HEADERS });
        report.steps.push({ step: 'lrclib-search', ok: true, count: Array.isArray(list) ? list.length : 0, top: (Array.isArray(list) ? list : []).slice(0, 5).map(x => ({ artist: x.artistName, track: x.trackName, duration: x.duration, synced: !!x.syncedLyrics })) });
      } catch (e) { report.steps.push({ step: 'lrclib-search', ok: false, error: e.message + (e.statusCode ? ' [HTTP ' + e.statusCode + ']' : '') }); }
      // 最终结果（走完整瀑布，含 YTM 兜底）
      const out = await resolveLyrics({ name, artist, album, durationSec, videoId: id });
      report.result = { source: out.source, hasLyric: !!out.lyric, synced: /\[\d+:\d+/.test(out.lyric || ''), preview: (out.lyric || '').slice(0, 120) };
      sendJSON(res, report);
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  if (pn === '/api/debug/audio') {
    try {
      const sid = String(url.searchParams.get('id') || '').trim();
      if (!sid) { sendJSON(res, { ok: false, error: 'Missing id（YouTube videoId）' }, 400); return; }
      const started = Date.now();
      try {
        const fmt = await resolveYtmAudioFormat(sid, true);
        let upstream = null;
        try {
          const probe = await fetch(fmt.url, { headers: { 'User-Agent': UA, Accept: '*/*', Range: 'bytes=0-1023' } });
          upstream = { status: probe.status, contentType: probe.headers.get('content-type') || '' };
          try { if (probe.body && probe.body.cancel) await probe.body.cancel(); } catch (e) {}
        } catch (e) {
          upstream = { error: (e && e.message) || String(e) };
        }
        sendJSON(res, {
          ok: true,
          id: sid,
          client: fmt.client,
          mime: fmt.mime,
          bitrate: fmt.bitrate,
          contentLength: fmt.contentLength,
          clientFailures: fmt.failures,
          upstream,
          loggedIn: !!userCookie,
          ms: Date.now() - started,
        });
      } catch (e) {
        sendJSON(res, { ok: false, id: sid, error: e.message, failures: e.failures || [], loggedIn: !!userCookie, ms: Date.now() - started }, 502);
      }
    } catch (err) {
      sendJSON(res, { ok: false, error: err.message }, 500);
    }
    return;
  }

  // ---------- 音频代理 (YouTube Music 流式 ytm: 为主，其余 URL 通用透传) ----------
  if (pn === '/api/audio') {
    try {
      const audioUrl = url.searchParams.get('url');
      if (!audioUrl) { res.writeHead(400); res.end('Missing url'); return; }
      if (audioUrl.startsWith('ytm:')) {
        const sid = audioUrl.slice(4);
        const range = req.headers.range || '';
        console.log('[YTM Audio Proxy] videoId:', sid, range ? ('range=' + range) : 'full');
        // 第一层：Metrolist 方式解析明文直链，代理转发并透传 Range，支持进度条 seek。
        // 直链有时效，过期会返回 4xx；只要还没开始发响应（res.headersSent 为假），就换一个
        // 新解析的直链再试一次，让“临时音源失败”自动无感恢复，实在不行再落第二层 download()。
        let fmt = null;
        try {
          fmt = await resolveYtmAudioFormat(sid);
        } catch (e) {
          console.error('[YTM Audio] resolve failed:', e.message);
        }
        for (let attempt = 0; fmt && attempt < 2; attempt++) {
          try {
            await streamYtmDirectFormat(res, fmt, range);
            return;
          } catch (e) {
            console.warn('[YTM Audio] direct proxy failed (' + fmt.client + '):', e.message);
            ytmFormatCache.delete(sid);
            if (res.headersSent) { try { res.end(); } catch (_) {} return; } // 已开始发送，无法重试
            if (attempt === 0) {
              try {
                fmt = await resolveYtmAudioFormat(sid, true);
                console.warn('[YTM Audio] re-resolved fresh url via', fmt.client, '-> retry');
                continue;
              } catch (e2) {
                console.error('[YTM Audio] re-resolve failed:', e2.message);
              }
            }
            fmt = null; // 落到 download() 兜底
          }
        }
        // 第二层兜底：youtubei.js 内部下载流（不支持 seek），默认 ANDROID_VR 客户端
        try {
          const yt = await getYTMusic();
          const stream = await yt.download(sid, { client: 'ANDROID_VR', type: 'audio', quality: 'best' });
          const nodeStream = Readable.fromWeb(stream);
          res.writeHead(200, {
            'Content-Type': (fmt && fmt.mime) || 'audio/webm',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-cache',
          });
          nodeStream.pipe(res);
          nodeStream.on('error', (e) => {
            console.error('[YTM Audio Pipe Error]', e.message);
            res.end();
          });
          return;
        } catch (e) {
          console.error('[YTM Audio] all strategies failed:', e.message);
          res.writeHead(502, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(JSON.stringify({ error: 'YTM_AUDIO_UNAVAILABLE', message: e.message }));
          return;
        }
      }
      // 其余直链（本地文件、外部 URL）通用透传，支持 Range
      const range = req.headers.range || '';
      const upHeaders = { 'User-Agent': UA, Accept: '*/*' };
      if (range) upHeaders.Range = range;
      const up = await fetch(audioUrl, { headers: upHeaders });
      const out = {
        'Content-Type': up.headers.get('content-type') || 'audio/mpeg',
        'Access-Control-Allow-Origin': '*',
        'Accept-Ranges': 'bytes',
      };
      const cl = up.headers.get('content-length'); if (cl) out['Content-Length'] = cl;
      const cr = up.headers.get('content-range');  if (cr) out['Content-Range']  = cr;
      res.writeHead(up.status, out);
      const reader = up.body.getReader();
      while (true) { const c = await reader.read(); if (c.done) break; res.write(c.value); }
      res.end();
    } catch (err) { console.error('[Audio]', err); res.writeHead(500); res.end(); }
    return;
  }

  // ---------- 静态资源 ----------
  if (pn === '/favicon.ico') {
    serveStatic(res, path.join(__dirname, 'build', 'icon.ico'));
    return;
  }

  let filePath = pn === '/' ? '/index.html' : pn;
  filePath = path.join(__dirname, 'public', filePath);
  serveStatic(res, filePath);
});

server.listen(PORT, HOST, () => {
  console.log('======================================================');
  console.log(' 粒子音乐可视化 v2  →  http://localhost:' + PORT);
  console.log(' 登录态: ' + (userCookie ? '已登录(cookie已加载)' : '未登录'));
  console.log('======================================================');
});

module.exports = server;
