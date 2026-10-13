import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { carDimensions } from './carGeometry.js';
import { softDotTexture } from './textures.js';

/**
 * Modelos de coche. La jerarquía sigue la especificación de assets del README
 * (`chassis`, `wheel_fl`, `wheel_fr`, `wheel_rl`, `wheel_rr`), así que un GLB
 * con esos nodos puede sustituir al modelo procedural sin tocar el motor.
 *
 * Estructura devuelta:
 *   root (origen = cuerpo rígido)
 *     chassis (desplazado al suelo)
 *     wheel_xx (pivote de dirección) > spin (giro de rodadura)
 */
export const WHEEL_NAMES = ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr'];

/** Rutas GLB opcionales por modelo, p. ej. { sport: '/assets/cars/car_sport.glb' }. */
export const CAR_GLB = {};

const shared = {};
function sharedMaterials() {
  if (shared.glass) return shared;
  shared.glass = new THREE.MeshPhysicalMaterial({ color: '#0d1117', metalness: 0.2, roughness: 0.05, clearcoat: 1, envMapIntensity: 1.6 });
  shared.trim = new THREE.MeshStandardMaterial({ color: '#111214', roughness: 0.55, metalness: 0.3 });
  shared.tire = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.92 });
  shared.rim = new THREE.MeshStandardMaterial({ color: '#c9ccd2', metalness: 0.95, roughness: 0.22 });
  shared.disc = new THREE.MeshStandardMaterial({ color: '#555', metalness: 0.8, roughness: 0.4 });
  shared.chrome = new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 1, roughness: 0.15 });
  shared.headlight = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 1.6, roughness: 0.1 });
  shared.shadow = new THREE.MeshBasicMaterial({ map: softDotTexture(), color: '#000', transparent: true, opacity: 0.55, depthWrite: false });
  return shared;
}

