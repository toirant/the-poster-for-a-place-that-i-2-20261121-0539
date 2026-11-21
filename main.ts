// SOLMARA — "The Poster for a Place That Isn't There"
//
// A travel poster for a place that does not exist, drawn entirely by code.
// The program renders a 1024x1024 poster at 2x supersampling with a small
// software rasterizer (gradients, discs, polygons, lines, a 5x7 bitmap
// font), downsamples it, and encodes the PNG by hand with node:zlib.
//
// The place: SOLMARA, an isle where the sun never sets — a golden dusk
// that never ends, a ringed planet in the violet sky, a cliff town with
// lamplit windows, a lighthouse whose beam crosses a lagoon, and sailboats
// drifting home. One landmark (the lighthouse), one promise (endless dusk).
//
// Deterministic: no network, no randomness without a fixed seed, no clock.
// Two runs write byte-identical files.
//
// Run it exactly as the grader does (outside the container,
// MAKEFUN_OUTPUT_DIR stands in for /output):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

// ---------------------------------------------------------------------------
// Output size and supersampling
// ---------------------------------------------------------------------------

const OUT_W = 1024;
const OUT_H = 1024;
const SS = 2; // render at 2048x2048, then box-downsample to 1024x1024
const W = OUT_W * SS;
const H = OUT_H * SS;

// ---------------------------------------------------------------------------
// Deterministic pseudo-random numbers (mulberry32, fixed seed)
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(20261121);

// ---------------------------------------------------------------------------
// Colour helpers. A colour is [r, g, b] with channels 0-255.
// ---------------------------------------------------------------------------

type RGB = [number, number, number];

function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// ---------------------------------------------------------------------------
// Rasterizer: an RGBA buffer in supersampled space, with source-over blending
// ---------------------------------------------------------------------------

