'use strict';
// ====================================================================
//  CS2 游戏模式 — Valve Game State Integration (GSI) 接入
//  - CS2 通过本地配置文件把对局状态 POST 到 /api/gsi/cs2
//  - 这里把原始载荷归一化成 { running, inMatch, activity, roundPhase,
//    mapPhase, alive, spectating, health }，通过 SSE 推给渲染层
//  - 安装/检测 GSI 配置文件（复用 server-app 的 Steam 库定位）
//  安全说明：全程只读官方 GSI 载荷，不读取游戏内存、不注入，VAC 安全。
// ====================================================================
const fs = require('fs');
const path = require('path');

const CS2_COMMON_DIR = 'Counter-Strike Global Offensive';
const CFG_NAME = 'gamestate_integration_mineradio.cfg';
const STALE_MS = 30000;          // 超过此时长没收到 GSI，判定游戏已关闭
const STREAM_PING_MS = 15000;    // SSE 保活心跳
const DEFAULT_STEAM_ROOTS = [
  'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam',
  'D:\\Steam', 'D:\\SteamLibrary', 'E:\\Steam', 'E:\\SteamLibrary',
];

function emptyState() {
  return {
    game: 'cs2', running: false, inMatch: false, activity: '',
    roundPhase: '', mapPhase: '', alive: false, spectating: false,
    health: 0, ts: Date.now(),
  };
}

function toNumber(value) {
  const n = Number(value);
  return isNaN(n) ? 0 : n;
}