function smooth(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Interpola linealmente una polilínea [[z, y], ...] ordenada por z. */
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

/**
 * Superficie "lofteada": secciones transversales superelípticas a lo largo
 * del eje Z. Da carrocerías suaves con normales correctas, cosa que un
 * extruido no consigue.
 * @param {(z: number) => {yb: number, yt: number, w: number, n?: number, taper?: number}} section
 */
function loft(z0, z1, section, { rings = 64, segs = 40, phiFrom = -Math.PI / 2, phiTo = Math.PI * 1.5, closed = true } = {}) {
  const positions = [];
  const indices = [];
  const cols = segs + 1;
  for (let i = 0; i <= rings; i++) {
    const z = lerp(z0, z1, i / rings);
    const { yb, yt, w, n = 4, taper = 0 } = section(z);
    const yc = (yb + yt) / 2;
    const hh = Math.max(0.001, (yt - yb) / 2);
    for (let j = 0; j <= segs; j++) {
      const phi = lerp(phiFrom, phiTo, j / segs);
      const c = Math.cos(phi);
      const sn = Math.sin(phi);
      const y = yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / n);
      let x = w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      x *= 1 - taper * Math.max(0, (y - yc) / hh);
      positions.push(x, y, z);
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
  const hood = H * 0.68;
  const deck = H * 0.72 + (body.wing ? -0.03 : 0.02);
  const front = L * 0.17;
  const back = -L * 0.3;
  const roofLen = L * body.cabinScale * 0.5;
  const wsTop = front - (H - hood) * 2.1;
  const top = [
    [-half, deck - 0.2],
    [-half + 0.25, deck - 0.02],
    [back, deck],
    [front, hood + 0.04],
    [half - 0.45, hood - 0.08],
    [half, hood - 0.3],
  ];
  const bottomBase = [
    [-half, 0.36],
    [-half + 0.3, 0.22],
    [half - 0.35, 0.2],
    [half, 0.3],
  ];
  const yt = (z) => {
    let y = profile(top, z);
    // Aletas: la carrocería se abomba sobre cada rueda.
    for (const c of [-zf, zf]) {
      const d = Math.abs(z - c) / (ra + 0.35);
      if (d < 1) y = Math.max(y, wc + ra + 0.06 - d * d * 0.12);
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
  const endRound = (z) => {
    const r = 0.42;
    const d = Math.abs(z) - (half - r);
    return d > 0 ? Math.sqrt(Math.max(0, 1 - (d / r) ** 2)) : 1;
  };
  const halfW = dim.width / 2;
  const widthAt = (z) => halfW * (1 - 0.1 * Math.pow(Math.abs(z) / half, 4)) * endRound(z);
  return { L, H, half, hood, deck, front, back, roofLen, wsTop, yt, yb, widthAt, halfW };
}

function roofLine(d, z) {
  const { front, back, roofLen, wsTop, H, yt } = d;
  const base = yt(z) - 0.04;
  if (z >= front || z <= back) return base;
  const rearTop = wsTop - roofLen;
  if (z >= wsTop) return lerp(H, base, smooth(wsTop, front, z) ** 0.8);
  if (z >= rearTop) return H + 0.015 * Math.sin(((z - rearTop) / roofLen) * Math.PI);
  return lerp(base, H, smooth(back, rearTop, z) ** 0.7);
}

function buildWheel(dim) {
  const m = sharedMaterials();
  const r = dim.wheelRadius;
  const w = 0.27;
  const spin = new THREE.Group();
  spin.name = 'spin';
  const tireGeo = new THREE.CylinderGeometry(r, r, w, 28, 1);
  tireGeo.rotateZ(Math.PI / 2);
  const tire = new THREE.Mesh(tireGeo, m.tire);
  tire.castShadow = true;
  spin.add(tire);
  const rimGeo = new THREE.CylinderGeometry(r * 0.68, r * 0.68, w + 0.02, 24, 1);
  rimGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(rimGeo, m.rim));
  const discGeo = new THREE.CylinderGeometry(r * 0.5, r * 0.5, w + 0.03, 20);
  discGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(discGeo, m.disc));
  const spokeGeo = new THREE.BoxGeometry(w + 0.05, r * 1.25, 0.07);
  for (let i = 0; i < 5; i++) {
    const spoke = new THREE.Mesh(spokeGeo, m.rim);
    spoke.rotation.x = (i / 5) * Math.PI;
    spin.add(spoke);
  }
  const hubGeo = new THREE.CylinderGeometry(0.06, 0.06, w + 0.06, 10);
  hubGeo.rotateZ(Math.PI / 2);
  spin.add(new THREE.Mesh(hubGeo, m.chrome));
  return spin;
}

/** Modelo procedural de un coche con la pintura indicada. */
export function createProceduralCar(def, color) {
  const dim = carDimensions(def);
  const body = def.body;
  const m = sharedMaterials();
  const root = new THREE.Group();
  root.name = `car_${def.id}`;

  const paint = new THREE.MeshPhysicalMaterial({
    color,
    metalness: 0.55,
    roughness: 0.3,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.2,
  });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#4a0000', emissive: '#ff1010', emissiveIntensity: 0.6, roughness: 0.2 });

  const chassis = new THREE.Group();
  chassis.name = 'chassis';
  chassis.position.y = dim.visualOffsetY;
  root.add(chassis);

  const d = bodyDesign(dim, body);
  const bodyGeo = loft(-d.half, d.half, (z) => ({
    yb: d.yb(z),
    yt: d.yt(z),
    w: d.widthAt(z),
    n: 7,
    taper: 0.14,
  }), { rings: 90, segs: 44 });
  const bodyMesh = new THREE.Mesh(bodyGeo, paint);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  chassis.add(bodyMesh);

  // Habitáculo de cristal y techo pintado encima (parabrisas y ventanillas a la vista).
  const cabinSection = (inflate) => (z) => {
    const yb = d.yt(z) - 0.12;
    return { yb, yt: Math.max(yb + 0.01, roofLine(d, z)) + inflate, w: d.widthAt(z) * 0.86 + inflate, n: 3.4, taper: 0.34 };
  };
  const cabin = new THREE.Mesh(loft(d.back, d.front, cabinSection(0), { rings: 50, segs: 36 }), m.glass);
  cabin.castShadow = true;
  chassis.add(cabin);
  const roofGeo = loft(d.wsTop - d.roofLen - 0.12, d.wsTop + 0.02, cabinSection(0.012), {
    rings: 24, segs: 18, phiFrom: Math.PI / 2 - 0.85, phiTo: Math.PI / 2 + 0.85, closed: false,
  });
  const roofMesh = new THREE.Mesh(roofGeo, paint);
  roofMesh.castShadow = true;
  chassis.add(roofMesh);
  // Montantes traseros pintados (pilar C) para un perfil de coupé.
  for (const side of [-1, 1]) {
    const pillar = loft(d.back + 0.1, d.wsTop - d.roofLen + 0.05, cabinSection(0.008), {
      rings: 16, segs: 6,
      phiFrom: side > 0 ? -0.2 : Math.PI - 0.9,
      phiTo: side > 0 ? 0.9 : Math.PI + 0.2,
      closed: false,
    });
    chassis.add(new THREE.Mesh(pillar, paint));
  }

  // Bajos oscuros: faldones, splitter y difusor.
  const L = dim.length;
  const skirtGeo = new THREE.BoxGeometry(dim.width * 0.9, 0.1, L * 0.86);
  const skirt = new THREE.Mesh(skirtGeo, m.trim);
  skirt.position.y = 0.2;
  chassis.add(skirt);
  const splitterGeo = new THREE.BoxGeometry(dim.width * 0.8, 0.05, 0.3);
  const splitter = new THREE.Mesh(splitterGeo, m.trim);
  splitter.position.set(0, 0.22, L / 2 - 0.4);
  chassis.add(splitter);

  // Faros apoyados sobre la superficie del capó, con su misma inclinación.
  const hlZ = L / 2 - 0.36;
  const hlSlope = Math.atan2(d.yt(hlZ + 0.1) - d.yt(hlZ - 0.1), 0.2);
  const lightGeo = new THREE.BoxGeometry(0.42, 0.03, 0.2);
  const tailZ = -L / 2 + 0.24;
  const tailGeo = new THREE.BoxGeometry(0.32, 0.07, 0.05);
  const tailY = d.yt(tailZ) - 0.12;
  for (const side of [-1, 1]) {
    const hl = new THREE.Mesh(lightGeo, m.headlight);
    hl.position.set(side * dim.width * 0.29, d.yt(hlZ) - 0.005, hlZ);
    hl.rotation.x = -hlSlope;
    chassis.add(hl);
    const tl = new THREE.Mesh(tailGeo, tailMat);
    tl.position.set(side * d.widthAt(tailZ - 0.14) * 0.52, tailY, tailZ - 0.14);
    chassis.add(tl);
    const mirrorGeo = new THREE.BoxGeometry(0.16, 0.09, 0.14);
    const mirror = new THREE.Mesh(mirrorGeo, paint);
    mirror.position.set(side * (d.widthAt(d.front) * 0.9), d.yt(d.front) + 0.02, d.front - 0.18);
    chassis.add(mirror);
    const exhaustGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.2, 12);
    exhaustGeo.rotateX(Math.PI / 2);
    const exhaust = new THREE.Mesh(exhaustGeo, m.chrome);
    exhaust.position.set(side * 0.35, 0.3, -L / 2 + 0.16);
    chassis.add(exhaust);
  }
  const grilleGeo = new THREE.BoxGeometry(dim.width * 0.46, 0.14, 0.08);
  const grille = new THREE.Mesh(grilleGeo, m.trim);
  grille.position.set(0, 0.36, L / 2 - 0.06);
  chassis.add(grille);
  const belt = d.deck;

  if (body.wing) {
    const wingGeo = new THREE.BoxGeometry(dim.width * 0.92, 0.04, 0.38);
    const wing = new THREE.Mesh(wingGeo, m.trim);
    wing.position.set(0, belt + 0.32, -L / 2 + 0.3);
    wing.rotation.x = 0.12;
    wing.castShadow = true;
    chassis.add(wing);
    const postGeo = new THREE.BoxGeometry(0.05, 0.3, 0.14);
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(postGeo, m.trim);
      post.position.set(side * dim.width * 0.3, belt + 0.16, -L / 2 + 0.32);
      chassis.add(post);
    }
  }

  // Sombra de contacto suave bajo el coche.
  const blobGeo = new THREE.PlaneGeometry(dim.width * 1.5, dim.length * 1.25);
  blobGeo.rotateX(-Math.PI / 2);
  const blob = new THREE.Mesh(blobGeo, m.shadow);
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
    const spin = buildWheel(dim);
    pivot.add(spin);
    root.add(pivot);
    return pivot;
  });

  root.userData = { paint, tailMat, dim, disposables: [paint, tailMat] };
  root.traverse((o) => {
    if (o.isMesh && o.geometry && !root.userData.disposables.includes(o.geometry)) root.userData.disposables.push(o.geometry);
  });
  return { root, wheels, tailMat, dim };
}

/** Carga un GLB con nodos chassis/wheel_*; si no hay GLB devuelve el procedural. */
export async function createCar(def, color) {
  const url = CAR_GLB[def.id];
  if (!url) return createProceduralCar(def, color);
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
