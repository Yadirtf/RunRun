import * as THREE from 'three';

/**
 * Texturas procedurales generadas en canvas (sin descargas). Cada una se
 * cachea y se acompaña de un mapa normal derivado de su altura, para que
 * asfalto, arena o roca reaccionen a la luz con relieve.
 */
const cache = new Map();

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ruido de valor tileable en una rejilla de `cells` celdas. */
function valueNoise(size, cells, rand) {
  const grid = new Float32Array(cells * cells).map(() => rand());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i, j) => grid[((j % cells) * cells) + (i % cells)];
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

export function fbm(size, seed, octaves = 5, base = 4) {
  const rand = rng(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(size, base << o, rand);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

export function makeCanvas(size, height = size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = height;
  return c;
}

export function toTexture(canvas, { srgb = true, repeat = [1, 1] } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 8;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Mapa normal tileable a partir de un campo de alturas. */
export function normalFromHeight(height, size, strength) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const h = (x, y) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * strength;
      const dy = (h(x, y + 1) - h(x, y - 1)) * strength;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { srgb: false });
}

function paintField(size, field, colorAt) {
  const canvas = makeCanvas(size);
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b] = colorAt(field[i], i);
    img.data[i * 4] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, ctx };
}

export function cached(key, build) {
  if (!cache.has(key)) cache.set(key, build());
  return cache.get(key);
}

/**
 * Asfalto de circuito: árido fino, manchas de goma en la trazada y líneas
 * blancas de borde en u≈0 y u≈1 (la UV u recorre el ancho de la pista).
 */
export function asphaltTextures() {
  return cached('asphalt', () => {
    const size = 512;
    const coarse = fbm(size, 11, 6, 8);
    const rand = rng(77);
    const grain = new Float32Array(size * size).map(() => rand());
    const height = new Float32Array(size * size);
    const { canvas, ctx } = paintField(size, coarse, (v, i) => {
      const g = grain[i];
      height[i] = g * 0.6 + v * 0.4;
      const x = (i % size) / size;
      // Goma oscura concentrada en el centro (trazada).
      const rubber = Math.exp(-((x - 0.5) ** 2) / 0.03) * 18;
      const base = 52 + v * 26 + (g > 0.93 ? 30 : g * 10) - rubber;
      return [base, base, base + 3];
    });
    ctx.fillStyle = 'rgba(235,235,230,0.92)';
    ctx.fillRect(size * 0.015, 0, size * 0.025, size);
    ctx.fillRect(size * 0.96, 0, size * 0.025, size);
    const map = toTexture(canvas);
    const normalMap = normalFromHeight(height, size, 2.2);
    const rough = paintField(size, coarse, (v, i) => {
      const r = 200 + grain[i] * 40 - v * 30;
      return [r, r, r];
    });
    const roughnessMap = toTexture(rough.canvas, { srgb: false });
    return { map, normalMap, roughnessMap };
  });
}

/** Piano rojo/blanco con relieve (u = ancho, v = longitud). */
export function curbTextures() {
  return cached('curb', () => {
    const canvas = makeCanvas(128);
    const ctx = canvas.getContext('2d');
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? '#f2f2f2' : '#c8102e';
      ctx.fillRect(0, i * 32, 128, 32);
    }
    const n = fbm(128, 5, 4, 8);
    const img = ctx.getImageData(0, 0, 128, 128);
    for (let i = 0; i < n.length; i++) {
      const k = 0.85 + n[i] * 0.2;
      img.data[i * 4] *= k;
      img.data[i * 4 + 1] *= k;
      img.data[i * 4 + 2] *= k;
    }
    ctx.putImageData(img, 0, 0);
    return { map: toTexture(canvas) };
  });
}

