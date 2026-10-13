import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { cached, makeCanvas, toTexture } from '../textures.js';
import { seededRandom } from './noise.js';

/**
 * Vegetación procedural con texturas recortadas (alpha) en lugar de conos
 * lisos: pinos con capas de ramas y acículas, frondosos con copas de racimos
 * de hojas y normales esféricas (luz volumétrica), palmeras con hojas
 * curvadas, matas de hierba y cactus acanalados. Todo se instancia y se mece
 * con el viento en el vertex shader.
 */

/** Tiempo compartido por todos los materiales con viento. */
export const windUniforms = { uTime: { value: 0 } };

/** Añade balanceo por viento a un material (más fuerte cuanto más alto el vértice). */
export function windify(material, amp = 1, { scale = 0.04, stiff = 0 } = {}) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec2 ip = vec2(0.0);
          #ifdef USE_INSTANCING
            ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
          #endif
          float h = max(0.0, position.y - ${stiff.toFixed(2)});
          float s = sin(uTime * 1.6 + ip.x * 0.07 + ip.y * 0.05) * 0.6 + sin(uTime * 3.1 + ip.x * 0.13 + position.x) * 0.25;
          transformed.x += s * h * h * ${(scale * amp).toFixed(4)};
          transformed.z += s * h * h * ${(scale * amp * 0.6).toFixed(4)};
        }`);
  };
  material.customProgramCacheKey = () => `wind${amp}${scale}${stiff}`;
  return material;
}

function rgba(c, a = 1) {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
}

function jitterColor(c, rand, amt) {
  const k = 1 + (rand() - 0.5) * amt;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** Ramas de conífera vistas de lado: hebras con acículas y borde inferior irregular. */
export function coniferTexture(tint = [38, 66, 40]) {
  return cached(`fol:conifer:${tint}`, () => {
    const S = 256;
    const canvas = makeCanvas(S);
    const g = canvas.getContext('2d');
    const rand = seededRandom(5);
    // Masa interior oscura (da cuerpo y evita transparencias excesivas).
    const grad = g.createLinearGradient(0, 0, 0, S);
    grad.addColorStop(0, rgba(tint.map((v) => v * 1.15)));
    grad.addColorStop(1, rgba(tint.map((v) => v * 0.55)));
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S * 0.72);
    for (let i = 0; i < 70; i++) {
      const x = rand() * S;
      const len = S * (0.65 + rand() * 0.33);
      const c = jitterColor(tint, rand, 0.6);
      g.strokeStyle = rgba(c.map((v) => v * 0.7));
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + (rand() - 0.5) * 10, len);
      g.stroke();
      // Acículas: trazos cortos hacia fuera y abajo.
      for (let y = 4; y < len; y += 3) {
        const cc = jitterColor(tint, rand, 0.7).map((v, k) => v * (0.8 + (y / len) * 0.5) + (k === 1 ? 6 : 0));
        g.strokeStyle = rgba(cc);
        g.lineWidth = 1.2;
        const xx = x + ((rand() - 0.5) * 10 * y) / len;
        g.beginPath();
        g.moveTo(xx, y);
        g.lineTo(xx - 5 - rand() * 4, y + 5 + rand() * 4);
        g.moveTo(xx, y);
        g.lineTo(xx + 5 + rand() * 4, y + 5 + rand() * 4);
        g.stroke();
      }
    }
    const tex = toTexture(canvas);
    tex.repeat.set(3, 1);
    return tex;
  });
}

/** Racimo de hojas para copas de frondosos (paleta según especie y estación). */
export function leafClusterTexture(palette, seed = 1, shape = 'oval') {
  return cached(`fol:leaves:${palette.join('|')}:${seed}:${shape}`, () => {
    const S = 256;
    const canvas = makeCanvas(S);
    const g = canvas.getContext('2d');
    const rand = seededRandom(seed);
    const cols = palette.map((h) => new THREE.Color(h));
    // Ramitas.
    g.strokeStyle = 'rgba(60,45,30,1)';
    g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      g.beginPath();
      g.moveTo(S / 2, S / 2);
      const a = rand() * Math.PI * 2;
      g.lineTo(S / 2 + Math.cos(a) * S * 0.4, S / 2 + Math.sin(a) * S * 0.4);
      g.stroke();
    }
    const n = 340;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const r = Math.sqrt(rand()) * S * 0.44;
      const a = rand() * Math.PI * 2;
      const x = S / 2 + Math.cos(a) * r;
      const y = S / 2 + Math.sin(a) * r;
      const c = cols[(rand() * cols.length) | 0];
      // Las de atrás (primeras) más oscuras: profundidad dentro del racimo.
      const k = 0.55 + t * 0.6 + (rand() - 0.5) * 0.15;
      g.fillStyle = `rgb(${(c.r * 255 * k) | 0},${(c.g * 255 * k) | 0},${(c.b * 255 * k) | 0})`;
      g.save();
      g.translate(x, y);
      g.rotate(rand() * Math.PI * 2);
      const sz = 7 + rand() * 6;
      g.beginPath();
      if (shape === 'maple') {
        for (let p = 0; p < 10; p++) {
          const aa = (p / 10) * Math.PI * 2;
          const rr = p % 2 ? sz * 0.45 : sz;
          g.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr);
        }
      } else {
        g.ellipse(0, 0, sz, sz * 0.5, 0, 0, Math.PI * 2);
      }
      g.fill();
      g.restore();
    }
    return toTexture(canvas);
  });
}

/** Hoja de palmera: raquis central con foliolos colgantes. */
export function palmFrondTexture() {
  return cached('fol:palm', () => {
    const W = 512;
    const H = 128;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    const rand = seededRandom(9);
    for (let x = 6; x < W - 6; x += 5) {
      const t = x / W;
      const len = (H / 2 - 4) * (1 - t * 0.75) * (0.85 + rand() * 0.15);
      for (const s of [-1, 1]) {
        const c = [40 + rand() * 30, 90 + rand() * 40, 30 + rand() * 20];
        g.strokeStyle = rgba(c);
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x, H / 2);
        g.quadraticCurveTo(x + 8, H / 2 + s * len * 0.6, x + 16, H / 2 + s * len);
        g.stroke();
      }
    }
    g.strokeStyle = 'rgb(120,110,60)';
    g.lineWidth = 4;
    g.beginPath();
    g.moveTo(0, H / 2);
    g.lineTo(W, H / 2);
    g.stroke();
    return toTexture(canvas);
  });
}

/** Mata de hierba: hojas finas que se aclaran hacia la punta. */
export function grassTexture(kind = 'green') {
  return cached(`fol:grass:${kind}`, () => {
    const S = 128;
    const canvas = makeCanvas(S);
    const g = canvas.getContext('2d');
    const rand = seededRandom(kind.length * 7);
    const base = { green: [52, 86, 30], dry: [130, 116, 62], lush: [46, 98, 36], autumn: [110, 102, 46] }[kind];
    for (let i = 0; i < 70; i++) {
      const x = 8 + rand() * (S - 16);
      const h = S * (0.35 + rand() * 0.6);
      const bend = (rand() - 0.5) * 30;
      const c = jitterColor(base, rand, 0.5);
      const grad = g.createLinearGradient(0, S, 0, S - h);
      grad.addColorStop(0, rgba(c.map((v) => v * 0.8)));
      grad.addColorStop(1, rgba(c.map((v) => Math.min(255, v * 1.7))));
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - 2.2, S);
      g.quadraticCurveTo(x + bend * 0.5, S - h * 0.6, x + bend, S - h);
      g.quadraticCurveTo(x + bend * 0.5 + 1, S - h * 0.6, x + 2.2, S);
      g.fill();
    }
    if (kind === 'green' || kind === 'lush') {
      // Algunas flores silvestres.
      for (let i = 0; i < 5; i++) {
        g.fillStyle = ['#f4f1e4', '#f2d24b', '#b78bd8', '#ffffff'][(rand() * 4) | 0];
        g.beginPath();
        g.arc(10 + rand() * (S - 20), S * (0.25 + rand() * 0.3), 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    const tex = toTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Corteza: pino (marrón agrietado), abedul (blanco con marcas) o palmera (anillos). */
export function barkTexture(kind = 'pine') {
  return cached(`fol:bark:${kind}`, () => {
    const W = 64;
    const H = 256;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    const rand = seededRandom(kind.length * 3);
    const base = { pine: '#5a4030', oak: '#4e3d30', birch: '#e8e4da', palm: '#9c8462' }[kind];
    g.fillStyle = base;
    g.fillRect(0, 0, W, H);
    if (kind === 'birch') {
      g.fillStyle = '#1f1d1a';
      for (let i = 0; i < 26; i++) g.fillRect(rand() * W, rand() * H, 6 + rand() * 18, 1.5 + rand() * 2.5);
    } else if (kind === 'palm') {
      for (let y = 0; y < H; y += 9) {
        g.fillStyle = 'rgba(60,45,30,0.6)';
        g.fillRect(0, y, W, 2);
        g.fillStyle = 'rgba(255,240,210,0.15)';
        g.fillRect(0, y + 2, W, 2);
      }
    } else {
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(20,14,10,${0.3 + rand() * 0.4})`;
        g.lineWidth = 1 + rand() * 2;
        const x = rand() * W;
        g.beginPath();
        g.moveTo(x, 0);
        for (let y = 0; y < H; y += 16) g.lineTo(x + (rand() - 0.5) * 6, y);
        g.stroke();
      }
    }
    return toTexture(canvas);
  });
}

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    fn(c, pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function solid(geo, rgb) {
  return paint(geo, (c) => { c[0] = rgb[0]; c[1] = rgb[1]; c[2] = rgb[2]; });
}

/** Normales que salen del centro de la copa: iluminación "de volumen" en vez de por tarjeta. */
function sphericalNormals(geo, center, blendUp = 0.35) {
  const pos = geo.attributes.position;
  const nrm = new Float32Array(pos.count * 3);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i) - center.x, pos.getY(i) - center.y, pos.getZ(i) - center.z).normalize();
    v.y += blendUp;
    v.normalize();
    nrm.set([v.x, v.y, v.z], i * 3);
  }
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return geo;
}

