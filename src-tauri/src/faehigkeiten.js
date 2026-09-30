// Fähigkeiten der macOS-Hülle (LFH-817, desktop-huelle: „Die Hülle meldet, ob sie Passkeys
// ausführen kann“). Im WKWebView scheitert jeder Passkey nach 4 ms mit `NotAllowedError`, obwohl
// `getClientCapabilities()` ihn meldet (LFH-783, Fakt 2) — die Seite kann es nicht selbst
// erkennen, ohne einen Versuch scheitern zu lassen. Gelesen wird die Kennung im Frontend nur in
// `frontend/src/huelle/faehigkeiten.ts`; dort gilt allein `passkey: false` als Sperre.
//
// „Im Browser anmelden“ (LFH-818): startet die Anmeldung im Systembrowser über den Command
// `anmeldung_im_browser`. Das Ergebnis meldet die Hülle später als Ereignis
// `lifeline:app-anmeldung`; gelesen in `frontend/src/huelle/faehigkeiten.ts`.
//
// Ohne Origin-Prüfung: das Skript läuft auf jeder Seite im Hauptframe, auch beim IdP. Den Command
// gibt die Hülle aber nur der Origin des Servers frei (`server_freigeben`), anderswo scheitert er.
(() => {
  const ipc = window.__TAURI_INTERNALS__;
  const anmeldungImBrowser =
    ipc && typeof ipc.invoke === 'function'
      ? () => ipc.invoke('anmeldung_im_browser')
      : undefined;
  window.__LIFELINE_HUELLE__ = Object.freeze({ passkey: false, anmeldungImBrowser });
})();
