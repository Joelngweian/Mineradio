const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = [
  'server-app.js',
  'server/update-service.js'
].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'public', 'js', 'app.js'), 'utf8');
const queueModuleSource = fs.readFileSync(path.join(root, 'public', 'js', 'modules', 'queue-state.js'), 'utf8');
const queueControllerSource = fs.readFileSync(path.join(root, 'public', 'js', 'modules', 'queue-controller.js'), 'utf8');

test('playlist creation uses YouTube Music instead of a fake id', () => {
  assert.doesNotMatch(serverSource, /YTM_PL_\s*\+\s*Date\.now/);
  assert.match(serverSource, /yt\.playlist\.create\(name,\s*\[\]\)/);
});

test('playlist add-song uses YouTube Music instead of fake success', () => {
  assert.match(serverSource, /function normalizeYtmPlaylistEditId\(playlistId\)/);
  assert.match(serverSource, /function isYtmLikedPlaylistId\(playlistId\)/);
  assert.match(serverSource, /const editablePid = normalizeYtmPlaylistEditId\(pid\)/);
  assert.match(serverSource, /if \(isYtmLikedPlaylistId\(pid\)\) \{[\s\S]*await likeYtmSong\(yt,\s*id,\s*true\)/);
  assert.match(serverSource, /yt\.playlist\.addVideos\(editablePid,\s*\[id\]\)/);
  assert.doesNotMatch(serverSource, /yt\.playlist\.addVideos\(pid,\s*\[id\]\)/);
  assert.doesNotMatch(serverSource, /if \(pn === '\/api\/playlist\/add-song'\)[\s\S]*?sendJSON\(res,\s*\{\s*loggedIn:\s*true,\s*code:\s*200,\s*success:\s*true\s*\}\s*\)/);
});

test('song like endpoint writes to YouTube Music instead of fake success', () => {
  assert.match(serverSource, /async function likeYtmSong\(yt, videoId, liked\)/);
  assert.match(serverSource, /await likeYtmSong\(yt,\s*id,\s*nextLike\)/);
  assert.doesNotMatch(serverSource, /sendJSON\(res,\s*\{\s*loggedIn:\s*true,\s*id,\s*liked:\s*nextLike,\s*code:\s*200\s*\}\)/);
});

test('collect modal creates playlists with POST body', () => {
  assert.match(appSource, /apiJson\('\/api\/playlist\/create',\s*\{[\s\S]*method:\s*'POST'[\s\S]*JSON\.stringify\(\{\s*name:\s*name\s*\}\)/);
});

test('YouTube liked songs are labeled and counted from real playlist items', () => {
  assert.match(serverSource, /browseId === 'VLLM'/);
  assert.match(serverSource, /const title = isLikedSongs \? '点赞的歌曲'/);
  assert.match(serverSource, /function countYtmPlaylistItems\(yt, playlistId, limit\)/);
  assert.match(serverSource, /page\.getContinuation\(\)/);
  assert.match(serverSource, /countYtmPlaylistItems\(yt, browseId, 1200\)/);
  assert.doesNotMatch(serverSource, /let trackCount = 20/);
});

test('home page has listening-based recommendation row', () => {
  assert.match(indexSource, /id="home-recommend-row"/);
  assert.match(appSource, /function homePersonalRecommendations\(\)/);
  assert.match(appSource, /function renderHomeRecommendations\(\)/);
  assert.match(appSource, /function playHomeRecommendation\(index\)/);
  assert.match(appSource, /weatherCardTitle\) weatherCardTitle\.textContent = playlistItem \?/);
});

test('search playback immediately rebuilds queue from the selected song radio', () => {
  const fetchRadioSource = appSource.match(/async function fetchRadioSongsForSeed\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(appSource, /function isUsefulRadioSong\(song\)/);
  assert.match(appSource, /function primeQueueWithSeedRadio\(song,\s*attempt\)/);
  assert.match(appSource, /var seed = songProviderKey\(song\) === 'youtube' \? \(song\.id \|\| ''\) : ''/);
  assert.doesNotMatch(fetchRadioSource, /songProviderKey\(song\) !== 'youtube'/);
  assert.match(fetchRadioSource, /var title = song\.name \|\| ''/);
  assert.match(fetchRadioSource, /var artist = song\.artist \|\| ''/);
  assert.match(fetchRadioSource, /params\.push\('title=' \+ encodeURIComponent\(title\)\)/);
  assert.match(fetchRadioSource, /params\.push\('artist=' \+ encodeURIComponent\(artist\)\)/);
  assert.match(fetchRadioSource, /return \(\(r && r\.songs\) \|\| \[\]\)\.filter\(isUsefulRadioSong\)/);
  assert.match(appSource, /MineradioModules\.queueController\.createSearchSeedQueue\(song, cloneSong\)/);
  assert.match(appSource, /var seedSong = seedState\.seedSong;\s*playQueue = seedState\.queue;\s*currentIdx = seedState\.currentIdx;/);
  assert.match(appSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*true/);
  assert.match(appSource, /playQueueAt\(currentIdx\);\s*primeQueueWithSeedRadio\(seedSong\);/);
  assert.match(appSource, /maybeExtendQueueWithRadio\(song\)[\s\S]*currentIdx < playQueue\.length - 1/);
});

test('radio panel mapping reads nested YouTube Music fields and skips empty titles', () => {
  assert.match(serverSource, /function ytmText\(value\)/);
  assert.match(serverSource, /function ytmThumbnails\(value\)/);
  assert.match(serverSource, /const name = ytmText\(it\.title\) \|\| ytmText\(it\.name\)/);
  assert.match(serverSource, /if \(!name\) return null/);
  assert.match(serverSource, /const artists = ytmPeople\(it\.artists \|\| it\.authors \|\| it\.author \|\| it\.byline\)/);
});

test('search mapping recovers YouTube Music flex-column artists', () => {
  assert.match(serverSource, /function ytmRuns\(value\)/);
  assert.match(serverSource, /function ytmFlexColumnRuns\(item, index\)/);
  assert.match(serverSource, /function ytmArtistFallbackFromFlexColumns\(item, albumName\)/);
  assert.match(serverSource, /const fallbackArtist = ytmArtistFallbackFromFlexColumns\(item, albumName\)/);
  assert.match(serverSource, /const mappedArtists = artistList\.length \? artistList : \(fallbackArtist \? \[\{ id: '', name: fallbackArtist \}\] : \[\]\)/);
  assert.match(serverSource, /artist: artistStr \|\| fallbackArtist \|\| 'Unknown Artist'/);
  assert.match(serverSource, /artists: mappedArtists/);
  assert.match(serverSource, /artistId: mappedArtists\[0\] \? \(mappedArtists\[0\]\.id \|\| ''\) : ''/);
});

test('radio endpoint falls back to song search when up-next is sparse', () => {
  assert.match(serverSource, /function isValidRadioSong\(song\)/);
  assert.match(serverSource, /function isPlaceholderRadioText\(text\)/);
  assert.match(serverSource, /async function fillRadioWithSearchFallback\(songs, seen, seed, title, artist, limit\)/);
  assert.match(serverSource, /function radioSeedMatchesSong\(song, title, artist\)/);
  assert.match(serverSource, /async function findRadioSeedBySearch\(title, artist\)/);
  assert.match(serverSource, /const seedMatch = await findRadioSeedBySearch\(title, artist\)/);
  assert.match(serverSource, /const queries = seed \? exactQueries : artistQueries/);
  assert.match(serverSource, /const title = url\.searchParams\.get\('title'\) \|\| ''/);
  assert.match(serverSource, /const artist = url\.searchParams\.get\('artist'\) \|\| ''/);
  assert.match(serverSource, /if \(!id && !title && !artist\)/);
  assert.match(serverSource, /if \(!m \|\| !isValidRadioSong\(m\) \|\| seen\.has\(m\.id\)\) continue/);
  assert.match(serverSource, /songs: songs\.filter\(isValidRadioSong\)\.slice\(0, limit\)/);
  assert.match(serverSource, /if \(id\) \{[\s\S]*yt\.music\.getUpNext\(id, true\)/);
  assert.match(serverSource, /catch \(upNextErr\)/);
  assert.doesNotMatch(serverSource, /if \(!id\) \{ sendJSON\(res, \{ songs: \[\] \}\); return; \}/);
  assert.match(serverSource, /await fillRadioWithSearchFallback\(songs, seen, id, title, artist, limit\)/);
  assert.match(serverSource, /console\.log\('\[Radio\]'/);
});

test('music search and playlist refresh use YouTube Music only', () => {
  const fetchSearchSource = appSource.match(/async function fetchMusicSearchResults\(q, mode\) \{[\s\S]*?\n\}/)[0];
  const refreshPlaylistsSource = appSource.match(/async function refreshUserPlaylists\(force\) \{[\s\S]*?\n\}/)[0];
  assert.match(fetchSearchSource, /\/api\/search\?keywords=/);
  assert.doesNotMatch(fetchSearchSource, /\/api\/[a-z]+\/search/);
  assert.doesNotMatch(refreshPlaylistsSource, /\/api\/[a-z]+\/user\/playlists/);
  assert.match(appSource, /var startupLoginStatusPromise = Promise\.all\(\[refreshLoginStatus\(\)\]\)/);
  assert.match(appSource, /function alternatePlaybackProvider\(song\) \{\s*return 'youtube';\s*\}/);
  assert.match(appSource, /function songProviderKey\(song\) \{[\s\S]*return 'youtube';[\s\S]*\}/);
  assert.match(appSource, /apiJson\('\/api\/playlist\/tracks\?id=' \+ encodeURIComponent\(id\)\)/);
  assert.doesNotMatch(serverSource, /MINERADIO_ENABLE_[A-Z]+/);
});

test('queue rendering drops invalid unknown placeholder songs', () => {
  const queueSongSource = appSource.match(/function queueSong\(song, opts\) \{[\s\S]*?\n\}/)[0];
  const renderQueueSource = appSource.match(/function renderQueuePanel\(opts\) \{[\s\S]*?\n\}/)[0];
  const renderMiniQueueSource = appSource.match(/function renderMiniQueuePanel\(opts\) \{[\s\S]*?\n\}/)[0];
  const playQueueAtSource = appSource.match(/async function playQueueAt\(idx, opts\) \{[\s\S]*?markRenderInteraction/)[0];
  const primeRadioSource = appSource.match(/async function primeQueueWithSeedRadio\(song,\s*attempt\) \{[\s\S]*?\n\}/)[0];
  const applyRadioSource = appSource.match(/function applyRadioRecommendations\(seedSong, recs, opts\) \{[\s\S]*?\n\}/)[0];
  const extendRadioSource = appSource.match(/async function maybeExtendQueueWithRadio\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(appSource, /function isPlaceholderQueueText\(text\)/);
  assert.match(appSource, /function isValidQueueSong\(song\)/);
  assert.match(appSource, /function normalizePlayQueue\(reason\)/);
  assert.match(queueSongSource, /if \(!isValidQueueSong\(song\)\) return -1/);
  assert.match(renderQueueSource, /normalizePlayQueue\('render-queue-panel'\)/);
  assert.match(renderMiniQueueSource, /normalizePlayQueue\('render-mini-queue'\)/);
  assert.match(playQueueAtSource, /normalizePlayQueue\('play-queue-at'\)/);
  assert.match(applyRadioSource, /MineradioModules\.queueController\.mergeRadioRecommendations\(playQueue, currentIdx, seedSong, recs/);
  assert.match(queueControllerSource, /if \(!isValid\(song\) \|\| sameQueueSeedSong\(seedSong, song, opts\)\) return/);
  assert.match(extendRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*false/);
  assert.match(appSource + queueModuleSource, /unknownartist[\s\S]*variousartists[\s\S]*未知歌手/);
});

test('radio recommendations are inserted even when playback setup shifts queue state', () => {
  const primeRadioSource = appSource.match(/async function primeQueueWithSeedRadio\(song[\s\S]*?\n\}/)[0];
  const extendRadioSource = appSource.match(/async function maybeExtendQueueWithRadio\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(appSource, /function sameQueueSeedSong\(a, b\)/);
  assert.match(appSource, /function findQueueSeedIndex\(seedSong\)/);
  assert.match(appSource, /function applyRadioRecommendations\(seedSong, recs, opts\)/);
  assert.match(primeRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*true/);
  assert.match(primeRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*requireCurrent:\s*false/);
  assert.match(primeRadioSource, /scheduleRadioPrimeRetry\(song,\s*serial,\s*attempt/);
  assert.doesNotMatch(primeRadioSource, /!sameQueueSeedSong\(playQueue\[currentIdx\], song\)/);
  assert.doesNotMatch(primeRadioSource, /queueItemKey\(playQueue\[currentIdx\]\) !== seedKey/);
  assert.match(extendRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*false/);
});
