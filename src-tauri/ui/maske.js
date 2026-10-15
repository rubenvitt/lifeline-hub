// Erststart-Maske: holt die Vorbelegung, sendet die Adresse an die Hülle, zeigt deren Meldung.
// Seit LLH-1282 mit der Auswahl der zuletzt verbundenen Server: ein Klick verbindet.
(() => {
  const invoke = (befehl, argumente) => window.__TAURI_INTERNALS__.invoke(befehl, argumente);
  const maske = document.getElementById('maske');
  const feld = document.getElementById('adresse');
  const fehler = document.getElementById('fehler');
  const verbinden = document.getElementById('verbinden');
  const abbrechen = document.getElementById('abbrechen');
  const liste = document.getElementById('bekannt');

  const zeigeFehler = (text) => {
    fehler.textContent = text;
    feld.setAttribute('aria-invalid', text ? 'true' : 'false');
  };

  // Die Sperre trägt ein Wort, nicht nur die blassere Fläche (LFH-434: Sperre ohne Farbe).
  const sperren = (gesperrt) => {
    verbinden.disabled = gesperrt;
    abbrechen.disabled = gesperrt;
    for (const knopf of liste.querySelectorAll('button')) knopf.disabled = gesperrt;
    verbinden.textContent = gesperrt ? 'Verbinde…' : 'Verbinden';
  };

  const verbindeMit = async (adresse) => {
    zeigeFehler('');
    sperren(true);
    try {
      // Bei Erfolg navigiert die Hülle weg; danach läuft hier nichts mehr.
      await invoke('verbinden', { adresse });
    } catch (meldung) {
      zeigeFehler(String(meldung));
      sperren(false);
      feld.focus();
    }
  };

  // Je bekanntem Server ein Knopf zum Verbinden und einer zum Entfernen; der verbundene trägt
  // die Marke „verbunden“ und lässt sich nicht entfernen.
  const zeigeBekannte = (bekannt) => {
    liste.replaceChildren(
      ...bekannt.map(({ adresse, host, verbunden: istVerbunden }) => {
        const zeile = document.createElement('li');
        const eintrag = document.createElement('button');
        eintrag.type = 'button';
        eintrag.className = 'eintrag';
        const name = document.createElement('span');
        name.className = 'host';
        name.textContent = host;
        const voll = document.createElement('code');
        voll.textContent = adresse;
        eintrag.append(name, voll);
        if (istVerbunden) {
          const marke = document.createElement('span');
          marke.className = 'marke';
          marke.textContent = 'verbunden';
          eintrag.append(marke);
        }
        eintrag.addEventListener('click', () => verbindeMit(adresse));
        zeile.append(eintrag);
        if (!istVerbunden) {
          const entfernen = document.createElement('button');
          entfernen.type = 'button';
          entfernen.className = 'entfernen';
          entfernen.textContent = '×';
          entfernen.setAttribute('aria-label', `${host} entfernen`);
          entfernen.addEventListener('click', async () => {
            try {
              zeigeBekannte(await invoke('vergessen', { adresse }));
            } catch (meldung) {
              zeigeFehler(String(meldung));
            }
          });
          zeile.append(entfernen);
        }
        return zeile;
      }),
    );
    liste.hidden = bekannt.length === 0;
  };

  maske.addEventListener('submit', (ereignis) => {
    ereignis.preventDefault();
    verbindeMit(feld.value);
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
    .then(({ adresse, abbrechbar, bekannt }) => {
      // Mit Auswahl bleibt das Feld für eine neue Adresse frei, außer ein Link brachte eine mit.
      const auswahl = (bekannt ?? []).length > 0;
      if (adresse && !(auswahl && (bekannt ?? []).some((b) => b.adresse === adresse))) {
        feld.value = adresse;
      }
      zeigeBekannte(bekannt ?? []);
      abbrechen.hidden = !abbrechbar;
    })
    .catch(() => {})
    .finally(() => {
      feld.focus();
      feld.select();
    });
})();
