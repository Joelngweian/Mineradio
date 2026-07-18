const fs = require('fs');
const path = require('path');
const vm = require('vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const indexSource = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');

const modules = [
  ['wallpaperState', 'js/modules/wallpaper-state.js'],
  ['queueState', 'js/modules/queue-state.js'],
  ['queueController', 'js/modules/queue-controller.js'],
  ['updatePanel', 'js/modules/update-panel.js'],
  ['homeRecommendations', 'js/modules/home-recommendations.js'],
  ['homeDiscoverView', 'js/modules/home-discover-view.js'],
  ['playlistDetailView', 'js/modules/playlist-detail-view.js']
];

function readModule(relativePath) {
  return fs.readFileSync(path.join(publicRoot, relativePath), 'utf8');
}

test('front-end feature modules load before the main inline app script', () => {
  const mainScriptIndex = indexSource.indexOf('var MineradioModules = window.MineradioModules || (window.MineradioModules = {});');
  assert.notEqual(mainScriptIndex, -1, 'main inline app script should be identifiable');

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
  assert.match(indexSource, /var MineradioModules = window\.MineradioModules \|\| \(window\.MineradioModules = \{\}\);/);
  assert.match(indexSource, /MineradioModules\.queueState\.queueTextKey\(text\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isPlaceholderQueueText\(text\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isValidQueueSong\(song\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isUsefulRadioSong\(song\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.renderQueueItemsHtml\(playQueue, currentIdx/);
  assert.match(indexSource, /MineradioModules\.queueController\.createSearchSeedQueue\(/);
  assert.match(indexSource, /MineradioModules\.queueController\.mergeRadioRecommendations\(/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.formatUpdateBytes\(bytes\)/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.formatUpdateSpeed\(bytesPerSecond\)/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.renderUpdateNotesHtml\(/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.previewView\(/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateMode\(mode\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateMinutes\(value\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateTransition\(t\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.transitionLabel\(t\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.beginWallpaperSwap\(/);
  assert.match(indexSource, /MineradioModules\.homeRecommendations\.normalizeArtistNameForMatch\(name\)/);
  assert.match(indexSource, /MineradioModules\.homeRecommendations\.artistMatchScore\(/);
  assert.match(indexSource, /MineradioModules\.homeRecommendations\.renderRecommendationCards\(recommendations/);
  assert.match(indexSource, /MineradioModules\.homeDiscoverView\.buildHomeTiles\(/);
  assert.match(indexSource, /MineradioModules\.homeDiscoverView\.renderHomeTilesHtml\(/);
  assert.match(indexSource, /MineradioModules\.homeDiscoverView\.homeRailCopy\(/);
  assert.match(indexSource, /MineradioModules\.playlistDetailView\.renderPlaylistDetailHtml\(/);
});
