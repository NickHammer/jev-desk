// The Floor: a detailed pixel-art office drawn entirely in code (no image files).
// The room is painted on a low-resolution canvas and scaled up with smoothing off, so
// it keeps a crisp pixel look; text is drawn afterwards at full resolution so it stays
// readable. The room is 300 art-pixels tall and as wide as the panel, so it always
// fills the space: the desk cluster stays centred and the side areas stretch. On a
// narrow screen the room keeps its minimum width and the ceiling gets higher instead.
//
// Style: outlines, three-tone shading, rim light, monitor light spilling onto desks and
// faces, perspective floor, faint scanlines and vignette.
//
// Public API (used by app.js):
//   Office.init(canvasElement, chipsElement)
//   Office.update(state, {active})   latest /api/state and the stage that is working
//   Office.setCandles(candles)       5-minute candles for the wall screen
//   Office.event(e)                  one live event from /api/events: animate it
//   Office.replay(events, cycle)     play a finished cycle again, labelled REPLAY
//   Office.busy()                    true while anything is still animating
//   Office.tv(on, videos)            turn the break-corner TV on (with YouTube video ids) or off
//   Office.onTvClick = fn            called when the TV or its remote is clicked on the floor
//   Office.layout()                  stage id -> {x, y} in page coordinates
//
// The show: every event becomes a step (a speech bubble, a walk, or a trip for the
// courier cat, an orange cosmic kitten who flies work between desks). Steps play one after another; when events arrive
// faster than they can be shown, steps speed up instead of falling behind.

