// Fähigkeiten der macOS-Hülle (LFH-817, desktop-huelle: „Die Hülle meldet, ob sie Passkeys
// ausführen kann“). Im WKWebView scheitert jeder Passkey nach 4 ms mit `NotAllowedError`, obwohl
// `getClientCapabilities()` ihn meldet (LFH-783, Fakt 2) — die Seite kann es nicht selbst
// erkennen, ohne einen Versuch scheitern zu lassen. Gelesen wird die Kennung im Frontend nur in
// `frontend/src/huelle/faehigkeiten.ts`; dort gilt allein `passkey: false` als Sperre.
//
// Ohne Origin-Prüfung: das Skript läuft auf jeder Seite im Hauptframe, auch beim IdP. Mehr als
// „diese Hülle kann keinen Passkey“ steht darin nicht.
window.__LIFELINE_HUELLE__ = Object.freeze({ passkey: false });
