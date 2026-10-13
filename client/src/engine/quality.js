/**
 * Niveles de calidad gráfica. 'auto' elige según el dispositivo: los móviles
 * y tablets arrancan en 'low' (o 'medium' si tienen memoria de sobra) y los
 * ordenadores en 'high'. Se puede forzar con ?quality=low|medium|high.
 */
export const QUALITY_LEVELS = ['auto', 'low', 'medium', 'high'];

export const QUALITY_PRESETS = {
  low: {
    pixelRatio: 1,
    msaa: 0,
    shadowMap: 1024,
    shadowRange: 55,
    bloom: false,
    grading: false,
    sceneEnv: false,
    clouds: false,
    vegetation: 0.45,
    grass: 0,
    reflectiveWater: false,
    carDetail: 'low',
    terrainSegments: 220,
  },
  medium: {
    pixelRatio: 1.5,
    msaa: 2,
    shadowMap: 2048,
    shadowRange: 70,
    bloom: true,
    grading: true,
    sceneEnv: true,
    clouds: true,
    vegetation: 0.75,
    grass: 0.5,
    reflectiveWater: false,
    carDetail: 'high',
    terrainSegments: 280,
  },
  high: {
    pixelRatio: 2,
    msaa: 4,
    shadowMap: 4096,
    shadowRange: 80,
    bloom: true,
    grading: true,
    sceneEnv: true,
    clouds: true,
    vegetation: 1,
    grass: 1,
    reflectiveWater: true,
    carDetail: 'high',
    terrainSegments: 340,
  },
};

export function detectQuality() {
  if (typeof window === 'undefined') return 'high';
  const q = new URLSearchParams(window.location.search).get('quality');
  if (q && QUALITY_PRESETS[q]) return q;
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (!touch) return 'high';
  return (navigator.deviceMemory ?? 4) >= 6 ? 'medium' : 'low';
}

/** Resuelve 'auto' (o un valor desconocido) al nivel concreto. */
export function resolveQuality(level) {
  return QUALITY_PRESETS[level] ? level : detectQuality();
}

export function qualityPreset(level) {
  return { level: resolveQuality(level), ...QUALITY_PRESETS[resolveQuality(level)] };
}
