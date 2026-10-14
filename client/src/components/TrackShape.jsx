import { useMemo } from 'react';
import { getTrack } from '@runrun/shared/tracks';
import { buildTrackPath } from '@runrun/shared/trackPath';

/** Proyección 2D (vista cenital) de una pista para minimapa y selector. */
export function useTrackProjection(trackId, size = 200, padding = 14) {
  return useMemo(() => {
    const path = buildTrackPath(getTrack(trackId), 6);
    const xs = path.points.map((p) => p[0]);
    const zs = path.points.map((p) => p[2]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minZ = Math.min(...zs);
    const maxZ = Math.max(...zs);
    const scale = (size - padding * 2) / Math.max(maxX - minX, maxZ - minZ);
    const ox = (size - (maxX - minX) * scale) / 2;
    const oz = (size - (maxZ - minZ) * scale) / 2;
    // Vista cenital sin espejo: +X a la derecha y +Z hacia abajo en pantalla.
    const project = (x, z) => [ox + (x - minX) * scale, oz + (z - minZ) * scale];
    const d = path.points.map((p, i) => `${i ? 'L' : 'M'}${project(p[0], p[2]).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + ' Z';
    const start = project(path.points[0][0], path.points[0][2]);
    return { d, project, start, size };
  }, [trackId, size, padding]);
}

/** Trazado cenital; con `lapSeconds` un punto recorre la pista para mostrar el sentido de marcha. */
export function TrackShape({ trackId, size = 200, className = '', lapSeconds = 0 }) {
  const { d, start } = useTrackProjection(trackId, size);
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className={`track-shape ${className}`} aria-hidden="true">
      <path d={d} className="track-outline" />
      <path d={d} className="track-line" />
      <circle cx={start[0]} cy={start[1]} r={size / 40} className="track-start" />
      {lapSeconds > 0 && (
        <circle r={size / 34} className="track-runner">
          <animateMotion dur={`${lapSeconds}s`} repeatCount="indefinite" path={d} />
        </circle>
      )}
    </svg>
  );
}
