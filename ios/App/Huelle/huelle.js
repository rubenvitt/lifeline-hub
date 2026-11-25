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
// `{ title, body }`, `set_app_badge` `{ count }`, `print`, `haptics` `{ kind }` (ohne Antwort), `push_register` (Antwort
// `{ registration_id, token, environment, key }`, Fehler `denied` oder `unavailable`),
// `push_unregister`, `push_state` (Antwort `{ permission: granted|denied|undetermined,
// registration_id? }`).
//
// Standort (LLH-2071): das Skript ersetzt `navigator.geolocation` und fragt die Hülle.
// `location_current` `{ high_accuracy, timeout }` antwortet einmal mit `{ latitude, longitude,
// accuracy, altitude, altitude_accuracy, heading, speed, timestamp }` (Zahlen, `null`, wo das Gerät
// nichts weiß; `timestamp` in ms seit 1970), Fehler `denied`, `unavailable` oder `timeout`.
// `location_watch` `{ high_accuracy, timeout }` antwortet nicht über `__LIFELINE_REPLY__`, sondern
// fortlaufend über `window.__LIFELINE_LOCATION__(id, fehler, position)`; `location_clear` `{ watch }`
// (ohne `id`, ohne Antwort) beendet sie. `timeout` (ms oder `null`) zählt die Hülle erst ab der
// Freigabe, wie die Web-API.
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
  // Jedes Dokument beginnt bei einem Zufallswert (LLH-2082): eine späte Antwort der Hülle an das
  // vorige Dokument trifft sonst dieselbe id im neuen. Ganzzahlig und weit unter 2^53.
  let naechsteId = Math.floor(Math.random() * 2 ** 40);

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

  // Standort (LLH-2071): `navigator.geolocation` über die Brücke. Fehler mit den Codes der Web-API.
  const FEHLERCODES = { denied: 1, unavailable: 2, timeout: 3 };
  const fehlerAus = (text) => {
    const code = FEHLERCODES[text] ?? 2;
    return Object.freeze({
      code,
      message: String(text),
      PERMISSION_DENIED: 1,
      POSITION_UNAVAILABLE: 2,
      TIMEOUT: 3,
    });
  };
  const zahlOderNull = (wert) => (typeof wert === 'number' ? wert : null);
  const positionAus = (p) =>
    Object.freeze({
      coords: Object.freeze({
        latitude: p.latitude,
        longitude: p.longitude,
        accuracy: p.accuracy,
        altitude: zahlOderNull(p.altitude),
        altitudeAccuracy: zahlOderNull(p.altitude_accuracy),
        heading: zahlOderNull(p.heading),
        speed: zahlOderNull(p.speed),
      }),
      timestamp: p.timestamp,
    });
  const optionenAus = (optionen) => {
    const timeout = optionen?.timeout;
    return {
      high_accuracy: optionen?.enableHighAccuracy === true,
      timeout: typeof timeout === 'number' && Number.isFinite(timeout) ? Math.max(0, timeout) : null,
    };
  };
  // Die letzte Position dieses Seitenlaufs, für `maximumAge`.
  let letzte = null;
  const merke = (position) => {
    letzte = position;
    return position;
  };
  const jungGenug = (optionen) => {
    const alter = optionen?.maximumAge;
    return letzte != null && typeof alter === 'number' && alter > 0 && Date.now() - letzte.timestamp <= alter;
  };
  const melde = (rueckruf, wert) => {
    if (typeof rueckruf === 'function') rueckruf(wert);
  };

  // Kennung der Seite → id der Brücke und Rückrufe.
  const beobachtungen = new Map();
  const beobachtungZuId = new Map();
  let naechsteBeobachtung = 0;

  Object.defineProperty(window, '__LIFELINE_LOCATION__', {
    configurable: true,
    enumerable: false,
    writable: false,
    value: (id, fehler, wert) => {
      const kennung = beobachtungZuId.get(id);
      const beobachtung = kennung == null ? null : beobachtungen.get(kennung);
      if (!beobachtung) return;
      if (fehler == null) melde(beobachtung.erfolg, merke(positionAus(wert)));
      else melde(beobachtung.fehler, fehlerAus(fehler));
    },
  });

  const geolocation = Object.freeze({
    getCurrentPosition: (erfolg, fehler, optionen) => {
      if (jungGenug(optionen)) {
        const position = letzte;
        queueMicrotask(() => melde(erfolg, position));
        return;
      }
      frage('location_current', optionenAus(optionen)).then(
        (wert) => melde(erfolg, merke(positionAus(wert))),
        (e) => melde(fehler, fehlerAus(e?.message ?? e)),
      );
    },
    watchPosition: (erfolg, fehler, optionen) => {
      naechsteId += 1;
      const id = naechsteId;
      naechsteBeobachtung += 1;
      const kennung = naechsteBeobachtung;
      beobachtungen.set(kennung, { id, erfolg, fehler });
      beobachtungZuId.set(id, kennung);
      try {
        handler.postMessage({ cmd: 'location_watch', id, ...optionenAus(optionen) });
      } catch {
        beobachtungen.delete(kennung);
        beobachtungZuId.delete(id);
        queueMicrotask(() => melde(fehler, fehlerAus('unavailable')));
      }
      return kennung;
    },
    clearWatch: (kennung) => {
      const beobachtung = beobachtungen.get(kennung);
      if (!beobachtung) return;
      beobachtungen.delete(kennung);
      beobachtungZuId.delete(beobachtung.id);
      try {
        handler.postMessage({ cmd: 'location_clear', watch: beobachtung.id });
      } catch {
        // Ohne Brücke läuft auch keine Beobachtung mehr.
      }
    },
  });
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    enumerable: true,
    get: () => geolocation,
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
    // Push über APNs (Entwurf „iOS-Alarme über APNs“): die Oberfläche meldet sich damit am Server an.
    push: true,
    pushRegister: () => frage('push_register', {}),
    pushUnregister: () => frage('push_unregister', {}),
    pushState: () => frage('push_state', {}),
  });

  // `window.print()` tut im WKWebView einer App nichts; die Hülle druckt über
  // `UIPrintInteractionController` (D8). Kein eigenes `beforeprint`/`afterprint` (wie `druck.js`).
  window.print = () => {
    frage('print', {}).catch((fehler) => console.error('Drucken nicht möglich:', fehler));
  };
})();
