import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { carDimensions } from './carGeometry.js';
import { softDotTexture, cached, makeCanvas, toTexture } from './textures.js';
import { tireTextures, plateTexture, grilleTexture, brakeDiscTexture, upholsteryTexture } from './carTextures.js';

/**
 * Modelos de coche. La jerarquía sigue la especificación de assets del README
 * (`chassis`, `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`), así que un GLB
 * con esos nodos puede sustituir al modelo procedural sin tocar el motor.
 *
 * Estructura devuelta:
 *   root (origen = cuerpo rígido)
 *     chassis (desplazado al suelo)
 *     wheel_xx (pivote de dirección) > spin (giro de rodadura)
 *
 * El modelo procedural es una carrocería "lofteada" (secciones superelípticas
 * a lo largo del coche) con UV propias: sobre ellas se pintan juntas de
 * puertas, capó y maletero, tiradores y tapón de gasolina, y los detalles
 * (faros, pilotos, retrovisores, rejillas) se colocan sobre la superficie real
 * orientados según su normal.
 */
export const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

/** Rutas GLB opcionales por modelo, p. ej. { sport: '/assets/cars/car_sport.glb' }. */
export const CAR_GLB = {};

const shared = {};
function sharedMaterials() {
  if (shared.trim) return shared;
  shared.trim = new THREE.MeshStandardMaterial({ color: '#0e0f11', roughness: 0.6, metalness: 0.2 });
  shared.gloss = new THREE.MeshPhysicalMaterial({ color: '#08090a', roughness: 0.15, metalness: 0.3, clearcoat: 1 });
  const tire = tireTextures();
  shared.tire = new THREE.MeshStandardMaterial({ map: tire.map, bumpMap: tire.bumpMap, bumpScale: 2.5, roughness: 0.88 });
  shared.rim = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 1, roughness: 0.22 });
  shared.barrel = new THREE.MeshStandardMaterial({ color: '#4a4d52', metalness: 0.9, roughness: 0.35 });
  shared.disc = new THREE.MeshStandardMaterial({ map: brakeDiscTexture(), metalness: 0.85, roughness: 0.45 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: '#e6e6e6', metalness: 1, roughness: 0.08 });
  shared.darkChrome = new THREE.MeshStandardMaterial({ color: '#2b2d31', metalness: 1, roughness: 0.18 });
  shared.caliper = new THREE.MeshStandardMaterial({ color: '#d11f1f', roughness: 0.35, metalness: 0.2 });
  shared.carbon = new THREE.MeshPhysicalMaterial({ color: '#141518', roughness: 0.3, metalness: 0.4, clearcoat: 0.8 });
  shared.lens = new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.25, clearcoat: 1, depthWrite: false });
  shared.projector = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff4dc', emissiveIntensity: 2.4, roughness: 0.1 });
  shared.drl = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#e8f2ff', emissiveIntensity: 3, roughness: 0.2 });
  shared.mirror = new THREE.MeshStandardMaterial({ color: '#9aa4ae', metalness: 1, roughness: 0.02 });
  shared.grille = new THREE.MeshStandardMaterial({ map: grilleTexture(), roughness: 0.5, metalness: 0.4 });
  shared.interior = new THREE.MeshStandardMaterial({ map: upholsteryTexture(), roughness: 0.9 });
  shared.dash = new THREE.MeshStandardMaterial({ color: '#141518', roughness: 0.7 });
  shared.exhaustIn = new THREE.MeshBasicMaterial({ color: '#050505' });
  shared.amber = new THREE.MeshStandardMaterial({ color: '#ff9a1f', emissive: '#ff7a00', emissiveIntensity: 0.6, roughness: 0.2 });
  shared.shadow = new THREE.MeshBasicMaterial({ map: softDotTexture(), color: '#000', transparent: true, opacity: 0.6, depthWrite: false });
  return shared;
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Interpola suavemente una polilínea [[z, y], ...] ordenada por z. */
function profile(points, z) {
  if (z <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [z1, y1] = points[i];
    if (z <= z1) {
      const [z0, y0] = points[i - 1];
      const t = (z - z0) / (z1 - z0);
      return lerp(y0, y1, t * t * (3 - 2 * t));
    }
  }
  return points[points.length - 1][1];
}

const PHI0 = -Math.PI / 2;
const PHI1 = Math.PI * 1.5;

/** Punto de una sección superelíptica en el ángulo phi (0 = lado +X, π/2 = arriba). */
function sectionPoint(sec, phi, out = new THREE.Vector3(), z = 0) {
  const { yb, yt, w, n = 4, taper = 0 } = sec;
  const yc = (yb + yt) / 2;
  const hh = Math.max(0.001, (yt - yb) / 2);
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  const y = yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
  let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
  x *= 1 - taper * Math.max(0, (y - yc) / hh);
  return out.set(x, y, z);
}

/**
 * Superficie "lofteada": secciones transversales superelípticas a lo largo
 * del eje Z, con UV (u = vuelta a la sección, v = largo).
 * @param {(z: number) => {yb: number, yt: number, w: number, n?: number, taper?: number}} section
 */
