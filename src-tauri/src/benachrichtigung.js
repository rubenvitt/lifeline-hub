// Native Meldung der Hülle (Benachrichtigungskonzept, D7; benachrichtigungen: „Native Meldung in
// der Desktop-App“). WKWebView bietet die Web-Notification-API nicht verlässlich, und das
// Notification-Plugin ersetzt `window.Notification` in jeder Seite durch einen Weg, den die Hülle
// der Seite nicht freigibt. Die Seite meldet deshalb über den Command `benachrichtigung_zeigen`; ob
// und wann, entscheidet allein das Frontend (`frontend/src/alarm/desktopAlarm.ts`), gelesen wird
// die Kennung nur in `frontend/src/huelle/faehigkeiten.ts`.
//
// Die Zahl der ungelesenen Eingänge am App-Symbol (LLH-1423; benachrichtigungen: „Ungelesene
// Eingänge im Tab-Titel“) setzt die Seite über `set_app_badge`; welche Zahl, entscheidet das Frontend
// (`frontend/src/alarm/appBadge.ts`).
//
// Läuft in jeder Hülle (macOS, Windows), vor `faehigkeiten.js`; beide ergänzen dieselbe Kennung.
// Ohne Origin-Prüfung: die Commands gibt die Hülle nur der Origin des Servers frei
// (`server_freigeben`), anderswo scheitern sie.
(() => {
  const ipc = window.__TAURI_INTERNALS__;
  if (!ipc || typeof ipc.invoke !== 'function') return;
  const benachrichtigungZeigen = (titel, text) =>
    ipc.invoke('benachrichtigung_zeigen', { titel, text: text ?? null });
  const setAppBadge = (count) => ipc.invoke('set_app_badge', { count });
  window.__LIFELINE_HUELLE__ = Object.freeze({
    ...window.__LIFELINE_HUELLE__,
    benachrichtigungZeigen,
    setAppBadge,
  });
})();
