import { useEffect, useRef } from 'react';
import { CARS, CAR_IDS, PLAYER_COLORS } from '@runrun/shared/cars';
import { Showroom } from '../showroom/Showroom.js';

/** Escena 3D del coche elegido. Se puede arrastrar para girarlo. */
export function CarShowroom({ carModel, color, shiftX = 0, shiftY = 0, fill = 0.42 }) {
  const canvasRef = useRef(null);
  const showroomRef = useRef(null);

  useEffect(() => {
    const s = new Showroom(canvasRef.current, { shiftX, shiftY, fill });
    showroomRef.current = s;
    if (import.meta.env.DEV) window.__showroom = s;
    return () => s.dispose();
  }, [shiftX, shiftY, fill]);

  useEffect(() => {
    showroomRef.current?.show(carModel, color);
  }, [carModel, color]);

  return <canvas ref={canvasRef} className="showroom-canvas" aria-label="Vista 3D del coche: arrastra para girarlo" />;
}

const ranges = (key) => {
  const v = CAR_IDS.map((id) => CARS[id].stats[key]);
  return [Math.min(...v), Math.max(...v)];
};
const R = {
  accel: (() => {
    const v = CAR_IDS.map((id) => CARS[id].stats.engineForce / CARS[id].stats.mass);
    return [Math.min(...v), Math.max(...v)];
  })(),
  speed: ranges('maxSpeedKmh'),
  grip: ranges('grip'),
  brake: (() => {
    const v = CAR_IDS.map((id) => CARS[id].stats.brakeForce / CARS[id].stats.mass);
    return [Math.min(...v), Math.max(...v)];
  })(),
};
/** Normaliza a 0.35..1 dentro del catálogo para que las barras comparen coches entre sí. */
const norm = (x, [a, b]) => 0.35 + 0.65 * (b === a ? 1 : (x - a) / (b - a));

export function carRatings(car) {
  const s = car.stats;
  return [
    ['Aceleración', norm(s.engineForce / s.mass, R.accel)],
    ['Velocidad', norm(s.maxSpeedKmh, R.speed)],
    ['Agarre', norm(s.grip, R.grip)],
    ['Frenada', norm(s.brakeForce / s.mass, R.brake)],
  ];
}

/** Paleta de pintura; las ocupadas por otros pilotos de la sala se muestran bloqueadas. */
export function ColorPicker({ value, onChange, taken = [] }) {
  return (
    <div className="color-picker" role="radiogroup" aria-label="Color de pintura">
      {PLAYER_COLORS.map((c) => {
        const busy = taken.includes(c) && c !== value;
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={value === c}
            aria-label={busy ? `Color ${c} (ocupado)` : `Color ${c}`}
            className={`color-dot ${value === c ? 'selected' : ''}`}
            style={{ '--c': c }}
            disabled={busy}
            onClick={() => onChange(c)}
          />
        );
      })}
    </div>
  );
}

/**
 * Ficha del garaje: modelo, categoría, datos, barras comparativas, selector
 * de modelo (flechas, teclado ←/→ o pestañas) y color.
 */
export function GarageCard({ carModel, onCarChange, color, onColorChange, takenColors, keyboard = true, className = '' }) {
  const index = Math.max(0, CAR_IDS.indexOf(carModel));
  const car = CARS[CAR_IDS[index]];
  const step = (d) => onCarChange(CAR_IDS[(index + d + CAR_IDS.length) % CAR_IDS.length]);

  useEffect(() => {
    if (!keyboard) return undefined;
    const onKey = (e) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowLeft') step(-1);
      if (e.key === 'ArrowRight') step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section className={`garage glass ${className}`} aria-label="Garaje">
      <header className="garage-head">
        <span className="eyebrow">Garaje</span>
        <span className="garage-count">
          {String(index + 1).padStart(2, '0')}<small>/{String(CAR_IDS.length).padStart(2, '0')}</small>
        </span>
      </header>
      <div className="garage-title">
        <button type="button" className="icon-btn" onClick={() => step(-1)} aria-label="Coche anterior">‹</button>
        <div key={car.id} className="garage-name swap-in">
          <span className="car-class">{car.class}</span>
          <h3>{car.name}</h3>
          <p>{car.description}</p>
        </div>
        <button type="button" className="icon-btn" onClick={() => step(1)} aria-label="Coche siguiente">›</button>
      </div>
      <div className="spec-row">
        <div><b>{car.stats.maxSpeedKmh}</b><span>km/h máx.</span></div>
        <div><b>{car.stats.mass.toLocaleString('es')}</b><span>kg</span></div>
        <div><b>{(car.stats.mass / (car.stats.engineForce / 25)).toFixed(1)}</b><span>kg/cv</span></div>
      </div>
      <div className="car-stats">
        {carRatings(car).map(([label, v]) => (
          <div className="stat" key={label}>
            <span>{label}</span>
            <div className="bar"><i style={{ width: `${Math.round(v * 100)}%` }} /></div>
          </div>
        ))}
      </div>
      <div className="car-tabs" role="tablist" aria-label="Modelos">
        {CAR_IDS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={id === car.id}
            className={id === car.id ? 'active' : ''}
            onClick={() => onCarChange(id)}
            title={CARS[id].name}
          >
            {CARS[id].name}
          </button>
        ))}
      </div>
      {onColorChange && (
        <div className="garage-paint">
          <span className="eyebrow">Pintura</span>
          <ColorPicker value={color} onChange={onColorChange} taken={takenColors} />
        </div>
      )}
    </section>
  );
}
