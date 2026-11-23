import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Lässt die Init-Skripte der Hüllen (`src-tauri/src/kennung.js`, LLH-1982,
 * `src-tauri/src/benachrichtigung.js`, Benachrichtigungskonzept D7, `src-tauri/src/faehigkeiten.js`,
 * LFH-817, `ios/App/Huelle/huelle.js`, t39ltxxi, und `android/app/src/main/assets/huelle.js`,
 * LLH-1989) im jsdom
 * laufen, wie der Webview sie vor dem ersten Skript der Seite ausführt. Die Tests setzen die
 * Kennung also nicht von Hand: benennt eine Seite sie um, wird der Test rot, statt still zu driften.
 */
function liesSkript(pfad: string): string {
  return readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../..', pfad), 'utf8');
}

const kennungSkript = liesSkript('src-tauri/src/kennung.js');
const benachrichtigungSkript = liesSkript('src-tauri/src/benachrichtigung.js');
const faehigkeitenSkript = liesSkript('src-tauri/src/faehigkeiten.js');
const iosSkript = liesSkript('ios/App/Huelle/huelle.js');
const androidSkript = liesSkript('android/app/src/main/assets/huelle.js');

/** Der Platzhalter, den beide Hüllen (iOS und Android) beim Einspielen durch ihre volle Version ersetzen. */
export const VERSION_PLACEHOLDER = '__LIFELINE_VERSION__';

/**
 * Ersetzt den Platzhalter wie die Hülle. Fehlt er im Skript (umbenannt), bricht der Test ab, statt
 * still nichts zu ersetzen und den Fall „ohne Version“ zu prüfen.
 */
function replaceVersion(skript: string, pfad: string, version: string | null): string {
  if (version == null) return skript;
  if (!skript.includes(VERSION_PLACEHOLDER)) {
    throw new Error(`${pfad} enthält den Platzhalter ${VERSION_PLACEHOLDER} nicht`);
  }
  return skript.split(VERSION_PLACEHOLDER).join(version);
}

/** Version, die die Desktop-Hülle in den Tests nennt (in der App: die Version des Workspace). */
export const DESKTOP_TEST_VERSION = '1.0.0-alpha.test';

/** Wie die Desktop-Hülle gestartet wird: Plattform der Kennung, oder eine Hülle vor LLH-1982. */
export interface DesktopOptionen {
  platform?: string;
  /** Eine ältere Desktop-Hülle ohne `kennung.js` (ohne `platform` und `version`). */
  ohneKennung?: boolean;
}

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

/** Setzt die Werte ein, wie `kennung_skript` in `src-tauri/src/main.rs` es tut. */
function fuehreKennungAus(platform: string) {
  fuehreAus(
    kennungSkript
      .replace('__PLATFORM__', JSON.stringify(platform))
      .replace('__VERSION__', JSON.stringify(DESKTOP_TEST_VERSION)),
  );
}

/**
 * Führt die Init-Skripte der macOS-Hülle in ihrer Reihenfolge aus. Mit `ipc` hängt vorher eine
 * IPC-Brücke im `window`, wie in der echten Hülle; ohne sie bleiben „Im Browser anmelden“ (LFH-818)
 * und die native Meldung aus.
 */
export function starteMacHuelle(
  ipc?: HuellenIpc,
  { platform = 'macos', ohneKennung = false }: DesktopOptionen = {},
) {
  haengeIpcEin(ipc);
  if (!ohneKennung) fuehreKennungAus(platform);
  fuehreAus(benachrichtigungSkript);
  fuehreAus(faehigkeitenSkript);
}

/** Wie {@link starteMacHuelle}, aber nur mit dem Skript, das jede Hülle trägt (Windows). */
export function starteWindowsHuelle(
  ipc?: HuellenIpc,
  { platform = 'windows', ohneKennung = false }: DesktopOptionen = {},
) {
  haengeIpcEin(ipc);
  if (!ohneKennung) fuehreKennungAus(platform);
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
  fuehreAus(replaceVersion(iosSkript, 'ios/App/Huelle/huelle.js', version));
}

/** Antwortet als iOS-Hülle auf die Nachricht mit `id`: `fehler` `null` erfüllt, sonst lehnt ab. */
export function antworteIosHuelle(id: number, fehler: string | null, wert?: unknown) {
  const antwort = (window as unknown as { __LIFELINE_REPLY__?: IosAntwort }).__LIFELINE_REPLY__;
  if (typeof antwort !== 'function') throw new Error('Keine Rückruffunktion der iOS-Hülle');
  antwort(id, fehler, wert);
}

/** Stub des Objekts `window.lifeline`, das `addWebMessageListener` der Android-Hülle einhängt. */
export interface AndroidBruecke {
  postMessage: (text: string) => void;
}

/** Die Nachricht einer Android-Hülle an die Seite: `data` ist der JSON-Text von `replyJson`. */
type AndroidAntworter = EventTarget;

const androidAntworter = new WeakMap<object, AndroidAntworter>();

/**
 * Führt das Init-Skript der Android-Hülle aus, wie `addDocumentStartJavaScript` es vor dem ersten
 * Skript der Seite tut; den Versions-Platzhalter ersetzt der Helfer wie die Hülle. Mit `bruecke`
 * hängt vorher `window.lifeline` (mit `postMessage` und `message`-Ereignissen), sonst bleibt das
 * Skript stumm. {@link antworteAndroidHuelle} spielt die Antwort der Hülle ein.
 */
export function starteAndroidHuelle({
  bruecke,
  version = '1.0.0-alpha.7',
}: {
  bruecke?: AndroidBruecke;
  /** `null`: der Platzhalter bleibt stehen, als hätte die Hülle ihn nicht ersetzt. */
  version?: string | null;
} = {}) {
  if (bruecke) {
    const ziel = new EventTarget();
    const objekt = Object.assign(ziel, { postMessage: bruecke.postMessage });
    androidAntworter.set(objekt, ziel);
    (window as unknown as { lifeline?: unknown }).lifeline = objekt;
  }
  fuehreAus(replaceVersion(androidSkript, 'android/app/src/main/assets/huelle.js', version));
}

/** Antwortet als Android-Hülle auf die Nachricht mit `id`: `fehler` `null` erfüllt, sonst lehnt ab. */
export function antworteAndroidHuelle(id: number, fehler: string | null, wert: unknown = null) {
  const objekt = (window as unknown as { lifeline?: object }).lifeline;
  const ziel = objekt && androidAntworter.get(objekt);
  if (!ziel) throw new Error('Keine Brücke der Android-Hülle');
  ziel.dispatchEvent(
    Object.assign(new Event('message'), { data: JSON.stringify({ id, fehler, wert }) }),
  );
}

export function beendeHuelle() {
  delete (window as unknown as { lifeline?: unknown }).lifeline;
  delete window.__LIFELINE_HUELLE__;
  delete (window as unknown as { __TAURI_INTERNALS__?: HuellenIpc }).__TAURI_INTERNALS__;
  delete (window as unknown as { webkit?: unknown }).webkit;
  delete (window as unknown as { __LIFELINE_REPLY__?: unknown }).__LIFELINE_REPLY__;
  window.print = originalPrint;
}
