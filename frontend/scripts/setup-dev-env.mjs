#!/usr/bin/env node
import { createServer } from 'node:net';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const frontendDir = join(here, '..');

/** Lässt das OS einen freien Port wählen (listen auf 0) und gibt ihn zurück. */
function freierPort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

const backendPort = Number(process.env.BACKEND_PORT) || (await freierPort());
const frontendPort = Number(process.env.FRONTEND_PORT) || (await freierPort());
const backendUrl = `http://127.0.0.1:${backendPort}`;

const inhalt =
  `# Generiert von 'npm run setup' — pro Workspace dynamisch, NICHT committen.\n` +
  `FRONTEND_PORT=${frontendPort}\n` +
  `LIFELINE_BACKEND_URL=${backendUrl}\n`;

writeFileSync(join(frontendDir, '.env.local'), inhalt);

console.log('frontend/.env.local geschrieben:');
console.log(`  Frontend (Vite):  http://localhost:${frontendPort}`);
console.log(`  Backend (Proxy):  ${backendUrl}`);
console.log('\nBackend passend starten (Repo-Root):');
console.log(`  cargo run -- --bind 127.0.0.1:${backendPort}`);
console.log('  (alternativ: LIFELINE_BIND=127.0.0.1:' + backendPort + ' cargo run)');
