import { useEffect, useState } from 'react';
import { TRACKS, TRACK_IDS } from '@runrun/shared/tracks';
import { buildTrackPath } from '@runrun/shared/trackPath';
import { TrackShape } from '../TrackShape.jsx';

const AMBIENT = {
  alpine: 'Montaña · día',
  desert: 'Desierto · atardecer',
  coast: 'Costa · mediodía',
  autumn: 'Bosque · otoño',
  city: 'Ciudad · noche',
};

/** Datos de ficha calculados una vez: longitud y desnivel de cada trazado. */
const INFO = Object.fromEntries(
  TRACK_IDS.map((id) => {
    const path = buildTrackPath(TRACKS[id], 4);
    const ys = path.points.map((p) => p[1]);
    return [id, { km: path.length / 1000, climb: Math.round(Math.max(...ys) - Math.min(...ys)) }];
  }),
);

/**
 * Sección "Circuito": vista previa grande del circuito (paisaje real + trazado
 * animado) y la lista de circuitos. Solo el anfitrión cambia el de la sala; el
 * resto puede curiosear las fichas sin cambiar nada.
 */
export function TrackSection({ trackId, isHost, onSelect }) {
  const [viewing, setViewing] = useState(trackId);
  useEffect(() => setViewing(trackId), [trackId]);
  const t = TRACKS[viewing] ?? TRACKS[trackId];
  const info = INFO[t.id];
  const chosen = t.id === trackId;

  const pick = (id) => {
    setViewing(id);
    if (isHost && id !== trackId) onSelect(id);
  };

  return (
    <section className="track-section" aria-label="Circuito">
      <article key={t.id} className={`track-preview theme-${t.theme} swap-in`}>
        <img src={`/tracks/${t.id}.jpg`} alt={`Paisaje de ${t.name}`} loading="lazy" draggable="false" />
        <div className="track-preview-shade" />
        <TrackShape trackId={t.id} size={220} className="track-preview-map" lapSeconds={7 + info.km * 2} />
        <div className="track-preview-info">
          <span className="eyebrow">{AMBIENT[t.theme] ?? 'Circuito'}</span>
          <h3>{t.name}</h3>
          <p>{t.tagline}</p>
          <ul className="track-facts">
            <li><b>{info.km.toFixed(2)}</b><span>km</span></li>
            <li><b>{t.laps}</b><span>vueltas</span></li>
            <li><b>{info.climb}</b><span>m desnivel</span></li>
          </ul>
          {!chosen && !isHost && <small className="track-note">Vista previa · el anfitrión elige el circuito</small>}
        </div>
        {chosen && <span className="track-badge">Circuito de la carrera</span>}
      </article>

      <div className="track-list" role="radiogroup" aria-label="Circuitos">
        {!isHost && <p className="hint">El anfitrión elige el circuito. Toca uno para verlo.</p>}
        {TRACK_IDS.map((id) => {
          const tr = TRACKS[id];
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={id === trackId}
              className={`track-item theme-${tr.theme} ${id === trackId ? 'selected' : ''} ${id === viewing ? 'viewing' : ''}`}
              onClick={() => pick(id)}
            >
              <TrackShape trackId={id} size={64} />
              <span className="track-item-text">
                <strong>{tr.name}</strong>
                <small>{INFO[id].km.toFixed(2)} km · {AMBIENT[tr.theme]}</small>
              </span>
              {id === trackId && <span className="track-check" aria-hidden="true">✓</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
