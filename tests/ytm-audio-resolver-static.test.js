const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server-app.js'), 'utf8');
const audioSource = fs.readFileSync(path.join(root, 'server', 'services', 'ytm-audio.js'), 'utf8');
const sessionSource = fs.readFileSync(path.join(root, 'server', 'services', 'ytm-session.js'), 'utf8');
const routeSource = fs.readFileSync(path.join(root, 'server', 'routes', 'ytm-routes.js'), 'utf8');

test('YTM audio resolver keeps a deciphered YouTube Music web client before legacy clients', () => {
  const clientsStart = audioSource.indexOf('const YTM_PLAYER_CLIENTS = [');
  const clientsEnd = audioSource.indexOf('function createYtmAudioService');

  assert.notEqual(clientsStart, -1);
  assert.notEqual(clientsEnd, -1);
  assert.ok(clientsEnd > clientsStart);

  const clientBlock = audioSource.slice(clientsStart, clientsEnd);
  assert.match(clientBlock, /WEB_CREATOR_DECIPHER/);
  assert.match(clientBlock, /youtubeiClient:\s*'WEB_CREATOR'/);
  assert.ok(clientBlock.indexOf('WEB_CREATOR_DECIPHER') < clientBlock.indexOf('ANDROID_VR_1.43.32'));
});

test('YTM audio resolver uses youtubei getStreamingData for deciphered direct URLs', () => {
  assert.match(audioSource, /async function fetchYoutubeiFormat/);
  assert.match(audioSource, /getContentPoToken\(sid\)/);
  assert.match(audioSource, /Innertube\.create\(\{ cookie, po_token: poToken \}\)/);
  assert.match(audioSource, /getStreamingData\(sid,\s*\{/);
  assert.match(audioSource, /po_token: poToken/);
  assert.match(audioSource, /appendPoToken\(resolved\.url, poToken\)/);
  assert.match(audioSource, /resolved\.poToken\s*=\s*true/);
  assert.match(audioSource, /NO_DECIPHERED_AUDIO_URL/);
  assert.match(audioSource, /fetchYoutubeiFormat\(sid, clientDef\)/);
});

test('YTM audio resolver probes beyond cold-start bytes and avoids stale Android VR fallback', () => {
  assert.match(sessionSource, /async function createWebPoMinter/);
  assert.match(sessionSource, /BotGuardClient/);
  assert.match(sessionSource, /WebPoMinter/);
  assert.match(routeSource, /Range: probeRange/);
  assert.match(routeSource, /poToken: !!fmt\.poToken/);
  assert.match(audioSource, /client: 'WEB_CREATOR'/);
  assert.doesNotMatch(audioSource, /yt\.download\(sid,\s*\{\s*client:\s*'ANDROID_VR'/);
});
