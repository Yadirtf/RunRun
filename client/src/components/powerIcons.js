import { POWERUPS } from '@runrun/shared/powerups';

/**
 * Iconos de los poderes como trazados SVG (caja 24x24). Los usa el HUD
 * (<svg>) y el motor 3D (Path2D sobre un canvas), así el icono de la pista y
 * el del inventario son idénticos.
 */
export const POWER_ICON_PATHS = {
  // Misil
  shunt: 'M4.5 19.5l2.6-5.7 7.6-7.6c1.8-1.8 4-2.4 5.2-2.6-.2 1.2-.8 3.4-2.6 5.2l-7.6 7.6zM6.6 12.8L3 13.6l2.6-4.4 4.4-.8zM11.2 17.4l-.8 3.6 4.4-2.6.8-4.4z',
  // Rayo
  bolt: 'M13.5 2L4 13.5h6.2L9 22l10-12.5h-6.4z',
  // Onda: dos anillos concéntricos
  barge: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.2a7.8 7.8 0 1 1 0 15.6 7.8 7.8 0 0 1 0-15.6zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  // Descarga: cúpula con chispa
  shock: 'M2 19h20v2.2H2zM3.5 18a8.5 8.5 0 0 1 17 0h-2.3a6.2 6.2 0 0 0-12.4 0zM13 6.5L9.2 12.4h2.9l-1 4.6 4.1-6.2h-3z',
  // Mina con púas
  mine: 'M12 6.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6zM10.9 1.5h2.2v4h-2.2zM10.9 18.5h2.2v4h-2.2zM1.5 10.9h4v2.2h-4zM18.5 10.9h4v2.2h-4zM4.1 5.6l1.5-1.5 2.9 2.9L7 8.5zM15.5 17l1.5-1.5 2.9 2.9-1.5 1.5zM4.1 18.4L7 15.5l1.5 1.5-2.9 2.9zM15.5 7l2.9-2.9 1.5 1.5L17 8.5z',
  // Nitro: doble flecha
  nitro: 'M2.5 4.5l8 7.5-8 7.5zM12.5 4.5l9 7.5-9 7.5z',
  // Reparar: cruz
  repair: 'M9 2.5h6v6.5h6.5v6H15v6.5H9V15H2.5V9H9z',
  // Escudo
  shield: 'M12 1.8l8.5 3.2v6.2c0 5.4-3.6 9.8-8.5 11-4.9-1.2-8.5-5.6-8.5-11V5z',
};

export function powerColor(type) {
  return POWERUPS[type]?.color ?? '#ffffff';
}

/** Icono React-agnóstico: atributos listos para un <path> dentro de un <svg viewBox="0 0 24 24">. */
export function iconPath(type) {
  return POWER_ICON_PATHS[type] ?? '';
}
