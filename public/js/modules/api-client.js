  var DEFAULT_TIMEOUT_MS = 15000;

  function runtimeValue(name) {
    if (typeof globalThis !== 'undefined' && globalThis[name]) return globalThis[name];
    try {
      return globalThis && globalThis[name];
    } catch (e) {
      return null;
    }
  }

  function ApiError(code, message, details) {
    details = details || {};
    this.name = 'ApiError';
    this.code = String(code || 'API_ERROR');
    this.message = String(message || this.code);
    this.status = Number(details.status) || 0;
    this.statusText = String(details.statusText || '');
    this.url = String(details.url || '');
    this.body = details.body == null ? null : details.body;
    this.cause = details.cause || null;
    this.isTimeout = this.code === 'REQUEST_TIMEOUT';
    this.isAbort = this.code === 'REQUEST_ABORTED' || this.isTimeout;
    if (Error.captureStackTrace) Error.captureStackTrace(this, ApiError);
  }

  ApiError.prototype = Object.create(Error.prototype);
  ApiError.prototype.constructor = ApiError;

  function isAbortError(error) {
    return !!(error && (
      error.name === 'AbortError'
      || error.code === 'ABORT_ERR'
      || error.code === 'REQUEST_ABORTED'
      || error.code === 'REQUEST_TIMEOUT'
    ));
  }

  function makeError(code, message, details) {
    return new ApiError(code, message, details);
  }

  function timeoutValue(opts) {
    if (opts && Object.prototype.hasOwnProperty.call(opts, 'timeoutMs')) {
      var requested = Number(opts.timeoutMs);
      if (isFinite(requested) && requested >= 0) return requested;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  function responseMessage(body, fallback) {
    if (body && typeof body === 'object') {
      var message = body.message || body.error || body.msg || body.reason;
      if (typeof message === 'string' && message.trim()) return message.trim();
    }
    if (typeof body === 'string' && body.trim()) return body.trim();
    return fallback;
  }

  async function readResponseBody(res) {
    if (!res) return { value: null, parsed: false };
    if (typeof res.json === 'function') {
      try {
        return { value: await res.json(), parsed: true };
      } catch (jsonError) {
        if (typeof res.text === 'function') {
          try {
            return { value: await res.text(), parsed: false, error: jsonError };
          } catch (textError) {
            return { value: null, parsed: false, error: textError };
          }
        }
        return { value: null, parsed: false, error: jsonError };
      }
    }
    if (typeof res.text === 'function') {
      var text = await res.text();
      try {
        return { value: JSON.parse(text), parsed: true };
      } catch (parseError) {
        return { value: text, parsed: false, error: parseError };
      }
    }
    return { value: null, parsed: false };
  }

  function attachCallerAbort(signal, controller, markAborted) {
    if (!signal || !controller) return null;
    if (signal.aborted) {
      markAborted();
      controller.abort();
      return null;
    }
    if (typeof signal.addEventListener !== 'function') return null;
    var onAbort = function() {
      markAborted();
      controller.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return function() {
      if (typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort);
    };
  }

  async function apiJson(url, opts) {
    opts = opts || {};
    var timeoutMs = timeoutValue(opts);
    var fetchOpts = Object.assign({}, opts);
    var callerSignal = fetchOpts.signal || null;
    delete fetchOpts.timeoutMs;

    var Controller = runtimeValue('AbortController');
    var fetchFn = runtimeValue('fetch');
    var setTimer = runtimeValue('setTimeout');
    var clearTimer = runtimeValue('clearTimeout');
    if (!fetchFn) throw makeError('FETCH_UNAVAILABLE', '当前环境不支持网络请求', { url: url });
    if (callerSignal && callerSignal.aborted) {
      throw makeError('REQUEST_ABORTED', '请求已取消', { url: url });
    }

    var controller = null;
    var timer = null;
    var timedOut = false;
    var callerAborted = false;
    var removeCallerAbort = null;
    var timeoutPromise = null;

    if (timeoutMs > 0 && Controller) {
      controller = new Controller();
      fetchOpts.signal = controller.signal;
      removeCallerAbort = attachCallerAbort(callerSignal, controller, function() { callerAborted = true; });
      if (setTimer) {
        timer = setTimer(function() {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
      }
    } else if (timeoutMs > 0 && setTimer) {
      // Older WebViews may not expose AbortController. Promise.race still prevents
      // the caller from waiting forever, although the underlying request cannot be stopped.
      timeoutPromise = new Promise(function(_, reject) {
        timer = setTimer(function() {
          timedOut = true;
          reject(makeError('REQUEST_TIMEOUT', '请求超时，请稍后重试', { url: url }));
        }, timeoutMs);
      });
    }

    try {
      var fetchPromise = Promise.resolve().then(function() { return fetchFn(url, fetchOpts); });
      var res = timeoutPromise ? await Promise.race([fetchPromise, timeoutPromise]) : await fetchPromise;
      var body = await readResponseBody(res);
      var status = Number(res && res.status) || 0;
      var failed = res && (res.ok === false || status >= 400);
      if (failed) {
        var fallback = '请求失败' + (status ? '（HTTP ' + status + '）' : '');
        throw makeError('HTTP_ERROR', responseMessage(body.value, fallback), {
          status: status,
          statusText: res.statusText,
          url: url,
          body: body.value
        });
      }
      if (!body.parsed && body.value != null) {
        throw makeError('INVALID_JSON', '服务器返回的数据格式无效', {
          status: status,
          statusText: res && res.statusText,
          url: url,
          body: body.value,
          cause: body.error
        });
      }
      return body.value;
    } catch (error) {
      if (error && error.name === 'ApiError') throw error;
      if (timedOut) {
        throw makeError('REQUEST_TIMEOUT', '请求超时，请稍后重试', { url: url, cause: error });
      }
      if (callerAborted || (callerSignal && callerSignal.aborted) || isAbortError(error)) {
        throw makeError('REQUEST_ABORTED', '请求已取消', { url: url, cause: error });
      }
      throw makeError('NETWORK_ERROR', (error && error.message) || '网络请求失败，请检查网络后重试', {
        url: url,
        cause: error
      });
    } finally {
      if (timer !== null && clearTimer) clearTimer(timer);
      if (removeCallerAbort) removeCallerAbort();
    }
  }

export {
  DEFAULT_TIMEOUT_MS,
  ApiError,
  isAbortError,
  apiJson,
};
