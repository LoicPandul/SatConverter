/* SatConverter — historical prices (Bitstamp 1-minute candles).
   Date helpers and the Bitstamp lookup, kept free of DOM code so the
   same file runs in the webview (window.SatHistory) and under
   `node --test` (module.exports). */

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SatHistory = api;
})(this, function () {
  'use strict';

  /* First minute offered. Bitstamp has a price for every minute of both
     BTC/EUR and BTC/USD from here on (BTC/EUR only opened in 2016). */
  const MIN_VALUE = '2017-01-01T00:00';
  /* Oldest candle still accepted as "the price at that minute" when
     Bitstamp has a gap (maintenance): its close is the last traded price. */
  const MAX_GAP = 3600;
  const CACHE_CAP = 100;

  const pad = (n) => String(n).padStart(2, '0');

  /* datetime-local value ('YYYY-MM-DDTHH:MM') → epoch ms in local time,
     or null when incomplete or not a real date. */
  function parseLocal(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value || '');
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1).map(Number);
    const date = new Date(y, mo - 1, d, h, mi);
    // Date rolls overflow over (Feb 30 → Mar 2) and maps years < 100 to 19xx.
    if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
    return date.getTime();
  }

  /* epoch ms → datetime-local value, local time. */
  function toLocalValue(ms) {
    const d = new Date(ms);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /* Offset in effect at that instant, so DST shows right:
     'UTC+1' in January and 'UTC+2' in July for Paris. */
  function utcOffsetLabel(ms) {
    const off = -new Date(ms).getTimezoneOffset();
    if (off === 0) return 'UTC';
    const a = Math.abs(off);
    return 'UTC' + (off > 0 ? '+' : '−') + Math.floor(a / 60) + (a % 60 ? ':' + pad(a % 60) : '');
  }

  /* Why that instant can't be priced, or null when it can. */
  function check(ms, nowMs) {
    if (ms === null) return 'incomplete';
    if (ms < parseLocal(MIN_VALUE)) return 'early';
    if (ms > nowMs) return 'future';
    return null;
  }

  /* epoch ms → unix seconds of the minute it falls in. */
  const minuteOf = (ms) => Math.floor(ms / 60000) * 60;

  const ohlcUrl = (pair, minute) =>
    'https://www.bitstamp.net/api/v2/ohlc/' + pair + '/?step=60&limit=1&end=' + minute;

  /* Price as of `minute` from a Bitstamp OHLC reply (end=minute, limit=1).
     The candle of that very minute opens at it; an older candle means a
     gap, and its close is the last traded price. */
  function priceAt(json, minute) {
    const ohlc = json && json.data && json.data.ohlc;
    const c = Array.isArray(ohlc) ? ohlc[0] : null;
    if (!c) return null;
    const ts = Number(c.timestamp);
    if (!(ts <= minute && minute - ts <= MAX_GAP)) return null;
    const price = Number(ts === minute ? c.open : c.close);
    return price > 0 ? price : null;
  }

  /* { eur, usd } at that minute, or null when Bitstamp has no price close
     enough. Rejects on network or HTTP errors (and on abort). */
  async function fetchRates(minute, { signal, fetchFn = (url, init) => fetch(url, init) } = {}) {
    const one = async (pair) => {
      const res = await fetchFn(ohlcUrl(pair, minute), { signal });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return priceAt(await res.json(), minute);
    };
    const [eur, usd] = await Promise.all([one('btceur'), one('btcusd')]);
    return eur && usd ? { eur, usd } : null;
  }

  /* Past prices never change: keep the last CACHE_CAP lookups, most
     recent last. `store` is a { get, set } JSON store. */
  function createCache(store, key, cap = CACHE_CAP) {
    let list = store.get(key);
    if (!Array.isArray(list)) list = [];
    return {
      get(minute) {
        const e = list.find((x) => x.t === minute);
        return e ? { eur: e.eur, usd: e.usd } : null;
      },
      set(minute, rates) {
        list = list.filter((x) => x.t !== minute);
        list.push({ t: minute, eur: rates.eur, usd: rates.usd });
        if (list.length > cap) list = list.slice(-cap);
        store.set(key, list);
      },
    };
  }

  return {
    MIN_VALUE, parseLocal, toLocalValue, utcOffsetLabel, check,
    minuteOf, priceAt, fetchRates, createCache,
  };
});
