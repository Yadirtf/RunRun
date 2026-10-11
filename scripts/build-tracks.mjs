// Genera los datos de pista (shared/tracks/*.json) a partir de trazados reales.
// Fuente: https://github.com/bacinger/f1-circuits (licencia MIT, (c) Tomislav Bacinger).
// Proyecta lon/lat a metros, suaviza y remuestrea la línea central a espaciado uniforme.
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'shared', 'tracks');
const SOURCE = 'https://raw.githubusercontent.com/bacinger/f1-circuits/master/circuits';
const SPACING = 5; // metros entre puntos de la línea central

const TRACKS = [
  { id: 'spielberg', file: 'at-1969', name: 'Spielberg', country: 'Austria', width: 14, laps: 3, env: { sun: [0.55, 0.62, -0.3] } },
  { id: 'interlagos', file: 'br-1940', name: 'Interlagos', country: 'Brasil', width: 14, laps: 3, env: { sun: [-0.4, 0.7, 0.35] } },
  { id: 'monza', file: 'it-1922', name: 'Monza', country: 'Italia', width: 14, laps: 2, env: { sun: [0.3, 0.55, 0.6] } },
  { id: 'zandvoort', file: 'nl-1948', name: 'Zandvoort', country: 'Países Bajos', width: 13, laps: 3, env: { sun: [-0.6, 0.5, -0.4] } },
];

function project(coords) {
  let lon0 = 0, lat0 = 0;
  for (const [lon, lat] of coords) { lon0 += lon; lat0 += lat; }
  lon0 /= coords.length; lat0 /= coords.length;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const kz = 110540;
  // x = este, z = sur (el norte queda hacia -z, como en un mapa visto desde arriba)
  return coords.map(([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * kz]);
}

function dedupe(points) {
  const out = [];
  for (const p of points) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.5) out.push(p);
  }
  const a = out[0], b = out[out.length - 1];
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1) out.pop();
  return out;
}

// Catmull-Rom centrípeta cerrada, muestreada densamente.
function catmullRomClosed(points, samplesPerSeg = 12) {
  const n = points.length;
  const out = [];
  const get = (i) => points[(i + n) % n];
  for (let i = 0; i < n; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const t01 = Math.pow(Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), 0.5) || 1e-4;
    const t12 = Math.pow(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), 0.5) || 1e-4;
    const t23 = Math.pow(Math.hypot(p3[0] - p2[0], p3[1] - p2[1]), 0.5) || 1e-4;
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const pt = [0, 0];
      for (let k = 0; k < 2; k++) {
        const m1 = (p2[k] - p1[k] + t12 * ((p1[k] - p0[k]) / t01 - (p2[k] - p0[k]) / (t01 + t12)));
        const m2 = (p2[k] - p1[k] + t12 * ((p3[k] - p2[k]) / t23 - (p3[k] - p1[k]) / (t12 + t23)));
        const a = 2 * p1[k] - 2 * p2[k] + m1 + m2;
        const b = -3 * p1[k] + 3 * p2[k] - 2 * m1 - m2;
        pt[k] = a * t * t * t + b * t * t + m1 * t + p1[k];
      }
      out.push(pt);
    }
  }
  return out;
}

function resample(points, spacing) {
  const n = points.length;
  const cum = [0];
  for (let i = 1; i <= n; i++) {
    const a = points[i - 1], b = points[i % n];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = cum[n];
  const count = Math.round(total / spacing);
  const step = total / count;
  const out = [];
  let seg = 0;
  for (let i = 0; i < count; i++) {
    const d = i * step;
    while (cum[seg + 1] < d) seg++;
    const a = points[seg], b = points[(seg + 1) % n];
    const t = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return { points: out, length: total };
}

function smooth(points, iterations, strength = 0.5) {
  let pts = points;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    pts = pts.map((p, i) => {
      const a = pts[(i - 1 + n) % n], b = pts[(i + 1) % n];
      return [p[0] + strength * ((a[0] + b[0]) / 2 - p[0]), p[1] + strength * ((a[1] + b[1]) / 2 - p[1])];
    });
  }
  return pts;
}

async function buildTrack(def) {
  const res = await fetch(`${SOURCE}/${def.file}.geojson`);
  if (!res.ok) throw new Error(`No se pudo descargar ${def.file}: ${res.status}`);
  const geo = await res.json();
  const feature = geo.features[0];
  const props = feature.properties;
  let coords = feature.geometry.coordinates;
  if (feature.geometry.type === 'MultiLineString') coords = coords.flat();

  const raw = dedupe(project(coords));
  const dense = catmullRomClosed(raw);
  let { points } = resample(dense, 1);
  points = smooth(points, 30);
  const result = resample(points, SPACING);

  const round = (v) => Math.round(v * 100) / 100;
  return {
    id: def.id,
    name: def.name,
    fullName: props.Name,
    location: props.Location,
    country: def.country,
    officialLength: props.length,
    length: Math.round(result.length),
    width: def.width,
    defaultLaps: def.laps,
    env: def.env,
    source: {
      dataset: 'bacinger/f1-circuits',
      url: `https://github.com/bacinger/f1-circuits/blob/master/circuits/${def.file}.geojson`,
      license: 'MIT',
    },
    points: result.points.map(([x, z]) => [round(x), round(z)]),
  };
}

await mkdir(OUT_DIR, { recursive: true });
const index = [];
for (const def of TRACKS) {
  const track = await buildTrack(def);
  await writeFile(path.join(OUT_DIR, `${track.id}.json`), JSON.stringify(track));
  index.push({ id: track.id, name: track.name, fullName: track.fullName, country: track.country, length: track.length, defaultLaps: track.defaultLaps });
  console.log(`${track.id}: ${track.points.length} puntos, ${track.length} m (oficial ${track.officialLength} m)`);
}
await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify(index, null, 2));

// Módulo JS con todos los datos, importable igual desde Node y desde Vite.
const all = {};
for (const t of index) {
  const { readFile } = await import('node:fs/promises');
  all[t.id] = JSON.parse(await readFile(path.join(OUT_DIR, `${t.id}.json`), 'utf8'));
}
await writeFile(
  path.join(ROOT, 'shared', 'src', 'trackData.js'),
  '// Generado por scripts/build-tracks.mjs. No editar a mano.\n' +
  '// Trazados: bacinger/f1-circuits (MIT).\n' +
  `export default ${JSON.stringify(all)};\n`,
);
