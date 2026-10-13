import * as THREE from 'three';
import { Water } from 'three/examples/jsm/objects/Water.js';
import { fbm2, smoothstep, seededRandom } from './noise.js';
import { cached, fbm, normalFromHeight, surfaceTextures } from '../textures.js';
import { terrainMaterial } from './terrainMaterial.js';
import { windUniforms, conifer, broadleaf, palm, bush, grassTuft, cactus } from './foliage.js';
import { houseMeshes, lighthouse, sailboat, buildingMaterial, streetLampMeshes, lightPoolMaterial, neonSign } from './props.js';
import { QUALITY_PRESETS } from '../quality.js';

/**
 * Paisaje alrededor de una pista: terreno por capas (hierba, roca, nieve,
 * arena...) que se aplana bajo la pista y nunca la atraviesa, agua (lago o
 * mar), vegetación instanciada con texturas recortadas, matas de hierba junto
 * al trazado y construcciones según el tema.
 */
export class Landscape {
  constructor(path, theme, { outerOffset, quality = QUALITY_PRESETS.high, sunDir } = {}) {
    this.path = path;
    this.theme = theme;
    this.outerOffset = outerOffset;
    this.quality = quality;
    this.sunDir = sunDir ?? new THREE.Vector3(0.5, 0.7, 0.3).normalize();
    this.group = new THREE.Group();
    this.group.name = 'landscape';
    this.disposables = [];
    this.water = null;

    this.computeBounds();
    this.sampleTrack();
    if (theme.water === 'lake') this.placeLake();
    this.buildTerrain();
    if (this.lake) this.buildLake();
    if (theme.water === 'sea') this.buildSea();
    this.buildVegetation();
    this.buildProps();
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
    const seg = this.quality.terrainSegments;
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

    const { theme } = this;
    const [ta, tb] = theme.tint;
    const col = new Float32Array(pos.count * 3);
    const splat = new Float32Array(pos.count * 3);
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = pos.getY(i);
      const ny = nrm.getY(i);
      const v = fbm2(x / 45, z / 45, { seed: 21, octaves: 3 });
      const v2 = fbm2(x / 180, z / 180, { seed: 22, octaves: 2 });
      // Variación de tono a dos escalas (manchas de humedad, claros...).
      const t = Math.min(1, Math.max(0, v * 0.6 + v2 * 0.6 - 0.1));
      // Tierra más oscura junto a la pista (gomas, uso).
      const wear = 1 - smoothstep(this.outerOffset + 10, this.outerOffset, dist[i]) * 0.18;
      col[i * 3] = (ta[0] + (tb[0] - ta[0]) * t) * wear;
      col[i * 3 + 1] = (ta[1] + (tb[1] - ta[1]) * t) * wear;
      col[i * 3 + 2] = (ta[2] + (tb[2] - ta[2]) * t) * wear;
      let rock = smoothstep(0.86, 0.66, ny);
      if (this.lake) {
        const ld = Math.hypot(x - this.lake.x, z - this.lake.z) / this.lake.r;
        rock = Math.max(rock, smoothstep(1.25, 1.0, ld) * 0.8);
      }
      const top = Math.min(1 - rock, theme.topWeight(x, z, h, ny, v));
      splat[i * 3] = Math.max(0, 1 - rock - top);
      splat[i * 3 + 1] = rock;
      splat[i * 3 + 2] = top;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 3));

    const mat = terrainMaterial(theme.ground);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    this.group.add(mesh);
    this.terrain = mesh;
    this.terrainSeg = seg;
    this.disposables.push(geo, mat);
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

  waterNormals() {
    return cached('water:normals', () => {
      const tex = normalFromHeight(fbm(256, 404, 5, 4), 256, 6);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      return tex;
    });
  }

  /** Superficie de agua: espejo con oleaje en calidad alta, PBR animado en el resto. */
  waterMesh(geo, color, { distortion = 3.5 } = {}) {
    const normals = this.waterNormals();
    if (this.quality.reflectiveWater) {
      const water = new Water(geo, {
        textureWidth: 512,
        textureHeight: 512,
        waterNormals: normals,
        sunDirection: this.sunDir.clone(),
        sunColor: this.theme.sun.color,
        waterColor: color,
        distortionScale: distortion,
        fog: true,
      });
      water.material.uniforms.size.value = 2.5;
      this.disposables.push(geo, water.material);
      return { mesh: water, update: (t) => { water.material.uniforms.time.value = t * 0.6; } };
    }
    const tex = normals.clone();
    tex.repeat.set(40, 40);
    tex.needsUpdate = true;
    const mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.05,
      metalness: 0.1,
      transparent: true,
      opacity: 0.9,
      normalMap: tex,
      normalScale: new THREE.Vector2(0.3, 0.3),
      envMapIntensity: 1.4,
    });
    this.disposables.push(geo, mat, tex);
    return { mesh: new THREE.Mesh(geo, mat), update: (t) => { tex.offset.set(t * 0.01, t * 0.006); } };
  }

  buildLake() {
    const { x, z, r, level } = this.lake;
    const geo = new THREE.CircleGeometry(r * 1.45, 64);
    geo.rotateX(-Math.PI / 2);
    const w = this.waterMesh(geo, this.theme.waterColor);
    w.mesh.position.set(x, level, z);
    w.mesh.receiveShadow = true;
    w.mesh.name = 'lake';
    this.group.add(w.mesh);
    this.water = w;
  }

  buildSea() {
    const geo = new THREE.PlaneGeometry(this.size * 1.6, this.size * 1.6);
    geo.rotateX(-Math.PI / 2);
    const w = this.waterMesh(geo, this.theme.waterColor, { distortion: 2.2 });
    w.mesh.position.set(this.center[0], this.theme.seaLevel, this.center[1] + this.size * 0.3);
    w.mesh.name = 'sea';
    this.group.add(w.mesh);
    this.water = w;
  }

  /** Coloca instancias en posiciones válidas según una función de aceptación. */
  scatter(count, seed, accept, { minD, maxD }) {
    const rand = seededRandom(seed);
    const out = [];
    count = Math.round(count);
    const half = Math.min(this.size / 2 - 20, maxD + 300);
    let attempts = 0;
    while (out.length < count && attempts < count * 25) {
      attempts++;
      const x = this.center[0] + (rand() * 2 - 1) * half;
      const z = this.center[1] + (rand() * 2 - 1) * half;
      const { d } = this.nearestTrack(x, z);
      if (d < minD || d > maxD) continue;
      if (!this.dry(x, z)) continue;
      const y = this.terrainHeight(x, z);
      const ny = this.terrainNormalY(x, z);
      if (!accept({ x, z, y, ny, d, rand })) continue;
      out.push({ x, y, z, d, s: 0.7 + rand() * 0.6, r: rand() * Math.PI * 2, v: rand() });
    }
    return out;
  }

  /** Dispersión rápida en una franja junto a la pista (hierba, matorral). */
  scatterNearTrack(count, seed, minOff, maxOff, accept = () => true) {
    const rand = seededRandom(seed);
    const { points, rights, count: n } = this.path;
    const out = [];
    count = Math.round(count);
    let attempts = 0;
    while (out.length < count && attempts < count * 6) {
      attempts++;
      const i = (rand() * n) | 0;
      const side = rand() < 0.5 ? -1 : 1;
      const off = minOff + (maxOff - minOff) * rand() ** 1.6;
      const p = points[i];
      const r = rights[i];
      const x = p[0] + r[0] * off * side + (rand() - 0.5) * 3;
      const z = p[2] + r[2] * off * side + (rand() - 0.5) * 3;
      const { d } = this.nearestTrack(x, z);
      if (d < minOff - 1) continue;
      if (!this.dry(x, z)) continue;
      const y = this.terrainHeight(x, z);
      const ny = this.terrainNormalY(x, z);
      if (!accept({ x, z, y, ny, d, rand })) continue;
      out.push({ x, y, z, d, s: 0.7 + rand() * 0.6, r: rand() * Math.PI * 2, v: rand() });
    }
    return out;
  }

  /** Fuera del agua (lago o mar) con algo de margen. */
  dry(x, z) {
    if (this.lake && Math.hypot(x - this.lake.x, z - this.lake.z) < this.lake.r * 1.15) return false;
    if (this.theme.water === 'sea' && this.terrainHeight(x, z) < this.theme.seaLevel + 0.6) return false;
    return true;
  }

  instanced(geometry, material, items, { castShadow = true, tint, scale } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, items.length));
    mesh.count = items.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const color = new THREE.Color();
    items.forEach((it, i) => {
      q.setFromAxisAngle(up, it.r);
      if (scale) scale(s, it);
      else s.setScalar(it.s);
      p.set(it.x, it.y, it.z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      if (tint) mesh.setColorAt(i, tint(color, it));
    });
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    this.group.add(mesh);
    if (!this.disposables.includes(geometry)) this.disposables.push(geometry);
    if (!this.disposables.includes(material)) this.disposables.push(material);
    return mesh;
  }

  /** Árbol de dos piezas (tronco + copa) con las mismas instancias. */
  plant(model, items, opts = {}) {
    if (!items.length) {
      model.trunk?.geometry.dispose();
      model.trunk?.material.dispose();
      model.crown.geometry.dispose();
      model.crown.material.dispose();
      return;
    }
    if (model.trunk) this.instanced(model.trunk.geometry, model.trunk.material, items, { ...opts, tint: undefined });
    this.instanced(model.crown.geometry, model.crown.material, items, opts);
  }

  buildVegetation() {
    const minD = this.outerOffset + 9;
    const k = this.quality.vegetation;
    const kind = this.theme.vegetation;
    if (kind === 'alpine') this.buildAlpine(minD, k);
    else if (kind === 'desert') this.buildDesert(minD, k);
    else if (kind === 'coast') this.buildCoast(minD, k);
    else if (kind === 'autumn') this.buildAutumn(minD, k);
    if (kind) this.buildRocks(minD, k);
    if (this.theme.grass && this.quality.grass > 0) this.buildGrass();
  }

  /** Bosque de coníferas con versión simplificada para los árboles lejanos. */
  forest(items, opts) {
    const near = items.filter((t) => t.d < 230);
    const far = items.filter((t) => t.d >= 230);
    this.plant(conifer({ ...opts, seed: 1 }), near, { tint: opts.tintFn });
    this.plant(conifer({ ...opts, tiers: 4, seed: 2 }), far, { tint: opts.tintFn, castShadow: false });
  }

  buildAlpine(minD, k) {
    const { snowLine } = this.theme;
    const trees = this.scatter(2600 * k, 7, ({ x, z, y, ny, d, rand }) => {
      if (ny < 0.8 || y > snowLine - 10) return false;
      // Bosques por manchas con claros naturales; más densos lejos de la pista.
      const forest = fbm2(x / 140, z / 140, { seed: 15, octaves: 3 });
      return forest > 0.42 - Math.min(0.12, d / 3000) && rand() < 0.9;
    }, { minD, maxD: 650 });
    trees.forEach((t) => { t.s = 0.7 + t.v * 0.9; });
    const tintFn = (c, it) => c.setHSL(0.3 + it.v * 0.04, 0.18 + it.v * 0.15, 0.62 + it.v * 0.3);
    this.forest(trees.filter((t, i) => i % 3), { tint: [34, 62, 40], tintFn });
    this.forest(trees.filter((t, i) => !(i % 3)), { tint: [48, 74, 38], height: 11, radius: 3, tintFn });
    const bushes = this.scatter(260 * k, 8, ({ ny }) => ny > 0.8, { minD: minD - 4, maxD: 320 });
    this.plant(bush({ palette: ['#3d6b2a', '#4f7d32', '#2f5522'], seed: 11 }), bushes, { castShadow: false });
  }

  buildDesert(minD, k) {
    const cacti = this.scatter(420 * k, 31, ({ ny, rand }) => ny > 0.85 && rand() < 0.8, { minD, maxD: 520 });
    const c = cactus();
    this.instanced(c.geometry, c.material, cacti, { tint: (col, it) => col.setHSL(0.25, 0.2, 0.75 + it.v * 0.35) });
    const bushes = this.scatter(800 * k, 32, ({ ny }) => ny > 0.8, { minD: minD - 3, maxD: 420 });
    bushes.forEach((b) => { b.s = 0.5 + b.v * 0.6; });
    this.plant(bush({ palette: ['#8a7b4a', '#9d8c55', '#6f6a3e'], size: 1.1, seed: 12 }), bushes, { castShadow: false });
  }

  buildCoast(minD, k) {
    const sea = this.theme.seaLevel;
    // Palmeras: en la franja de playa y junto a la pista, en grupos.
    const palms = this.scatter(520 * k, 51, ({ x, z, y, ny, rand }) => {
      if (ny < 0.85 || y > 24) return false;
      const grove = fbm2(x / 90, z / 90, { seed: 52, octaves: 2 });
      return y < sea + 6 ? rand() < 0.75 : grove > 0.5 && rand() < 0.6;
    }, { minD: minD - 2, maxD: 420 });
    palms.forEach((p) => { p.s = 0.8 + p.v * 0.5; });
    this.plant(palm({ seed: 3 }), palms.filter((p, i) => i % 2), {});
    this.plant(palm({ seed: 4, lean: -1.1, height: 9 }), palms.filter((p, i) => !(i % 2)), {});
    // Pinos piñoneros/olivos en las colinas.
    const trees = this.scatter(700 * k, 53, ({ x, z, y, ny }) => ny > 0.82 && y > sea + 4
      && fbm2(x / 130, z / 130, { seed: 54, octaves: 3 }) > 0.45, { minD, maxD: 700 });
    trees.forEach((t) => { t.s = 0.7 + t.v * 0.6; });
    this.plant(broadleaf({ palette: ['#4f6b2c', '#5e7a34', '#3e5a26', '#6b8540'], height: 7, crown: [3.6, 1.8, 3.6], cards: 26, seed: 21 }), trees,
      { tint: (c, it) => c.setHSL(0.2, 0.2, 0.7 + it.v * 0.3) });
    const bushes = this.scatter(500 * k, 55, ({ ny, y }) => ny > 0.8 && y > sea + 1.5, { minD: minD - 4, maxD: 380 });
    this.plant(bush({ palette: ['#46702c', '#5a8436', '#7b9b46'], seed: 13 }), bushes, { castShadow: false });
  }

  buildAutumn(minD, k) {
    const pick = (seed, count, density) => this.scatter(count * k, seed, ({ x, z, ny, d, rand }) => {
      if (ny < 0.8) return false;
      const forest = fbm2(x / 120, z / 120, { seed: 61, octaves: 3 });
      return forest > density - Math.min(0.1, d / 3000) && rand() < 0.9;
    }, { minD, maxD: 620 });
    const maples = pick(71, 1300, 0.4);
    maples.forEach((t) => { t.s = 0.75 + t.v * 0.6; });
    const tint = (c, it) => c.setHSL(0.05, 0.15, 0.75 + it.v * 0.3);
    this.plant(broadleaf({ palette: ['#c2381c', '#d9541f', '#a8281a', '#e07a26'], shape: 'maple', height: 10, crown: [3.4, 3, 3.4], seed: 31 }),
      maples.filter((t, i) => i % 2), { tint });
    this.plant(broadleaf({ palette: ['#e39a2a', '#f0b531', '#c9771f', '#d4a03a'], shape: 'maple', height: 9, crown: [3.2, 2.8, 3.2], seed: 32 }),
      maples.filter((t, i) => !(i % 2)), { tint });
    const birches = pick(72, 700, 0.46);
    birches.forEach((t) => { t.s = 0.8 + t.v * 0.5; });
    this.plant(broadleaf({ palette: ['#f2cc3a', '#e8b72c', '#f7dc6a', '#c9a227'], bark: 'birch', height: 12, crown: [2.2, 3.4, 2.2], cards: 24, seed: 33 }),
      birches, { tint });
    const pines = pick(73, 450, 0.5);
    pines.forEach((t) => { t.s = 0.7 + t.v * 0.8; });
    this.forest(pines, { tint: [30, 56, 36], tintFn: (c, it) => c.setHSL(0.3, 0.15, 0.6 + it.v * 0.3) });
    const bushes = this.scatter(500 * k, 74, ({ ny }) => ny > 0.8, { minD: minD - 4, maxD: 360 });
    this.plant(bush({ palette: ['#b5461f', '#cf7a2a', '#8f3a1b', '#d8a03c'], shape: 'maple', seed: 14 }), bushes, { castShadow: false });
  }

  buildRocks(minD, k) {
    const geo = new THREE.DodecahedronGeometry(1, 2);
    const pos = geo.attributes.position;
    const rand = seededRandom(11);
    // Deformación coherente (por posición) para rocas irregulares sin grietas.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i); const y = pos.getY(i); const z = pos.getZ(i);
      const n = 1 + (fbm2(x * 1.3 + 5, z * 1.3 + y * 0.7, { seed: 7, octaves: 3 }) - 0.5) * 0.7;
      pos.setXYZ(i, x * n * 1.4, y * n * 0.8, z * n * 1.1);
    }
    rand();
    geo.computeVertexNormals();
    const desert = this.theme.vegetation === 'desert';
    const tex = surfaceTextures(desert ? 'redrock' : 'rock');
    const mat = new THREE.MeshStandardMaterial({ map: tex.map, normalMap: tex.normalMap, roughness: 0.92 });
    const rocks = this.scatter((desert ? 500 : 350) * Math.max(0.6, k), 41, ({ rand: r }) => r() < 0.9, { minD, maxD: 500 });
    rocks.forEach((r) => { r.s = 0.4 + r.v * r.v * 3.5; r.y -= r.s * 0.25; });
    this.instanced(geo, mat, rocks, { tint: (c, it) => c.setHSL(0.08, 0.1, 0.75 + it.v * 0.3) });
  }

  /** Matas de hierba en los márgenes de la pista: la diferencia más visible a ras de suelo. */
  buildGrass() {
    const g = this.quality.grass;
    const tuft = grassTuft(this.theme.grass);
    const sea = this.theme.seaLevel ?? -Infinity;
    const items = this.scatterNearTrack(9000 * g, 81, this.outerOffset + 0.8, this.outerOffset + 70, ({ ny, y }) => ny > 0.75 && y > sea + 1.5);
    items.forEach((it) => { it.s = 0.6 + it.v * 0.9; });
    this.instanced(tuft.geometry, tuft.material, items, {
      castShadow: false,
      tint: (c, it) => c.setRGB(0.85 + it.v * 0.3, 0.85 + it.v * 0.3, 0.85 + it.v * 0.2),
    });
  }

  buildProps() {
    const kind = this.theme.props;
    if (kind === 'coast') this.buildCoastProps();
    else if (kind === 'city') this.buildCity();
    else if (kind === 'cabin' || kind === 'chalet') this.buildCabins(kind === 'chalet' ? 'chalet' : 'cabin');
  }

  houses(style, items) {
    const h = houseMeshes(style);
    const scale = (s, it) => s.set(it.w, it.h, it.l);
    this.instanced(h.walls.geometry, h.walls.material, items, { scale });
    this.instanced(h.roof.geometry, h.roof.material, items, { scale });
  }

  buildCoastProps() {
    const sea = this.theme.seaLevel;
    const homes = this.scatter(70, 91, ({ x, z, y, ny }) => ny > 0.9 && y > sea + 3
      && fbm2(x / 160, z / 160, { seed: 92, octaves: 2 }) > 0.48, { minD: this.outerOffset + 18, maxD: 420 });
    homes.forEach((it) => {
      it.w = 6 + it.v * 5;
      it.l = 6 + ((it.v * 7.3) % 1) * 5;
      it.h = 4 + ((it.v * 3.1) % 1) * 3.5;
      it.y -= 0.6;
      it.r = Math.round(it.r / (Math.PI / 2)) * (Math.PI / 2) + (it.v - 0.5) * 0.3;
    });
    this.houses('med', homes);
    // Faro en el punto de costa más saliente cerca de la pista.
    let best = null;
    for (let x = this.trackBounds.minX - 150; x <= this.trackBounds.maxX + 150; x += 10) {
      const shoreZ = this.theme.shore(x) - 10;
      const { d } = this.nearestTrack(x, shoreZ);
      if (d < this.outerOffset + 25 || d > 220) continue;
      const y = this.terrainHeight(x, shoreZ);
      if (y < sea + 1) continue;
      if (!best || shoreZ > best.z) best = { x, z: shoreZ, y };
    }
    if (best) {
      const lh = lighthouse();
      lh.position.set(best.x, best.y - 0.3, best.z);
      this.group.add(lh);
      lh.traverse((o) => { if (o.isMesh) this.disposables.push(o.geometry, o.material); });
    }
    // Veleros fondeados.
    const rand = seededRandom(93);
    const boat = sailboat();
    for (let i = 0; i < 9; i++) {
      const x = this.center[0] + (rand() - 0.5) * 900;
      const z = this.theme.shore(x) + 90 + rand() * 450;
      const b = boat.clone();
      b.position.set(x, sea, z);
      b.rotation.y = rand() * Math.PI * 2;
      b.scale.setScalar(1 + rand() * 0.5);
      this.group.add(b);
    }
    boat.traverse((o) => { if (o.isMesh) this.disposables.push(o.geometry, o.material); });
  }

  buildCabins(style) {
    const homes = this.scatter(26, 95, ({ ny, y }) => ny > 0.92 && y < (this.theme.snowLine ?? 999) - 20, { minD: this.outerOffset + 25, maxD: 380 });
    homes.forEach((it) => {
      it.w = 7 + it.v * 4;
      it.l = 9 + ((it.v * 5.3) % 1) * 4;
      it.h = 3.5 + ((it.v * 3.7) % 1) * 2;
      it.y -= 0.5;
    });
    this.houses(style, homes);
  }

  /**
   * Ciudad: manzanas de edificios en rejilla fuera de las aceras, más altos
   * lejos de la pista; farolas con charcos de luz a ambos lados y rótulos
   * de neón en las fachadas que dan al circuito.
   */
  buildCity() {
    const rand = seededRandom(101);
    const { minX, maxX, minZ, maxZ } = this.trackBounds;
    const items = [];
    const step = 30;
    for (let x = minX - 520; x <= maxX + 520; x += step) {
      for (let z = minZ - 520; z <= maxZ + 520; z += step) {
        const w = 14 + rand() * 12;
        const l = 14 + rand() * 12;
        const cx = x + (rand() - 0.5) * 4;
        const cz = z + (rand() - 0.5) * 4;
        const { d } = this.nearestTrack(cx, cz);
        const clearance = this.outerOffset + 7 + Math.hypot(w, l) / 2;
        if (d < clearance) continue;
        const far = smoothstep(60, 420, d);
        const tall = rand();
        const h = 12 + tall * tall * (30 + far * 150) + far * 20;
        const y = this.terrainHeight(cx, cz) - 0.5;
        items.push({ x: cx, y, z: cz, w, l, h, d, r: 0, v: rand(), s: 1 });
      }
    }
    const box = new THREE.BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const palette = ['#5b5f66', '#6d6a63', '#4a5058', '#7a7c80', '#3e434a', '#8a8378'];
    this.instanced(box, buildingMaterial({ night: !!this.theme.night }), items, {
      scale: (s, it) => s.set(it.w, it.h, it.l),
      tint: (c, it) => c.set(palette[(it.v * palette.length) | 0]),
    });

    // Farolas a ambos lados del trazado y su luz sobre el asfalto.
    const lamp = streetLampMeshes();
    const lamps = [];
    const pools = [];
    const { points, rights, tangents, count, step: ps } = this.path;
    const every = Math.round(32 / ps);
    for (let i = 0; i < count; i += every) {
      for (const side of [-1, 1]) {
        const off = this.outerOffset + 1.4;
        const p = points[(i + (side > 0 ? Math.round(every / 2) : 0)) % count];
        const r = rights[(i + (side > 0 ? Math.round(every / 2) : 0)) % count];
        const t = tangents[(i + (side > 0 ? Math.round(every / 2) : 0)) % count];
        const x = p[0] + r[0] * off * side;
        const z = p[2] + r[2] * off * side;
        if (this.nearestTrack(x, z).d < this.outerOffset) continue;
        // El brazo (eje -X local) apunta hacia la pista.
        const yaw = Math.atan2(t[0], t[2]) + (side > 0 ? Math.PI : 0);
        lamps.push({ x, y: p[1], z, r: yaw, s: 1, v: 0 });
        pools.push({ x: p[0] + r[0] * (off - 7.5) * side, y: p[1] + 0.03, z: p[2] + r[2] * (off - 7.5) * side, r: 0, s: 1, v: 0 });
      }
    }
    this.instanced(lamp.pole.geometry, lamp.pole.material, lamps, { castShadow: false });
    this.instanced(lamp.lens.geometry, lamp.lens.material, lamps, { castShadow: false });
    const poolGeo = new THREE.PlaneGeometry(16, 16);
    poolGeo.rotateX(-Math.PI / 2);
    const pool = this.instanced(poolGeo, lightPoolMaterial(), pools, { castShadow: false });
    pool.receiveShadow = false;
    pool.renderOrder = 1;

    // Neones en las fachadas más cercanas, mirando a la pista.
    const signs = ['RUNRUN', 'HOTEL', 'NEON', '24H', 'BAR', 'TURBO', 'CAFE', 'PIT STOP', 'GARAGE', 'CLUB'];
    const colors = ['#ff2d95', '#22e4ff', '#ffd23a', '#7dff5a', '#b06bff', '#ff5a36'];
    const near = items.filter((b) => b.d < this.outerOffset + 60).sort((a, b) => a.d - b.d).slice(0, 26);
    const signGeo = new THREE.PlaneGeometry(1, 0.3125);
    this.disposables.push(signGeo);
    near.forEach((b, i) => {
      const tex = neonSign(signs[i % signs.length], colors[(i * 7) % colors.length], i + 1);
      const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: true });
      mat.color.setScalar(1.6);
      this.disposables.push(mat);
      const sign = new THREE.Mesh(signGeo, mat);
      // Cara de la caja que mira hacia el punto de pista más cercano.
      let bi = 0; let bd = Infinity;
      for (let k = 0; k < this.tx.length; k++) {
        const dd = (this.tx[k] - b.x) ** 2 + (this.tz[k] - b.z) ** 2;
        if (dd < bd) { bd = dd; bi = k; }
      }
      const dx = this.tx[bi] - b.x;
      const dz = this.tz[bi] - b.z;
      const alongX = Math.abs(dx) / b.w > Math.abs(dz) / b.l;
      const nx = alongX ? Math.sign(dx) : 0;
      const nz = alongX ? 0 : Math.sign(dz);
      const width = Math.min(alongX ? b.l : b.w, 12) * 0.85;
      sign.scale.setScalar(width);
      sign.position.set(b.x + nx * (b.w / 2 + 0.15), b.y + Math.min(b.h - 3, 7 + (i % 3) * 4), b.z + nz * (b.l / 2 + 0.15));
      sign.rotation.y = Math.atan2(nx, nz);
      this.group.add(sign);
    });
  }

  update(time) {
    windUniforms.uTime.value = time;
    this.water?.update(time);
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.group.clear();
  }
}
