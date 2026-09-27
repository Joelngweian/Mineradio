'use strict';

const DIAGNOSTICS_SCHEMA = 'mineradio-runtime-diagnostics/v1';
const MAX_UPDATE_JOBS = 6;

function boundedText(value, maxLength) {
  const text = String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function serviceState(service) {
  if (!service || typeof service.getState !== 'function') return { initialized: false };
  try {
    const state = service.getState() || {};
    return {
      initialized: true,
      clientReady: !!state.hasClient,
      requestMetadataReady: !!state.hasVisitorData,
      webPoReady: !!state.hasWebPo,
      domReady: !!state.hasDom,
      cachedFormats: Math.max(0, finiteNumber(state.cachedFormats, 0)),
    };
  } catch (_) {
    return { initialized: true, unavailable: true };
  }
}

function publicUpdateJob(job) {
  job = job || {};
  return {
    mode: boundedText(job.mode, 16),
    status: boundedText(job.status, 24),
    progress: Math.max(0, Math.min(100, finiteNumber(job.progress, 0))),
    attempt: Math.max(0, finiteNumber(job.attempt, 0)),
    attempts: Math.max(0, finiteNumber(job.attempts, 0)),
    updatedAt: Math.max(0, finiteNumber(job.updatedAt, 0)),
    error: boundedText(job.error, 180),
  };
}

function snapshotRuntimeDiagnostics(options) {
  options = options || {};
  const jobs = options.updateJobs && typeof options.updateJobs.values === 'function'
    ? Array.from(options.updateJobs.values())
    : [];
  const now = typeof options.now === 'function' ? options.now() : Date.now();
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    app: {
      version: boundedText(options.version, 64),
      provider: 'youtube',
    },
    login: {
      accountConfigured: !!options.hasCookie,
    },
    ytm: {
      session: serviceState(options.ytmSession),
      audio: serviceState(options.ytmAudioService),
    },
    updates: {
      jobs: jobs
        .sort((a, b) => finiteNumber(b.updatedAt, 0) - finiteNumber(a.updatedAt, 0))
        .slice(0, MAX_UPDATE_JOBS)
        .map(publicUpdateJob),
    },
  };
}

module.exports = {
  DIAGNOSTICS_SCHEMA,
  snapshotRuntimeDiagnostics,
};
