// Arranca servidor y cliente a la vez en desarrollo (Ctrl+C cierra ambos).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const procs = [
  // El servidor de juego va siempre en 3001 (Vite, en 5173, le reenvía /socket.io).
  spawn(npm, ['run', 'dev', '-w', 'server'], { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, PORT: '3001' } }),
  spawn(npm, ['run', 'dev', '-w', 'client'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) stop(); }));
