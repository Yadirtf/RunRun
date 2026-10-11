// Catálogo de coches. La parte visual (modelo/variante) y el reglaje físico viven aquí
// para que el servidor pueda validar la elección y el cliente construir el vehículo.
//
// Todos usan el modelo "Car Concept" (Khronos glTF Sample Assets, CC BY 4.0,
// Eric Chadwick / Darmstadt Graphics Group). Para añadir otro coche basta con soltar
// su .glb en client/public/game/cars/ y añadir una entrada con sus nombres de nodo.

const CONCEPT_MODEL = {
  url: '/game/cars/car-concept.glb',
  // Nombres de los nodos de rueda dentro del glTF (delantera izq., der., trasera izq., der.)
  wheels: ['WheelFrontL', 'WheelFrontR', 'WheelRearL', 'WheelRearR'],
  // Material cuyo color se repinta con el color elegido por el jugador.
  paintMaterials: ['CarPaint', 'Color1', 'Paint'],
};

export const CARS = Object.freeze([
  {
    id: 'gt',
    name: 'Concept GT',
    tagline: 'Equilibrado y estable a alta velocidad',
    model: CONCEPT_MODEL,
    variant: 'Carmine Candy',
    stats: { power: 0.8, grip: 0.8, handling: 0.75 },
    physics: {
      mass: 1350,
      enginePower: 420_000, // W (~560 CV)
      maxEngineForce: 9500, // N por rueda motriz como límite
      gears: [3.4, 2.4, 1.8, 1.4, 1.12, 0.92],
      finalDrive: 3.6,
      redline: 7800,
      idleRpm: 900,
      brakeForce: 100,
      steerMax: 0.6,
      frictionSlip: 1.32,
      sideFriction: 1.1,
      rearGripScale: 1.0,
      suspensionStiffness: 34,
      suspensionCompression: 4.2,
      suspensionRelaxation: 3.4,
      suspensionTravel: 0.18,
      downforce: 1.2,
      drag: 0.36,
      drive: 'RWD',
    },
  },
  {
    id: 'sport',
    name: 'Concept Sport',
    tagline: 'Ligero, ágil y con mucho agarre en curva',
    model: CONCEPT_MODEL,
    variant: 'Pearly Swirly',
    stats: { power: 0.65, grip: 0.95, handling: 0.95 },
    physics: {
      mass: 1150,
      enginePower: 330_000,
      maxEngineForce: 8500,
      gears: [3.6, 2.6, 1.95, 1.5, 1.2, 1.0],
      finalDrive: 3.9,
      redline: 8400,
      idleRpm: 1000,
      brakeForce: 105,
      steerMax: 0.66,
      frictionSlip: 1.48,
      sideFriction: 1.2,
      rearGripScale: 1.0,
      suspensionStiffness: 42,
      suspensionCompression: 4.6,
      suspensionRelaxation: 3.8,
      suspensionTravel: 0.14,
      downforce: 1.8,
      drag: 0.38,
      drive: 'AWD',
    },
  },
  {
    id: 'drift',
    name: 'Concept Drift',
    tagline: 'Mucha potencia y trasera viva',
    model: CONCEPT_MODEL,
    variant: 'Torched Graphite',
    stats: { power: 1.0, grip: 0.6, handling: 0.7 },
    physics: {
      mass: 1400,
      enginePower: 500_000,
      maxEngineForce: 10500,
      gears: [3.3, 2.3, 1.75, 1.35, 1.08, 0.88],
      finalDrive: 3.5,
      redline: 7400,
      idleRpm: 850,
      brakeForce: 95,
      steerMax: 0.68,
      frictionSlip: 1.16,
      sideFriction: 1.0,
      rearGripScale: 0.9,
      suspensionStiffness: 30,
      suspensionCompression: 4.0,
      suspensionRelaxation: 3.2,
      suspensionTravel: 0.2,
      downforce: 0.8,
      drag: 0.34,
      drive: 'RWD',
    },
  },
]);

export const CAR_IDS = CARS.map((c) => c.id);
export const DEFAULT_CAR_ID = CARS[0].id;

export function getCar(id) {
  return CARS.find((c) => c.id === id) ?? CARS[0];
}
