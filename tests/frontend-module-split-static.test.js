const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const indexSource = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(publicRoot, 'js', 'app.js'), 'utf8');

function importBrowserModule(relativePath) {
  return import(pathToFileURL(path.join(publicRoot, relativePath)).href);
}

test('front-end loads one ES module entrypoint without the legacy global registry', () => {
  assert.match(indexSource, /<script type="module" src="js\/app\.js"><\/script>/);
  assert.doesNotMatch(indexSource, /<script src="js\/modules\//);
  assert.match(appSource, /import \* as apiClient from '\.\/modules\/api-client\.js';/);
  assert.match(appSource, /createFullLyricsController/);
  assert.match(appSource, /const MineradioModules = Object\.freeze\(/);
  assert.doesNotMatch(appSource, /window\.MineradioModules/);
  assert.ok(fs.existsSync(path.join(publicRoot, 'js', 'package.json')));
});

test('every browser feature module has native exports and no UMD wrapper', async () => {
  const files = fs.readdirSync(path.join(publicRoot, 'js', 'modules')).filter((file) => file.endsWith('.js'));
  const modules = await Promise.all(files.map((file) => importBrowserModule(`js/modules/${file}`)));
  modules.forEach((module, index) => {
    assert.ok(Object.keys(module).length > 0, `${files[index]} should expose an ES module API`);
  });
  files.forEach((file) => {
    const source = fs.readFileSync(path.join(publicRoot, 'js', 'modules', file), 'utf8');
    assert.match(source, /export \{/);
    assert.doesNotMatch(source, /MineradioModules|\(function\(global\)/);
  });
});

test('queue, radio, lyrics, wallpaper, and update modules retain their public behavior', async () => {
  const [queueState, queueController, radioQueue, lyricsState, fullLyricsView, fullLyricsController, wallpaperState, updatePanel, appVersion] = await Promise.all([
    importBrowserModule('js/modules/queue-state.js'),
    importBrowserModule('js/modules/queue-controller.js'),
    importBrowserModule('js/modules/radio-queue.js'),
    importBrowserModule('js/modules/lyrics-state.js'),
    importBrowserModule('js/modules/full-lyrics-view.js'),
    importBrowserModule('js/modules/full-lyrics-controller.js'),
    importBrowserModule('js/modules/wallpaper-state.js'),
    importBrowserModule('js/modules/update-panel.js'),
    importBrowserModule('js/modules/app-version.js'),
  ]);
  const seed = { id: 'seed', name: 'Seed', artist: 'Test Artist', cover: 'seed.jpg' };
  const seeded = queueController.createSearchSeedQueue(seed, (song) => ({ ...song }));
  const merged = queueController.mergeRadioRecommendations(seeded.queue, 0, seed, [seed, {
    id: 'next', name: 'Next', artist: 'Test Artist', cover: 'next.jpg',
  }], { replaceTail: true, isValidQueueSong: queueState.isValidQueueSong });
  assert.deepEqual(merged.queue.map((song) => song.id), ['seed', 'next']);
  assert.equal(queueState.isPlaceholderQueueText('未知歌手'), true);
  assert.equal(typeof radioQueue.create, 'function');

  const lines = lyricsState.parseLyricText('[00:00.00]Intro\n[00:12.00]Current line');
  const view = fullLyricsView.buildFullLyricsViewState({ lines, currentTime: 12, visible: true });
  assert.equal(view.activeIndex, 1);
  assert.match(fullLyricsView.renderFullLyricsHtml(view, { escHtml: String }), /full-lyric-line active/);

  const dom = new JSDOM('<button class="lyrics-toggle-btn"></button><section id="full-lyrics-panel"><h1 id="full-lyrics-title"></h1><p id="full-lyrics-artist"></p><div id="full-lyrics-list"></div></section>');
  const lyricState = {
    audio: { currentTime: 12 },
    lyricsLines: lines,
    lyricsTimingSource: 'lrc-line',
    lyricsVisible: false,
    fullLyricsVisible: false,
    fullLyricsActiveIndex: -1,
    fullLyricsUserScrollUntil: 0,
    fullLyricsProgrammaticScroll: false,
  };
  const controller = fullLyricsController.createFullLyricsController({
    document: dom.window.document,
    fullLyricsView,
    currentLyricSong: () => ({ name: 'Test Song', artist: 'Test Artist' }),
    escHtml: String,
    getState: () => lyricState,
    setState: (patch) => Object.assign(lyricState, patch),
    now: () => 1000,
    setTimeout: (callback) => callback(),
  });
  controller.toggle(true);
  assert.equal(dom.window.document.querySelector('#full-lyrics-panel').classList.contains('show'), true);
  assert.equal(dom.window.document.querySelectorAll('.full-lyric-line').length, 2);
  assert.equal(dom.window.document.querySelector('#full-lyrics-title').textContent, 'Test Song');
  dom.window.document.querySelector('[data-lyric-index="0"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.equal(lyricState.audio.currentTime, 0);
  controller.toggle(false);
  assert.equal(lyricState.fullLyricsVisible, false);

  assert.equal(wallpaperState.normalizeRotateMode('shuffle'), 'shuffle');
  assert.equal(wallpaperState.beginWallpaperSwap({ token: 2, transition: 'slide' }).exitTransform, 'translateX(30%)');
  assert.equal(updatePanel.formatUpdateSpeed(1024), '1 KB/s');
  assert.equal(appVersion.normalizeVersionText('v1.4.2'), '1.4.2');
});

test('api client retains timeout-aware JSON request handling', async () => {
  const apiClient = await importBrowserModule('js/modules/api-client.js');
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => ({
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ url, method: options.method }),
  });
  try {
    const result = await apiClient.apiJson('/api/example', { method: 'POST', timeoutMs: 500 });
    assert.deepEqual(result, { url: '/api/example', method: 'POST' });
  } finally {
    global.fetch = originalFetch;
  }
});

test('startup task queue coalesces deferred work and releases keys after completion', async () => {
  const startupTasks = await importBrowserModule('js/modules/startup-task-queue.js');
  const scheduled = [];
  const errors = [];
  const queue = startupTasks.createStartupTaskQueue({
    schedule: (callback, delay) => scheduled.push({ callback, delay }),
    onError: (error, key) => errors.push(`${key}:${error.message}`),
  });
  let runs = 0;
  const first = queue.enqueue('library', () => { runs += 1; }, 760);
  const duplicate = queue.enqueue('library', () => { runs += 100; }, 760);
  assert.equal(first, duplicate);
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 760);
  scheduled.shift().callback();
  await first;
  assert.equal(runs, 1);
  assert.equal(queue.has('library'), false);

  const failed = queue.enqueue('discover', () => { throw new Error('offline'); });
  scheduled.shift().callback();
  await failed;
  assert.deepEqual(errors, ['discover:offline']);
});

test('lyrics loader caches usable responses and ignores stale playback sessions', async () => {
  const [lyricsLoader, lyricsState] = await Promise.all([
    importBrowserModule('js/modules/lyrics-loader.js'),
    importBrowserModule('js/modules/lyrics-state.js'),
  ]);
  let activeToken = 1;
  let requestCount = 0;
  const applied = [];
  const loader = lyricsLoader.createLyricsLoader({
    apiJson: async () => {
      requestCount += 1;
      return { lyric: '[00:00.00]First line\n[00:08.00]Second line' };
    },
    songProviderKey: () => 'youtube',
    isCurrentToken: (token) => token === activeToken,
    parseYrcText: lyricsState.parseYrcText,
    parseLyricText: lyricsState.parseLyricText,
    withLyricFallback: (lines) => lines.length ? lines : [{ t: 0, text: 'Fallback', fallback: true }],
    setOriginalLyricsState: (lines, karaoke, timing) => applied.push({ lines, karaoke, timing }),
    applyPreferredLyricsForCurrent: () => {},
    resetLyricTranslationForNewSong: () => {},
  });
  const song = { id: 'song-1', name: 'Song', artist: 'Artist', duration: 180000 };
  await loader.fetch(song, 1);
  await loader.fetch(song, 1);
  assert.equal(requestCount, 1);
  assert.equal(loader.getCacheSize(), 1);
  assert.equal(applied.length, 2);
  assert.equal(applied[0].timing, 'lrc-line');
  assert.match(loader.endpointFor(song, song), /duration=180/);

  activeToken = 2;
  await loader.fetch({ id: 'song-2', name: 'Next', artist: 'Artist' }, 1);
  assert.equal(applied.length, 2);
});

test('playback, recommendation, hotkey, and visual archive module APIs remain importable', async () => {
  const [playbackSession, homeRecommendations, homeDiscoverView, hotkeyState, fxArchiveState, beatDynamics] = await Promise.all([
    importBrowserModule('js/modules/playback-session.js'),
    importBrowserModule('js/modules/home-recommendations.js'),
    importBrowserModule('js/modules/home-discover-view.js'),
    importBrowserModule('js/modules/hotkey-state.js'),
    importBrowserModule('js/modules/fx-archive-state.js'),
    importBrowserModule('js/modules/beat-dynamics.js'),
  ]);
  const sessions = playbackSession.create();
  const first = sessions.begin({ id: 'first' });
  const second = sessions.begin({ id: 'second' });
  assert.equal(first.signal.aborted, true);
  assert.equal(sessions.isCurrent(second.token), true);
  assert.equal(homeRecommendations.normalizeArtistNameForMatch('RADWIMPS + Toaka'), 'radwimpstoaka');
  assert.equal(homeDiscoverView.homeRailCopy({ recent: { name: 'A' } }, false, false).title, '接着听');
  assert.equal(hotkeyState.hotkeyToAccelerator('Ctrl+Shift+Digit2'), 'Control+Shift+2');
  assert.equal(fxArchiveState.safeArchiveFileName('A<>B?.json'), 'A-B-.json.json');
  assert.ok(beatDynamics.cameraBeatEnvelope({ energy: 0.9, bass: 0.9, onset: true }).ampScale > 1);
});

test('dynamic list actions use delegated data attributes instead of inline handlers', async () => {
  const [delegator, queueState, homeDiscoverView, homeRecommendations] = await Promise.all([
    importBrowserModule('js/modules/dynamic-action-delegator.js'),
    importBrowserModule('js/modules/queue-state.js'),
    importBrowserModule('js/modules/home-discover-view.js'),
    importBrowserModule('js/modules/home-recommendations.js'),
  ]);
  const dom = new JSDOM('<div data-action="queue-play" data-index="1"><button data-action="queue-remove" data-index="1" data-stop-propagation="true">remove</button></div>');
  const calls = [];
  const controller = delegator.createDynamicActionDelegator({
    document: dom.window.document,
    actions: {
      'queue-play': ({ index }) => calls.push(`play:${index}`),
      'queue-remove': ({ index }) => calls.push(`remove:${index}`),
    },
  });
  controller.bind();
  dom.window.document.querySelector('button').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  dom.window.document.querySelector('div').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  assert.deepEqual(calls, ['remove:1', 'play:1']);

  const queueHtml = queueState.renderQueueItemHtml({ id: 'one', name: 'One', artist: 'Artist', cover: 'cover.jpg' }, 0, 0);
  const homeHtml = homeDiscoverView.renderHomeTilesHtml([{ title: 'Home', sub: 'Tile' }]);
  const recommendationHtml = homeRecommendations.renderRecommendationCard({ name: 'Recommended', artist: 'Artist' }, 0);
  assert.match(queueHtml, /data-action="queue-play"/);
  assert.match(homeHtml, /data-action="home-tile"/);
  assert.match(recommendationHtml, /data-action="home-recommendation"/);
  [appSource, queueHtml, homeHtml, recommendationHtml].forEach((source) => assert.doesNotMatch(source, /onclick=/));
});

test('app keeps its explicit browser bridge for static controls and smoke hooks', () => {
  const bridgeSource = appSource.slice(appSource.lastIndexOf('Object.assign(window, {'));
  [
    'setSearchMode', 'togglePlay', 'toggleFullLyrics', 'toggleFx', 'openUpdatePanel',
    'swapBackgroundWithTransition', 'openQueueArtist', 'toggleLikeQueueIndex', 'collectQueueIndex', 'removeFromQueue',
  ].forEach((name) => assert.match(bridgeSource, new RegExp(`\\b${name},`), name));
  assert.match(bridgeSource, /Object\.assign\(window, \{/);
  assert.match(appSource, /createDynamicActionDelegator/);
  assert.match(appSource, /createStartupTaskQueue/);
  assert.match(appSource, /refreshLoginStatus\(\{ deferHydration: true \}\)/);
  assert.match(appSource, /scheduleStartupLibraryHydration\(\)/);
  assert.match(appSource, /\/api\/login\/profile/);
  assert.match(appSource, /scheduleLoginProfileHydration\(\)/);
  assert.match(appSource, /createResourceLifecycle/);
  assert.match(appSource, /disposeAppRuntimeResources/);
  assert.match(appSource, /createPlaybackObservability/);
  assert.match(appSource, /__mineradioPlaybackTrace/);
  assert.match(appSource, /X-Mineradio-Playback-Session/);
  assert.match(appSource, /&ps=' \+ encodeURIComponent\(playbackTraceId\)/);
  assert.doesNotMatch(appSource, /gameModeController|\/api\/gsi\//);
});
