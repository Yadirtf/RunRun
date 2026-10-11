// Minimapa en canvas: trazado + puntos de cada coche, centrado en la pista entera.
import { useEffect, useRef } from 'react';

export default function Minimap({ game }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!game) return undefined;
    const canvas = ref.current;
    const ctx = canvas.getContext('2d');
    const L = game.layout;
    const { minX, maxX, minZ, maxZ } = L.bounds;
    const size = 180;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = canvas.height = size * dpr;
    const span = Math.max(maxX - minX, maxZ - minZ);
    const scale = (size - 24) / span;
    const ox = size / 2 - ((minX + maxX) / 2) * scale;
    const oz = size / 2 - ((minZ + maxZ) / 2) * scale;
    const px = (x) => ox + x * scale, pz = (z) => oz + z * scale;

    // Trazado prerenderizado
    const bg = document.createElement('canvas');
    bg.width = bg.height = size * dpr;
    const b = bg.getContext('2d');
    b.scale(dpr, dpr);
    b.lineJoin = 'round';
    b.beginPath();
    for (let i = 0; i <= L.n; i++) {
      const k = i % L.n;
      if (i === 0) b.moveTo(px(L.x[k]), pz(L.z[k])); else b.lineTo(px(L.x[k]), pz(L.z[k]));
    }
    b.strokeStyle = 'rgba(0,0,0,0.55)'; b.lineWidth = 7; b.stroke();
    b.strokeStyle = 'rgba(235,240,250,0.9)'; b.lineWidth = 3.5; b.stroke();
    b.fillStyle = '#e63946';
    b.fillRect(px(L.x[0]) - 3, pz(L.z[0]) - 3, 6, 6);

    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bg, 0, 0);
      ctx.scale(dpr, dpr);
      for (const car of game.mapCars()) {
        ctx.beginPath();
        ctx.arc(px(car.x), pz(car.z), car.me ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = car.color;
        ctx.fill();
        ctx.lineWidth = car.me ? 2.5 : 1.5;
        ctx.strokeStyle = car.me ? '#ffffff' : 'rgba(0,0,0,0.8)';
        ctx.stroke();
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [game]);

  return <canvas ref={ref} className="minimap" aria-label="Minimapa" />;
}
