// Geometría derivada de una pista: distancias acumuladas, tangentes, normales,
// proyección de un punto sobre la línea central, parrilla de salida y vallas.
// Lo usan el cliente (para construir la malla y el HUD) y el servidor (para validar vueltas).
//
// Convenciones: plano XZ con Y hacia arriba. "right" es el vector a la derecha del sentido de marcha.

const CELL = 30; // tamaño de celda del índice espacial (m)

export class TrackLayout {
  constructor(data) {
    this.data = data;
    this.id = data.id;
    this.name = data.name;
    this.width = data.width;
    this.halfWidth = data.width / 2;

    const pts = data.points;
    const n = pts.length;
    this.n = n;
    this.x = new Float64Array(n);
    this.z = new Float64Array(n);
    for (let i = 0; i < n; i++) { this.x[i] = pts[i][0]; this.z[i] = pts[i][1]; }

    this.cum = new Float64Array(n + 1);
    this.tx = new Float64Array(n);
    this.tz = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const dx = this.x[j] - this.x[i], dz = this.z[j] - this.z[i];
      const len = Math.hypot(dx, dz) || 1e-6;
      this.cum[i + 1] = this.cum[i] + len;
      this.tx[i] = dx / len; this.tz[i] = dz / len;
    }
    this.length = this.cum[n];

