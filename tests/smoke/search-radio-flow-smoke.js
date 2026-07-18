'use strict';

const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..');
const publicRoot = path.join(root, 'public');
const sandbox = { window: {} };
vm.createContext(sandbox);

new vm.Script(fs.readFileSync(path.join(publicRoot, 'js/modules/queue-state.js'), 'utf8'), {
  filename: 'queue-state.js'
}).runInContext(sandbox);
new vm.Script(fs.readFileSync(path.join(publicRoot, 'js/modules/queue-controller.js'), 'utf8'), {
  filename: 'queue-controller.js'
}).runInContext(sandbox);

const controller = sandbox.window.MineradioModules.queueController;
const seed = { id: 'seed-track', name: 'Catch the Moment', artist: 'LiSA', cover: 'seed.jpg' };
const seedState = controller.createSearchSeedQueue(seed, song => Object.assign({ cloned: true }, song));

assert.equal(seedState.currentIdx, 0);
assert.equal(seedState.queue.length, 1);
assert.equal(seedState.queue[0].cloned, true);

const firstMerge = controller.mergeRadioRecommendations(seedState.queue, seedState.currentIdx, seed, [
  seed,
  { id: 'next-a', name: 'KANATA HALUKA', artist: 'RADWIMPS', cover: 'a.jpg' },
  { id: 'next-a', name: 'KANATA HALUKA duplicate', artist: 'RADWIMPS', cover: 'a2.jpg' },
  { id: 'next-b', name: 'Little Wish', artist: 'EGOIST', cover: 'b.jpg' }
], {
  replaceTail: true,
  isValidQueueSong: song => sandbox.window.MineradioModules.queueState.isValidQueueSong(song),
  hydrateCustomCover: song => Object.assign({ hydrated: true }, song)
});

assert.equal(firstMerge.added, 2);
assert.equal(firstMerge.queue.length, 3);
assert.equal(firstMerge.queue[1].id, 'next-a');
assert.equal(firstMerge.queue[1].hydrated, true);

const secondMerge = controller.mergeRadioRecommendations(firstMerge.queue, 0, seed, [
  { id: 'next-c', name: 'Suzume', artist: 'RADWIMPS', cover: 'c.jpg' }
], {
  replaceTail: false,
  isValidQueueSong: song => sandbox.window.MineradioModules.queueState.isValidQueueSong(song)
});

assert.equal(secondMerge.added, 1);
assert.equal(secondMerge.queue[1].id, 'next-c');
assert.equal(secondMerge.queue[2].id, 'next-a');

console.log('[search-radio-smoke] pass');