function loft(z0, z1, section, { rings = 64, segs = 40, phiFrom = PHI0, phiTo = PHI1, closed = true } = {}) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const cols = segs + 1;
  const p = new THREE.Vector3();
  for (let i = 0; i <= rings; i++) {
    const z = lerp(z0, z1, i / rings);
    const sec = section(z);
    for (let j = 0; j <= segs; j++) {
      const phi = lerp(phiFrom, phiTo, j / segs);
      sectionPoint(sec, phi, p, z);
      positions.push(p.x, p.y, p.z);
      uvs.push((phi - PHI0) / (PHI1 - PHI0), i / rings);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * cols + j;
      const b = a + cols;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  if (closed) mergeSeam(geo, rings, cols);
  return geo;
}

/** Promedia las normales de la costura del anillo (primer y último punto coinciden). */
function mergeSeam(geo, rings, cols) {
  const n = geo.attributes.normal;
  for (let i = 0; i <= rings; i++) {
    const a = i * cols;
    const b = a + cols - 1;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

/** Perfil de la carrocería en función de las proporciones del modelo. */
function bodyDesign(dim, body) {
  const L = dim.length;
  const H = dim.height;
  const half = L / 2;
  const zf = dim.wheelBase / 2;
  const wc = dim.wheelRadius;
  const ra = dim.wheelRadius + 0.07;
  const hood = H * (body.hood ?? 0.68);
  const deck = H * (body.deck ?? 0.72);
  const front = L * (body.front ?? 0.17);
  const back = -L * (body.back ?? 0.3);
  const roofLen = L * body.cabinScale * 0.5;
  const wsTop = front - (H - hood) * 2.1;
  const rearTop = Math.min(wsTop - 0.3, Math.max(back + (body.tailDrop ?? 0.15), wsTop - roofLen));
  const top = [
    [-half, deck - 0.16],
    [Math.min(-half + 0.22, back - 0.06), deck - 0.01],
    [back, deck],
    [front, hood + 0.03],
    [Math.max(half - 0.5, front + 0.1), hood - 0.06],
    [half, hood - 0.24],
  ];
  const bottomBase = [
    [-half, 0.34],
    [-half + 0.3, 0.2],
    [half - 0.35, 0.18],
    [half, 0.28],
  ];
  const yt = (z) => {
    let y = profile(top, z);
    // Aletas: la carrocería se abomba sobre cada rueda.
    for (const c of [-zf, zf]) {
      const d = Math.abs(z - c) / (ra + 0.4);
      if (d < 1) y = Math.max(y, wc + ra + 0.05 - d * d * 0.1);
    }
    return y;
  };
  const yb = (z) => {
    let y = profile(bottomBase, z);
    for (const c of [-zf, zf]) {
      const dz = z - c;
      if (Math.abs(dz) < ra) y = Math.max(y, wc + Math.sqrt(ra * ra - dz * dz) * 0.92);
    }
    return y;
  };
  // Planta casi recta con esquinas redondeadas (superelipse), no un huevo.
  const endRound = (z) => {
    const r = z > 0 ? 0.5 : 0.42;
    const d = Math.abs(z) - (half - r);
    return d > 0 ? Math.pow(Math.max(0, 1 - (d / r) ** 2.6), 1 / 2.6) : 1;
  };
  const halfW = dim.width / 2;
  const widthAt = (z) => halfW * (1 - 0.05 * Math.pow(Math.abs(z) / half, 4)) * endRound(z);
  const N = 9;
  const TAPER = 0.1;
  const section = (z) => ({ yb: yb(z), yt: yt(z), w: widthAt(z), n: N, taper: TAPER });
  return { L, H, half, hood, deck, front, back, roofLen, wsTop, rearTop, yt, yb, widthAt, halfW, zf, ra, wc, section };
}

function roofLine(d, z) {
  const { front, back, rearTop, wsTop, H, yt } = d;
  const base = yt(z) - 0.04;
  if (z >= front || z <= back) return base;
  if (z >= wsTop) return lerp(H, base, smooth(wsTop, front, z) ** 0.8);
  if (z >= rearTop) return H + 0.015 * Math.sin(((z - rearTop) / (wsTop - rearTop)) * Math.PI);
  return lerp(base, H, smooth(back, rearTop, z) ** 0.7);
}

/** Punto y normal de la carrocería en (z, phi), para apoyar piezas sobre ella. */
function surfaceFrame(d, z, phi) {
  const p = sectionPoint(d.section(z), phi, new THREE.Vector3(), z);
  const e = 0.01;
  const pz = sectionPoint(d.section(z + e), phi, new THREE.Vector3(), z + e).sub(sectionPoint(d.section(z - e), phi, new THREE.Vector3(), z - e));
  const pp = sectionPoint(d.section(z), phi + e, new THREE.Vector3(), z).sub(sectionPoint(d.section(z), phi - e, new THREE.Vector3(), z));
  const n = new THREE.Vector3().crossVectors(pp, pz).normalize();
  return { p, n };
}

/** Coloca `mesh` sobre la carrocería mirando según la normal (su +Z = normal). */
function placeOnBody(mesh, d, z, phi, { inset = 0, up = new THREE.Vector3(0, 1, 0) } = {}) {
  const { p, n } = surfaceFrame(d, z, phi);
  mesh.position.copy(p).addScaledVector(n, -inset);
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), n, up);
  mesh.quaternion.setFromRotationMatrix(m);
  // lookAt orienta -Z hacia el objetivo: girar 180° para que +Z sea la normal.
  mesh.rotateY(Math.PI);
  return mesh;
}

/** phi del lado `side` (+1 = +X) en el que la sección alcanza la altura y. */
function phiAtHeight(sec, y, side) {
  const { yb, yt, n = 4 } = sec;
  const yc = (yb + yt) / 2;
  const hh = Math.max(0.001, (yt - yb) / 2);
  const s = Math.max(-1, Math.min(1, (y - yc) / hh));
  const sn = Math.sign(s) * Math.pow(Math.abs(s), n / 2);
  const a = Math.asin(sn);
  return side > 0 ? a : Math.PI - a;
}

/** phi superior en el que la sección pasa por la abscisa x (lado según signo). */
function phiAtTopX(sec, x) {
  const { w, n = 4, taper = 0 } = sec;
  const r = Math.min(1, Math.abs(x) / (w * (1 - taper)));
  const c = Math.sign(x) * Math.pow(r, n / 2);
  return Math.acos(c);
}

/**
 * Textura de detalle de la carrocería sobre sus UV: juntas de puertas, capó y
 * maletero, paragolpes, tiradores y tapón de combustible. Se usa a la vez
 * como color (líneas oscuras) y como relieve (ranuras).
 */
function bodyDetailTexture(def, d) {
  return cached(`car:body:${def.id}`, () => {
    const W = 1024;
    const H = 1024;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, W, H);
    const z0 = -d.half;
    const toV = (z) => (1 - (z - z0) / d.L) * H;
    const toU = (phi) => ((phi - PHI0) / (PHI1 - PHI0)) * W;
    const seam = (draw) => {
      g.strokeStyle = 'rgba(18,18,20,0.9)';
      g.lineWidth = 2.6;
      g.beginPath();
      draw();
      g.stroke();
    };
    const sideLine = (z, y0, y1, side) => {
      const sec = d.section(z);
      g.moveTo(toU(phiAtHeight(sec, y0, side)), toV(z));
      g.lineTo(toU(phiAtHeight(sec, y1, side)), toV(z));
    };
    const alongSide = (za, zb, yFn, side) => {
      const steps = 40;
      for (let i = 0; i <= steps; i++) {
        const z = lerp(za, zb, i / steps);
        const u = toU(phiAtHeight(d.section(z), yFn(z), side));
        if (i) g.lineTo(u, toV(z));
        else g.moveTo(u, toV(z));
      }
    };
    const acrossTop = (z, x) => {
      const sec = d.section(z);
      g.moveTo(toU(phiAtTopX(sec, x)), toV(z));
      g.lineTo(toU(phiAtTopX(sec, -x)), toV(z));
    };
    const alongTop = (za, zb, xFn) => {
      const steps = 30;
      for (let i = 0; i <= steps; i++) {
        const z = lerp(za, zb, i / steps);
        const u = toU(phiAtTopX(d.section(z), xFn(z)));
        if (i) g.lineTo(u, toV(z));
        else g.moveTo(u, toV(z));
      }
    };

    const doorTop = (z) => d.yt(z) - 0.012;
    const sill = 0.44;
    const zF = d.zf - d.ra - 0.1;
    const fourDoor = def.body.doors === 4;
    const zR = fourDoor ? -d.zf + d.ra + 0.06 : Math.max(-d.zf + d.ra + 0.2, d.back - 0.02);
    const zM = (zF + zR) / 2 + 0.05;
    for (const side of [-1, 1]) {
      seam(() => {
        sideLine(zF, sill, doorTop(zF), side);
        sideLine(zR, sill, doorTop(zR), side);
        if (fourDoor) sideLine(zM, sill, doorTop(zM), side);
        alongSide(zR, zF, () => sill, side);
        // Paragolpes delantero y trasero.
        const zb1 = d.half - 0.34;
        const zb2 = -d.half + 0.3;
        sideLine(zb1, d.yb(zb1) + 0.02, d.yt(zb1) - 0.03, side);
        sideLine(zb2, d.yb(zb2) + 0.02, d.yt(zb2) - 0.03, side);
      });
      // Tiradores: hueco oscuro con reflejo.
      for (const zh of fourDoor ? [zM + 0.24, zR + 0.24] : [zR + 0.26]) {
        const sec = d.section(zh);
        const yh = d.yt(zh) - 0.1;
        const u0 = toU(phiAtHeight(sec, yh - 0.018, side));
        const u1 = toU(phiAtHeight(sec, yh + 0.018, side));
        const v0 = toV(zh + 0.09);
        const v1 = toV(zh - 0.09);
        g.fillStyle = 'rgba(25,25,28,0.95)';
        g.fillRect(Math.min(u0, u1), v0, Math.abs(u1 - u0), v1 - v0);
        g.fillStyle = 'rgba(255,255,255,0.6)';
        g.fillRect(Math.min(u0, u1), v0, Math.abs(u1 - u0), 2);
      }
    }
    // Capó, maletero y unión del paragolpes por arriba.
    const hx = (z) => d.widthAt(z) * 0.78;
    seam(() => {
      const zh0 = d.front + 0.06;
      const zh1 = d.half - 0.34;
      acrossTop(zh0, hx(zh0));
      alongTop(zh0, zh1, (z) => hx(z));
      alongTop(zh0, zh1, (z) => -hx(z));
      acrossTop(zh1, d.widthAt(zh1) * 0.92);
      const zt0 = d.back - 0.05;
      const zt1 = -d.half + 0.3;
      acrossTop(zt0, hx(zt0));
      alongTop(zt1, zt0, (z) => hx(z));
      alongTop(zt1, zt0, (z) => -hx(z));
      acrossTop(zt1, d.widthAt(zt1) * 0.92);
    });
    // Tapón de combustible en la aleta trasera izquierda.
    {
      const zc = -d.zf + 0.05;
      const yc = Math.max(d.wc + d.ra + 0.1, d.yt(zc) - 0.14);
      const sec = d.section(zc);
      const u = toU(phiAtHeight(sec, yc, 1));
      const du = Math.abs(toU(phiAtHeight(sec, yc + 0.07, 1)) - u);
      const dv = (0.07 / d.L) * H;
      g.strokeStyle = 'rgba(18,18,20,0.9)';
      g.lineWidth = 2.4;
      g.beginPath();
      g.ellipse(u, toV(zc), du, dv, 0, 0, Math.PI * 2);
      g.stroke();
    }
    const tex = toTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = 8;
    return tex;
  });
}

