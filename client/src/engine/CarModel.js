// Construye la parte visual de un coche a partir de su glTF: aplica la variante de material
// (KHR_materials_variants), el color del jugador y separa las ruedas en pivotes propios
// (dirección + giro) aunque en el modelo original no estén centradas en su eje.
import * as THREE from 'three';
import { assets } from './Assets.js';

const templates = new Map();

async function loadTemplate(model) {
  if (templates.has(model.url)) return templates.get(model.url);
  const promise = (async () => {
    const gltf = await assets.gltf(model.url);
    const parser = gltf.parser;
    const json = parser.json;
    const variantNames = (json.extensions?.KHR_materials_variants?.variants ?? []).map((v) => v.name);

    // Lista de mallas en orden de recorrido, con sus materiales por variante.
    const meshes = [];
    gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
    const variantMaterials = await Promise.all(meshes.map(async (mesh) => {
      const assoc = parser.associations.get(mesh);
      if (!assoc || assoc.meshes === undefined) return null;
      const prim = json.meshes[assoc.meshes]?.primitives?.[assoc.primitives ?? 0];
      const mappings = prim?.extensions?.KHR_materials_variants?.mappings;
      if (!mappings) return null;
      const byVariant = new Map();
      for (const m of mappings) {
        const mat = await parser.getDependency('material', m.material);
        for (const v of m.variants) byVariant.set(variantNames[v], mat);
      }
      return byVariant;
    }));

    // Ajustes de rendimiento: el vidrio con transmisión obliga a un pase extra de render.
    const fixMaterial = (mat) => {
      if (mat.transmission > 0) {
        mat.transmission = 0;
        mat.transparent = true;
        mat.opacity = 0.32;
        mat.roughness = 0.05;
        mat.metalness = 0.1;
        mat.depthWrite = false;
      }
    };
    gltf.scene.traverse((o) => { if (o.isMesh) fixMaterial(o.material); });
    for (const map of variantMaterials) if (map) map.forEach(fixMaterial);

    // Medidas precisas (vértice a vértice) una sola vez: las cajas de los nodos rotados
    // del modelo saldrían infladas con el cálculo rápido.
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const wheelData = model.wheels.map((name) => {
      const node = gltf.scene.getObjectByName(name);
      if (!node) return null;
      // El centro del buje sale del neumático (la pinza de freno sobresale y desplazaría la caja).
      const parts = node.children.filter((c) => !/brake/i.test(c.name));
      let tire = node, best = -1;
      for (const c of parts) {
        box.setFromObject(c, true);
        const v = box.getSize(new THREE.Vector3());
        if (v.x * v.y * v.z > best) { best = v.x * v.y * v.z; tire = c; }
      }
      box.setFromObject(tire, true);
      const size = box.getSize(new THREE.Vector3());
      // En el modelo original las ruedas delanteras vienen giradas (pose de exposición).
      // El eje local X de la rueda es su eje de giro: calculamos la rotación que lo
      // devuelve al eje X del coche para que la rueda quede recta.
      const q = node.getWorldQuaternion(new THREE.Quaternion());
      const axle = new THREE.Vector3(1, 0, 0).applyQuaternion(q).normalize();
      const straighten = new THREE.Quaternion().setFromUnitVectors(axle, new THREE.Vector3(Math.sign(axle.x) || 1, 0, 0));
      return { center: box.getCenter(new THREE.Vector3()), radius: size.y / 2, width: Math.min(size.x, size.z), straighten };
    });
    const bounds = new THREE.Box3().setFromObject(gltf.scene, true);

    return { scene: gltf.scene, meshCount: meshes.length, variantMaterials, wheelData, bounds };
  })();
  templates.set(model.url, promise);
  return promise;
}

/**
 * Crea una instancia visual del coche.
 * @returns {Promise<CarVisual>}
 */
export async function createCarVisual(carDef, color, { shadows = true } = {}) {
  const tpl = await loadTemplate(carDef.model);
  const root = new THREE.Group();
  root.name = `car-${carDef.id}`;
  const body = tpl.scene.clone(true);
  root.add(body);

  // Variante de material + color del jugador
  const paint = new THREE.Color(color);
  const brakeMaterials = [];
  let idx = 0;
  const materialCache = new Map();
  const personalize = (mat) => {
    if (materialCache.has(mat)) return materialCache.get(mat);
    let out = mat;
    if (/^Paint 1/i.test(mat.name)) {
      out = mat.clone();
      out.color.copy(paint);
      out.map = null;
      out.metalness = Math.max(out.metalness, 0.55);
      out.roughness = Math.min(out.roughness, 0.32);
    } else if (/brakelight/i.test(mat.name)) {
      out = mat.clone();
      out.emissive = new THREE.Color(0xff1a1a);
      out.emissiveIntensity = 0.3;
      brakeMaterials.push(out);
    }
    materialCache.set(mat, out);
    return out;
  };
  body.traverse((o) => {
    if (!o.isMesh) return;
    const variants = tpl.variantMaterials[idx++];
    const base = variants?.get(carDef.variant) ?? o.material;
    o.material = personalize(base);
    o.castShadow = shadows;
    o.receiveShadow = false;
  });

  // Ruedas: pivote de dirección (Y) → pivote de giro (X) → malla original.
  root.updateMatrixWorld(true);
  const wheels = carDef.model.wheels.map((name, wi) => {
    const node = body.getObjectByName(name);
    const data = tpl.wheelData[wi];
    if (!node || !data) return null;
    const center = data.center.clone();
    const steer = new THREE.Group();
    steer.position.copy(center);
    const spin = new THREE.Group();
    steer.add(spin);
    root.add(steer);
    // Pivote extra que endereza la rueda alrededor de su propio centro.
    const fix = new THREE.Group();
    spin.add(fix);
    steer.updateMatrixWorld(true);
    fix.attach(node);
    fix.quaternion.copy(data.straighten);
    fix.updateMatrixWorld(true);
    // Las pinzas de freno giran con la dirección pero no con la rueda.
    const pads = [];
    node.traverse((c) => { if (/brakepad/i.test(c.name)) pads.push(c); });
    pads.forEach((p) => steer.attach(p));
    return { steer, spin, center, radius: data.radius, width: data.width };
  });

  const bounds = tpl.bounds.clone();
  return {
    root,
    wheels,
    bounds,
    setBraking(on) {
      for (const m of brakeMaterials) m.emissiveIntensity = on ? 4 : 0.3;
    },
    /** steer en radianes; spin = ángulo acumulado de la rueda. */
    setWheels(steerAngles, spinAngles) {
      wheels.forEach((w, i) => {
        if (!w) return;
        w.steer.rotation.y = steerAngles[i] ?? 0;
        w.spin.rotation.x = spinAngles[i] ?? 0;
      });
    },
    dispose() {
      materialCache.forEach((m, original) => { if (m !== original) m.dispose(); });
    },
  };
}

/** Medidas de un coche para la física, leídas del propio modelo. */
export async function measureCar(carDef) {
  const visual = await createCarVisual(carDef, '#ffffff', { shadows: false });
  const { bounds, wheels } = visual;
  const result = {
    bounds: bounds.clone(),
    wheels: wheels.map((w) => (w ? { x: w.center.x, y: w.center.y, z: w.center.z, radius: w.radius } : null)),
  };
  visual.dispose();
  return result;
}