function merge(parts) {
  const geo = mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
  parts.forEach((g) => g.dispose());
  return geo;
}

function foliageMaterial(map, { amp = 1, stiff = 2 } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    map,
    vertexColors: true,
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    roughness: 0.82,
    metalness: 0,
  });
  return windify(mat, amp, { scale: 0.0022, stiff });
}

function barkMaterial(kind) {
  const tex = barkTexture(kind);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, vertexColors: true });
}

/** Pino/abeto: tronco + pisos de "faldas" de ramas con textura recortada. */
export function conifer({ tint = [38, 66, 40], tiers = 7, height = 13, radius = 3.3, seed = 1 } = {}) {
  const rand = seededRandom(seed);
  const trunk = new THREE.CylinderGeometry(0.14, 0.32, height * 0.55, 8);
  trunk.translate(0, height * 0.275, 0);
  solid(trunk, [1, 1, 1]);
  const parts = [];
  for (let t = 0; t < tiers; t++) {
    const k = t / (tiers - 1);
    const r = radius * (1 - k * 0.82) * (0.9 + rand() * 0.2);
    const h = (height / tiers) * 1.9 * (1 - k * 0.3);
    const y = height * 0.12 + k * height * 0.74;
    const cone = new THREE.ConeGeometry(r, h, 14, 3, true);
    const pos = cone.attributes.position;
    // Borde que cuelga y ondula: ramas que caen bajo su peso.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const d = Math.hypot(x, z) / r;
      const a = Math.atan2(z, x);
      pos.setY(i, pos.getY(i) - d * d * h * 0.18 + Math.sin(a * 5 + t) * d * 0.15);
      const wob = 1 + Math.sin(a * 3 + t * 1.7) * 0.08 * d;
      pos.setX(i, x * wob);
      pos.setZ(i, z * wob);
    }
    cone.translate(0, y + h / 2, 0);
    sphericalNormals(cone, new THREE.Vector3(0, y - h * 0.2, 0), 0.6);
    paint(cone, (c, x, yy, z) => {
      const ao = 0.55 + 0.45 * Math.min(1, Math.hypot(x, z) / r);
      const lift = 0.8 + k * 0.35;
      c[0] = ao * lift; c[1] = ao * lift; c[2] = ao * lift;
    });
    parts.push(cone);
  }
  return {
    trunk: { geometry: trunk, material: barkMaterial('pine') },
    crown: { geometry: merge(parts), material: foliageMaterial(coniferTexture(tint), { amp: 0.8, stiff: 3 }) },
  };
}

