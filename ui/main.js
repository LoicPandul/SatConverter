/* SatConverter — UI logic.
   All conversion, formatting, fetching and rendering lives here.
   The Rust side only provides: clipboard, window controls, persistence
   of window position, single-instance. */

(function () {
  'use strict';

  /* ── Tauri bridge (degrades gracefully in a plain browser) ────── */

  const tauri = window.__TAURI__ || null;
  const appWindow = tauri ? tauri.window.getCurrentWindow() : null;
  const invoke = tauri ? tauri.core.invoke : null;

  /* ── Config ────────────────────────────────────────────────────── */

  const SATS = 100_000_000;
  const REFRESH_MS = 60_000;           // price auto-refresh
  const SPARK_MAX_AGE = 600;           // seconds between sparkline refetches
  const PRICE_URL =
    'https://api.coingecko.com/api/v3/simple/price' +
    '?ids=bitcoin&vs_currencies=eur,usd&include_24hr_change=true';
  const SPARK_URL =
    'https://api.coingecko.com/api/v3/coins/bitcoin/market_chart' +
    '?vs_currency=eur&days=1';

  /* ── State ─────────────────────────────────────────────────────── */

  const P = { eur: null, usd: null, change24: null, spark: [], ts: null, pin: false };
  let source = null;        // field currently being edited
  let fetching = false;
  let offline = false;
  let nextAt = null;
  let prefilled = false;

  /* ── DOM ───────────────────────────────────────────────────────── */

  const $ = (id) => document.getElementById(id);
  const KEYS = ['sats', 'btc', 'eur', 'usd'];
  const inputs = {};
  KEYS.forEach((k) => { inputs[k] = $('in-' + k); });

  /* ── Locale-aware formatting / parsing ─────────────────────────── */

  const fmtInt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
  const fmtFiat2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBtc8 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
  const fmtPct1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  const numParts = new Intl.NumberFormat(undefined).formatToParts(12345.6);
  const GROUP = (numParts.find((p) => p.type === 'group') || {}).value || ',';
  const DECIMAL = (numParts.find((p) => p.type === 'decimal') || {}).value || '.';

  function parseNum(s) {
    s = String(s).replace(/\s/g, '');       // all whitespace, incl. NBSP variants
    s = s.split(GROUP).join('');            // locale grouping separators
    if (DECIMAL !== '.') s = s.replace(DECIMAL, '.');
    if (!/^\d*\.?\d*$/.test(s) || s === '' || s === '.') return null;
    const v = parseFloat(s);
    return Number.isFinite(v) && v >= 0 ? v : null;
  }

  const fmt = {
    sats: (v) => fmtInt.format(Math.round(v)),
    btc: (v) => fmtBtc8.format(v),
    eur: (v) => fmtFiat2.format(v),
    usd: (v) => fmtFiat2.format(v),
  };

  /* Machine value for the clipboard: dot decimal, no grouping. */
  function rawValue(key, v) {
    if (key === 'sats') return String(Math.round(v));
    if (key === 'btc') return v.toFixed(8).replace(/0+$/, '').replace(/\.$/, '');
    return v.toFixed(2);
  }

  /* ── Persistent cache (webview localStorage) ───────────────────── */

  const store = {
    get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full/blocked: non-fatal */ } },
  };

  /* ── Conversion ────────────────────────────────────────────────── */

  function fitFont(input) {
    const n = input.value.length;
    input.classList.toggle('small', n > 15 && n <= 19);
    input.classList.toggle('tiny', n > 19);
  }

  function setField(key, text) {
    inputs[key].value = text;
    fitFont(inputs[key]);
  }

  function markSource(key) {
    source = key;
    document.querySelectorAll('.row').forEach((r) => {
      r.classList.toggle('source', r.dataset.key === key);
    });
  }

  function clearAll() {
    KEYS.forEach((k) => setField(k, ''));
    source = null;
    document.querySelectorAll('.row').forEach((r) => r.classList.remove('source'));
  }

  function allEmpty() {
    return KEYS.every((k) => inputs[k].value.trim() === '');
  }

  function recompute(fromKey) {
    const raw = inputs[fromKey].value;
    if (raw.trim() === '') { clearAll(); return; }

    const v = parseNum(raw);
    if (v === null || !P.eur || !P.usd) return;

    let btc;
    if (fromKey === 'sats') btc = v / SATS;
    else if (fromKey === 'btc') btc = v;
    else if (fromKey === 'eur') btc = v / P.eur;
    else btc = v / P.usd;

    if (fromKey !== 'sats') setField('sats', fmt.sats(btc * SATS));
    if (fromKey !== 'btc') setField('btc', fmt.btc(btc));
    if (fromKey !== 'eur') setField('eur', fmt.eur(btc * P.eur));
    if (fromKey !== 'usd') setField('usd', fmt.usd(btc * P.usd));
  }

  /* ── Hero rendering ────────────────────────────────────────────── */

  function renderPrice(animate) {
    if (!P.eur) return;
    const el = $('priceEur');
    el.innerHTML = '';
    el.append(fmt.eur(P.eur));
    const cur = document.createElement('span');
    cur.className = 'cur';
    cur.textContent = '€';
    el.append(cur);
    $('priceUsd').textContent = fmt.usd(P.usd) + ' $';
    if (animate) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }

    const chip = $('chip24');
    if (P.change24 !== null && P.change24 !== undefined) {
      const up = P.change24 >= 0;
      chip.className = 'chip ' + (up ? 'up' : 'down');
      chip.innerHTML =
        (up
          ? '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 8H1z" fill="currentColor"/></svg>'
          : '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 2h8z" fill="currentColor"/></svg>') +
        (up ? '+' : '−') + fmtPct1.format(Math.abs(P.change24)) + '% / 24h';
    }
  }

  function renderSpark() {
    const pts = P.spark;
    if (!pts || pts.length < 2) return;
    const min = Math.min(...pts);
    const max = Math.max(...pts);
    const span = (max - min) || 1;
    let line = '';
    for (let i = 0; i < pts.length; i++) {
      const x = (i / (pts.length - 1)) * 100;
      const y = 29 - ((pts[i] - min) / span) * 26;
      line += (i === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2);
    }
    const svg = $('spark');
    svg.classList.add('fade');
    setTimeout(() => {
      $('sparkLine').setAttribute('d', line);
      $('sparkArea').setAttribute('d', line + 'L100 32L0 32Z');
      svg.classList.remove('fade');
    }, 180);
  }

  /* ── Status line ───────────────────────────────────────────────── */

  function agoText() {
    if (!P.ts) return '';
    const s = Math.max(0, Math.floor(Date.now() / 1000 - P.ts));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'min ago';
    return Math.floor(m / 60) + 'h ago';
  }

  function timeOf(ts) {
    return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function renderStatus() {
    const dot = $('dot');
    const txt = $('statusTxt');
    if (fetching) {
      dot.className = 'dot busy';
      txt.textContent = 'updating…';
    } else if (offline) {
      dot.className = 'dot err';
      txt.textContent = P.ts ? 'offline · last price ' + timeOf(P.ts) : 'offline · no data';
    } else if (P.ts) {
      dot.className = 'dot live';
      txt.textContent = 'live · ' + agoText();
    } else {
      dot.className = 'dot';
      txt.textContent = 'loading…';
    }
  }

  /* ── Price refresh ─────────────────────────────────────────────── */

  async function fetchJson(url) {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function afterPrices() {
    if (!P.eur) return;
    if (!prefilled && allEmpty()) {
      // First paint with live prices: show a worked example right away.
      prefilled = true;
      setField('eur', fmt.eur(100));
      markSource('eur');
      recompute('eur');
    } else if (source) {
      recompute(source);
    }
  }

  async function doRefresh() {
    if (fetching) return;
    fetching = true;
    renderStatus();
    $('refreshBtn').classList.add('spin');

    try {
      const data = await fetchJson(PRICE_URL);
      const btc = data.bitcoin;
      P.eur = Number(btc.eur);
      P.usd = Number(btc.usd);
      P.change24 = Number(btc.eur_24h_change ?? 0);
      P.ts = Math.floor(Date.now() / 1000);
      offline = false;
      store.set('prices', { eur: P.eur, usd: P.usd, change24: P.change24, ts: P.ts });

      // Sparkline: optional and throttled — keep the old one on failure.
      const cached = store.get('spark');
      if (!cached || Date.now() / 1000 - cached.ts > SPARK_MAX_AGE) {
        try {
          const chart = await fetchJson(SPARK_URL);
          const prices = (chart.prices || []).map((p) => p[1]);
          if (prices.length >= 2) {
            const step = Math.max(1, Math.floor(prices.length / 72));
            P.spark = prices.filter((_, i) => i % step === 0);
            store.set('spark', { points: P.spark, ts: Math.floor(Date.now() / 1000) });
          }
        } catch { /* keep previous sparkline */ }
      }

      renderPrice(true);
      renderSpark();
      afterPrices();
    } catch {
      offline = true;
    } finally {
      fetching = false;
      nextAt = Date.now() + REFRESH_MS;
      $('refreshBtn').classList.remove('spin');
      renderStatus();
    }
  }

  /* 1s tick: relative time, progress bar, auto-refresh. */
  setInterval(() => {
    if (!fetching) renderStatus();
    if (nextAt) {
      const frac = 1 - Math.max(0, nextAt - Date.now()) / REFRESH_MS;
      $('prog').style.width = (frac * 100).toFixed(1) + '%';
      if (Date.now() >= nextAt) doRefresh();
    }
  }, 1000);

  /* ── Input events ──────────────────────────────────────────────── */

  KEYS.forEach((key) => {
    const el = inputs[key];

    el.addEventListener('input', () => {
      const cleaned = el.value.replace(/[^\d.,\s]/g, '');
      if (cleaned !== el.value) el.value = cleaned;
      fitFont(el);
      markSource(key);
      recompute(key);
    });

    el.addEventListener('focus', () => {
      setTimeout(() => el.select(), 0);
    });

    el.addEventListener('blur', () => {
      const v = parseNum(el.value);
      if (v !== null && el.value.trim() !== '') setField(key, fmt[key](v));
    });
  });

  /* ── Copy buttons ──────────────────────────────────────────────── */

  async function copyToClipboard(text) {
    if (invoke) return invoke('copy_text', { text });
    return navigator.clipboard.writeText(text); // browser fallback (dev)
  }

  document.querySelectorAll('.copy-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.key;
      const v = parseNum(inputs[key].value);
      if (v === null) return;
      try { await copyToClipboard(rawValue(key, v)); } catch { return; }
      btn.classList.add('done');
      setTimeout(() => btn.classList.remove('done'), 900);
    });
  });

  /* ── Presets ───────────────────────────────────────────────────── */

  document.querySelectorAll('.preset').forEach((btn) => {
    btn.addEventListener('click', () => {
      setField('eur', fmt.eur(parseFloat(btn.dataset.eur)));
      markSource('eur');
      recompute('eur');
    });
  });

  /* ── Window controls & shortcuts ───────────────────────────────── */

  $('refreshBtn').addEventListener('click', doRefresh);
  $('minBtn').addEventListener('click', () => appWindow && appWindow.minimize());
  $('closeBtn').addEventListener('click', () => appWindow && appWindow.close());
  $('pinBtn').addEventListener('click', async () => {
    P.pin = !P.pin;
    $('pinBtn').classList.toggle('active', P.pin);
    store.set('pin', P.pin);
    if (appWindow) { try { await appWindow.setAlwaysOnTop(P.pin); } catch { /* revert on failure */ } }
  });

  /* CoinGecko attribution link (free API tier requires a visible,
     hyperlinked attribution). */
  $('cgLink').addEventListener('click', () => {
    const url = 'https://www.coingecko.com/en/api';
    if (tauri && tauri.opener) tauri.opener.openUrl(url).catch(() => {});
    else window.open(url, '_blank');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { clearAll(); inputs.eur.focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      doRefresh();
    }
  });

  /* Utility window: no context menu outside text inputs. */
  document.addEventListener('contextmenu', (e) => {
    if (e.target.tagName !== 'INPUT') e.preventDefault();
  });

  /* ── Boot ──────────────────────────────────────────────────────── */

  function boot() {
    const cached = store.get('prices');
    if (cached && cached.eur) {
      P.eur = cached.eur;
      P.usd = cached.usd;
      P.change24 = cached.change24;
      P.ts = cached.ts;
    }
    const sp = store.get('spark');
    if (sp && sp.points) P.spark = sp.points;

    renderPrice(false);
    renderSpark();
    renderStatus();
    afterPrices(); // cached prices are enough for the worked example

    P.pin = !!store.get('pin');
    $('pinBtn').classList.toggle('active', P.pin);
    if (P.pin && appWindow) appWindow.setAlwaysOnTop(true).catch(() => {});

    doRefresh();
  }

  boot();
})();