const SURFACES = {
  grass: { seed: 3, colors: [[58, 92, 38], [92, 128, 52], [120, 140, 70]], strength: 3 },
  gravel: { seed: 9, colors: [[128, 118, 100], [160, 150, 132], [190, 182, 166]], strength: 5 },
  sand: { seed: 21, colors: [[186, 132, 82], [214, 164, 106], [232, 190, 136]], strength: 2.5 },
  rock: { seed: 33, colors: [[96, 88, 82], [128, 118, 108], [160, 150, 140]], strength: 6 },
  redrock: { seed: 41, colors: [[132, 62, 38], [170, 92, 56], [204, 128, 82]], strength: 6 },
  snow: { seed: 51, colors: [[220, 226, 236], [236, 240, 246], [250, 252, 255]], strength: 1.2 },
  meadow: { seed: 61, colors: [[72, 104, 44], [104, 138, 60], [140, 160, 84]], strength: 3 },
  leaves: { seed: 71, colors: [[96, 52, 24], [150, 82, 32], [196, 128, 48]], strength: 4 },
  forest: { seed: 75, colors: [[70, 74, 36], [104, 98, 46], [134, 112, 58]], strength: 3 },
  beach: { seed: 81, colors: [[206, 184, 140], [226, 206, 162], [240, 226, 190]], strength: 2 },
  dirt: { seed: 85, colors: [[92, 72, 52], [120, 96, 70], [150, 124, 94]], strength: 4 },
  concrete: { seed: 91, colors: [[96, 98, 102], [118, 120, 124], [140, 142, 146]], strength: 2 },
  pavement: { seed: 95, colors: [[70, 72, 76], [86, 88, 92], [104, 106, 110]], strength: 1.6 },
};

function mix(a, b, t) {
  return a + (b - a) * t;
}

/** Superficie natural genérica (hierba, grava, arena, roca...). */
export function surfaceTextures(kind) {
  return cached(`surface:${kind}`, () => {
    const cfg = SURFACES[kind];
    const size = 256;
    const field = fbm(size, cfg.seed, 6, 4);
    const rand = rng(cfg.seed * 13);
    const speck = new Float32Array(size * size).map(() => rand());
    const height = field.map((v, i) => v * 0.7 + speck[i] * 0.3);
    const [c0, c1, c2] = cfg.colors;
    const { canvas } = paintField(size, field, (v, i) => {
      const t = Math.min(1, Math.max(0, v * 1.4 - 0.2));
      const a = t < 0.5 ? c0 : c1;
      const b = t < 0.5 ? c1 : c2;
      const k = (t < 0.5 ? t * 2 : (t - 0.5) * 2) + (speck[i] - 0.5) * 0.35;
      return [mix(a[0], b[0], k), mix(a[1], b[1], k), mix(a[2], b[2], k)];
    });
    return { map: toTexture(canvas), normalMap: normalFromHeight(height, size, cfg.strength) };
  });
}

/** Franjas horizontales para las mesetas del desierto (estratos de roca). */
export function strataTexture() {
  return cached('strata', () => {
    const canvas = makeCanvas(256);
    const ctx = canvas.getContext('2d');
    const rand = rng(99);
    let y = 0;
    while (y < 256) {
      const h = 4 + rand() * 18;
      const shade = rand();
      const r = 150 + shade * 60;
      ctx.fillStyle = `rgb(${r},${r * 0.55 + 10},${r * 0.35})`;
      ctx.fillRect(0, y, 256, h);
      y += h;
    }
    const n = fbm(256, 7, 5, 4);
    const img = ctx.getImageData(0, 0, 256, 256);
    for (let i = 0; i < n.length; i++) {
      const k = 0.78 + n[i] * 0.35;
      for (let c = 0; c < 3; c++) img.data[i * 4 + c] *= k;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(canvas);
  });
}

const BARRIER_COLORS = {
  alpine: ['#c9ccd1', '#1b4f8c'],
  desert: ['#d9d2c3', '#b5482a'],
  coast: ['#e9eef2', '#0f7f8f'],
  autumn: ['#cdc6b8', '#7a2e1b'],
  city: ['#8f9399', '#1a1a22'],
};

/** Muro de hormigón con paneles publicitarios. */
export function barrierTexture(theme) {
  return cached(`barrier:${theme}`, () => {
    const canvas = makeCanvas(512, 128);
    const ctx = canvas.getContext('2d');
    const [wallC, adC] = BARRIER_COLORS[theme] ?? BARRIER_COLORS.alpine;
    ctx.fillStyle = wallC;
    ctx.fillRect(0, 0, 512, 128);
    const rand = rng(theme.length * 13);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = `rgba(0,0,0,${rand() * 0.07})`;
      ctx.fillRect(rand() * 512, rand() * 128, 2, 2);
    }
    const ads = [['RUNRUN', adC, '#ffffff'], ['TURBO OIL', '#111111', '#ffd200'], ['RACING', '#ffffff', '#d62839'], ['NITRO', adC, '#ffffff']];
    ads.forEach(([text, bg, fg], i) => {
      ctx.fillStyle = bg;
      ctx.fillRect(i * 128 + 4, 30, 120, 56);
      ctx.fillStyle = fg;
      ctx.font = 'bold 26px Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, i * 128 + 64, 59, 112);
    });
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = 0; x < 512; x += 128) ctx.fillRect(x, 0, 2, 128);
    ctx.fillRect(0, 120, 512, 8);
    const tex = toTexture(canvas);
    tex.repeat.set(0.5, 1);
    return tex;
  });
}

