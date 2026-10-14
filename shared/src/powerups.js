/**
 * Poderes en pista al estilo Blur: reglas, constantes y geometría compartidas
 * por cliente y servidor. El servidor es la autoridad (recogidas, inventario,
 * proyectiles, salud e impactos); el cliente dibuja y aplica a su propio coche
 * el efecto físico de cada impacto que el servidor le comunica.
 *
 * Cada poder se puede lanzar hacia delante o hacia atrás y casi todos tienen
 * un uso defensivo: una mina soltada detrás o un rayo hacia atrás detienen un
 * misil, la onda destruye lo que haya alrededor y el escudo lo absorbe todo.
 */

export const POWERUPS = {
  shunt: {
    id: 'shunt',
    name: 'Misil',
    color: '#ff3b47',
    damage: 45,
    front: 'Persigue al coche que va justo delante',
    back: 'Persigue al que te sigue de cerca',
  },
  bolt: {
    id: 'bolt',
    name: 'Rayo',
    color: '#b65cff',
    damage: 12,
    charges: 3,
    front: '3 disparos rápidos en línea recta',
    back: 'Dispara hacia atrás; derriba misiles',
  },
  barge: {
    id: 'barge',
    name: 'Onda',
    color: '#ff8c1a',
    damage: 15,
    front: 'Empuja a los coches cercanos y destruye proyectiles y minas',
    back: 'Igual: actúa a tu alrededor',
  },
  shock: {
    id: 'shock',
    name: 'Descarga',
    color: '#3aa8ff',
    damage: 20,
    front: 'Siembra 3 cúpulas eléctricas delante del líder',
    back: 'Igual: siempre apunta al líder',
  },
  mine: {
    id: 'mine',
    name: 'Mina',
    color: '#ffd23a',
    damage: 30,
    front: 'La lanza a la pista por delante',
    back: 'La suelta detrás; frena misiles',
  },
  nitro: {
    id: 'nitro',
    name: 'Nitro',
    color: '#2ee88f',
    damage: 0,
    front: 'Impulso de velocidad',
    back: 'Frenazo instantáneo para curvas cerradas',
  },
  repair: {
    id: 'repair',
    name: 'Reparar',
    color: '#e8fff4',
    damage: 0,
    front: 'Restaura toda la salud del coche',
    back: 'Restaura toda la salud del coche',
  },
  shield: {
    id: 'shield',
    name: 'Escudo',
    color: '#38e8ff',
    damage: 0,
    front: 'Bloquea los ataques durante unos segundos',
    back: 'Bloquea los ataques durante unos segundos',
  },
};

export const POWERUP_IDS = Object.keys(POWERUPS);

export const MAX_SLOTS = 3;
export const HEALTH_MAX = 100;

/** Recogida: radio alrededor del icono y tiempo hasta que reaparece. */
export const PAD_RADIUS = 2.1;
export const PAD_RESPAWN_MS = 8000;
export const PAD_HEIGHT = 1.1;

export const SHUNT_SPEED = 85; // m/s, más rápido que cualquier coche con nitro
export const SHUNT_LIFE_MS = 9000;
export const SHUNT_BACK_RANGE = 140; // m: a quién puede perseguir hacia atrás
export const BOLT_SPEED = 140;
export const BOLT_LIFE_MS = 1000;
export const BOLT_RADIUS = 2.0;
export const BOLT_AIM_DEG = 11; // cono de autoapuntado
export const MINE_RADIUS = 2.4;
export const MINE_ARM_MS = 450;
export const MINE_LIFE_MS = 45000;
export const MINE_THROW = 45; // m por delante al lanzarla hacia delante
export const SHOCK_ARM_MS = 1300;
export const SHOCK_LIFE_MS = 6500;
export const SHOCK_RADIUS = 2.6;
export const BARGE_RADIUS = 12;
export const SHIELD_MS = 8000;
export const NITRO_MS = 2200;
export const NITRO_BRAKE_MS = 700;
export const WRECK_MS = 2500;
/** Tras un impacto: invulnerable un instante para que un golpe no cuente dos veces. */
export const HIT_IMMUNE_MS = 350;
/** Tras reaparecer de un destrozo, protegido para reincorporarse. */
export const RESPAWN_IMMUNE_MS = 2000;
/** Cadencia mínima entre disparos en el servidor; el cliente espera algo más para absorber el jitter de red. */
export const FIRE_COOLDOWN_MS = 120;
export const CLIENT_FIRE_INTERVAL_MS = 280;
/** Tras coger un icono, los otros dos del mismo grupo no se pueden coger en esa pasada. */
export const CLUSTER_LOCK_MS = 3000;

// ---------------------------------------------------------------------------
// Geometría sobre el trazado
// ---------------------------------------------------------------------------

export function wrapS(path, s) {
  const L = path.length;
  return ((s % L) + L) % L;
}

