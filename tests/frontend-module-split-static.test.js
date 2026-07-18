const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const indexSource = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(publicRoot, 'js', 'app.js'), 'utf8');

const modules = [
  ['apiClient', 'js/modules/api-client.js'],
  ['appVersion', 'js/modules/app-version.js'],
  ['wallpaperState', 'js/modules/wallpaper-state.js'],
  ['queueState', 'js/modules/queue-state.js'],
  ['queueController', 'js/modules/queue-controller.js'],
  ['updatePanel', 'js/modules/update-panel.js'],
  ['homeRecommendations', 'js/modules/home-recommendations.js'],
  ['homeDiscoverView', 'js/modules/home-discover-view.js'],
  ['playlistDetailView', 'js/modules/playlist-detail-view.js'],
  ['lyricsState', 'js/modules/lyrics-state.js'],
  ['beatDynamics', 'js/modules/beat-dynamics.js']
];

function readModule(relativePath) {
  return fs.readFileSync(path.join(publicRoot, relativePath), 'utf8');
}

test('front-end feature modules load before the main app script', () => {
  const mainScriptIndex = indexSource.indexOf('<script src="js/app.js"></script>');
  assert.notEqual(mainScriptIndex, -1, 'main app script should be loaded from index.html');

  modules.forEach(([, relativePath]) => {
    const tag = `<script src="${relativePath}"></script>`;
    const tagIndex = indexSource.indexOf(tag);
    assert.notEqual(tagIndex, -1, `${relativePath} should be loaded from index.html`);
    assert.ok(tagIndex < mainScriptIndex, `${relativePath} should load before the main app script`);
  });
});

test('front-end feature modules expose stable namespaces', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);

  modules.forEach(([namespace, relativePath]) => {
    const source = readModule(relativePath);
    assert.match(source, /'use strict';/, `${relativePath} should run in strict mode`);
    assert.match(source, new RegExp(`MineradioModules\\.${namespace}\\s*=`), `${relativePath} should expose ${namespace}`);
    new vm.Script(source, { filename: relativePath }).runInContext(sandbox);
    assert.ok(sandbox.window.MineradioModules[namespace], `${namespace} namespace should exist`);
  });

  assert.equal(sandbox.window.MineradioModules.queueState.queueTextKey('Unknown Artist'), 'unknownartist');
  assert.equal(sandbox.window.MineradioModules.queueState.isPlaceholderQueueText('未知歌手'), true);
  assert.equal(sandbox.window.MineradioModules.queueState.isValidQueueSong({ name: 'Song', artist: 'RADWIMPS', id: 'yt1', cover: 'cover.jpg' }), true);
  assert.equal(sandbox.window.MineradioModules.queueState.isValidQueueSong({ name: 'Unknown', artist: 'RADWIMPS', id: 'yt1', cover: 'cover.jpg' }), false);
  assert.equal(sandbox.window.MineradioModules.queueState.isUsefulRadioSong({ id: 'yt1', name: 'Song', artist: 'RADWIMPS', cover: 'cover.jpg' }), true);
  assert.equal(sandbox.window.MineradioModules.updatePanel.formatUpdateBytes(1024 * 1024), '1 MB');
  assert.equal(sandbox.window.MineradioModules.updatePanel.formatUpdateSpeed(1024), '1 KB/s');
  assert.equal(sandbox.window.MineradioModules.updatePanel.progressDetailText({ received: 1024, speedBps: 2048 }, {
    formatUpdateBytes: sandbox.window.MineradioModules.updatePanel.formatUpdateBytes,
    formatUpdateSpeed: sandbox.window.MineradioModules.updatePanel.formatUpdateSpeed
  }), '已下载 1 KB · 2 KB/s');
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMode('shuffle'), 'shuffle');
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMode('bad'), 'off');
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMinutes(999), 60);
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateTransition('bad'), 'crossfade');
  assert.equal(sandbox.window.MineradioModules.homeRecommendations.normalizeArtistNameForMatch('RADWIMPS + Toaka'), 'radwimpstoaka');
  assert.equal(sandbox.window.MineradioModules.homeRecommendations.artistMatchScore('RADWIMPS feat. Toaka', ['radwimps']), 1);
  assert.equal(sandbox.window.MineradioModules.queueController.queueItemKey({ id: 'yt1' }), 'song:yt1');
  assert.equal(sandbox.window.MineradioModules.homeDiscoverView.homeRailCopy({ recent: { name: 'A' } }, false, false).title, '接着听');
});

