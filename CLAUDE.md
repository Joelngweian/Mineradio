# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Mineradio is a Windows-only Electron desktop music player (immersive visuals: weather radio, lyric stage, WebGL particle presets, 3D playlist shelf). The renderer is served by a local Node HTTP server that the Electron main process boots on startup. Music comes from YouTube Music (via `youtubei.js`) with Spotify used for metadata only.

## Commands

```powershell
npm install            # first-time / after dependency changes
npm start              # launch the app (electron .) — boots server.js + main window
npm run build:win      # NSIS installer -> dist/Mineradio-<version>-Setup.exe
npm run build:win:dir  # unpacked build only (faster, no installer)
```

There is **no test suite**. After changing code, verify with:

```powershell
node --check server.js
node --check desktop/main.js
git diff --check
```

Then confirm behavior by actually running the app — most features (audio streaming, YTM search, lyrics, account info) need live network **and the user's real Google/Spotify login**, so they cannot be validated by static checks or in an isolated environment.

### Editing gotcha (important)

Large-file edits to `server.js` on this mount have repeatedly truncated the file tail. After any sizeable edit to `server.js`, run `node --check server.js` and confirm the file still ends with the `server.listen(...)` / `module.exports = server;` block.

## Architecture

**Process model.** `desktop/main.js` (Electron main) finds a free port from 3000, sets env (`PORT`, `COOKIE_FILE`, `SPOTIFY_COOKIE_FILE`, `MINERADIO_UPDATE_DIR`), then `require`s `server.js` in-process (not a child process) and loads `http://127.0.0.1:<port>` into a frameless, transparent `BrowserWindow`. Single-instance lock; window/fullscreen state is pushed to the renderer over IPC.

**Server routing.** `server.js` is a **raw `http.createServer`, not Express.** The whole request handler is one long chain of `if (pn === '/api/...') { ... return; }` checks against `url.pathname`, ending in a static-file fallback that serves `public/`. To add an endpoint, insert another `if` block before the static fallback near the bottom of the file. Routes will not be found by grepping for `app.get(...)`.

**YouTube Music engine.** Built Metrolist-style on `youtubei.js` (`Innertube`). Two things are load-bearing and must not be removed:
- `Platform.shim.eval = ...vm.runInNewContext(...)` injected at the top of `server.js` — enables YouTube signature decryption in Node (without it: `No valid URL to decipher`).
- `/api/audio` proxies `ytm:<videoId>`: it resolves a plaintext direct URL via the `ANDROID_VR` client (PoToken-free), transparently forwards `Range` for seek during playback, uses **chunked Range GETs for full downloads** (beat analysis) to dodge Google throttling, and falls back to `yt.download()`. Never route audio back through the removed Netease/QQ logic.

**Spotify.** Metadata/account only (no direct stream). `sp_dc` cookie → `get_access_token` (with community TOTP params in `spotifyTotpSecretBytes()`, refresh when Spotify rotates) → Web API. Playback matches a track to YTM via `matchSpotifyTrackToYTM()` and returns `ytm:<id>`.

**Lyrics.** `resolveLyrics()` is a multi-source waterfall: LrcLib primary (matched by title/artist/album/duration for timeline accuracy), Netease for CJK coverage/translation, YTM plaintext as last resort. Translation lives at `/api/lyric/translate`.

**Login/cookies.** Handled in the main process: separate Electron session partitions open a real login `BrowserWindow`, cookies are harvested and written to `.cookie` (Google) and `.spotify-cookie` (Spotify) under `app.getPath('userData')`. `server.js` reads those files.

**Frontend.** `public/index.html` is ~27k lines and contains essentially the entire app: UI, CSS, WebGL particle system, 3D playlist shelf, lyric stage, visual presets, and the DIY visual console. **Always locate the existing function/state with grep before editing; never bulk-rewrite sections.** Provider keys were migrated `netease/qq → youtube/spotify`; `songProviderKey()` and the `qq:`/`spotify:` playlist-id prefixes keep old local data parsing — do not remove those compatibility branches.

**Other pieces.**
- `dj-analyzer.js` — server-side BPM/onset/energy analysis for podcasts and DJ tracks.
- Overlay windows: `public/desktop-lyrics.html` and `public/wallpaper.html`, each via `desktop/overlay-preload.js`. The wallpaper window attaches to the Windows WorkerW layer via an inline PowerShell script.
- `desktop/preload.js` exposes the `window.desktopWindow` IPC bridge (window controls, account login, hotkeys, desktop-lyrics/wallpaper toggles, JSON export/import).
- Updates: GitHub Releases. `/api/update/*` downloads the full installer; `/api/update/patch` applies lightweight patch JSON, sandboxed to `PATCH_ALLOWED_ROOTS` / `PATCH_ALLOWED_FILES`.
- Build: `electron-builder` NSIS, `asar: false`, custom dark installer via `build/installer.nsh`, `afterPack: build/after-pack.js`.

## Project rules & memory (read these)

Authoritative, project-specific guidance beyond this file lives in:
- `AGENTS.md` — repository rules, release workflow, guardrails, user preferences.
- `docs/PROJECT_MEMORY.md` — long-running decisions and "do not regress" boundaries (music-source rewrite, installer path safety, 3D shelf/lyric/visual constraints).
- `AI_HANDOFF.md` — dated work log.
- Fragile visual subsystems have dedicated docs: `docs/GLASS_SVG_TEXTURE.md`, `docs/3D_PLAYLIST_SHELF_MEMORY.md`, `docs/DESKTOP_LYRICS_VISUAL.md`, `docs/INSTALLER_STYLE.md`.

Note: `AGENTS.md` / the memory docs describe the repo at an older path (`E:\...\resources\app`); the live checkout here is `J:\Mineradio`. Treat the paths as historical, the rules as current.

Non-obvious working conventions from those files:
- Communicate with the user in **Chinese**; act and verify rather than only proposing.
- **Do not push/commit to GitHub or publish a Release unless the user explicitly asks.** Report clearly what was committed vs. left as local ignored artifacts.
- Do not regress known-good visuals (glass SVG console texture, particle presets, 3D shelf feel) or reintroduce one-shot full-list rendering for search results / playlists / the shelf.
- `dist/`, `updates/`, `backups/`, `node_modules/`, `yt-cache/` are git-ignored working areas.
