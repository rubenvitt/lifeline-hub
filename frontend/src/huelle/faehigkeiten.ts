/**
 * Fähigkeiten der Desktop-Hülle (LFH-817, Entscheidung LFH-783 Stufe 1). Die einzige Stelle im
 * Frontend, die die Kennung der Hülle liest.
 *
 * Die macOS-Hülle setzt per Init-Skript (`src-tauri/src/faehigkeiten.js`) vor dem ersten Skript
 * der Seite `window.__LIFELINE_HUELLE__ = { passkey: false }`. Die Kennung geht der
 * Feature-Erkennung vor: WKWebView meldet über `getClientCapabilities()` einen Passkey, den es in
 * der Hülle nicht einlöst. Ohne Kennung (Browser, Windows-Hülle) bleibt alles wie bisher.
 */

declare global {
  interface Window {
    __LIFELINE_HUELLE__?: { readonly passkey?: boolean };
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
