// Erststart-Maske: holt die Vorbelegung, sendet die Adresse an die Hülle, zeigt deren Meldung.
(() => {
  const invoke = (befehl, argumente) => window.__TAURI_INTERNALS__.invoke(befehl, argumente);
  const maske = document.getElementById('maske');
  const feld = document.getElementById('adresse');
  const fehler = document.getElementById('fehler');
  const verbinden = document.getElementById('verbinden');
  const abbrechen = document.getElementById('abbrechen');

  const zeigeFehler = (text) => {
    fehler.textContent = text;
    feld.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  // Die Sperre trägt ein Wort, nicht nur die blassere Fläche (LFH-434: Sperre ohne Farbe).
  const sperren = (gesperrt) => {
    verbinden.disabled = gesperrt;
    abbrechen.disabled = gesperrt;
    verbinden.textContent = gesperrt ? 'Verbinde…' : 'Verbinden';
  };

  maske.addEventListener('submit', async (ereignis) => {
    ereignis.preventDefault();
    zeigeFehler('');
    sperren(true);
    try {
      // Bei Erfolg navigiert die Hülle weg; danach läuft hier nichts mehr.
      await invoke('verbinden', { adresse: feld.value });
    } catch (meldung) {
      zeigeFehler(String(meldung));
      sperren(false);
      feld.focus();
    }
  });

  abbrechen.addEventListener('click', async () => {
    sperren(true);
    try {
      await invoke('abbrechen');
    } catch (meldung) {
      zeigeFehler(String(meldung));
      sperren(false);
    }
  });

  invoke('vorbelegung')
    .then(({ adresse, abbrechbar }) => {
      if (adresse) feld.value = adresse;
      abbrechen.hidden = !abbrechbar;
    })
    .catch(() => {})
    .finally(() => {
      feld.focus();
      feld.select();
    });
})();
