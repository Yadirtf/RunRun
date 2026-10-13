/**
 * Geometría de pista pura (sin Three.js) compartida por cliente y servidor.
 * Una pista se define con puntos de control [x, y, z] que forman un circuito
 * cerrado; aquí se interpolan con Catmull-Rom centrípeta y se re-muestrean a
 * distancia de arco constante para que cliente y servidor midan lo mismo.
 */

function lerp3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function dist3(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Catmull-Rom centrípeta (alpha = 0.5) entre p1 y p2, algoritmo de Barry-Goldman. */
function centripetal(p0, p1, p2, p3, t) {
  const knot = (a, b) => Math.max(Math.pow(dist3(a, b), 0.5), 1e-4);
  const t0 = 0;
  const t1 = t0 + knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const u = t1 + (t2 - t1) * t;
  const a1 = lerp3(p0, p1, (u - t0) / (t1 - t0));
  const a2 = lerp3(p1, p2, (u - t1) / (t2 - t1));
  const a3 = lerp3(p2, p3, (u - t2) / (t3 - t2));
  const b1 = lerp3(a1, a2, (u - t0) / (t2 - t0));
  const b2 = lerp3(a2, a3, (u - t1) / (t3 - t1));
  return lerp3(b1, b2, (u - t1) / (t2 - t1));
}

/**
 * Construye el trazado muestreado de una pista.
 * @param {{points: number[][]}} def
 * @param {number} spacing distancia aproximada en metros entre muestras
 */
export function buildTrackPath(def, spacing = 2) {
  const ctrl = def.points;
  const n = ctrl.length;
  const dense = [];
  const SUB = 64;
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    for (let j = 0; j < SUB; j++) dense.push(centripetal(p0, p1, p2, p3, j / SUB));
  }

  const denseS = [0];
  for (let i = 1; i <= dense.length; i++) {
    denseS.push(denseS[i - 1] + dist3(dense[i - 1], dense[i % dense.length]));
  }
  const length = denseS[dense.length];
  const count = Math.max(16, Math.round(length / spacing));
  const step = length / count;

  const points = [];
  let k = 0;
  for (let i = 0; i < count; i++) {
    const s = i * step;
    while (denseS[k + 1] < s) k++;
    const t = (s - denseS[k]) / (denseS[k + 1] - denseS[k] || 1);
    points.push(lerp3(dense[k], dense[(k + 1) % dense.length], t));
  }

  const tangents = [];
  const rights = [];
  const curvature = [];
  for (let i = 0; i < count; i++) {
    const a = points[(i - 1 + count) % count];
    const b = points[(i + 1) % count];
    let tx = b[0] - a[0];
    let ty = b[1] - a[1];
    let tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl; ty /= tl; tz /= tl;
    tangents.push([tx, ty, tz]);
    // Vector "derecha" horizontal: tangente x arriba(0,1,0) proyectado en XZ.
    const rl = Math.hypot(tx, tz) || 1;
    rights.push([-tz / rl, 0, tx / rl]);
  }
  for (let i = 0; i < count; i++) {
    const a = tangents[(i - 1 + count) % count];
    const b = tangents[(i + 1) % count];
    // Curvatura con signo en el plano XZ (positivo = gira a la derecha).
    const cross = a[2] * b[0] - a[0] * b[2];
    curvature.push(cross / (2 * step));
  }

  return { points, tangents, rights, curvature, length, step, count, width: def.width };
}

/**
 * Proyecta una posición sobre el trazado. Si se pasa `hint` (índice previo) la
 * búsqueda es local, lo que la hace O(1) por frame.
 */
export function projectToTrack(path, x, z, hint = -1) {
  const { points, count } = path;
  let best = -1;
  let bestD = Infinity;
  const scan = (i) => {
    const p = points[i];
    const d = (p[0] - x) * (p[0] - x) + (p[2] - z) * (p[2] - z);
    if (d < bestD) { bestD = d; best = i; }
  };
  if (hint >= 0) {
    for (let o = -40; o <= 40; o++) scan((hint + o + count) % count);
    if (bestD > 60 * 60) { bestD = Infinity; for (let i = 0; i < count; i++) scan(i); }
  } else {
    for (let i = 0; i < count; i++) scan(i);
  }
  const p = points[best];
  const t = path.tangents[best];
  const r = path.rights[best];
  const dx = x - p[0];
  const dz = z - p[2];
  const along = dx * t[0] + dz * t[2];
  let s = best * path.step + along;
  if (s < 0) s += path.length;
  if (s >= path.length) s -= path.length;
  return { index: best, s, lateral: dx * r[0] + dz * r[2], distance: Math.sqrt(bestD), y: p[1] };
}

/** Puertas de checkpoint equidistantes; la 0 es la línea de meta. */
export function checkpointGates(path, count) {
  const gates = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.round((i / count) * path.count) % path.count;
    gates.push({
      id: i,
      index: idx,
      s: idx * path.step,
      position: path.points[idx],
      tangent: path.tangents[idx],
      right: path.rights[idx],
    });
  }
  return gates;
}

/** Distancia de arco hacia delante desde sA hasta sB (siempre positiva). */
export function forwardDistance(path, sA, sB) {
  const d = sB - sA;
  return d >= 0 ? d : d + path.length;
}

/**
 * Posición de salida en parrilla (2 columnas escalonadas detrás de la meta).
 * @returns {{position: number[], yaw: number}} yaw en radianes alrededor de Y,
 *   con 0 apuntando a +Z (convención de los coches del cliente).
 */
export function gridSlot(path, slot) {
  const row = Math.floor(slot / 2);
  const col = slot % 2;
  const back = 10 + row * 9 + col * 4.5;
  const idx = (path.count - Math.round(back / path.step)) % path.count;
  const p = path.points[idx];
  const t = path.tangents[idx];
  const r = path.rights[idx];
  const side = (col === 0 ? -1 : 1) * path.width * 0.22;
  return {
    position: [p[0] + r[0] * side, p[1] + 1.2, p[2] + r[2] * side],
    yaw: Math.atan2(t[0], t[2]),
  };
}
