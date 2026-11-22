// Kennung der Desktop-Hülle (LLH-1982, Spec `huellen-vertrag`): Plattform (`macos`, `windows`)
// und volle Version der Hülle, wie die iOS-Hülle sie nennt. Die Werte setzt die Hülle beim Bau des
// Fensters ein (`kennung_skript` in main.rs). Läuft in jeder Hülle als erstes Init-Skript; die
// übrigen (`benachrichtigung.js`, `faehigkeiten.js`) ergänzen dieselbe Kennung. Gelesen wird sie im
// Frontend nur in `frontend/src/huelle/faehigkeiten.ts`.
(() => {
  window.__LIFELINE_HUELLE__ = Object.freeze({
    ...window.__LIFELINE_HUELLE__,
    platform: __PLATFORM__,
    version: __VERSION__,
  });
})();
