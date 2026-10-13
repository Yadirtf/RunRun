/** Catálogo de vehículos: estadísticas de manejo + parámetros del modelo procedural. */
export const CARS = {
  sport: {
    id: 'sport',
    name: 'Vortex GT',
    description: 'Equilibrado y ágil en curvas',
    stats: { mass: 1250, engineForce: 10500, brakeForce: 90, maxSpeedKmh: 200, grip: 1.7, steer: 0.55 },
    body: { length: 4.4, width: 1.9, height: 1.2, cabinScale: 0.48, wing: false },
    defaultColor: '#d62839',
  },
  muscle: {
    id: 'muscle',
    name: 'Bravo V8',
    description: 'Mucha potencia, cola nerviosa',
    stats: { mass: 1450, engineForce: 12800, brakeForce: 85, maxSpeedKmh: 205, grip: 1.5, steer: 0.5 },
    body: { length: 4.7, width: 1.95, height: 1.3, cabinScale: 0.42, wing: false },
    defaultColor: '#1d3557',
  },
  supercar: {
    id: 'supercar',
    name: 'Falco R',
    description: 'Velocidad punta y aerodinámica',
    stats: { mass: 1200, engineForce: 11800, brakeForce: 95, maxSpeedKmh: 215, grip: 1.62, steer: 0.52 },
    body: { length: 4.5, width: 2.0, height: 1.1, cabinScale: 0.38, wing: true },
    defaultColor: '#f4a300',
  },
};

export const CAR_IDS = Object.keys(CARS);
export const DEFAULT_CAR_ID = 'sport';

/** Colores de pintura asignados por orden de llegada a la sala. */
export const PLAYER_COLORS = [
  '#d62839', '#2a9df4', '#f4a300', '#2bb673',
  '#9b5de5', '#f15bb5', '#e8e8e8', '#222831',
];

export function getCar(id) {
  return CARS[id] ?? CARS[DEFAULT_CAR_ID];
}
