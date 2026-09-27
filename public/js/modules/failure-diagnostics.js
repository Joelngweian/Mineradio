const REPORT_SCHEMA = 'mineradio-failure-diagnostic/v1';
const SENSITIVE_KEY = /(?:cookie|authorization|token|signature|sig|visitor|potoken|password|secret|url|location|origin|referer)/i;

function boundedText(value, maxLength) {
  const text = String(value == null ? '' : value)
    .replace(/https?:\/\/[^\s)]+/gi, '[url]')
    .replace(/([?&](?:token|sig|signature|key|cookie|authorization)=[^&\s]+)/gi, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function sanitize(value, depth) {
  const level = Number(depth) || 0;
  if (level > 7) return '[truncated]';
  if (typeof value === 'string') return boundedText(value, 320);
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 80).map((item) => sanitize(item, level + 1));
  if (typeof value === 'object') {
    return Object.keys(value).slice(0, 80).reduce((output, key) => {
      if (!SENSITIVE_KEY.test(key)) output[key] = sanitize(value[key], level + 1);
      return output;
    }, {});
  }
  return boundedText(value, 320);
}

function snapshotError(error) {
  error = error || {};
  return sanitize({
    name: error.name || 'Error',
    code: error.code || '',
    status: Number(error.status) || 0,
    message: error.message || error,
  });
}

function fileName(now) {
  const date = new Date(now || Date.now());
  const stamp = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('')
    + '-'
    + [String(date.getHours()).padStart(2, '0'), String(date.getMinutes()).padStart(2, '0'), String(date.getSeconds()).padStart(2, '0')].join('');
  return `mineradio-failure-diagnostic-${stamp}.json`;
}

function createFailureDiagnosticExporter(options) {
  options = options || {};
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const getTrace = typeof options.getTrace === 'function' ? options.getTrace : () => ({});
  const getContext = typeof options.getContext === 'function' ? options.getContext : () => ({});
  const apiJson = typeof options.apiJson === 'function' ? options.apiJson : null;
  const getDesktopApi = typeof options.getDesktopApi === 'function' ? options.getDesktopApi : () => null;
  let latestFailure = null;

  function recordFailure(stage, error, details) {
    latestFailure = sanitize({
      at: new Date(now()).toISOString(),
      stage: boundedText(stage || 'unknown', 96),
      error: snapshotError(error),
      details: details || {},
    });
    return latestFailure;
  }

  function buildReport(runtime) {
    return sanitize({
      schema: REPORT_SCHEMA,
      generatedAt: new Date(now()).toISOString(),
      failure: latestFailure || { stage: 'manual-export', error: null },
      client: getContext(),
      playback: getTrace(),
      runtime: runtime || { unavailable: true },
    });
  }

  async function loadRuntime() {
    if (!apiJson) return { unavailable: true, reason: 'RUNTIME_DIAGNOSTICS_UNAVAILABLE' };
    try {
      return await apiJson('/api/diagnostics/runtime', { timeoutMs: 2500 });
    } catch (error) {
      return { unavailable: true, error: snapshotError(error) };
    }
  }

  async function exportReport() {
    const report = buildReport(await loadRuntime());
    const text = JSON.stringify(report, null, 2);
    const name = fileName(now());
    const desktopApi = getDesktopApi();
    if (desktopApi && typeof desktopApi.exportJsonFile === 'function') {
      const result = await desktopApi.exportJsonFile({ defaultName: name, text });
      return { report, result: result || { ok: false, error: 'EXPORT_FAILED' } };
    }
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof document === 'undefined') {
      return { report, result: { ok: false, error: 'BROWSER_EXPORT_UNAVAILABLE' } };
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { report, result: { ok: true } };
  }

  return {
    buildReport,
    exportReport,
    recordFailure,
  };
}

export {
  REPORT_SCHEMA,
  createFailureDiagnosticExporter,
  fileName,
  sanitize,
};
