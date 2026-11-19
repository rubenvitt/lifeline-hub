// Init-Skript der iOS-Hülle (Change t39ltxxi, Spec `huellen-vertrag`; Vorbild sind die Skripte der
// Desktop-Hülle `src-tauri/src/faehigkeiten.js`, `benachrichtigung.js` und `druck.js`). Die Hülle
// spielt es als `WKUserScript` vor dem ersten Skript der Seite und nur im Hauptframe ein; vorher
// ersetzt sie den Platzhalter __LIFELINE_VERSION__ durch ihre volle Version (`LifelineVersion`).
// Gelesen wird die Kennung im Frontend nur in `frontend/src/huelle/faehigkeiten.ts`; die Tests
// führen dieses Skript dort aus (`frontend/src/test/huelle.ts`).
//
// Brücke: Nachrichten gehen an den Message-Handler `lifeline` als `{ cmd, id, ... }`. Wer eine
// Antwort erwartet, trägt eine `id`; die Hülle antwortet per
// `window.__LIFELINE_REPLY__(id, fehler, wert)` (`fehler` `null` erfüllt, sonst Ablehnung). Die
// Hülle nimmt Nachrichten nur aus dem Hauptframe und nur von der Origin des aktiven Servers an.
// Befehle (Wire-Namen englisch, danach fest): `sign_in_with_browser`, `show_notification`
// `{ title, body }`, `set_app_badge` `{ count }`, `print`, `haptics` `{ kind }` (ohne Antwort).
//
// Ohne Message-Handler `lifeline` (Browser, Desktop-Hülle) tut das Skript nichts.
(() => {
  const handler = window.webkit?.messageHandlers?.lifeline;
  if (!handler || typeof handler.postMessage !== 'function') return;

  // Steht der Platzhalter noch da, hat die Hülle ihn nicht ersetzt: dann lieber keine Version.
  // Zusammengesetzt, damit das Ersetzen der Hülle diesen Vergleich nicht mit ersetzt.
  const rohVersion = '__LIFELINE_VERSION__';
  const version = rohVersion === '__LIFELINE_' + 'VERSION__' ? undefined : rohVersion;

  const offen = new Map();
  let naechsteId = 0;

  Object.defineProperty(window, '__LIFELINE_REPLY__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (id, fehler, wert) => {
      const wartend = offen.get(id);
      if (!wartend) return;
      offen.delete(id);
      if (fehler == null) wartend.erfuellen(wert);
      else wartend.ablehnen(new Error(String(fehler)));
    },
  });

  const frage = (cmd, felder) =>
    new Promise((erfuellen, ablehnen) => {
      naechsteId += 1;
      const id = naechsteId;
      offen.set(id, { erfuellen, ablehnen });
      try {
        handler.postMessage({ cmd, id, ...felder });
      } catch (fehler) {
        offen.delete(id);
        ablehnen(fehler);
      }
    });

  // Haptik (D6): fünf Arten, feuern und vergessen. Unbekanntes geht nicht an die Hülle, und ein
  // Fehler der Brücke darf die Handlung, die sie ausgelöst hat, nie stören.
  const ARTEN = new Set(['success', 'warning', 'error', 'selection', 'tap']);
  const haptics = (kind) => {
    if (!ARTEN.has(kind)) return;
    try {
      handler.postMessage({ cmd: 'haptics', kind });
    } catch {
      // Ohne Haptik geht es weiter.
    }
  };

  window.__LIFELINE_HUELLE__ = Object.freeze({
    ...window.__LIFELINE_HUELLE__,
    platform: 'ios',
    version,
    // Passkeys gehen im eingebetteten WKWebView nur für Associated Domains (design.md, Fakt 4).
    passkey: false,
    anmeldungImBrowser: () => frage('sign_in_with_browser', {}),
    benachrichtigungZeigen: (titel, text) =>
      frage('show_notification', { title: titel, body: text ?? null }),
    setAppBadge: (count) => frage('set_app_badge', { count }),
    haptics,
  });

  // `window.print()` tut im WKWebView einer App nichts; die Hülle druckt über
  // `UIPrintInteractionController` (D8). Kein eigenes `beforeprint`/`afterprint` (wie `druck.js`).
  window.print = () => {
    frage('print', {}).catch((fehler) => console.error('Drucken nicht möglich:', fehler));
  };
})();
