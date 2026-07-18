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
  ['updatePanel', 'js/modules/update-panel.js'],
  ['homeRecommendations', 'js/modules/home-recommendations.js']
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
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMode('shuffle'), 'shuffle');
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMode('bad'), 'off');
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateMinutes(999), 60);
  assert.equal(sandbox.window.MineradioModules.wallpaperState.normalizeRotateTransition('bad'), 'crossfade');
  assert.equal(sandbox.window.MineradioModules.homeRecommendations.normalizeArtistNameForMatch('RADWIMPS + Toaka'), 'radwimpstoaka');
  assert.equal(sandbox.window.MineradioModules.homeRecommendations.artistMatchScore('RADWIMPS feat. Toaka', ['radwimps']), 1);
});

test('main app delegates moved helpers through MineradioModules', () => {
  assert.match(indexSource, /var MineradioModules = window\.MineradioModules \|\| \(window\.MineradioModules = \{\}\);/);
  assert.match(indexSource, /MineradioModules\.queueState\.queueTextKey\(text\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isPlaceholderQueueText\(text\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isValidQueueSong\(song\)/);
  assert.match(indexSource, /MineradioModules\.queueState\.isUsefulRadioSong\(song\)/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.formatUpdateBytes\(bytes\)/);
  assert.match(indexSource, /MineradioModules\.updatePanel\.formatUpdateSpeed\(bytesPerSecond\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateMode\(mode\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateMinutes\(value\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.normalizeRotateTransition\(t\)/);
  assert.match(indexSource, /MineradioModules\.wallpaperState\.transitionLabel\(t\)/);
  assert.match(indexSource, /MineradioModules\.homeRecommendations\.normalizeArtistNameForMatch\(name\)/);
  assert.match(indexSource, /MineradioModules\.homeRecommendations\.artistMatchScore\(/);
});
