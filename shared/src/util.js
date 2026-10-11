import { NICKNAME_MAX, NICKNAME_MIN } from './constants.js';

/** Limpia un apodo: sin caracteres de control ni HTML, recortado a la longitud permitida. */
export function sanitizeNickname(value) {
  const clean = String(value ?? '')
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NICKNAME_MAX);
  return clean.length >= NICKNAME_MIN ? clean : null;
}

/** Formatea milisegundos como m:ss.mmm */
export function formatTime(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '--:--.---';
  const sign = ms < 0 ? '-' : '';
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${sign}${m}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}