/** Frondoso: tronco con ramas y copa de tarjetas de hojas en un elipsoide. */
export function broadleaf({ palette, shape = 'oval', bark = 'oak', height = 9, crown = [3, 2.6, 3], cards = 30, seed = 2 } = {}) {
  const rand = seededRandom(seed);
  const trunkH = height * 0.55;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(bark === 'birch' ? 0.12 : 0.2, bark === 'birch' ? 0.2 : 0.36, trunkH + crown[1] * 0.6, 8);
  trunk.translate(0, (trunkH + crown[1] * 0.6) / 2, 0);
  parts.push(trunk);
  for (let b = 0; b < 4; b++) {
    const br = new THREE.CylinderGeometry(0.05, 0.11, crown[0] * 0.9, 5);
    br.translate(0, crown[0] * 0.45, 0);
    br.rotateZ(0.7 + rand() * 0.3);
    br.rotateY((b / 4) * Math.PI * 2 + rand());
    br.translate(0, trunkH * (0.8 + rand() * 0.2), 0);
    parts.push(br);
  }
  parts.forEach((p) => solid(p, [1, 1, 1]));
  const center = new THREE.Vector3(0, trunkH + crown[1] * 0.7, 0);
  const cardsGeo = [];
  for (let i = 0; i < cards; i++) {
    const size = 1.6 + rand() * 1.4;
    const q = new THREE.PlaneGeometry(size, size);
    q.rotateX(rand() * Math.PI);
    q.rotateY(rand() * Math.PI * 2);
    q.rotateZ((rand() - 0.5) * 1.2);
    // Más tarjetas en la superficie que dentro: silueta llena y bordes irregulares.
    const u = rand() * Math.PI * 2;
    const v = Math.acos(2 * rand() - 1);
    const rr = 0.45 + Math.sqrt(rand()) * 0.55;
    q.translate(
      center.x + Math.sin(v) * Math.cos(u) * crown[0] * rr,
      center.y + Math.cos(v) * crown[1] * rr,
      center.z + Math.sin(v) * Math.sin(u) * crown[2] * rr,
    );
    cardsGeo.push(q);
  }
  const crownGeo = merge(cardsGeo);
  sphericalNormals(crownGeo, center, 0.25);
  paint(crownGeo, (c, x, y, z) => {
    const d = Math.hypot((x - center.x) / crown[0], (y - center.y) / crown[1], (z - center.z) / crown[2]);
    const ao = 0.62 + 0.45 * Math.min(1, d) * (0.75 + 0.25 * Math.min(1, (y - center.y + crown[1]) / (2 * crown[1])));
    c[0] = ao; c[1] = ao; c[2] = ao;
  });
  return {
    trunk: { geometry: merge(parts), material: barkMaterial(bark) },
    crown: { geometry: crownGeo, material: foliageMaterial(leafClusterTexture(palette, seed, shape), { amp: 1, stiff: trunkH * 0.6 }) },
  };
}

