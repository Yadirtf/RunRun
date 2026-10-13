/**
 * Catálogo de pistas. Cada pista es un circuito cerrado definido por puntos de
 * control [x, elevación, z] en metros. El aspecto visual (paisaje) lo decide el
 * cliente a partir de `theme`; el servidor solo necesita la geometría para
 * validar checkpoints.
 */
export const TRACKS = {
  alpine: {
    id: 'alpine',
    name: 'Valle Alpino',
    tagline: 'Curvas técnicas entre pinos, lago y cumbres nevadas',
    theme: 'alpine',
    laps: 3,
    width: 13,
    checkpoints: 10,
    points: [
      [0, 0, -160],
      [0, 0.5, -40],
      [12, 3, 60],
      [62, 7, 128],
      [140, 11, 142],
      [202, 13, 92],
      [192, 11, 12],
      [132, 7, -22],
      [108, 5, -82],
      [158, 7, -140],
      [232, 11, -168],
      [262, 13, -238],
      [202, 10, -300],
      [100, 6, -292],
      [38, 2, -248],
    ],
  },
  desert: {
    id: 'desert',
    name: 'Cañón del Desierto',
    tagline: 'Rectas largas a fondo bajo un atardecer entre mesetas rojas',
    theme: 'desert',
    laps: 3,
    width: 15,
    checkpoints: 10,
    points: [
      [0, 0, 0],
      [250, 0, 0],
      [330, 0.5, 40],
      [342, 2, 120],
      [292, 4, 172],
      [202, 3, 150],
      [152, 1, 202],
      [162, -1, 292],
      [80, -2, 334],
      [-40, -1, 302],
      [-112, 1, 222],
      [-90, 3, 130],
      [-140, 2, 60],
      [-100, 0.5, 4],
    ],
  },
};

export const TRACK_IDS = Object.keys(TRACKS);
export const DEFAULT_TRACK_ID = 'alpine';

export function getTrack(id) {
  return TRACKS[id] ?? TRACKS[DEFAULT_TRACK_ID];
}