class Raster {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.data = new Uint8Array(w * h * 4);
  }

  // Set one pixel, blending colour over what is already there. Alpha 0-1.
  blend(x: number, y: number, c: RGB, alpha: number): void {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    if (xi < 0 || yi < 0 || xi >= this.w || yi >= this.h) return;
    const i = (yi * this.w + xi) * 4;
    const a = clamp(alpha, 0, 1);
    const inv = 1 - a;
    this.data[i] = Math.round(c[0] * a + this.data[i] * inv);
    this.data[i + 1] = Math.round(c[1] * a + this.data[i + 1] * inv);
    this.data[i + 2] = Math.round(c[2] * a + this.data[i + 2] * inv);
    this.data[i + 3] = 255;
  }

  // Fill an axis-aligned rectangle. Coordinates are in poster space (1024).
  rect(px: number, py: number, pw: number, ph: number, c: RGB, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(px * SS));
    const y0 = Math.max(0, Math.floor(py * SS));
    const x1 = Math.min(this.w, Math.ceil((px + pw) * SS));
    const y1 = Math.min(this.h, Math.ceil((py + ph) * SS));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * this.w + x) * 4;
        if (alpha >= 1) {
          this.data[i] = c[0];
          this.data[i + 1] = c[1];
          this.data[i + 2] = c[2];
          this.data[i + 3] = 255;
        } else {
          const inv = 1 - alpha;
          this.data[i] = Math.round(c[0] * alpha + this.data[i] * inv);
          this.data[i + 1] = Math.round(c[1] * alpha + this.data[i + 1] * inv);
          this.data[i + 2] = Math.round(c[2] * alpha + this.data[i + 2] * inv);
          this.data[i + 3] = 255;
        }
      }
    }
  }

  // Fill one horizontal span. Coordinates are in poster space (1024).
  hspan(px0: number, px1: number, py: number, c: RGB, alpha = 1): void {
    this.rect(px0, py, px1 - px0, 1, c, alpha);
  }

  // Fill a disc. Coordinates are in poster space (1024).
  disc(cx: number, cy: number, r: number, c: RGB, alpha = 1): void {
    const R = r * SS;
    const CX = cx * SS;
    const CY = cy * SS;
    const x0 = Math.max(0, Math.floor(CX - R));
    const x1 = Math.min(this.w - 1, Math.ceil(CX + R));
    const y0 = Math.max(0, Math.floor(CY - R));
    const y1 = Math.min(this.h - 1, Math.ceil(CY + R));
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - CY;
      const dx = Math.sqrt(Math.max(0, R * R - dy * dy));
      const xa = Math.max(x0, Math.ceil(CX - dx));
      const xb = Math.min(x1, Math.floor(CX + dx));
      for (let x = xa; x <= xb; x++) this.blend(x, y, c, alpha);
    }
  }

  // Fill a disc whose colour fades from `inner` at the centre to `outer`
  // at the rim, with overall alpha falling off toward the edge.
  radialDisc(cx: number, cy: number, r: number, inner: RGB, outer: RGB): void {
    const R = r * SS;
    const CX = cx * SS;
    const CY = cy * SS;
    const x0 = Math.max(0, Math.floor(CX - R));
    const x1 = Math.min(this.w - 1, Math.ceil(CX + R));
    const y0 = Math.max(0, Math.floor(CY - R));
    const y1 = Math.min(this.h - 1, Math.ceil(CY + R));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - CX;
        const dy = y + 0.5 - CY;
        const d = Math.sqrt(dx * dx + dy * dy) / R;
        if (d > 1) continue;
        const t = d * d; // ease the falloff
        this.blend(x, y, mix(inner, outer, t), 1 - t * 0.55);
      }
    }
  }

  // Fill a simple polygon (even-odd scanline fill). Points in poster space.
  poly(points: Array<[number, number]>, c: RGB, alpha = 1): void {
    const pts = points.map(([x, y]) => [x * SS, y * SS] as [number, number]);
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    const y0 = Math.max(0, Math.floor(minY));
    const y1 = Math.min(this.h - 1, Math.ceil(maxY));
    for (let y = y0; y <= y1; y++) {
      const yc = y + 0.5;
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const [x0, y0p] = pts[i];
        const [x1, y1p] = pts[(i + 1) % pts.length];
        if ((y0p <= yc && y1p > yc) || (y1p <= yc && y0p > yc)) {
          xs.push(x0 + ((yc - y0p) * (x1 - x0)) / (y1p - y0p));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.ceil(xs[k]));
        const xb = Math.min(this.w - 1, Math.floor(xs[k + 1]));
        for (let x = xa; x <= xb; x++) this.blend(x, y, c, alpha);
      }
    }
  }

  // Draw a thick line by stamping discs along it. Poster-space coordinates.
  line(x0: number, y0: number, x1: number, y1: number, width: number, c: RGB, alpha = 1): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.sqrt(dx * dx + dy * dy);
    const steps = Math.max(1, Math.ceil(len * SS));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.disc(x0 + dx * t, y0 + dy * t, width / 2, c, alpha);
    }
  }

  // Draw a thick polyline through the given points.
  polyline(points: Array<[number, number]>, width: number, c: RGB, alpha = 1): void {
    for (let i = 0; i + 1 < points.length; i++) {
      const [x0, y0] = points[i];
      const [x1, y1] = points[i + 1];
      this.line(x0, y0, x1, y1, width, c, alpha);
    }
  }

  // Stroke an arc of a rotated ellipse (used for the planet's ring).
  ellipseArc(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotDeg: number,
    a0: number,
    a1: number,
    width: number,
    c: RGB,
    alpha = 1,
  ): void {
    const rot = (rotDeg * Math.PI) / 180;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const steps = 120;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      const ex = rx * Math.cos(a);
      const ey = ry * Math.sin(a);
      const x = cx + ex * cos - ey * sin;
      const y = cy + ex * sin + ey * cos;
      this.disc(x, y, width / 2, c, alpha);
    }
  }

  // Vertical gradient between y0 and y1 over a list of [position, colour].
  vgrad(y0: number, y1: number, stops: Array<[number, RGB]>): void {
    const y0s = Math.max(0, Math.floor(y0 * SS));
    const y1s = Math.min(this.h, Math.ceil(y1 * SS));
    for (let y = y0s; y < y1s; y++) {
      const t = (y / SS - y0) / (y1 - y0);
      let c: RGB = stops[stops.length - 1][1];
      for (let s = 0; s + 1 < stops.length; s++) {
        if (t >= stops[s][0] && t <= stops[s + 1][0]) {
          const f = (t - stops[s][0]) / (stops[s + 1][0] - stops[s][0]);
          c = mix(stops[s][1], stops[s + 1][1], f);
          break;
        }
      }
      for (let x = 0; x < this.w; x++) {
        const i = (y * this.w + x) * 4;
        this.data[i] = c[0];
        this.data[i + 1] = c[1];
        this.data[i + 2] = c[2];
        this.data[i + 3] = 255;
      }
    }
  }

  // Box-downsample by SS into a 1024x1024 RGBA buffer.
  downsample(): Uint8Array {
    const out = new Uint8Array(OUT_W * OUT_H * 4);
    for (let y = 0; y < OUT_H; y++) {
      for (let x = 0; x < OUT_W; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        for (let dy = 0; dy < SS; dy++) {
          for (let dx = 0; dx < SS; dx++) {
            const i = ((y * SS + dy) * this.w + x * SS + dx) * 4;
            r += this.data[i];
            g += this.data[i + 1];
            b += this.data[i + 2];
          }
        }
        const o = (y * OUT_W + x) * 4;
        const n = SS * SS;
        out[o] = Math.round(r / n);
        out[o + 1] = Math.round(g / n);
        out[o + 2] = Math.round(b / n);
        out[o + 3] = 255;
      }
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// 5x7 bitmap font (A-Z, 0-9, space, hyphen, period, apostrophe)
// ---------------------------------------------------------------------------

const FONT: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  J: ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  Q: ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  X: ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['01110', '10001', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '10001', '01110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '-': ['00000', '00000', '00000', '01110', '00000', '00000', '00000'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  "'": ['00100', '00100', '01000', '00000', '00000', '00000', '00000'],
};

// Draw one line of text, centred on cx, top edge at y. `scale` is the size
// of one font pixel in poster units; glyphs are 5 wide, 7 tall, 1 gap.
function drawText(
  r: Raster,
  text: string,
  cx: number,
  y: number,
  scale: number,
  c: RGB,
  alpha = 1,
): void {
  const pitch = 6 * scale;
  const width = text.length * pitch - scale;
  let x = cx - width / 2;
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '1') {
          r.rect(x + col * scale, y + row * scale, scale, scale, c, alpha);
        }
      }
    }
    x += pitch;
  }
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