/** Pancarta del pórtico de salida. */
export function bannerTexture() {
  return cached('banner', () => {
    const canvas = makeCanvas(1024, 128);
    const g = canvas.getContext('2d');
    g.fillStyle = '#0d0f14';
    g.fillRect(0, 0, 1024, 128);
    for (let x = 0; x < 1024; x += 32) {
      for (let y = 0; y < 2; y++) {
        g.fillStyle = (x / 32 + y) % 2 ? '#f2f2f2' : '#111';
        g.fillRect(x, y * 16, 32, 16);
        g.fillRect(x, 96 + y * 16, 32, 16);
      }
    }
    g.fillStyle = '#d62839';
    g.font = 'italic bold 56px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('RUNRUN  GRAND PRIX', 512, 66);
    return toTexture(canvas);
  });
}

/** Público de la tribuna: siluetas con camisetas de colores (alpha). */
export function crowdTexture() {
  return cached('crowd', () => {
    const canvas = makeCanvas(512, 32);
    const g = canvas.getContext('2d');
    const rand = rng(57);
    const shirts = ['#d62839', '#f4f4f4', '#2a9df4', '#f4a300', '#2bb673', '#222', '#9b5de5', '#e9c46a', '#1d3557'];
    const skins = ['#e0b48c', '#c68e64', '#8d5a3b', '#f1c9a5'];
    for (let x = 2; x < 510; x += 6 + rand() * 3) {
      const h = rand() * 4;
      g.fillStyle = shirts[(rand() * shirts.length) | 0];
      g.beginPath();
      g.ellipse(x + 2.5, 26 - h, 3.2, 8, 0, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = skins[(rand() * skins.length) | 0];
      g.beginPath();
      g.arc(x + 2.5, 14 - h, 2.6, 0, Math.PI * 2);
      g.fill();
      if (rand() < 0.15) {
        g.fillStyle = shirts[(rand() * shirts.length) | 0];
        g.fillRect(x + 4, 2 - h, 1.5, 12);
      }
    }
    const tex = toTexture(canvas);
    return tex;
  });
}

/** Textura radial suave para partículas y destellos. */
export function softDotTexture() {
  return cached('dot', () => {
    const canvas = makeCanvas(64);
    const ctx = canvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    return toTexture(canvas, { srgb: false });
  });
}

/** Nubes tileables: fbm con umbral según la cobertura (0 = despejado, 1 = cubierto). */
export function cloudTexture(cover = 0.5) {
  return cached(`clouds:${cover}`, () => {
    const size = 512;
    const field = fbm(size, 123, 6, 4);
    const detail = fbm(size, 321, 4, 16);
    const canvas = makeCanvas(size);
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const t0 = 0.62 - cover * 0.28;
    for (let i = 0; i < size * size; i++) {
      const v = field[i] * 0.8 + detail[i] * 0.2;
      const a = Math.min(1, Math.max(0, (v - t0) / 0.18));
      // Base algo más gris donde la nube es densa (sombra propia).
      const shade = 255 - Math.min(1, Math.max(0, (v - t0 - 0.1) / 0.2)) * 55;
      img.data[i * 4] = shade;
      img.data[i * 4 + 1] = shade;
      img.data[i * 4 + 2] = shade + 6;
      img.data[i * 4 + 3] = a * a * (3 - 2 * a) * 255;
    }
    ctx.putImageData(img, 0, 0);
    return toTexture(canvas);
  });
}

/** Tablero de ajedrez para la línea de meta. */
export function checkerTexture() {
  return cached('checker', () => {
    const canvas = makeCanvas(64);
    const ctx = canvas.getContext('2d');
    for (let y = 0; y < 4; y++) {
      for (let x = 0; x < 16; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
        ctx.fillRect(x * 4, y * 16, 4, 16);
      }
    }
    const tex = toTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    return tex;
  });
}

export function disposeTextures() {
  for (const entry of cache.values()) {
    if (entry.isTexture) entry.dispose();
    else Object.values(entry).forEach((t) => t?.dispose?.());
  }
  cache.clear();
}
