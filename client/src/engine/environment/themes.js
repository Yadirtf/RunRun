import { fbm2, ridged2, smoothstep } from './noise.js';

/**
 * Paisajes por pista. Cada tema define cielo, luz, niebla, capas del terreno,
 * vegetación, agua, construcciones y una función de altura del terreno en
 * función de (x, z) y la distancia a la pista. Añadir una pista nueva con otro
 * paisaje = añadir un tema aquí.
 */
export const THEMES = {
  alpine: {
    sky: { turbidity: 3.2, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, elevation: 34, azimuth: 150 },
    exposure: 0.52,
    sun: { color: '#fff1da', intensity: 3.4 },
    hemi: { sky: '#bfd6ff', ground: '#46543a', intensity: 0.45 },
    fog: { color: '#b9cadb', density: 0.0016 },
    clouds: { cover: 0.45, opacity: 0.9 },
    runoff: 'grass',
    barrier: 'alpine',
    water: 'lake',
    waterColor: '#1d4f63',
    ground: { base: 'meadow', rock: 'rock', top: 'snow' },
    tint: [[0.8, 0.84, 0.76], [1.0, 1.0, 0.94]],
    snowLine: 95,
    topWeight(x, z, h, ny, v) {
      return smoothstep(this.snowLine - 15, this.snowLine + 25, h + v * 30) * smoothstep(0.45, 0.7, ny);
    },
    height(x, z, d) {
      const hills = fbm2(x / 260, z / 260, { seed: 4 }) * 26 - 8;
      const bumps = fbm2(x / 60, z / 60, { seed: 9, octaves: 3 }) * 3;
      const mountains = ridged2(x / 420, z / 420, { seed: 2 }) * 330 * smoothstep(160, 620, d);
      return hills + bumps + mountains;
    },
    vegetation: 'alpine',
    grass: 'green',
    props: 'chalet',
  },
  desert: {
    sky: { turbidity: 7.5, rayleigh: 2.6, mieCoefficient: 0.009, mieDirectionalG: 0.86, elevation: 7, azimuth: 255 },
    exposure: 0.5,
    sun: { color: '#ffb873', intensity: 3.6 },
    hemi: { sky: '#ffcfa0', ground: '#7b4a2c', intensity: 0.5 },
    fog: { color: '#e3b38a', density: 0.00125 },
    clouds: { cover: 0.18, opacity: 0.75, color: '#ffd8b8' },
    runoff: 'sand',
    barrier: 'desert',
    water: false,
    ground: { base: 'sand', rock: 'redrock', top: 'redrock' },
    tint: [[0.9, 0.88, 0.86], [1.08, 1.02, 0.96]],
    topWeight(x, z, h) {
      // Cimas de las mesetas: roca roja también en lo plano.
      return smoothstep(35, 55, h);
    },
    height(x, z, d) {
      const dunes = (Math.sin(x / 38 + fbm2(x / 200, z / 200, { seed: 3 }) * 6) * 0.5 + 0.5) * 4;
      const swell = fbm2(x / 300, z / 300, { seed: 6 }) * 18 - 6;
      // Mesetas: meseta plana con laderas abruptas, lejos de la pista.
      const m = fbm2(x / 340, z / 340, { seed: 12, octaves: 4 });
      const mesa = smoothstep(0.56, 0.6, m) * (70 + fbm2(x / 90, z / 90, { seed: 5 }) * 25) * smoothstep(90, 200, d);
      const far = ridged2(x / 500, z / 500, { seed: 8 }) * 140 * smoothstep(380, 800, d);
      return dunes * smoothstep(30, 80, d) + swell + mesa + far;
    },
    vegetation: 'desert',
    grass: 'dry',
    props: null,
  },
  coast: {
    sky: { turbidity: 2.4, rayleigh: 1.0, mieCoefficient: 0.004, mieDirectionalG: 0.78, elevation: 52, azimuth: 200 },
    exposure: 0.5,
    sun: { color: '#fff6e6', intensity: 3.7 },
    hemi: { sky: '#cfe6ff', ground: '#6f6a48', intensity: 0.5 },
    fog: { color: '#cfe0ec', density: 0.001 },
    clouds: { cover: 0.32, opacity: 0.9 },
    runoff: 'grass',
    barrier: 'coast',
    water: 'sea',
    seaLevel: -0.4,
    waterColor: '#0b5d6e',
    ground: { base: 'meadow', rock: 'rock', top: 'beach' },
    tint: [[0.9, 0.95, 0.82], [1.1, 1.06, 0.96]],
    grading: { saturation: 1.12, contrast: 1.05 },
    /** Línea de costa: el mar ocupa z > shore(x). */
    shore(x) {
      return 64 + (fbm2(x / 200, 3.3, { seed: 14, octaves: 3 }) - 0.5) * 70;
    },
    topWeight(x, z, h, ny) {
      return smoothstep(3.5, 1.2, h) * smoothstep(0.7, 0.9, ny);
    },
    height(x, z, d) {
      const s = z - this.shore(x);
      const hills = fbm2(x / 230, z / 230, { seed: 21 }) * 34 * smoothstep(-10, -160, s);
      const ridge = ridged2(x / 380, z / 380, { seed: 5 }) * 160 * smoothstep(-240, -700, s);
      const land = 1 + hills + ridge + fbm2(x / 50, z / 50, { seed: 2, octaves: 3 }) * 2;
      // Acantilado bajo donde las colinas llegan al mar; fondo marino que baja.
      const sea = -2.5 - Math.min(16, Math.max(0, s) * 0.08);
      const k = smoothstep(-8, 6, s);
      return land * (1 - k) + sea * k;
    },
    vegetation: 'coast',
    grass: 'lush',
    props: 'coast',
  },
  autumn: {
    sky: { turbidity: 4.6, rayleigh: 1.9, mieCoefficient: 0.006, mieDirectionalG: 0.84, elevation: 15, azimuth: 232 },
    exposure: 0.5,
    sun: { color: '#ffd29a', intensity: 3.5 },
    hemi: { sky: '#ffd9b0', ground: '#5a4228', intensity: 0.45 },
    fog: { color: '#d9c4a6', density: 0.0019 },
    clouds: { cover: 0.5, opacity: 0.9, color: '#ffe6cc' },
    runoff: 'grass',
    barrier: 'autumn',
    water: 'lake',
    waterColor: '#2a4a46',
    ground: { base: 'forest', rock: 'rock', top: 'leaves' },
    tint: [[0.88, 0.86, 0.8], [1.08, 1.04, 0.96]],
    grading: { saturation: 1.12, contrast: 1.07, tint: '#fff3e6' },
    topWeight(x, z, h, ny, v) {
      // Alfombras de hojas caídas bajo los árboles.
      return 0.75 * smoothstep(0.55, 0.68, fbm2(x / 70, z / 70, { seed: 33, octaves: 3 }) + v * 0.1) * smoothstep(0.6, 0.85, ny);
    },
    height(x, z, d) {
      const hills = fbm2(x / 240, z / 240, { seed: 41 }) * 36 - 10;
      const bumps = fbm2(x / 55, z / 55, { seed: 3, octaves: 3 }) * 3;
      const mountains = ridged2(x / 460, z / 460, { seed: 17 }) * 220 * smoothstep(200, 700, d);
      return hills + bumps + mountains;
    },
    vegetation: 'autumn',
    grass: 'autumn',
    props: 'cabin',
  },
  city: {
    night: true,
    nightSky: { zenith: '#03050d', horizon: '#161430', glow: '#5a3050' },
    sky: { elevation: 38, azimuth: 120 },
    exposure: 0.8,
    sun: { color: '#9fb4ff', intensity: 0.8 },
    hemi: { sky: '#3a4a80', ground: '#2a2018', intensity: 0.6 },
    fog: { color: '#130f1e', density: 0.0024 },
    clouds: null,
    bloom: { strength: 0.55, radius: 0.5, threshold: 0.78 },
    grading: { saturation: 1.15, contrast: 1.08, tint: '#f2f2ff', vignette: 0.4 },
    headlights: true,
    runoff: 'pavement',
    barrier: 'city',
    water: false,
    ground: { base: 'pavement', rock: 'concrete', top: 'concrete' },
    tint: [[0.85, 0.85, 0.88], [1.05, 1.05, 1.08]],
    topWeight() {
      return 0;
    },
    height(x, z) {
      return fbm2(x / 400, z / 400, { seed: 2 }) * 2 - 1;
    },
    vegetation: null,
    grass: null,
    props: 'city',
  },
};

export function getTheme(id) {
  return THEMES[id] ?? THEMES.alpine;
}
