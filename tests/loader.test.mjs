import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';
import { test } from 'node:test';
import { fetchRacing, fetchWithProgress, fetchAllWithProgress } from '../public/src/engine/loader.js';

const decode = buffer => new TextDecoder().decode(buffer);

async function fixture(t) {
  const cancelled = new Set();
  const requested = new Set();
  const server = createServer((req, res) => {
    const key = req.url;
    requested.add(key);
    let timer;
    res.on('close', () => {
      clearTimeout(timer);
      if (!res.writableEnded) cancelled.add(key);
    });
    if (key === '/missing') return res.writeHead(404).end('missing');
    if (key === '/empty') return res.end();
    if (key === '/invalid') return res.end('wrong');
    if (key === '/hang') return;
    if (key === '/compressed') {
      const body = gzipSync('decoded payload '.repeat(100));
      return res.writeHead(200, { 'Content-Encoding': 'gzip', 'Content-Length': body.length }).end(body);
    }
    if (key === '/slow-body') {
      res.writeHead(200, { 'Content-Length': 4 });
      res.flushHeaders();
      timer = setTimeout(() => res.end('slow'), 500);
      return;
    }
    timer = setTimeout(() => res.end(key === '/invalid' ? 'wrong' : 'good'), key === '/fast' ? 20 : 350);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { url: route => base + route, requested, cancelled };
}

test('a completed fast body wins over the first candidate and cancels its request', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  let winner;
  assert.equal(decode(await fetchRacing([f.url('/slow-body'), f.url('/fast')], null, 0, {
    onWinner: url => { winner = url; },
  })), 'good');
  assert.equal(winner, f.url('/fast'));
  for (let i = 0; i < 40 && !f.cancelled.has('/slow-body'); i++) await new Promise(r => setTimeout(r, 5));
  assert.ok(f.cancelled.has('/slow-body'), 'the losing response must be disconnected');
});

test('a hanging candidate cannot block a successful candidate', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  assert.equal(decode(await fetchRacing([f.url('/hang'), f.url('/fast')], null, 0, { timeoutMs: 100 })), 'good');
});

test('HTTP errors and empty responses do not beat a valid fallback', async t => {
  const f = await fixture(t);
  assert.equal(decode(await fetchRacing([f.url('/missing'), f.url('/empty'), f.url('/fast')])), 'good');
});

test('all candidates failing or timing out produce an actionable error', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(fetchRacing([f.url('/hang'), f.url('/missing')], null, 0, { timeoutMs: 60 }), /All resource sources failed/);
});

test('a single source has the same timeout protection', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  await assert.rejects(fetchRacing([f.url('/hang')], null, 0, { timeoutMs: 60 }), /All resource sources failed/);
});

test('the backup is not downloaded when the preferred source completes within its head start', async t => {
  const f = await fixture(t);
  assert.equal(decode(await fetchRacing([f.url('/fast'), f.url('/slow')], null, 0, { fallbackDelayMs: 100 })), 'good');
  assert.ok(!f.requested.has('/slow'));
});

test('a failed preferred source starts the backup without waiting for its head start', async t => {
  const f = await fixture(t);
  const pending = fetchRacing([f.url('/missing'), f.url('/fast')], null, 0, { fallbackDelayMs: 5000 });
  assert.equal(decode(await pending), 'good');
  assert.ok(f.requested.has('/fast'));
});

test('a successful HTTP response with the wrong digest cannot win', async t => {
  const f = await fixture(t);
  const sha256 = createHash('sha256').update('good').digest('hex');
  assert.equal(decode(await fetchRacing([f.url('/invalid'), f.url('/fast')], null, 0, { sha256 })), 'good');
});

test('caller cancellation closes all outstanding attempts', { timeout: 2000 }, async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = fetchRacing([f.url('/hang')], null, 0, { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('caller cancellation also releases a backup that has not started', { timeout: 1000 }, async t => {
  const f = await fixture(t);
  const controller = new AbortController();
  const pending = fetchRacing([f.url('/hang'), f.url('/fast')], null, 0, {
    signal: controller.signal, fallbackDelayMs: 200,
  });
  controller.abort();
  const result = await Promise.race([
    pending.catch(error => error.name),
    new Promise(resolve => setTimeout(() => resolve('not cancelled'), 50)),
  ]);
  assert.equal(result, 'AbortError');
  assert.ok(!f.requested.has('/fast'));
});

test('compressed response lengths are not used as decoded progress totals', async t => {
  const f = await fixture(t);
  const progress = [];
  const body = await fetchWithProgress(f.url('/compressed'), (loaded, total) => progress.push([loaded, total]));
  assert.equal(decode(body), 'decoded payload '.repeat(100));
  assert.ok(progress.every(([loaded, total]) => total === 0 || loaded <= total));
});

test('independent resources are both returned and aggregate progress finishes accurately', async t => {
  const f = await fixture(t);
  const progress = [];
  const result = await fetchAllWithProgress([
    { key: 'wasm', urls: [f.url('/fast')], size: 4 },
    { key: 'model', urls: [f.url('/slow')], size: 4 },
  ], info => progress.push(info));
  assert.equal(decode(result.get('wasm')), 'good');
  assert.equal(decode(result.get('model')), 'good');
  assert.equal(progress.at(-1).overall, 8);
  assert.equal(progress.at(-1).overallTotal, 8);
});
