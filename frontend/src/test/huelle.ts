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

/** Stub der IPC-Brücke, die Tauri vor den Init-Skripten der Hülle einhängt. */
export interface HuellenIpc {
  invoke: (befehl: string) => Promise<unknown>;
}

/**
 * Führt das Init-Skript aus. Mit `ipc` hängt vorher eine IPC-Brücke im `window`, wie in der
 * echten Hülle; ohne sie bleibt „Im Browser anmelden“ (LFH-818) aus.
 */
export function starteMacHuelle(ipc?: HuellenIpc) {
  if (ipc) {
    (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__ = ipc;
  }
  // Das Skript läuft in der Hülle global, hier über `Function` im selben `window`.
  new Function(skript)();
}

export function beendeHuelle() {
  delete window.__LIFELINE_HUELLE__;
  delete (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__;
}