/**
 * Cristales: tinte semitransparente con marcos negros (base de las
 * ventanillas, pilar B y montantes del parabrisas).
 */
function glassTexture(def, d, cabinSection, z0, z1) {
  return cached(`car:glass:${def.id}`, () => {
    const W = 512;
    const H = 512;
    const canvas = makeCanvas(W, H);
    const g = canvas.getContext('2d');
    g.fillStyle = 'rgba(14,20,26,0.5)';
    g.fillRect(0, 0, W, H);
    const toV = (z) => (1 - (z - z0) / (z1 - z0)) * H;
    const toU = (phi) => ((phi - PHI0) / (PHI1 - PHI0)) * W;
    g.fillStyle = 'rgba(6,6,7,1)';
    for (const side of [-1, 1]) {
      // Base: banda negra hasta un poco por encima de la línea de cintura.
      for (let i = 0; i < 60; i++) {
        const z = lerp(z0, z1, i / 59);
        const sec = cabinSection(z);
        const ua = toU(phiAtHeight(sec, sec.yb - 1, side));
        const ub = toU(phiAtHeight(sec, d.yt(z) + 0.03, side));
        g.fillRect(Math.min(ua, ub) - 1, toV(z) - H / 59, Math.abs(ub - ua) + 2, H / 59 + 2);
      }
      // Marco superior / montantes A: entre lateral y techo.
      const ua = toU(Math.PI / 2 - side * 0.94);
      const ub = toU(Math.PI / 2 - side * 1.1);
      g.fillRect(Math.min(ua, ub), 0, Math.abs(ub - ua), H);
    }
    // Pilar B.
    const fourDoor = def.body.doors === 4;
    const zb = fourDoor ? (d.zf - d.ra - 0.1 + (-d.zf + d.ra + 0.06)) / 2 + 0.05 : Math.max(-d.zf + d.ra + 0.2, d.back - 0.02) + 0.02;
    if (zb > z0 && zb < z1) g.fillRect(0, toV(zb + 0.06), W, toV(zb - 0.06) - toV(zb + 0.06));
    // Línea de luz de freno superior en la luneta.
    const tex = toTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

const rimMaterials = {};
function rimMaterial(color) {
  if (!color) return sharedMaterials().rim;
  rimMaterials[color] ??= new THREE.MeshStandardMaterial({ color, metalness: 0.95, roughness: 0.25 });
  return rimMaterials[color];
}

/** Cara de llanta extruida: disco con ventanas entre radios según el estilo. */
function rimFaceGeometry(R, style) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, R, 0, Math.PI * 2, false);
  const holes = [];
  if (style === 'classic') {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const h = new THREE.Path();
      h.absarc(Math.cos(a) * R * 0.62, Math.sin(a) * R * 0.62, R * 0.11, 0, Math.PI * 2, true);
      holes.push(h);
    }
  } else {
    const n = style === 'mesh' ? 10 : 5;
    const spoke = style === 'mesh' ? 0.16 : 0.34;
    const r0 = R * 0.36;
    const r1 = R * 0.86;
    for (let k = 0; k < n; k++) {
      const a0 = (k / n) * Math.PI * 2 + spoke / 2;
      const a1 = ((k + 1) / n) * Math.PI * 2 - spoke / 2;
      // Ventana trapezoidal: los radios se estrechan hacia fuera.
      const h = new THREE.Path();
      const ia0 = a0 + spoke * 0.35;
      const ia1 = a1 - spoke * 0.35;
      h.moveTo(Math.cos(ia0) * r0, Math.sin(ia0) * r0);
      h.lineTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
      h.absarc(0, 0, r1, a0, a1, false);
      h.lineTo(Math.cos(ia1) * r0, Math.sin(ia1) * r0);
      h.absarc(0, 0, r0, ia1, ia0, true);
      holes.push(h);
    }
  }
  shape.holes.push(...holes);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.03, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.008, bevelSegments: 2, curveSegments: 18,
  });
  return geo;
}

