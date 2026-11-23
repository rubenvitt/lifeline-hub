// Standort in Unterframes der iOS-Hülle (LLH-2071, Entwurf
// `docs/superpowers/specs/2026-11-23-ktrtv1lt-standort-app-huellen-design.md`). Die Hülle spielt
// dieses Skript als `WKUserScript` mit `forMainFrameOnly: false` in jeden Frame ein. Im Hauptframe
// liefert `huelle.js` den Standort über die Brücke; in einem Unterframe fragte WebKit sonst selbst
// nach dem Standort, an der Brücke und ihrer Regel „nur der aktive Server“ vorbei. Dort meldet jede
// Abfrage deshalb „verweigert“ (Code 1).
(() => {
  if (window.top === window) return;
  const verweigert = Object.freeze({
    code: 1,
    message: 'denied',
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  });
  const lehneAb = (fehler) => {
    if (typeof fehler === 'function') queueMicrotask(() => fehler(verweigert));
  };
  const geolocation = Object.freeze({
    getCurrentPosition: (_erfolg, fehler) => lehneAb(fehler),
    watchPosition: (_erfolg, fehler) => {
      lehneAb(fehler);
      return 0;
    },
    clearWatch: () => {},
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    enumerable: true,
    get: () => geolocation,
  });
})();
