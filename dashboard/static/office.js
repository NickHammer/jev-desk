// The Floor: a pixel-art office drawn entirely in code (no image files).
// The room is painted on a small low-resolution canvas and scaled up with smoothing
// off, so every shape stays a crisp pixel block. Text is drawn afterwards at full
// resolution so it stays readable.
//
// Public API (used by app.js):
//   Office.init(canvasElement)
//   Office.update(state)         latest /api/state
//   Office.setCandles(candles)   5-minute candles for the wall screen
//   Office.layout()              stage id -> {x, y} in page coordinates (for step 3)

const Office = (() => {
  const W = 440, H = 200;                       // the room, in art pixels
  const C = {
    wall: "#121521", wallLine: "#171b29", trim: "#1e2333", floor: "#0c0f17", tile: "#121622",
    frame: "#232a3b", screen: "#06080d", wood: "#1b2030", woodTop: "#262c3f", leg: "#141826",
    chair: "#1a1f2e", plant: "#2f9e5b", plantDark: "#1f6b3d", pot: "#2a2f40", couch: "#1c2131",
    green: "#3ddc84", red: "#ff5a6e", pink: "#ff4fb8", white: "#f2f3f8", dark: "#06070b",
  };

  // where everyone works. y is the desk top; characters sit just in front of it.
  const DESKS = {
    scout:  { x: 150, y: 100 }, market: { x: 220, y: 100 }, chain: { x: 290, y: 100 },
    jevm:   { x: 150, y: 150 }, jevt:   { x: 220, y: 150 }, pick:  { x: 290, y: 150 },
  };
  const SPOTS = {                                 // characters away from the six desks
    desk:  { x: 380, y: 98 },                     // head of the floor, behind its desk
    score: { x: 372, y: 168 },                    // next to the scoreboard
  };
  const CHARS = {
    desk:   { shape: "ghost",    color: "#f2f3f8", name: "DESK" },
    scout:  { shape: "circle",   color: "#3b82f6", name: "SCOUT" },
    market: { shape: "blob",     color: "#3ddc84", name: "MARKET" },
    chain:  { shape: "square",   color: "#ff5a6e", name: "DOSSIER" },
    jevm:   { shape: "triangle", color: "#ff4fb8", name: "JEV·MKT" },
    jevt:   { shape: "diamond",  color: "#2dd4bf", name: "JEV·TXT" },
    pick:   { shape: "spiky",    color: "#ffa62b", name: "PICK" },
    score:  { shape: "bean",     color: "#b98cff", name: "SCORE" },
  };

  const SIT = 21;                                  // character's feet, below its desk top
  let cv, ctx, art, a, scale = 1, offX = 0;
  let S = null, candles = [], active = null, running = false;
  const seed = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

  // --- tiny drawing kit -----------------------------------------------------
  const R = (x, y, w, h, c) => { a.fillStyle = c; a.fillRect(x | 0, y | 0, w | 0, h | 0); };
  function disc(cx, cy, r, c) {
    a.fillStyle = c;
    for (let y = -r; y <= r; y++) {
      const w = Math.round(Math.sqrt(r * r - y * y));
      a.fillRect(cx - w, cy + y, w * 2 + 1, 1);
    }
  }
  function tri(cx, by, w, h, c) {
    a.fillStyle = c;
    for (let i = 0; i < h; i++) {
      const half = Math.round((w / 2) * (i / (h - 1)));
      a.fillRect(cx - half, by - h + i, half * 2 + 1, 1);
    }
  }
  function diamond(cx, cy, r, c) {
    a.fillStyle = c;
    for (let y = -r; y <= r; y++) { const w = r - Math.abs(y); a.fillRect(cx - w, cy + y, w * 2 + 1, 1); }
  }
  function shade(hex, f) {          // lighten (f>0) or darken (f<0) a #rrggbb color
    const n = parseInt(hex.slice(1), 16);
    const ch = (s) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) + 255 * f)));
    return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
  }

  // --- the room ------------------------------------------------------------
  function room(t) {
    R(0, 0, W, 80, C.wall);
    for (let x = 0; x < W; x += 22) R(x, 0, 1, 80, C.wallLine);          // wall panels
    R(0, 78, W, 3, C.trim);                                              // baseboard
    R(0, 81, W, H - 81, C.floor);
    for (let y = 92; y < H; y += 14) R(0, y, W, 1, C.tile);               // floor tiles
    for (let x = 6; x < W; x += 28) R(x, 81, 1, H - 81, C.tile);
  }

  function wallScreen(t) {
    const x = 128, y = 8, w = 184, h = 60;
    R(x - 3, y - 3, w + 6, h + 6, C.frame); R(x, y, w, h, C.screen);
    R(x, y, w, 7, "#0d111b");                                             // title strip
    const cs = candles.length ? candles.slice(-46) : null;
    if (cs) {
      const lo = Math.min(...cs.map((c) => c[3])), hi = Math.max(...cs.map((c) => c[2]));
      const Y = (p) => y + 10 + (hi - p) / ((hi - lo) || 1) * (h - 14);
      cs.forEach(([, o, hh, l, c], i) => {
        const cx = x + 3 + i * 4, col = c >= o ? C.green : "#ff7a45";
        R(cx + 1, Y(hh), 1, Math.max(1, Y(l) - Y(hh)), col);
        R(cx, Math.min(Y(o), Y(c)), 3, Math.max(1, Math.abs(Y(o) - Y(c))), col);
      });
    } else {                                                              // idle: slow sine "chart"
      for (let i = 0; i < 46; i++) {
        const v = Math.sin(i / 5 + t / 3) * 10 + Math.sin(i / 2.3) * 4;
        R(x + 3 + i * 4, y + 34 - v, 3, 3, i % 3 ? "#1d5c3a" : "#5c2a1d");
      }
    }
    if (running) R(x + w - 6, y + 2, 3, 3, Math.floor(t * 2) % 2 ? C.red : "#5a1f28");   // REC light
  }

  function banner(x, y) {
    R(x, y, 14, 38, "#0f1220"); R(x, y, 14, 2, C.frame);
    R(x + 1, y + 38, 3, 3, "#0f1220"); R(x + 10, y + 38, 3, 3, "#0f1220");
    diamond(x + 7, y + 18, 4, C.pink); diamond(x + 7, y + 18, 2, C.dark);
  }

  function leftWall(t) {
    // the desk's mark
    R(14, 10, 46, 30, "#0e1220"); R(14, 10, 46, 2, C.frame);
    diamond(37, 24, 9, C.pink); diamond(37, 24, 5, "#0e1220"); diamond(37, 24, 2, C.white);
    // a little candle wall-board
    R(10, 46, 54, 28, "#0b0e17"); R(10, 46, 54, 2, C.frame);
    for (let i = 0; i < 12; i++) {
      const hgt = 4 + Math.round(seed(i + Math.floor(t / 4)) * 14);
      R(13 + i * 4, 72 - hgt, 2, hgt, seed(i * 3) > 0.45 ? C.green : C.red);
    }
  }

  function rightWall(t) {
    R(338, 18, 36, 16, "#0b0e17"); R(338, 18, 36, 2, C.frame);           // clock (text overlay)
    R(380, 8, 54, 46, "#0e1220"); R(380, 8, 54, 2, C.frame);             // today board
  }

  function plant(x, y) {
    R(x - 5, y - 6, 10, 7, C.pot); R(x - 6, y - 7, 12, 2, shade(C.pot, .08));
    const leaves = [[0, -16], [-6, -13], [6, -13], [-3, -20], [3, -21], [-8, -9], [8, -9]];
    leaves.forEach(([dx, dy], i) => diamond(x + dx, y + dy, 3, i % 2 ? C.plant : C.plantDark));
  }

  function couch() {                                                   // the break corner
    R(62, 184, 56, 9, C.couch); R(58, 178, 6, 15, shade(C.couch, .04)); R(116, 178, 6, 15, shade(C.couch, .04));
    R(64, 178, 52, 7, shade(C.couch, .06));
    R(70, 195, 40, 3, "#151a28");                                        // rug
  }

  function serverRack(t) {
    R(410, 100, 22, 74, "#141826"); R(410, 100, 22, 2, C.frame);
    for (let i = 0; i < 9; i++) {
      R(413, 105 + i * 7, 16, 5, "#0b0e17");
      const on = running ? seed(i + Math.floor(t * 6)) > 0.35 : seed(i) > 0.7;
      R(415, 107 + i * 7, 2, 1, on ? C.green : "#1d3a2a");
      R(419, 107 + i * 7, 2, 1, on && seed(i * 7 + Math.floor(t * 4)) > 0.6 ? "#38d9f5" : "#162a33");
    }
  }

  function rejectBin(t, n) {
    R(14, 156, 34, 26, "#191d2b"); R(12, 152, 38, 5, "#232838");
    for (let i = 0; i < Math.min(6, n); i++) R(18 + i * 5, 150 - (i % 2) * 2, 3, 3, C.red);   // papers poking out
    R(20, 164, 22, 2, "#2a3046"); R(20, 169, 22, 2, "#2a3046");
  }

  function scoreboard(t) {
    R(386, 176, 22, 8, "#1b2030");                                       // pedestal
    R(391, 166, 12, 10, "#262c3f");
    // trophy rocket
    R(395, 145, 4, 17, "#cfd3e1"); tri(397, 145, 6, 7, "#ff5a6e");
    R(392, 156, 3, 6, "#ff5a6e"); R(399, 156, 3, 6, "#ff5a6e");
    if (Math.floor(t * 8) % 2) R(396, 162, 2, 3, "#ffa62b");
  }

  function desk(id, x, y, t) {
    const color = CHARS[id].color, on = active === id;
    R(x - 11, y - 18, 22, 15, on ? shade(color, -.35) : C.frame);         // monitor bezel
    R(x - 9, y - 16, 18, 11, C.screen);
    for (let i = 0; i < 6; i++) {                                         // live-ish bars
      const hgt = 1 + Math.round(seed(i + x + Math.floor(t * (on ? 6 : 1.5))) * 8);
      R(x - 8 + i * 3, y - 6 - hgt, 2, hgt, on ? color : shade(color, -.45));
    }
    R(x - 2, y - 3, 4, 3, C.frame);                                       // stand
    R(x - 22, y, 44, 4, C.woodTop); R(x - 22, y + 4, 44, 3, C.wood);      // desk
    R(x - 20, y + 7, 3, 9, C.leg); R(x + 17, y + 7, 3, 9, C.leg);
    R(x - 6, y + 1, 12, 2, "#323a52");                                    // keyboard
    R(x - 8, y + 12, 16, 8, C.chair); R(x - 8, y + 12, 16, 1, shade(C.chair, .05));   // chair back
  }

  function headDesk(t) {
    R(356, 104, 52, 4, C.woodTop); R(356, 108, 52, 4, C.wood);
    R(358, 112, 3, 12, C.leg); R(403, 112, 3, 12, C.leg);
    R(362, 100, 10, 4, "#2a3046"); R(390, 98, 12, 6, "#e8eaf2"); R(391, 99, 10, 1, "#9aa1b5");  // phone, papers
  }

  // --- characters ------------------------------------------------------------
  function character(id, x, y, t) {
    const ch = CHARS[id], on = active === id, k = Object.keys(CHARS).indexOf(id);
    const bob = Math.round(Math.sin(t * (on ? 9 : 2) + k) * (on ? 2 : 1));
    const cy = y - 6 + (on ? -Math.abs(Math.round(Math.sin(t * 6 + k) * 3)) : 0) + bob;
    const col = ch.color, dark = shade(col, -.25);
    // shadow
    a.globalAlpha = 0.35; R(x - 6, y + 1, 12, 2, "#000"); a.globalAlpha = 1;
    if (on) { a.globalAlpha = 0.18 + 0.1 * Math.sin(t * 8); disc(x, cy, 11, col); a.globalAlpha = 1; }
    switch (ch.shape) {
      case "circle": disc(x, cy, 6, dark); disc(x, cy - 1, 5, col); break;
      case "blob": R(x - 6, cy - 5, 12, 10, col); R(x - 5, cy - 6, 10, 1, col); R(x - 7, cy - 3, 1, 6, col);
        R(x + 6, cy - 3, 1, 6, col); R(x - 6, cy + 4, 12, 1, dark); break;
      case "square": R(x - 6, cy - 6, 12, 12, dark); R(x - 6, cy - 6, 12, 10, col); break;
      case "triangle": tri(x, cy + 6, 15, 13, dark); tri(x, cy + 5, 13, 12, col); break;
      case "diamond": diamond(x, cy, 7, dark); diamond(x, cy - 1, 6, col); break;
      case "spiky": {
        disc(x, cy, 5, col);
        const sp = [[0, -8], [6, -5], [8, 1], [5, 6], [-5, 6], [-8, 1], [-6, -5]];
        sp.forEach(([dx, dy]) => R(x + dx - 1, cy + dy - 1, 2, 2, col));
        break;
      }
      case "bean": R(x - 4, cy - 8, 8, 15, col); R(x - 3, cy - 9, 6, 1, col); R(x - 4, cy + 6, 8, 1, dark); break;
      case "ghost": {
        disc(x, cy - 2, 7, col); R(x - 7, cy - 2, 15, 8, col);
        for (let i = 0; i < 4; i++) R(x - 7 + i * 4, cy + 6, 2, 2, col);          // wavy hem
        a.fillStyle = "#3a4058"; a.fillRect(x - 8, cy - 7, 1, 6); a.fillRect(x + 8, cy - 7, 1, 6);
        a.fillRect(x - 7, cy - 9, 15, 1);                                         // headset
        R(x + 8, cy - 1, 3, 1, "#3a4058"); R(x + 10, cy - 1, 1, 2, C.pink);       // mic
        break;
      }
    }
    // eyes, with a blink every few seconds
    const blink = (t + k * 1.7) % 4.2 < 0.13;
    const ey = cy - (ch.shape === "triangle" ? -1 : 2);
    for (const dx of [-3, 2]) {
      if (blink) R(x + dx, ey + 1, 2, 1, C.dark);
      else { R(x + dx, ey, 2, 2, "#fff"); R(x + dx + (on ? 1 : 0), ey + 1, 1, 1, C.dark); }
    }
    if (on && Math.floor(t * 5) % 2) R(x + 9, cy - 9, 2, 2, col);              // busy sparkle
    return { x, y: y + 6 };                                                      // name-tag anchor (under the feet)
  }

  // --- frame ------------------------------------------------------------------
  function frame(ts) {
    const t = ts / 1000;
    room(t); leftWall(t); wallScreen(t); banner(108, 12); banner(318, 12); rightWall(t);
    plant(84, 110); plant(334, 134); plant(132, 196); plant(330, 196);
    rejectBin(t, S ? (S._rejectsToday || 0) : 0);
    scoreboard(t); serverRack(t); headDesk(t); couch();
    const tags = {};
    for (const [id, d] of Object.entries(DESKS)) desk(id, d.x, d.y, t);
    tags.desk = character("desk", SPOTS.desk.x, SPOTS.desk.y, t);
    for (const [id, d] of Object.entries(DESKS)) tags[id] = character(id, d.x, d.y + SIT, t);
    tags.score = character("score", SPOTS.score.x, SPOTS.score.y, t);

    // blit the art, then text at full resolution
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(art, offX, 0, W * scale, H * scale);
    text(tags, t);
    requestAnimationFrame(frame);
  }

  function label(s, x, y, color, size = 9, align = "center", bg = null) {
    const px = offX + x * scale, py = y * scale;
    size = size * scale * 0.5 / devicePixelRatio;              // text grows with the room
    ctx.font = `700 ${size * devicePixelRatio}px ui-monospace, Menlo, Consolas, monospace`;
    ctx.textAlign = align; ctx.textBaseline = "middle";
    if (bg) {
      const w = ctx.measureText(s).width + 8 * devicePixelRatio, h = (size + 5) * devicePixelRatio;
      const bx = align === "center" ? px - w / 2 : align === "right" ? px - w : px - 4 * devicePixelRatio;
      ctx.fillStyle = bg; ctx.fillRect(bx, py - h / 2, w, h);
    }
    ctx.fillStyle = color; ctx.fillText(s, px, py);
  }

  function text(tags, t) {
    for (const [id, p] of Object.entries(tags)) {
      const on = active === id;
      label(CHARS[id].name, p.x, p.y, on ? "#0b0d14" : CHARS[id].color, 7, "center",
            on ? CHARS[id].color : "rgba(6,8,13,.75)");
    }
    const now = new Date();
    label(now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), 356, 27, C.green, 10);
    label("LOCAL TIME", 356, 40, "#7d8499", 6.5);
    // today board
    const today = S ? [
      `TODAY`, `${S.desk.cycles_today} cycles`, `${S._judgedToday || 0} judged`,
      `${S._picksToday || 0} picks`, `jev $${(S.jev_today?.cost || 0).toFixed(3)}`] : ["TODAY"];
    today.forEach((s, i) => label(s, 384, 15 + i * 8, i ? "#cfd3e1" : "#ff4fb8", 6.5, "left"));
    // wall screen caption
    const f = S && (S.finalists || []).find((x) => x.addr === S._selected) || (S && S.finalists?.[0]);
    label(f ? `${String(f.ticker).slice(0, 14)} · 5m` : "waiting for a finalist", 132, 11.5, "#9aa1b5", 6.5, "left");
    label(running ? "● LIVE" : "IDLE", 308, 11.5, running ? C.red : "#5d6480", 6.5, "right");
    // fixtures
    label("REJECTED", 31, 186, "#7d8499", 6, "center");
    if (S) label(String(S._rejectsToday || 0), 31, 166, C.red, 9, "center");
    label("SCOREBOARD", 397, 188, "#7d8499", 6, "center");
    const sc = S?.score?.by_verdict?.all?.["1h"];
    if (sc?.n) label(`1h ${sc.avg >= 0 ? "+" : ""}${sc.avg.toFixed(1)}%`, 397, 131, sc.avg >= 0 ? C.green : C.red, 7);
  }

  function resize() {
    const r = cv.getBoundingClientRect();
    cv.width = Math.round(r.width * devicePixelRatio);
    scale = cv.width / W;
    cv.height = Math.round(H * scale);
    cv.style.height = `${cv.height / devicePixelRatio}px`;
    offX = 0;
  }

  return {
    init(canvas) {
      cv = canvas; ctx = cv.getContext("2d");
      art = document.createElement("canvas"); art.width = W; art.height = H; a = art.getContext("2d");
      resize(); addEventListener("resize", resize);
      requestAnimationFrame(frame);
    },
    update(state, opts = {}) {
      S = state; running = !!state.desk?.running; active = opts.active ?? null;
    },
    setCandles(cs) { candles = cs || []; },
    // stage id -> page coordinates of that character (step 3: the spider walks here)
    layout() {
      const r = cv.getBoundingClientRect(), k = r.width / W, out = {};
      for (const [id, d] of Object.entries(DESKS)) out[id] = { x: r.left + d.x * k, y: r.top + (d.y + SIT - 8) * k };
      for (const [id, d] of Object.entries(SPOTS)) out[id] = { x: r.left + d.x * k, y: r.top + d.y * k };
      return out;
    },
  };
})();