/** Diferencia de arco b - a envuelta a (-L/2, L/2]. */
export function deltaS(path, a, b) {
  const L = path.length;
  let d = (b - a) % L;
  if (d > L / 2) d -= L;
  if (d <= -L / 2) d += L;
  return d;
}

/** Punto del trazado a la distancia de arco `s` desplazado `lateral` metros a la derecha. */
export function trackPoint(path, s, lateral = 0) {
  const u = wrapS(path, s) / path.step;
  const i = Math.floor(u) % path.count;
  const j = (i + 1) % path.count;
  const f = u - Math.floor(u);
  const a = path.points[i];
  const b = path.points[j];
  const ra = path.rights[i];
  const rb = path.rights[j];
  const rx = ra[0] + (rb[0] - ra[0]) * f;
  const rz = ra[2] + (rb[2] - ra[2]) * f;
  const rl = Math.hypot(rx, rz) || 1;
  return [
    a[0] + (b[0] - a[0]) * f + (rx / rl) * lateral,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f + (rz / rl) * lateral,
  ];
}

/** Tangente horizontal normalizada en `s`. */
export function trackTangent(path, s) {
  const i = Math.round(wrapS(path, s) / path.step) % path.count;
  const t = path.tangents[i];
  const l = Math.hypot(t[0], t[2]) || 1;
  return [t[0] / l, 0, t[2] / l];
}

/**
 * Progreso continuo en metros de un jugador: puertas superadas (validadas por
 * el servidor) más el avance con signo desde la última. Así se puede comparar
 * quién va delante aunque estén en vueltas distintas.
 */
export function raceProgress(path, gates, passed, s) {
  const n = gates.length;
  const seg = path.length / n;
  const gate = gates[((passed % n) + n) % n];
  const d = Math.max(-seg, Math.min(seg * 3, deltaS(path, gate.s, s)));
  return passed * seg + d;
}

// ---------------------------------------------------------------------------
// Proyectiles deterministas: el servidor los crea con estos parámetros y el
// cliente reproduce la misma trayectoria con su reloj sincronizado, sin
// mandar posiciones por la red.
// ---------------------------------------------------------------------------

/** Posición de un rayo `t` ms después de su salida. */
export function boltPosition(bolt, t) {
  const d = (BOLT_SPEED * Math.max(0, t - bolt.t0)) / 1000;
  return [bolt.x + bolt.dx * d, bolt.y, bolt.z + bolt.dz * d];
}

/**
 * Hasta dónde llega un rayo en línea recta antes de salirse de la pista (no
 * atraviesa muros): devuelve la duración en ms.
 */
export function boltLifetime(path, bolt, projectToTrack) {
  const margin = path.width / 2 + 5;
  let hint = -1;
  for (let t = 0; t <= BOLT_LIFE_MS; t += 25) {
    const [x, , z] = boltPosition(bolt, bolt.t0 + t);
    const pr = projectToTrack(path, x, z, hint);
    hint = pr.index;
    if (Math.abs(pr.lateral) > margin) return Math.max(50, t);
  }
  return BOLT_LIFE_MS;
}

/** Distancia de arco recorrida por un misil (con signo: hacia atrás es negativa). */
export function shuntTravel(shunt, t) {
  return (shunt.dir * SHUNT_SPEED * Math.max(0, t - shunt.t0)) / 1000;
}

/**
 * Cúpulas de la descarga: tres en abanico a lo ancho de la pista, desplazadas
 * a un lado según `seed` para que siempre quede un hueco por el que esquivarlas.
 */
export function shockDomes(path, s, seed) {
  const w = path.width;
  const shift = ((seed % 3) - 1) * w * 0.14;
  return [-0.34, 0, 0.34].map((k, i) => {
    const lateral = k * w + shift;
    const [x, y, z] = trackPoint(path, s + (i - 1) * 3, lateral);
    return { x, y, z, lateral };
  });
}

/** Distancia mínima entre dos puntos que se mueven en línea recta durante un intervalo (2D, XZ). */
export function sweptDistance(a0, a1, b0, b1) {
  // Movimiento relativo: r(t) = (a0 - b0) + ((a1 - a0) - (b1 - b0)) t, t en [0, 1].
  const rx = a0[0] - b0[0];
  const rz = a0[2] - b0[2];
  const vx = a1[0] - a0[0] - (b1[0] - b0[0]);
  const vz = a1[2] - a0[2] - (b1[2] - b0[2]);
  const vv = vx * vx + vz * vz;
  const t = vv > 1e-9 ? Math.max(0, Math.min(1, -(rx * vx + rz * vz) / vv)) : 0;
  return Math.hypot(rx + vx * t, rz + vz * t);
}

// ---------------------------------------------------------------------------
// Colocación de los poderes en la pista
// ---------------------------------------------------------------------------

