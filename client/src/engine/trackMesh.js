/**
 * Genera la geometría (arrays planos) de una pista a partir del trazado
 * compartido: asfalto, pianos (curbs), escapatorias y muros. La usan tanto el
 * render (Three.js) como las físicas (colliders trimesh de Rapier), así que no
 * depende de ninguna de las dos librerías.
 */
export const TRACK_LAYOUT = {
  curbWidth: 1.1,
  runoff: 7,
  wallHeight: 1.1,
  wallThickness: 0.5,
};

function strip(path, innerOffset, outerOffset, yInner = 0, yOuter = 0, uScale = 1) {
  // Banda a lo largo del trazado entre dos desplazamientos laterales.
  const { points, rights, count, step } = path;
  const positions = new Float32Array((count + 1) * 2 * 3);
  const uvs = new Float32Array((count + 1) * 2 * 2);
  const indices = new Uint32Array(count * 6);
  for (let i = 0; i <= count; i++) {
    const k = i % count;
    const p = points[k];
    const r = rights[k];
    const o = i * 6;
    positions[o] = p[0] + r[0] * innerOffset;
    positions[o + 1] = p[1] + yInner;
    positions[o + 2] = p[2] + r[2] * innerOffset;
    positions[o + 3] = p[0] + r[0] * outerOffset;
    positions[o + 4] = p[1] + yOuter;
    positions[o + 5] = p[2] + r[2] * outerOffset;
    const v = (i * step) / uScale;
    uvs.set([0, v, 1, v], i * 4);
  }
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    // Caras mirando hacia arriba (+Y) sea cual sea el lado de la banda.
    if (outerOffset > innerOffset) indices.set([a, b, c, b, d, c], i * 6);
    else indices.set([a, c, b, b, c, d], i * 6);
  }
  return { positions, uvs, indices };
}

/**
 * Muro vertical como banda con dos caras. Se prolonga `skirt` metros bajo el
 * suelo para tapar cualquier desnivel entre pista y terreno.
 */
function wall(path, offset, height, base, skirt = 3) {
  const { points, rights, count, step } = path;
  const positions = new Float32Array((count + 1) * 2 * 3);
  const uvs = new Float32Array((count + 1) * 2 * 2);
  const indices = new Uint32Array(count * 12);
  for (let i = 0; i <= count; i++) {
    const k = i % count;
    const p = points[k];
    const r = rights[k];
    const x = p[0] + r[0] * offset;
    const z = p[2] + r[2] * offset;
    positions.set([x, p[1] + base - skirt, z, x, p[1] + base + height, z], i * 6);
    const u = (i * step) / 4;
    uvs.set([u, -skirt / height, u, 1], i * 4);
  }
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    indices.set([a, a + 2, a + 1, a + 1, a + 2, a + 3, a, a + 1, a + 2, a + 1, a + 3, a + 2], i * 12);
  }
  return { positions, uvs, indices };
}

export function buildTrackMesh(path) {
  const w = path.width / 2;
  const { curbWidth, runoff, wallHeight } = TRACK_LAYOUT;
  const edge = w + curbWidth;
  const outer = edge + runoff;
  return {
    road: strip(path, -w, w, 0, 0, path.width),
    curbLeft: strip(path, -w, -edge, 0.02, 0.06, 4),
    curbRight: strip(path, w, edge, 0.02, 0.06, 4),
    runoffLeft: strip(path, -edge, -outer, 0.06, 0.1, 6),
    runoffRight: strip(path, edge, outer, 0.06, 0.1, 6),
    wallLeft: wall(path, -outer, wallHeight, 0.05),
    wallRight: wall(path, outer, wallHeight, 0.05),
    // Muros físicos más altos que los visibles: un coche nunca puede saltarlos.
    wallLeftCollider: wall(path, -outer, 4, 0.05),
    wallRightCollider: wall(path, outer, 4, 0.05),
    halfWidth: w,
    outerOffset: outer,
  };
}
