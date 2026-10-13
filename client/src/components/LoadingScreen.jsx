import { getTrack } from '@runrun/shared/tracks';
import { TrackShape } from './TrackShape.jsx';

const TIPS = [
  'Frena antes de la curva y acelera a la salida: el coche agarra más.',
  'El freno de mano (Espacio) ayuda en horquillas cerradas.',
  'Pulsa C para cambiar entre cámara de persecución, lejana y capó.',
  'Si vuelcas, pulsa R para volver a la pista.',
  'Pisar la escapatoria (hierba o arena) te frena mucho.',
];

export function LoadingScreen({ trackId, progress, label, waiting }) {
  const track = getTrack(trackId);
  const tip = TIPS[Math.floor(Date.now() / 8000) % TIPS.length];
  return (
    <div className={`loading-screen theme-${track.theme}`}>
      <div className="loading-card">
        <TrackShape trackId={trackId} size={220} className="loading-track" />
        <h2>{track.name}</h2>
        <p className="tagline">{track.tagline}</p>
        <div className="progress"><i style={{ width: `${Math.round(progress * 100)}%` }} /></div>
        <p className="loading-label">{waiting ? 'Esperando al resto de pilotos…' : label}</p>
        <p className="tip">{tip}</p>
      </div>
    </div>
  );
}
