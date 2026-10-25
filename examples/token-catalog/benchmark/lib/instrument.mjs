// A network tap for the fair benchmark. Both arms reach the chain through the same two
// transports: the global `fetch` (JSON-RPC over HTTPS to the official EVM endpoint) and the
// WsProvider of @polkadot/api (the official native node). Wrapping those two entry points
// in the benchmark process times every round trip of either arm the same way, including
// the WebSocket handshake and the metadata exchange that `ApiPromise.create` performs.
// Nothing else changes: the wrappers call through unmodified and return the same values.
//
// An `outage` switch rejects at this layer, so the "unavailable verification" scenario can
// be run live against both arms identically: every connection and every request fails as
// it would when both public nodes are unreachable. No node is touched in that mode.
import { performance } from 'node:perf_hooks';
import { WsProvider } from '@polkadot/api';

const originals = { fetch: globalThis.fetch, send: WsProvider.prototype.send, connect: WsProvider.prototype.connect };
const round = (ms) => Math.round(ms * 10) / 10;

/** Merge [start, end] intervals and return the covered length: time during which at least one network call was in flight. */
export function coveredMs(intervals) {
  const sorted = intervals.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
  let total = 0, current = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) { if (current) total += current[1] - current[0]; current = [start, end]; } else if (end > current[1]) current[1] = end;
  }
  if (current) total += current[1] - current[0];
  return total;
}

export function installNetworkTap() {
  const calls = [];
  const state = { scope: null, outage: false };
  const begin = (transport, method, target) => { const call = { scope: state.scope, transport, method, target, startedMs: performance.now(), endedMs: null, ms: null, ok: null, error: null }; calls.push(call); return call; };
  const finish = (call, ok, error = null) => { if (call.endedMs !== null) return; call.endedMs = performance.now(); call.ms = round(call.endedMs - call.startedMs); call.ok = ok; call.error = error; };

  globalThis.fetch = async function tappedFetch(input, init) {
    let method = 'fetch';
    try { method = JSON.parse(init?.body).method || method; } catch { /* not a JSON-RPC body */ }
    const call = begin('evm-rpc', method, typeof input === 'string' ? input : input?.url ?? String(input));
    if (state.outage) { finish(call, false, 'simulated outage'); throw new TypeError('simulated outage: fetch failed (benchmark injection)'); }
    try {
      const response = await originals.fetch(input, init);
      const body = await response.text(); // the whole round trip, body included
      finish(call, response.ok, response.ok ? null : `HTTP ${response.status}`);
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) { finish(call, false, String(error?.message || error)); throw error; }
  };
  WsProvider.prototype.send = async function tappedSend(method, params, ...rest) {
    const call = begin('native-ws', String(method), this.endpoint ?? null);
    try { const result = await originals.send.call(this, method, params, ...rest); finish(call, true); return result; } catch (error) { finish(call, false, String(error?.message || error)); throw error; }
  };
  WsProvider.prototype.connect = async function tappedConnect(...args) {
    const call = begin('native-ws', 'connect', this.endpoint ?? null);
    if (state.outage) { finish(call, false, 'simulated outage'); throw new Error('simulated outage: the native node is unreachable (benchmark injection)'); }
    // connect() returns as soon as the socket is created; the handshake ends at the `connected` event.
    let off = () => {};
    const offConnected = this.on('connected', () => { finish(call, true); off(); });
    const offError = this.on('error', (error) => { finish(call, false, String(error?.message || error || 'socket error')); off(); });
    off = () => { offConnected(); offError(); };
    try { return await originals.connect.apply(this, args); } catch (error) { finish(call, false, String(error?.message || error)); off(); throw error; }
  };

  function summarize(label, startedMs, endedMs) {
    const own = calls.filter((call) => call.scope === label);
    const clip = (call) => [Math.max(call.startedMs, startedMs), Math.min(call.endedMs ?? endedMs, endedMs)];
    const wallMs = endedMs - startedMs;
    const networkWaitMs = coveredMs(own.map(clip));
    const byTransport = {};
    for (const call of own) {
      const entry = (byTransport[call.transport] ||= { calls: 0, failed: 0, unfinished: 0, sumMs: 0 });
      entry.calls += 1; if (call.ok === false) entry.failed += 1; if (call.ok === null) entry.unfinished += 1; entry.sumMs = round(entry.sumMs + (call.ms ?? endedMs - call.startedMs));
    }
    const connect = own.find((call) => call.method === 'connect');
    return {
      wallMs: round(wallMs), networkWaitMs: round(networkWaitMs), computeMs: round(Math.max(0, wallMs - networkWaitMs)),
      networkCallSumMs: round(own.reduce((sum, call) => sum + (call.ms ?? endedMs - call.startedMs), 0)),
      connectMs: connect ? connect.ms ?? round(endedMs - connect.startedMs) : null,
      calls: own.length, failedCalls: own.filter((call) => call.ok === false).length,
      // A call still in flight when the arm closed its connection (for example a keep-alive health poll) is neither a success nor a failure.
      unfinishedCalls: own.filter((call) => call.ok === null).length, byTransport,
      callLog: own.map((call) => ({ transport: call.transport, method: call.method, atMs: round(call.startedMs - startedMs), ms: call.ms ?? round(endedMs - call.startedMs), ok: call.ok, ...(call.ok === null ? { note: 'in flight when the arm ended' } : {}), ...(call.error ? { error: call.error } : {}) })),
    };
  }

  return {
    calls,
    setOutage(flag) { state.outage = !!flag; },
    /** Run `work` under a label; every network call made meanwhile is attributed to it. */
    async scope(label, work) {
      state.scope = label;
      const startedMs = performance.now();
      try { const result = await work(); return { result, error: null, timing: summarize(label, startedMs, performance.now()) }; } catch (error) { return { result: null, error, timing: summarize(label, startedMs, performance.now()) }; } finally { state.scope = null; }
    },
    uninstall() { globalThis.fetch = originals.fetch; WsProvider.prototype.send = originals.send; WsProvider.prototype.connect = originals.connect; },
  };
}
