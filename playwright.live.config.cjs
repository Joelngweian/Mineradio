const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/live',
  testMatch: 'playback-browser-live.spec.cjs',
  timeout: 120_000,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4311',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      args: [
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--autoplay-policy=no-user-gesture-required',
      ],
    },
  },
  webServer: {
    command: 'node tests/live/playback-live-server.cjs',
    url: 'http://127.0.0.1:4311',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
