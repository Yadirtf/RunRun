// Utilidades de dispositivo: detección táctil, pantalla completa y orientación horizontal.

export const isTouchDevice = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || 'ontouchstart' in window);

export const canFullscreen = () => typeof document !== 'undefined' && !!document.documentElement.requestFullscreen;

/** Pantalla completa + bloqueo en horizontal (donde el navegador lo permite, p. ej. Android). */
export async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* iOS Safari no permite pantalla completa ni bloquear la orientación: no pasa nada */
  }
}

export function vibrate(ms, enabled = true) {
  if (!enabled) return;
  try { navigator.vibrate?.(ms); } catch { /* sin vibración */ }
}