const HORIZON = 600; // where the sea meets the sky

function drawSky(r: Raster): void {
  r.vgrad(0, HORIZON, [
    [0, [18, 24, 58]], // deep indigo night at the top
    [0.34, [58, 44, 98]], // violet
    [0.6, [138, 74, 107]], // mauve
    [0.82, [214, 104, 78]], // ember rose
    [1, [249, 169, 75]], // gold at the horizon
  ]);

  // Stars fading out toward the bright horizon.
  for (let i = 0; i < 70; i++) {
    const x = rand() * OUT_W;
    const y = rand() * 380;
    const a = 0.25 + rand() * 0.6 * (1 - y / 420);
    const s = rand() < 0.2 ? 2.4 : 1.4;
    r.disc(x, y, s, [255, 244, 214], a);
  }
}

function drawPlanet(r: Raster): void {
  // A small ringed planet high in the dusk sky: this is not Earth.
  const cx = 806;
  const cy = 168;
  // Ring, back half first.
  r.ellipseArc(cx, cy, 78, 20, -18, Math.PI, 2 * Math.PI, 5, [232, 213, 255], 0.75);
  // Planet body.
  r.radialDisc(cx, cy, 42, [216, 186, 255], [122, 95, 192]);
  // Terminator shadow on the lower right.
  r.disc(cx + 14, cy + 12, 34, [74, 56, 128], 0.35);
  // Ring, front half over the body.
  r.ellipseArc(cx, cy, 78, 20, -18, 0, Math.PI, 5, [238, 222, 255], 0.9);
}

function drawSun(r: Raster): void {
  // A low, huge sun sitting on the horizon, with a soft halo.
  r.radialDisc(512, 512, 250, [255, 214, 120], [255, 170, 80]);
  r.radialDisc(512, 512, 168, [255, 232, 160], [255, 196, 96]);
  r.disc(512, 512, 104, [255, 240, 178], 1);
  // A few thin rays fanning out, barely there.
  for (let i = 0; i < 9; i++) {
    const a = (Math.PI * (200 + i * 20)) / 180;
    const x0 = 512 + Math.cos(a) * 118;
    const y0 = 512 + Math.sin(a) * 118;
    const x1 = 512 + Math.cos(a) * 168;
    const y1 = 512 + Math.sin(a) * 168;
    r.line(x0, y0, x1, y1, 3, [255, 226, 150], 0.35);
  }
}

function drawSea(r: Raster): void {
  r.vgrad(HORIZON, OUT_H, [
    [0, [44, 106, 114]], // lit water under the sunset
    [0.25, [24, 74, 88]],
    [0.6, [14, 48, 66]],
    [1, [8, 30, 46]], // deep water at the bottom
  ]);

  // The sun's reflection: a shimmering gold column down the middle.
  for (let y = HORIZON + 12; y < OUT_H - 30; y += 13) {
    const spread = 26 + (y - HORIZON) * 0.16;
    const w = spread * (0.5 + rand() * 0.9);
    const x = 512 - w / 2 + (rand() - 0.5) * 30;
    const a = 0.16 + rand() * 0.3 * (1 - (y - HORIZON) / 460);
    r.rect(x, y, w, 5, [255, 207, 110], a);
  }

  // Short pale wave strokes, scattered across the water.
  for (let i = 0; i < 90; i++) {
    const x = rand() * OUT_W;
    const y = HORIZON + 30 + rand() * (OUT_H - HORIZON - 60);
    const w = 14 + rand() * 46;
    const a = 0.05 + rand() * 0.12;
    r.rect(x, y, w, 2.4, [178, 222, 230], a);
  }
}

