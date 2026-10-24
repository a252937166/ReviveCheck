// Finalized head and runtime version over plain JSON-RPC, so the page header can
// show live chain state without loading the full chain client. While the socket
// is not live, the official explorer index supplies the finalized height.
// The last head this browser saw is shown at once, so the page never rests on "connecting".
const CACHE = (url) => `revivecheck.head.${url}`;
function cachedHead(url) {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE(url)) || 'null');
    return value && Date.now() - value.at < 6 * 3600_000 && Number.isSafeInteger(value.number) ? value : null;
  } catch { return null; }
}
export function watchNetwork(url, onUpdate, { explorerApi } = {}) {
  let socket, timer, poll, closed = false, attempt = 0, nextId = 0;
  const pending = new Map();
  const cached = cachedHead(url);
  const state = cached ? { status: 'cached', number: cached.number, hash: cached.hash, specName: cached.specName, specVersion: cached.specVersion } : { status: 'connecting', number: null, hash: null, specName: null, specVersion: null };
  const emit = (patch) => {
    Object.assign(state, patch);
    onUpdate({ ...state });
    if (['live', 'indexed'].includes(state.status) && state.hash) { try { localStorage.setItem(CACHE(url), JSON.stringify({ number: state.number, hash: state.hash, specName: state.specName, specVersion: state.specVersion, at: Date.now() })); } catch { /* a private window keeps it in memory only */ } }
  };
  if (cached) queueMicrotask(() => onUpdate({ ...state }));
  const call = (method, params = []) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
  });
  const runtime = (version) => emit({ specName: version?.specName ?? state.specName, specVersion: version?.specVersion ?? state.specVersion });
  async function head(header) {
    const number = Number.parseInt(header?.number, 16);
    if (!Number.isSafeInteger(number)) return;
    try { emit({ status: 'live', number, hash: await call('chain_getBlockHash', [number]) }); } catch { /* the next head retries */ }
  }
  function open() {
    try { socket = new WebSocket(url); } catch { return retry(); }
    socket.onopen = async () => {
      attempt = 0;
      try {
        runtime(await call('state_getRuntimeVersion'));
        await call('state_subscribeRuntimeVersion');
        await call('chain_subscribeFinalizedHeads');
      } catch { socket.close(); }
    };
    socket.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      if (data.id && pending.has(data.id)) {
        const request = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) request.reject(new Error(data.error.message)); else request.resolve(data.result);
      } else if (data.method === 'chain_finalizedHead') head(data.params?.result);
      else if (data.method === 'state_runtimeVersion') runtime(data.params?.result);
    };
    socket.onclose = () => {
      for (const request of pending.values()) request.reject(new Error('Disconnected'));
      pending.clear();
      if (!closed) retry();
    };
    socket.onerror = () => socket.close();
  }
  function retry() {
    emit({ status: 'reconnecting' });
    timer = setTimeout(open, Math.min(30_000, 1_000 * 2 ** attempt++));
  }
  async function indexed() {
    if (closed || state.status === 'live' || !explorerApi) return;
    const get = (path) => fetch(`${explorerApi}${path}`, { credentials: 'omit' }).then((response) => response.json());
    try {
      const runtimes = get('/runtimes').then((value) => {
        const latest = value?.items?.[0];
        if (!closed && state.status !== 'live' && !state.specVersion && latest?.specName && Number.isSafeInteger(latest?.specVersion)) emit({ specName: latest.specName, specVersion: latest.specVersion, runtimeSource: 'index' });
      }).catch(() => {});
      const overview = await get('/overview');
      const height = overview?.finalizedHeight;
      if (closed || state.status === 'live' || !Number.isSafeInteger(height)) return;
      // The height arrives first; the hash that links it follows from the block route.
      if (!Number.isSafeInteger(state.number) || height > state.number) emit({ status: 'indexed', number: height, hash: state.number === height ? state.hash : null });
      const block = await get(`/blocks/${height}`);
      if (!closed && state.status !== 'live' && block?.height === height && /^0x[0-9a-f]{64}$/i.test(block?.hash || '')) emit({ status: 'indexed', number: height, hash: block.hash });
      await runtimes;
    } catch { /* the socket or the next poll recovers */ }
  }
  open();
  poll = setInterval(indexed, 12_000);
  const first = setTimeout(indexed, 0);
  return () => { closed = true; clearTimeout(timer); clearTimeout(first); clearInterval(poll); socket?.close(); };
}