/**
 * Plantillas de grupo: [interior, centro, exterior] respecto a la siguiente
 * curva. El poder más valioso va en el lado interior, fuera de la trazada
 * ideal: cogerlo cuesta perder la línea (riesgo/recompensa).
 */
const CLUSTER_TEMPLATES = {
  // Antes de una recta larga: armas para usar con el rival a la vista.
  attack: ['shunt', 'bolt', 'nitro'],
  // Antes de una curva fuerte: los coches se agrupan y frenan.
  trap: ['shock', 'mine', 'barge'],
  // A mitad de vuelta: defensa y recuperación.
  support: ['shield', 'repair', 'bolt'],
  mix: ['shunt', 'nitro', 'mine'],
  defense: ['shield', 'barge', 'bolt'],
  extra: ['shock', 'nitro', 'repair'],
};

/**
 * Grupos de 3 iconos repartidos por la vuelta en puntos estratégicos. Se
 * calcula a partir de la geometría, así que funciona igual para cualquier
 * pista (incluidas las futuras) y es idéntico en cliente y servidor.
 *
 * @returns {Array<{id: number, cluster: number, type: string, s: number, lateral: number, position: number[], role: string}>}
 */
export function powerupPads(trackDef, path) {
  const { count, step, length } = path;
  const W = 5;
  const curv = path.curvature.map((_, i) => {
    let s = 0;
    for (let k = -W; k <= W; k++) s += path.curvature[(i + k + count) % count];
    return s / (2 * W + 1);
  });
  const abs = curv.map(Math.abs);
  const window = (i, from, to) => {
    let sum = 0;
    let max = 0;
    let signed = 0;
    const a = Math.round(from / step);
    const b = Math.round(to / step);
    for (let k = a; k <= b; k++) {
      const j = (i + k + count) % count;
      sum += abs[j];
      signed += curv[j];
      max = Math.max(max, abs[j]);
    }
    return { mean: sum / (b - a + 1), max, signed };
  };

  // Ni sobre la parrilla (detrás de la meta) ni nada más cruzarla.
  const startS = 70;
  const endS = length - 80;
  const n = Math.max(4, Math.min(7, Math.round(length / 250)));
  const clusters = [];
  for (let k = 0; k < n; k++) {
    const nominal = startS + ((k + 0.5) * (endS - startS)) / n;
    // Buscar el tramo más recto cerca del punto nominal: los iconos se cogen
    // mejor sin estar en mitad de una curva.
    let best = -1;
    let bestScore = Infinity;
    for (let d = -45; d <= 45; d += step) {
      const s = nominal + d;
      if (s < startS || s > endS) continue;
      const i = Math.round(s / step) % count;
      // Redondeado: el desempate no puede depender de diferencias de coma flotante entre motores JS.
      const score = Math.round((window(i, -15, 15).max * 400 + Math.abs(d) * 0.01) * 1e4);
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const ahead = window(best, 20, 200);
    const corner = window(best, 30, 120);
    clusters.push({ index: best, s: best * step, straightness: ahead.mean, corner: corner.max, turn: Math.sign(corner.signed) || 1 });
  }

  // Asignar papeles: la más recta por delante = ataque, la de curva más
  // cerrada = trampa, la más cercana a media vuelta = apoyo; el resto rota.
  const roles = new Array(n).fill(null);
  const byStraight = [...clusters.keys()].sort((a, b) => clusters[a].straightness - clusters[b].straightness);
  roles[byStraight[0]] = 'attack';
  const byCorner = [...clusters.keys()].filter((i) => !roles[i]).sort((a, b) => clusters[b].corner - clusters[a].corner);
  roles[byCorner[0]] = 'trap';
  const byMid = [...clusters.keys()].filter((i) => !roles[i]).sort((a, b) => Math.abs(clusters[a].s - length / 2) - Math.abs(clusters[b].s - length / 2));
  roles[byMid[0]] = 'support';
  const rest = ['mix', 'defense', 'extra', 'attack'];
  let r = 0;
  for (let i = 0; i < n; i++) if (!roles[i]) roles[i] = rest[r++ % rest.length];

  const pads = [];
  const lane = path.width * 0.32;
  clusters.forEach((c, ci) => {
    const types = CLUSTER_TEMPLATES[roles[ci]];
    // Positivo = la curva gira a la derecha, y la derecha es lateral positivo.
    const inside = c.turn;
    [inside * lane, 0, -inside * lane].forEach((lateral, k) => {
      const [x, y, z] = trackPoint(path, c.s, lateral);
      pads.push({
        id: pads.length,
        cluster: ci,
        role: roles[ci],
        type: types[k],
        s: c.s,
        lateral,
        position: [x, y + PAD_HEIGHT, z],
      });
    });
  });
  return pads;
}
