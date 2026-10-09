// Nick's Jev Trading Desk: dashboard front end (real data + the pixel office).
// Every token name, ticker and description comes from the internet, so all of it is
// escaped before it touches the page.

const STAGES = [
  { id: "desk",   name: "DESK",        c: "#ffffff", shape: "ghost",    sub: "runs the cycle every 15 min" },
  { id: "scout",  name: "SCOUT",       c: "#3b82f6", shape: "circle",   sub: "finds new launches" },
  { id: "market", name: "MARKET",      c: "#3ddc84", shape: "blob",     sub: "liquidity, volume, turnover" },
  { id: "chain",  name: "DOSSIER",     c: "#ff5a6e", shape: "square",   sub: "authorities, whales, holders" },
  { id: "jevm",   name: "JEV·MARKET",  c: "#ff4fb8", shape: "triangle", sub: "shape, momentum, wash", jev: true },
  { id: "jevt",   name: "JEV·TEXT",    c: "#2dd4bf", shape: "diamond",  sub: "effort, copycat", jev: true },
  { id: "pick",   name: "PICK",        c: "#ffa62b", shape: "spiky",    sub: "one token, or none", jev: true },
  { id: "score",  name: "SCOREKEEPER", c: "#b98cff", shape: "bean",     sub: "prices at 1h / 6h / 24h" },
];
const MARKET_Q = ["liquidity_fits_ticket", "momentum_already_spent", "concentration_is_exit_risk",
                  "dev_still_loaded", "wash_trading"];
const TEXT_Q = ["effort", "copycat"];
const VERDICT_COLORS = { pick: "#ffa62b", pass: "#3ddc84", reject: "#ff5a6e" };

let S = null;              // last /api/state
let selected = null;       // addr shown in the analysis panel
let lastEventT = 0;
const PAGE_LOADED = Date.now() / 1000;
const REPLAY_FIRST_S = 20, REPLAY_EVERY_S = 240;   // when idle: replay the last cycle
let replayAt = PAGE_LOADED + REPLAY_FIRST_S;
const tickerLines = [];

