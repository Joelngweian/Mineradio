'use strict';

function createAbortError(code) {
  const error = new Error(code || 'CLIENT_DISCONNECTED');
  error.name = 'AbortError';
  error.code = code || 'CLIENT_DISCONNECTED';
  return error;
}

function isAbortError(error) {
  return !!error && (error.name === 'AbortError' || error.code === 'CLIENT_DISCONNECTED' || error.code === 'UPDATE_CANCELLED');
}

function abortReason(signal) {
  if (signal && signal.reason instanceof Error) return signal.reason;
  return createAbortError();
}

function throwIfAborted(signal) {
  if (signal && signal.aborted) throw abortReason(signal);
}

function createRequestAbortScope(request, response) {
  const controller = new AbortController();
  let disposed = false;

  function abortForDisconnect() {
    if (disposed || controller.signal.aborted || (response && (response.writableEnded || response.destroyed))) return;
    controller.abort(createAbortError());
  }

  if (request && typeof request.once === 'function') request.once('aborted', abortForDisconnect);
  if (response && typeof response.once === 'function') response.once('close', abortForDisconnect);

  return {
    signal: controller.signal,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (request && typeof request.removeListener === 'function') request.removeListener('aborted', abortForDisconnect);
      if (response && typeof response.removeListener === 'function') response.removeListener('close', abortForDisconnect);
    },
  };
}

function waitForWritable(response, signal) {
  if (!response || !response.writableNeedDrain) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      response.removeListener('drain', onDrain);
      response.removeListener('close', onClose);
      response.removeListener('error', onError);
      if (signal) signal.removeEventListener('abort', onAbort);
      callback(value);
    };
    const onDrain = () => finish(resolve);
    const onClose = () => finish(reject, createAbortError());
    const onError = error => finish(reject, error);
    const onAbort = () => finish(reject, abortReason(signal));
    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    if (response.destroyed || response.writableEnded) onClose();
    else throwIfAborted(signal);
  });
}

async function pipeWebBodyToResponse(response, body, signal) {
  if (!body || typeof body.getReader !== 'function') throw new Error('UPSTREAM_BODY_UNAVAILABLE');
  const reader = body.getReader();
  let completed = false;
  let cancelPromise = null;
  const cancelReader = () => {
    if (!cancelPromise) cancelPromise = Promise.resolve(reader.cancel()).catch(() => {});
    return cancelPromise;
  };
  const onAbort = () => { void cancelReader(); };
  if (signal) signal.addEventListener('abort', onAbort, { once: true });

  try {
    while (true) {
      throwIfAborted(signal);
      if (response.destroyed || response.writableEnded) throw createAbortError();
      const chunk = await reader.read();
      throwIfAborted(signal);
      if (chunk.done) {
        completed = true;
        return;
      }
      if (!response.write(Buffer.from(chunk.value))) await waitForWritable(response, signal);
    }
  } finally {
    if (signal) signal.removeEventListener('abort', onAbort);
    if (!completed) await cancelReader();
  }
}

module.exports = {
  createAbortError,
  createRequestAbortScope,
  isAbortError,
  pipeWebBodyToResponse,
  throwIfAborted,
  waitForWritable,
};
