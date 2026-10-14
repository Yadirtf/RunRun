import { POWERUP_IDS, POWERUPS } from '@runrun/shared/powerups';
import { POWER_ICON_PATHS } from './powerIcons.js';

/**
 * Opción de sala: carrera con poderes (estilo Blur) o carrera limpia. Solo el
 * anfitrión la cambia; el resto ve la elección.
 */
export function PowerupToggle({ enabled, disabled, onChange }) {
  return (
    <div className="powerup-toggle">
      <div className="quality-picker">
        <span>Poderes</span>
        <div className="segmented" role="radiogroup" aria-label="Poderes en pista">
          <button type="button" className={enabled ? 'on' : ''} disabled={disabled} onClick={() => onChange(true)} aria-checked={enabled} role="radio">Activados</button>
          <button type="button" className={!enabled ? 'on' : ''} disabled={disabled} onClick={() => onChange(false)} aria-checked={!enabled} role="radio">Carrera limpia</button>
        </div>
      </div>
      {enabled && (
        <ul className="powerup-legend" aria-label="Poderes disponibles">
          {POWERUP_IDS.map((id) => (
            <li key={id} title={`${POWERUPS[id].name}: ${POWERUPS[id].front}`} style={{ color: POWERUPS[id].color }}>
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d={POWER_ICON_PATHS[id]} fill="currentColor" fillRule="evenodd" /></svg>
              <span>{POWERUPS[id].name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
