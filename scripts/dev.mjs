// Arranca servidor de salas (3001) y cliente Vite (5173) a la vez. Ctrl+C cierra ambos.
// Se lanzan con node directamente (sin shell): así no hay aviso DEP0190 y, al cerrar,
// no quedan procesos huérfanos ocupando los puertos.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_PORT = 3001;
const CLIENT_PORT = 5173;

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => srv.close(() => resolve(true)))
      .listen(port);
  });
}

const busy = [];
for (const port of [SERVER_PORT, CLIENT_PORT]) if (!(await portFree(port))) busy.push(port);
if (busy.length) {
  console.error(`\n[RanRan] Puerto(s) ocupado(s): ${busy.join(', ')}. Probablemente quedó abierta otra ejecución de "npm run dev".`);
  console.error('Ciérrala (Ctrl+C en su terminal) o, en PowerShell, libera el puerto con:');
  for (const port of busy) {
    console.error(`  Stop-Process -Id (Get-NetTCPConnection -LocalPort ${port} -State Listen).OwningProcess`);
  }
  process.exit(1);
}

const require = createRequire(path.join(ROOT, 'client', 'package.json'));
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const procs = [
  spawn(process.execPath, ['--watch', 'src/index.js'], {
    cwd: path.join(ROOT, 'server'),
    stdio: 'inherit',
    env: { ...process.env, PORT: String(SERVER_PORT) },
  }),
  spawn(process.execPath, [viteBin, '--port', String(CLIENT_PORT), '--strictPort'], {
    cwd: path.join(ROOT, 'client'),
    stdio: 'inherit',
  }),
];

let stopping = false;
const stop = (code = 0) => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
  process.exitCode = code;
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
for (const p of procs) p.on('exit', (code) => { if (!stopping) stop(code ?? 1); });
