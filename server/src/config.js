import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const config = Object.freeze({
  port: Number(process.env.PORT) || 3001,
  isProduction: process.env.NODE_ENV === 'production',
  /**
   * Orígenes permitidos para Socket.io, separados por comas. Vacío = solo el mismo origen
   * (el caso normal: el servidor sirve también el cliente).
   */
  clientOrigins: (process.env.CLIENT_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean),
  /** Carpeta con el cliente compilado (vite build). */
  staticDir: process.env.STATIC_DIR || path.resolve(here, '../../client/dist'),
  maxRooms: Number(process.env.MAX_ROOMS) || 500,
});
