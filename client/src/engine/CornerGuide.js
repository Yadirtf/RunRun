// Detecta las curvas del trazado y avisa con antelación: dirección, dureza, distancia,
// velocidad recomendada y cuándo frenar o girar. También coloca en la pista carteles
// de frenada (150/100/50 m) y chevrones en el exterior de las curvas cerradas.
import * as THREE from 'three';

const MIN_RADIUS = 260; // por encima, se considera recta o curva a fondo
const GRIP_MU = 1.1; // agarre que se asume para la velocidad recomendada
const BRAKE_DECEL = 10; // deceleración "cómoda" para calcular el punto de frenada (m/s²)

const SEVERITY = [
  { max: 28, label: 'Horquilla', level: 1 },
  { max: 55, label: 'Muy cerrada', level: 2 },
  { max: 95, label: 'Cerrada', level: 3 },
  { max: 150, label: 'Media', level: 4 },
  { max: Infinity, label: 'Rápida', level: 5 },
];

export class CornerGuide {
  /** @param {import('@ranran/shared').TrackLayout} layout */
  constructor(layout) {
    this.layout = layout;
    this.corners = this.#detect();
  }

  #detect() {
    const L = this.layout;
    const n = L.n;
    // Curvatura suavizada (±4 puntos ≈ ±20 m) para no reaccionar al ruido del trazado.
    const k = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let sum = 0;
      for (let d = -4; d <= 4; d++) sum += L.curvature[(i + d + n) % n];
      k[i] = sum / 9;
    }
    const isCorner = (i) => Math.abs(k[i]) > 1 / MIN_RADIUS;

    // Empieza a recorrer desde un punto recto para no partir una curva en dos.
    let start = 0;
    while (start < n && isCorner(start)) start++;
    const runs = [];
    let cur = null;
    for (let step = 1; step <= n; step++) {
      const i = (start + step) % n;
      const sign = Math.sign(k[i]);
      if (isCorner(i) && (!cur || cur.sign === sign)) {
        if (!cur) cur = { sign, from: i, to: i, peak: i };
        cur.to = i;
        if (Math.abs(k[i]) > Math.abs(k[cur.peak])) cur.peak = i;
      } else {
        if (cur) runs.push(cur);
        cur = isCorner(i) ? { sign, from: i, to: i, peak: i } : null;
      }
    }
    if (cur) runs.push(cur);

    // Une curvas del mismo sentido separadas por muy poco (un "doble vértice").
    const merged = [];
    for (const r of runs) {
      const prev = merged[merged.length - 1];
      const gap = prev ? (L.cum[r.from] - L.cum[prev.to] + L.length) % L.length : Infinity;
      if (prev && prev.sign === r.sign && gap < 30) {
        prev.to = r.to;
        if (Math.abs(k[r.peak]) > Math.abs(k[prev.peak])) prev.peak = r.peak;
      } else merged.push({ ...r });
    }

    return merged
      .map((r) => {
        const radius = 1 / Math.abs(k[r.peak]);
        const sev = SEVERITY.find((s) => radius < s.max);
        return {
          entryS: L.cum[r.from],
          apexS: L.cum[r.peak],
          exitS: L.cum[r.to],
          dir: r.sign > 0 ? 'right' : 'left',
          radius,
          level: sev.level,
          label: sev.label,
          speed: Math.min(Math.sqrt(9.81 * GRIP_MU * radius), 95),
        };
      })
      .sort((a, b) => a.entryS - b.entryS);
  }

  /**
   * Próxima curva desde la posición s, con el estado del aviso según la velocidad actual.
   * Devuelve null si no hay ninguna curva relevante cerca.
   */
  next(s, speed) {
    if (!this.corners.length) return null;
    const L = this.layout.length;
    const v = Math.max(speed, 0);
    let best = null, bestDist = Infinity;
    for (const c of this.corners) {
      let d = (c.entryS - s + L) % L;
      // Si ya estamos dentro de la curva, la distancia es 0 hasta salir.
      const inside = (s - c.entryS + L) % L < (c.exitS - c.entryS + L) % L;
      if (inside) d = 0;
      if (d < bestDist) { bestDist = d; best = c; }
    }
    const lookahead = Math.max(160, v * 6);
    if (!best || bestDist > lookahead) return null;
    // Una curva rápida que se puede tomar a esta velocidad no necesita aviso fuerte.
    const brakeDist = v > best.speed ? (v * v - best.speed * best.speed) / (2 * BRAKE_DECEL) : 0;
    const margin = bestDist - brakeDist;
    let state;
    if (bestDist === 0) state = 'in';
    else if (bestDist < Math.max(v * 0.45, 6)) state = 'turn';
    else if (brakeDist > 0 && margin < v * 0.6) state = 'brake';
    else if (brakeDist > 0 && margin < v * 2.2) state = 'prepare';
    else state = 'info';
    return { ...best, distance: bestDist, state, targetKmh: best.speed * 3.6, brakeDist };
  }

  /** Carteles de frenada y chevrones en la pista. */
  buildMarkers(group, track) {
    const L = this.layout;
    const hw = L.halfWidth;
    const boardTex = new Map();
    const boardTexture = (text) => {
      if (boardTex.has(text)) return boardTex.get(text);
      const c = document.createElement('canvas');
      c.width = 128; c.height = 160;
      const g = c.getContext('2d');
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 160);
      g.fillStyle = '#c1121f'; g.fillRect(6, 6, 116, 148);
      g.fillStyle = '#ffffff'; g.fillRect(14, 14, 100, 132);
      g.fillStyle = '#111'; g.font = 'bold 64px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, 64, 82);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      boardTex.set(text, track(tex));
      return tex;
    };
    const chevronTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = '#c1121f'; g.fillRect(0, 0, 256, 128);
      g.fillStyle = '#ffffff';
      for (const x of [30, 110, 190]) {
        g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 40, 64); g.lineTo(x, 114); g.lineTo(x + 22, 114); g.lineTo(x + 62, 64); g.lineTo(x + 22, 14); g.closePath(); g.fill();
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return track(tex);
    })();

    const postMat = track(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.4 }));
    const postGeo = track(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 6));
    const boardGeo = track(new THREE.PlaneGeometry(1.5, 1.88));
    const chevGeo = track(new THREE.PlaneGeometry(3.6, 1.8));
    const free = (x, z, need) => L.nearestGlobal(x, z).d2 > need * need;

    const place = (s, lateral, yawOffset, mesh, height) => {
      const p = L.offsetPoint(s, lateral);
      if (!free(p.x, p.z, hw + 2.5)) return;
      const holder = new THREE.Group();
      holder.position.set(p.x, 0, p.z);
      holder.rotation.y = Math.atan2(p.tx, p.tz) + yawOffset;
      const post = new THREE.Mesh(postGeo, postMat);
      post.position.y = 0.8;
      holder.add(post);
      mesh.position.y = height;
      holder.add(mesh);
      group.add(holder);
    };

    for (const c of this.corners) {
      const outside = c.dir === 'right' ? -1 : 1; // lateral negativo = izquierda
      // Carteles de frenada solo donde hay que frenar de verdad (curvas lentas).
      if (c.level <= 3) {
        for (const m of [150, 100, 50]) {
          const mat = track(new THREE.MeshBasicMaterial({ map: boardTexture(String(m)) }));
          // Miran hacia el coche que se acerca (el plano por defecto mira a +Z; giramos 180°).
          place(c.entryS - m, outside * (hw + 3.2), Math.PI, new THREE.Mesh(boardGeo, mat), 2.2);
        }
      }
      // Chevrones en el exterior del vértice de las curvas cerradas.
      if (c.level <= 4) {
        const mat = track(new THREE.MeshBasicMaterial({ map: chevronTex, side: THREE.DoubleSide }));
        if (c.dir === 'left') { mat.map = chevronTex.clone(); mat.map.repeat.x = -1; mat.map.offset.x = 1; mat.map.wrapS = THREE.RepeatWrapping; track(mat.map); }
        for (const ds of [-12, 0, 12]) {
          place(c.apexS + ds, outside * (hw + 4.5), Math.PI, new THREE.Mesh(chevGeo, mat), 1.6);
        }
      }
    }
  }
}