/** Rueda con neumático rotulado, disco perforado y llanta según estilo. side: +1 = lado +X. */
function buildWheel(dim, body, side) {
  const m = sharedMaterials();
  const r = dim.wheelRadius;
  const w = 0.27;
  const spin = new THREE.Group();
  spin.name = 'spin';
  // Neumático por revolución: banda de rodadura plana y flancos redondeados.
  const pts = [];
  const ri = r * 0.68;
  for (let i = 0; i <= 16; i++) {
    const a = (i / 16) * Math.PI;
    pts.push(new THREE.Vector2(ri + (r - ri) * (0.5 + 0.5 * Math.pow(Math.sin(a), 0.6)), (-Math.cos(a) * w) / 2));
  }
  const tireGeo = new THREE.LatheGeometry(pts, 40);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  const rim = rimMaterial(body.rimColor);
  const style = body.rim ?? 'spoke5';
  const barrelGeo = new THREE.CylinderGeometry(ri, ri, w * 0.9, 32, 1, true);
  barrelGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(barrelGeo, m.barrel));
  // Disco de freno visible entre los radios.
  const discGeo = new THREE.CylinderGeometry(ri * 0.82, ri * 0.82, 0.03, 32);
  discGeo.rotateZ(Math.PI / 2);
  const disc = new THREE.Mesh(discGeo, m.disc);
  disc.position.x = side * 0.02;
  spin.add(disc);
  // Cara de la llanta hacia fuera, algo cóncava.
  const faceGeo = rimFaceGeometry(ri * 0.99, style);
  faceGeo.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
  const face = new THREE.Mesh(faceGeo, style === 'classic' ? m.chrome : rim);
  face.position.x = side * (w / 2 - 0.07);
  spin.add(face);
  const lipGeo = new THREE.TorusGeometry(ri * 0.99, 0.016, 8, 40);
  lipGeo.rotateY(Math.PI / 2);
  const lip = new THREE.Mesh(lipGeo, style === 'classic' ? m.chrome : rim);
  lip.position.x = side * (w / 2 - 0.012);
  spin.add(lip);
  // Buje y tuercas.
  const hubGeo = new THREE.CylinderGeometry(r * 0.13, r * 0.15, 0.06, 16);
  hubGeo.rotateZ(Math.PI / 2);
  const hub = new THREE.Mesh(hubGeo, style === 'classic' ? m.chrome : m.darkChrome);
  hub.position.x = side * (w / 2 - 0.03);
  spin.add(hub);
  const nutGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.05, 6);
  nutGeo.rotateZ(Math.PI / 2);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const nut = new THREE.Mesh(nutGeo, m.chrome);
    nut.position.set(side * (w / 2 - 0.035), Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2);
    spin.add(nut);
  }
  return spin;
}

