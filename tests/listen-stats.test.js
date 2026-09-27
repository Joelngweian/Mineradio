const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'listen-stats.js')).href;

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('listen stats records effective sessions and ranks personalized recommendations', async () => {
  const { createListenStatsController } = await import(moduleUrl);
  const storage = createMemoryStorage();
  let now = 1_000;
  const audio = { duration: 100, currentTime: 0, paused: false };
  const firstSong = { id: 'first', name: 'First', artist: 'RADWIMPS', cover: 'first.jpg', duration: 100000 };
  const controller = createListenStatsController({
    storage,
    storageKey: 'listen-stats',
    now: () => now,
    getAudio: () => audio,
    getCurrentSong: () => firstSong,
    getActiveContext: () => ({ kind: 'search' }),
    songKey: (song) => song && song.id || '',
    snapshotSong: (song) => ({ ...song, key: song.id, source: 'YouTube Music' }),
    recordToSong: (record) => record && ({ ...record, id: record.id }),
    cloneSong: (song) => ({ ...song }),
    normalizeArtistName: (name) => String(name || '').toLowerCase(),
    artistMatchScore: (artist, artists) => artists.includes(String(artist || '').toLowerCase()) ? 1 : 0,
  });

  controller.begin(firstSong);
  now += 55_000;
  audio.currentTime = 55;
  controller.tick();
  const record = controller.finalize(false);

  assert.equal(record.name, 'First');
  assert.equal(record.context.kind, 'search');
  assert.equal(controller.summary().totalPlays, 1);
  assert.equal(controller.summary().topArtist.name, 'RADWIMPS');
  assert.equal(JSON.parse(storage.getItem('listen-stats')).history.length, 1);

  const recommendations = controller.recommendations([
    { id: 'other', name: 'Other', artist: 'Elsewhere' },
    { id: 'match', name: 'Matching Song', artist: 'RADWIMPS' },
  ]);
  assert.deepEqual(recommendations.map((song) => song.id), ['match', 'other', 'first']);
});

test('listen stats ignores short, incomplete playback sessions', async () => {
  const { createListenStatsController } = await import(moduleUrl);
  let now = 10;
  const audio = { duration: 300, currentTime: 0, paused: false };
  const song = { id: 'short', name: 'Short', artist: 'Artist' };
  const controller = createListenStatsController({
    now: () => now,
    getAudio: () => audio,
    getCurrentSong: () => song,
    songKey: (item) => item && item.id || '',
    snapshotSong: (item) => ({ ...item, key: item.id }),
  });

  controller.begin(song);
  now += 9_000;
  audio.currentTime = 9;
  controller.tick();
  assert.equal(controller.finalize(false), null);
  assert.equal(controller.summary().totalPlays, 0);
});
