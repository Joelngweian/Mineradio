function runtimeFunction(options, name, fallback) {
  return options && typeof options[name] === 'function' ? options[name] : fallback;
}

function createResourceLifecycle(options) {
  options = options || {};
  var setTimer = runtimeFunction(options, 'setTimeout', setTimeout);
  var clearTimer = runtimeFunction(options, 'clearTimeout', clearTimeout);
  var requestIdle = runtimeFunction(options, 'requestIdleCallback', typeof requestIdleCallback === 'function' ? requestIdleCallback : null);
  var cancelIdle = runtimeFunction(options, 'cancelIdleCallback', typeof cancelIdleCallback === 'function' ? cancelIdleCallback : null);
  var requestFrame = runtimeFunction(options, 'requestAnimationFrame', typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  var cancelFrame = runtimeFunction(options, 'cancelAnimationFrame', typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
  var Controller = options.AbortController || (typeof AbortController === 'function' ? AbortController : null);
  var scopes = new Map();

  function createScope(name) {
    var key = String(name || 'default');
    var previous = scopes.get(key);
    if (previous) previous.dispose();

    var resources = new Set();
    var named = new Map();
    var isDisposed = false;

    function release(resource) {
      resources.delete(resource);
      if (resource.key && named.get(resource.key) === resource) named.delete(resource.key);
    }

    function register(keyName, cleanup) {
      if (keyName && named.has(keyName)) named.get(keyName).cancel();
      var resource = {
        key: keyName || '',
        active: true,
        cancel: function() {
          if (!resource.active) return;
          resource.active = false;
          try { cleanup(); } catch (error) {}
          release(resource);
        },
        finish: function() {
          if (!resource.active) return false;
          resource.active = false;
          release(resource);
          return true;
        },
      };
      if (isDisposed) {
        resource.cancel();
        return resource;
      }
      resources.add(resource);
      if (resource.key) named.set(resource.key, resource);
      return resource;
    }

    function timeout(callback, delay, keyName) {
      var id;
      var resource = register(keyName, function() { clearTimer(id); });
      if (!resource.active) return resource;
      id = setTimer(function() {
        if (!resource.finish()) return;
        callback();
      }, Math.max(0, Number(delay) || 0));
      return resource;
    }

    function idle(callback, timeoutMs, keyName) {
      if (!requestIdle || !cancelIdle) return timeout(callback, Math.min(Number(timeoutMs) || 160, 600), keyName);
      var id;
      var resource = register(keyName, function() { cancelIdle(id); });
      if (!resource.active) return resource;
      id = requestIdle(function(deadline) {
        if (!resource.finish()) return;
        callback(deadline);
      }, { timeout: Number(timeoutMs) || 1200 });
      return resource;
    }

    function frame(callback, keyName) {
      if (!requestFrame || !cancelFrame) return timeout(callback, 0, keyName);
      var id;
      var resource = register(keyName, function() { cancelFrame(id); });
      if (!resource.active) return resource;
      id = requestFrame(function(timestamp) {
        if (!resource.finish()) return;
        callback(timestamp);
      });
      return resource;
    }

    function abortController(keyName) {
      if (!Controller) return { signal: null, abort: function() {} };
      var controller = new Controller();
      var resource = register(keyName, function() { controller.abort(); });
      return {
        signal: controller.signal,
        abort: resource.cancel,
        release: resource.finish,
      };
    }

    function trackWorker(worker, onDispose, keyName) {
      return register(keyName, function() {
        try {
          if (worker && typeof worker.terminate === 'function') worker.terminate();
        } catch (error) {}
        if (typeof onDispose === 'function') onDispose();
      });
    }

    var scope = {
      timeout: timeout,
      idle: idle,
      frame: frame,
      abortController: abortController,
      trackWorker: trackWorker,
      dispose: function() {
        if (isDisposed) return;
        isDisposed = true;
        Array.from(resources).forEach(function(resource) { resource.cancel(); });
        if (scopes.get(key) === scope) scopes.delete(key);
      },
      disposed: function() { return isDisposed; },
    };
    scopes.set(key, scope);
    return scope;
  }

  return {
    createScope: createScope,
    dispose: function(name) {
      var scope = scopes.get(String(name || 'default'));
      if (scope) scope.dispose();
    },
    disposeAll: function() {
      Array.from(scopes.values()).forEach(function(scope) { scope.dispose(); });
    },
    scopeCount: function() { return scopes.size; },
  };
}

export {
  createResourceLifecycle,
};
