// Anzeige „nicht erreichbar“ (LLH-1283): zeigt die Adresse, lädt auf Knopfdruck erneut und prüft
// selbst weiter, wenn der Server gar nicht antwortete. Geladen wird erst, wenn die Prüfung der
// Hülle ihn erreicht — sonst spränge das Fenster zwischen leer und Anzeige.
(() => {
  const invoke = (befehl, argumente) => window.__TAURI_INTERNALS__.invoke(befehl, argumente);
  const adresse = document.getElementById('adresse');
  const fehler = document.getElementById('fehler');
  const erneut = document.getElementById('erneut');
  const wechseln = document.getElementById('wechseln');

  /** Abstand der eigenen Prüfungen. */
  const TAKT_MS = 5000;

  const sperren = (gesperrt) => {
    erneut.disabled = gesperrt;
    wechseln.disabled = gesperrt;
    erneut.textContent = gesperrt ? 'Verbinde…' : 'Erneut versuchen';
  };

  const laden = async () => {
    sperren(true);
    try {
      // Bei Erfolg navigiert die Hülle weg; kommt wieder keine Seite, steht die Anzeige erneut da.
      await invoke('erneut_versuchen');
    } catch (meldung) {
      fehler.textContent = String(meldung);
      sperren(false);
    }
  };

  const pruefen = async () => {
    try {
      if (await invoke('check_server')) {
        await laden();
        return;
      }
    } catch {
      // Prüfung gescheitert: im nächsten Takt wieder.
    }
    setTimeout(pruefen, TAKT_MS);
  };

  erneut.addEventListener('click', laden);
  wechseln.addEventListener('click', async () => {
    sperren(true);
    try {
      await invoke('server_wechseln');
    } catch (meldung) {
      fehler.textContent = String(meldung);
      sperren(false);
    }
  });

  invoke('nicht_erreichbar')
    .then(({ adresse: ziel, automatisch }) => {
      adresse.textContent = ziel;
      if (automatisch) setTimeout(pruefen, TAKT_MS);
    })
    .catch(() => {})
    .finally(() => erneut.focus());
})();
