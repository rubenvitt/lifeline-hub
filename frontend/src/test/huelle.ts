import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lässt die Init-Skripte der Hüllen (`src-tauri/src/benachrichtigung.js`, Benachrichtigungskonzept
 * D7, `src-tauri/src/faehigkeiten.js`, LFH-817, und `ios/App/Huelle/huelle.js`, t39ltxxi) im jsdom
 * laufen, wie der Webview sie vor dem ersten Skript der Seite ausführt. Die Tests setzen die
 * Kennung also nicht von Hand: benennt eine Seite sie um, wird der Test rot, statt still zu driften.
 */
function liesSkript(pfad: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../..', pfad), 'utf8');
}

const benachrichtigungSkript = liesSkript('src-tauri/src/benachrichtigung.js');
const faehigkeitenSkript = liesSkript('src-tauri/src/faehigkeiten.js');
const iosSkript = liesSkript('ios/App/Huelle/huelle.js');

/** Der Platzhalter, den die iOS-Hülle beim Einspielen durch ihre volle Version ersetzt. */
export const IOS_VERSION_PLATZHALTER = '__LIFELINE_VERSION__';

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

/** Eine Nachricht, wie sie das Init-Skript der iOS-Hülle an den Message-Handler `lifeline` gibt. */
export interface IosNachricht {
  cmd: string;
  id?: number;
  [feld: string]: unknown;
}

/** Stub des Message-Handlers `lifeline`, den die iOS-Hülle vor ihrem Init-Skript einhängt. */
export interface IosBruecke {
  postMessage: (nachricht: IosNachricht) => void;
}

/** Die Rückruffunktion, über die die iOS-Hülle eine Antwort an die Seite gibt. */
type IosAntwort = (id: number, fehler: string | null, wert?: unknown) => void;

const originalPrint = window.print;

/**
 * Führt das Init-Skript der iOS-Hülle aus, wie `WKUserScript` es vor dem ersten Skript der Seite
 * tut; den Versions-Platzhalter ersetzt der Helfer wie die Hülle. Mit `bruecke` hängt vorher der
 * Message-Handler `lifeline` unter `window.webkit.messageHandlers`, sonst bleibt das Skript stumm.
 * `antworte` spielt die Antwort der Hülle auf eine Nachricht mit `id` ein.
 */
export function starteIosHuelle({
  bruecke,
  version = '1.0.0-alpha.7',
}: {
  bruecke?: IosBruecke;
  /** `null`: der Platzhalter bleibt stehen, als hätte die Hülle ihn nicht ersetzt. */
  version?: string | null;
} = {}) {
  if (bruecke) {
    (window as unknown as { webkit?: unknown }).webkit = {
      messageHandlers: { lifeline: bruecke },
    };
  }
  fuehreAus(version == null ? iosSkript : iosSkript.split(IOS_VERSION_PLATZHALTER).join(version));
}

/** Antwortet als iOS-Hülle auf die Nachricht mit `id`: `fehler` `null` erfüllt, sonst lehnt ab. */
export function antworteIosHuelle(id: number, fehler: string | null, wert?: unknown) {
  const antwort = (window as unknown as { __LIFELINE_REPLY__?: IosAntwort }).__LIFELINE_REPLY__;
  if (typeof antwort !== 'function') throw new Error('Keine Rückruffunktion der iOS-Hülle');
  antwort(id, fehler, wert);
}

export function beendeHuelle() {
  delete window.__LIFELINE_HUELLE__;
  delete (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__;
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __LIFELINE_REPLY__?: unknown }).__LIFELINE_REPLY__;
  window.print = originalPrint;
}
