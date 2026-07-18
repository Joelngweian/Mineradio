const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const indexSource = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const packageSource = fs.readFileSync(path.join(root, 'package.json'), 'utf8');

function extractFunction(source, name) {
  const marker = 'function ' + name + '(';
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, name + ' should exist');
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, name + ' should have a body');
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(name + ' body was not closed');
}

test('update downloads probe candidate speed before choosing a line', () => {
  assert.match(serverSource, /const UPDATE_PROBE_BYTES = 512 \* 1024/);
  assert.match(serverSource, /async function probeUpdateCandidateSpeed\(candidate\)/);
  assert.match(serverSource, /Range': 'bytes=0-' \+ \(UPDATE_PROBE_BYTES - 1\)/);
  assert.match(serverSource, /async function prioritizeUpdateDownloadCandidates\(job, candidates\)/);
  assert.match(serverSource, /probed\.sort\(\(a, b\) => b\.probeSpeedBps - a\.probeSpeedBps\)/);
  assert.match(serverSource, /job\.sourceLabel = /);
  assert.match(serverSource, /await prioritizeUpdateDownloadCandidates\(job, baseCandidates\)/);
});

test('slow update downloads switch to the next candidate instead of waiting forever', () => {
  assert.match(serverSource, /const MIN_UPDATE_DOWNLOAD_SWITCH_BPS = 768 \* 1024/);
  assert.match(serverSource, /const UPDATE_SLOW_SWITCH_GRACE_MS = 8000/);
  assert.match(serverSource, /const UPDATE_SLOW_SWITCH_WINDOW_MS = 6000/);
  assert.match(serverSource, /function trackUpdateSlowDownload\(job, now\)/);
  assert.match(serverSource, /throw updateError\('UPDATE_LINE_TOO_SLOW'/);
  assert.match(serverSource, /job\.slowSince = 0/);
});

test('updater still keeps GitHub direct available when mirrors are configured', () => {
  assert.match(packageSource, /"mirrors": \[/);
  assert.match(serverSource, /label: directSet\.has\(url\.toLowerCase\(\)\)/);
  assert.match(serverSource, /mirrored\.concat\(direct\)/);
});

test('primary update action never starts the full installer automatically', () => {
  const source = extractFunction(indexSource, 'startUpdatePreviewDownload');
  assert.doesNotMatch(source, /startRealUpdateDownload\(\)/);
  assert.match(source, /startRealUpdatePatch\(\)/);
  assert.match(source, /openManualUpdateRelease\(/);
});

test('patch failure keeps the primary update action on patch or manual release paths', () => {
  const source = extractFunction(indexSource, 'syncUpdatePreviewStateClass');
  assert.doesNotMatch(source, /startRealUpdateDownload/);
  assert.match(indexSource, /function openManualUpdateRelease\(/);
  assert.match(indexSource, /patchFallbackTried/);
});

test('background update jobs convert async failures into visible job errors', () => {
  const installerSource = extractFunction(serverSource, 'startUpdateDownloadJob');
  assert.match(installerSource, /downloadUpdateAssetWithMirrors\(job\)\.catch\(/);
  assert.match(installerSource, /setUpdateJobError\(job, err,/);

  const patchSource = extractFunction(serverSource, 'startUpdatePatchJob');
  assert.match(patchSource, /downloadAndApplyPatchWithMirrors\(job\)\.catch\(/);
  assert.match(patchSource, /setUpdateJobError\(job, err,/);
});

test('patch updater uses only the mirror-aware patch download path', () => {
  assert.doesNotMatch(serverSource, /async function downloadAndApplyPatch\(job\)/);
  const source = extractFunction(serverSource, 'downloadAndApplyPatchWithMirrors');
  assert.match(source, /downloadPatchBufferFromCandidate\(job, candidate, i, candidates\.length\)/);
  assert.match(source, /applyPatchFilesWithRollback\(job, patch\.files\)/);
  assert.match(source, /job\.failedAttempts = failures\.slice\(-6\)/);
  assert.match(source, /setUpdateJobError\(job, err,/);
});

test('patch application restores backups when any file write fails', () => {
  const applySource = extractFunction(serverSource, 'applyPatchFilesWithRollback');
  assert.match(applySource, /try \{/);
  assert.match(applySource, /writePatchFile\(job, file\)/);
  assert.match(applySource, /rollbackPatchBackups\(job, changed\)/);
  assert.match(applySource, /throw err/);

  const rollbackSource = extractFunction(serverSource, 'rollbackPatchBackups');
  assert.match(rollbackSource, /UPDATE_PATCH_BACKUP_DIR/);
  assert.match(rollbackSource, /fs\.copyFileSync\(backup, target\)/);
  assert.match(rollbackSource, /job\.rollbackFiles = restored/);
});

test('server startup uses a testable utf8 console helper on Windows', () => {
  assert.match(serverSource, /function applyWindowsUtf8Console\(\)/);
  const source = extractFunction(serverSource, 'applyWindowsUtf8Console');
  assert.match(source, /process\.stdout\.setDefaultEncoding\('utf8'\)/);
  assert.match(source, /process\.stderr\.setDefaultEncoding\('utf8'\)/);
  assert.match(source, /chcp 65001/);
  assert.match(serverSource, /applyWindowsUtf8Console\(\);/);
});

test('release patch generator is wired into package scripts', () => {
  assert.match(packageSource, /"patch:release": "node build\/generate-release-patch\.js"/);
});
