// Descarga y optimiza los recursos 3D con licencia libre que usa el juego.
// Los resultados se guardan en client/public/game y se versionan en git, así que este
// script solo hace falta para regenerarlos o añadir recursos nuevos. Ver CREDITOS.md.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, meshopt, resample, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'client', 'public', 'game');
const CACHE = path.join(ROOT, '.cache', 'assets');

const CAR = {
  url: 'https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models/CarConcept/glTF-Binary/CarConcept.glb',
  out: 'cars/car-concept.glb',
};

const PH = 'https://dl.polyhaven.org/file/ph-assets';
const TEXTURES = [
  // [url, salida, tamaño]
  [`${PH}/Textures/jpg/1k/asphalt_track/asphalt_track_diff_1k.jpg`, 'textures/asphalt_diff.webp', 1024],
  [`${PH}/Textures/jpg/1k/asphalt_track/asphalt_track_nor_gl_1k.jpg`, 'textures/asphalt_nor.webp', 1024],
  [`${PH}/Textures/jpg/1k/asphalt_track/asphalt_track_rough_1k.jpg`, 'textures/asphalt_rough.webp', 1024],
  [`${PH}/Textures/jpg/1k/leafy_grass/leafy_grass_diff_1k.jpg`, 'textures/grass_diff.webp', 1024],
  [`${PH}/Textures/jpg/1k/leafy_grass/leafy_grass_nor_gl_1k.jpg`, 'textures/grass_nor.webp', 1024],
  [`${PH}/Textures/jpg/1k/brushed_concrete/brushed_concrete_diff_1k.jpg`, 'textures/concrete_diff.webp', 512],
  [`${PH}/Textures/jpg/1k/gravel_floor/gravel_floor_diff_1k.jpg`, 'textures/gravel_diff.webp', 512],
];
const HDRI = 'kloofendal_48d_partly_cloudy_puresky';
const ENV = [
  [`${PH}/HDRIs/hdr/1k/${HDRI}_1k.hdr`, 'env/sky_1k.hdr', null],
  [`${PH}/HDRIs/extra/Tonemapped%20JPG/${HDRI}.jpg`, 'env/sky_bg.jpg', 4096],
];

async function exists(p) { try { await stat(p); return true; } catch { return false; } }

async function download(url) {
  const file = path.join(CACHE, encodeURIComponent(url).slice(-120));
  if (await exists(file)) return (await import('node:fs/promises')).readFile(file);
  console.log(`↓ ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} al descargar ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(file, buf);
  return buf;
}

async function save(rel, buf) {
  const file = path.join(OUT, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  console.log(`✓ ${rel} (${(buf.length / 1024).toFixed(0)} KB)`);
}

async function processCar() {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
  await MeshoptEncoder.ready;
  const doc = await io.readBinary(new Uint8Array(await download(CAR.url)));
  await doc.transform(
    dedup(),
    weld(),
    resample(),
    prune(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 85 }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await save(CAR.out, Buffer.from(await io.writeBinary(doc)));
}

async function processImages(list) {
  for (const [url, out, size] of list) {
    const src = await download(url);
    if (size === null) { await save(out, src); continue; }
    let img = sharp(src).resize({ width: size, withoutEnlargement: true });
    img = out.endsWith('.webp') ? img.webp({ quality: 82 }) : img.jpeg({ quality: 82, mozjpeg: true });
    await save(out, await img.toBuffer());
  }
}

await processCar();
await processImages(TEXTURES);
await processImages(ENV);
