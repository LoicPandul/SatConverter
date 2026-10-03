// Tests for ui/history.js — run with: node --test tests/
'use strict';

process.env.TZ = 'Europe/Paris'; // deterministic local time, with DST

const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../ui/history.js');

function withTz(tz, fn) {
  const prev = process.env.TZ;
  process.env.TZ = tz;
  try { fn(); } finally { process.env.TZ = prev; }
}

test('parseLocal reads datetime-local values as local time', () => {
  assert.equal(H.parseLocal('2025-03-15T14:37'), Date.UTC(2025, 2, 15, 13, 37)); // UTC+1
  assert.equal(H.parseLocal('2025-07-15T14:37'), Date.UTC(2025, 6, 15, 12, 37)); // UTC+2
  assert.equal(H.parseLocal('2025-03-15T14:37:42'), Date.UTC(2025, 2, 15, 13, 37));
});

test('parseLocal rejects incomplete or impossible dates', () => {
  for (const v of ['', null, undefined, '2025-03-15', '2025-3-15T14:37', '2025-02-30T10:00', '0020-01-01T00:00']) {
    assert.equal(H.parseLocal(v), null, String(v));
  }
});

test('toLocalValue is the inverse of parseLocal', () => {
  for (const v of ['2017-01-01T00:00', '2025-03-15T14:37', '2025-10-26T23:59']) {
    assert.equal(H.toLocalValue(H.parseLocal(v)), v);
  }
});

test('utcOffsetLabel follows DST and odd offsets', () => {
  assert.equal(H.utcOffsetLabel(H.parseLocal('2025-01-10T12:00')), 'UTC+1');
  assert.equal(H.utcOffsetLabel(H.parseLocal('2025-07-10T12:00')), 'UTC+2');
  withTz('Asia/Kolkata', () => assert.equal(H.utcOffsetLabel(Date.UTC(2025, 0, 1)), 'UTC+5:30'));
  withTz('America/St_Johns', () => assert.equal(H.utcOffsetLabel(Date.UTC(2025, 0, 1)), 'UTC−3:30'));
  withTz('UTC', () => assert.equal(H.utcOffsetLabel(Date.UTC(2025, 0, 1)), 'UTC'));
});

test('check bounds the range from 1 Jan 2017 to now', () => {
  const now = H.parseLocal('2026-10-03T10:00');
  assert.equal(H.check(null, now), 'incomplete');
  assert.equal(H.check(H.parseLocal('2016-12-31T23:59'), now), 'early');
  assert.equal(H.check(H.parseLocal('2017-01-01T00:00'), now), null);
  assert.equal(H.check(now, now), null);
  assert.equal(H.check(H.parseLocal('2026-10-03T10:01'), now), 'future');
});

test('minuteOf floors to the minute, in unix seconds', () => {
  assert.equal(H.minuteOf(1742049420000), 1742049420);
  assert.equal(H.minuteOf(1742049477999), 1742049420);
});

const reply = (ts, open, close) => ({ data: { ohlc: [{ timestamp: String(ts), open: String(open), close: String(close) }] } });

test('priceAt opens at the requested minute', () => {
  assert.equal(H.priceAt(reply(1742049420, 77474, 77429), 1742049420), 77474);
});

test('priceAt falls back to the last close across a short gap', () => {
  assert.equal(H.priceAt(reply(1742049420 - 600, 77000, 77100), 1742049420), 77100);
  assert.equal(H.priceAt(reply(1742049420 - 3660, 77000, 77100), 1742049420), null);
});

test('priceAt rejects empty, malformed or out-of-range replies', () => {
  assert.equal(H.priceAt({ data: { ohlc: [] } }, 1742049420), null);
  assert.equal(H.priceAt({ error: 'x' }, 1742049420), null);
  assert.equal(H.priceAt(null, 1742049420), null);
  assert.equal(H.priceAt(reply(1742049480, 1, 1), 1742049420), null); // later candle
  assert.equal(H.priceAt(reply(1742049420, 0, 0), 1742049420), null);
  assert.equal(H.priceAt(reply(1742049420, 'abc', 1), 1742049420), null);
});

function fakeFetch(byPair, calls = []) {
  return async (url, init) => {
    calls.push({ url, init });
    const pair = /ohlc\/(\w+)\//.exec(url)[1];
    const r = byPair[pair];
    if (typeof r === 'number') return { ok: false, status: r, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => r };
  };
}

test('fetchRates asks Bitstamp for both pairs at that minute', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const rates = await H.fetchRates(1742049420, {
    signal,
    fetchFn: fakeFetch({ btceur: reply(1742049420, 77474, 1), btcusd: reply(1742049420, 84172, 1) }, calls),
  });
  assert.deepEqual(rates, { eur: 77474, usd: 84172 });
  assert.equal(calls.length, 2);
  for (const c of calls) {
    assert.match(c.url, /^https:\/\/www\.bitstamp\.net\/api\/v2\/ohlc\/btc(eur|usd)\/\?step=60&limit=1&end=1742049420$/);
    assert.equal(c.init.signal, signal);
  }
});

test('fetchRates resolves null when one currency has no price', async () => {
  const rates = await H.fetchRates(1742049420, {
    fetchFn: fakeFetch({ btceur: { data: { ohlc: [] } }, btcusd: reply(1742049420, 84172, 1) }),
  });
  assert.equal(rates, null);
});

test('fetchRates rejects on HTTP errors', async () => {
  await assert.rejects(H.fetchRates(1742049420, {
    fetchFn: fakeFetch({ btceur: 429, btcusd: reply(1742049420, 84172, 1) }),
  }), /HTTP 429/);
});

test('fetchRates rejects a 200 reply that is not an OHLC list', async () => {
  await assert.rejects(H.fetchRates(1742049420, {
    fetchFn: fakeFetch({ btceur: { status: 'error', reason: 'busy' }, btcusd: reply(1742049420, 84172, 1) }),
  }), /unexpected reply/);
});

function memoryStore() {
  const data = {};
  return { data, get: (k) => (k in data ? JSON.parse(data[k]) : null), set: (k, v) => { data[k] = JSON.stringify(v); } };
}

test('createCache stores, persists and evicts the oldest lookups', () => {
  const store = memoryStore();
  const cache = H.createCache(store, 'hist', 2);
  assert.equal(cache.get(60), null);
  cache.set(60, { eur: 1, usd: 2 });
  cache.set(120, { eur: 3, usd: 4 });
  cache.set(60, { eur: 1, usd: 2 }); // refresh: 120 is now the oldest
  cache.set(180, { eur: 5, usd: 6 });
  assert.equal(cache.get(120), null);
  assert.deepEqual(cache.get(60), { eur: 1, usd: 2 });
  assert.deepEqual(H.createCache(store, 'hist', 2).get(180), { eur: 5, usd: 6 });
});

test('createCache ignores a corrupt stored value', () => {
  const store = memoryStore();
  store.set('hist', { not: 'a list' });
  assert.equal(H.createCache(store, 'hist').get(60), null);
});
