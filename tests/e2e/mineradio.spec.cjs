const { expect, test } = require('@playwright/test');

const SEARCH_SONG = {
  id: 'e2e-suzume',
  name: 'Suzume',
  artist: 'RADWIMPS',
  album: 'Suzume',
  duration: 240000,
  cover: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  source: 'ytmusic',
};

const RADIO_SONG = {
  id: 'e2e-next',
  name: 'Grand Escape',
  artist: 'RADWIMPS',
  album: 'Weathering With You',
  duration: 255000,
  cover: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==',
  source: 'ytmusic',
};

function createSilentWav(seconds) {
  const sampleRate = 8000;
  const sampleCount = sampleRate * seconds;
  const buffer = Buffer.alloc(44 + sampleCount, 128);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate, 28);
  buffer.writeUInt16LE(1, 32);
  buffer.writeUInt16LE(8, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(sampleCount, 40);
  return buffer;
}

const E2E_AUDIO = createSilentWav(30);

async function mockLocalApi(page) {
  const calls = { radio: 0, radioUrls: [] };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let payload = {};

    if (path === '/api/audio') {
      await route.fulfill({
        body: E2E_AUDIO,
        contentType: 'audio/wav',
        headers: { 'accept-ranges': 'bytes' },
      });
      return;
    }
    if (path === '/api/search' || path === '/api/search/youtube') payload = { songs: [SEARCH_SONG] };
    else if (path === '/api/radio') {
      calls.radio += 1;
      calls.radioUrls.push(url);
      payload = { songs: [RADIO_SONG] };
    }
    else if (path === '/api/song/url') payload = { url: 'data:audio/mpeg;base64,SUQz' };
    else if (path === '/api/lyric') payload = {
      lyric: '[00:00.00]The door opens\n[00:08.00]A new journey starts\n[00:16.00]We keep moving forward',
    };
    else if (path === '/api/playlist/user') payload = { playlists: [] };
    else if (path === '/api/login/status') payload = { loggedIn: false };
    else if (path === '/api/login/profile') payload = { loggedIn: false };
    else if (path === '/api/update/check') payload = { hasUpdate: false };

    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
  });
  return calls;
}

async function boot(page) {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const apiCalls = await mockLocalApi(page);
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
  return { apiCalls, pageErrors };
}

async function searchAndPlay(page) {
  await page.locator('#search-input').fill('Suzume');
  await expect(page.locator('#search-results .search-result')).toHaveCount(1);
  await page.locator('#search-results .search-result').first().locator('[data-action="search-play"]').click();
  await expect(page.locator('#thumb-title')).toHaveText('Suzume');
}

test('loads through the ES module entrypoint and keeps inline control bridge available', async ({ page }) => {
  const { pageErrors } = await boot(page);
  await expect.poll(() => page.evaluate(() => ({
    hasLegacyRegistry: Boolean(window.MineradioModules),
    hasPlaybackBridge: typeof window.togglePlay === 'function',
    hasLyricsBridge: typeof window.toggleFullLyrics === 'function',
    hasWallpaperBridge: typeof window.swapBackgroundWithTransition === 'function',
  }))).toEqual({
    hasLegacyRegistry: false,
    hasPlaybackBridge: true,
    hasLyricsBridge: true,
    hasWallpaperBridge: true,
  });
  expect(pageErrors).toEqual([]);
});

test('search playback uses its first song as the radio recommendation seed', async ({ page }) => {
  const { apiCalls } = await boot(page);
  await searchAndPlay(page);
  await expect.poll(() => apiCalls.radio, { timeout: 10_000 }).toBeGreaterThan(0);
  const radioUrl = apiCalls.radioUrls.at(-1);
  expect(radioUrl.searchParams.get('id')).toBe(SEARCH_SONG.id);
  expect(radioUrl.searchParams.get('title')).toBe(SEARCH_SONG.name);
  expect(radioUrl.searchParams.get('artist')).toBe(SEARCH_SONG.artist);
});

test('full lyrics opens as a single scrollable lyric column after playback', async ({ page }) => {
  await boot(page);
  await searchAndPlay(page);
  await expect.poll(() => page.locator('#full-lyrics-list .full-lyric-line').count()).toBeGreaterThan(1);
  await page.evaluate(() => window.toggleFullLyrics(true));
  await expect(page.locator('#full-lyrics-panel')).toHaveClass(/show/);
  await expect(page.locator('#full-lyrics-list')).toContainText('The door opens');
  await expect(page.locator('#full-lyrics-panel')).not.toContainText('接下来播放');
});
