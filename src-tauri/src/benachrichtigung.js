// Native Meldung der Hülle (Benachrichtigungskonzept, D7; benachrichtigungen: „Native Meldung in
// der Desktop-App“). WKWebView bietet die Web-Notification-API nicht verlässlich, und das
// Notification-Plugin ersetzt `window.Notification` in jeder Seite durch einen Weg, den die Hülle
// der Seite nicht freigibt. Die Seite meldet deshalb über den Command `benachrichtigung_zeigen`; ob
// und wann, entscheidet allein das Frontend (`frontend/src/alarm/desktopAlarm.ts`), gelesen wird
// die Kennung nur in `frontend/src/huelle/faehigkeiten.ts`.
//
// Läuft in jeder Hülle (macOS, Windows), vor `faehigkeiten.js`; beide ergänzen dieselbe Kennung.
// Ohne Origin-Prüfung: den Command gibt die Hülle nur der Origin des Servers frei
// (`server_freigeben`), anderswo scheitert er.
(() => {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc || typeof ipc.invoke !== 'function') return;
  const benachrichtigungZeigen = (titel, text) =>
    ipc.invoke('benachrichtigung_zeigen', { titel, text: text ?? null });
  window.__LIFELINE_HUELLE__ = Object.freeze({
    ...window.__LIFELINE_HUELLE__,
    benachrichtigungZeigen,
  });
})();
