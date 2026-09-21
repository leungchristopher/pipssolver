import test from 'node:test';
import assert from 'node:assert/strict';
import { puzzleApi, today } from '../server.mjs';

function response() {
  return { statusCode: 200, body: '', setHeader() {}, end(body: string) { this.body = body; } };
}

test('API rejects all date parameters', async () => {
  for (const date of ['', today(), '2026-09-20', '2026-99-99', '../secret']) {
    const res = response();
    await puzzleApi({ url: `/api/puzzle?date=${encodeURIComponent(date)}` }, res);
    assert.equal(res.statusCode, 400);
  }
});

test('API imports only today, strips answers, and reports failures', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async url => {
      assert.equal(url, `https://www.nytimes.com/svc/pips/v1/${today()}.json`);
      return new Response(JSON.stringify({ printDate: today(), hard: { dominoes: [[1, 2]], regions: [], solution: [[[0, 0], [0, 1]]] } }));
    };
    const res = response();
    await puzzleApi({ url: '/api/puzzle' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).solution, undefined);
    assert.equal(JSON.parse(res.body).date, today());
    globalThis.fetch = async () => new Response(JSON.stringify({ printDate: '2000-01-01', hard: {} }));
    const mismatch = response();
    await puzzleApi({ url: '/api/puzzle' }, mismatch);
    assert.equal(mismatch.statusCode, 502);
    globalThis.fetch = async () => new Response('Unavailable', { status: 503 });
    const failure = response();
    await puzzleApi({ url: '/api/puzzle' }, failure);
    assert.equal(failure.statusCode, 502);
  } finally { globalThis.fetch = original; }
});

test('today follows New York midnight', () => {
  assert.equal(today(new Date('2026-09-22T03:59:59Z')), '2026-09-21');
  assert.equal(today(new Date('2026-09-22T04:00:00Z')), '2026-09-22');
});
