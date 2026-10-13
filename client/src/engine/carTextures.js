import * as THREE from 'three';
import { cached, makeCanvas, toTexture, rng } from './textures.js';

/**
 * Texturas procedurales de los coches: neumático con dibujo y rotulación,
 * matrículas, rejilla en panal y disco de freno perforado. Se generan una vez
 * y se comparten entre todos los coches.
 */

/** Neumático: u = vuelta a la rueda, v = perfil de flanco a flanco. */
export function tireTextures() {
  return cached('car:tire', () => {
    const W = 1024;
    const H = 128;
    const color = makeCanvas(W, H);
    const bump = makeCanvas(W, H);
    const c = color.getContext('2d');
    const b = bump.getContext('2d');
    const rand = rng(17);
    c.fillStyle = '#1a1a1b';
    c.fillRect(0, 0, W, H);
    b.fillStyle = '#808080';
    b.fillRect(0, 0, W, H);
    // Banda de rodadura: tacos con surcos longitudinales y transversales.
    const t0 = H * 0.3;
    const t1 = H * 0.7;
    c.fillStyle = '#141415';
    c.fillRect(0, t0, W, t1 - t0);
    b.fillStyle = '#9a9a9a';
    b.fillRect(0, t0, W, t1 - t0);
    b.fillStyle = '#2a2a2a';
    for (const y of [0.4, 0.5, 0.6]) b.fillRect(0, H * y - 2, W, 4);
    for (let x = 0; x < W; x += 16) {
      b.save();
      b.translate(x, t0);
      b.transform(1, 0, 0.35, 1, 0, 0);
      b.fillRect(0, 0, 3, (t1 - t0) * 0.45);
      b.fillRect(8, (t1 - t0) * 0.55, 3, (t1 - t0) * 0.45);
      b.restore();
    }
    // Flancos: rotulación en relieve, gris algo más claro.
    for (const y of [H * 0.15, H * 0.85]) {
      c.save();
      c.font = 'bold 20px Arial, sans-serif';
      c.textBaseline = 'middle';
      b.font = c.font;
      b.textBaseline = 'middle';
      for (let x = 30; x < W; x += W / 2) {
        c.fillStyle = '#3b3b3e';
        c.fillText('RUNRUN  RACING  245/40 R18', x, y);
        b.fillStyle = '#c0c0c0';
        b.fillText('RUNRUN  RACING  245/40 R18', x, y);
      }
      c.restore();
    }
    // Polvo y desgaste.
    const img = c.getImageData(0, 0, W, H);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (rand() - 0.5) * 10;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    c.putImageData(img, 0, 0);
    return { map: toTexture(color), bumpMap: toTexture(bump, { srgb: false }) };
  });
}

/** Matrícula europea con banda azul. */
export function plateTexture(text) {
  return cached(`car:plate:${text}`, () => {
    const canvas = makeCanvas(256, 56);
    const g = canvas.getContext('2d');
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, 256, 56);
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = 3;
    g.strokeRect(2, 2, 252, 52);
    g.fillStyle = '#1d4fb8';
    g.fillRect(3, 3, 26, 50);
    g.fillStyle = '#ffd200';
    g.beginPath();
    g.arc(16, 18, 6, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#111';
    g.font = 'bold 36px "Arial Narrow", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 142, 30);
    const tex = toTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Rejilla en panal de abeja: color + alpha (huecos casi negros). */
export function grilleTexture() {
  return cached('car:grille', () => {
    const canvas = makeCanvas(128);
    const g = canvas.getContext('2d');
    g.fillStyle = '#050506';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#3a3c40';
    g.lineWidth = 2.2;
    const r = 8;
    const h = Math.sqrt(3) * r;
    for (let row = -1; row < 128 / h + 1; row++) {
      for (let col = -1; col < 128 / (r * 1.5) + 1; col++) {
        const cx = col * r * 1.5;
        const cy = row * h + (col % 2 ? h / 2 : 0);
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2;
          g[k ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.closePath();
        g.stroke();
      }
    }
    const tex = toTexture(canvas);
    tex.repeat.set(4, 1);
    return tex;
  });
}

/** Disco de freno: pista de frenado metálica con taladros y buje oscuro. */
export function brakeDiscTexture() {
  return cached('car:disc', () => {
    const S = 256;
    const canvas = makeCanvas(S);
    const g = canvas.getContext('2d');
    g.fillStyle = '#2a2b2e';
    g.fillRect(0, 0, S, S);
    const grad = g.createRadialGradient(S / 2, S / 2, S * 0.2, S / 2, S / 2, S / 2);
    grad.addColorStop(0, '#5d6066');
    grad.addColorStop(0.5, '#9a9da3');
    grad.addColorStop(0.92, '#7c7f85');
    grad.addColorStop(1, '#3a3b3e');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#26272a';
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#18191b';
    for (let ring = 0; ring < 3; ring++) {
      const rr = S * (0.3 + ring * 0.06);
      for (let k = 0; k < 18; k++) {
        const a = (k / 18) * Math.PI * 2 + ring * 0.12;
        g.beginPath();
        g.arc(S / 2 + Math.cos(a) * rr, S / 2 + Math.sin(a) * rr, 3.2, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Marcas circulares de las pastillas.
    g.strokeStyle = 'rgba(255,255,255,0.06)';
    for (let r = S * 0.25; r < S * 0.48; r += 3) {
      g.beginPath();
      g.arc(S / 2, S / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    const tex = toTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/** Tapicería: tela con costuras para asientos y salpicadero. */
export function upholsteryTexture() {
  return cached('car:upholstery', () => {
    const canvas = makeCanvas(64);
    const g = canvas.getContext('2d');
    const rand = rng(3);
    g.fillStyle = '#1d1e21';
    g.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 600; i++) {
      g.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.12)';
      g.fillRect(rand() * 64, rand() * 64, 1, 1);
    }
    g.fillStyle = '#3a3c42';
    g.fillRect(0, 30, 64, 2);
    return toTexture(canvas);
  });
}