// --- helpers -----------------------------------------------------------------
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (x) => x == null ? "?" : x >= 1e6 ? `$${(x / 1e6).toFixed(2)}M` : `$${(x / 1e3).toFixed(0)}k`;
const pct = (x, d = 1) => x == null ? "?" : `${(x * 100).toFixed(d)}%`;
const num = (x, d = 2) => x == null ? "–" : Number(x).toFixed(d);
const signed = (x, d = 1) => x == null ? "–" : `${x >= 0 ? "+" : ""}${x.toFixed(d)}%`;
const usd = (x) => `${x >= 0 ? "+" : "−"}$${Math.abs(x).toFixed(0)}`;
const ago = (t) => { const m = Math.round((Date.now() / 1000 - t) / 60);
  return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
const short = (s, n = 10) => { s = String(s ?? "?"); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

// --- stage cards ----------------------------------------------------------------
function buildCards() {
  $("#cards").innerHTML = STAGES.map((s) => `
    <div class="card" id="card-${s.id}" style="--c:${s.c}">
      <div class="head"><span class="icon ${s.shape}"></span><span class="name">${s.name}</span>
        ${s.jev ? '<span class="badge">ASKS JEV</span>' : ""}</div>
      <div class="sub">${s.sub}</div>
      <div class="row"><span class="label" data-f="label">—</span><span class="value" data-f="value">—</span></div>
      <div class="bar"><i data-f="bar"></i></div>
      <div class="quote" data-f="quote">&nbsp;</div>
    </div>`).join("");
}
function setCard(id, { label, value, bar, quote, active }) {
  const el = $(`#card-${id}`);
  if (!el) return;
  el.querySelector('[data-f="label"]').textContent = label ?? "—";
  el.querySelector('[data-f="value"]').textContent = value ?? "—";
  el.querySelector('[data-f="bar"]').style.width = `${Math.max(0, Math.min(1, bar ?? 0)) * 100}%`;
  el.querySelector('[data-f="quote"]').textContent = quote ? `"${quote}"` : " ";
  el.classList.toggle("active", !!active);
}

// pipeline stage (from events) -> which character/card is working right now
function activeStage() {
  if (!S?.desk?.running) return null;
  const st = (S.live_stages || []).filter((k) => k !== "desk").pop();
  if (st === "jev") return Math.floor(Date.now() / 1500) % 2 ? "jevm" : "jevt";
  return st || "desk";
}

function renderCards() {
  const st = S.stages || {}, d = S.desk;
  const running = d.running;
  const scoutDone = st.scout?.done, mkt = st.market?.done, ch = st.chain?.done;
  const jevTokens = (S.finalists || []).filter((f) => f.judged);
  const lastJ = jevTokens[jevTokens.length - 1];
  const decision = st.pick?.decision;
  const sc = S.score?.by_verdict?.all || {};
  const nextIn = Math.max(0, Math.round((d.next_cycle - Date.now() / 1000) / 60));
  const act = activeStage();
  const lastStage = act === "jevm" || act === "jevt" ? "jev" : act;

  setCard("desk", {
    label: running ? "cycle running" : `next cycle in ${nextIn}m`,
    value: `${d.cycles_today} today`,
    bar: running ? 1 : 1 - nextIn / 15,
    quote: decision ? (decision.pick ? `would buy ${decision.pick.ticker}` : `no trade: ${decision.reason}`) : null,
    active: running && lastStage === "desk",
  });
  setCard("scout", {
    label: `watchlist ${scoutDone?.watchlist ?? "?"}`, value: `+${scoutDone?.new ?? 0} new`,
    bar: (scoutDone?.new ?? 0) / 40,
    quote: scoutDone ? `${scoutDone.aged_out} aged out` : null, active: running && lastStage === "scout",
  });
  const topKill = mkt ? Object.entries(mkt.kills || {}).sort((a, b) => b[1] - a[1])[0] : null;
  setCard("market", {
    label: mkt ? `${mkt.checked} checked` : "—", value: mkt ? `${mkt.survived} passed` : "—",
    bar: mkt ? mkt.survived / Math.max(1, mkt.checked) * 8 : 0,
    quote: topKill ? `most died of ${topKill[0]} (${topKill[1]})` : null, active: running && lastStage === "market",
  });
  const lastChain = st.chain?.token;
  setCard("chain", {
    label: ch ? `${ch.checked} dossiers` : "—", value: ch ? `${ch.survived} finalists` : "—",
    bar: ch ? ch.survived / Math.max(1, ch.checked) : 0,
    quote: lastChain ? `${lastChain.ticker}: whale ${pct(lastChain.top_wallet)}, top10 ${pct(lastChain.top10)}` : null,
    active: running && lastStage === "chain",
  });
  const jm = st.jev?.token;
  setCard("jevm", {
    label: jm ? `${short(jm.ticker)} · ${jm.shape}` : "—",
    value: jm ? `crowd ${num(jm.crowd)}` : "—", bar: jm?.crowd ?? 0,
    quote: jm ? (jm.fails?.filter((f) => !TEXT_Q.includes(f)).join(", ") || "market checks passed") : null,
    active: act === "jevm",
  });
  setCard("jevt", {
    label: jm ? short(jm.ticker) : "—",
    value: jm ? `effort ${num(jm.answers?.effort, 1)}/3` : "—", bar: (jm?.answers?.effort ?? 0) / 3,
    quote: jm ? `copycat ${num(jm.answers?.copycat)}` : null, active: act === "jevt",
  });
  setCard("pick", {
    label: decision ? `${decision.passed ?? 0} of ${decision.judged ?? 0} passed` : "—",
    value: decision ? (decision.pick ? `BUY ${short(decision.pick.ticker, 8)}` : "NO TRADE") : "—",
    bar: decision?.pick ? 1 : 0, quote: decision?.reason || (decision?.pick ? `via ${decision.pick.via}` : null),
    active: running && lastStage === "pick",
  });
  const h1 = sc["1h"] || {};
  setCard("score", {
    label: `${S.score?.counts?.tracked ?? 0} tracked`,
    value: h1.n ? `1h ${signed(h1.avg)}` : "waiting",
    bar: (h1.n || 0) / 30,
    quote: h1.n ? `${h1.n} priced at 1h, ${h1.win}% would have won` : "first prices arrive 1h after judging",
    active: running && lastStage === "score",
  });

  document.querySelectorAll(".pill").forEach((p) =>
    p.classList.toggle("on", running && p.dataset.stage === lastStage));
}

// --- header ---------------------------------------------------------------------
function renderHeader() {
  const m = $("#mode");
  m.textContent = S.desk.running ? "● LIVE CYCLE" : "IDLE · BETWEEN CYCLES";
  m.className = `mode ${S.desk.running ? "live" : "idle"}`;
  const j = S.jev_today;
  $("#daycount").textContent = `jev today ${j.calls} calls · $${j.cost.toFixed(4)}`;
}
function tickClock() {
  $("#clock").textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// --- finalist chips --------------------------------------------------------------
function renderChips() {
  const fs = S.finalists || [];
  const sel = currentFinalist()?.addr;
  $("#chips").innerHTML = fs.map((f) => {
    const fails = f.judged?.fails || [];
    const ok = f.judged && !fails.length;
    const ring = !f.judged ? "#7d8499" : ok ? "var(--green)" : "var(--red)";
    return `<div class="chip ${f.addr === sel ? "sel" : ""}" data-addr="${esc(f.addr)}" style="--ring:${ring}">
      <span class="dot" style="background:hsl(${hue(f.addr)} 70% 62%)">${esc(String(f.ticker || "?").slice(0, 2).toUpperCase())}</span>
      <span class="tip">${esc(short(f.ticker, 16))} · <span style="color:${ring}">${ok ? "PASS" : esc(fails.join(", ") || "not judged")}</span></span></div>`;
  }).join("");
  document.querySelectorAll(".chip").forEach((c) => c.onclick = () => { selected = c.dataset.addr; renderChips(); renderAnalysis(); renderThresholds(); });
}

// --- ticker ------------------------------------------------------------------------
function describe(e) {
  const k = `${e.stage}.${e.kind}`;
  switch (k) {
    case "scout.done": return `SCOUT +${e.new} new launches, watching ${e.watchlist}`;
    case "market.token": return e.result === "pass" ? `MARKET ${e.ticker} passed (liq ${money(e.liq)})` : null;
    case "market.done": return `MARKET ${e.checked} checked, ${e.survived} passed`;
    case "chain.token": return `DOSSIER ${e.ticker} whale ${pct(e.top_wallet)} top10 ${pct(e.top10)} -> ${e.result}`;
    case "jev.token": return `JEV ${e.ticker} ${e.shape} crowd ${num(e.crowd)} -> ${e.fails?.length ? e.fails.join(", ") : "PASS"}`;
    case "pick.decision": return e.pick ? `PICK would buy ${e.pick.ticker}` : `PICK no trade: ${e.reason}`;
    case "pick.benched": return `BENCH ${e.tokens.map((t) => `${t.ticker} ${t.minutes}m`).join(", ")}`;
    case "score.priced": return `SCORE ${e.ticker} ${e.checkpoint} ${signed(e.net)} (${e.verdict})`;
    case "desk.cycle_end": return `DESK cycle finished${e.rc ? " with errors" : ""}`;
    default: return null;
  }
}
async function pollEvents() {
  try {
    const evts = await (await fetch(`/api/events?since=${lastEventT || Date.now() / 1000 - 6 * 3600}`)).json();
    for (const e of evts) {
      lastEventT = Math.max(lastEventT, e.t);
      if (e.t > PAGE_LOADED - 30) Office.event(e);     // animate only what happens while you watch
      const line = describe(e);
      if (line) tickerLines.push(line);
    }
    while (tickerLines.length > 40) tickerLines.shift();
    const text = tickerLines.length ? tickerLines.join("   ·   ") : "waiting for the first cycle";
    $("#ticker-track").textContent = `${text}   ·   ${text}   ·   `;
  } catch (_) { /* server restarting; try again next tick */ }
}

// --- shadow P&L chart ----------------------------------------------------------------
function latestNet(r) { return r.net["24h"] ?? r.net["6h"] ?? r.net["1h"]; }
function renderShadow() {
  const cv = $("#shadow-chart"), ctx = cv.getContext("2d");
  const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  const rows = (S.score?.series || []).filter((r) => latestNet(r) != null);
  $("#cost").textContent = S.thresholds.cost_pct;
  const groups = {};
  for (const v of Object.keys(VERDICT_COLORS)) {
    let sum = 0;
    groups[v] = rows.filter((r) => r.verdict === v).map((r) => ({ t: r.t, y: (sum += latestNet(r)) }));
  }
  $("#shadow-legend").innerHTML = Object.entries(VERDICT_COLORS).map(([v, c]) =>
    `<span><i style="background:${c}"></i>${v} ${groups[v].length ? usd(groups[v].at(-1).y) : "–"}</span>`).join("");
  $("#shadow-note").textContent = rows.length
    ? `${rows.length} tokens priced so far · each line is the running total if $100 had gone into every token in that group, at its latest checkpoint · shadow only, no real money`
    : "no prices yet: the first 1h checkpoints land an hour after a token is judged";
  if (!rows.length) return;
  const all = Object.values(groups).flat();
  const t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t), t0 + 1);
  const ys = all.map((p) => p.y).concat([0]);
  const y0 = Math.min(...ys), y1 = Math.max(...ys, y0 + 1);
  const pad = 30 * devicePixelRatio;
  const X = (t) => pad + (t - t0) / (t1 - t0) * (W - pad * 2);
  const Y = (y) => H - pad / 2 - (y - y0) / (y1 - y0) * (H - pad);
  ctx.strokeStyle = "#262b3a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(pad, Y(0)); ctx.lineTo(W - pad, Y(0)); ctx.stroke();
  ctx.fillStyle = "#7d8499"; ctx.font = `${10 * devicePixelRatio}px monospace`;
  ctx.fillText("$0", 2, Y(0) + 3);
  const gap = 14 * devicePixelRatio;
  if (Y(0) - Y(y1) > gap) ctx.fillText(usd(y1), 2, Y(y1) + 10 * devicePixelRatio);
  if (Y(y0) - Y(0) > gap) ctx.fillText(usd(y0), 2, Y(y0));
  for (const [v, pts] of Object.entries(groups)) {
    if (!pts.length) continue;
    ctx.strokeStyle = VERDICT_COLORS[v]; ctx.lineWidth = 2 * devicePixelRatio; ctx.beginPath();
    ctx.moveTo(X(t0), Y(0));
    for (const p of pts) ctx.lineTo(X(p.t), Y(p.y));
    ctx.stroke();
    const last = pts.at(-1);
    ctx.fillStyle = VERDICT_COLORS[v];
    ctx.beginPath(); ctx.arc(X(last.t), Y(last.y), 3 * devicePixelRatio, 0, 7); ctx.fill();
  }
}

// --- analysis panel -----------------------------------------------------------------
function currentFinalist() {
  const fs = S.finalists || [];
  return fs.find((f) => f.addr === selected) || fs.find((f) => f.addr === S.pick?.addr) || fs[0] || null;
}
function softRows(ans) {
  const out = [];
  for (const [name, [dir, lim]] of Object.entries(S.thresholds.soft)) {
    const v = ans?.[name]?.noul ?? ans?.[name]?.score;
    const ok = v == null ? null : dir === "max" ? v <= lim : v >= lim;
    out.push({ name, dir, lim, v, ok });
  }
  const sh = ans?.shape;
  if (sh) {
    const crowd = sh.probabilities?.crowd;
    out.unshift({ name: `shape (${sh.choice})`, dir: "min", lim: S.thresholds.shape_min_crowd, v: crowd,
                  ok: !["fading", "one_buyer", "too_early"].includes(sh.choice) && crowd >= S.thresholds.shape_min_crowd });
  }
  return out;
}
async function renderAnalysis() {
  const f = currentFinalist();
  $("#an-count").textContent = `${S.stages?.market?.done?.checked ?? 0} SCANNED`;
  const list = S.finalists || [];
  $("#an-list").innerHTML = list.map((x) => {
    const fails = x.judged?.fails || [];
    return `<div class="it ${f && x.addr === f.addr ? "sel" : ""}" data-addr="${esc(x.addr)}">
      <span>${esc(short(x.ticker, 11))}</span><span>${esc(fails.join(", ") || (x.judged ? "passed every check" : "not judged"))}</span>
      <span style="color:${fails.length ? "var(--red)" : "var(--green)"}">${fails.length ? "DROP" : x.judged ? "PASS" : "–"}</span></div>`;
  }).join("");
  document.querySelectorAll(".an-list .it").forEach((el) => el.onclick = () => { selected = el.dataset.addr; renderChips(); renderAnalysis(); renderThresholds(); });
  if (!f) { $("#an-token").textContent = "no finalist to show yet"; $("#an-checks").innerHTML = ""; drawCandles([]); return; }
  $("#an-token").innerHTML = `<b>${esc(f.ticker)}</b> <span class="muted">${esc(f.name || "")}</span> · mcap ${money(f.mcap_usd)} · liq ${money(f.liquidity_usd)} · vol24 ${money(f.volume_h24)} · ${Math.round((f.age_minutes || 0) / 60)}h old`;
  $("#an-checks").innerHTML = softRows(f.judged?.answers).map((r) => `<div class="ck">
      <span>${esc(r.name.replaceAll("_", " "))}</span><span class="v">${num(r.v)} ${r.dir === "max" ? "≤" : "≥"} ${r.lim}</span>
      <span class="${r.ok == null ? "" : r.ok ? "ok" : "bad"}">${r.ok == null ? "–" : r.ok ? "PASS" : "DROP"}</span></div>`).join("")
    || '<span class="muted">not judged yet</span>';
  if (f.pool_addr) {
    try {
      const cs = (await (await fetch(`/api/ohlcv?pool=${encodeURIComponent(f.pool_addr)}`)).json()).candles || [];
      drawCandles(cs); Office.setCandles(cs);
    } catch (_) { drawCandles([]); }
  }
}
function drawCandles(cs) {
  const cv = $("#candles"), ctx = cv.getContext("2d");
  const W = cv.width = cv.clientWidth * devicePixelRatio, H = cv.height = cv.clientHeight * devicePixelRatio;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = "#7d8499"; ctx.font = `${10 * devicePixelRatio}px monospace`;
  if (!cs.length) { ctx.fillText("no candles yet", 10, 20); return; }
  const lo = Math.min(...cs.map((c) => c[3])), hi = Math.max(...cs.map((c) => c[2]));
  const vmax = Math.max(...cs.map((c) => c[5])) || 1;
  const pad = 6 * devicePixelRatio, w = (W - pad * 2) / cs.length;
  const Y = (p) => pad + (hi - p) / (hi - lo || 1) * (H * 0.78 - pad);
  cs.forEach(([t, o, h, l, c, v], i) => {
    const x = pad + i * w, up = c >= o;
    ctx.fillStyle = ctx.strokeStyle = up ? "#3ddc84" : "#ff7a45";
    ctx.beginPath(); ctx.moveTo(x + w / 2, Y(h)); ctx.lineTo(x + w / 2, Y(l)); ctx.stroke();
    ctx.fillRect(x + w * 0.15, Math.min(Y(o), Y(c)), w * 0.7, Math.max(1, Math.abs(Y(o) - Y(c))));
    ctx.globalAlpha = 0.35; const vh = v / vmax * H * 0.18;
    ctx.fillRect(x + w * 0.15, H - vh, w * 0.7, vh); ctx.globalAlpha = 1;
  });
  ctx.fillStyle = "#7d8499"; ctx.fillText("5m candles · GeckoTerminal", 8 * devicePixelRatio, H - 6 * devicePixelRatio);
}

// --- thresholds panel ---------------------------------------------------------------
function renderThresholds() {
  const f = currentFinalist(), h = S.thresholds.hard;
  const hard = [
    ["min_age_minutes", h.min_age_minutes, f?.age_minutes, (v, l) => v >= l, (v) => `${Math.round(v)}m`],
    ["max_age_hours", h.max_age_hours, f?.age_minutes == null ? null : f.age_minutes / 60, (v, l) => v <= l, (v) => `${v.toFixed(1)}h`],
    ["min_liquidity_usd", h.min_liquidity_usd, f?.liquidity_usd, (v, l) => v >= l, money],
    ["min_volume_h24", h.min_volume_h24, f?.volume_h24, (v, l) => v >= l, money],
    ["min_mcap_usd", h.min_mcap_usd, f?.mcap_usd, (v, l) => v >= l, money],
    ["max_mcap_usd", h.max_mcap_usd, f?.mcap_usd, (v, l) => v <= l, money],
    ["min_trades_h24", h.min_trades_h24, f?.trades_h24, (v, l) => v >= l, (v) => String(v)],
    ["max_turnover", h.max_turnover, f?.turnover, (v, l) => v <= l, (v) => `${v.toFixed(1)}x`],
    ["max_top_wallet", h.max_top_wallet, f?.top_wallet_pct, (v, l) => v <= l, (v) => pct(v)],
    ["max_top_10", h.max_top_10, f?.top_10_pct ?? f?.gt_top_10_pct, (v, l) => v <= l, (v) => pct(v)],
    ["min_holders", h.min_holders, f?.holder_count, (v, l) => v >= l, (v) => String(v)],
  ];
  const line = (k, lim, cur, ok) => `<div class="ln ${ok === false ? "fail" : ""}"><span class="k">${esc(k)}</span>
     <span class="lim">${esc(lim)}</span><span class="cur">${esc(cur ?? "…")}</span>
     <span class="mk ${ok == null ? "" : ok ? "ok" : "bad"}">${ok == null ? "" : ok ? "✓" : "✗"}</span></div>`;
  let html = `<div class="sec">HARD = {  # arithmetic, costs nothing${f ? ` · ${esc(short(f.ticker, 12))}` : ""}</div>`;
  for (const [k, lim, v, test, fmt] of hard) html += line(k, lim, v == null ? null : fmt(v), v == null ? null : test(v, lim));
  html += `<div class="sec">}</div><div class="sec">SOFT = {  # applied to Jev's answers</div>`;
  for (const r of softRows(f?.judged?.answers)) html += line(r.name, `${r.dir} ${r.lim}`, r.v == null ? null : num(r.v), r.ok);
  html += `<div class="sec">}</div>`;
  $("#th-body").innerHTML = html;
}

// --- main loop ---------------------------------------------------------------------
async function pollState() {
  try {
    S = await (await fetch("/api/state")).json();
    const midnight = new Date().setHours(0, 0, 0, 0) / 1000;
    const today = (S.score?.series || []).filter((r) => r.t >= midnight);
    S._rejectsToday = today.filter((r) => r.verdict === "reject").length;
    S._picksToday = today.filter((r) => r.verdict === "pick").length;
    S._judgedToday = today.length;
    S._selected = selected;
    renderHeader(); renderCards(); renderChips(); renderShadow(); renderThresholds(); renderAnalysis();
  } catch (e) { $("#mode").textContent = "OFFLINE · retrying"; }
}

buildCards();
Office.init($("#floor"), $("#chips"));
setInterval(() => S && Office.update(S, { active: activeStage() }), 500);
tickClock(); setInterval(tickClock, 1000);
pollState(); setInterval(pollState, 10000);
pollEvents(); setInterval(pollEvents, 3000);

// Between cycles the floor replays the last finished cycle every few minutes.
async function maybeReplay() {
  const t = Date.now() / 1000;
  if (!S || S.desk?.running || Office.busy() || t < replayAt) return;
  replayAt = t + REPLAY_EVERY_S;
  try {
    const r = await (await fetch("/api/cycle")).json();
    if (!S.desk?.running) Office.replay(r.events, r.cycle);
  } catch (_) { /* try again next time */ }
}
setInterval(maybeReplay, 5000);
addEventListener("resize", () => S && (renderShadow(), renderAnalysis()));
