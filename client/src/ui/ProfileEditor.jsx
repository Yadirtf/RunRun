// Selección de coche y color (compartido entre el menú y la sala).
import { CARS, PAINT_COLORS, getCar } from '@ranran/shared';
import { useGame } from '../store/gameStore.js';
import CarPreview from './CarPreview.jsx';

function StatBar({ label, value }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <div className="stat-bar"><div style={{ width: `${Math.round(value * 100)}%` }} /></div>
    </div>
  );
}

export default function ProfileEditor({ takenColors = [] }) {
  const profile = useGame((s) => s.profile);
  const setProfile = useGame((s) => s.setProfile);
  const car = getCar(profile.carId);
  const idx = CARS.findIndex((c) => c.id === car.id);
  const cycle = (d) => setProfile({ carId: CARS[(idx + d + CARS.length) % CARS.length].id });

  return (
    <div className="profile-editor">
      <div className="preview-wrap">
        <CarPreview carId={car.id} color={profile.color} />
        <button className="arrow left" onClick={() => cycle(-1)} aria-label="Coche anterior">‹</button>
        <button className="arrow right" onClick={() => cycle(1)} aria-label="Coche siguiente">›</button>
      </div>
      <div className="car-info">
        <h3>{car.name}</h3>
        <p className="muted">{car.tagline} · {car.physics.drive === 'AWD' ? 'Tracción total' : 'Propulsión trasera'}</p>
        <StatBar label="Potencia" value={car.stats.power} />
        <StatBar label="Agarre" value={car.stats.grip} />
        <StatBar label="Manejo" value={car.stats.handling} />
        <div className="swatches" role="radiogroup" aria-label="Color">
          {PAINT_COLORS.map((c) => {
            const taken = takenColors.includes(c) && c !== profile.color;
            return (
              <button
                key={c}
                role="radio"
                aria-checked={profile.color === c}
                aria-label={`Color ${c}`}
                disabled={taken}
                className={`swatch ${profile.color === c ? 'active' : ''}`}
                style={{ background: c }}
                onClick={() => setProfile({ color: c })}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
