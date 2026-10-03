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
    '?vs_currency=usd&days=1';

  /* ── State ─────────────────────────────────────────────────────── */

  const P = { eur: null, usd: null, change24: null, spark: [], ts: null, pin: false };
  /* Historical mode: prices at a past minute (Bitstamp). `rates` is
     { eur, usd } once loaded; `state` drives the status line. */
  const H = { on: false, at: null, rates: null, state: 'idle', req: 0, ctrl: null, timer: null };
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

  /* ── Theme (dark by default, user choice persisted) ────────────── */

  function applyTheme(theme) {
    const light = theme === 'light';
    if (light) document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    const btn = $('themeBtn');
    btn.setAttribute('aria-checked', String(light));
    btn.setAttribute('aria-label', light ? 'Dark mode' : 'Light mode');
    btn.title = light ? 'Switch to dark mode' : 'Switch to light mode';
  }

  let theme = store.get('theme') === 'light' ? 'light' : 'dark';
  applyTheme(theme); // deferred script: runs before first paint, no flash

  $('themeBtn').addEventListener('click', () => {
    theme = theme === 'light' ? 'dark' : 'light';
    store.set('theme', theme);
    applyTheme(theme);
  });

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

  /* Prices the converter uses right now: live, or the chosen past minute. */
  function rates() {
    if (H.on) return H.rates;
    return P.eur && P.usd ? P : null;
  }

  function recompute(fromKey) {
    const raw = inputs[fromKey].value;
    if (raw.trim() === '') { clearAll(); return; }

    const v = parseNum(raw);
    if (v === null) return;
    const r = rates();
    if (!r) {
      // No price for the chosen date: never leave figures from another one.
      KEYS.forEach((k) => { if (k !== fromKey) setField(k, ''); });
      return;
    }

    let btc;
    if (fromKey === 'sats') btc = v / SATS;
    else if (fromKey === 'btc') btc = v;
    else if (fromKey === 'eur') btc = v / r.eur;
    else btc = v / r.usd;

    if (fromKey !== 'sats') setField('sats', fmt.sats(btc * SATS));
    if (fromKey !== 'btc') setField('btc', fmt.btc(btc));
    if (fromKey !== 'eur') setField('eur', fmt.eur(btc * r.eur));
    if (fromKey !== 'usd') setField('usd', fmt.usd(btc * r.usd));
  }

  /* ── Hero rendering ────────────────────────────────────────────── */

  /* Hero shows whichever prices the converter uses: live, or the past
     minute in historical mode (where the chip compares it with today). */
  function renderPrice(animate) {
    const r = rates();
    const el = $('priceUsd');
    el.innerHTML = '';
    el.append(r ? fmt.usd(r.usd) : '—');
    const cur = document.createElement('span');
    cur.className = 'cur';
    cur.textContent = '$';
    el.append(cur);
    $('priceEur').textContent = r ? fmt.eur(r.eur) + ' €' : '—';
    if (animate && r) {
      el.classList.remove('bump');
      void el.offsetWidth;
      el.classList.add('bump');
    }

    if (H.on) renderChip(r && P.usd ? (P.usd / r.usd - 1) * 100 : null, 'since');
    else renderChip(P.change24, '/ 24h');
    $('chip24').title = H.on ? 'Change from that date to now, in USD' : '';
  }

  function renderChip(pct, suffix) {
    const chip = $('chip24');
    if (pct === null || pct === undefined || !Number.isFinite(pct)) {
      chip.className = 'chip';
      chip.textContent = '— ' + suffix;
      return;
    }
    const up = pct >= 0;
    chip.className = 'chip ' + (up ? 'up' : 'down');
    chip.innerHTML =
      (up
        ? '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 8H1z" fill="currentColor"/></svg>'
        : '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 2h8z" fill="currentColor"/></svg>') +
      (up ? '+' : '−') + fmtPct1.format(Math.abs(pct)) + '% ' + suffix;
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

  const fmtWhen = (ms) =>
    new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  /* Historical states other than 'ok': [dot class, message]. The message
     sits right under the date field (its aria-describedby). */
  const HIST_STATUS = {
    idle:       ['dot', ''],
    loading:    ['dot busy', 'fetching price…'],
    incomplete: ['dot', 'enter a full date and time'],
    early:      ['dot err', 'prices start on ' +
                 new Date(SatHistory.parseLocal(SatHistory.MIN_VALUE)).toLocaleDateString([], { dateStyle: 'medium' })],
    future:     ['dot err', 'pick a time in the past'],
    missing:    ['dot err', 'no Bitstamp price for that minute'],
    error:      ['dot err', "can't reach Bitstamp · Ctrl+R to retry"],
  };

  function setStatus(dotClass, text) {
    const dot = $('dot');
    const txt = $('statusTxt');
    dot.className = dotClass;
    // Rewrite only on change: the line is a polite live region.
    if (txt.textContent !== text) txt.textContent = text;
  }

  function renderStatus() {
    const busy = H.on ? H.state === 'loading' : fetching;
    $('refreshBtn').classList.toggle('spin', busy);
    if (H.on) {
      if (H.state === 'ok') setStatus('dot hist', 'Bitstamp · ' + fmtWhen(H.at));
      else setStatus(...HIST_STATUS[H.state]);
    } else if (fetching) {
      setStatus('dot busy', 'updating…');
    } else if (offline) {
      setStatus('dot err', P.ts ? 'offline · last price ' + timeOf(P.ts) : 'offline · no data');
    } else if (P.ts) {
      setStatus('dot live', 'live · ' + agoText());
    } else {
      setStatus('dot', 'loading…');
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

    try {
      const data = await fetchJson(PRICE_URL);
      const btc = data.bitcoin;
      P.eur = Number(btc.eur);
      P.usd = Number(btc.usd);
      P.change24 = Number(btc.usd_24h_change ?? 0);
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

      renderPrice(!H.on); // historical mode: only the "since" chip moves
      renderSpark();
      afterPrices();
    } catch {
      offline = true;
    } finally {
      fetching = false;
      nextAt = Date.now() + REFRESH_MS;
      renderStatus();
    }
  }

  /* ── Historical mode ───────────────────────────────────────────── */

  const histAt = $('histAt');
  const histCache = SatHistory.createCache(store, 'histPrices');

  /* Re-render everything that depends on the active prices. */
  function afterRates(animate) {
    renderPrice(animate);
    renderStatus();
    if (source) recompute(source);
  }

  function setHistory(state, r) {
    H.state = state;
    H.rates = r;
    // While fetching, the previous figures stay on screen, dimmed.
    document.body.classList.toggle('pending', state === 'loading' && !!r);
    afterRates(state === 'ok');
  }

  function cancelHistory() {
    clearTimeout(H.timer);
    H.req++;
    if (H.ctrl) { H.ctrl.abort(); H.ctrl = null; }
  }

  async function loadHistory() {
    cancelHistory();
    const now = Date.now();
    histAt.max = SatHistory.toLocalValue(now);
    const ms = SatHistory.parseLocal(histAt.value);
    $('histTz').textContent = SatHistory.utcOffsetLabel(ms === null ? now : ms);
    const why = SatHistory.check(ms, now);
    if (why) { setHistory(why, null); return; }

    H.at = ms;
    store.set('histAt', histAt.value);
    const minute = SatHistory.minuteOf(ms);
    const hit = histCache.get(minute);
    if (hit) { setHistory('ok', hit); return; }

    const id = H.req;
    const ctrl = new AbortController();
    H.ctrl = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), 10_000);
    setHistory('loading', H.rates);
    try {
      const r = await SatHistory.fetchRates(minute, { signal: ctrl.signal });
      if (id !== H.req) return; // superseded by a newer date or a mode switch
      if (r) histCache.set(minute, r);
      setHistory(r ? 'ok' : 'missing', r);
    } catch {
      if (id === H.req) setHistory('error', null);
    } finally {
      clearTimeout(timeout);
      if (H.ctrl === ctrl) H.ctrl = null;
    }
  }

  function setMode(on) {
    H.on = on;
    document.body.classList.toggle('hist', on);
    $('histBtn').setAttribute('aria-pressed', String(on));
    if (on) {
      // Last date used, else this time yesterday.
      if (!histAt.value) histAt.value = store.get('histAt') || SatHistory.toLocalValue(Date.now() - 86_400_000);
      loadHistory();
      histAt.focus();
    } else {
      cancelHistory();
      document.body.classList.remove('pending');
      afterRates(false);
    }
  }

  function refresh() {
    if (H.on) loadHistory();
    else doRefresh();
  }

  // Typing a date fires `input` on every segment (and passes through
  // years like 0002 → 0020 → 0202): wait for a pause before fetching.
  // Meanwhile the figures on screen belong to the previous date: mark
  // them stale and drop any fetch still in flight for it.
  histAt.addEventListener('input', () => {
    cancelHistory();
    setHistory('loading', H.rates);
    H.timer = setTimeout(loadHistory, 400);
  });
  histAt.addEventListener('focus', () => { histAt.max = SatHistory.toLocalValue(Date.now()); });
  $('histBtn').addEventListener('click', () => setMode(!H.on));

  /* 1s tick: relative time, progress bar, auto-refresh. */
  setInterval(() => {
    if (!fetching) renderStatus();
    if (nextAt) {
      const frac = 1 - Math.max(0, nextAt - Date.now()) / REFRESH_MS;
      $('prog').style.transform = 'scaleX(' + frac.toFixed(3) + ')';
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
      // A converted figure is stale while another date's price loads.
      if (H.on && H.state === 'loading' && key !== source) return;
      const v = parseNum(inputs[key].value);
      if (v === null) return;
      try { await copyToClipboard(rawValue(key, v)); } catch { return; }
      // Restart feedback cleanly on rapid re-copy (no stacked timers).
      btn.classList.remove('done');
      void btn.offsetWidth;
      btn.classList.add('done');
      clearTimeout(btn._doneTimer);
      btn._doneTimer = setTimeout(() => btn.classList.remove('done'), 900);
    });
  });

  /* ── Window controls & shortcuts ───────────────────────────────── */

  $('refreshBtn').addEventListener('click', refresh);
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
  document.querySelectorAll('.cg-link').forEach((link) => link.addEventListener('click', () => {
    const url = 'https://www.coingecko.com/en/api';
    if (tauri && tauri.opener) tauri.opener.openUrl(url).catch(() => {});
    else window.open(url, '_blank');
  }));

  document.addEventListener('keydown', (e) => {
    // Escape inside the date field belongs to the field (closes its picker).
    if (e.key === 'Escape' && e.target !== histAt) { clearAll(); inputs.eur.focus(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      refresh();
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