function drawLeftCliff(r: Raster): void {
  // The old cliff town: dark headland on the left, lamplit windows.
  const cliff: RGB = [26, 34, 64];
  r.poly(
    [
      [0, 700],
      [88, 566],
      [188, 498],
      [262, 556],
      [322, 640],
      [330, 1024],
      [0, 1024],
    ],
    cliff,
  );
  // Windows glowing warm along the slope.
  const windows: Array<[number, number]> = [
    [96, 596], [128, 576], [158, 566], [188, 574], [216, 592],
    [112, 640], [150, 622], [186, 634], [222, 650], [248, 668],
    [70, 668], [132, 700], [176, 716], [232, 724], [96, 748],
  ];
  for (const [x, y] of windows) {
    r.rect(x, y, 7, 9, [255, 210, 122], 0.95);
  }
  // Tiny rooftops catching the last light.
  r.poly([[88, 566], [118, 544], [148, 566]], [214, 96, 66], 0.9);
  r.poly([[188, 498], [214, 478], [240, 498]], [214, 96, 66], 0.9);
}

function drawRightCliffAndLighthouse(r: Raster): void {
  const cliff: RGB = [20, 28, 56];
  r.poly(
    [
      [1024, 688],
      [952, 566],
      [884, 522],
      [832, 596],
      [856, 1024],
      [1024, 1024],
    ],
    cliff,
  );

  // The lighthouse: Solmara's one landmark, cream tower, red band.
  const cream: RGB = [242, 231, 206];
  r.poly([[892, 524], [918, 524], [912, 420], [898, 420]], cream);
  r.rect(895, 468, 20, 16, [182, 80, 63], 1); // red band
  r.rect(894, 398, 22, 22, [32, 38, 74], 1); // lamp room
  r.poly([[892, 398], [918, 398], [905, 382]], [182, 80, 63], 1); // cap
  r.disc(905, 409, 11, [255, 233, 168], 0.95); // the lamp itself
  r.disc(905, 409, 26, [255, 226, 150], 0.25); // its glow

  // The beam sweeps left across the lagoon toward the town.
  r.poly(
    [
      [905, 409],
      [292, 446],
      [292, 556],
    ],
    [255, 233, 168],
    0.16,
  );

  // A few lamplit windows on the lighthouse cliff too.
  for (const [x, y] of [
    [872, 640],
    [906, 622],
    [938, 664],
    [968, 706],
    [896, 724],
  ] as Array<[number, number]>) {
    r.rect(x, y, 7, 9, [255, 210, 122], 0.9);
  }
}

function drawBoats(r: Raster): void {
  const boat = (cx: number, cy: number, s: number): void => {
    // Hull and reflection.
    r.poly(
      [
        [cx - 26 * s, cy],
        [cx + 26 * s, cy],
        [cx + 17 * s, cy + 10 * s],
        [cx - 17 * s, cy + 10 * s],
      ],
      [16, 24, 46],
    );
    r.rect(cx - 20 * s, cy + 13 * s, 40 * s, 2.4, [16, 24, 46], 0.5);
    // Mast and sails, lit by the sunset.
    r.line(cx, cy - 42 * s, cx, cy, 2.4 * s, [30, 36, 62], 1);
    r.poly(
      [
        [cx + 2 * s, cy - 40 * s],
        [cx + 2 * s, cy - 2 * s],
        [cx + 24 * s, cy - 2 * s],
      ],
      [246, 239, 221],
    );
    r.poly(
      [
        [cx - 2 * s, cy - 33 * s],
        [cx - 2 * s, cy - 2 * s],
        [cx - 21 * s, cy - 2 * s],
      ],
      [232, 221, 194],
    );
  };
  boat(448, 786, 1);
  boat(648, 862, 0.72);
  boat(742, 742, 0.5);
}

