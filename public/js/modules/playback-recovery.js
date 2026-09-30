const MAX_PLAYBACK_RECOVERY_ATTEMPTS = 1;

function normalizedText(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function errorStatus(error) {
  var status = Number(error && (error.status || error.statusCode));
  return Number.isFinite(status) ? status : 0;
}

function isCancelledError(error) {
  var name = normalizedText(error && error.name);
  var code = normalizedText(error && error.code);
  return name === 'ABORTERROR' || code === 'ABORT_ERR' || code === 'UPDATE_CANCELLED'
    || code === 'MEDIA_ERR_ABORTED';
}

function isAutoplayPolicyError(error) {
  return normalizedText(error && error.name) === 'NOTALLOWEDERROR';
}

function isMediaFailure(error) {
  var code = normalizedText(error && error.code);
  var numericCode = Number(error && error.code);
  return code === 'MEDIA_ERR_NETWORK' || code === 'MEDIA_ERR_DECODE' || code === 'MEDIA_ERR_SRC_NOT_SUPPORTED'
    || numericCode === 2 || numericCode === 3 || numericCode === 4;
}

function shouldRecoverPlaybackFailure(options) {
  options = options || {};
  var error = options.error || {};
  var attempt = Math.max(0, Number(options.attempt) || 0);
  var status = errorStatus(error);
  if (attempt >= MAX_PLAYBACK_RECOVERY_ATTEMPTS || options.restricted) return false;
  if (isCancelledError(error) || isAutoplayPolicyError(error)) return false;
  if (status >= 400 && status < 500 && status !== 403 && status !== 408 && status !== 429) return false;
  return isMediaFailure(error) || !status || status === 403 || status === 408 || status === 429 || status >= 500;
}

function recoveryDelayMs(nextAttempt) {
  return Math.min(1200, 450 + Math.max(1, Number(nextAttempt) || 1) * 200);
}

export {
  MAX_PLAYBACK_RECOVERY_ATTEMPTS,
  recoveryDelayMs,
  shouldRecoverPlaybackFailure,
};
