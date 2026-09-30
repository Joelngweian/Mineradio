const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const moduleUrl = pathToFileURL(path.join(__dirname, '..', 'public', 'js', 'modules', 'personalized-radio.js')).href;

test('personalized radio uses distinct listening seeds and never falls back to unrelated candidates', async () => {
  const { createPersonalizedRadioController } = await import(moduleUrl);
  const requests = [];
  const controller = createPersonalizedRadioController({
    songKey: (song) => song && song.id || '',
    artistKey: (song) => String(song && song.artist || '').toLowerCase(),
    isCandidateRelevant: (seed, song) => !/देवनागरी/.test(song.name),
    fetchRadio: async (seed) => {
      requests.push(seed.id);
      return seed.id === 'jp'
        ? [{ id: 'jp-next', name: 'Next Japanese', artist: 'RADWIMPS' }, { id: 'hi', name: 'देवनागरी', artist: 'Unrelated' }]
        : [{ id: 'en-next', name: 'Next English', artist: 'Coldplay' }];
    },
  });

  const state = await controller.load([
    { id: 'jp', name: 'Suzume', artist: 'RADWIMPS' },
    { id: 'jp-second', name: 'Sparkle', artist: 'RADWIMPS' },
    { id: 'en', name: 'Yellow', artist: 'Coldplay' },
  ]);

  assert.deepEqual(requests, ['jp', 'en']);
  assert.deepEqual(state.songs.map((song) => song.id), ['jp-next', 'en-next']);
});

test('personalized radio keeps a healthy seed result when another seed request fails', async () => {
  const { createPersonalizedRadioController } = await import(moduleUrl);
  const controller = createPersonalizedRadioController({
    songKey: (song) => song && song.id || '',
    artistKey: (song) => String(song && song.artist || '').toLowerCase(),
    fetchRadio: async (seed) => {
      if (seed.id === 'broken') throw new Error('temporary upstream failure');
      return [{ id: 'healthy-next', name: 'Healthy Next', artist: 'Artist B' }];
    },
  });

  const state = await controller.load([
    { id: 'broken', name: 'Broken', artist: 'Artist A' },
    { id: 'healthy', name: 'Healthy', artist: 'Artist B' },
  ]);

  assert.deepEqual(state.songs.map((song) => song.id), ['healthy-next']);
  assert.equal(state.error, '');
});