const Office = (() => {
  const ROOM = 300, MIN_W = 680, O = 18, SZ = 36; // room height; sprite size and centre
  let W = 820, H = ROOM, TOP = 0;                  // TOP: extra wall above when the panel is tall and narrow
  const C = {
    outline: "#070910", wallTop: "#181c2d", wallBot: "#10131f", seam: "#1d2337", seamDark: "#0c0f18",
    trim: "#2a3146", trimDark: "#0a0c13", floorTop: "#131623", floorBot: "#090b11", plank: "#171b2a",
    bezel: "#2b3247", bezelHi: "#3a4360", bezelDark: "#0a0c12", screen: "#050810",
    deskTop: "#2d3550", deskHi: "#3d4767", deskFront: "#1d2234", deskDark: "#11141f", leg: "#141826",
    chair: "#151927", chairHi: "#232a3d", key: "#3a4462", keyHi: "#56638a",
    green: "#3ddc84", red: "#ff5a6e", pink: "#ff4fb8", cyan: "#38d9f5", orange: "#ffa62b",
    white: "#f4f6ff", paper: "#d8dbe6", pot: "#3a3f52", board: "#0b0e18", boardEdge: "#262d42",
    muted: "#7d8499", text: "#cfd3e1",
  };
  const CHARS = {
    desk:   { shape: "ghost",    color: "#e9ecf6", name: "DESK",    acc: "headset" },
    scout:  { shape: "circle",   color: "#3b82f6", name: "SCOUT",   acc: "antenna" },
    market: { shape: "blob",     color: "#3ddc84", name: "MARKET",  acc: "tie" },
    chain:  { shape: "square",   color: "#ff5a6e", name: "DOSSIER", acc: "glasses" },
    jevm:   { shape: "triangle", color: "#ff4fb8", name: "JEV·MKT", acc: "halo" },
    jevt:   { shape: "diamond",  color: "#2dd4bf", name: "JEV·TXT", acc: "halo" },
    pick:   { shape: "spiky",    color: "#ffa62b", name: "PICK",    acc: "star" },
    score:  { shape: "bean",     color: "#b98cff", name: "SCORE",   acc: "clipboard" },
  };
  const ORDER = Object.keys(CHARS);
  const DESK_ROW = ["scout", "market", "chain", "jevm", "jevt", "pick"];
  // eyes (y and left x of each eye, eye width) and where the arms attach, per body shape
  const EYES = {
    circle: { y: -4, xs: [-5, 2], w: 4 }, blob: { y: -4, xs: [-5, 2], w: 4 },
    square: { y: -4, xs: [-5, 2], w: 4 }, triangle: { y: 1, xs: [-4, 1], w: 3 },
    diamond: { y: -3, xs: [-4, 1], w: 3 }, spiky: { y: -3, xs: [-4, 1], w: 3 },
    bean: { y: -5, xs: [-4, 1], w: 3 }, ghost: { y: -5, xs: [-5, 2], w: 4 },
  };
  const ARMX = { circle: 12, blob: 12, square: 11, triangle: 10, diamond: 9, spiky: 9, bean: 8, ghost: 12 };

  let cv, ctx, art, a, bg, overlay, chipsEl, tvEl, scale = 1, P = null;
  let S = null, candles = [], active = null, stateActive = null, running = false;
  const sprites = {};
  const seed = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x); };

  // --- drawing kit -------------------------------------------------------------
  let g = null;                                    // current target context
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
  function ellipse(cx, cy, rx, ry, c) {
    g.fillStyle = c;
    for (let y = -ry; y <= ry; y++) {
      const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
      g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2 + 1, 1);
    }
  }
  function ring(cx, cy, rx, ry, c) {
    g.fillStyle = c;
    for (let i = 0; i < 40; i++) {
      const th = (i / 40) * Math.PI * 2;
      g.fillRect(Math.round(cx + Math.cos(th) * rx), Math.round(cy + Math.sin(th) * ry), 1, 1);
    }
  }
  function line(x0, y0, x1, y1, c) {
    g.fillStyle = c;
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 400; n++) {
      g.fillRect(x0, y0, 1, 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
  function tri(cx, by, w, h, c) {                   // upward triangle, base at by
    g.fillStyle = c;
    for (let i = 0; i < h; i++) {
      const half = Math.round((w / 2) * (i / Math.max(1, h - 1)));
      g.fillRect(Math.round(cx - half), Math.round(by - h + i), half * 2 + 1, 1);
    }
  }
  function diamond(cx, cy, r, c) {
    g.fillStyle = c;
    for (let y = -r; y <= r; y++) { const w = r - Math.abs(y); g.fillRect(cx - w, cy + y, w * 2 + 1, 1); }
  }
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function shade(hex, f) {                         // lighten (f>0) or darken (f<0)
    const [r, gg, b] = rgb(hex), ch = (v) => Math.max(0, Math.min(255, Math.round(v + 255 * f)));
    return `rgb(${ch(r)},${ch(gg)},${ch(b)})`;
  }
  const rgba = (hex, al) => { const [r, gg, b] = rgb(hex); return `rgba(${r},${gg},${b},${al})`; };
  function glow(x, y, r, hex, al) {                // additive light
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(hex, al)); gr.addColorStop(1, rgba(hex, 0));
    g.globalCompositeOperation = "lighter"; g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    g.globalCompositeOperation = "source-over";
  }
  function shadow(cx, cy, rx, ry, al = 0.45) { g.globalAlpha = al; ellipse(cx, cy, rx, ry, "#000"); g.globalAlpha = 1; }
  function board(x, y, w, h) {                     // a framed panel hung on the wall
    g.globalAlpha = 0.35; R(x + 2, y + h + 1, w, 2, "#000"); g.globalAlpha = 1;
    R(x - 1, y - 1, w + 2, h + 2, C.outline); R(x, y, w, h, C.boardEdge);
    R(x, y, w, 1, "#353d58"); R(x + 2, y + 2, w - 4, h - 4, C.board);
  }

  // --- body shapes (x, y relative to the centre, s = size) ----------------------
  const SHAPES = {
    circle: (x, y, s) => (x * x) / (s * s) + (y * y) / ((s - 1) * (s - 1)) <= 1,
    blob: (x, y, s) => Math.pow(Math.abs(x) / (s + 0.5), 2.6) + Math.pow(Math.abs(y) / (s - 0.5), 2.6) <= 1
      && y <= s - 2 + Math.sin(x * 0.9) * 0.8,
    square: (x, y, s) => {
      const e = s - 1, r = 3.5, qx = Math.max(Math.abs(x) - (e - r), 0), qy = Math.max(Math.abs(y) - (e - r), 0);
      return qx * qx + qy * qy <= r * r;
    },
    triangle: (x, y, s) => {
      const top = -s - 1, bot = s - 1;
      if (y < top || y > bot) return false;
      const half = 0.6 + ((y - top) / (bot - top)) * (s + 1.5);
      if (Math.abs(x) > half) return false;
      if (y > bot - 2.5 && Math.abs(x) > half - 2.5) {
        const dx = Math.abs(x) - (half - 2.5), dy = y - (bot - 2.5);
        return dx * dx + dy * dy <= 6.25;
      }
      return true;
    },
    diamond: (x, y, s) => Math.pow(Math.abs(x) / (s + 1), 1.15) + Math.pow(Math.abs(y) / (s + 1.5), 1.15) <= 1,
    spiky: (x, y, s) => {
      const d = Math.hypot(x, y), th = Math.atan2(y, x);
      return d <= s - 3.2 + 3.8 * Math.pow(Math.max(0, Math.cos(7 * (th + Math.PI / 2))), 3);
    },
    bean: (x, y, s) => {
      const w = s * 0.66, hh = s * 0.45, ay = Math.abs(y);
      if (ay <= hh) return Math.abs(x) <= w;
      const dy = ay - hh; return x * x + dy * dy <= w * w;
    },
    ghost: (x, y, s) => {
      if (y <= 0) return x * x + y * y <= s * s;
      if (Math.abs(x) > s) return false;
      return y <= s - 1.5 + Math.cos(((x + s) / s) * Math.PI * 2) * 1.4;
    },
  };

  // each character's body is rendered once into a small sprite: outline, deep, dark,
  // mid and light tones, a rim light on top and a specular dot
  function makeSprite(id) {
    const ch = CHARS[id], f = SHAPES[ch.shape], s = 12;
    const c = document.createElement("canvas"); c.width = c.height = SZ;
    const prev = g; g = c.getContext("2d");
    const base = ch.color, dark = shade(base, -0.2), deep = shade(base, -0.36),
          light = shade(base, 0.2), rim = shade(base, 0.34);
    for (let py = 0; py < SZ; py++) for (let px = 0; px < SZ; px++) {
      const x = px - O + 0.5, y = py - O + 0.5;
      if (!f(x, y, s + 1)) continue;
      let col;
      if (!f(x, y, s)) col = C.outline;
      else if (y < 0 && !f(x, y - 1.3, s)) col = rim;
      else if (((x + s * 0.38) ** 2) / ((s * 0.3) ** 2) + ((y + s * 0.42) ** 2) / ((s * 0.2) ** 2) <= 1
               && f(x, y, s - 1.5)) col = light;
      else if (y > 0 && !f(x, y + 2.2, s)) col = deep;
      else if (f(x + 1, y + 1.5, s - 1.5)) col = base;
      else col = dark;
      R(px, py, 1, 1, col);
    }
    const sx = Math.round(O - s * 0.5), sy = Math.round(O - s * 0.62);
    if (f(sx - O + 0.5, sy - O + 0.5, s - 1)) R(sx, sy, 2, 1, "#ffffff");
    // fixed accessories
    switch (ch.acc) {
      case "antenna": line(O, O - s + 1, O + 2, O - s - 4, C.outline); break;
      case "tie":
        R(O - 2, O + 3, 4, 2, C.outline); R(O - 1, O + 3, 2, 1, "#24304f");
        for (let i = 0; i < 5; i++) R(O - 1 - (i > 1 ? 1 : 0), O + 5 + i, 2 + (i > 1 ? 2 : 0), 1, i === 4 ? C.outline : "#24304f");
        R(O, O + 5, 1, 3, "#3b4a75"); break;
      case "star": diamond(O + 5, O + 5, 2, "#fff3c4"); R(O + 5, O + 5, 1, 1, "#ffd166"); break;
      case "clipboard":
        R(O + 3, O - 1, 9, 12, C.outline); R(O + 4, O, 7, 10, "#8a6a45"); R(O + 5, O + 1, 5, 8, "#e8eaf2");
        R(O + 6, O - 2, 3, 2, "#9aa1b5");
        for (let i = 0; i < 3; i++) R(O + 6, O + 3 + i * 2, 3, 1, "#8b91a8"); break;
      case "headset":
        for (let x = -s; x <= s; x++) {             // band over the top of the head
          const y = -Math.sqrt(Math.max(0, (s + 1) ** 2 - x * x));
          if (Math.abs(x) > 3) R(O + x, O + Math.round(y) - 1, 1, 1, "#3a4058");
        }
        R(O - s - 2, O - 6, 3, 6, C.outline); R(O - s - 1, O - 5, 2, 4, "#4a5170");
        R(O + s, O - 6, 3, 6, C.outline); R(O + s, O - 5, 2, 4, "#4a5170");
        line(O + s, O - 1, O + 5, O + 3, "#3a4058"); break;
    }
    g = prev;
    return c;
  }

  // --- the room (cached; rebuilt when the panel resizes) -------------------------
  function positions() {
    const cx = Math.round(W / 2), sp = 108, L = cx - 172, Rz = cx + 172, Rw = W - Rz;
    const desks = {};
    DESK_ROW.forEach((id, i) => { desks[id] = { x: cx + ((i % 3) - 1) * sp, y: i < 3 ? 150 : 236 }; });
    const lb = Math.min(L - 26, 210);
    return {
      cx, L, Rz, Rw, desks,
      screen: { x: cx - 130, y: 10, w: 260, h: 76 },
      banners: [cx - 152, cx + 138],
      finalists: { x: 12, y: 12, w: lb, h: 46 },
      verdicts: { x: 12, y: 66, w: lb, h: 22 },
      clock: { x: Rz + 8, y: 14, w: 58, h: 32 },
      today: { x: Rz + 74, y: 10, w: Math.min(Rw - 84, 136), h: 70 },
      head: { x: Math.round(Rz + Rw * 0.36), y: 150 },
      rack: { x: W - 38, y: 102, w: 28, h: 130 },
      score: { x: Math.round(Rz + Rw * 0.2), y: 280 },
      scoreboard: { x: Math.round(Rz + Rw * 0.6), y: 214 },
      ...leftCorner(L),
      plants: [[Math.round(L * 0.88), 160], [Math.round(L * 0.95), 292], [W - 18, 294],
               [Math.round(Rz - 6), 292]],
    };
  }

  // The break corner: a TV on a low cabinet with the couch in front of it, and the
  // reject bin beside them. Without room for a TV the corner keeps the old layout.
  function leftCorner(L) {
    const avail = L - 24;
    if (avail < 130) {
      return { bin: { x: Math.round(Math.max(30, L * 0.2)), y: 238 },
               couch: { x: Math.round(L * 0.5), y: 290 }, tv: null,
               cooler: L > 230 ? { x: Math.round(L * 0.62), y: 168 } : null };
    }
    const sw = Math.min(avail - 46, 220), sh = Math.round((sw * 9) / 16);
    const tx = 18, ty = 248 - sh - 6;
    return {
      tv: { x: tx, y: ty, w: sw, h: sh },               // the screen; bezel and cabinet go around it
      remote: { x: tx + Math.round(sw / 2) + 20, y: 276 },
      couch: { x: tx + Math.round(sw / 2), y: 290 },
      bin: { x: tx + sw + 26, y: 238 },
      cooler: null,
    };
  }

  function buildBackground() {
    bg = document.createElement("canvas"); bg.width = W; bg.height = H;
    const prev = g; g = bg.getContext("2d"); g.translate(0, TOP);
    // wall: gradient, panel seams, wainscot, baseboard
    for (let y = -TOP; y < 100; y++) R(0, y, W, 1, shade(C.wallTop, -Math.max(0, y) / 1100));
    R(0, -TOP, W, 5, "#0b0d15"); R(0, 5 - TOP, W, 1, "#232a3e");             // ceiling edge
    for (let x = 0; x < W; x += 32) { R(x, 6 - TOP, 1, 64 + TOP, C.seam); R(x + 1, 6 - TOP, 1, 64 + TOP, C.seamDark); }
    R(0, 70, W, 2, "#262d43"); R(0, 72, W, 1, "#0c0f18");                   // chair rail
    for (let y = 73; y < 96; y++) R(0, y, W, 1, shade("#141827", -(y - 73) / 600));
    for (let x = 16; x < W; x += 64) { R(x, 76, 40, 1, "#1f2538"); R(x, 92, 40, 1, "#0c0f18"); R(x, 76, 1, 16, "#1f2538"); R(x + 40, 76, 1, 17, "#0c0f18"); }
    R(0, 96, W, 2, C.trim); R(0, 98, W, 2, C.trimDark);
    // floor: gradient, perspective planks
    for (let y = 100; y < ROOM; y++) R(0, y, W, 1, shade(C.floorTop, -(y - 100) / 1500));
    let yy = 104, gap = 6;
    while (yy < ROOM) { R(0, Math.round(yy), W, 1, C.plank); yy += gap; gap *= 1.16; }
    const cx = P.cx;
    for (let x0 = cx % 40 - 40 * 30; x0 < W + 40 * 30; x0 += 40)
      for (let y = 100; y < ROOM; y += 1) {
        const x = cx + (x0 - cx) * (y + 260) / 360;
        if (x >= 0 && x < W) R(x, y, 1, 1, C.plank);
      }
    // a rug under the six desks
    for (let y = 136; y < 298; y++) {
      const half = 180 + (y - 136) * 0.16, x0 = cx - half, w = half * 2;
      const edge = y < 138 || y > 295;
      R(x0, y, w, 1, edge ? "#2a1730" : "#17142a");
      if (!edge) { R(x0, y, 2, 1, "#2a1730"); R(x0 + w - 2, y, 2, 1, "#2a1730"); }
      if (y === 142 || y === 291) R(x0 + 6, y, w - 12, 1, "#3a1f40");
    }
    // ceiling lamps and the pools of light under them
    for (const dx of [-108, 0, 108]) {
      R(cx + dx, 5 - TOP, 1, TOP, "#1d2232");                             // cord, if the ceiling is higher
      R(cx + dx - 8, 5, 16, 2, "#2d3550"); R(cx + dx - 5, 7, 10, 1, "#fff5d6");
      glow(cx + dx, 8, 26, "#fff1c9", 0.12);
      g.save(); g.translate(cx + dx, 192); g.scale(1, 0.32); glow(0, 0, 80, "#fff1c9", 0.07); g.restore();
    }
    // wall screen frame and mount
    const s = P.screen;
    g.globalAlpha = 0.4; R(s.x + 4, s.y + s.h + 3, s.w, 3, "#000"); g.globalAlpha = 1;
    R(s.x - 4, s.y - 4, s.w + 8, s.h + 8, C.outline); R(s.x - 3, s.y - 3, s.w + 6, s.h + 6, C.bezel);
    R(s.x - 3, s.y - 3, s.w + 6, 1, C.bezelHi); R(s.x, s.y, s.w, s.h, C.screen);
    // banners with the desk's diamond mark
    for (const bx of P.banners) {
      R(bx - 1, 11, 16, 2, C.outline); R(bx, 12, 14, 42, C.outline); R(bx + 1, 13, 12, 40, "#121528");
      R(bx + 1, 13, 1, 40, "#1d2140"); R(bx + 1, 53, 4, 4, "#121528"); R(bx + 9, 53, 4, 4, "#121528");
      diamond(bx + 7, 32, 5, C.pink); diamond(bx + 7, 32, 3, "#121528"); diamond(bx + 7, 32, 1, C.white);
    }
    // boards
    for (const k of ["finalists", "verdicts", "clock", "today"]) { const b = P[k]; if (b.w > 20) board(b.x, b.y, b.w, b.h); }
    g = prev;
  }

  function buildOverlay() {
    overlay = document.createElement("canvas"); overlay.width = W; overlay.height = H;
    const o = overlay.getContext("2d");
    o.fillStyle = "rgba(0,0,0,.07)";
    for (let y = 0; y < H; y += 2) o.fillRect(0, y, W, 1);
    const v = o.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, W * 0.62);
    v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,.42)");
    o.fillStyle = v; o.fillRect(0, 0, W, H);
  }

  // --- wall things that change ------------------------------------------------------
  function wallScreen(t) {
    const s = P.screen;
    R(s.x, s.y, s.w, 9, "#0d111b");
    for (let y = s.y + 14; y < s.y + s.h; y += 12) R(s.x + 2, y, s.w - 4, 1, "#0b1019");   // grid
    const cs = candles.length ? candles.slice(-62) : null;
    if (cs) {
      const lo = Math.min(...cs.map((c) => c[3])), hi = Math.max(...cs.map((c) => c[2]));
      const Y = (p) => s.y + 13 + ((hi - p) / ((hi - lo) || 1)) * (s.h - 18);
      cs.forEach(([, o, hh, l, c], i) => {
        const x = s.x + 5 + i * 4, up = c >= o, col = up ? C.green : "#ff7a45";
        R(x + 1, Y(hh), 1, Math.max(1, Y(l) - Y(hh)), shade(up ? C.green : "#ff7a45", -0.2));
        R(x, Math.min(Y(o), Y(c)), 3, Math.max(1, Math.abs(Y(o) - Y(c))), col);
      });
      const last = cs[cs.length - 1][4], ly = Y(last);
      for (let x = s.x + 2; x < s.x + s.w - 2; x += 3) R(x, ly, 2, 1, "rgba(255,255,255,.25)");
    } else {                                                           // idle: slow sine chart
      for (let i = 0; i < 62; i++) {
        const v = Math.sin(i / 5 + t / 3) * 12 + Math.sin(i / 2.3) * 4;
        R(s.x + 5 + i * 4, s.y + 44 - v, 3, 3, i % 3 ? "#1d5c3a" : "#5c2a1d");
      }
    }
    R(s.x, s.y + 9, s.w, 1, "rgba(255,255,255,.05)");
    for (let i = 0; i < 18; i++) R(s.x + 30 + i * 2, s.y + 10 + i, 2, 1, "rgba(255,255,255,.025)");  // glass glare
    glow(s.x + s.w / 2, s.y + s.h / 2, 120, "#3ddc84", running ? 0.07 : 0.04);
    if (running) R(s.x + s.w - 7, s.y + 3, 3, 3, Math.floor(t * 2) % 2 ? C.red : "#5a1f28");
  }

  function verdictBoard() {                        // one square per token judged today
    const b = P.verdicts; if (b.w < 30) return;
    const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    const today = (S?.score?.series || []).filter((r) => r.t * 1000 >= midnight.getTime() && r.verdict !== "control");
    const cols = { pick: C.orange, pass: C.green, reject: C.red };
    const n = Math.floor((b.w - 60) / 5);
    for (let i = 0; i < n; i++) {
      const r = today[today.length - n + i];
      R(b.x + 56 + i * 5, b.y + 8, 4, 6, r ? cols[r.verdict] || C.muted : "#161b2a");
    }
  }

  function serverRack(t) {
    const r = P.rack;
    shadow(r.x + r.w / 2, r.y + r.h + 1, r.w / 2 + 4, 3);
    R(r.x - 1, r.y - 1, r.w + 2, r.h + 2, C.outline); R(r.x, r.y, r.w, r.h, "#1a1f2f");
    R(r.x, r.y, r.w, 1, "#323a54"); R(r.x + r.w - 3, r.y + 1, 3, r.h - 1, "#12151f");
    for (let i = 0; i < 13; i++) {
      const y = r.y + 4 + i * 9.6;
      R(r.x + 3, y, r.w - 8, 7, "#0b0e17"); R(r.x + 3, y, r.w - 8, 1, "#232a3d");
      for (let v = 0; v < 4; v++) R(r.x + 13 + v * 2, y + 2, 1, 4, "#141826");
      const on = running ? seed(i + Math.floor(t * 7)) > 0.3 : seed(i) > 0.65;
      const blip = on && seed(i * 7 + Math.floor(t * (running ? 9 : 2))) > 0.5;
      R(r.x + 5, y + 3, 2, 2, on ? C.green : "#16301f");
      R(r.x + 8, y + 3, 2, 2, blip ? C.cyan : "#132630");
      if (on) glow(r.x + 6, y + 4, 4, C.green, 0.25);
    }
  }

  function rejectBin(t, n) {
    const { x, y } = P.bin;
    shadow(x, y + 1, 18, 3);
    for (let i = 0; i < Math.min(9, n); i++) {      // crumpled reject slips poking out
      const px = x - 11 + (i * 7) % 22, py = y - 30 - (i % 3) * 2 - Math.floor(i / 3) * 2;
      ellipse(px, py, 3, 2, C.outline); ellipse(px, py, 2, 1, i % 2 ? "#e8eaf2" : "#ffb3be");
      R(px - 1, py, 1, 1, C.red);
    }
    for (let yy = 0; yy < 26; yy++) {
      const half = 13 + yy * 0.12;
      R(x - half - 1, y - 26 + yy, half * 2 + 2, 1, C.outline);
      R(x - half, y - 26 + yy, half * 2, 1, yy < 2 ? "#2d3448" : "#1d2232");
      R(x - half, y - 26 + yy, 3, 1, "#262c40");
    }
    R(x - 16, y - 29, 32, 4, C.outline); R(x - 15, y - 28, 30, 2, "#3a4260");
    R(x - 9, y - 18, 18, 9, "#121521"); R(x - 9, y - 18, 18, 1, "#0a0c13");
  }

  function couch() {
    const { x, y } = P.couch; if (P.L < 120) return;
    shadow(x, y + 1, 50, 4);
    R(x - 46, y - 26, 92, 16, C.outline); R(x - 45, y - 25, 90, 14, "#262a45"); R(x - 45, y - 25, 90, 1, "#363b5e");
    R(x - 48, y - 16, 96, 14, C.outline);
    R(x - 47, y - 15, 10, 12, "#2c3150"); R(x + 37, y - 15, 10, 12, "#2c3150");
    R(x - 37, y - 12, 36, 9, "#30355a"); R(x + 1, y - 12, 36, 9, "#30355a");
    R(x - 37, y - 12, 36, 1, "#40467a"); R(x + 1, y - 12, 36, 1, "#40467a");
    R(x - 45, y - 2, 3, 3, C.outline); R(x + 42, y - 2, 3, 3, C.outline);
    R(x + 14, y - 22, 14, 10, C.outline); R(x + 15, y - 21, 12, 8, "#b8338a"); R(x + 15, y - 21, 12, 1, "#e84fb4");
  }

  function cooler(t) {
    const c = P.cooler; if (!c) return;
    const { x, y } = c;
    shadow(x, y + 1, 9, 2);
    R(x - 8, y - 30, 16, 30, C.outline); R(x - 7, y - 29, 14, 29, "#d8dbe6"); R(x + 3, y - 29, 4, 29, "#b4b9c9");
    R(x - 4, y - 21, 3, 2, "#3a8fd9"); R(x - 7, y - 10, 14, 1, "#b4b9c9");
    R(x - 6, y - 46, 12, 16, C.outline); R(x - 5, y - 45, 10, 15, "#5fb4ff"); R(x - 4, y - 44, 2, 12, "#a9dbff");
    const b = (t * 0.6) % 1; if (b < 0.6) R(x + 1, y - 32 - b * 20, 1, 1, "#d6efff");
  }

  function plant(x, y, t, i) {
    shadow(x, y + 1, 8, 2);
    const sway = Math.round(Math.sin(t * 0.9 + i) * 0.6);
    const leaves = [[0, -22], [-6, -18], [6, -19], [-3, -27], [4, -26], [-9, -12], [9, -13], [-2, -15], [3, -12]];
    leaves.forEach(([dx, dy], k) => {
      const lx = x + dx + (dy < -20 ? sway : 0), col = k % 3 === 0 ? "#4cc47a" : k % 3 === 1 ? "#2f9e5b" : "#1f6b3d";
      diamond(lx, y + dy, 4, C.outline); diamond(lx, y + dy, 3, col); R(lx - 1, y + dy - 2, 1, 1, "#7fe0a5");
    });
    R(x - 7, y - 10, 14, 11, C.outline); R(x - 6, y - 9, 12, 9, C.pot); R(x - 6, y - 9, 3, 9, "#4a5068");
    R(x - 8, y - 11, 16, 3, C.outline); R(x - 7, y - 10, 14, 1, "#565d78");
  }

  // --- desks and screens -----------------------------------------------------------
  function screenContent(id, x, y, w, h, t, on, col) {
    const dim = on ? col : shade(col, -0.38), hi = on ? shade(col, 0.3) : shade(col, -0.2), sp = on ? 1 : 0.3;
    switch (id) {
      case "scout": {                                  // radar sweep with blips
        const cx = x + w / 2, cy = y + h / 2, ang = t * 2.8 * sp + 1;
        ring(cx, cy, 9, 9, shade(col, -0.5)); ring(cx, cy, 5, 5, shade(col, -0.55));
        R(cx - 10, cy, 21, 1, shade(col, -0.6)); R(cx, cy - 10, 1, 21, shade(col, -0.6));
        line(cx, cy, cx + Math.cos(ang) * 9, cy + Math.sin(ang) * 9, hi);
        for (let i = 0; i < 4; i++) {
          const ba = seed(i + 3) * 6.28, d = 3 + seed(i + 9) * 6;
          const age = ((ang - ba) % 6.283 + 6.283) % 6.283;
          if (age < 2.5) R(cx + Math.cos(ba) * d, cy + Math.sin(ba) * d, 2, 2, age < 0.8 ? hi : dim);
        }
        break;
      }
      case "market":                                   // volume bars
        for (let i = 0; i < 12; i++) {
          const hh = 3 + Math.round(((Math.sin(i * 1.7 + t * 3 * sp) + 1) / 2) * 13);
          R(x + 2 + i * 3, y + h - 2 - hh, 2, hh, i % 4 === 0 ? hi : dim);
        }
        break;
      case "chain":                                    // dossier rows being checked
        for (let i = 0; i < 5; i++) {
          const ry = y + 2 + i * 4, cur = on && Math.floor(t * 3) % 5 === i;
          if (cur) R(x + 1, ry - 1, w - 2, 4, shade(col, -0.55));
          R(x + 3, ry, 6 + Math.round(seed(i + 2) * 18), 2, cur ? C.text : "#3a4058");
          R(x + w - 6, ry, 3, 2, seed(i * 5) > 0.3 ? shade(C.green, on ? 0 : -0.3) : shade(C.red, on ? 0 : -0.3));
        }
        break;
      case "jevm": {                                   // a price line, read by Jev
        let px = null, py = null;
        for (let i = 0; i < 19; i++) {
          const v = Math.sin(i * 0.55 + t * 1.6 * sp) * 5 + Math.sin(i * 1.3 + 2) * 2;
          const nx = x + 2 + i * 2, ny = y + h / 2 - v;
          R(nx, ny + 1, 2, y + h - 2 - ny, shade(col, -0.62));
          if (px !== null) line(px, py, nx, ny, hi);
          px = nx; py = ny;
        }
        break;
      }
      case "jevt": {                                   // text being read, line by line
        const lines = [28, 22, 31, 18, 25], cur = Math.floor(t * sp * 0.8) % lines.length;
        lines.forEach((len, i) => {
          const ry = y + 3 + i * 4;
          const shown = i < cur ? len : i === cur ? Math.round(len * ((t * sp * 0.8) % 1)) : 0;
          if (i <= cur) R(x + 3, ry, shown, 2, i === cur ? hi : dim);
          if (i === cur && Math.floor(t * 3) % 2) R(x + 4 + shown, ry - 1, 1, 4, C.white);
        });
        break;
      }
      case "pick": {                                   // candidates, one chosen
        const sel = on ? Math.floor(t * 2) % 3 : 1;
        for (let i = 0; i < 3; i++) {
          const bx = x + 3 + i * 12, isSel = i === sel;
          R(bx, y + 5, 10, 12, isSel ? hi : shade(col, -0.6));
          R(bx + 1, y + 6, 8, 10, C.screen);
          R(bx + 2, y + 12 - Math.round(seed(i + 4) * 4), 6, 3 + Math.round(seed(i + 4) * 4), isSel ? hi : shade(col, -0.5));
        }
        break;
      }
    }
  }

  function deskItem(i, x, y, t) {
    switch (i % 6) {
      case 0: case 3:                                  // mug, with steam
        R(x + 26, y - 12, 9, 8, C.outline); R(x + 27, y - 11, 7, 7, "#d8dbe6"); R(x + 34, y - 10, 2, 4, "#d8dbe6");
        R(x + 28, y - 11, 5, 1, "#6b3a1f");
        if (Math.floor(t * 1.5 + i) % 3) R(x + 29 + Math.round(Math.sin(t * 2 + i)), y - 15, 1, 2, "rgba(255,255,255,.25)");
        break;
      case 1: case 4:                                  // paper stack
        R(x + 24, y - 8, 14, 4, C.outline); R(x + 25, y - 7, 12, 1, "#e8eaf2"); R(x + 25, y - 6, 12, 1, "#bfc4d4");
        R(x + 26, y - 9, 10, 1, "#e8eaf2"); break;
      case 2:                                          // folders
        R(x + 24, y - 9, 14, 5, C.outline); R(x + 25, y - 8, 12, 2, "#ffa62b"); R(x + 25, y - 6, 12, 1, "#e85d5d");
        break;
      case 5:                                          // sticky notes
        R(x + 26, y - 9, 6, 5, "#ffe066"); R(x + 30, y - 8, 6, 5, "#ff8fd3"); break;
    }
  }

  function chair(x, by) {
    R(x - 16, by - 32, 32, 21, C.outline); R(x - 15, by - 31, 30, 19, C.chair); R(x - 15, by - 31, 30, 2, C.chairHi);
    R(x - 18, by - 15, 4, 9, C.outline); R(x + 14, by - 15, 4, 9, C.outline);
    R(x - 17, by - 14, 2, 7, C.chairHi); R(x + 15, by - 14, 2, 7, C.chairHi);
  }

  function desk(id, x, y, t, i) {
    const col = CHARS[id].color, on = active === id;
    shadow(x, y + 26, 48, 3, 0.4);
    glow(x, y - 22, on ? 80 : 48, col, on ? 0.38 : 0.13);
    // monitor
    R(x - 24, y - 40, 48, 30, C.bezelDark); R(x - 23, y - 39, 46, 28, on ? shade(col, -0.45) : C.bezel);
    R(x - 23, y - 39, 46, 1, C.bezelHi); R(x - 20, y - 36, 40, 22, C.screen);
    screenContent(id, x - 20, y - 36, 40, 22, t, on, col);
    R(x - 20, y - 36, 40, 1, "rgba(255,255,255,.07)");
    R(x + 20, y - 13, 1, 1, on ? C.green : "#1d3a2a");
    R(x - 3, y - 11, 6, 5, "#1d2232"); R(x - 9, y - 7, 18, 2, "#262c3f");
    // desk
    R(x - 47, y - 6, 94, 9, C.outline);
    R(x - 46, y - 5, 92, 7, C.deskTop); R(x - 46, y - 5, 92, 1, C.deskHi);
    R(x - 45, y + 2, 90, 15, C.outline); R(x - 44, y + 2, 88, 14, C.deskFront); R(x - 44, y + 2, 88, 1, C.deskDark);
    R(x - 38, y + 6, 18, 7, "#171b2a"); R(x - 31, y + 9, 4, 1, C.deskHi);
    R(x + 20, y + 6, 18, 7, "#171b2a"); R(x + 27, y + 9, 4, 1, C.deskHi);
    R(x - 44, y + 16, 4, 10, C.leg); R(x + 40, y + 16, 4, 10, C.leg);
    // keyboard and mouse, lit by the screen
    R(x - 15, y - 5, 30, 5, C.outline); R(x - 14, y - 4, 28, 3, C.key);
    for (let k = 0; k < 9; k++) R(x - 13 + k * 3, y - 3, 2, 1, C.keyHi);
    if (on && Math.floor(t * 12) % 2) R(x - 13 + Math.floor(seed(Math.floor(t * 12)) * 9) * 3, y - 3, 2, 1, "#b8c6f0");
    R(x + 18, y - 4, 4, 3, C.outline); R(x + 19, y - 4, 2, 2, C.keyHi);
    deskItem(i, x, y, t);
    const by = y + 30;
    chair(x, by);
    if (!walkers[id]) character(id, x, by, t, { typing: true });
  }

  function headDesk(t) {
    const { x, y } = P.head, on = active === "desk";
    glow(x - 34, y - 18, 34, "#ffd27a", 0.16);                            // desk lamp
    shadow(x, y + 26, 46, 3, 0.4);
    character("desk", x, y + 1, t, { float: true });
    // monitor seen from behind, facing the Desk
    R(x + 14, y - 30, 28, 22, C.outline); R(x + 15, y - 29, 26, 20, "#1a1f2e"); R(x + 15, y - 29, 26, 1, "#2a3146");
    R(x + 27, y - 20, 2, 2, on ? C.pink : "#4a2340"); R(x + 25, y - 9, 6, 4, "#1d2232");
    // desk
    R(x - 45, y - 6, 90, 9, C.outline); R(x - 44, y - 5, 88, 7, C.deskTop); R(x - 44, y - 5, 88, 1, C.deskHi);
    R(x - 43, y + 2, 86, 17, C.outline); R(x - 42, y + 2, 84, 16, C.deskFront); R(x - 42, y + 2, 84, 1, C.deskDark);
    R(x - 36, y + 5, 72, 10, "#191d2d"); R(x - 36, y + 5, 72, 1, "#11141f");
    diamond(x, y + 10, 4, C.pink); diamond(x, y + 10, 2, "#191d2d"); R(x, y + 10, 1, 1, C.white);
    R(x - 42, y + 18, 4, 8, C.leg); R(x + 38, y + 18, 4, 8, C.leg);
    // lamp, phone, papers
    R(x - 38, y - 8, 9, 3, C.outline); R(x - 37, y - 7, 7, 1, "#3a4058");
    line(x - 34, y - 8, x - 30, y - 20, "#3a4058"); line(x - 30, y - 20, x - 36, y - 24, "#3a4058");
    R(x - 41, y - 27, 9, 4, C.outline); R(x - 40, y - 26, 7, 2, "#ffd27a");
    R(x - 18, y - 9, 10, 4, C.outline); R(x - 17, y - 8, 8, 2, "#2a3046"); R(x - 16, y - 8, 1, 1, C.green);
    R(x - 4, y - 8, 12, 3, C.outline); R(x - 3, y - 8, 10, 1, "#e8eaf2"); R(x - 2, y - 7, 8, 1, "#bfc4d4");
    plate("desk", x, y + 21);
    return { x, y: y + 25.5 };
  }

  function scoreboard(t) {
    const { x, y } = P.scoreboard;
    shadow(x, y + 69, 34, 3, 0.4);
    R(x - 25, y + 30, 3, 38, C.outline); R(x + 22, y + 30, 3, 38, C.outline);
    R(x - 24, y + 30, 1, 38, "#2d3550"); R(x + 23, y + 30, 1, 38, "#2d3550");
    R(x - 33, y - 1, 66, 33, C.outline); R(x - 32, y, 64, 31, C.bezel); R(x - 32, y, 64, 1, C.bezelHi);
    R(x - 29, y + 3, 58, 25, C.screen);
    // the last 14 tracked tokens' 1h result, after cost
    const rows = (S?.score?.series || []).filter((r) => r.verdict !== "control" && r.net?.["1h"] != null).slice(-14);
    const max = Math.max(5, ...rows.map((r) => Math.abs(r.net["1h"])));
    R(x - 27, y + 15, 54, 1, "#1d2232");
    rows.forEach((r, i) => {
      const v = r.net["1h"], hh = Math.max(1, Math.round((Math.abs(v) / max) * 4));
      R(x - 27 + i * 4, v >= 0 ? y + 15 - hh : y + 16, 3, hh, v >= 0 ? C.green : C.red);
    });
    // rocket trophy on top
    const fl = Math.floor(t * 8) % 2;
    R(x - 2, y - 18, 5, 17, C.outline); R(x - 1, y - 17, 3, 15, "#cfd3e1"); R(x - 1, y - 17, 1, 15, "#ffffff");
    tri(x, y - 17, 6, 6, C.red); R(x - 4, y - 7, 2, 6, C.red); R(x + 3, y - 7, 2, 6, C.red);
    R(x, y - 12, 1, 2, C.cyan);
    if (fl) glow(x, y - 2, 6, C.orange, 0.5);
  }

  // --- characters ------------------------------------------------------------------
  function plate(id, x, y) {
    const on = active === id, col = CHARS[id].color;
    R(x - 18, y - 4, 36, 9, C.outline); R(x - 17, y - 3, 34, 7, on ? col : shade(col, -0.62));
    R(x - 17, y - 3, 34, 1, on ? shade(col, 0.25) : shade(col, -0.5));
    tags[id] = { x, y: y + 0.5 };
  }

  function character(id, x, by, t, opt = {}) {
    const ch = CHARS[id], on = active === id, k = ORDER.indexOf(id), e = EYES[ch.shape], s = 12;
    let bob = on ? -Math.abs(Math.round(Math.sin(t * 7 + k) * 2)) : Math.round(Math.sin(t * 1.8 + k) * 0.6);
    if (opt.float) bob = Math.round(Math.sin(t * 2 + k) * 1.5) - 2;
    if (opt.walking) bob = -Math.abs(Math.round(Math.sin(t * 10) * 2));
    const cx = Math.round(x), cy = Math.round(by - 13 + bob);
    pos[id] = { x: cx, y: cy };
    if (!opt.float) shadow(cx, by + 1, 12, 2, 0.5);
    if (opt.walking) {                                 // little feet, one step at a time
      const st = Math.floor(t * 10) % 2;
      R(cx - 7, by - 2 - (st ? 2 : 0), 5, 3, C.outline); R(cx + 2, by - 2 - (st ? 0 : 2), 5, 3, C.outline);
    }
    if (on) glow(cx, cy, 34, ch.color, 0.4 + 0.1 * Math.sin(t * 8));
    g.drawImage(sprites[id], cx - O, cy - O);
    // halo for the two Jev characters
    if (ch.acc === "halo") {
      const hy = cy - s - 5 + Math.round(Math.sin(t * 2.4 + k));
      ring(cx, hy, 6, 2, on ? shade(ch.color, 0.4) : shade(ch.color, 0.1));
      if (on) glow(cx, hy, 10, ch.color, 0.35);
    }
    if (ch.acc === "antenna") {
      const blink = on ? Math.floor(t * 6) % 2 : Math.floor(t * 0.8) % 2;
      R(cx + 1, cy - s - 6, 3, 3, C.outline); R(cx + 2, cy - s - 5, 1, 1, blink ? "#9cc3ff" : "#1e3b6e");
      if (blink && on) glow(cx + 2, cy - s - 5, 6, "#9cc3ff", 0.5);
    }
    if (ch.acc === "headset" && on) R(cx + 5, cy + 3, 2, 2, C.pink);
    // eyes: look at the screen while working, glance around otherwise, blink
    const blink = (t + k * 1.7) % 4.4 < 0.12;
    const look = on ? 0 : [-1, 0, 0, 1][Math.floor(seed(k + Math.floor(t / 3 + k)) * 4)];
    const up = on ? 1 : 0;
    for (const ex of e.xs) {
      const x0 = cx + ex, y0 = cy + e.y;
      if (blink) { R(x0, y0 + 2, e.w, 1, C.outline); continue; }
      R(x0, y0, e.w, 5, C.white);
      const px = x0 + Math.max(0, Math.min(e.w - 2, Math.round((e.w - 2) / 2) + look));
      R(px, y0 + 1 - up, 2, 3, "#0b0d14"); R(px, y0 + 1 - up, 1, 1, "#ffffff");
    }
    if (ch.acc === "glasses") {
      for (const ex of e.xs) {
        const x0 = cx + ex - 1, y0 = cy + e.y - 1;
        R(x0, y0, e.w + 2, 1, "#e8c37a"); R(x0, y0 + 6, e.w + 2, 1, "#e8c37a");
        R(x0, y0, 1, 7, "#e8c37a"); R(x0 + e.w + 1, y0, 1, 7, "#e8c37a");
      }
      R(cx - 1, cy + e.y + 1, 3, 1, "#e8c37a");
    }
    // mouth
    const my = cy + e.y + 7;
    if (on && Math.floor(t * 4) % 3 === 0) R(cx - 1, my, 3, 2, C.outline); else R(cx - 1, my, 3, 1, shade(ch.color, -0.5));
    // arms: typing at the desk, quicker while this stage is working
    if (opt.typing) {
      const busy = on || seed(k + Math.floor(t / 2.5)) > 0.45;
      const rate = on ? 11 : 4, beat = busy ? Math.floor(t * rate) % 2 : 0;
      const ax = ARMX[ch.shape], ay = cy + 3;
      for (const [dx, lift] of [[-ax - 1, beat], [ax - 4, 1 - beat]]) {
        const yy = ay - (busy ? lift * 2 : 0);
        R(cx + dx, yy, 5, 4, C.outline); R(cx + dx + 1, yy + 1, 3, 2, shade(ch.color, -0.1));
      }
    }
    if (!opt.float) plate(id, cx, by + 9);
    return tags[id];
  }


  // --- the show: events -> bubbles, walks and courier trips ---------------------------
  const pos = {};                                    // where each character was drawn
  const bubbles = {};                                // id -> {text, until}
  const walkers = {};                                // id -> walk in progress
  const effects = [];                                // paper balls and falling chips
  const show = { queue: [], step: null, end: 0, mode: "live", cycle: null, f: 1,
                 activeId: null, activeUntil: 0 };
  let now = 0;                                       // seconds, from the animation clock
  const RAIL = 96, SPEED = 200;                      // the cat flies across at this height, px/s
  const cat = { x: null, y: null, path: [], cargo: null, speed: SPEED, moving: false, idleSince: 0, trail: [] };

  const money = (x) => x == null ? "?" : x >= 1e6 ? `$${(x / 1e6).toFixed(1)}M` : `$${Math.round(x / 1e3)}k`;
  const signed = (x) => x == null ? "?" : `${x >= 0 ? "+" : ""}${x.toFixed(1)}%`;
  const tick = (s) => String(s ?? "?").slice(0, 10);
  const hueOf = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

  function station(k) {
    const d = P.desks[k];
    if (d) return { x: d.x + 34, y: d.y - 26 };      // floating beside the desk's monitor
    if (k === "desk") return { x: P.head.x + 28, y: P.head.y - 42 };
    if (k === "bin") return { x: P.bin.x, y: P.bin.y - 48 };
    return { x: P.cx + 160, y: 92 };                 // home: hanging beside the right banner
  }
  function lastPoint() {
    for (let i = cat.path.length - 1; i >= 0; i--) if (cat.path[i].x != null) return cat.path[i];
    return { x: cat.x, y: cat.y };
  }
  function goTo(target) {                            // climb, cross the ceiling, drop down
    const last = lastPoint();
    if (Math.abs(last.x - target.x) > 1) { cat.path.push({ x: last.x, y: RAIL }, { x: target.x, y: RAIL }); }
    cat.path.push({ x: target.x, y: target.y });
  }
  function tripTime(from, to) {                       // rough seconds for a trip at base speed
    const a = lastPoint(), b = station(from), c = station(to);
    const leg = (p, q) => Math.abs(p.x - q.x) > 1 ? Math.abs(p.y - RAIL) + Math.abs(p.x - q.x) + Math.abs(q.y - RAIL) : Math.abs(p.y - q.y);
    return (leg(a, b) + leg(b, c)) / SPEED + 0.6;
  }
  function trip(from, to, cargo) {
    goTo(station(from));
    cat.path.push({ act: "pick", cargo, wait: 0.25 });
    goTo(station(to));
    cat.path.push({ act: "drop", at: to, wait: 0.25 });
  }

  function say(id, text, secs) { bubbles[id] = { text, until: now + secs }; }
  function walk(id, to, hold) {
    const from = id === "score" ? { x: P.score.x, by: P.score.y }
                                : { x: P.desks[id].x, by: P.desks[id].y + 30 };
    const dur = Math.max(0.4, Math.hypot(to.x - from.x, to.by - from.by) / 45 * show.f);
    walkers[id] = { from, to, t0: now, dur, hold };
  }
  function walkerPos(w) {
    const t = now - w.t0, p = t < w.dur ? t / w.dur : t < w.dur + w.hold ? 1
      : Math.max(0, 1 - (t - w.dur - w.hold) / w.dur);
    const moving = t < w.dur || t > w.dur + w.hold;
    return { x: w.from.x + (w.to.x - w.from.x) * p, by: w.from.by + (w.to.by - w.from.by) * p, moving,
             done: t > w.dur * 2 + w.hold };
  }
  function toss(fromId, good) {                       // a paper ball from a desk into the bin
    const p = pos[fromId] || { x: P.cx, y: 180 };
    effects.push({ kind: "arc", x0: p.x + 10, y0: p.y - 6, x1: P.bin.x, y1: P.bin.y - 24, t0: now,
                   dur: 0.9 * Math.max(0.5, show.f), color: good ? C.paper : "#ffb3be" });
  }

  // which character works on an event, and what the event looks like on the floor
  function charFor(e) {
    return { scout: "scout", market: "market", chain: "chain", jev: "jevm", pick: "pick",
             score: "score", desk: "desk" }[e.stage] || null;
  }
  function plan(e) {                                 // event -> step, or null to skip it
    const k = `${e.stage}.${e.kind}`;
    switch (k) {
      case "scout.start": case "market.start": case "jev.start": case "score.start":
      case "scout.done": case "market.done": case "chain.done": case "chain.token":
      case "jev.token": case "jev.error": case "pick.decision": case "score.priced": case "desk.cycle_end":
        break;
      case "market.token": if (e.result !== "pass") return null; break;
      default: return null;
    }
    if (k === "score.start" && !e.due) return null;
    return { e, k };
  }
  function base(step) {                              // seconds the step needs at normal speed
    switch (step.k) {
      case "scout.done": return tripTime("scout", "market");
      case "market.done": return tripTime("market", "chain");
      case "chain.done": return tripTime("chain", "jevm");
      case "jev.token": return step.e.fails?.length ? 1.3 : tripTime("jevt", "pick");
      case "pick.decision": return 3.2;
      case "market.token": case "chain.token": return 0.9;
      default: return 1.4;
    }
  }
  function begin(step) {
    const e = step.e, f = show.f, hold = Math.max(1.6, 2.8 * f);
    cat.speed = SPEED / f;
    show.activeId = charFor(e);
    switch (step.k) {
      case "scout.start":
        say("desk", show.mode === "replay" ? "replaying a cycle" : "new cycle, go!", hold);
        say("scout", "scanning launches…", hold); break;
      case "scout.done":
        say("scout", `+${e.new ?? 0} new · ${e.watchlist ?? "?"} watched`, hold);
        trip("scout", "market", { kind: "bundle" }); break;
      case "market.start": say("market", `checking ${e.checking ?? "?"}`, hold); break;
      case "market.token": say("market", `${tick(e.ticker)} ✓ liq ${money(e.liq)}`, hold); break;
      case "market.done":
        say("market", `${e.survived ?? 0} of ${e.checked ?? 0} passed`, hold);
        trip("market", "chain", { kind: "bundle" }); break;
      case "chain.token": {
        const ok = e.result === "pass";
        say("chain", `${tick(e.ticker)} ${ok ? "✓ clean" : "✗ " + e.result}`, hold);
        if (!ok) toss("chain"); break;
      }
      case "chain.done":
        say("chain", `${e.survived ?? 0} finalist${e.survived === 1 ? "" : "s"}`, hold);
        trip("chain", "jevm", { kind: "bundle" }); break;
      case "jev.start": say("jevm", `judging ${e.finalists ?? "?"}`, hold); break;
      case "jev.token": {
        const fails = e.fails || [];
        say("jevm", `${tick(e.ticker)}: ${e.shape || "?"}`, hold);
        say("jevt", fails.length ? `✗ ${fails[0]}${fails.length > 1 ? ` +${fails.length - 1}` : ""}` : "✓ passes", hold);
        if (fails.length) toss("jevt");               // rejected: into the bin
        else trip("jevt", "pick", { kind: "chip", addr: e.addr, ticker: e.ticker });   // survivor: to Pick
        break;
      }
      case "jev.error": say("jevm", `${tick(e.ticker)}: no answer`, hold); break;
      case "pick.decision": {
        const p = e.pick;
        say("pick", p ? `would buy ${tick(p.ticker)}` : "no trade", hold + 1.4);
        walk("pick", { x: P.head.x - 58, by: P.head.y + 44 }, hold);
        setTimeout(() => say("desk", p ? "noted · shadow buy" : "ok, sit tight", Math.max(1.6, 2.4 * f)),
                   Math.round(1000 * Math.max(0.6, 1.2 * f)));
        break;
      }
      case "score.start": say("score", `pricing ${e.due}`, hold); break;
      case "score.priced":
        say("score", `${tick(e.ticker)} ${e.checkpoint} ${signed(e.net)}${e.verdict === "control" ? " · control" : ""}`, hold);
        if (!walkers.score) walk("score", { x: P.scoreboard.x - 40, by: P.score.y }, hold);
        break;
      case "desk.cycle_end":
        say("desk", e.rc ? `cycle failed (rc ${e.rc})` : "cycle done ✓", hold); break;
    }
  }
  function direct(t) {
    if (show.step && t < show.end) return;
    show.step = null;
    if (!show.queue.length) {
      if (show.mode === "replay" && !Object.keys(walkers).length && !cat.path.length) show.mode = "live";
      return;
    }
    const step = show.queue.shift();
    if (show.mode === "live") {
      const q = show.queue.length;
      show.f = q > 12 ? 0.35 : q > 5 ? 0.6 : 1;
    }
    begin(step);
    const dur = base(step) * show.f;
    show.step = step; show.start = t; show.end = t + dur; show.activeUntil = t + dur + 0.6;
  }
  function stopReplay() {
    show.queue = []; show.step = null; show.mode = "live"; show.f = 1;
    for (const k of Object.keys(bubbles)) delete bubbles[k];
    cat.path = []; cat.cargo = null;
  }
  function showActive(t) {
    if (!show.activeId || t > show.activeUntil) return null;
    if (show.step?.k === "jev.token") return t < (show.start + show.end) / 2 ? "jevm" : "jevt";
    return show.activeId;
  }

  // --- the courier cat ------------------------------------------------------------
  function moveCat(dt) {
    if (cat.x == null) { const h = station("home"); cat.x = h.x; cat.y = h.y; }
    const s = cat;
    s.moving = false;
    if (!s.path.length) {
      const h = station("home");
      if (now - s.idleSince > 4 && (Math.abs(s.x - h.x) > 1 || Math.abs(s.y - h.y) > 1)) goTo(h);
      return;
    }
    s.idleSince = now;
    const p = s.path[0];
    if (p.act) {
      p.left = (p.left ?? p.wait / show.f * 1) - dt;
      if (p.left > 0) return;
      if (p.act === "pick") s.cargo = p.cargo;
      if (p.act === "drop" && s.cargo) {
        if (p.at === "bin") effects.push({ kind: "fall", x: s.x, y: s.y + 12, vy: 0, cargo: s.cargo, until: now + 2 });
        else effects.push({ kind: "plop", x: s.x, y: s.y + 12, t0: now, color: s.cargo.kind === "chip" ? `hsl(${hueOf(s.cargo.addr)} 70% 62%)` : C.paper });
        s.cargo = null;
      }
      s.path.shift(); return;
    }
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy), step = s.speed * dt;
    s.moving = true;
    if (d <= step) { s.x = p.x; s.y = p.y; s.path.shift(); }
    else { s.x += (dx / d) * step; s.y += (dy / d) * step; }
  }

  // the courier cat: an orange cosmic kitten, drawn once into a sprite like the
  // characters (outline, shading, rim light), then given eyes, paws, tail and stars
  // each frame
  const CAT = { base: "#ff8a3d", dark: "#e0662a", deep: "#b84a1c", light: "#ffb36b", rim: "#ffd29a",
                white: "#fff1e0", pink: "#ff8fb1", eye: "#5ef0ff", star: "#fff7c2", nebula: "#8a6bff" };
  function catInside(x, y, gr = 0) {
    const head = (x * x) / ((9 + gr) ** 2) + ((y + 4) ** 2) / ((7 + gr) ** 2) <= 1;
    const body = (x * x) / ((6 + gr) ** 2) + ((y - 6) ** 2) / ((5 + gr) ** 2) <= 1;
    const ear = (cx) => {
      const top = -15 - gr, bot = -7;
      if (y < top || y > bot) return false;
      return Math.abs(x - cx) <= ((y - top) / (bot - top)) * (4 + gr) + 0.3;
    };
    return head || body || ear(-6.5) || ear(6.5);
  }
  function makeCat() {
    const c = document.createElement("canvas"); c.width = c.height = SZ;
    const prev = g; g = c.getContext("2d");
    for (let py = 0; py < SZ; py++) for (let px = 0; px < SZ; px++) {
      const x = px - O + 0.5, y = py - O + 0.5;
      if (!catInside(x, y, 1)) continue;
      let col;
      if (!catInside(x, y)) col = C.outline;
      else if (y < -7 && Math.abs(Math.abs(x) - 6.5) <= ((y + 13) / 6) * 2 && y > -13) col = CAT.pink;   // inner ears
      else if (y < 0 && !catInside(x, y - 1.3)) col = CAT.rim;
      else if (((x + 3.5) ** 2) / 9 + ((y + 8) ** 2) / 4 <= 1) col = CAT.light;
      else if (y > 0 && !catInside(x, y + 2)) col = CAT.deep;
      else if (catInside(x + 1, y + 1.5, -1.5)) col = CAT.base;
      else col = CAT.dark;
      R(px, py, 1, 1, col);
    }
    // muzzle and chest
    ellipse(O - 2, O - 1, 2, 1, CAT.white); ellipse(O + 2, O - 1, 2, 1, CAT.white);
    ellipse(O, O + 6, 3, 3, CAT.white); R(O - 1, O + 4, 3, 1, CAT.white);
    // forehead: tabby stripes and a little star
    R(O - 4, O - 10, 1, 2, CAT.deep); R(O + 4, O - 10, 1, 2, CAT.deep);
    R(O - 6, O - 7, 2, 1, CAT.deep); R(O + 5, O - 7, 2, 1, CAT.deep);
    diamond(O, O - 9, 1, CAT.star); R(O, O - 9, 1, 1, "#ffffff");
    // star speckles in the fur
    for (const [dx, dy] of [[-7, -3], [6, -2], [-4, 8], [4, 9], [7, -5]]) R(O + dx, O + dy, 1, 1, CAT.star);
    // nose and mouth
    R(O - 1, O - 2, 2, 1, CAT.pink); R(O - 2, O, 1, 1, C.outline); R(O - 1, O + 1, 1, 1, C.outline);
    R(O, O, 1, 1, C.outline); R(O + 1, O + 1, 1, 1, C.outline);
    g = prev;
    return c;
  }
  let catSprite = null;

  function drawCat(t) {
    const s = cat;
    if (!catSprite) catSprite = makeCat();
    const next = s.path.find((q) => q.x != null);
    const vx = s.moving && next ? Math.sign(next.x - s.x) : 0;
    const bob = Math.round(Math.sin(t * (s.moving ? 6 : 2)) * (s.moving ? 1 : 2));
    const x = Math.round(s.x), y = Math.round(s.y) + bob;
    // a trail of stardust while flying
    if (s.moving && now - (s.lastDust || 0) > 0.04) {
      s.lastDust = now;
      s.trail.push({ x: x + (Math.random() - 0.5) * 6, y: y + 4 + (Math.random() - 0.5) * 6, t0: now,
                     c: [CAT.star, C.pink, C.cyan, CAT.light][Math.floor(Math.random() * 4)] });
    }
    for (let i = s.trail.length - 1; i >= 0; i--) {
      const d = s.trail[i], age = (now - d.t0) / 0.7;
      if (age >= 1) { s.trail.splice(i, 1); continue; }
      g.globalAlpha = 1 - age; R(d.x, d.y + age * 3, age < 0.4 ? 2 : 1, age < 0.4 ? 2 : 1, d.c); g.globalAlpha = 1;
    }
    glow(x, y, 26, CAT.nebula, 0.16); glow(x, y, 18, CAT.base, 0.22);
    // tail: curls up behind, away from where it is flying; the tip glows
    const side = vx > 0 ? -1 : 1, pts = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      pts.push([x + side * (5 + u * 8), y + 7 - u * 11 + Math.sin(u * 3 + t * (s.moving ? 9 : 3)) * 2]);
    }
    for (const [px, py] of pts) ellipse(px, py, 2, 2, C.outline);
    pts.forEach(([px, py], i) => ellipse(px, py, 1, 1, i > 6 && i % 2 ? CAT.deep : CAT.base));
    const [tx, ty] = pts[pts.length - 1];
    glow(tx, ty, 7, CAT.star, 0.6); R(tx - 1, ty - 1, 2, 2, CAT.star);
    g.drawImage(catSprite, x - O, y - O);
    // whiskers
    for (const sd of [-1, 1]) {
      line(x + sd * 9, y - 2, x + sd * 13, y - 3, "rgba(255,241,224,.75)");
      line(x + sd * 9, y, x + sd * 13, y + 1, "rgba(255,241,224,.75)");
    }
    // eyes: big and glowing; happy arcs while flying fast, a blink now and then
    const blink = (t * 1.1) % 3.7 < 0.12;
    for (const ex of [-5, 3]) {
      if (blink) { R(x + ex, y - 5, 3, 1, C.outline); continue; }
      if (s.moving && s.speed > SPEED * 1.4) {      // ^ ^
        R(x + ex, y - 5, 1, 1, C.outline); R(x + ex + 1, y - 6, 1, 1, C.outline); R(x + ex + 2, y - 5, 1, 1, C.outline);
        continue;
      }
      R(x + ex, y - 7, 3, 4, C.outline); R(x + ex, y - 7, 3, 3, CAT.eye); R(x + ex + 1, y - 6, 1, 2, "#0b2a4a");
      R(x + ex, y - 7, 1, 1, "#ffffff");
    }
    glow(x - 4, y - 6, 4, CAT.eye, 0.25); glow(x + 4, y - 6, 4, CAT.eye, 0.25);
    // what it is carrying, held in its front paws
    if (s.cargo) {
      if (s.cargo.kind === "chip") {
        ellipse(x, y + 12, 5, 5, C.outline); ellipse(x, y + 12, 4, 4, `hsl(${hueOf(s.cargo.addr)} 70% 62%)`);
        R(x - 2, y + 9, 2, 1, "rgba(255,255,255,.6)");
      } else {
        for (let i = 0; i < 3; i++) { R(x - 7, y + 9 + i * 2, 14, 3, C.outline); R(x - 6, y + 10 + i * 2, 12, 1, i === 1 ? "#bfc4d4" : C.paper); }
      }
    }
    const pawY = y + (s.cargo ? 10 : 11);
    for (const px of [-4, 2]) { R(x + px - 1, pawY - 1, 4, 3, C.outline); R(x + px, pawY, 2, 1, CAT.white); }
    // three little stars orbiting
    for (let i = 0; i < 3; i++) {
      const a2 = t * 1.6 + i * 2.1, ox = x + Math.cos(a2) * 15, oy = y - 2 + Math.sin(a2) * 6;
      const tw = Math.sin(t * 5 + i * 2) > 0;
      R(ox, oy, 1, 1, CAT.star);
      if (tw) { R(ox - 1, oy, 3, 1, "rgba(255,247,194,.6)"); R(ox, oy - 1, 1, 3, "rgba(255,247,194,.6)"); }
    }
  }

  function drawEffects() {
    for (let i = effects.length - 1; i >= 0; i--) {
      const f = effects[i];
      if (f.kind === "arc") {
        const p = (now - f.t0) / f.dur;
        if (p >= 1) { effects.splice(i, 1); continue; }
        const x = f.x0 + (f.x1 - f.x0) * p, y = f.y0 + (f.y1 - f.y0) * p - 40 * 4 * p * (1 - p);
        ellipse(x, y, 3, 2, C.outline); ellipse(x, y, 2, 1, f.color);
      } else if (f.kind === "fall") {
        f.vy += 0.35; f.y += f.vy;
        if (f.y > P.bin.y - 28 || now > f.until) { effects.splice(i, 1); continue; }
        ellipse(f.x, f.y, 5, 5, C.outline);
        ellipse(f.x, f.y, 4, 4, f.cargo.kind === "chip" ? `hsl(${hueOf(f.cargo.addr)} 70% 62%)` : C.paper);
      } else if (f.kind === "plop") {
        const p = (now - f.t0) / 0.5;
        if (p >= 1) { effects.splice(i, 1); continue; }
        ring(f.x, f.y, 3 + p * 8, 2 + p * 5, f.color);
      }
    }
  }

  // bubbles: boxes in the art layer, text later at full resolution
  let boxes = [];
  function drawBubbles() {
    boxes = [];
    ctx.font = `700 ${Math.max(5 * devicePixelRatio, 5 * scale)}px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`;
    for (const [id, b] of Object.entries(bubbles)) {
      if (now > b.until) { delete bubbles[id]; continue; }
      const p = pos[id]; if (!p) continue;
      const w = Math.ceil(ctx.measureText(b.text).width / scale) + 8, h = 11;
      let x = p.x + 16, y = p.y - 22, left = false;
      if (x + w > W - 4) { x = p.x - 16 - w; left = true; }
      R(x - 1, y - 1, w + 2, h + 2, C.outline); R(x, y, w, h, "#f4f6ff"); R(x, y + h - 2, w, 2, "#c9cede");
      R(x, y, w, 1, "#ffffff"); R(x, y, 2, h, CHARS[id].color);
      const c0 = left ? x + w - 7 : x + 3;                        // tail toward the speaker
      for (let i = 0; i < 3; i++) {
        R(c0 + (left ? i : -i), y + h + 1 + i, 4, 1, C.outline); R(c0 + (left ? i : -i) + 1, y + h + i, 2, 1, "#c9cede");
      }
      boxes.push({ x: x + 5, y: y + 5.5, text: b.text });
    }
  }


  // --- the break-corner TV ----------------------------------------------------------
  const tv = { on: false, since: -9, videos: [], hover: false };
  function drawTv(t) {
    const v = P.tv; if (!v) return;
    const { x, y, w, h } = v, age = now - tv.since;
    // cabinet
    shadow(x + w / 2, 263, w / 2 + 14, 3, 0.45);
    R(x - 9, 248, w + 18, 15, C.outline); R(x - 8, 249, w + 16, 3, "#2d3550"); R(x - 8, 249, w + 16, 1, "#3d4767");
    R(x - 8, 252, w + 16, 10, "#1b2032");
    R(x - 4, 254, w / 2 - 6, 6, "#151927"); R(x + w / 2 + 2, 254, w / 2 - 6, 6, "#151927");
    R(x + w / 2 - 6, 256, 3, 1, C.deskHi); R(x + w / 2 + 4, 256, 3, 1, C.deskHi);
    R(x + 6, 250, 16, 2, "#0b0e17"); R(x + 19, 250, 1, 1, tv.on ? C.green : "#16301f");   // a little box
    // the set
    R(x + w / 2 - 10, 244, 20, 5, C.outline); R(x + w / 2 - 9, 245, 18, 3, "#262c3f");
    R(x - 5, y - 5, w + 10, h + 10, C.outline); R(x - 4, y - 4, w + 8, h + 8, "#14171f");
    R(x - 4, y - 4, w + 8, 1, "#2a2f40"); R(x - 4, y + h + 2, w + 8, 2, "#0d0f15");
    R(x + w + 1, y + h + 2, 2, 1, tv.on ? C.green : C.red);                // power light
    if (tv.on) {
      glow(x + w / 2, y + h / 2, w * 0.9, ["#5fb4ff", "#ffa62b", "#b98cff"][Math.floor(t / 4) % 3], 0.1);
      glow(x + w / 2, 285, w * 0.6, "#5fb4ff", 0.06);                       // light on the couch
    }
    // the screen (the video itself is a YouTube player laid over this rectangle)
    R(x, y, w, h, "#05070b");
    if (tv.on && age < 0.45) {                                             // CRT warm-up: a line opens out
      const p = age / 0.45, lh = Math.max(1, Math.round(h * p * p));
      glow(x + w / 2, y + h / 2, w * 0.5, "#dfe9ff", 0.35 * (1 - p));
      R(x, y + (h - lh) / 2, w, lh, p < 0.5 ? "#f4f6ff" : "#9fb7d9");
    } else if (!tv.on && age < 0.35) {                                      // switching off: shrink to a dot
      const p = age / 0.35, lw = Math.max(1, Math.round(w * (1 - p))), lh = Math.max(1, Math.round(3 * (1 - p)));
      R(x + (w - lw) / 2, y + h / 2 - lh / 2, lw, lh, "#f4f6ff");
    } else if (tv.on && !tv.videos.length) {                                // on, nothing to show: static
      for (let i = 0; i < 260; i++) {
        const sx = x + Math.floor(seed(i + Math.floor(t * 20) * 7) * w), sy = y + Math.floor(seed(i * 3 + Math.floor(t * 20)) * h);
        R(sx, sy, 2, 1, seed(i * 11) > 0.5 ? "#8b93a8" : "#3a4058");
      }
    } else if (!tv.on) {                                                    // off: glass reflections
      for (let i = 0; i < Math.min(w, h); i += 1) R(x + w * 0.55 + i * 0.6, y + i, 3, 1, "rgba(255,255,255,.03)");
      R(x + 3, y + 3, w * 0.25, 1, "rgba(255,255,255,.06)");
      if (tv.hover) { g.globalAlpha = 0.5; R(x, y, w, h, "#121a2c"); g.globalAlpha = 1; }
    }
  }

  function drawRemote() {                             // on the couch seat, drawn after the couch
    if (!P.tv) return;
    const r = P.remote, age = now - tv.since;
    R(r.x - 1, r.y - 1, 6, 11, C.outline); R(r.x, r.y, 4, 9, "#2a2f40"); R(r.x, r.y, 4, 1, "#3a4058");
    R(r.x + 1, r.y + 1, 2, 2, age < 0.25 ? "#ffd1d8" : C.red);
    for (let i = 0; i < 3; i++) R(r.x + 1, r.y + 4 + i * 2, 2, 1, "#555d78");
    if (age < 0.25) glow(r.x + 2, r.y + 2, 6, C.red, 0.6);                 // infrared blink
  }

  function placeTv() {                                // keep the YouTube player on the TV's screen
    if (!tvEl) return;
    const v = P?.tv;
    if (!v || !tv.on || !tv.videos.length || now - tv.since < 0.45) { tvEl.style.display = "none"; return; }
    const k = scale / devicePixelRatio, box = cv.parentElement.getBoundingClientRect();
    let w = v.w * k, h = v.h * k, left = v.x * k, top = (v.y + TOP) * k, big = false;
    if (h < 200) {                                    // YouTube needs at least 200 px: pop out a bit larger
      big = true; h = 200; w = (200 * 16) / 9;
      left = Math.min(left, box.width - w - 4); top = Math.max(4, top + v.h * k - h);
    }
    Object.assign(tvEl.style, { display: "block", left: `${left}px`, top: `${top}px`,
                                width: `${w}px`, height: `${h}px` });
    tvEl.classList.toggle("big", big);
  }

  function tvEmbedUrl(ids) {
    const ok = ids.filter((id) => /^[A-Za-z0-9_-]{11}$/.test(id));
    const q = new URLSearchParams({ autoplay: "1", playsinline: "1", rel: "0", loop: "1",
                                    playlist: ok.join(","), origin: location.origin });
    return ok.length ? `https://www.youtube-nocookie.com/embed/${ok[0]}?${q}` : null;
  }

  function setTv(on, videos) {
    tv.on = !!on; tv.since = now;
    tv.videos = on ? (videos || []) : [];
    if (!tvEl) return;
    tvEl.innerHTML = "";
    const src = on && tvEmbedUrl(tv.videos.map((v) => v.id));
    if (src) {
      const f = document.createElement("iframe");
      Object.assign(f, { src, title: "Pacers highlights", allowFullscreen: true,
                         referrerPolicy: "strict-origin-when-cross-origin" });
      f.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
      tvEl.appendChild(f);
    }
  }

  function tvHit(e) {                                 // is the pointer on the TV or its remote?
    if (!P?.tv) return false;
    const r = cv.getBoundingClientRect(), k = r.width / W;
    const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k - TOP;
    const v = P.tv, m = P.remote;
    return (x >= v.x - 5 && x <= v.x + v.w + 5 && y >= v.y - 5 && y <= v.y + v.h + 5)
        || (x >= m.x - 4 && x <= m.x + 8 && y >= m.y - 4 && y <= m.y + 13);
  }

  // --- frame -------------------------------------------------------------------------
  let tags = {}, lastTs = 0;
  function frame(ts) {
    const t = ts / 1000, dt = Math.min(0.1, lastTs ? t - lastTs : 0);
    lastTs = t; now = t;
    if (!P) { requestAnimationFrame(frame); return; }
    direct(t); moveCat(dt);
    active = showActive(t) ?? (show.mode === "replay" ? null : stateActive);
    g = a; tags = {};
    a.drawImage(bg, 0, 0);
    a.save(); a.translate(0, TOP);
    wallScreen(t); verdictBoard();
    rejectBin(t, S ? (S._rejectsToday || 0) : 0);
    serverRack(t); drawTv(t); couch(); drawRemote(); cooler(t);
    P.plants.slice(0, 1).forEach(([x, y], i) => plant(x, y, t, i));
    headDesk(t);
    DESK_ROW.slice(0, 3).forEach((id, i) => desk(id, P.desks[id].x, P.desks[id].y, t, i));
    DESK_ROW.slice(3).forEach((id, i) => desk(id, P.desks[id].x, P.desks[id].y, t, i + 3));
    scoreboard(t);
    if (!walkers.score) character("score", P.score.x, P.score.y, t);
    P.plants.slice(1).forEach(([x, y], i) => plant(x, y, t, i + 1));
    for (const [id, w] of Object.entries(walkers)) {   // characters out of their seats
      const p = walkerPos(w);
      if (p.done) { delete walkers[id]; continue; }
      character(id, p.x, p.by, t, { walking: p.moving });
    }
    if (show.mode === "replay") {                     // a pink tag under the wall screen
      R(P.cx - 51, 87, 102, 12, C.outline); R(P.cx - 50, 88, 100, 10, "#2a0f22"); R(P.cx - 50, 88, 100, 1, C.pink);
    }
    drawEffects(); drawCat(t); drawBubbles();
    a.restore();
    a.drawImage(overlay, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.drawImage(art, 0, 0, cv.width, cv.height);
    text(t); placeTv();
    requestAnimationFrame(frame);
  }

  function label(s, x, y, color, size, align = "center", weight = 700) {
    const px = Math.max(5 * devicePixelRatio, size * scale);
    ctx.font = `${weight} ${px}px ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace`;
    ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.fillStyle = color;
    ctx.fillText(s, x * scale, (y + TOP) * scale);
  }

  function text(t) {
    for (const b of boxes) label(b.text, b.x, b.y, "#0b0d14", 5, "left");
    if (cat.cargo?.kind === "chip")
      label(String(cat.cargo.ticker || "?").slice(0, 2).toUpperCase(), cat.x, cat.y + 12.5 + Math.round(Math.sin(t * (cat.moving ? 6 : 2)) * (cat.moving ? 1 : 2)), "#0b0d14", 3.6);
    if (show.mode === "replay") {
      const when = show.cycle ? new Date(show.cycle * 1000) : null;
      label(`▶ REPLAY${when && !isNaN(when) ? " · cycle of " + when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}`,
            P.cx, 93, Math.floor(t * 2) % 2 ? C.pink : "#ff8fd3", 4.8);
    }
    for (const [id, p] of Object.entries(tags)) {
      const on = active === id;
      label(CHARS[id].name, p.x, p.y, on ? "#0b0d14" : CHARS[id].color, 5.2);
    }
    // wall screen
    const s = P.screen;
    const f = S && ((S.finalists || []).find((x) => x.addr === S._selected) || S.finalists?.[0]);
    label(f ? `${String(f.ticker).slice(0, 16)} · 5m candles` : "waiting for a finalist", s.x + 4, s.y + 5, "#9aa1b5", 4.6, "left");
    const nextIn = S ? Math.max(0, Math.round((S.desk.next_cycle - Date.now() / 1000) / 60)) : null;
    label(running ? "● LIVE" : nextIn != null ? `IDLE · NEXT IN ${nextIn}M` : "IDLE",
          s.x + s.w - (running ? 10 : 4), s.y + 5, running ? C.red : "#6b7290", 4.6, "right");
    // left wall
    const fb = P.finalists, vb = P.verdicts;
    if (fb.w > 40) {
      label("FINALISTS", fb.x + 5, fb.y + 7, C.pink, 4.6, "left");
      if (!(S?.finalists || []).length) label("none this cycle", fb.x + fb.w / 2, fb.y + 28, "#5d6480", 4.6);
    }
    if (vb.w > 40) label("JUDGED TODAY", vb.x + 5, vb.y + 11, "#7d8499", 4.2, "left");
    // clock and today board
    const c = P.clock;
    label(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), c.x + c.w / 2, c.y + 13, C.green, 8.5);
    label("LOCAL TIME", c.x + c.w / 2, c.y + 25, "#7d8499", 4.2);
    const tb = P.today;
    const today = S ? [`TODAY`, `${S.desk.cycles_today} cycles`, `${S._judgedToday || 0} judged`,
      `${S._picksToday || 0} picks`, `jev $${(S.jev_today?.cost || 0).toFixed(3)}`] : ["TODAY"];
    if (tb.w > 40) today.forEach((x, i) => label(x, tb.x + 6, tb.y + 9 + i * 12, i ? C.text : C.pink, i ? 5.2 : 4.8, "left"));
    // fixtures
    const b = P.bin;
    label("REJECTED", b.x, b.y + 8, "#7d8499", 4.2);
    if (S) label(String(S._rejectsToday || 0), b.x, b.y - 13.5, C.red, 6.5);
    if (P.tv) {                                       // the TV's caption, on its cabinet
      const v = P.tv, n = tv.videos.length;
      label(tv.on ? (n ? `PACERS HIGHLIGHTS · ${n} VIDEO${n === 1 ? "" : "S"}` : "NO HIGHLIGHTS RIGHT NOW")
                  : (tv.hover ? "CLICK TO TURN ON" : "TV · CLICK THE REMOTE"),
            v.x + v.w / 2, 257.5, tv.on ? C.pink : "#6b7290", 4);
    }
    const sb = P.scoreboard, sc = S?.score?.by_verdict?.all?.["1h"];
    label("SCOREBOARD · 1H", sb.x, sb.y + 7.5, "#7d8499", 4);
    label(sc?.n ? `${sc.avg >= 0 ? "+" : ""}${sc.avg.toFixed(1)}%  n=${sc.n}` : "no 1h prices yet", sb.x, sb.y + 24,
          sc?.n ? (sc.avg >= 0 ? C.green : C.red) : "#5d6480", 4.6);
  }

  function cycleTime(cycle, evts) {               // cycle ids look like 20261009T194500Z
    const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(String(cycle || ""));
    if (m) return Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
    return evts?.[0]?.t ?? null;
  }

  function resize() {
    const box = cv.parentElement.getBoundingClientRect(), dpr = devicePixelRatio;
    if (box.width < 10 || box.height < 10) return;
    scale = (box.height * dpr) / ROOM; TOP = 0;
    W = Math.round((box.width * dpr) / scale);
    if (W < MIN_W) {                                   // narrow panel: keep the room's width, raise the ceiling
      W = MIN_W; scale = (box.width * dpr) / W;
      TOP = Math.max(0, Math.floor((box.height * dpr) / scale - ROOM));
    }
    H = ROOM + TOP;
    cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
    cv.style.width = `${cv.width / dpr}px`; cv.style.height = `${cv.height / dpr}px`;
    art.width = W; art.height = H;
    P = positions(); buildBackground(); buildOverlay();
    cat.x = null; cat.path = [];               // re-home the cat in the new room
    if (chipsEl) {                                     // finalist chips sit on the left wall board
      const fb = P.finalists, k = scale / dpr;
      Object.assign(chipsEl.style, { left: `${(fb.x + 4) * k}px`, top: `${(fb.y + TOP + 12) * k}px`,
        width: `${(fb.w - 8) * k}px`, height: `${(fb.h - 15) * k}px`, display: fb.w > 40 ? "" : "none" });
      chipsEl.style.setProperty("--chip", `${Math.round(Math.min(30, (fb.h - 19) * k))}px`);
    }
  }

  return {
    init(canvas, chips, tvBox) {
      cv = canvas; ctx = cv.getContext("2d"); chipsEl = chips || null; tvEl = tvBox || null;
      cv.addEventListener("click", (e) => { if (tvHit(e) && Office.onTvClick) Office.onTvClick(); });
      cv.addEventListener("mousemove", (e) => { tv.hover = tvHit(e); cv.style.cursor = tv.hover ? "pointer" : ""; });
      art = document.createElement("canvas"); a = art.getContext("2d");
      for (const id of ORDER) sprites[id] = makeSprite(id);
      new ResizeObserver(resize).observe(cv.parentElement);
      resize();
      requestAnimationFrame(frame);
    },
    update(state, opts = {}) {
      S = state; running = !!state.desk?.running; stateActive = opts.active ?? null;
    },
    event(e) {
      if (!P) return;
      if (show.mode === "replay") stopReplay();
      const step = plan(e);
      if (step) show.queue.push(step);
    },
    replay(evts, cycle) {
      if (!P || show.mode === "replay") return;
      const steps = (evts || []).map(plan).filter(Boolean);
      if (!steps.length) return;
      stopReplay();
      show.mode = "replay"; show.cycle = cycleTime(cycle, evts);
      const trips = new Set(["scout.done", "market.done", "chain.done"]);
      const trip_ = (st) => trips.has(st.k) || (st.k === "jev.token" && !st.e.fails?.length);
      const total = steps.reduce((sum, st) => sum + (trip_(st) ? 2.4 : st.k === "pick.decision" ? 3.2 : 1.2), 0);
      show.f = Math.max(0.3, Math.min(1, 40 / total));
      show.queue = steps;
    },
    busy() { return show.queue.length > 0 || !!show.step || cat.path.length > 0 || Object.keys(walkers).length > 0; },
    replaying() { return show.mode === "replay"; },
    debug() {                                         // for the browser console
      return { mode: show.mode, queued: show.queue.length, step: show.step?.k, ends_in: +(show.end - now).toFixed(1),
               speed: show.f, cat_path: cat.path.length, cat_at: [Math.round(cat.x), Math.round(cat.y + TOP)],
               room_width: W, walkers: Object.keys(walkers) };
    },
    setCandles(cs) { candles = cs || []; },
    tv(on, videos) { setTv(on, videos); },
    tvOn() { return tv.on; },
    onTvClick: null,
    // stage id -> page coordinates of that character 
    layout() {
      const r = cv.getBoundingClientRect(), k = r.width / W, out = {};
      if (!P) return out;
      for (const [id, d] of Object.entries(P.desks)) out[id] = { x: r.left + d.x * k, y: r.top + (d.y + TOP + 17) * k };
      out.desk = { x: r.left + P.head.x * k, y: r.top + (P.head.y + TOP - 9) * k };
      out.score = { x: r.left + P.score.x * k, y: r.top + (P.score.y + TOP - 13) * k };
      return out;
    },
  };
})();
