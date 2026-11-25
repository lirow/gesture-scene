/** Read the complete decoded body. Compressed Content-Length is not its size. */
export async function fetchWithProgress(url, onProgress, knownSize = 0, signal) {
  const response = await fetch(url, { credentials: 'same-origin', signal });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`HTTP ${response.status}: ${url}`);
  }
  const encoded = response.headers.get('content-encoding');
  const length = Number(response.headers.get('content-length')) || 0;
  let total = knownSize || (!encoded || encoded === 'identity' ? length : 0);
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    onProgress?.(buffer.byteLength, buffer.byteLength);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let loaded = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (total && loaded > total) total = 0;
      onProgress?.(loaded, total);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  onProgress?.(loaded, loaded);
  return bytes.buffer;
}

/** First complete, validated success wins; each source has its own deadline. */
export async function fetchRacing(urls, onProgress, knownSize = 0, options = {}) {
  if (!urls.length) throw new Error('No resource sources configured');
  const { timeoutMs = 60000, fallbackDelayMs = 0, sha256, signal, onWinner } = options;
  if (!(timeoutMs > 0) || !(fallbackDelayMs >= 0)) throw new RangeError('Invalid resource timeout or fallback delay');
  signal?.throwIfAborted();
  const controllers = urls.map(() => new AbortController());
  const timers = new Set();
  const gates = [];
  const started = new Set();
  let settled = false;
  let leaderLoaded = 0;
  const abortAll = () => {
    controllers.forEach(controller => controller.abort(signal?.reason));
    gates.forEach(resolve => resolve());
  };
  signal?.addEventListener('abort', abortAll, { once: true });
  const start = index => {
    if (index >= urls.length || started.has(index)) return;
    started.add(index);
    gates[index]();
  };
  const report = (loaded, total) => {
    if (settled || loaded < leaderLoaded) return;
    leaderLoaded = loaded;
    onProgress?.(loaded, total);
  };
  const attempts = urls.map((url, index) => (async () => {
    await new Promise(resolve => { gates[index] = resolve; });
    const controller = controllers[index];
    controller.signal.throwIfAborted();
    const deadline = setTimeout(() => controller.abort(new DOMException(`Resource timed out: ${url}`, 'TimeoutError')), timeoutMs);
    timers.add(deadline);
    try {
      const buffer = await fetchWithProgress(url, report, knownSize, controller.signal);
      if (!buffer.byteLength) throw new Error(`Empty resource: ${url}`);
      if (sha256) {
        const digest = await crypto.subtle.digest('SHA-256', buffer);
        const actual = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
        if (actual !== sha256.toLowerCase()) throw new Error(`SHA-256 mismatch: ${url}`);
      }
      controller.signal.throwIfAborted();
      return { buffer, url };
    } catch (error) {
      if (!settled) start(index + 1);
      throw error;
    } finally {
      clearTimeout(deadline);
      timers.delete(deadline);
    }
  })());
  start(0);
  for (let index = 1; index < urls.length; index++) {
    const timer = setTimeout(() => start(index), index * fallbackDelayMs);
    timers.add(timer);
  }
  try {
    const winner = await Promise.any(attempts);
    settled = true;
    onWinner?.(winner.url);
    return winner.buffer;
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    const details = error.errors?.map(cause => cause.message).join('; ') || error.message;
    throw new Error(`All resource sources failed: ${details}`, { cause: error });
  } finally {
    settled = true;
    timers.forEach(clearTimeout);
    abortAll();
    signal?.removeEventListener('abort', abortAll);
  }
}

/** Independent resources are all required; only their alternative URLs race. */
export async function fetchAllWithProgress(items, onProgress) {
  const controller = new AbortController();
  const state = new Map(items.map(item => [item.key, { loaded: 0, total: item.size || 0 }]));
  try {
    const results = await Promise.all(items.map(async item => {
      const buffer = await fetchRacing(item.urls, (loaded, total) => {
        state.set(item.key, { loaded, total });
        const values = [...state.values()];
        onProgress?.({
          key: item.key, label: item.label, loaded, total,
          overall: values.reduce((sum, entry) => sum + entry.loaded, 0),
          overallTotal: values.every(entry => entry.total > 0)
            ? values.reduce((sum, entry) => sum + entry.total, 0) : 0,
        });
      }, item.size || 0, { ...item.options, signal: controller.signal });
      return [item.key, buffer];
    }));
    return new Map(results);
  } finally {
    controller.abort();
  }
}

export function bufferToBlobUrl(buffer) {
  const url = URL.createObjectURL(new Blob([buffer], { type: 'application/wasm' }));
  return { url, dispose() { URL.revokeObjectURL(url); } };
}

export function formatBytes(value) {
  if (!value || value < 0) return '?';
  if (value < 1024) return `${value} B`;
  if (value < 1048576) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / 1048576).toFixed(1)} MB`;
}