/** Palmera: tronco curvado anillado y corona de hojas arqueadas. */
export function palm({ height = 8, lean = 1.4, fronds = 12, seed = 3 } = {}) {
  const rand = seededRandom(seed);
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(lean * 0.2, height * 0.35, 0),
    new THREE.Vector3(lean * 0.6, height * 0.7, 0),
    new THREE.Vector3(lean, height, 0),
  ]);
  const trunk = new THREE.TubeGeometry(curve, 16, 0.2, 8, false);
  // Más grueso abajo.
  const tp = trunk.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const y = tp.getY(i);
    const k = 1 + (1 - y / height) * 0.5;
    const c = curve.getPointAt(Math.min(1, Math.max(0, y / height)));
    tp.setX(i, c.x + (tp.getX(i) - c.x) * k);
    tp.setZ(i, c.z + (tp.getZ(i) - c.z) * k);
  }
  trunk.computeVertexNormals();
  const uv = trunk.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i) * 6);
  solid(trunk, [1, 1, 1]);
  const top = curve.getPoint(1);
  const nuts = [];
  for (let k = 0; k < 4; k++) {
    const s = new THREE.SphereGeometry(0.16, 6, 5);
    s.translate(top.x + Math.cos(k * 1.7) * 0.25, top.y - 0.25, top.z + Math.sin(k * 1.7) * 0.25);
    solid(s, [0.35, 0.3, 0.15]);
    nuts.push(s);
  }
  const frondParts = [];
  const L = 4.2;
  for (let f = 0; f < fronds; f++) {
    const seg = 10;
    const geo = new THREE.PlaneGeometry(L, 1.3, seg, 1);
    const pos = geo.attributes.position;
    const droop = 0.6 + rand() * 0.6;
    const rise = f % 3 === 0 ? 0.5 : 0;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i) + L / 2;
      const t = x / L;
      const w = pos.getY(i);
      // Arco: sube un poco y cae hacia la punta; los foliolos forman una V.
      pos.setXYZ(i, x * (1 - t * 0.15), rise * t * 2 - droop * t * t * 3 - Math.abs(w) * 0.35, w);
    }
    geo.rotateY((f / fronds) * Math.PI * 2 + rand() * 0.3);
    geo.translate(top.x, top.y, top.z);
    geo.computeVertexNormals();
    frondParts.push(geo);
  }
  const frondGeo = merge(frondParts);
  sphericalNormals(frondGeo, new THREE.Vector3(top.x, top.y - 1.5, top.z), 0.8);
  paint(frondGeo, (c, x, y) => {
    const k = 0.7 + 0.3 * Math.min(1, Math.max(0, (y - top.y + 2) / 2.5));
    c[0] = k; c[1] = k; c[2] = k;
  });
  return {
    trunk: { geometry: merge([trunk, ...nuts]), material: barkMaterial('palm') },
    crown: { geometry: frondGeo, material: foliageMaterial(palmFrondTexture(), { amp: 1.2, stiff: height * 0.8 }) },
  };
}

