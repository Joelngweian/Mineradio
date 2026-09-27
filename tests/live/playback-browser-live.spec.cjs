'use strict';

const { expect, test } = require('@playwright/test');

const LIVE_QUERY = 'Catch the Moment LiSA';
const REQUIRED_PLAYBACK_STAGES = [
  'source-ready',
  'audio-src-set',
  'audio-play-request',
  'audio-play-resolved',
  'media-loadstart',
  'media-playing',
];

async function boot(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.body.classList.remove('splash-active', 'splash-revealing');
    const splash = document.getElementById('splash');
    if (splash) {
      splash.classList.add('hide');
      splash.style.display = 'none';
    }
  });
  await expect(page.locator('#search-input')).toBeVisible();
}

async function readLatestPlaybackTrace(page) {
  return page.evaluate(() => {
    const trace = window.__mineradioPlaybackTrace;
    const snapshot = trace && typeof trace.snapshot === 'function' ? trace.snapshot() : null;
    const session = snapshot && Array.isArray(snapshot.sessions) ? snapshot.sessions.at(-1) : null;
    return {
      sessionId: session && session.sessionId || '',
      stages: session && Array.isArray(session.events) ? session.events.map((event) => event.stage) : [],
    };
  });
}

function isApiRequest(request, pathname) {
  return new URL(request.url()).pathname === pathname;
}

test('real browser search playback resolves and plays through the local YTM proxy', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await boot(page);
  await page.locator('#search-input').fill(LIVE_QUERY);
  await expect.poll(() => page.locator('#search-results .search-result').count(), {
    timeout: 45_000,
  }).toBeGreaterThan(0);

  const sourceRequest = page.waitForRequest((request) => isApiRequest(request, '/api/song/url'), { timeout: 45_000 });
  const sourceResponse = page.waitForResponse((response) => isApiRequest(response.request(), '/api/song/url'), { timeout: 45_000 });
  const audioRequest = page.waitForRequest((request) => isApiRequest(request, '/api/audio'), { timeout: 75_000 });
  const audioResponse = page.waitForResponse((response) => isApiRequest(response.request(), '/api/audio'), { timeout: 75_000 });

  await page.locator('#search-results .search-result').first().locator('[data-action="search-play"]').click();

  const [resolvedSourceRequest, resolvedSourceResponse, resolvedAudioRequest, resolvedAudioResponse] = await Promise.all([
    sourceRequest,
    sourceResponse,
    audioRequest,
    audioResponse,
  ]);
  const source = await resolvedSourceResponse.json();
  const sourceSessionId = new URL(resolvedSourceRequest.url()).searchParams.get('ps');
  const audioSessionId = new URL(resolvedAudioRequest.url()).searchParams.get('ps');

  expect(resolvedSourceResponse.status()).toBe(200);
  expect(resolvedAudioResponse.status()).toBeGreaterThanOrEqual(200);
  expect(resolvedAudioResponse.status()).toBeLessThan(300);
  expect(sourceSessionId).toMatch(/^pb_/);
  expect(sourceSessionId).toBe(audioSessionId);
  expect(resolvedSourceRequest.headers()['x-mineradio-playback-session']).toBe(sourceSessionId);
  expect(source.playbackSession).toBe(sourceSessionId);
  expect(await resolvedSourceResponse.headerValue('x-mineradio-playback-session')).toBe(sourceSessionId);
  expect(await resolvedAudioResponse.headerValue('x-mineradio-playback-session')).toBe(sourceSessionId);

  await expect.poll(async () => {
    const trace = await readLatestPlaybackTrace(page);
    return trace.sessionId === sourceSessionId && REQUIRED_PLAYBACK_STAGES.every((stage) => trace.stages.includes(stage));
  }, { timeout: 75_000 }).toBe(true);

  const trace = await readLatestPlaybackTrace(page);
  expect(pageErrors).toEqual([]);

  console.log('[live-browser-playback] pass', JSON.stringify({
    sourceStatus: resolvedSourceResponse.status(),
    audioStatus: resolvedAudioResponse.status(),
    playbackSession: trace.sessionId,
    stages: trace.stages.filter((stage) => REQUIRED_PLAYBACK_STAGES.includes(stage)),
  }));
});
