import { TRACKS, TRACK_IDS } from '@runrun/shared/tracks';
import { buildTrackPath } from '@runrun/shared/trackPath';
import { TrackShape } from './TrackShape.jsx';

const lengths = Object.fromEntries(TRACK_IDS.map((id) => [id, buildTrackPath(TRACKS[id], 4).length]));

export function TrackPicker({ value, onChange, disabled }) {
  return (
    <div className="track-picker" role="radiogroup" aria-label="Pista">
      {TRACK_IDS.map((id) => {
        const t = TRACKS[id];
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={value === id}
            className={`track-card theme-${t.theme} ${value === id ? 'selected' : ''}`}
            onClick={() => !disabled && onChange(id)}
            disabled={disabled && value !== id}
          >
            <TrackShape trackId={id} size={120} />
            <div className="track-info">
              <strong>{t.name}</strong>
              <span>{t.tagline}</span>
              <small>{(lengths[id] / 1000).toFixed(2)} km · {t.laps} vueltas</small>
            </div>
          </button>
        );
      })}
    </div>
  );
}
