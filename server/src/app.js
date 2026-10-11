import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import { Server } from 'socket.io';
import { NET_SEND_HZ } from '@ranran/shared';
import { RoomManager } from './RoomManager.js';
import { registerSocketHandlers } from './socketHandlers.js';

/** Crea el servidor HTTP + Socket.io. No escucha en ningún puerto (lo hace index.js o los tests). */
export function createGameServer(config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: config.clientOrigins.length ? { origin: config.clientOrigins, methods: ['GET', 'POST'] } : undefined,
    transports: ['websocket', 'polling'],
    maxHttpBufferSize: 16 * 1024,
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });

  const manager = new RoomManager((code, target, event, payload) => {
    if (target.socketId) io.to(target.socketId).emit(event, payload);
    else io.to(code).emit(event, payload);
  }, { maxRooms: config.maxRooms });
  registerSocketHandlers(io, manager);
  const loop = setInterval(() => manager.tick(), 1000 / NET_SEND_HZ);

  app.get('/healthz', (_req, res) => res.json({ ok: true, ...manager.stats() }));

  // Cliente compilado (si existe). En desarrollo lo sirve Vite.
  if (fs.existsSync(config.staticDir)) {
    app.use('/assets', express.static(path.join(config.staticDir, 'assets'), { maxAge: '30d', immutable: true }));
    app.use('/game', express.static(path.join(config.staticDir, 'game'), { maxAge: '7d' }));
    app.use(express.static(config.staticDir, { maxAge: '1h', index: false }));
    app.get(/^\/(?!socket\.io\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.staticDir, 'index.html'));
    });
  }

  const close = () => new Promise((resolve) => {
    clearInterval(loop);
    io.close();
    server.close(() => resolve());
  });

  return { app, server, io, manager, close };
}
