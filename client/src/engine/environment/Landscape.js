import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { fbm2, smoothstep, seededRandom } from './noise.js';
import { surfaceTextures } from '../textures.js';

/**
 * Paisaje alrededor de una pista: terreno con alturas y colores por pendiente
 * y altitud, lago (si el tema lo pide) y vegetación instanciada. Todo se
 * genera a partir del trazado, de modo que el terreno se aplana bajo la pista
 * y nunca la atraviesa.
 */
export class Landscape {
  constructor(path, theme, { outerOffset }) {
    this.path = path;
    this.theme = theme;
    this.outerOffset = outerOffset;
    this.group = new THREE.Group();
    this.group.name = 'landscape';
    this.disposables = [];
    this.water = null;

    this.computeBounds();
    this.sampleTrack();
    if (theme.water) this.placeLake();
    this.buildTerrain();
    if (this.lake) this.buildWater();
    this.buildVegetation();
  }

  computeBounds() {
    let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
    let minY = Infinity;
    for (const p of this.path.points) {
      minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]);
      minZ = Math.min(minZ, p[2]); maxZ = Math.max(maxZ, p[2]);
      minY = Math.min(minY, p[1]);
    }
    this.trackBounds = { minX, maxX, minZ, maxZ, minY };
    this.center = [(minX + maxX) / 2, (minZ + maxZ) / 2];
    this.size = Math.max(maxX - minX, maxZ - minZ) + 1700;
  }

  sampleTrack() {
    const pts = this.path.points.filter((_, i) => i % 2 === 0);
    this.tx = Float32Array.from(pts, (p) => p[0]);
    this.ty = Float32Array.from(pts, (p) => p[1]);
    this.tz = Float32Array.from(pts, (p) => p[2]);
  }

  /** Distancia horizontal a la pista y elevación de la pista más cercana. */
  nearestTrack(x, z) {
    let best = Infinity;
    let y = 0;
    const { tx, ty, tz } = this;
    for (let i = 0; i < tx.length; i++) {
      const dx = tx[i] - x;
      const dz = tz[i] - z;
      const d = dx * dx + dz * dz;
      if (d < best) { best = d; y = ty[i]; }
    }
    return { d: Math.sqrt(best), y };
  }

  placeLake() {
    const { minX, maxX, minZ, maxZ, minY } = this.trackBounds;
    let best = null;
    for (let x = minX - 220; x <= maxX + 220; x += 12) {
      for (let z = minZ - 220; z <= maxZ + 220; z += 12) {
        const { d } = this.nearestTrack(x, z);
        if (d > 320) continue;
        if (!best || d > best.d) best = { x, z, d };
      }
    }
    if (!best || best.d < 70) return;
    this.lake = { x: best.x, z: best.z, r: Math.min(best.d - 38, 120), level: minY - 1.5 };
  }

  heightAt(x, z) {
    const { d, y } = this.nearestTrack(x, z);
    const natural = this.theme.height(x, z, d) + y * (1 - smoothstep(80, 400, d));
    const blend = smoothstep(this.outerOffset + 1.5, this.outerOffset + 40, d);
    let h = (y - 0.5) * (1 - blend) + natural * blend;
    if (this.lake) {
      const lk = this.lake;
      const ld = Math.hypot(x - lk.x, z - lk.z) / lk.r;
      if (ld < 1.4) {
        const bowl = lk.level - 6 * Math.max(0, 1 - ld * ld) + 1.2;
        const k = smoothstep(1.4, 0.9, ld);
        h = h * (1 - k) + Math.min(h, bowl) * k;
      }
    }
    return { h, d };
  }

  buildTerrain() {
    const seg = 300;
    const geo = new THREE.PlaneGeometry(this.size, this.size, seg, seg);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.center[0], 0, this.center[1]);
    const pos = geo.attributes.position;
    const dist = new Float32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const { h, d } = this.heightAt(pos.getX(i), pos.getZ(i));
      pos.setY(i, h);
      dist[i] = d;
    }
    geo.computeVertexNormals();

    const { colors, snowLine } = this.theme;
    const col = new Float32Array(pos.count * 3);
    const nrm = geo.attributes.normal;
    const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = pos.getY(i);
      const ny = nrm.getY(i);
      const v = fbm2(x / 40, z / 40, { seed: 21, octaves: 3 });
      let c = mixc(colors.low, colors.mid, v);
      c = mixc(c, colors.rock, smoothstep(0.86, 0.62, ny));
      if (this.lake) {
        const ld = Math.hypot(x - this.lake.x, z - this.lake.z) / this.lake.r;
        c = mixc(c, colors.shore, smoothstep(1.25, 1.0, ld));
      }
      const snow = Number.isFinite(snowLine) ? smoothstep(snowLine - 15, snowLine + 25, h + v * 30) * smoothstep(0.45, 0.7, ny) : 0;
      c = mixc(c, colors.snow, snow);
      // Tierra más oscura junto a la pista (gomas, uso).
      const wear = smoothstep(this.outerOffset + 12, this.outerOffset, dist[i]) * 0.15;
      col.set([c[0] * (1 - wear), c[1] * (1 - wear), c[2] * (1 - wear)], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));

    const detail = surfaceTextures(this.theme.terrainDetail);
    const normalMap = detail.normalMap.clone();
    normalMap.repeat.set(this.size / 6, this.size / 6);
    normalMap.needsUpdate = true;
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      normalMap,
      normalScale: new THREE.Vector2(0.6, 0.6),
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrain = mesh;
    this.terrainSeg = seg;
    this.disposables.push(geo, mat, normalMap);
  }

  /** Altura exacta del terreno ya construido (bilineal sobre la rejilla). */
  terrainHeight(x, z) {
    const seg = this.terrainSeg;
    const half = this.size / 2;
    const fx = ((x - this.center[0] + half) / this.size) * seg;
    const fz = ((z - this.center[1] + half) / this.size) * seg;
    const ix = Math.max(0, Math.min(seg - 1, Math.floor(fx)));
    const iz = Math.max(0, Math.min(seg - 1, Math.floor(fz)));
    const pos = this.terrain.geometry.attributes.position;
    const at = (i, j) => pos.getY(j * (seg + 1) + i);
    const tx = fx - ix;
    const tz = fz - iz;
    const a = at(ix, iz); const b = at(ix + 1, iz); const c = at(ix, iz + 1); const d = at(ix + 1, iz + 1);
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  terrainNormalY(x, z) {
    const e = 3;
    const hx = this.terrainHeight(x + e, z) - this.terrainHeight(x - e, z);
    const hz = this.terrainHeight(x, z + e) - this.terrainHeight(x, z - e);
    return (2 * e) / Math.sqrt(hx * hx + hz * hz + 4 * e * e);
  }

  buildWater() {
    const { x, z, r, level } = this.lake;
    const tex = surfaceTextures('snow').normalMap.clone();
    tex.repeat.set(r / 5, r / 5);
    tex.needsUpdate = true;
    const geo = new THREE.CircleGeometry(r * 1.45, 64);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshPhysicalMaterial({
      color: '#1d4f63',
      roughness: 0.06,
      metalness: 0.1,
      transparent: true,
      opacity: 0.88,
      normalMap: tex,
      normalScale: new THREE.Vector2(0.25, 0.25),
      envMapIntensity: 1.4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, level, z);
    mesh.receiveShadow = true;
    mesh.name = 'lake';
    this.group.add(mesh);
    this.water = { mesh, tex };
    this.disposables.push(geo, mat, tex);
  }

  /** Coloca instancias en posiciones válidas según una función de aceptación. */
  scatter(count, seed, accept, { minD, maxD }) {
    const rand = seededRandom(seed);
    const out = [];
    const half = Math.min(this.size / 2 - 20, maxD + 300);
    let attempts = 0;
    while (out.length < count && attempts < count * 25) {
      attempts++;
      const x = this.center[0] + (rand() * 2 - 1) * half;
      const z = this.center[1] + (rand() * 2 - 1) * half;
      const { d } = this.nearestTrack(x, z);
      if (d < minD || d > maxD) continue;
      if (this.lake && Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r * 1.15) continue;
      const y = this.terrainHeight(x, z);
      const ny = this.terrainNormalY(x, z);
      if (!accept({ x, z, y, ny, d, rand })) continue;
      out.push({ x, y, z, s: 0.7 + rand() * 0.6, r: rand() * Math.PI * 2, v: rand() });
    }
    return out;
  }

  instanced(geometry, material, items, { castShadow = true, tint } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, material, items.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.r);
      s.setScalar(it.s);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (tint) mesh.setColorAt(i, tint(color, it));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.disposables.push(geometry, material);
    return mesh;
  }

  buildVegetation() {
    const minD = this.outerOffset + 9;
    if (this.theme.vegetation === 'pines') this.buildPines(minD);
    else this.buildDesertFlora(minD);
    this.buildRocks(minD);
  }

  buildPines(minD) {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.16, 0.34, 4, 7);
    trunk.translate(0, 2, 0);
    paint(trunk, [0.30, 0.21, 0.14]);
    parts.push(trunk);
    // Copa en 6 pisos de ramas caídas, más oscura abajo y más clara arriba.
    const tiers = 6;
    for (let t = 0; t < tiers; t++) {
      const k = t / (tiers - 1);
      const radius = 3.1 - k * 2.3;
      const height = 3.2 - k * 1.2;
      const y = 1.6 + t * 1.55;
      const cone = new THREE.ConeGeometry(radius, height, 12, 2, true);
      // Bajar el borde exterior para simular ramas que cuelgan.
      const pos = cone.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i)) / radius;
        pos.setY(i, pos.getY(i) - r * r * 0.35);
      }
      cone.translate(0, y + height / 2, 0);
      jitter(cone, 0.3, 7 + t);
      paint(cone, [0.10 + k * 0.05, 0.20 + k * 0.08, 0.11 + k * 0.03]);
      parts.push(cone);
    }
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    geo.computeVertexNormals();
    parts.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
    const { snowLine } = this.theme;
    const trees = this.scatter(2600, 7, ({ x, z, y, ny, d, rand }) => {
      if (ny < 0.8 || y > snowLine - 10) return false;
      // Bosques por manchas con claros naturales; más densos lejos de la pista.
      const forest = fbm2(x / 140, z / 140, { seed: 15, octaves: 3 });
      return forest > 0.42 - Math.min(0.12, d / 3000) && rand() < 0.9;
    }, { minD, maxD: 650 });
    trees.forEach((t) => { t.s = 0.75 + t.v * 1.0; });
    this.instanced(geo, mat, trees, {
      tint: (c, it) => c.setHSL(0.28 + it.v * 0.05, 0.25 + it.v * 0.2, 0.7 + it.v * 0.35),
    });
  }

  buildDesertFlora(minD) {
    // Saguaro: tronco con dos brazos.
    const parts = [];
    const body = new THREE.CylinderGeometry(0.38, 0.45, 6, 8);
    body.translate(0, 3, 0);
    parts.push(body);
    const armA = new THREE.CylinderGeometry(0.26, 0.28, 2.4, 7);
    armA.translate(0.95, 3.6, 0);
    const elbowA = new THREE.CylinderGeometry(0.26, 0.26, 1.0, 7);
    elbowA.rotateZ(Math.PI / 2);
    elbowA.translate(0.5, 2.5, 0);
    const armB = new THREE.CylinderGeometry(0.24, 0.26, 1.8, 7);
    armB.translate(-0.85, 4.1, 0);
    const elbowB = new THREE.CylinderGeometry(0.24, 0.24, 0.9, 7);
    elbowB.rotateZ(Math.PI / 2);
    elbowB.translate(-0.45, 3.3, 0);
    parts.push(armA, elbowA, armB, elbowB);
    for (const s of [body, armA, armB]) {
      const top = new THREE.SphereGeometry(1, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2);
      s.computeBoundingBox();
      const bb = s.boundingBox;
      const rr = (bb.max.x - bb.min.x) / 2;
      top.scale(rr, rr, rr);
      top.translate((bb.max.x + bb.min.x) / 2, bb.max.y, 0);
      parts.push(top);
    }
    parts.forEach((g) => paint(g, [0.27, 0.40, 0.20]));
    const geo = mergeGeometries(parts.map((g) => g.toNonIndexed()));
    geo.computeVertexNormals();
    parts.forEach((g) => g.dispose());
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const cacti = this.scatter(420, 31, ({ ny, rand }) => ny > 0.85 && rand() < 0.8, { minD, maxD: 520 });
    this.instanced(geo, mat, cacti, {
      tint: (c, it) => c.setHSL(0.25, 0.25, 0.8 + it.v * 0.4),
    });

    // Matorral seco bajo.
    const bush = new THREE.IcosahedronGeometry(1, 1);
    bush.scale(1.2, 0.55, 1.2);
    jitter(bush, 0.3, 4);
    paint(bush, [0.48, 0.42, 0.25]);
    const bushMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
    const bushes = this.scatter(900, 32, ({ ny }) => ny > 0.8, { minD: minD - 3, maxD: 420 });
    this.instanced(bush, bushMat, bushes, { castShadow: false, tint: (c, it) => c.setHSL(0.11, 0.3, 0.75 + it.v * 0.4) });
  }

  buildRocks(minD) {
    const geo = new THREE.DodecahedronGeometry(1, 1);
    jitter(geo, 0.35, 11);
    geo.scale(1.4, 0.8, 1.1);
    geo.computeVertexNormals();
    const desert = this.theme.vegetation === 'cacti';
    paint(geo, desert ? [0.55, 0.28, 0.17] : [0.45, 0.43, 0.41]);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
    const rocks = this.scatter(desert ? 500 : 350, 41, ({ rand }) => rand() < 0.9, { minD, maxD: 500 });
    rocks.forEach((r) => { r.s = 0.4 + r.v * r.v * 3.5; r.y -= r.s * 0.25; });
    this.instanced(geo, mat, rocks, { tint: (c, it) => c.setHSL(0.05, 0.1, 0.7 + it.v * 0.35) });
  }

  update(time) {
    if (this.water) {
      this.water.tex.offset.set(time * 0.01, time * 0.006);
    }
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.group.clear();
  }
}

function paint(geo, rgb) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set(rgb, i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function jitter(geo, amount, seed) {
  const rand = seededRandom(seed);
  const pos = geo.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(rand() - 0.5) * amount, (rand() - 0.5) * amount, (rand() - 0.5) * amount]);
    const o = map.get(key);
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
}
