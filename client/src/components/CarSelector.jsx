import { useEffect, useRef } from 'react';
import { CARS, CAR_IDS } from '@runrun/shared/cars';
import { Showroom } from '../showroom/Showroom.js';

/** Selector 3D: el coche gira en la plataforma; flechas o teclas ←/→ para cambiar. */
export function CarShowroom({ carModel, color }) {
  const canvasRef = useRef(null);
  const showroomRef = useRef(null);

  useEffect(() => {
    const s = new Showroom(canvasRef.current);
    showroomRef.current = s;
    if (import.meta.env.DEV) window.__showroom = s;
    return () => s.dispose();
  }, []);

  useEffect(() => {
    showroomRef.current?.show(carModel, color);
  }, [carModel, color]);

  return <canvas ref={canvasRef} className="showroom-canvas" aria-hidden="true" />;
}

export function CarPicker({ value, onChange, compact = false }) {
  const index = CAR_IDS.indexOf(value);
  const step = (d) => onChange(CAR_IDS[(index + d + CAR_IDS.length) % CAR_IDS.length]);
  const car = CARS[value];
  const stats = car.stats;
  const bars = [
    ['Potencia', stats.engineForce / 13000],
    ['Velocidad', (stats.maxSpeedKmh - 150) / 70],
    ['Agarre', stats.grip / 1.8],
  ];

  useEffect(() => {
    if (compact) return undefined;
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`car-picker ${compact ? 'compact' : ''}`}>
      <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Coche anterior">‹</button>
      <div className="car-picker-info">
        <div className="car-name">{car.name}</div>
        <div className="car-desc">{car.description}</div>
        {!compact && (
          <div className="car-stats">
            {bars.map(([label, v]) => (
              <div className="stat" key={label}>
                <span>{label}</span>
                <div className="bar"><i style={{ width: `${Math.round(Math.min(1, v) * 100)}%` }} /></div>
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Coche siguiente">›</button>
    </div>
  );
}