test('beat dynamics module boosts climax drum hits and shortens their interval', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/beat-dynamics.js'), { filename: 'beat-dynamics.js' }).runInContext(sandbox);

  const beatDynamics = sandbox.window.MineradioModules.beatDynamics;
  const weak = beatDynamics.cameraBeatEnvelope({
    strength: 0.38,
    confidence: 0.52,
    impact: 0.28,
    low: 0.24,
    body: 0.16,
    snap: 0.08,
    combo: 'rebound'
  }, 'map', { sectionEnergy: 0.18, sectionLow: 0.22, cinemaShake: 1 });
  const climax = beatDynamics.cameraBeatEnvelope({
    strength: 0.82,
    confidence: 0.88,
    impact: 0.86,
    low: 0.84,
    body: 0.46,
    snap: 0.22,
    combo: 'drop',
    primary: true
  }, 'map', { sectionEnergy: 0.78, sectionLow: 0.82, cinemaShake: 1 });

  assert.ok(climax.climax > weak.climax, 'climax score should be higher for drop and low-energy hits');
  assert.ok(climax.ampScale > weak.ampScale, 'climax hit should drive stronger camera amplitude');
  assert.ok(climax.zoomScale > weak.zoomScale, 'climax hit should drive stronger push/zoom');
  assert.ok(climax.intervalScale < weak.intervalScale, 'climax hit should allow denser beat camera scheduling');
  assert.ok(climax.pulseScale > weak.pulseScale, 'climax hit should increase visual beat pulse');
});

test('beat dynamics respects reduced motion and user motion caps', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/beat-dynamics.js'), { filename: 'beat-dynamics.js' }).runInContext(sandbox);

  const beatDynamics = sandbox.window.MineradioModules.beatDynamics;
  const full = beatDynamics.cameraBeatEnvelope({
    strength: 0.92,
    confidence: 0.92,
    impact: 0.90,
    low: 0.88,
    body: 0.54,
    snap: 0.28,
    combo: 'drop'
  }, 'map', { sectionEnergy: 0.86, sectionLow: 0.88, cinemaShake: 1.4, motionScale: 1 });
  const reduced = beatDynamics.cameraBeatEnvelope({
    strength: 0.92,
    confidence: 0.92,
    impact: 0.90,
    low: 0.88,
    body: 0.54,
    snap: 0.28,
    combo: 'drop'
  }, 'map', { sectionEnergy: 0.86, sectionLow: 0.88, cinemaShake: 1.4, motionScale: 0.35, reduceMotion: true });

  assert.ok(reduced.ampScale < full.ampScale, 'reduced motion should lower camera amplitude');
  assert.ok(reduced.zoomScale < full.zoomScale, 'reduced motion should lower push/zoom');
  assert.ok(reduced.intervalScale >= full.intervalScale, 'reduced motion should not make hits denser');
  assert.equal(reduced.strongBypass, false, 'reduced motion should not bypass beat spacing');
});

test('api client owns json fetch timeout and cleanup behavior', async () => {
  let abortCalled = false;
  let cleared = false;
  let fetchedUrl = '';
  const sandbox = {
    window: {
      AbortController: function() {
        this.signal = { aborted: false };
        this.abort = function() {
          abortCalled = true;
          this.signal.aborted = true;
        };
      }
    },
    setTimeout(fn) {
      fn();
      return 7;
    },
    clearTimeout(id) {
      if (id === 7) cleared = true;
    },
    fetch(url, opts) {
      fetchedUrl = url;
      assert.equal(opts.signal.aborted, true);
      return Promise.resolve({ json: () => Promise.resolve({ ok: true }) });
    }
  };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/api-client.js'), { filename: 'api-client.js' }).runInContext(sandbox);

  const data = await sandbox.window.MineradioModules.apiClient.apiJson('/api/example', { timeoutMs: 2500, headers: { accept: 'json' } });
  assert.deepEqual(data, { ok: true });
  assert.equal(fetchedUrl, '/api/example');
  assert.equal(abortCalled, true);
  assert.equal(cleared, true);
});

test('app version module normalizes server version into update preview state', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/app-version.js'), { filename: 'app-version.js' }).runInContext(sandbox);

  const state = { currentVersion: '0.9.11', version: '1.1.0', notes: ['old'] };
  const result = sandbox.window.MineradioModules.appVersion.applyAppVersionState(state, {
    ok: true,
    version: '1.3.6',
    update: { preview: false }
  });

  assert.equal(result.currentVersion, '1.3.6');
  assert.equal(result.version, '1.3.6');
  assert.equal(result.preview, false);
  assert.equal(sandbox.window.MineradioModules.appVersion.normalizeVersionText('v1.3.6'), '1.3.6');
});

