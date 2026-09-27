  function runtimeValue(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    try {
      return globalThis && globalThis[name];
    } catch (e) {
      return null;
    }
  }

  function createPlaybackSessionManager() {
    var Controller = runtimeValue('AbortController');
    var token = 0;
    var controller = null;

  function createSessionId(sessionToken) {
    var stamp = Date.now().toString(36);
    var entropy = Math.floor(Math.random() * 0x100000000).toString(36);
    return 'pb_' + stamp + '_' + Number(sessionToken).toString(36) + '_' + entropy;
  }

    function abortCurrent() {
      if (!controller || typeof controller.abort !== 'function') return;
      try { controller.abort(); } catch (e) {}
    }

    function begin(meta) {
      abortCurrent();
      token += 1;
      controller = Controller ? new Controller() : null;
      var sessionToken = token;
      var sessionId = createSessionId(sessionToken);
      var signal = controller && controller.signal || null;
      return {
        token: sessionToken,
        id: sessionId,
        signal: signal,
        meta: meta || null,
        isCurrent: function() { return token === sessionToken; }
      };
    }

    function cancel() {
      abortCurrent();
      token += 1;
      controller = null;
      return token;
    }

    function isCurrent(sessionToken) {
      return Number(sessionToken) === token;
    }

    function currentSignal() {
      return controller && controller.signal || null;
    }

    return {
      begin: begin,
      cancel: cancel,
      isCurrent: isCurrent,
      currentSignal: currentSignal,
      currentToken: function() { return token; }
    };
  }

export {
  createPlaybackSessionManager as create,
};
