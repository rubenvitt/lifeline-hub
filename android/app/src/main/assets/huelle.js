// Init-Skript der Android-Hülle (LLH-1989, Entwurf D4; Vorbild ist das Skript der iOS-Hülle
// `ios/App/Huelle/huelle.js`). Die Hülle spielt es über `WebViewCompat.addDocumentStartJavaScript`
// vor dem ersten Skript der Seite ein, nur für die Origin des aktiven Servers und nur im
// Hauptframe; vorher ersetzt sie den Platzhalter __LIFELINE_VERSION__ durch ihre volle Version
// (`Initskript`). Gelesen wird die Kennung im Frontend nur in `frontend/src/huelle/faehigkeiten.ts`;
// die Tests führen dieses Skript dort aus (`frontend/src/test/huelle.ts`).
//
// Brücke: `window.lifeline` ist das Objekt, das `addWebMessageListener` bereitstellt. Nachrichten
// gehen als JSON-Text `{ cmd, id, ... }` an `window.lifeline.postMessage(text)`. Wer eine Antwort
// erwartet, trägt eine `id`; die Hülle antwortet als `message`-Ereignis, dessen `data` der
// JSON-Text `{ id, fehler, wert }` ist (`fehler` `null` erfüllt, sonst Ablehnung). Die Hülle nimmt
// Nachrichten nur aus dem Hauptframe und nur von der Origin des aktiven Servers an.
// Befehle (Wire-Namen englisch, danach fest): `sign_in_with_browser`, `show_notification`
// `{ title, body }`, `print`, `download_blob` `{ name, data }` (`data` ist Base64), `haptics`
// `{ kind }` (ohne Antwort). Es gibt kein `set_app_badge`: Android kennt kein Badge-Zahlenfeld.
//
// Ohne `window.lifeline` (Browser, andere Hüllen) tut das Skript nichts.
(() => {
  const bruecke = window.lifeline;
  if (!bruecke || typeof bruecke.postMessage !== 'function') return;

  // Steht der Platzhalter noch da, hat die Hülle ihn nicht ersetzt: dann lieber keine Version.
  // Zusammengesetzt, damit das Ersetzen der Hülle diesen Vergleich nicht mit ersetzt.
  const rohVersion = '__LIFELINE_VERSION__';
  const version = rohVersion === '__LIFELINE_' + 'VERSION__' ? undefined : rohVersion;

  const offen = new Map();
  let naechsteId = 0;

  const empfange = (ereignis) => {
    let antwort;
    try {
      antwort = JSON.parse(ereignis.data);
    } catch {
      return;
    }
    if (!antwort || typeof antwort !== 'object') return;
    const wartend = offen.get(antwort.id);
    if (!wartend) return;
    offen.delete(antwort.id);
    if (antwort.fehler == null) wartend.erfuellen(antwort.wert);
    else wartend.ablehnen(new Error(String(antwort.fehler)));
  };
  bruecke.addEventListener('message', empfange);

  const sende = (cmd, felder) => bruecke.postMessage(JSON.stringify({ cmd, ...felder }));

  const frage = (cmd, felder) =>
    new Promise((erfuellen, ablehnen) => {
      naechsteId += 1;
      const id = naechsteId;
      offen.set(id, { erfuellen, ablehnen });
      try {
        sende(cmd, { id, ...felder });
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
      sende('haptics', { kind });
    } catch {
      // Ohne Haptik geht es weiter.
    }
  };

  window.__LIFELINE_HUELLE__ = Object.freeze({
    ...window.__LIFELINE_HUELLE__,
    platform: 'android',
    version,
    // Passkeys gehen im eingebetteten WebView nicht (Entwurf D4).
    passkey: false,
    anmeldungImBrowser: () => frage('sign_in_with_browser', {}),
    benachrichtigungZeigen: (titel, text) =>
      frage('show_notification', { title: titel, body: text ?? null }),
    haptics,
  });

  // `window.print()` tut im WebView einer App nichts; die Hülle druckt über den Druckdienst des
  // Systems (D8). Kein eigenes `beforeprint`/`afterprint` (wie `druck.js`).
  window.print = () => {
    frage('print', {}).catch((fehler) => console.error('Drucken nicht möglich:', fehler));
  };

  // Downloads (D8): der WebView speichert einen `blob:`-Anker nicht selbst. Die Seite liest den
  // Blob, schickt ihn als Base64 an die Hülle und unterdrückt die Standardaktion.
  const alsBase64 = (blob) =>
    new Promise((erfuellen, ablehnen) => {
      const leser = new FileReader();
      leser.onerror = () => ablehnen(leser.error ?? new Error('Der Download ist nicht lesbar.'));
      leser.onload = () => {
        const text = String(leser.result);
        erfuellen(text.slice(text.indexOf(',') + 1));
      };
      leser.readAsDataURL(blob);
    });

  document.addEventListener(
    'click',
    (ereignis) => {
      const ziel = ereignis.target;
      const anker = ziel && typeof ziel.closest === 'function' ? ziel.closest('a[download]') : null;
      const href = anker?.href;
      if (typeof href !== 'string' || !href.startsWith('blob:')) return;
      ereignis.preventDefault();
      const name = anker.getAttribute('download') || 'Download';
      fetch(href)
        .then((antwort) => antwort.blob())
        .then(alsBase64)
        .then((data) => frage('download_blob', { name, data }))
        .catch((fehler) => console.error('Download nicht möglich:', fehler));
    },
    true,
  );
})();
