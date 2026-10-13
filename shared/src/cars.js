/**
 * Catálogo de vehículos: estadísticas de manejo + parámetros del modelo
 * procedural. `body` describe la silueta (ver client/src/engine/CarFactory.js):
 *   front/back  posición de la base del parabrisas y de la luneta (fracción del largo)
 *   hood/deck   alturas de capó y maletero (fracción del alto)
 *   wing        'none' | 'duck' | 'roof' | 'gt'
 *   extras      scoop, stripes, chrome, roundLights, intakes, rim
 */
export const CARS = {
  sport: {
    id: 'sport',
    name: 'Vortex GT',
    class: 'Gran Turismo',
    description: 'Equilibrado y ágil en curvas',
    stats: { mass: 1250, engineForce: 10500, brakeForce: 150, maxSpeedKmh: 200, grip: 1.7, steer: 0.55 },
    body: { length: 4.4, width: 1.9, height: 1.2, cabinScale: 0.48, wing: 'duck', rim: 'spoke5' },
    defaultColor: '#d62839',
  },
  hatch: {
    id: 'hatch',
    name: 'Kodiak RS',
    class: 'Rally',
    description: 'Ligero y muy reactivo, ideal para curvas cerradas',
    stats: { mass: 1120, engineForce: 9600, brakeForce: 150, maxSpeedKmh: 190, grip: 1.76, steer: 0.6 },
    body: {
      length: 4.1, width: 1.86, height: 1.42, cabinScale: 0.8, front: 0.2, back: 0.43, hood: 0.62, deck: 0.74,
      tailDrop: 0.28, wing: 'roof', rim: 'mesh', rimColor: '#f2f2f2', intakes: true,
    },
    defaultColor: '#2a9df4',
  },
  muscle: {
    id: 'muscle',
    name: 'Bravo V8',
    class: 'Muscle',
    description: 'Mucha potencia, cola nerviosa',
    stats: { mass: 1450, engineForce: 12800, brakeForce: 145, maxSpeedKmh: 205, grip: 1.56, steer: 0.5 },
    body: {
      length: 4.75, width: 1.96, height: 1.28, cabinScale: 0.42, front: 0.06, back: 0.32, hood: 0.7, deck: 0.74,
      wing: 'duck', scoop: true, stripes: '#f4f4f4', rim: 'classic',
    },
    defaultColor: '#1d3557',
  },
  classic: {
    id: 'classic',
    name: 'Corsa 66',
    class: 'Clásico',
    description: 'Elegancia de los 60: suave y noble al límite',
    stats: { mass: 1280, engineForce: 10200, brakeForce: 140, maxSpeedKmh: 192, grip: 1.6, steer: 0.52 },
    body: {
      length: 4.45, width: 1.78, height: 1.24, cabinScale: 0.44, front: 0.08, back: 0.3, hood: 0.66, deck: 0.7,
      wing: 'none', chrome: true, roundLights: true, stripes: '#f4f4f4', rim: 'classic', wheelRadius: 0.34,
    },
    defaultColor: '#2bb673',
  },
  supercar: {
    id: 'supercar',
    name: 'Falco R',
    class: 'Hiperdeportivo',
    description: 'Velocidad punta y aerodinámica',
    stats: { mass: 1200, engineForce: 11800, brakeForce: 155, maxSpeedKmh: 215, grip: 1.66, steer: 0.52 },
    body: {
      length: 4.5, width: 2.0, height: 1.1, cabinScale: 0.38, front: 0.3, back: 0.2, hood: 0.6, deck: 0.74,
      wing: 'gt', intakes: true, rim: 'spoke5', rimColor: '#2a2d33',
    },
    defaultColor: '#f4a300',
  },
  gt3: {
    id: 'gt3',
    name: 'Nemesis GT3',
    class: 'Competición',
    description: 'Coche de carreras: máximo agarre y frenada',
    stats: { mass: 1230, engineForce: 12200, brakeForce: 165, maxSpeedKmh: 222, grip: 1.8, steer: 0.52 },
    body: {
      length: 4.65, width: 2.06, height: 1.14, cabinScale: 0.4, front: 0.16, back: 0.26, hood: 0.62, deck: 0.74,
      wing: 'gt', wingSize: 1.25, intakes: true, splitter: true, stripes: '#111214', rim: 'mesh', rimColor: '#c8a248',
    },
    defaultColor: '#e8e8e8',
  },
};

export const CAR_IDS = Object.keys(CARS);
export const DEFAULT_CAR_ID = 'sport';

/** Paleta de pinturas; cada piloto elige una libre en la sala. */
export const PLAYER_COLORS = [
  '#d62839', '#2a9df4', '#f4a300', '#2bb673',
  '#9b5de5', '#f15bb5', '#e8e8e8', '#222831',
  '#ff6b1a', '#00c2c7', '#1d3557', '#8a9a5b',
];

export function getCar(id) {
  return CARS[id] ?? CARS[DEFAULT_CAR_ID];
}
