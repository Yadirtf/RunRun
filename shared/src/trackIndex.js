import trackData from './trackData.js';
import { TrackLayout } from './track.js';

/** Metadatos ligeros de cada pista (para menús y validación). */
export const TRACKS = Object.freeze(
  Object.values(trackData).map((t) => ({
    id: t.id,
    name: t.name,
    fullName: t.fullName,
    country: t.country,
    length: t.length,
    defaultLaps: t.defaultLaps,
  })),
);
export const TRACK_IDS = TRACKS.map((t) => t.id);
export const DEFAULT_TRACK_ID = TRACK_IDS[0];

export function getTrackInfo(id) {
  return TRACKS.find((t) => t.id === id) ?? TRACKS[0];
}

const layouts = new Map();
/** Devuelve (y cachea) el TrackLayout completo de una pista. */
export function getTrackLayout(id) {
  const key = trackData[id] ? id : DEFAULT_TRACK_ID;
  let layout = layouts.get(key);
  if (!layout) layouts.set(key, (layout = new TrackLayout(trackData[key])));
  return layout;
}
