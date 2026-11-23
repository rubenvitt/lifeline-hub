// Seite „nicht verträglich“ (LLH-1982): zeigt Richtung, Adresse und beide Versionen. „Nach Update
// suchen“ (nur wenn die App zu alt ist) stößt den Updater der Hülle an, der seine Dialoge selbst
// zeigt; „Erneut prüfen“ lässt die Hülle den Vertrag neu abfragen und bei Erfolg laden.
(() => {
  const invoke = (befehl, argumente) => window.__TAURI_INTERNALS__.invoke(befehl, argumente);
  const titel = document.getElementById('titel');
  const adresse = document.getElementById('adresse');
  const hinweis = document.getElementById('hinweis');
  const serverVersion = document.getElementById('server-version');
  const appVersion = document.getElementById('app-version');
  const fehler = document.getElementById('fehler');
  const update = document.getElementById('update');
  const erneut = document.getElementById('erneut');
  const wechseln = document.getElementById('wechseln');

  const TEXTE = {
    zu_neu: {
      titel: 'App aktualisieren',
      hinweis:
        'Dieser Server ist neuer als diese App und arbeitet mit ihr nicht mehr richtig zusammen. Installieren Sie das Update der App.',
    },
    zu_alt: {
      titel: 'Server ist zu alt für diese App',
      hinweis:
        'Dieser Server muss aktualisiert werden. Danach lädt die App ihn über „Erneut prüfen“.',
    },
  };

  // Die Sperre trägt ein Wort, nicht nur die blassere Fläche (LFH-434).
  const sperren = (gesperrt) => {
    for (const knopf of [update, erneut, wechseln]) knopf.disabled = gesperrt;
    erneut.textContent = gesperrt ? 'Prüfe…' : 'Erneut prüfen';
  };

  const ausfuehren = async (befehl) => {
    fehler.textContent = '';
    sperren(true);
    try {
      // Bei Erfolg navigiert die Hülle weg; sonst steht die Seite erneut da.
      await invoke(befehl);
    } catch (meldung) {
      fehler.textContent = String(meldung);
    } finally {
      sperren(false);
    }
  };

  update.addEventListener('click', () => ausfuehren('update_suchen'));
  erneut.addEventListener('click', () => ausfuehren('erneut_versuchen'));
  wechseln.addEventListener('click', () => ausfuehren('server_wechseln'));

  invoke('nicht_vertraeglich')
    .then(({ adresse: ziel, richtung, server_version: server, app_version: app }) => {
      const text = TEXTE[richtung] ?? TEXTE.zu_alt;
      titel.textContent = text.titel;
      document.title = `Lifeline Hub – ${text.titel}`;
      hinweis.textContent = text.hinweis;
      adresse.textContent = ziel;
      if (server) {
        serverVersion.textContent = `Server-Version: ${server}`;
        serverVersion.hidden = false;
      }
      appVersion.textContent = `App-Version: ${app}`;
      update.hidden = richtung !== 'zu_neu';
    })
    .catch(() => {})
    .finally(() => (update.hidden ? erneut : update).focus());
})();