/** Pinza de freno: va en el pivote (gira con la dirección pero no rueda). */
function buildCaliper(dim, body) {
  const m = sharedMaterials();
  const geo = new RoundedBoxGeometry(0.07, 0.2, 0.13, 2, 0.025);
  const mat = body.caliper ? new THREE.MeshStandardMaterial({ color: body.caliper, roughness: 0.35 }) : m.caliper;
  const c = new THREE.Mesh(geo, mat);
  c.position.set(0, dim.wheelRadius * 0.34, -dim.wheelRadius * 0.28);
  c.rotation.x = 0.7;
  return c;
}

function plate(text) {
  const geo = new THREE.PlaneGeometry(0.52, 0.11);
  const mat = new THREE.MeshStandardMaterial({ map: plateTexture(text), roughness: 0.4, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.ownMaterial = mat;
  return mesh;
}

/** Modelo procedural de un coche con la pintura indicada. */
export function createProceduralCar(def, color, { detail = 'high' } = {}) {
  const dim = carDimensions(def);
  const body = def.body;
  const m = sharedMaterials();
  const root = new THREE.Group();
  root.name = `car_${def.id}`;
  const own = [];

  const d = bodyDesign(dim, body);
  const paintProps = {
    color,
    metalness: body.metallic ?? 0.45,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    envMapIntensity: 1.1,
  };
  // Pintura con juntas y tiradores (carrocería) y pintura lisa (piezas sueltas).
  const detailTex = bodyDetailTexture(def, d);
  const bodyPaint = new THREE.MeshPhysicalMaterial({ ...paintProps, map: detailTex, bumpMap: detailTex, bumpScale: 1.2 });
  const paint = new THREE.MeshPhysicalMaterial(paintProps);
  const tailMat = new THREE.MeshPhysicalMaterial({ color: '#5a0006', emissive: '#ff1a10', emissiveIntensity: 0.6, roughness: 0.1, clearcoat: 1 });
  const reverseMat = new THREE.MeshStandardMaterial({ color: '#cfcfcf', emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.2 });
  own.push(bodyPaint, paint, tailMat, reverseMat);

  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  chassis.position.y = dim.visualOffsetY;
  root.add(chassis);
  const add = (mesh, { cast = true } = {}) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = true;
    chassis.add(mesh);
    return mesh;
  };

  const bodyMesh = add(new THREE.Mesh(loft(-d.half, d.half, d.section, { rings: 110, segs: 56 }), bodyPaint));
  bodyMesh.name = 'body';

  // Habitáculo de cristal (con marcos) y techo pintado encima.
  const cabinSection = (inflate) => (z) => {
    const yb = d.yt(z) - 0.12;
    return { yb, yt: Math.max(yb + 0.01, roofLine(d, z)) + inflate, w: d.widthAt(z) * 0.86 + inflate, n: 3.6, taper: 0.34 };
  };
  const glassMat = new THREE.MeshPhysicalMaterial({
    map: glassTexture(def, d, cabinSection(0), d.back, d.front),
    transparent: true,
    roughness: 0.03,
    metalness: 0.1,
    clearcoat: 1,
    envMapIntensity: 1.8,
  });
  own.push(glassMat);
  const cabin = add(new THREE.Mesh(loft(d.back, d.front, cabinSection(0), { rings: 60, segs: 48 }), glassMat));
  cabin.renderOrder = 2;
  const roofGeo = loft(d.rearTop - 0.12, d.wsTop + 0.02, cabinSection(0.012), {
    rings: 24, segs: 18, phiFrom: Math.PI / 2 - 0.96, phiTo: Math.PI / 2 + 0.96, closed: false,
  });
  add(new THREE.Mesh(roofGeo, paint));
  // Montantes traseros pintados (pilar C) para un perfil de coupé.
  for (const side of [-1, 1]) {
    const pillar = loft(d.back + 0.1, d.rearTop + 0.05, cabinSection(0.008), {
      rings: 16, segs: 6,
      phiFrom: side > 0 ? -0.2 : Math.PI - 0.9,
      phiTo: side > 0 ? 0.9 : Math.PI + 0.2,
      closed: false,
    });
    add(new THREE.Mesh(pillar, paint));
  }

  const L = dim.length;
  const W = dim.width;
  const belt = (z) => d.yt(z);

  // Interior visible a través de los cristales: asientos, salpicadero y volante.
  if (detail === 'high') {
    const seatZ = Math.min(d.wsTop - 0.45, (d.wsTop + d.rearTop) / 2 + 0.05);
    for (const side of [-1, 1]) {
      const x = side * W * 0.2;
      // Respaldo y reposacabezas por debajo del techo, sea cual sea la silueta.
      const headTop = roofLine(d, seatZ - 0.3) - 0.1;
      const back = add(new THREE.Mesh(new RoundedBoxGeometry(0.46, 0.62, 0.14, 2, 0.05), m.interior), { cast: false });
      back.position.set(x, headTop - 0.47, seatZ - 0.2);
      back.rotation.x = -0.28;
      const head = add(new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.17, 0.1, 2, 0.04), m.interior), { cast: false });
      head.position.set(x, headTop - 0.09, seatZ - 0.3);
      head.rotation.x = -0.28;
    }
    const dashZ = Math.max(d.wsTop - 0.05, seatZ + 0.45);
    const dash = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, 0.16, 0.42, 2, 0.05), m.dash), { cast: false });
    dash.position.set(0, belt(dashZ) - 0.02, dashZ + 0.1);
    const wheelMesh = add(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.022, 8, 24), m.dash), { cast: false });
    wheelMesh.position.set(W * 0.2, belt(dashZ) + 0.08, dashZ - 0.2);
    wheelMesh.rotation.x = -0.45;
    // Luz de freno central en la luneta.
    const cz = d.back + 0.08;
    const cbl = add(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.025, 0.02), tailMat), { cast: false });
    cbl.position.set(0, roofLine(d, cz) - 0.05, cz + 0.02);
  }

  // Bajos: faldones, splitter y difusor con aletas.
  const skirt = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.92, 0.12, L * 0.62, 2, 0.04), m.trim), { cast: false });
  skirt.position.y = 0.22;
  const splitW = body.splitter ? W * 0.98 : W * 0.82;
  const splitter = add(new THREE.Mesh(new RoundedBoxGeometry(splitW, 0.04, body.splitter ? 0.42 : 0.26, 2, 0.015), body.splitter ? m.carbon : m.trim));
  splitter.position.set(0, 0.17, L / 2 - (body.splitter ? 0.24 : 0.2));
  const diffuser = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.7, 0.03, 0.36, 2, 0.012), m.carbon));
  diffuser.position.set(0, 0.2, -L / 2 + 0.3);
  diffuser.rotation.x = -0.2;
  for (let k = -2; k <= 2; k++) {
    const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.09, 0.32), m.carbon), { cast: false });
    fin.position.set(k * W * 0.12, 0.23, -L / 2 + 0.3);
    fin.rotation.x = -0.2;
  }

  // Franjas de carreras sobre el eje central (capó, techo y maletero).
  if (body.stripes) {
    const stripeMat = new THREE.MeshPhysicalMaterial({ color: body.stripes, roughness: 0.3, clearcoat: 1, envMapIntensity: 1.1 });
    own.push(stripeMat);
    const stripeY = (z) => (z > d.back && z < d.front ? Math.max(d.yt(z), roofLine(d, z)) + 0.016 : d.yt(z) + 0.006);
    // Capó, techo y maletero: las franjas no cruzan los cristales.
    const segments = [[d.front + 0.02, d.half - 0.2], [d.rearTop - 0.08, d.wsTop], [-d.half + 0.16, d.back - 0.02]];
    for (const side of [-1, 1]) for (const [za, zb] of segments) {
      const pos = [];
      const idx = [];
      const rings = 40;
      for (let i = 0; i <= rings; i++) {
        const z = lerp(za, zb, i / rings);
        const y = stripeY(z);
        const x0 = side * 0.1;
        const x1 = side * 0.26;
        pos.push(x0, y + 0.004, z, x1, y + 0.004, z);
        if (i < rings) {
          const k = i * 2;
          if (side > 0) idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
          else idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setIndex(idx);
      sg.computeVertexNormals();
      add(new THREE.Mesh(sg, stripeMat), { cast: false });
    }
  }

  // Frontal: rejilla en panal, toma inferior y matrícula.
  const noseZ = d.half;
  const noseMid = (d.yb(noseZ) + d.yt(noseZ)) / 2;
  const grilleW = W * (body.chrome ? 0.36 : 0.5);
  const grille = add(new THREE.Mesh(new RoundedBoxGeometry(grilleW, body.chrome ? 0.14 : 0.12, 0.1, 2, 0.03), m.grille), { cast: false });
  grille.position.set(0, noseMid + 0.02, noseZ - 0.07);
  if (body.chrome) {
    const surround = add(new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 6, 32), m.chrome), { cast: false });
    surround.scale.set(grilleW / 2, 0.08, 1);
    surround.position.copy(grille.position).add(new THREE.Vector3(0, 0, 0.05));
  }
  const intake = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.62, 0.09, 0.1, 2, 0.03), m.grille), { cast: false });
  intake.position.set(0, d.yb(noseZ) + 0.02, noseZ - 0.12);
  const frontPlate = add(plate('RUN 01'), { cast: false });
  frontPlate.position.set(0, noseMid - 0.075, noseZ + 0.005);
  frontPlate.scale.setScalar(0.85);

  // Faros: carcasa oscura, proyectores, tira LED y cubierta de cristal,
  // apoyados sobre la superficie del morro.
  const hlZ = d.half - 0.12;
  for (const side of [-1, 1]) {
    const phi = side > 0 ? 0.42 : Math.PI - 0.42;
    const hl = new THREE.Group();
    placeOnBody(hl, d, hlZ, phi, { inset: 0.025 });
    chassis.add(hl);
    if (body.roundLights) {
      const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 24), m.chrome);
      const bowl = new THREE.Mesh(new THREE.CircleGeometry(0.11, 24), m.darkChrome);
      const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.045, 16), m.projector);
      bowl.position.z = 0.01;
      bulb.position.z = 0.015;
      hl.add(bezel, bowl, bulb);
    } else {
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.44, 0.12, 0.06, 2, 0.03), m.darkChrome);
      hl.add(housing);
      for (const k of [-1, 1]) {
        const proj = new THREE.Mesh(new THREE.CircleGeometry(0.035, 16), m.projector);
        proj.position.set(k * 0.07 - side * 0.06, -0.005, 0.031);
        hl.add(proj);
      }
      const drl = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.016, 0.01), m.drl);
      drl.position.set(0, 0.045, 0.031);
      hl.add(drl);
      const cover = new THREE.Mesh(new RoundedBoxGeometry(0.47, 0.15, 0.04, 2, 0.02), m.lens);
      cover.position.z = 0.02;
      hl.add(cover);
      const indicator = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.03, 0.01), m.amber);
      indicator.position.set(side * 0.17, -0.035, 0.031);
      hl.add(indicator);
    }
  }

  // Pilotos traseros: grupo envolvente en las esquinas y barra central en los modernos.
  const tz = -d.half + 0.07;
  for (const side of [-1, 1]) {
    const tl = new THREE.Group();
    const phi = side > 0 ? 0.5 : Math.PI - 0.5;
    placeOnBody(tl, d, tz, phi, { inset: 0.02 });
    chassis.add(tl);
    if (body.roundLights) {
      for (const k of [0, 1]) {
        const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.065, 0.065, 0.04, 20).rotateX(Math.PI / 2), tailMat);
        lamp.position.x = -side * k * 0.16;
        tl.add(lamp);
        const ring = new THREE.Mesh(new THREE.TorusGeometry(0.066, 0.012, 6, 20), m.chrome);
        ring.position.copy(lamp.position).add(new THREE.Vector3(0, 0, 0.02));
        tl.add(ring);
      }
    } else {
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.1, 0.05, 2, 0.022), m.gloss);
      tl.add(housing);
      const lens = new THREE.Mesh(new RoundedBoxGeometry(0.4, 0.075, 0.03, 2, 0.015), tailMat);
      lens.position.z = 0.016;
      tl.add(lens);
      const rv = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.03, 0.01), reverseMat);
      rv.position.set(side * 0.13, -0.02, 0.033);
      tl.add(rv);
    }
  }
  if (!body.roundLights && body.lightBar !== false) {
    // Barra de luz en la cara trasera, por debajo del borde del maletero.
    const bar = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.5, 0.022, 0.03, 1, 0.01), tailMat), { cast: false });
    bar.position.set(0, d.yt(-d.half) - 0.06, -d.half + 0.02);
  } else if (body.roundLights) {
    const rv = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.04, 0.03), reverseMat), { cast: false });
    rv.position.set(0, d.yb(-d.half) + 0.12, -d.half + 0.01);
  }
  const rearPlate = add(plate('RUN 01'), { cast: false });
  rearPlate.position.set(0, (d.yb(-d.half) + d.yt(-d.half)) / 2 - 0.02, -d.half - 0.004);
  rearPlate.rotation.y = Math.PI;

  // Escapes: punta cromada con interior negro.
  const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.055, 0.16, 16, 1, true);
  exhaustGeo.rotateX(Math.PI / 2);
  const exhaustInGeo = new THREE.CircleGeometry(0.048, 16);
  for (const side of [-1, 1]) {
    for (const k of body.wing === 'gt' || body.scoop ? [0.3, 0.44] : [0.38]) {
      const ex = add(new THREE.Mesh(exhaustGeo, m.chrome), { cast: false });
      ex.position.set(side * k, 0.26, -L / 2 + 0.08);
      const hole = add(new THREE.Mesh(exhaustInGeo, m.exhaustIn), { cast: false });
      hole.position.set(side * k, 0.26, -L / 2 + 0.07);
      hole.rotation.y = Math.PI;
    }
  }

  // Retrovisores con carcasa pintada, pie y espejo.
  for (const side of [-1, 1]) {
    const mz = d.front - 0.16;
    const my = d.yt(mz) + 0.07;
    const mx = side * (d.widthAt(mz) * 0.86);
    const housing = add(new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.11, 0.12, 2, 0.045), body.chrome ? m.chrome : paint));
    housing.position.set(mx + side * 0.06, my, mz);
    housing.rotation.y = side * 0.12;
    const glass = add(new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.08), m.mirror), { cast: false });
    glass.position.set(mx + side * 0.06, my, mz - 0.062);
    glass.rotation.y = Math.PI + side * 0.12;
    const stalk = add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.05), m.trim), { cast: false });
    stalk.position.set(mx - side * 0.02, my - 0.05, mz + 0.02);
  }

  // Tomas laterales y cromados.
  for (const side of [-1, 1]) {
    if (body.intakes) {
      const iz = -d.zf + d.ra + 0.22;
      const vent = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.13, 0.05, 2, 0.02), m.grille);
      placeOnBody(vent, d, iz, phiAtHeight(d.section(iz), 0.56, side), { inset: 0.01 });
      vent.castShadow = false;
      chassis.add(vent);
    }
  }
  if (body.chrome) {
    for (const [zz, ry] of [[L / 2 - 0.02, 0], [-L / 2 + 0.03, Math.PI]]) {
      const bumper = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.84, 0.07, 0.08, 2, 0.03), m.chrome));
      bumper.position.set(0, 0.32, zz);
      bumper.rotation.y = ry;
    }
  }
  if (body.scoop) {
    const sz = d.front + (d.half - d.front) * 0.42;
    const scoop = add(new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.11, 0.75, 2, 0.05), paint));
    scoop.position.set(0, d.yt(sz) + 0.025, sz);
    const mouth = add(new THREE.Mesh(new RoundedBoxGeometry(0.48, 0.07, 0.04, 2, 0.02), m.grille), { cast: false });
    mouth.position.set(0, d.yt(sz) + 0.04, sz + 0.37);
  }

  // Alerones: perfil alar extruido con derivas y soportes de cuello de cisne.
  const deck = d.deck;
  const wing = body.wing === true ? 'gt' : body.wing ?? 'none';
  if (wing === 'gt') {
    const ws = body.wingSize ?? 1;
    const chord = 0.34 * ws;
    const span = W * 0.94;
    const foil = new THREE.Shape();
    foil.moveTo(0, 0);
    foil.bezierCurveTo(chord * 0.15, 0.045, chord * 0.6, 0.04, chord, 0.012);
    foil.lineTo(chord, -0.004);
    foil.bezierCurveTo(chord * 0.6, 0.004, chord * 0.2, -0.012, 0, 0);
    const foilGeo = new THREE.ExtrudeGeometry(foil, { depth: span, bevelEnabled: false, curveSegments: 10 });
    foilGeo.translate(0, 0, -span / 2);
    foilGeo.rotateY(Math.PI / 2);
    const wy = deck + 0.3 * ws;
    const wz = -L / 2 + 0.18 + chord;
    const wingMesh = add(new THREE.Mesh(foilGeo, m.carbon));
    wingMesh.position.set(0, wy, wz);
    wingMesh.rotation.x = -0.12;
    const plateGeo = new RoundedBoxGeometry(0.02, 0.2, chord * 1.25, 1, 0.008);
    for (const side of [-1, 1]) {
      const post = add(new THREE.Mesh(new RoundedBoxGeometry(0.025, 0.32 * ws, 0.12, 1, 0.01), m.carbon));
      post.position.set(side * W * 0.26, deck + 0.13 * ws, wz - chord * 0.55);
      post.rotation.x = -0.25;
      const ep = add(new THREE.Mesh(plateGeo, m.carbon));
      ep.position.set(side * span / 2, wy - 0.04, wz - chord / 2);
    }
  } else if (wing === 'duck') {
    const lipZ = -L / 2 + 0.2;
    const lip = add(new THREE.Mesh(new RoundedBoxGeometry(d.widthAt(lipZ) * 1.5, 0.035, 0.18, 2, 0.015), paint));
    lip.position.set(0, d.yt(lipZ) + 0.035, lipZ);
    lip.rotation.x = 0.32;
  } else if (wing === 'roof') {
    const rz = d.rearTop - 0.05;
    const sp = add(new THREE.Mesh(new RoundedBoxGeometry(W * 0.8, 0.045, 0.34, 2, 0.02), paint));
    sp.position.set(0, roofLine(d, rz) + 0.01, rz - 0.04);
    sp.rotation.x = 0.18;
  }

  // Sombra de contacto suave bajo el coche.
  const blobGeo = new THREE.PlaneGeometry(W * 1.45, L * 1.18);
  blobGeo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobGeo, m.shadow);
  blob.name = 'contactShadow';
  blob.position.y = 0.03;
  blob.renderOrder = -1;
  chassis.add(blob);

  const zf = dim.wheelBase / 2;
  const wheels = WHEEL_NAMES.map((name, i) => {
    const pivot = new THREE.Group();
    pivot.name = name;
    const left = i % 2 === 0;
    const front = i < 2;
    pivot.position.set((left ? 1 : -1) * dim.halfTrack, dim.visualOffsetY + dim.wheelRadius, (front ? 1 : -1) * zf);
    pivot.add(buildWheel(dim, body, left ? 1 : -1));
    const caliper = buildCaliper(dim, body);
    caliper.position.x = (left ? 1 : -1) * 0.02;
    pivot.add(caliper);
    root.add(pivot);
    return pivot;
  });

  const disposables = [...own];
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !disposables.includes(o.geometry)) disposables.push(o.geometry);
    if (o.userData.ownMaterial) disposables.push(o.userData.ownMaterial);
    if (o.isMesh && o.material !== m.caliper && o.material?.color && o.material.isMeshStandardMaterial && !Object.values(shared).includes(o.material)
      && !Object.values(rimMaterials).includes(o.material) && !disposables.includes(o.material)) disposables.push(o.material);
  });
  root.userData = { paint, bodyPaint, tailMat, reverseMat, dim, disposables };
  return { root, wheels, tailMat, reverseMat, dim };
}

