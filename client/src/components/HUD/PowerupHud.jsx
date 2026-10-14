import { POWERUPS, MAX_SLOTS, HEALTH_MAX } from '@runrun/shared/powerups';
import { POWER_ICON_PATHS } from '../powerIcons.js';

function Icon({ type, size = 26 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <path d={POWER_ICON_PATHS[type]} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}

/**
 * HUD de poderes: salud, las 3 ranuras del inventario (la seleccionada
 * resaltada, con su uso hacia delante/atrás), avisos de misil o descarga
 * entrantes, el registro de impactos y un destello al recibir un golpe.
 * En táctil añade los botones de disparo junto a los pedales.
 */
export function PowerupHud({ power, wrecked, engineRef, touch }) {
  const { items, pending, selected, health, shieldMs, boostMs, warnings, feed, flash } = power;
  const slots = [];
  for (let i = 0; i < MAX_SLOTS; i++) {
    if (i < items.length) slots.push({ ...items[i], state: 'ready' });
    else if (i - items.length < pending.length) slots.push({ type: pending[i - items.length], state: 'pending' });
    else slots.push(null);
  }
  const current = items[selected];
  const info = current ? POWERUPS[current.type] : null;
  const sys = () => engineRef.current?.power;
  const hp = Math.max(0, health / HEALTH_MAX);
  const warning = warnings[0];

  return (
    <>
      {flash && <div key={flash.at} className="hit-flash" style={{ '--flash': POWERUPS[flash.type]?.color }} />}

      {warning && !wrecked && (
        <div className={`power-warning ${warning.type}`} role="alert">
          <Icon type={warning.type} size={28} />
          <span>
            {warning.type === 'shunt' ? `Misil ${warning.dir === 'back' ? 'detrás' : 'delante'}` : 'Descarga delante'}
            {warning.dist != null && <small>{warning.dist} m</small>}
          </span>
        </div>
      )}

      {wrecked && (
        <div className="banner warn wrecked">
          Destrozado
          <small>Reapareciendo…</small>
        </div>
      )}

      {feed.length > 0 && (
        <ul className="power-feed" aria-live="polite">
          {feed.map((f) => <li key={f.id} className={f.kind}>{f.text}</li>)}
        </ul>
      )}

      <div className={`power-hud ${touch ? 'touch' : ''}`}>
        <div className="power-health" aria-label={`Salud ${Math.round(health)} de ${HEALTH_MAX}`}>
          <div className="power-health-bar">
            <i style={{ width: `${hp * 100}%` }} className={hp < 0.35 ? 'low' : ''} />
          </div>
          {shieldMs > 0 && <span className="power-chip shield"><Icon type="shield" size={14} />{(shieldMs / 1000).toFixed(1)}</span>}
          {boostMs > 0 && <span className="power-chip nitro"><Icon type="nitro" size={14} />{(boostMs / 1000).toFixed(1)}</span>}
        </div>
        <div className="power-slots">
          {slots.map((slot, i) => (
            <button
              type="button"
              key={i}
              className={`power-slot ${slot ? slot.state : 'empty'} ${i === selected && slot?.state === 'ready' ? 'selected' : ''}`}
              style={slot ? { '--c': POWERUPS[slot.type].color } : undefined}
              onPointerDown={(e) => {
                e.preventDefault();
                sys()?.select(i);
              }}
              aria-label={slot ? POWERUPS[slot.type].name : 'Ranura vacía'}
              tabIndex={-1}
            >
              {slot && <Icon type={slot.type} size={i === selected ? 30 : 24} />}
              {slot?.charges > 1 && <b className="charges">×{slot.charges}</b>}
            </button>
          ))}
        </div>
        <div className="power-info">
          {info ? (
            <>
              <strong style={{ color: info.color }}>{info.name}</strong>
              {!touch && (
                <span>
                  <kbd>E</kbd> {info.front} · <kbd>Q</kbd> {info.back}
                  {items.length > 1 && <> · <kbd>Tab</kbd> cambiar</>}
                </span>
              )}
            </>
          ) : (
            <span className="muted">Pasa por un icono para coger un poder</span>
          )}
        </div>
        {touch && (
          <div className="power-touch">
            <button
              type="button"
              className="power-fire back"
              disabled={!current}
              aria-label="Disparar hacia atrás"
              onPointerDown={(e) => {
                e.preventDefault();
                sys()?.fire(true);
              }}
            >
              ▼
            </button>
            <button
              type="button"
              className="power-fire"
              disabled={!current}
              style={info ? { '--c': info.color } : undefined}
              aria-label={info ? `Disparar ${info.name}` : 'Sin poder'}
              onPointerDown={(e) => {
                e.preventDefault();
                sys()?.fire(false);
                navigator.vibrate?.(10);
              }}
            >
              {current ? <Icon type={current.type} size={34} /> : '—'}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
