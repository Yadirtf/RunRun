/**
 * Contacto entre coches en multijugador. El coche de otro jugador es una
 * "fantasma" interpolada que no reacciona a los golpes, así que tratarlo como
 * un sólido rígido (cuerpo cinemático de masa infinita) hacía que, al quedar
 * solapados, el solver lanzara al coche local a cientos de km/h o lo dejara
 * girando en el aire sin control. Aquí cada coche se aproxima con dos
 * círculos en planta (delante/detrás) y el choque se resuelve con un empuje
 * horizontal acotado: los coches se tocan, rebotan un poco y nunca salen
 * despedidos.
 */
import { carDimensions } from './carGeometry.js';

const MAX_DV = 6; // m/s de cambio de velocidad como máximo por paso
const RESTITUTION = 0.25;

/** Círculos en planta de un coche: centros a lo largo del eje longitudinal. */
export function carCircles(def, x, z, fx, fz) {
  const { length, width } = carDimensions(def);
  const r = width * 0.52;
  const off = Math.max(0, length / 2 - r);
  const fl = Math.hypot(fx, fz) || 1;
  const ux = fx / fl;
  const uz = fz / fl;
  return [
    { x: x + ux * off, z: z + uz * off, r },
    { x: x - ux * off, z: z - uz * off, r },
  ];
}

/**
 * Normal (del coche local hacia el otro) y penetración del solape más profundo.
 * @returns {{nx: number, nz: number, pen: number} | null}
 */
export function deepestOverlap(mine, theirs) {
  let best = null;
  for (const a of mine) {
    for (const b of theirs) {
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz);
      const pen = a.r + b.r - d;
      if (pen <= 0 || (best && pen <= best.pen)) continue;
      best = d > 1e-4 ? { nx: dx / d, nz: dz / d, pen } : { nx: 1, nz: 0, pen };
    }
  }
  return best;
}

/**
 * Cambio de velocidad horizontal para el coche local. Se fija como objetivo
 * una velocidad relativa de separación (rebote suave, o salir del solape a
 * ≤3 m/s) y solo se corrige lo que falte: aplicado en cada paso no se acumula.
 */
export function contactDeltaV({ nx, nz, pen }, myVel, otherVel) {
  const rel = (myVel.x - otherVel.x) * nx + (myVel.z - otherVel.z) * nz; // >0 = acercándose
  const target = Math.min(-Math.min(3, pen * 4), -Math.max(0, rel) * RESTITUTION);
  const dv = rel > target ? Math.max(-MAX_DV, target - rel) : 0;
  return { x: nx * dv, z: nz * dv };
}