/** Arbusto: solo copa baja de racimos de hojas. */
export function bush({ palette, shape = 'oval', size = 1.3, seed = 4 } = {}) {
  const t = broadleaf({ palette, shape, height: 0.1, crown: [size, size * 0.7, size], cards: 12, seed });
  t.trunk.geometry.dispose();
  t.trunk.material.dispose();
  t.crown.geometry.translate(0, -0.2, 0);
  return { crown: t.crown };
}

/** Mata de hierba: tres planos cruzados que se mecen. */
export function grassTuft(kind = 'green') {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const q = new THREE.PlaneGeometry(1.1, 0.75);
    q.translate(0, 0.37, 0);
    q.rotateY((i / 3) * Math.PI);
    parts.push(q);
  }
  const geo = merge(parts);
  // Normales hacia arriba: se ilumina como el suelo, sin cambios bruscos por tarjeta.
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  paint(geo, (c, x, y) => { const k = 0.85 + y * 0.4; c[0] = k; c[1] = k; c[2] = k; });
  const mat = new THREE.MeshStandardMaterial({ map: grassTexture(kind), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  windify(mat, 1, { scale: 0.18, stiff: 0 });
  return { geometry: geo, material: mat };
}

/** Saguaro acanalado con dos brazos. */
export function cactus() {
  const parts = [];
  const ribbed = (r0, r1, h) => {
    const g = new THREE.CylinderGeometry(r0, r1, h, 16, 6);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.atan2(p.getZ(i), p.getX(i));
      const k = 1 + Math.cos(a * 8) * 0.07;
      p.setX(i, p.getX(i) * k);
      p.setZ(i, p.getZ(i) * k);
    }
    g.computeVertexNormals();
    return g;
  };
  const body = ribbed(0.38, 0.45, 6);
  body.translate(0, 3, 0);
  parts.push(body);
  const armA = ribbed(0.26, 0.28, 2.4);
  armA.translate(0.95, 3.6, 0);
  const elbowA = ribbed(0.26, 0.26, 1.0);
  elbowA.rotateZ(Math.PI / 2);
  elbowA.translate(0.5, 2.5, 0);
  const armB = ribbed(0.24, 0.26, 1.8);
  armB.translate(-0.85, 4.1, 0);
  const elbowB = ribbed(0.24, 0.24, 0.9);
  elbowB.rotateZ(Math.PI / 2);
  elbowB.translate(-0.45, 3.3, 0);
  parts.push(armA, elbowA, armB, elbowB);
  for (const s of [body, armA, armB]) {
    const top = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    s.computeBoundingBox();
    const bb = s.boundingBox;
    const rr = (bb.max.x - bb.min.x) / 2;
    top.scale(rr, rr, rr);
    top.translate((bb.max.x + bb.min.x) / 2, bb.max.y, 0);
    parts.push(top);
  }
  const geo = merge(parts);
  // Costillas más claras y surcos oscuros.
  paint(geo, (c, x, y, z) => {
    const a = Math.atan2(z, x);
    const k = 0.75 + Math.cos(a * 8) * 0.18;
    c[0] = 0.27 * k * 3; c[1] = 0.40 * k * 2.2; c[2] = 0.20 * k * 3;
  });
  return { geometry: geo, material: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }) };
}
