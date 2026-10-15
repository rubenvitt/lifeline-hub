import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lässt die Init-Skripte der Hülle (`src-tauri/src/benachrichtigung.js`, Benachrichtigungskonzept
 * D7, und `src-tauri/src/faehigkeiten.js`, LFH-817) im jsdom laufen, wie der Webview sie vor dem
 * ersten Skript der Seite ausführt. Die Tests setzen die Kennung also nicht von Hand: benennt eine
 * Seite sie um, wird der Test rot, statt still zu driften.
 */
function liesSkript(datei: string): string {
  return readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../src-tauri/src', datei),
    'utf8',
  );
}

const benachrichtigungSkript = liesSkript('benachrichtigung.js');
const faehigkeitenSkript = liesSkript('faehigkeiten.js');

/** Stub der IPC-Brücke, die Tauri vor den Init-Skripten der Hülle einhängt. */
export interface HuellenIpc {
  invoke: (befehl: string, argumente?: Record<string, unknown>) => Promise<unknown>;
}

function haengeIpcEin(ipc?: HuellenIpc) {
  if (ipc) {
    (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__ = ipc;
  }
}

/** Die Skripte laufen in der Hülle global, hier über `Function` im selben `window`. */
function fuehreAus(skript: string) {
  new Function(skript)();
}

/**
 * Führt die Init-Skripte der macOS-Hülle in ihrer Reihenfolge aus. Mit `ipc` hängt vorher eine
 * IPC-Brücke im `window`, wie in der echten Hülle; ohne sie bleiben „Im Browser anmelden“ (LFH-818)
 * und die native Meldung aus.
 */
export function starteMacHuelle(ipc?: HuellenIpc) {
  haengeIpcEin(ipc);
  fuehreAus(benachrichtigungSkript);
  fuehreAus(faehigkeitenSkript);
}

/** Wie {@link starteMacHuelle}, aber nur mit dem Skript, das jede Hülle trägt (Windows). */
export function starteWindowsHuelle(ipc?: HuellenIpc) {
  haengeIpcEin(ipc);
  fuehreAus(benachrichtigungSkript);
}

export function beendeHuelle() {
  delete window.__LIFELINE_HUELLE__;
  delete (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__;
}
