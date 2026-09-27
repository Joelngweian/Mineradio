const test = require('node:test');
const assert = require('node:assert/strict');

const { createYtmSession } = require('../server/services/ytm-session');
const { createYtmAudioService } = require('../server/services/ytm-audio');
const { createRadioService } = require('../server/services/radio-service');
const { createYtmRouteHandler } = require('../server/routes/ytm-routes');

test('YTM route handler rejects an incomplete eager or lazy service configuration', () => {
  assert.throws(() => createYtmRouteHandler({
    getLoginInfo: async () => ({}),
    handleSongUrl: async () => ({}),
    sendJSON() {},
  }), /YTM_ROUTE_DEPENDENCIES_MISSING/);
});

test('YTM source and audio routes preserve one validated playback session ID', async () => {
  const response = {
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    writeHead(status) { this.status = status; },
    end() { this.ended = true; },
  };
  let sourcePayload = null;
  let audioRange = '';
  let audioSignal = null;
  const handler = createYtmRouteHandler({
    getLoginInfo: async () => ({ loggedIn: false }),
    handleSongUrl: async () => ({ url: 'ytm:video-id' }),
    getRadioService: () => ({ getRadioSongs: async () => ({ songs: [] }) }),
    getAudioService: () => ({
      resolveAudioFormat: async () => ({ client: 'WEB_CREATOR_DECIPHER', mime: 'audio/mp4' }),
      streamDirectFormat: async (res, format, range, options) => {
        audioRange = range;
        audioSignal = options && options.signal;
        res.writeHead(206);
        res.end();
      },
      invalidate() {},
      streamFallback: async () => {},
    }),
    sendJSON: (res, body, status) => { sourcePayload = { body, status: status || 200 }; },
    logger: { log() {}, warn() {}, error() {} },
  });
  const sessionId = 'pb_test_123456789';
  const request = { headers: { 'x-mineradio-playback-session': sessionId } };

  await handler({ req: request, res: response, url: new URL('http://localhost/api/song/url?id=video-id&ps=' + sessionId) });
  assert.equal(sourcePayload.status, 200);
  assert.equal(sourcePayload.body.playbackSession, sessionId);
  assert.equal(response.headers['x-mineradio-playback-session'], sessionId);

  await handler({
    req: { headers: { range: 'bytes=0-1023' } },
    res: response,
    url: new URL('http://localhost/api/audio?url=ytm%3Avideo-id&ps=' + sessionId),
  });
  assert.equal(audioRange, 'bytes=0-1023');
  assert.ok(audioSignal instanceof AbortSignal);
  assert.equal(audioSignal.aborted, false);
  assert.equal(response.status, 206);
  assert.equal(response.headers['x-mineradio-playback-session'], sessionId);
});

test('YTM session coalesces concurrent cookie-bound client initialization', async () => {
  let creates = 0;
  let cookie = 'SID=one';
  const Innertube = {
    create: async options => {
      creates += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return { options, session: { context: { client: { visitorData: 'visitor-one' } } } };
    },
  };
  const session = createYtmSession({
    Innertube,
    JSDOM: function FakeDom() {},
    fetch: async () => ({ ok: false, status: 500 }),
    getCookie: () => cookie,
  });

  const [first, second] = await Promise.all([session.getYTMusic(), session.getYTMusic()]);
  assert.equal(first, second);
  assert.equal(creates, 1);
  assert.equal(await session.getVisitorData(), 'visitor-one');
  cookie = 'SID=two';
  const third = await session.getYTMusic();
  assert.notEqual(third, first);
  assert.equal(creates, 2);
});

test('YTM audio service resolves a deciphered direct URL and appends its PO token', async () => {
  const audio = createYtmAudioService({
    Innertube: {
      create: async () => ({
        getStreamingData: async () => ({ mimeType: 'audio/mp4; codecs="mp4a.40.2"', url: 'https://audio.example/stream', itag: 140, bitrate: 128000, contentLength: '42' }),
      }),
    },
    requestJson: async () => ({}),
    getCookie: () => 'SID=one',
    getVisitorData: async () => '',
    getContentPoToken: async () => 'po-token',
    userAgent: 'test-agent',
  });

  const format = await audio.resolveAudioFormat('video-id');
  assert.equal(format.client, 'WEB_CREATOR_DECIPHER');
  assert.equal(format.mime, 'audio/mp4');
  assert.match(format.url, /[?&]pot=po-token/);
  assert.equal(format.contentLength, 42);
});

test('radio service keeps the seed out of sparse up-next fallback results', async () => {
  const radio = createRadioService({
    getYTMusic: async () => ({ music: { getUpNext: async () => ({ contents: [] }) } }),
    handleSearch: async () => [
      { id: 'seed', name: 'Seed', artist: 'Artist', cover: 'seed-cover' },
      { id: 'other', name: 'Other', artist: 'Artist', cover: 'other-cover' },
    ],
    mapPanelVideo: item => item,
  });

  const result = await radio.getRadioSongs({ id: 'seed', title: 'Seed', artist: 'Artist', limit: 6 });
  assert.equal(result.seed, 'seed');
  assert.equal(result.songs.some(song => song.id === 'seed'), false);
  assert.equal(result.songs.some(song => song.id === 'other'), true);
});
