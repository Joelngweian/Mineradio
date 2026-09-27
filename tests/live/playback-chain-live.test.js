'use strict';

const assert = require('node:assert/strict');
const { once } = require('node:events');
const test = require('node:test');

const { server } = require('../../server-app');

const LIVE_QUERY = 'Catch the Moment LiSA';
const REQUEST_TIMEOUT_MS = 45_000;
const PLAYBACK_SESSION_ID = 'pb_live_regression_123456789';

function requestTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

async function readJson(response, label) {
  assert.equal(response.status, 200, label + ' should return HTTP 200');
  const body = await response.json();
  assert.ok(body && typeof body === 'object', label + ' should return JSON');
  return body;
}

async function closeServer() {
  if (!server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

test.before(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
});

test.after(closeServer);

test('live playback chain resolves YTM search to a proxied Range audio response', { timeout: 90_000 }, async () => {
  const address = server.address();
  const baseUrl = 'http://127.0.0.1:' + address.port;

  const searchResponse = await requestTimeout(baseUrl + '/api/search?keywords=' + encodeURIComponent(LIVE_QUERY) + '&limit=3');
  const search = await readJson(searchResponse, 'YTM search');
  const songs = Array.isArray(search.songs) ? search.songs : [];
  const song = songs.find((item) => item && item.id && item.name && item.artist);
  assert.ok(song, 'YTM search should return a playable song with id, title, and artist');

  const sourceResponse = await requestTimeout(baseUrl + '/api/song/url?id=' + encodeURIComponent(song.id) + '&quality=standard&ps=' + PLAYBACK_SESSION_ID, {
    headers: { 'X-Mineradio-Playback-Session': PLAYBACK_SESSION_ID },
  });
  const source = await readJson(sourceResponse, 'YTM source resolution');
  assert.match(String(source.url || ''), /^ytm:[A-Za-z0-9_-]+$/, 'source resolution should return the production ytm: URL shape');
  assert.equal(source.playbackSession, PLAYBACK_SESSION_ID, 'source response should echo the playback session ID');
  assert.equal(sourceResponse.headers.get('x-mineradio-playback-session'), PLAYBACK_SESSION_ID, 'source response header should preserve the playback session ID');

  const audioResponse = await requestTimeout(baseUrl + '/api/audio?url=' + encodeURIComponent(source.url) + '&ps=' + PLAYBACK_SESSION_ID, {
    headers: { Range: 'bytes=0-1023' },
  });
  const audio = Buffer.from(await audioResponse.arrayBuffer());

  assert.equal(audioResponse.status, 206, 'audio proxy should preserve the requested Range response');
  assert.equal(audioResponse.headers.get('x-mineradio-playback-session'), PLAYBACK_SESSION_ID, 'audio response header should preserve the playback session ID');
  assert.match(audioResponse.headers.get('content-type') || '', /^audio\//i, 'audio proxy should return an audio Content-Type');
  assert.match(audioResponse.headers.get('content-range') || '', /^bytes 0-\d+\/\d+$/i, 'audio proxy should return Content-Range');
  assert.ok(audio.length >= 512, 'audio proxy should return real audio bytes');

  console.log('[live-playback] pass', JSON.stringify({
    searchStatus: searchResponse.status,
    sourceStatus: sourceResponse.status,
    audioStatus: audioResponse.status,
    contentType: audioResponse.headers.get('content-type') || '',
    bytes: audio.length,
  }));
});
