import { useTrackProjection } from '../TrackShape.jsx';

/** Minimapa cenital con un punto por jugador (el propio, con halo). */
export function Minimap({ trackId, standings, myId }) {
  const { d, project, start, size } = useTrackProjection(trackId, 180, 12);
  return (
    <div className="minimap glass">
      <svg viewBox={`0 0 ${size} ${size}`}>
        <path d={d} className="track-outline" />
        <path d={d} className="track-line" />
        <rect x={start[0] - 3} y={start[1] - 3} width="6" height="6" className="track-start" />
        {standings.map((p) => {
          const [x, y] = project(p.x, p.z);
          const mine = p.id === myId;
          return (
            <g key={p.id} transform={`translate(${x} ${y})`} className="map-dot">
              {mine && <circle r="9" className="me-halo" />}
              <circle r={mine ? 5.5 : 4.5} fill={p.color} stroke="#fff" strokeWidth={mine ? 2 : 1} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