test('queue module renders queue row markup outside the main html blob', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/queue-state.js'), { filename: 'queue-state.js' }).runInContext(sandbox);

  const html = sandbox.window.MineradioModules.queueState.renderQueueItemHtml({
    name: 'Catch the Moment',
    artist: 'LiSA',
    cover: 'cover.jpg'
  }, 1, 1, {
    songCoverSrc: song => song.cover,
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    isSongLiked: () => true,
    heartIconSvg: () => '<svg data-heart></svg>',
    playlistPlusIconSvg: () => '<svg data-plus></svg>'
  });

  assert.match(html, /class="queue-item now"/);
  assert.match(html, /playQueueAt\(1\)/);
  assert.match(html, /openQueueArtist\(1\)/);
  assert.match(html, /toggleLikeQueueIndex\(1\)/);
  assert.match(html, /queueIndexNext\(1\)/);
  assert.match(html, /collectQueueIndex\(1\)/);
  assert.match(html, /removeFromQueue\(1\)/);
  assert.match(html, /<svg data-heart><\/svg>/);
});

test('home recommendation module renders personal recommendation cards', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/home-recommendations.js'), { filename: 'home-recommendations.js' }).runInContext(sandbox);

  const html = sandbox.window.MineradioModules.homeRecommendations.renderRecommendationCards([{
    name: 'KANATA HALUKA',
    artist: 'RADWIMPS',
    cover: 'cover.jpg'
  }], {
    songCoverSrc: song => song.cover,
    songSourceLabel: () => 'YTM',
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    cssImageUrl: value => encodeURIComponent(value)
  });

  assert.match(html, /home-rec-card/);
  assert.match(html, /playHomeRecommendation\(0\)/);
  assert.match(html, /background-image:url\('cover\.jpg'\)/);
  assert.match(html, /KANATA HALUKA/);
  assert.match(html, /RADWIMPS/);
});

test('home discover view module builds and renders tile rows', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/home-discover-view.js'), { filename: 'home-discover-view.js' }).runInContext(sandbox);

  const tiles = sandbox.window.MineradioModules.homeDiscoverView.buildHomeTiles({
    summary: { recent: { id: 'r1', name: 'Recent Song', artist: 'Singer', cover: 'recent.jpg' }, topArtist: { name: 'RADWIMPS', plays: 7 } },
    loggedOutHome: false,
    discoverState: { songs: [{ name: 'Daily', artist: 'Artist', cover: 'daily.jpg' }], playlists: [], podcasts: [], loading: false },
    weatherSongs: []
  }, {
    songSourceLabel: () => 'YTM',
    compactHomeCount: value => String(value)
  });

  assert.equal(tiles.length, 3);
  assert.equal(tiles[0].kind, 'recent');
  const html = sandbox.window.MineradioModules.homeDiscoverView.renderHomeTilesHtml(tiles, {
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    cssImageUrl: value => encodeURIComponent(value),
    homeTileCover: item => item.cover || (item.song && item.song.cover) || '',
    homeToneForItem: item => item.kind
  });
  assert.match(html, /class="home-tile/);
  assert.match(html, /handleHomeTileClick\(0\)/);
  assert.match(html, /Recent Song/);
});

test('playlist detail view module renders detail header and lazy rows', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/playlist-detail-view.js'), { filename: 'playlist-detail-view.js' }).runInContext(sandbox);

  const html = sandbox.window.MineradioModules.playlistDetailView.renderPlaylistDetailHtml({
    key: 'youtube:pl1',
    playlist: { id: 'pl1', name: 'Liked Songs', creator: 'YouTube Music', cover: 'cover.jpg', trackCount: 3 },
    loading: false,
    tracks: [
      { name: 'Track A', artist: 'Artist A', cover: 'a.jpg' },
      { name: 'Track B', artist: 'Artist B', cover: 'b.jpg' }
    ],
    renderLimit: 1,
    initialRender: 1
  }, {
    escHtml: value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    songCoverSrc: song => song.cover
  });

  assert.match(html, /data-pl-detail="youtube:pl1"/);
  assert.match(html, /data-pl-detail-row="0"/);
  assert.doesNotMatch(html, /Track B/);
  assert.match(html, /data-pl-detail-load-more="1"/);
});

