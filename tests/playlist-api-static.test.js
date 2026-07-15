const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');

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
  assert.match(indexSource, /apiJson\('\/api\/playlist\/create',\s*\{[\s\S]*method:\s*'POST'[\s\S]*JSON\.stringify\(\{\s*name:\s*name\s*\}\)/);
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
  assert.match(indexSource, /function homePersonalRecommendations\(\)/);
  assert.match(indexSource, /function renderHomeRecommendations\(\)/);
  assert.match(indexSource, /function playHomeRecommendation\(index\)/);
  assert.match(indexSource, /weatherCardTitle\) weatherCardTitle\.textContent = playlistItem \?/);
});

test('search playback immediately rebuilds queue from the selected song radio', () => {
  const fetchRadioSource = indexSource.match(/async function fetchRadioSongsForSeed\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(indexSource, /function isUsefulRadioSong\(song\)/);
  assert.match(indexSource, /function primeQueueWithSeedRadio\(song,\s*attempt\)/);
  assert.match(indexSource, /var seed = songProviderKey\(song\) === 'youtube' \? \(song\.id \|\| ''\) : ''/);
  assert.doesNotMatch(fetchRadioSource, /songProviderKey\(song\) !== 'youtube'/);
  assert.match(fetchRadioSource, /var title = song\.name \|\| ''/);
  assert.match(fetchRadioSource, /var artist = song\.artist \|\| ''/);
  assert.match(fetchRadioSource, /params\.push\('title=' \+ encodeURIComponent\(title\)\)/);
  assert.match(fetchRadioSource, /params\.push\('artist=' \+ encodeURIComponent\(artist\)\)/);
  assert.match(fetchRadioSource, /return \(\(r && r\.songs\) \|\| \[\]\)\.filter\(isUsefulRadioSong\)/);
  assert.match(indexSource, /var seedSong = cloneSong\(song\);\s*playQueue = \[seedSong\];\s*currentIdx = 0;/);
  assert.match(indexSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*true/);
  assert.match(indexSource, /playQueueAt\(currentIdx\);\s*primeQueueWithSeedRadio\(seedSong\);/);
  assert.match(indexSource, /maybeExtendQueueWithRadio\(song\)[\s\S]*currentIdx < playQueue\.length - 1/);
});

test('radio panel mapping reads nested YouTube Music fields and skips empty titles', () => {
  assert.match(serverSource, /function ytmText\(value\)/);
  assert.match(serverSource, /function ytmThumbnails\(value\)/);
  assert.match(serverSource, /const name = ytmText\(it\.title\) \|\| ytmText\(it\.name\)/);
  assert.match(serverSource, /if \(!name\) return null/);
  assert.match(serverSource, /const artists = ytmPeople\(it\.artists \|\| it\.authors \|\| it\.author \|\| it\.byline\)/);
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

test('music search and playlist refresh use YouTube Music only by default', () => {
  const fetchSearchSource = indexSource.match(/async function fetchMusicSearchResults\(q, mode\) \{[\s\S]*?\n\}/)[0];
  const refreshPlaylistsSource = indexSource.match(/async function refreshUserPlaylists\(force\) \{[\s\S]*?\n\}/)[0];
  assert.match(indexSource, /var spotifySourceEnabled = false/);
  assert.match(fetchSearchSource, /\/api\/search\?keywords=/);
  assert.doesNotMatch(fetchSearchSource, /\/api\/spotify\/search/);
  assert.doesNotMatch(refreshPlaylistsSource, /\/api\/spotify\/user\/playlists/);
  assert.match(indexSource, /var startupLoginStatusPromise = Promise\.all\(\[refreshLoginStatus\(\)\]\)/);
  assert.match(indexSource, /if \(!spotifySourceEnabled\) \{[\s\S]*return spotifyLoginStatus;[\s\S]*function startSpotifyLoginStatusAutoRefresh/);
  assert.match(indexSource, /function alternatePlaybackProvider\(song\) \{\s*return 'youtube';\s*\}/);
  assert.match(indexSource, /songProviderKey\(song\) === 'spotify' && !spotifySourceEnabled[\s\S]*youtube-rematch[\s\S]*searchAlternatePlatformSong\(song\)/);
  assert.match(serverSource, /const SPOTIFY_SOURCE_ENABLED = process\.env\.MINERADIO_ENABLE_SPOTIFY === '1'/);
  assert.match(serverSource, /!SPOTIFY_SOURCE_ENABLED && \(pn\.startsWith\('\/api\/spotify\/'\) \|\| pn\.startsWith\('\/api\/auth\/spotify\/'\)\)/);
  assert.match(serverSource, /SPOTIFY_DISABLED/);
});

test('queue rendering drops invalid unknown placeholder songs', () => {
  const queueSongSource = indexSource.match(/function queueSong\(song, opts\) \{[\s\S]*?\n\}/)[0];
  const renderQueueSource = indexSource.match(/function renderQueuePanel\(opts\) \{[\s\S]*?\n\}/)[0];
  const renderMiniQueueSource = indexSource.match(/function renderMiniQueuePanel\(opts\) \{[\s\S]*?\n\}/)[0];
  const playQueueAtSource = indexSource.match(/async function playQueueAt\(idx, opts\) \{[\s\S]*?markRenderInteraction/)[0];
  const primeRadioSource = indexSource.match(/async function primeQueueWithSeedRadio\(song,\s*attempt\) \{[\s\S]*?\n\}/)[0];
  const applyRadioSource = indexSource.match(/function applyRadioRecommendations\(seedSong, recs, opts\) \{[\s\S]*?\n\}/)[0];
  const extendRadioSource = indexSource.match(/async function maybeExtendQueueWithRadio\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(indexSource, /function isPlaceholderQueueText\(text\)/);
  assert.match(indexSource, /function isValidQueueSong\(song\)/);
  assert.match(indexSource, /function normalizePlayQueue\(reason\)/);
  assert.match(queueSongSource, /if \(!isValidQueueSong\(song\)\) return -1/);
  assert.match(renderQueueSource, /normalizePlayQueue\('render-queue-panel'\)/);
  assert.match(renderMiniQueueSource, /normalizePlayQueue\('render-mini-queue'\)/);
  assert.match(playQueueAtSource, /normalizePlayQueue\('play-queue-at'\)/);
  assert.match(applyRadioSource, /if \(!isValidQueueSong\(s\) \|\| sameQueueSeedSong\(seedSong, s\)\) return/);
  assert.match(extendRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*false/);
  assert.match(indexSource, /unknownartist\|variousartists[\s\S]*未知歌手/);
});

test('radio recommendations are inserted even when playback setup shifts queue state', () => {
  const primeRadioSource = indexSource.match(/async function primeQueueWithSeedRadio\(song[\s\S]*?\n\}/)[0];
  const extendRadioSource = indexSource.match(/async function maybeExtendQueueWithRadio\(song\) \{[\s\S]*?\n\}/)[0];
  assert.match(indexSource, /function sameQueueSeedSong\(a, b\)/);
  assert.match(indexSource, /function findQueueSeedIndex\(seedSong\)/);
  assert.match(indexSource, /function applyRadioRecommendations\(seedSong, recs, opts\)/);
  assert.match(primeRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*true/);
  assert.match(primeRadioSource, /scheduleRadioPrimeRetry\(song,\s*serial,\s*attempt/);
  assert.doesNotMatch(primeRadioSource, /queueItemKey\(playQueue\[currentIdx\]\) !== seedKey/);
  assert.match(extendRadioSource, /applyRadioRecommendations\(song,\s*recs,\s*\{[\s\S]*replaceTail:\s*false/);
});
