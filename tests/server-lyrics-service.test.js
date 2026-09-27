const test = require('node:test');
const assert = require('node:assert/strict');

const { createLyricsService } = require('../server/services/lyrics-service');

test('lyrics service resolves an LrcLib timed lyric before lower-priority sources', async () => {
  const requests = [];
  const service = createLyricsService({
    requestJson: async (url) => {
      requests.push(url);
      return { syncedLyrics: '[00:00.00]Timed line', plainLyrics: 'Timed line' };
    },
    getYTMusic: async () => {
      throw new Error('YTM should not be used when LrcLib resolves a lyric');
    },
    userAgent: 'test-agent',
    logger: { log() {}, warn() {} },
  });

  const result = await service.resolve({ name: 'Example Song', artist: 'Example Artist', durationSec: 180 });
  assert.deepEqual(result, { lyric: '[00:00.00]Timed line', source: 'lrclib-get' });
  assert.equal(requests.length, 2);
  assert.ok(requests.some((url) => /lrclib\.net\/api\/get/.test(url)));
  assert.ok(requests.some((url) => /lrclib\.net\/api\/search/.test(url)));
});

test('lyrics service keeps translated LRC lines aligned by normalized original text', () => {
  const service = createLyricsService({ requestJson: async () => ({}), getYTMusic: async () => ({}), userAgent: 'test-agent' });
  const map = service.buildNeteaseTransMap('[00:01.00]Hello, world!\n[00:02.00]Second line', '[00:01.00]你好，世界！\n[00:02.00]第二行');
  assert.equal(map.helloworld, '你好，世界！');
  assert.equal(map.secondline, '第二行');
});

test('lyrics service keeps machine translation output one-to-one with input lines', async () => {
  const service = createLyricsService({
    requestJson: async (url) => {
      assert.match(url, /translate\.googleapis\.com/);
      return [[['第一行\n第二行']]];
    },
    getYTMusic: async () => ({}),
    userAgent: 'test-agent',
    logger: { warn() {} },
  });

  const result = await service.translate({ lines: ['first', 'second'], to: 'zh-CN' });
  assert.deepEqual(result, { translated: ['第一行', '第二行'], source: 'google' });
});

test('lyrics service falls back to YouTube Music when every external lyric lookup fails', async () => {
  const warnings = [];
  const service = createLyricsService({
    requestJson: async () => { throw new Error('upstream unavailable'); },
    getYTMusic: async () => ({
      music: {
        getLyrics: async (id) => ({ description: { text: `YouTube fallback for ${id}` } }),
      },
    }),
    userAgent: 'test-agent',
    logger: { log() {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  const result = await service.resolve({ name: 'Example Song', artist: 'Example Artist', videoId: 'video-123' });
  assert.deepEqual(result, { lyric: 'YouTube fallback for video-123', source: 'youtube' });
  assert.ok(warnings.some((message) => message.includes('NeteaseLyric')));
});

test('lyrics service returns an empty stable result when all lyric providers fail', async () => {
  const warnings = [];
  const service = createLyricsService({
    requestJson: async () => { throw new Error('network offline'); },
    getYTMusic: async () => { throw new Error('YTM offline'); },
    userAgent: 'test-agent',
    logger: { log() {}, warn: (...args) => warnings.push(args.join(' ')) },
  });

  const result = await service.resolve({ name: 'Unavailable Song', artist: 'Unavailable Artist', videoId: 'video-404' });
  assert.deepEqual(result, { lyric: '', source: 'empty' });
  assert.ok(warnings.some((message) => message.includes('Lyric YTM')));
});

test('lyrics service preserves input alignment when Google translation fails', async () => {
  const warnings = [];
  const service = createLyricsService({
    requestJson: async () => { throw new Error('translate timeout'); },
    getYTMusic: async () => ({}),
    userAgent: 'test-agent',
    logger: { warn: (...args) => warnings.push(args.join(' ')) },
  });

  const result = await service.translate({ lines: ['first', 'second', 'third'], to: 'zh-CN' });
  assert.deepEqual(result, { translated: ['', '', ''], source: 'google' });
  assert.ok(warnings.some((message) => message.includes('[Translate]')));
});

test('lyrics diagnostics reports upstream failures without discarding its result payload', async () => {
  const service = createLyricsService({
    requestJson: async () => { throw Object.assign(new Error('HTTP 503'), { statusCode: 503 }); },
    getYTMusic: async () => ({ music: { getLyrics: async () => ({ description: { text: 'Fallback lyric' } }) } }),
    userAgent: 'test-agent',
    logger: { log() {}, warn() {} },
  });

  const report = await service.debug({ name: 'Debug Song', artist: 'Debug Artist', id: 'debug-video' });
  assert.equal(report.steps.length, 2);
  assert.deepEqual(report.steps.map((step) => step.ok), [false, false]);
  assert.match(report.steps[0].error, /HTTP 503/);
  assert.deepEqual(report.result, { source: 'youtube', hasLyric: true, synced: false, preview: 'Fallback lyric' });
});
