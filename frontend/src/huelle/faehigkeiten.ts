/**
 * Fähigkeiten der Desktop-Hülle (LFH-817/LFH-818, Entscheidung LFH-783). Die einzige Stelle im
 * Frontend, die die Kennung der Hülle liest.
 *
 * Die macOS-Hülle setzt per Init-Skript (`src-tauri/src/faehigkeiten.js`) vor dem ersten Skript
 * der Seite `window.__LIFELINE_HUELLE__ = { passkey: false }`. Die Kennung geht der
 * Feature-Erkennung vor: WKWebView meldet über `getClientCapabilities()` einen Passkey, den es in
 * der Hülle nicht einlöst. Ohne Kennung (Browser, Windows-Hülle) bleibt alles wie bisher.
 */

declare global {
  interface Window {
    __LIFELINE_HUELLE__?: {
      readonly passkey?: boolean;
      readonly anmeldungImBrowser?: () => Promise<unknown>;
    };
  }
}

/**
 * Sperrt die Hülle Passkeys (Anmeldung und Einrichtung)? Nur ein ausdrückliches `passkey: false`
 * sperrt; fehlt die Kennung oder das Feld, gilt der Bestand. Gelesen beim Aufruf, nicht beim
 * Laden des Moduls.
 */
export function huelleSperrtPasskey(): boolean {
  return window.__LIFELINE_HUELLE__?.passkey === false;
}

/**
 * „Im Browser anmelden“ (LFH-818): startet in der macOS-Hülle die Anmeldung im Systembrowser. Das
 * Ergebnis meldet die Hülle später als {@link APP_ANMELDUNG_EREIGNIS}. `null` außerhalb der Hülle.
 */
export function huelleAnmeldungImBrowser(): (() => Promise<void>) | null {
  const anmelden = window.__LIFELINE_HUELLE__?.anmeldungImBrowser;
  if (typeof anmelden !== 'function') return null;
  return async () => {
    await anmelden();
  };
}

/** Ereignis, mit dem die Hülle das Ergebnis der Anmeldung im Browser meldet (LFH-818). */
export const APP_ANMELDUNG_EREIGNIS = 'lifeline:app-anmeldung';

export type AppAnmeldungErgebnis = 'angemeldet' | 'abgelehnt' | 'fehler' | 'abgebrochen';