test('lyrics module parses timed lyrics and fallback lines', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/lyrics-state.js'), { filename: 'lyrics-state.js' }).runInContext(sandbox);

  const lyrics = sandbox.window.MineradioModules.lyricsState;
  const lrc = lyrics.parseLyricText('[00:01.50]Hello\n[00:03.000][00:04.000]World');
  assert.equal(lrc.length, 3);
  assert.equal(lrc[0].t, 1.5);
  assert.equal(lrc[0].text, 'Hello');
  assert.equal(lrc[1].text, 'World');
  assert.ok(lrc[0].duration > 0);

  const yrc = lyrics.parseYrcText('[1000,1200](1000,400,0)Ka(1400,400,0)na');
  assert.equal(yrc.length, 1);
  assert.equal(yrc[0].source, 'yrc-word');
  assert.equal(yrc[0].text, 'Kana');
  assert.equal(yrc[0].words.length, 2);
  assert.ok(lyrics.getLyricLineProgress(yrc[0], null, 1.2, 6) > 0);

  const fallback = lyrics.withLyricFallback([{ t: 0, text: '暂无歌词' }], function() { return 'Song - Artist'; });
  assert.equal(fallback.length, 1);
  assert.equal(fallback[0].fallback, true);
  assert.equal(fallback[0].text, 'Song - Artist');
});

test('update panel module owns copy and note rendering decisions', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/update-panel.js'), { filename: 'update-panel.js' }).runInContext(sandbox);

  const view = sandbox.window.MineradioModules.updatePanel.previewView({
    status: 'downloading',
    mode: 'patch',
    progress: 41,
    message: 'Downloading patch',
    received: 2048,
    speedBps: 1024,
    attempts: 2,
    attempt: 1
  }, { manualReleaseAvailable: true });
  assert.equal(view.label, '快速补丁 41%');
  assert.match(view.footnote, /Downloading patch/);
  assert.match(sandbox.window.MineradioModules.updatePanel.renderUpdateNotesHtml(['A < B'], value => String(value).replace(/</g, '&lt;')), /A &lt; B/);
});

test('queue controller keeps search seed and radio merge deterministic', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/queue-controller.js'), { filename: 'queue-controller.js' }).runInContext(sandbox);
  const controller = sandbox.window.MineradioModules.queueController;
  const seed = { id: 'seed1', name: 'Seed', artist: 'Artist', cover: 'seed.jpg' };
  const state = controller.createSearchSeedQueue(seed, song => Object.assign({}, song));
  assert.equal(state.currentIdx, 0);
  assert.equal(state.queue.length, 1);

  const merged = controller.mergeRadioRecommendations(state.queue, state.currentIdx, seed, [
    { id: 'seed1', name: 'Seed', artist: 'Artist', cover: 'seed.jpg' },
    { id: 'next1', name: 'Next', artist: 'Artist', cover: 'next.jpg' }
  ], {
    replaceTail: true,
    isValidQueueSong: song => !!(song && song.id && song.name && song.artist && song.cover),
    hydrateCustomCover: song => Object.assign({ hydrated: true }, song)
  });

  assert.equal(merged.added, 1);
  assert.equal(merged.queue.length, 2);
  assert.equal(merged.queue[1].id, 'next1');
  assert.equal(merged.queue[1].hydrated, true);
});

test('queue controller can merge radio results when current index drifts away from the seed', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/queue-controller.js'), { filename: 'queue-controller.js' }).runInContext(sandbox);
  const controller = sandbox.window.MineradioModules.queueController;
  const seed = { id: 'seed1', name: 'Seed', artist: 'Artist', cover: 'seed.jpg' };
  const queue = [
    seed,
    { id: 'manual1', name: 'Manual', artist: 'Artist', cover: 'manual.jpg' }
  ];

  const merged = controller.mergeRadioRecommendations(queue, 1, seed, [
    { id: 'next1', name: 'Next', artist: 'Artist', cover: 'next.jpg' }
  ], {
    requireCurrent: false,
    replaceTail: true,
    isValidQueueSong: song => !!(song && song.id && song.name && song.artist && song.cover)
  });

  assert.equal(merged.seedIndex, 0);
  assert.equal(merged.added, 1);
  assert.deepEqual(merged.queue.map(song => song.id), ['seed1', 'next1']);
});