function drawBeachAndPalm(r: Raster): void {
  // A small warm beach in the near-left corner, with a sailboat pulled
  // up onto the sand for the night.
  r.poly(
    [
      [0, 1024],
      [0, 958],
      [118, 922],
      [258, 906],
      [382, 932],
      [432, 1024],
    ],
    [122, 79, 56],
  );
  const boat: RGB = [20, 26, 48];
  r.poly(
    [
      [150, 985],
      [250, 985],
      [235, 1002],
      [165, 1002],
    ],
    boat,
  );
  r.line(200, 985, 184, 928, 3, boat, 1); // tilted mast
  r.poly(
    [
      [184, 928],
      [198, 985],
      [172, 985],
    ],
    [232, 221, 194],
    0.9,
  );
  // A few dry grass tufts at the beach's edge.
  for (const [gx, gy] of [
    [300, 922],
    [316, 918],
    [336, 924],
  ] as Array<[number, number]>) {
    r.line(gx, gy, gx - 4, gy - 14, 2, [58, 48, 36], 0.9);
    r.line(gx, gy, gx + 1, gy - 16, 2, [58, 48, 36], 0.9);
    r.line(gx, gy, gx + 6, gy - 13, 2, [58, 48, 36], 0.9);
  }
}

function drawBirds(r: Raster): void {
  const bird = (x: number, y: number, s: number): void => {
    const c: RGB = [24, 28, 58];
    r.line(x - 9 * s, y, x, y - 5 * s, 2.2, c, 0.85);
    r.line(x, y - 5 * s, x + 9 * s, y, 2.2, c, 0.85);
  };
  bird(296, 226, 1);
  bird(352, 196, 0.8);
  bird(398, 244, 0.7);
  bird(668, 268, 0.9);
  bird(716, 232, 0.7);
}

function drawType(r: Raster): void {
  // A fading wash behind the title so the name reads against the sky
  // without hiding the dusk gradient: strongest at the top, gone by y=300.
  for (let y = 0; y < 300; y += 4) {
    const a = 0.42 * (1 - y / 300);
    r.rect(0, y, OUT_W, 4, [16, 20, 48], a);
  }

  const cream: RGB = [255, 243, 214];
  const shadow: RGB = [18, 16, 48];
  // The name, big and centred, with a soft offset shadow.
  drawText(r, 'SOLMARA', 512 + 5, 66 + 5, 16, shadow, 0.55);
  drawText(r, 'SOLMARA', 512, 66, 16, cream, 1);
  // The promise, smaller, beneath it.
  drawText(r, 'WHERE THE SUN NEVER SETS', 512 + 2, 208 + 2, 5, shadow, 0.5);
  drawText(r, 'WHERE THE SUN NEVER SETS', 512, 208, 5, [255, 233, 196], 1);
  // A thin rule with a diamond, closing the title block.
  r.rect(362, 262, 300, 3, [255, 233, 196], 0.9);
  r.poly([[512, 252], [524, 263], [512, 274], [500, 263]], [255, 233, 196], 0.95);
}

// ---------------------------------------------------------------------------
// PNG encoding (hand-rolled: signature, IHDR, IDAT via zlib, IEND)
// ---------------------------------------------------------------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(rgba: Uint8Array, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Raw scanlines: filter byte 0 (none) + RGBA bytes per row.
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Main: render, encode, write, and self-check against the gate
// ---------------------------------------------------------------------------

function main(): void {
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const outPath = join(outDir, 'entry.png');

  const r = new Raster(W, H);
  drawSky(r);
  drawPlanet(r);
  drawSun(r);
  drawSea(r);
  drawLeftCliff(r);
  drawRightCliffAndLighthouse(r);
  drawBoats(r);
  drawBeachAndPalm(r);
  drawBirds(r);
  drawType(r);

  const rgba = r.downsample();
  const png = encodePng(rgba, OUT_W, OUT_H);

  // Write the output directory's contents only; never remove the directory.
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outPath, png);

  // Self-check against the gate: whole PNG, 1024x1024, at most 1 MiB.
  const back = readFileSync(outPath);
  const size = statSync(outPath).size;
  const isPng =
    back[0] === 0x89 && back[1] === 0x50 && back[2] === 0x4e && back[3] === 0x47;
  const width = back.readUInt32BE(16);
  const height = back.readUInt32BE(20);
  if (!isPng) throw new Error('entry.png is not a PNG');
  if (width !== OUT_W || height !== OUT_H) {
    throw new Error(`entry.png is ${width}x${height}, expected 1024x1024`);
  }
  if (size > 1048576) throw new Error(`entry.png is ${size} bytes, over 1 MiB`);
  console.log(`entry.png: ${width}x${height}, ${size} bytes, valid PNG`);
}

main();