    // Tangente suavizada en los vértices y curvatura con signo (+ = curva a la derecha).
    this.vtx = new Float64Array(n);
    this.vtz = new Float64Array(n);
    this.curvature = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const p = (i - 1 + n) % n;
      let vx = this.tx[p] + this.tx[i], vz = this.tz[p] + this.tz[i];
      const l = Math.hypot(vx, vz) || 1;
      this.vtx[i] = vx / l; this.vtz[i] = vz / l;
      const cross = this.tx[p] * this.tz[i] - this.tz[p] * this.tx[i];
      const segLen = (this.cum[i + 1] - this.cum[i] + this.cum[p + 1] - this.cum[p]) / 2;
      this.curvature[i] = cross / Math.max(segLen, 1e-3);
    }

    this.#buildIndex();

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.x[i]); maxX = Math.max(maxX, this.x[i]);
      minZ = Math.min(minZ, this.z[i]); maxZ = Math.max(maxZ, this.z[i]);
    }
    this.bounds = { minX, maxX, minZ, maxZ };
  }

  #cellKey(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

  #buildIndex() {
    this.cells = new Map();
    const add = (cx, cz, i) => {
      const k = this.#cellKey(cx, cz);
      let arr = this.cells.get(k);
      if (!arr) this.cells.set(k, (arr = []));
      if (arr[arr.length - 1] !== i) arr.push(i);
    };
    for (let i = 0; i < this.n; i++) {
      const j = (i + 1) % this.n;
      const minX = Math.floor(Math.min(this.x[i], this.x[j]) / CELL);
      const maxX = Math.floor(Math.max(this.x[i], this.x[j]) / CELL);
      const minZ = Math.floor(Math.min(this.z[i], this.z[j]) / CELL);
      const maxZ = Math.floor(Math.max(this.z[i], this.z[j]) / CELL);
      for (let cx = minX; cx <= maxX; cx++) for (let cz = minZ; cz <= maxZ; cz++) add(cx, cz, i);
    }
  }

  /** Distancia de un punto al segmento i y parámetro t sobre él. */
  #segment(i, px, pz, out) {
    const ax = this.x[i], az = this.z[i];
    const segLen = this.cum[i + 1] - this.cum[i];
    let t = ((px - ax) * this.tx[i] + (pz - az) * this.tz[i]) / segLen;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + this.tx[i] * segLen * t, cz = az + this.tz[i] * segLen * t;
    const d2 = (px - cx) ** 2 + (pz - cz) ** 2;
    if (d2 < out.d2) { out.d2 = d2; out.i = i; out.t = t; }
  }

  /** Busca el segmento más cercano en todo el trazado (índice espacial). */
  nearestGlobal(px, pz) {
    const out = { d2: Infinity, i: 0, t: 0 };
    const cx = Math.floor(px / CELL), cz = Math.floor(pz / CELL);
    for (let r = 1; r <= 4 && out.d2 === Infinity; r++) {
      for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        const arr = this.cells.get(this.#cellKey(cx + dx, cz + dz));
        if (arr) for (const i of arr) this.#segment(i, px, pz, out);
      }
    }
    if (out.d2 === Infinity) for (let i = 0; i < this.n; i++) this.#segment(i, px, pz, out);
    return out;
  }

  /**
   * Proyecta (px, pz) sobre la línea central. Con `hint` (índice previo) busca primero
   * localmente para no saltar a un tramo paralelo cercano.
   * Devuelve { i, t, s, lateral, dist }.
   */
  project(px, pz, hint = -1) {
    let out = { d2: Infinity, i: 0, t: 0 };
    if (hint >= 0) {
      for (let k = -24; k <= 24; k++) this.#segment((hint + k + this.n) % this.n, px, pz, out);
      if (out.d2 > (this.halfWidth + 60) ** 2) out = this.nearestGlobal(px, pz);
    } else {
      out = this.nearestGlobal(px, pz);
    }
    const i = out.i;
    const segLen = this.cum[i + 1] - this.cum[i];
    const s = this.cum[i] + segLen * out.t;
    const cx = this.x[i] + this.tx[i] * segLen * out.t;
    const cz = this.z[i] + this.tz[i] * segLen * out.t;
    // derecha = (-tz, tx)
    const lateral = (px - cx) * -this.tz[i] + (pz - cz) * this.tx[i];
    return { i, t: out.t, s, lateral, dist: Math.sqrt(out.d2) };
  }

  /** Posición y orientación sobre la línea central a una distancia s (admite negativos). */
  sampleAt(s) {
    const L = this.length;
    s = ((s % L) + L) % L;
    let lo = 0, hi = this.n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid; else hi = mid;
    }
    const i = lo;
    const t = (s - this.cum[i]) / (this.cum[i + 1] - this.cum[i]);
    const j = (i + 1) % this.n;
    const x = this.x[i] + (this.x[j] - this.x[i]) * t;
    const z = this.z[i] + (this.z[j] - this.z[i]) * t;
    // tangente interpolada entre vértices para orientación suave
    let tx = this.vtx[i] + (this.vtx[j] - this.vtx[i]) * t;
    let tz = this.vtz[i] + (this.vtz[j] - this.vtz[i]) * t;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    return { i, x, z, tx, tz, rx: -tz, rz: tx };
  }

  /** Punto desplazado lateralmente (positivo = derecha). */
  offsetPoint(s, lateral) {
    const p = this.sampleAt(s);
    return { ...p, x: p.x + p.rx * lateral, z: p.z + p.rz * lateral };
  }

  /** Ángulo de guiñada (rotación en Y) para mirar en la dirección (tx, tz). Frente del coche = +Z local. */
  static yawFromTangent(tx, tz) { return Math.atan2(tx, tz); }

  /** Huecos de parrilla detrás de la línea de salida, escalonados en dos filas. */
  gridSlots(count) {
    const slots = [];
    for (let k = 0; k < count; k++) {
      const row = Math.floor(k / 2);
      const side = k % 2 === 0 ? -1 : 1;
      const s = -14 - row * 10 - (k % 2) * 5;
      const p = this.offsetPoint(s, side * this.halfWidth * 0.42);
      slots.push({ x: p.x, z: p.z, yaw: TrackLayout.yawFromTangent(p.tx, p.tz), s });
    }
    return slots;
  }

  /**
   * Polilíneas de valla a cada lado, a `offset` metros del centro. Se descartan los puntos
   * que invadirían otro tramo de la pista (curvas cerradas o tramos paralelos).
   */
  barrierLines(offset, step = 1) {
    const lines = [];
    const idx = [];
    for (let i = 0; i < this.n; i += step) idx.push(i);
    const m = idx.length;
    for (const side of [-1, 1]) {
      const pts = idx.map((i) => [this.x[i] - this.vtz[i] * side * offset, this.z[i] + this.vtx[i] * side * offset]);
      const ok = pts.map(([px, pz]) => Math.sqrt(this.nearestGlobal(px, pz).d2) >= offset - 0.75);
      const firstBad = ok.indexOf(false);
      if (firstBad === -1) { lines.push({ side, points: pts, closed: true }); continue; }
      // Recorre el lazo empezando en un punto inválido para que ninguna tirada quede partida.
      let run = [];
      for (let k = 1; k <= m; k++) {
        const j = (firstBad + k) % m;
        if (ok[j]) run.push(pts[j]);
        else { if (run.length > 3) lines.push({ side, points: run, closed: false }); run = []; }
      }
    }
    return lines;
  }

  /** Superficie bajo un punto según su desplazamiento lateral. */
  surfaceAt(lateral) {
    const a = Math.abs(lateral);
    if (a <= this.halfWidth) return 'asphalt';
    if (a <= this.halfWidth + 1.4) return 'kerb';
    return 'grass';
  }
}
