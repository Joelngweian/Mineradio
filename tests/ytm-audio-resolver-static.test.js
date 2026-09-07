const fs = require('fs');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const serverSource = fs.readFileSync(path.join(root, 'server-app.js'), 'utf8');

test('YTM audio resolver keeps a deciphered YouTube Music web client before legacy clients', () => {
  const clientsStart = serverSource.indexOf('const YTM_PLAYER_CLIENTS = [');
  const clientsEnd = serverSource.indexOf('const ytmFormatCache = new Map();');

  assert.notEqual(clientsStart, -1);
  assert.notEqual(clientsEnd, -1);
  assert.ok(clientsEnd > clientsStart);

  const clientBlock = serverSource.slice(clientsStart, clientsEnd);
  assert.match(clientBlock, /WEB_CREATOR_DECIPHER/);
  assert.match(clientBlock, /youtubeiClient:\s*'WEB_CREATOR'/);
  assert.ok(clientBlock.indexOf('WEB_CREATOR_DECIPHER') < clientBlock.indexOf('ANDROID_VR_1.43.32'));
});

test('YTM audio resolver uses youtubei getStreamingData for deciphered direct URLs', () => {
  assert.match(serverSource, /async function fetchYtmYoutubeiFormat/);
  assert.match(serverSource, /getYtmContentPoToken\(sid\)/);
  assert.match(serverSource, /Innertube\.create\(\{\s*cookie:\s*userCookie,\s*po_token:\s*poToken\s*\}\)/);
  assert.match(serverSource, /getStreamingData\(sid,\s*\{/);
  assert.match(serverSource, /po_token:\s*poToken/);
  assert.match(serverSource, /appendYtmPoToken\(resolved\.url,\s*poToken\)/);
  assert.match(serverSource, /resolved\.poToken\s*=\s*true/);
  assert.match(serverSource, /NO_DECIPHERED_AUDIO_URL/);
  assert.match(serverSource, /fetchYtmYoutubeiFormat\(sid,\s*clientDef\)/);
});

test('YTM audio resolver probes beyond cold-start bytes and avoids stale Android VR fallback', () => {
  assert.match(serverSource, /async function createYtmWebPoMinter/);
  assert.match(serverSource, /BotGuardClient/);
  assert.match(serverSource, /WebPoMinter/);
  assert.match(serverSource, /Range:\s*probeRange/);
  assert.match(serverSource, /poToken:\s*!!fmt\.poToken/);
  assert.match(serverSource, /client:\s*'WEB_CREATOR'/);
  assert.doesNotMatch(serverSource, /yt\.download\(sid,\s*\{\s*client:\s*'ANDROID_VR'/);
});
