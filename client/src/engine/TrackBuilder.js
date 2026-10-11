// Construye la pista 3D (asfalto, pianos, líneas, muros, gradas, árboles) y sus colisionadores
// a partir de la línea central real del circuito.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { assets, TEXTURES } from './Assets.js';

const RUNOFF = 11; // metros de escapatoria entre el borde del asfalto y el muro
const WALL_H = 1.1;
const WALL_T = 0.6;

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}

/**
 * Cinta a lo largo de la línea central entre dos desplazamientos laterales.
 * `filter(i)` permite generar solo ciertos tramos. `uScale`/`vScale` en metros por repetición.
 */
function ribbon(layout, inner, outer, y, { filter = null, vScale = 8, uAcross = 1, closed = true } = {}) {
  const pos = [], uv = [], idx = [];
  const n = layout.n;
  let prevOk = false;
  let vert = 0;
  const push = (i) => {
    const rx = -layout.vtz[i], rz = layout.vtx[i];
    const x = layout.x[i], z = layout.z[i];
    // Compensa el estrechamiento en curva usando la normal media.
    pos.push(x + rx * inner, y, z + rz * inner, x + rx * outer, y, z + rz * outer);
    const v = layout.cum[i] / vScale;
    uv.push(0, v, uAcross, v);
    vert += 2;
  };
  const count = closed ? n + 1 : n;
  for (let k = 0; k < count; k++) {
    const i = k % n;
    const ok = !filter || filter(i);
    if (ok) {
      push(i);
      if (prevOk) {
        const a = vert - 4, b = vert - 3, c = vert - 2, d = vert - 1;
        idx.push(a, b, c, b, d, c);
      }
      if (k === n) { // último vértice: v continúa para no romper la textura
        uv[uv.length - 3] = uv[uv.length - 1] = layout.length / vScale;
      }
    }
    prevOk = ok;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Muro extruido a lo largo de una polilínea. */
function wallGeometry(points, closed, height, thickness) {
  const pos = [], uv = [], idx = [];
  const m = points.length;
  const count = closed ? m + 1 : m;
  let dist = 0;
  for (let k = 0; k < count; k++) {
    const p = points[k % m];
    const prev = points[(k - 1 + m) % m], next = points[(k + 1) % m];
    let tx = (closed || k < m - 1 ? next[0] : p[0]) - (closed || k > 0 ? prev[0] : p[0]);
    let tz = (closed || k < m - 1 ? next[1] : p[1]) - (closed || k > 0 ? prev[1] : p[1]);
    const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const nx = -tz * thickness / 2, nz = tx * thickness / 2;
    if (k > 0) dist += Math.hypot(p[0] - points[(k - 1) % m][0], p[1] - points[(k - 1) % m][1]);
    const u = dist / 4;
    // 4 vértices por sección: base izq, arriba izq, arriba der, base der
    pos.push(p[0] - nx, 0, p[1] - nz, p[0] - nx, height, p[1] - nz, p[0] + nx, height, p[1] + nz, p[0] + nx, 0, p[1] + nz);
    uv.push(u, 0, u, height / 4, u, height / 4 + 0.15, u, 0);
    if (k > 0) {
      const a = (k - 1) * 4, b = k * 4;
      for (let f = 0; f < 3; f++) {
        idx.push(a + f, b + f, a + f + 1, a + f + 1, b + f, b + f + 1);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export async function buildTrack(layout, physics, { quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = `track-${layout.id}`;
  const disposables = [];
  const track = (o) => { disposables.push(o); return o; };
  const rand = mulberry32(layout.n * 7919);

  const [aDiff, aNor, aRough, gDiff, gNor, cDiff] = await Promise.all([
    assets.texture(TEXTURES.asphaltDiff, { color: true }),
    assets.texture(TEXTURES.asphaltNor),
    assets.texture(TEXTURES.asphaltRough),
    assets.texture(TEXTURES.grassDiff, { color: true }),
    assets.texture(TEXTURES.grassNor),
    assets.texture(TEXTURES.concreteDiff, { color: true }),
  ]);

  const hw = layout.halfWidth;
  const { minX, maxX, minZ, maxZ } = layout.bounds;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const groundSize = Math.max(maxX - minX, maxZ - minZ) + 1600;

  // ---------- Césped ----------
  {
    const seg = 160;
    const geo = track(new THREE.PlaneGeometry(groundSize, groundSize, seg, seg));
    geo.rotateX(-Math.PI / 2);
    geo.translate(cx, 0, cz);
    const p = geo.attributes.position;
    const colors = new Float32Array(p.count * 3);
    const uvs = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const n = 0.5 + 0.25 * Math.sin(x * 0.013 + Math.sin(z * 0.007) * 2) + 0.25 * Math.sin(z * 0.011 + Math.cos(x * 0.009) * 2);
      const tone = 0.72 + n * 0.32;
      colors[i * 3] = tone * 0.72; colors[i * 3 + 1] = tone * 0.92; colors[i * 3 + 2] = tone * 0.55;
      uvs.setXY(i, x / 7, z / 7);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = track(new THREE.MeshStandardMaterial({
      map: gDiff, normalMap: gNor, normalScale: new THREE.Vector2(0.6, 0.6), vertexColors: true, roughness: 0.95, metalness: 0,
    }));
    const ground = new THREE.Mesh(geo, mat);
    ground.receiveShadow = true;
    group.add(ground);
  }

  // ---------- Asfalto ----------
  {
    const geo = track(ribbon(layout, -hw - 0.6, hw + 0.6, 0.02, { vScale: 10, uAcross: (layout.width + 1.2) / 10 }));
    const mat = track(new THREE.MeshStandardMaterial({
      map: aDiff, normalMap: aNor, roughnessMap: aRough, color: 0xffffff, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    }));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // ---------- Líneas blancas de borde ----------
  {
    const mat = track(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    for (const side of [-1, 1]) {
      const a = side * (hw - 0.55), b = side * (hw - 0.3);
      const geo = track(ribbon(layout, Math.min(a, b), Math.max(a, b), 0.025));
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------- Pianos (en curvas) ----------
  {
    const kerbTex = track(canvasTexture(64, 256, (ctx, w, h) => {
      ctx.fillStyle = '#d61f1f'; ctx.fillRect(0, 0, w, h / 2);
      ctx.fillStyle = '#f3f3f3'; ctx.fillRect(0, h / 2, w, h / 2);
    }));
    const curved = new Uint8Array(layout.n);
    for (let i = 0; i < layout.n; i++) {
      if (Math.abs(layout.curvature[i]) > 1 / 180) {
        for (let k = -6; k <= 6; k++) curved[(i + k + layout.n) % layout.n] = 1;
      }
    }
    const mat = track(new THREE.MeshStandardMaterial({ map: kerbTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    for (const side of [-1, 1]) {
      const a = side * (hw + 0.05), b = side * (hw + 1.45);
      const geo = track(ribbon(layout, Math.min(a, b), Math.max(a, b), 0.04, { filter: (i) => curved[i] === 1, vScale: 4 }));
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      group.add(m);
    }
  }

  // ---------- Línea de meta y parrilla ----------
  {
    const checker = track(canvasTexture(256, 64, (ctx, w, h) => {
      const s = 16;
      for (let x = 0; x < w; x += s) for (let y = 0; y < h; y += s) {
        ctx.fillStyle = ((x + y) / s) % 2 === 0 ? '#111' : '#f5f5f5';
        ctx.fillRect(x, y, s, s);
      }
    }));
    const start = layout.sampleAt(0);
    const yaw = Math.atan2(start.tx, start.tz);
    const line = new THREE.Mesh(
      track(new THREE.PlaneGeometry(layout.width, 2)),
      track(new THREE.MeshStandardMaterial({ map: checker, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 })),
    );
    line.rotation.order = 'YXZ';
    line.rotation.set(-Math.PI / 2, yaw, 0);
    line.position.set(start.x, 0.03, start.z);
    line.receiveShadow = true;
    group.add(line);

    const slotMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const slotGeo = track(new THREE.PlaneGeometry(2.4, 0.25));
    for (const slot of layout.gridSlots(8)) {
      const m = new THREE.Mesh(slotGeo, slotMat);
      m.rotation.order = 'YXZ';
      m.rotation.set(-Math.PI / 2, slot.yaw, 0);
      const p = layout.offsetPoint(slot.s + 2.6, 0);
      m.position.set(slot.x + p.tx * 2.6, 0.03, slot.z + p.tz * 2.6);
      group.add(m);
    }
  }

  // ---------- Muros (visual + física) ----------
  const barrierLines = layout.barrierLines(hw + RUNOFF, 2);
  {
    const mat = track(new THREE.MeshStandardMaterial({ map: cDiff, color: 0xd8d8d8, roughness: 0.85, side: THREE.DoubleSide }));
    const tyreMat = track(new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.95, side: THREE.DoubleSide }));
    for (const line of barrierLines) {
      const geo = track(wallGeometry(line.points, line.closed, WALL_H, WALL_T));
      const wall = new THREE.Mesh(geo, mat);
      wall.castShadow = quality !== 'low';
      wall.receiveShadow = true;
      group.add(wall);
      // Franja de neumáticos/goma oscura en la base, típica de circuito.
      const band = new THREE.Mesh(track(wallGeometry(line.points, line.closed, 0.35, WALL_T + 0.08)), tyreMat);
      group.add(band);
      const pts = line.points;
      const segs = line.closed ? pts.length : pts.length - 1;
      for (let k = 0; k < segs; k++) {
        const a = pts[k], b = pts[(k + 1) % pts.length];
        physics.addWall(a[0], a[1], b[0], b[1], WALL_H + 0.4, WALL_T);
      }
    }
  }
  physics.addGround(groundSize / 2);

  // ---------- Pórtico de salida con semáforo ----------
  const startLights = [];
  {
    const s = layout.sampleAt(-6);
    const yaw = Math.atan2(s.tx, s.tz);
    const gantry = new THREE.Group();
    gantry.position.set(s.x, 0, s.z);
    gantry.rotation.y = yaw;
    const metal = track(new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.7, roughness: 0.4 }));
    const span = layout.width + 4;
    const pillarGeo = track(new THREE.BoxGeometry(0.6, 7.5, 0.6));
    for (const side of [-1, 1]) {
      const p = new THREE.Mesh(pillarGeo, metal);
      p.position.set(side * span / 2, 3.75, 0);
      p.castShadow = true;
      gantry.add(p);
    }
    const beam = new THREE.Mesh(track(new THREE.BoxGeometry(span, 1.3, 0.8)), metal);
    beam.position.set(0, 7.2, 0);
    beam.castShadow = true;
    gantry.add(beam);
    const lightGeo = track(new THREE.CircleGeometry(0.32, 20));
    for (let i = 0; i < 5; i++) {
      const mat = track(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff0000, emissiveIntensity: 0 }));
      const l = new THREE.Mesh(lightGeo, mat);
      l.position.set((i - 2) * 1.0, 7.2, -0.41);
      l.rotation.y = Math.PI;
      gantry.add(l);
      startLights.push(mat);
    }
    group.add(gantry);
  }

  // ---------- Gradas y edificio de boxes junto a la recta ----------
  {
    const crowdTex = track(canvasTexture(512, 128, (ctx, w, h) => {
      ctx.fillStyle = '#3a3f47'; ctx.fillRect(0, 0, w, h);
      const palette = ['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#003049', '#2a9d8f', '#e9c46a', '#ffffff', '#264653'];
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = palette[(Math.random() * palette.length) | 0];
        ctx.fillRect(Math.random() * w, Math.random() * h, 3, 4);
      }
    }));
    const standMat = track(new THREE.MeshStandardMaterial({ map: crowdTex, roughness: 0.9 }));
    const roofMat = track(new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.3, roughness: 0.5 }));
    const concreteMat = track(new THREE.MeshStandardMaterial({ map: cDiff, color: 0xc9c9c9, roughness: 0.9 }));
    const glassMat = track(new THREE.MeshStandardMaterial({ color: 0x223344, metalness: 0.6, roughness: 0.15 }));

    const placeAlong = (s, lateral, length) => {
      // Comprueba que no invade otro tramo de pista.
      for (let d = -length / 2; d <= length / 2; d += 10) {
        const p = layout.offsetPoint(s + d, lateral);
        for (const extra of [-8, 8]) {
          const q = layout.offsetPoint(s + d, lateral + extra);
          if (layout.nearestGlobal(q.x, q.z).d2 < (hw + RUNOFF + 2) ** 2) return null;
        }
        if (layout.nearestGlobal(p.x, p.z).d2 < (hw + RUNOFF + 2) ** 2) return null;
      }
      const p = layout.offsetPoint(s, lateral);
      return { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
    };

    const standGeo = (() => {
      // Grada escalonada: perfil extruido.
      const shape = new THREE.Shape();
      shape.moveTo(0, 0);
      for (let i = 0; i < 8; i++) { shape.lineTo(i * 1.6, 1 + i * 1.1); shape.lineTo((i + 1) * 1.6, 1 + i * 1.1); }
      shape.lineTo(8 * 1.6, 0);
      shape.lineTo(0, 0);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 60, bevelEnabled: false });
      g.translate(0, 0, -30);
      return track(g);
    })();
    const side = 1; // gradas a un lado, boxes al otro
    for (const s of [-40, 40, 110]) {
      const at = placeAlong(s, side * (hw + RUNOFF + 4), 64);
      if (!at) continue;
      const stand = new THREE.Group();
      stand.position.set(at.x, 0, at.z);
      stand.rotation.y = at.yaw;
      const body = new THREE.Mesh(standGeo, standMat);
      // El perfil crece alejándose de la pista (hacia -x local = derecha del trazado).
      body.rotation.y = side > 0 ? Math.PI : 0;
      body.castShadow = true;
      body.receiveShadow = true;
      stand.add(body);
      const roof = new THREE.Mesh(track(new THREE.BoxGeometry(14, 0.3, 62)), roofMat);
      roof.position.set(-side * 6.5, 11.5, 0);
      roof.castShadow = true;
      stand.add(roof);
      group.add(stand);
    }
    const pits = placeAlong(30, -side * (hw + RUNOFF + 9), 150);
    if (pits) {
      const b = new THREE.Group();
      b.position.set(pits.x, 0, pits.z);
      b.rotation.y = pits.yaw;
      const box = new THREE.Mesh(track(new THREE.BoxGeometry(14, 8, 150)), concreteMat);
      box.position.y = 4;
      box.castShadow = true;
      box.receiveShadow = true;
      b.add(box);
      const windows = new THREE.Mesh(track(new THREE.BoxGeometry(14.2, 2.2, 146)), glassMat);
      windows.position.y = 5.6;
      b.add(windows);
      group.add(b);
    }
  }

  // ---------- Árboles (instanciados) ----------
  {
    const count = quality === 'low' ? 500 : quality === 'medium' ? 1200 : 2200;
    const trunkGeo = track(new THREE.CylinderGeometry(0.16, 0.3, 3.4, 7));
    trunkGeo.translate(0, 1.7, 0);
    // Copa frondosa: varias esferas deformadas con ruido, fusionadas.
    const lumpy = (r, x, y, z, seed) => {
      const g = new THREE.IcosahedronGeometry(r, 2);
      const p = g.attributes.position;
      const rr = mulberry32(seed);
      const phase = [rr() * 6, rr() * 6, rr() * 6];
      for (let i = 0; i < p.count; i++) {
        const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
        const n = 1 + 0.16 * Math.sin(vx * 2.1 + phase[0]) * Math.sin(vy * 2.7 + phase[1]) + 0.1 * Math.sin(vz * 3.3 + phase[2]);
        p.setXYZ(i, vx * n + x, vy * n * 0.9 + y, vz * n + z);
      }
      return g;
    };
    const crownGeo = track(mergeGeometries([
      lumpy(2.1, 0, 4.6, 0, 1), lumpy(1.6, 1.2, 4.1, 0.5, 2), lumpy(1.5, -1.0, 4.3, -0.6, 3), lumpy(1.4, 0.2, 5.9, -0.3, 4),
    ].map((g) => { g.deleteAttribute('uv'); return g; })));
    crownGeo.computeVertexNormals();
    const pineGeo = track(mergeGeometries([
      [2.3, 3.2, 3.2], [1.8, 2.8, 4.9], [1.25, 2.4, 6.4], [0.7, 1.8, 7.7],
    ].map(([r, h, y]) => { const c = new THREE.ConeGeometry(r, h, 10, 1, true); c.translate(0, y, 0); c.deleteAttribute('uv'); return c; })));
    const trunkMat = track(new THREE.MeshStandardMaterial({ color: 0x3d2b1f, roughness: 1 }));
    const leafMat = track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }));
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, count);
    const crowns = new THREE.InstancedMesh(crownGeo, leafMat, count);
    const pines = new THREE.InstancedMesh(pineGeo, leafMat, count);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
    const col = new THREE.Color();
    let nRound = 0, nPine = 0, nT = 0;
    const range = Math.max(maxX - minX, maxZ - minZ) / 2 + 400;
    for (let tries = 0; tries < count * 6 && nT < count; tries++) {
      // Agrupados: más densidad cerca (pero fuera) de la pista.
      const x = cx + (rand() * 2 - 1) * range;
      const z = cz + (rand() * 2 - 1) * range;
      const d = Math.sqrt(layout.nearestGlobal(x, z).d2);
      if (d < hw + RUNOFF + 8) continue;
      if (rand() > Math.min(1, 160 / d) + 0.08) continue;
      const s = 0.8 + rand() * 0.7;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * Math.PI * 2);
      sc.set(s, s * (0.85 + rand() * 0.4), s);
      ps.set(x, 0, z);
      m4.compose(ps, q, sc);
      trunks.setMatrixAt(nT++, m4);
      col.setHSL(0.24 + rand() * 0.07, 0.35 + rand() * 0.2, 0.11 + rand() * 0.07);
      if (rand() < 0.45) { pines.setMatrixAt(nPine, m4); pines.setColorAt(nPine++, col); }
      else { crowns.setMatrixAt(nRound, m4); crowns.setColorAt(nRound++, col); }
    }
    trunks.count = nT; crowns.count = nRound; pines.count = nPine;
    for (const im of [trunks, crowns, pines]) {
      im.castShadow = quality === 'high';
      im.receiveShadow = false;
      im.frustumCulled = false;
      group.add(im);
    }
  }

  return {
    group,
    startLights,
    groundSize,
    dispose() {
      disposables.forEach((d) => d.dispose?.());
      group.removeFromParent();
    },
  };
}
