import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lässt das Init-Skript der macOS-Hülle (`src-tauri/src/faehigkeiten.js`, LFH-817) im jsdom laufen,
 * wie der WKWebView es vor dem ersten Skript der Seite tut. Die Tests setzen die Kennung also nicht
 * von Hand: benennt eine Seite sie um, wird der Test rot, statt still zu driften.
 */
const skript = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../src-tauri/src/faehigkeiten.js'),
  'utf8',
);

export function starteMacHuelle() {
  // Das Skript läuft in der Hülle global, hier über `Function` im selben `window`.
  new Function(skript)();
}

export function beendeHuelle() {
  delete window.__LIFELINE_HUELLE__;
}