test('wallpaper module owns swap-token and exit-transform decisions', () => {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  new vm.Script(readModule('js/modules/wallpaper-state.js'), { filename: 'wallpaper-state.js' }).runInContext(sandbox);

  const plan = sandbox.window.MineradioModules.wallpaperState.beginWallpaperSwap({
    token: 7,
    transition: 'slide',
    reduceMotion: false,
    hidden: false
  });
  assert.equal(plan.token, 8);
  assert.equal(plan.transition, 'slide');
  assert.equal(plan.animate, true);
  assert.equal(plan.exitTransform, 'translateX(30%)');

  const hiddenPlan = sandbox.window.MineradioModules.wallpaperState.beginWallpaperSwap({
    token: 2,
    transition: 'zoom',
    reduceMotion: false,
    hidden: true
  });
  assert.equal(hiddenPlan.animate, false);
  assert.equal(sandbox.window.MineradioModules.wallpaperState.wallpaperSwapExitTransform('zoom'), 'scale(1.10)');
});

test('main app delegates moved helpers through MineradioModules', () => {
  assert.match(appSource, /var MineradioModules = window\.MineradioModules \|\| \(window\.MineradioModules = \{\}\);/);
  assert.match(appSource, /MineradioModules\.apiClient\.apiJson\(url, opts\)/);
  assert.match(appSource, /MineradioModules\.appVersion\.applyAppVersionState\(updatePreviewState, data\)/);
  assert.match(appSource, /MineradioModules\.queueState\.queueTextKey\(text\)/);
  assert.match(appSource, /MineradioModules\.queueState\.isPlaceholderQueueText\(text\)/);
  assert.match(appSource, /MineradioModules\.queueState\.isValidQueueSong\(song\)/);
  assert.match(appSource, /MineradioModules\.queueState\.isUsefulRadioSong\(song\)/);
  assert.match(appSource, /MineradioModules\.queueState\.renderQueueItemsHtml\(playQueue, currentIdx/);
  assert.match(appSource, /MineradioModules\.queueController\.createSearchSeedQueue\(/);
  assert.match(appSource, /MineradioModules\.queueController\.mergeRadioRecommendations\(/);
  assert.match(appSource, /MineradioModules\.updatePanel\.formatUpdateBytes\(bytes\)/);
  assert.match(appSource, /MineradioModules\.updatePanel\.formatUpdateSpeed\(bytesPerSecond\)/);
  assert.match(appSource, /MineradioModules\.updatePanel\.renderUpdateNotesHtml\(/);
  assert.match(appSource, /MineradioModules\.updatePanel\.previewView\(/);
  assert.match(appSource, /MineradioModules\.wallpaperState\.normalizeRotateMode\(mode\)/);
  assert.match(appSource, /MineradioModules\.wallpaperState\.normalizeRotateMinutes\(value\)/);
  assert.match(appSource, /MineradioModules\.wallpaperState\.normalizeRotateTransition\(t\)/);
  assert.match(appSource, /MineradioModules\.wallpaperState\.transitionLabel\(t\)/);
  assert.match(appSource, /MineradioModules\.wallpaperState\.beginWallpaperSwap\(/);
  assert.match(appSource, /MineradioModules\.homeRecommendations\.normalizeArtistNameForMatch\(name\)/);
  assert.match(appSource, /MineradioModules\.homeRecommendations\.artistMatchScore\(/);
  assert.match(appSource, /MineradioModules\.homeRecommendations\.renderRecommendationCards\(recommendations/);
  assert.match(appSource, /MineradioModules\.homeDiscoverView\.buildHomeTiles\(/);
  assert.match(appSource, /MineradioModules\.homeDiscoverView\.renderHomeTilesHtml\(/);
  assert.match(appSource, /MineradioModules\.homeDiscoverView\.homeRailCopy\(/);
  assert.match(appSource, /MineradioModules\.playlistDetailView\.renderPlaylistDetailHtml\(/);
  assert.match(appSource, /MineradioModules\.lyricsState\.parseLyricText\(/);
  assert.match(appSource, /MineradioModules\.lyricsState\.parseYrcText\(/);
  assert.match(appSource, /MineradioModules\.lyricsState\.withLyricFallback\(/);
  assert.match(appSource, /MineradioModules\.lyricsState\.getLyricLineProgress\(/);
  assert.match(appSource, /MineradioModules\.beatDynamics\.cameraBeatEnvelope\(/);
  assert.match(appSource, /MineradioModules\.beatDynamics\.pulseEnvelope\(/);
});
