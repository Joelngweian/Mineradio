'use strict';

// YouTube Music session state is deliberately isolated from HTTP routing.
// The service owns the cookie-bound Innertube client and WebPO token lifecycle.

function createYtmSession(options) {
  const {
    Innertube,
    JSDOM,
    fetch: fetchImpl = globalThis.fetch,
    userAgent,
    webUrl = 'https://www.youtube.com',
    webPoRequestKey = 'O43z0dpjhgX20SCx4KAo',
    getCookie = () => '',
    logger = console,
  } = options || {};

  if (!Innertube || !JSDOM || typeof fetchImpl !== 'function') {
    throw new Error('YTM_SESSION_DEPENDENCIES_MISSING');
  }

  let ytInstance = null;
  let lastCookieUsed = null;
  let ytInitPromise = null;
  let ytInitCookie = null;
  let visitorData = '';
  let visitorCookie = null;
  let bgutilsPromise = null;
  let webPoMinterState = null;
  let webPoMinterPromise = null;
  let activeDom = null;
  let savedDomGlobals = null;
  const poTokenCache = new Map();

  const DOM_GLOBAL_KEYS = ['window', 'document', 'location', 'origin', 'yt', 'navigator'];

  function currentCookie(customCookie) {
    return customCookie !== undefined ? String(customCookie || '') : String(getCookie() || '');
  }

  function resetCookieBoundState(cookie) {
    if (lastCookieUsed === cookie) return;
    clearDomGlobals();
    visitorData = '';
    visitorCookie = cookie;
    webPoMinterState = null;
    webPoMinterPromise = null;
    poTokenCache.clear();
  }

  async function getYTMusic(customCookie) {
    const cookie = currentCookie(customCookie);
    resetCookieBoundState(cookie);
    if (ytInstance && lastCookieUsed === cookie) return ytInstance;
    if (ytInitPromise && ytInitCookie === cookie) return ytInitPromise;

    ytInitCookie = cookie;
    ytInitPromise = (async () => {
      try {
        const instance = await Innertube.create({ cookie: cookie || undefined });
        ytInstance = instance;
        lastCookieUsed = cookie;
        return instance;
      } catch (error) {
        logger.warn('[YTM Engine Init Warning]', error && error.message || error);
        if (ytInstance && lastCookieUsed === cookie) return ytInstance;
        const fallback = await Innertube.create();
        ytInstance = fallback;
        lastCookieUsed = cookie;
        return fallback;
      } finally {
        ytInitPromise = null;
        ytInitCookie = null;
      }
    })();
    return ytInitPromise;
  }

  async function getVisitorData() {
    const cookie = currentCookie();
    if (visitorCookie !== cookie) resetCookieBoundState(cookie);
    if (visitorData) return visitorData;
    try {
      const yt = await getYTMusic();
      const value = yt && yt.session && yt.session.context && yt.session.context.client && yt.session.context.client.visitorData;
      if (value) visitorData = value;
    } catch (error) {
      logger.warn('[YTM VisitorData]', error && error.message || error);
    }
    return visitorData;
  }

  function cacheGet(map, key, valueSelector) {
    const hit = map.get(key);
    if (hit && Date.now() < hit.expiresAt) return valueSelector ? valueSelector(hit) : hit;
    if (hit) map.delete(key);
    return null;
  }

  async function loadBgutils() {
    if (!bgutilsPromise) {
      bgutilsPromise = Promise.all([
        import('bgutils-js/botguard'),
        import('bgutils-js/webpo'),
        import('bgutils-js/utils'),
      ]).then(([botguard, webpo, utils]) => ({
        BotGuardClient: botguard.BotGuardClient,
        WebPoMinter: webpo.WebPoMinter,
        buildURL: utils.buildURL,
        getHeaders: utils.getHeaders,
        parseLooseJSON: utils.parseLooseJSON,
        USER_AGENT: utils.USER_AGENT || userAgent,
      }));
    }
    return bgutilsPromise;
  }

  function patchDomForBotGuard(dom) {
    if (!dom || !dom.window) return;
    try {
      const canvasProto = dom.window.HTMLCanvasElement && dom.window.HTMLCanvasElement.prototype;
      if (canvasProto && !canvasProto.__mineradioPatched) {
        canvasProto.getContext = function() {
          return {
            fillRect() {}, clearRect() {}, getImageData() { return { data: new Uint8ClampedArray(4) }; },
            putImageData() {}, createImageData() { return []; }, setTransform() {}, drawImage() {},
            save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {},
            stroke() {}, translate() {}, scale() {}, rotate() {}, arc() {}, fill() {},
            measureText() { return { width: 0 }; }, transform() {}, rect() {}, clip() {},
            fillText() {}, strokeText() {},
          };
        };
        canvasProto.toDataURL = function() { return 'data:image/png;base64,'; };
        canvasProto.__mineradioPatched = true;
      }
    } catch (error) {}
  }

  function installDomGlobals(dom, ytConfig) {
    if (!dom || !dom.window) return;
    if (activeDom && activeDom !== dom && activeDom.window && typeof activeDom.window.close === 'function') {
      try { activeDom.window.close(); } catch (error) {}
    }
    if (!savedDomGlobals) {
      savedDomGlobals = new Map(DOM_GLOBAL_KEYS.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
    }
    activeDom = dom;
    patchDomForBotGuard(dom);
    if (ytConfig) {
      try { dom.window.yt = { config_: JSON.parse(ytConfig) }; } catch (error) {}
    }
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.location = dom.window.location;
    globalThis.origin = dom.window.origin;
    globalThis.yt = dom.window.yt || globalThis.yt || { config_: {} };
    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: dom.window.navigator,
        configurable: true,
        writable: true,
      });
    } catch (error) {}
  }

  function clearDomGlobals() {
    if (activeDom && activeDom.window && typeof activeDom.window.close === 'function') {
      try { activeDom.window.close(); } catch (error) {}
    }
    activeDom = null;
    if (!savedDomGlobals) return;
    savedDomGlobals.forEach((descriptor, key) => {
      try {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
      } catch (error) {}
    });
    savedDomGlobals = null;
  }

  function normalizeAttestationResponse(raw) {
    if (!raw) return null;
    const bg = raw.bgChallenge || raw.bg_challenge || raw;
    const interpreterUrl = bg.interpreterUrl || bg.interpreter_url || {};
    return {
      bgChallenge: {
        interpreterUrl: {
          privateDoNotAccessOrElseTrustedResourceUrlWrappedValue:
            interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue ||
            interpreterUrl.private_do_not_access_or_else_trusted_resource_url_wrapped_value ||
            '',
        },
        program: bg.program || '',
        globalName: bg.globalName || bg.global_name || '',
      },
    };
  }

  function getAttestationUrl(challengeResponse) {
    const wrapped = challengeResponse && challengeResponse.bgChallenge && challengeResponse.bgChallenge.interpreterUrl &&
      challengeResponse.bgChallenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
    if (!wrapped) return '';
    return wrapped.startsWith('//') ? 'https:' + wrapped : wrapped;
  }

  async function createWebPoMinter() {
    const { BotGuardClient, WebPoMinter, buildURL, getHeaders, parseLooseJSON, USER_AGENT } = await loadBgutils();
    const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
      url: webUrl,
      referrer: webUrl + '/',
      userAgent: USER_AGENT,
    });
    const cookie = currentCookie();
    const pageResp = await fetchImpl(webUrl, {
      headers: {
        accept: '*/*',
        'accept-language': 'en-US,en;q=0.7',
        'user-agent': USER_AGENT,
        ...(cookie ? { cookie } : {}),
      },
    });
    if (!pageResp.ok) throw new Error('WEBPO_PAGE_HTTP_' + pageResp.status);
    const pageHtml = await pageResp.text();
    const ytConfig = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)?.[1] || '';
    installDomGlobals(dom, ytConfig);

    const initialAttestationData = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
    let challengeResponse = null;
    let requestKey = webPoRequestKey;
    if (initialAttestationData) {
      const parsed = parseLooseJSON(initialAttestationData[1]);
      challengeResponse = normalizeAttestationResponse(parsed && parsed.R);
      requestKey = parsed && (parsed.requestKey || parsed.request_key) || requestKey;
    }
    if (!challengeResponse || !challengeResponse.bgChallenge || !challengeResponse.bgChallenge.program) {
      const yt = await getYTMusic(cookie);
      const fallbackChallenge = await yt.getAttestationChallenge('ENGAGEMENT_TYPE_UNBOUND');
      challengeResponse = normalizeAttestationResponse(fallbackChallenge);
      requestKey = fallbackChallenge && (fallbackChallenge.request_key || fallbackChallenge.requestKey) || requestKey;
    }
    if (!challengeResponse || !challengeResponse.bgChallenge || !challengeResponse.bgChallenge.program) {
      throw new Error('WEBPO_CHALLENGE_UNAVAILABLE');
    }

    const interpreterUrl = getAttestationUrl(challengeResponse);
    if (!interpreterUrl) throw new Error('WEBPO_INTERPRETER_URL_MISSING');
    const scriptResp = await fetchImpl(interpreterUrl, { headers: { 'user-agent': USER_AGENT } });
    if (!scriptResp.ok) throw new Error('WEBPO_INTERPRETER_HTTP_' + scriptResp.status);
    const interpreterJavascript = await scriptResp.text();
    if (!interpreterJavascript) throw new Error('WEBPO_INTERPRETER_EMPTY');
    new Function(interpreterJavascript)();

    const botGuardClient = await BotGuardClient.create({
      program: challengeResponse.bgChallenge.program,
      globalName: challengeResponse.bgChallenge.globalName,
      globalObject: globalThis,
    });
    const webPoSignalOutput = [];
    const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput }, 10000);
    if (!webPoSignalOutput[0]) throw new Error('WEBPO_SIGNAL_UNAVAILABLE');

    const integrityResp = await fetchImpl(buildURL('GenerateIT', true), {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify([requestKey, botguardResponse]),
    });
    if (!integrityResp.ok) throw new Error('WEBPO_INTEGRITY_HTTP_' + integrityResp.status);
    const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = await integrityResp.json();
    const minter = await WebPoMinter.create({ integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken }, webPoSignalOutput);
    const ttlMs = Math.max(5 * 60 * 1000, Math.min(Number(estimatedTtlSecs || 0) * 1000, 6 * 60 * 60 * 1000));
    return { minter, expiresAt: Date.now() + ttlMs };
  }

  async function getWebPoMinter(forceRefresh) {
    if (!forceRefresh && webPoMinterState && Date.now() < webPoMinterState.expiresAt - 60 * 1000) {
      return webPoMinterState.minter;
    }
    if (!webPoMinterPromise) {
      webPoMinterPromise = createWebPoMinter()
        .then((state) => {
          webPoMinterState = state;
          return state.minter;
        })
        .finally(() => { webPoMinterPromise = null; });
    }
    return webPoMinterPromise;
  }

  async function getContentPoToken(sid, forceRefresh) {
    const key = String(sid || '');
    if (!forceRefresh) {
      const cached = cacheGet(poTokenCache, key, hit => hit.token);
      if (cached) return cached;
    }
    try {
      const minter = await getWebPoMinter(!!forceRefresh);
      const token = await minter.mintAsWebsafeString(key);
      if (!token) throw new Error('WEBPO_TOKEN_EMPTY');
      const expiresAt = Math.min(
        webPoMinterState && webPoMinterState.expiresAt || (Date.now() + 30 * 60 * 1000),
        Date.now() + 35 * 60 * 1000,
      );
      poTokenCache.set(key, { token, expiresAt });
      if (poTokenCache.size > 300) poTokenCache.delete(poTokenCache.keys().next().value);
      return token;
    } catch (error) {
      if (!forceRefresh) return getContentPoToken(key, true);
      throw error;
    }
  }

  function clear() {
    ytInstance = null;
    lastCookieUsed = null;
    ytInitPromise = null;
    ytInitCookie = null;
    visitorData = '';
    visitorCookie = null;
    webPoMinterState = null;
    webPoMinterPromise = null;
    poTokenCache.clear();
    clearDomGlobals();
  }

  return {
    getYTMusic,
    getVisitorData,
    getContentPoToken,
    clear,
    getState: () => ({ hasClient: !!ytInstance, hasVisitorData: !!visitorData, hasWebPo: !!webPoMinterState, hasDom: !!activeDom }),
  };
}

module.exports = { createYtmSession };