function createGsiService(deps) {
  deps = deps || {};
  const readSteamPathFromRegistry = deps.readSteamPathFromRegistry || (() => '');
  const parseSteamLibraryRoots = deps.parseSteamLibraryRoots || (() => []);

  let state = emptyState();
  let lastSeen = 0;
  const clients = new Set();

  // ---------- 配置文件 ----------
  function buildConfig(port) {
    const uri = 'http://127.0.0.1:' + (port || 3000) + '/api/gsi/cs2';
    return [
      '"Mineradio Game Mode"',
      '{',
      '  "uri"       "' + uri + '"',
      '  "timeout"   "5.0"',
      '  "buffer"    "0.1"',
      '  "throttle"  "0.1"',
      '  "heartbeat" "10.0"',
      '  "data"',
      '  {',
      '    "provider"     "1"',
      '    "map"          "1"',
      '    "round"        "1"',
      '    "player_id"    "1"',
      '    "player_state" "1"',
      '  }',
      '}',
      '',
    ].join('\r\n');
  }

  // ---------- CS2 cfg 目录定位（复用 Steam 库解析）----------
  function existsDir(p) {
    try { return !!p && fs.existsSync(p) && fs.statSync(p).isDirectory(); } catch (e) { return false; }
  }
  function cfgDirFromRoot(root) {
    return path.join(root, 'steamapps', 'common', CS2_COMMON_DIR, 'game', 'csgo', 'cfg');
  }
  function findCfgDir() {
    // 手动覆盖：MINERADIO_CS2_DIR 可直接指向 .../game/csgo/cfg，或指向 Steam 根
    const env = process.env.MINERADIO_CS2_DIR;
    if (env) {
      if (/cfg[\\/]*$/i.test(env) && existsDir(env)) return env;
      if (existsDir(cfgDirFromRoot(env))) return cfgDirFromRoot(env);
    }
    const roots = [];
    try { parseSteamLibraryRoots(readSteamPathFromRegistry()).forEach(r => roots.push(r)); } catch (e) {}
    DEFAULT_STEAM_ROOTS.forEach(r => roots.push(r));
    for (const root of Array.from(new Set(roots.filter(Boolean)))) {
      const cand = cfgDirFromRoot(root);
      if (existsDir(cand)) return cand;
    }
    return '';
  }

  // ---------- SSE ----------
  function sseWrite(res, obj) {
    try { res.write('event: state\ndata: ' + JSON.stringify(obj) + '\n\n'); } catch (e) {}
  }
  function broadcast() {
    clients.forEach(res => sseWrite(res, state));
  }
  function refreshStale() {
    if (state.running && lastSeen && (Date.now() - lastSeen) > STALE_MS) {
      state = emptyState();
      broadcast();
    }
  }
  const sweepTimer = setInterval(refreshStale, 5000);
  if (sweepTimer.unref) sweepTimer.unref();

  function attachStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    refreshStale();
    sseWrite(res, state);
    clients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, STREAM_PING_MS);
    const cleanup = () => { clearInterval(ping); clients.delete(res); };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
  }

  // ---------- 解析 GSI 载荷 ----------
  function handlePost(body) {
    body = body || {};
    const provider = body.provider || {};
    const player = body.player || {};
    const map = body.map || {};
    const round = body.round || {};
    const pstate = player.state || {};

    const mySteam = String(provider.steamid || '');
    const obsSteam = String(player.steamid || '');
    // 观战别人（steamid 不一致）说明本人已阵亡
    const spectating = !!(mySteam && obsSteam && mySteam !== obsSteam);
    const health = toNumber(pstate.health);
    const activity = String(player.activity || '');            // playing | menu | textinput
    const roundPhase = String(round.phase || '');              // live | freezetime | over
    const mapPhase = String(map.phase || '');                  // warmup | live | intermission | gameover
    const inMatch = !!(map && (map.name || map.mode));
    const alive = !spectating && health > 0;

    state = {
      game: 'cs2',
      running: true,
      inMatch: inMatch,
      activity: activity,
      roundPhase: roundPhase,
      mapPhase: mapPhase,
      alive: alive,
      spectating: spectating,
      health: health,
      ts: Date.now(),
    };
    lastSeen = state.ts;
    broadcast();
    return state;
  }

  function getState() {
    refreshStale();
    return Object.assign({}, state);
  }

  // ---------- 安装 / 检测 / 卸载 ----------
  function installStatus(port) {
    const dir = findCfgDir();
    const cfgPath = dir ? path.join(dir, CFG_NAME) : '';
    let installed = false;
    let portMatches = false;
    if (cfgPath) {
      try {
        installed = fs.existsSync(cfgPath);
        if (installed) {
          const txt = fs.readFileSync(cfgPath, 'utf8');
          portMatches = txt.indexOf(':' + (port || 3000) + '/api/gsi/cs2') >= 0;
        }
      } catch (e) {}
    }
    return {
      ok: true, found: !!dir, cfgDir: dir, cfgPath: cfgPath,
      installed: installed, portMatches: portMatches,
      running: state.running, cfgName: CFG_NAME,
    };
  }
  function install(port) {
    const dir = findCfgDir();
    if (!dir) {
      return {
        ok: false, error: 'CS2_NOT_FOUND', cfgName: CFG_NAME,
        cfgContent: buildConfig(port),
        message: '未找到 CS2 安装目录。请把配置文件手动放到 …/Counter-Strike Global Offensive/game/csgo/cfg/',
      };
    }
    const cfgPath = path.join(dir, CFG_NAME);
    try {
      fs.writeFileSync(cfgPath, buildConfig(port), 'utf8');
    } catch (e) {
      return { ok: false, error: 'WRITE_FAILED', cfgPath: cfgPath, message: e.message, cfgContent: buildConfig(port) };
    }
    return { ok: true, cfgPath: cfgPath, message: '已安装。请重启 CS2 使其生效。' };
  }
  function uninstall() {
    const dir = findCfgDir();
    const cfgPath = dir ? path.join(dir, CFG_NAME) : '';
    try {
      if (cfgPath && fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
    } catch (e) {
      return { ok: false, error: 'DELETE_FAILED', cfgPath: cfgPath, message: e.message };
    }
    return { ok: true, cfgPath: cfgPath };
  }

  return {
    handlePost: handlePost,
    getState: getState,
    attachStream: attachStream,
    installStatus: installStatus,
    install: install,
    uninstall: uninstall,
    buildConfig: buildConfig,
    findCfgDir: findCfgDir,
  };
}

module.exports = { createGsiService: createGsiService, CFG_NAME: CFG_NAME };
