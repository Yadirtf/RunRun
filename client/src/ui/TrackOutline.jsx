import { useMemo } from 'react';
import { getTrackLayout } from '@ranran/shared';

/** Silueta SVG del trazado (para menús). */
export default function TrackOutline({ trackId, className = '' }) {
  const { d, viewBox, start } = useMemo(() => {
    const L = getTrackLayout(trackId);
    const { minX, maxX, minZ, maxZ } = L.bounds;
    const pad = 40;
    const parts = [];
    for (let i = 0; i < L.n; i += 2) parts.push(`${i === 0 ? 'M' : 'L'}${L.x[i].toFixed(1)} ${L.z[i].toFixed(1)}`);
    return {
      d: `${parts.join(' ')} Z`,
      viewBox: `${minX - pad} ${minZ - pad} ${maxX - minX + pad * 2} ${maxZ - minZ + pad * 2}`,
      start: { x: L.x[0], z: L.z[0] },
    };
  }, [trackId]);
  return (
    <svg className={`track-outline ${className}`} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="18" strokeLinejoin="round" />
      <circle cx={start.x} cy={start.z} r="26" fill="var(--accent)" />
    </svg>
  );
}
