# Proposal

## Why

Auf einem gehärteten Behördenrechner (Firefox mit `dom.storage.enabled=false`) ist
`localStorage` `null`, und jeder Zugriff wirft. `ThemeModeProvider` liest Farbschema, Dichte und
Helligkeit ohne Schutz im `useState`-Initialisierer. Er sitzt in `main.tsx` ganz oben, darüber
liegt keine Error-Boundary: Die Seite bleibt weiß, ohne Anmeldemaske und ohne Fehlermeldung.
Der Koordinatensystem-Speicher liest genauso ungeschützt bei jedem Render und benachrichtigt
seine Abonnenten nicht, wenn das Schreiben scheitert. Auch die ETB-Entwürfe schreiben den
aktiven Tab ungeschützt, teils in einem State-Updater.

Die übrigen Speicher fangen jeden Zugriff mit eigenem `try/catch` ab, jeder für sich. Nichts
verhindert, dass der nächste neue Speicher das vergisst.

Unabhängig davon schreibt die Serveruhr nach jeder API-Antwort in `localStorage`. Weil
`gemessenAt` sich jedes Mal ändert, bekommt jeder andere Tab derselben Origin ein
`storage`-Ereignis. Im Dauerbetrieb mit 4 bis 6 Tabs sind das je Live-Ereignis Dutzende
Schreibvorgänge ohne fachlichen Gewinn.

## What Changes

- **Ein Helfer für den Browserspeicher:** `frontend/src/lib/sichererSpeicher.ts` mit
  `sicherLesen`, `sicherSchreiben`, `sicherEntfernen` und `sicherSchluessel`. Jede Funktion fängt
  jeden Wurf ab, auch `localStorage === null`, und fällt auf `null`, `false` bzw. `[]` zurück.
- **Alle Zugriffe laufen über den Helfer:** Farbschema, Dichte, Helligkeit, Koordinatensystem,
  ETB-Entwürfe und alle übrigen Speicher werden umgestellt (Sweep), danach wird der Guard scharf.
- **App ohne Speicher bedienbar:** Ohne Speicher rendert die App im Nachtbetrieb; die
  Wahl des Koordinatensystems wirkt sofort in allen Abonnenten und gilt bis zum Neuladen.
- **Guard (neue Regel):** `sichererSpeicher.guard.test.ts` macht jedes `localStorage` im Code
  außerhalb des Helfers rot. Die Regel steht in `frontend/AGENTS.md`.
- **Gerätespeicher-Guard zieht mit:** Er erkennt Schreiber künftig auch an `sicherSchreiben(`,
  sonst verlöre er nach dem Sweep jede Datei aus dem Blick.
- **Serveruhr schreibt seltener:** `merkeServerzeit` hält jede Messung weiter im Tab, schreibt
  sie aber nur noch in `localStorage`, wenn der Versatz um mehr als 1 s von der gespeicherten
  Messung abweicht oder diese älter als 10 min ist. `serverJetzt()` bleibt unverändert.

## Capabilities

### New Capabilities

- `browserspeicher`: Wie das Frontend mit dem Browserspeicher umgeht, wenn er gesperrt oder voll
  ist, und wie oft die Serveruhr ihn beschreibt.

### Modified Capabilities

Keine. `geraetedaten-raeumung` verlangt schon, dass jeder neue Schreiber im Verzeichnis steht;
der Guard erkennt ihn nur an einem zweiten Muster. `ereigniszeit-vorgabe` gilt unverändert, weil
`serverJetzt()` die Messung des eigenen Tabs weiter bei jeder Antwort sieht.

## Impact

- Frontend: neuer Helfer `lib/sichererSpeicher.ts` samt Test und Guard;
  `theme/ThemeModeProvider.tsx`, `anzeige/koordinatenSystemStore.ts`, `offline/serveruhr.ts`,
  `etb/entwuerfe/useEtbEntwuerfe.ts`, `etb/entwuerfe/entwurfStore.ts` und die übrigen Speicher
  (rund 15 Dateien, je wenige Zeilen); `offline/geraetRaeumung.guard.test.ts`.
- Regel in `frontend/AGENTS.md`.
- Kein Backend, keine Migration, keine API-Änderung. `index.html` fängt den Zugriff schon ab
  und bleibt.
