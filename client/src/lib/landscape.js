/**
 * Modo horizontal en móviles y tablets. Donde el navegador lo permite
 * (Android/Chrome) se pide pantalla completa y se bloquea la orientación;
 * en el resto (iPhone) la pantalla de juego se rota por CSS cuando el
 * dispositivo está en vertical (ver `.game-screen` en index.css).
 */
export function isTouchDevice() {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}

/** Debe llamarse desde un gesto del usuario (clic o toque). */
export async function enterLandscape() {
  if (!isTouchDevice()) return;
  try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
    await screen.orientation?.lock?.('landscape');
  } catch {
    /* sin soporte: queda la rotación por CSS */
  }
}

export function exitLandscape() {
  try {
    screen.orientation?.unlock?.();
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  } catch {
    /* nada que deshacer */
  }
}