/** Carga un GLB con nodos chassis/wheel_*; si no hay GLB devuelve el procedural. */
export async function createCar(def, color, opts) {
  const url = CAR_GLB[def.id];
  if (!url) return createProceduralCar(def, color, opts);
  const gltf = await new GLTFLoader().loadAsync(url);
  const root = new THREE.Group();
  const chassis = gltf.scene.getObjectByName('chassis') ?? gltf.scene;
  root.add(gltf.scene);
  gltf.scene.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  const wheels = WHEEL_NAMES.map((n) => {
    const w = gltf.scene.getObjectByName(n);
    const pivot = new THREE.Group();
    pivot.name = n;
    if (w) {
      pivot.position.copy(w.position);
      w.position.set(0, 0, 0);
      w.name = 'spin';
      pivot.add(w);
      root.add(pivot);
    }
    return pivot;
  });
  chassis.traverse((o) => {
    if (o.isMesh && o.material?.color && /paint|body/i.test(o.material.name)) o.material.color.set(color);
  });
  const dim = carDimensions(def);
  root.userData = { dim, disposables: [] };
  return { root, wheels, tailMat: null, dim };
}

/**
 * Aplica el estado de las ruedas (de físicas o de red) al modelo.
 * @param {THREE.Object3D[]} wheels pivotes
 */
export function poseWheels(wheels, dim, { steer, spin, suspension }) {
  for (let i = 0; i < wheels.length; i++) {
    const pivot = wheels[i];
    if (!pivot) continue;
    if (i < 2) pivot.rotation.y = steer;
    const s = pivot.children[0];
    if (s) s.rotation.x = spin;
    if (suspension) pivot.position.y = dim.connectionY - suspension[i];
  }
}

export function disposeCar(car) {
  car.root.removeFromParent();
  car.root.userData.disposables?.forEach((d) => d.dispose());
}
