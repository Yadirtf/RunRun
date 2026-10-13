import { fbm2, ridged2, smoothstep } from './noise.js';

/**
 * Paisajes por pista. Cada tema define cielo, luz, niebla, materiales y una
 * función de altura del terreno en función de (x, z) y la distancia a la pista.
 * Añadir una pista nueva con otro paisaje = añadir un tema aquí.
 */
export const THEMES = {
  alpine: {
    sky: { turbidity: 3.2, rayleigh: 1.1, mieCoefficient: 0.004, mieDirectionalG: 0.8, elevation: 34, azimuth: 150 },
    exposure: 0.52,
    sun: { color: '#fff1da', intensity: 3.4 },
    hemi: { sky: '#bfd6ff', ground: '#46543a', intensity: 0.55 },
    fog: { color: '#b9cadb', density: 0.0016 },
    runoff: 'grass',
    terrainDetail: 'grass',
    barrier: 'alpine',
    water: true,
    colors: { low: [0.23, 0.34, 0.14], mid: [0.30, 0.40, 0.18], rock: [0.38, 0.36, 0.33], snow: [0.93, 0.95, 0.98], shore: [0.42, 0.40, 0.30] },
    snowLine: 95,
    height(x, z, d) {
      const hills = fbm2(x / 260, z / 260, { seed: 4 }) * 26 - 8;
      const bumps = fbm2(x / 60, z / 60, { seed: 9, octaves: 3 }) * 3;
      const mountains = ridged2(x / 420, z / 420, { seed: 2 }) * 330 * smoothstep(160, 620, d);
      return hills + bumps + mountains;
    },
    vegetation: 'pines',
  },
  desert: {
    sky: { turbidity: 7.5, rayleigh: 2.6, mieCoefficient: 0.009, mieDirectionalG: 0.86, elevation: 7, azimuth: 255 },
    exposure: 0.5,
    sun: { color: '#ffb873', intensity: 3.6 },
    hemi: { sky: '#ffcfa0', ground: '#7b4a2c', intensity: 0.6 },
    fog: { color: '#e3b38a', density: 0.00125 },
    runoff: 'sand',
    terrainDetail: 'sand',
    barrier: 'desert',
    water: false,
    colors: { low: [0.78, 0.55, 0.33], mid: [0.85, 0.62, 0.40], rock: [0.62, 0.30, 0.18], snow: [0.62, 0.30, 0.18], shore: [0.78, 0.55, 0.33] },
    snowLine: Infinity,
    height(x, z, d) {
      const dunes = (Math.sin(x / 38 + fbm2(x / 200, z / 200, { seed: 3 }) * 6) * 0.5 + 0.5) * 4;
      const swell = fbm2(x / 300, z / 300, { seed: 6 }) * 18 - 6;
      // Mesetas: meseta plana con laderas abruptas, lejos de la pista.
      const m = fbm2(x / 340, z / 340, { seed: 12, octaves: 4 });
      const mesa = smoothstep(0.56, 0.6, m) * (70 + fbm2(x / 90, z / 90, { seed: 5 }) * 25) * smoothstep(90, 200, d);
      const far = ridged2(x / 500, z / 500, { seed: 8 }) * 140 * smoothstep(380, 800, d);
      return dunes * smoothstep(30, 80, d) + swell + mesa + far;
    },
    vegetation: 'cacti',
  },
};

export function getTheme(id) {
  return THEMES[id] ?? THEMES.alpine;
}
