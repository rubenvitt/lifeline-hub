# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test). Pfade
relativ zu `frontend/src/`. Kommandos laufen über `mise exec -- pnpm -C frontend …`.

## 1. Ableitung „Unwetter“ (`wetter/unwetter.ts`, D9, D4)

- [x] 1.1 `unwetterLage(anzeige, jetzt)` mit `UNWETTER_STUFEN`: nur `schwer`/`extrem`, nur bei
  `teilStand` `aktuell`/`veraltet`, getrennt nach `teileWarnungen`; `null` bei `unbekannt`,
  `kein_ort` oder `zustand ≠ ok`. Prüfen: `wetter/unwetter.test.ts` deckt die Stufen gering/mäßig
  (fallen heraus), abgelaufene Warnung, Obergrenze 6 h (→ `null`) und `kein_ort` ab.
- [x] 1.2 `paarSchluessel(w)` (Ereignis getrimmt und in Versalien, plus Stufe) und
  `erkenneNeue(gedaechtnis, warnungen, jetzt) → { neu, weitere, gedaechtnis }` nach D4:
  6-h-Fenster, Herabstufung, höchstens ein Hinweis je Auswertung (höchste Stufe, dann frühester
  Beginn), Aufräumen alter Einträge. Prüfen: Tests für erstes Öffnen, Aktualisierung mit neuem
  Ende, Hochstufung schwer→extrem, Herabstufung extrem→schwer mit anderem Ereignisnamen,
  Wiederkehr nach > 6 h, Lücke < 6 h, zwei neue zugleich (`weitere: 1`).
- [x] 1.3 Text-Helfer `unwetterHinweisText(w, weitere, jetzt, konv)` und
  `unwetterMarkenText(w)` über `dwdWarnstufe`, `titelSchreibung` und `warnZeitraum`. Prüfen:
  Tests auf „Unwetterwarnung“ / „Schweres Gewitter, ab 17:00 · bis 20:00“ und „(+ 1 weitere)“.

## 2. Gedächtnis (`wetter/unwetterGedaechtnis.ts`, D5)

- [x] 2.1 `ladeGedaechtnis(benutzerId, einsatzId)` / `speichereGedaechtnis(…)` mit dem Schlüssel
  `lifeline-unwetter-gemeldet:<benutzerId>:<einsatzId>`, `try/catch` und Rückfall auf eine
  Modul-`Map`, die beim Lesen vorgeht. Unlesbares JSON gilt als leer. Prüfen: Tests mit
  gesperrtem `localStorage` (wirft), vollem Kontingent bei vorhandenem Schlüssel (nur `setItem`
  wirft), kaputtem JSON und getrennten Personen/Einsätzen.

## 3. Modulzähler (D7)

- [x] 3.1 `ClientZaehlerQuelle` um `'wetter-pegel'` erweitern und den Registry-Eintrag mit
  `zaehlerQuelle: 'wetter-pegel'` versehen. Prüfen: `einsatz/modulRegistry.test.ts` und
  vorhandene Guards grün, `tsc` ohne Fehler.
- [x] 3.2 `berechneUnwetterZaehler(anzeige, jetzt)` in `einsatz/useModulZaehler.ts` (Wortlaut
  „2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt“, Singular, ohne „davon“ bei 0,
  `undefined` ohne verwertbaren Stand). Prüfen: Fälle in `einsatz/useModulZaehler.test.ts`.
- [x] 3.3 `useModulZaehler` lädt `wetterAbfrage` erst bei geladenen Overrides und
  `darfZaehlerZeigen('wetter-pegel', …)` und rechnet mit dem Wecker `useUnwetterUhr`
  (`naechsterUnwetterWechsel`). Prüfen: `useModulZaehler.abruf.test.tsx` zeigt: Ein
  ausgeblendetes Modul und noch ladende Overrides lösen keinen Abruf aus, ein freies Modul
  liefert die Zahl. `ModulPanel.test.tsx` zeigt die Zahl mit zugänglichem Namen.
  `unwetter.test.ts` zeigt den Wecker samt Obergrenze bei Ende „bis auf Weiteres“.

## 4. Hinweis in der AlarmZentrale (D6, D1)

- [x] 4.1 Hook `wetter/useUnwetterHinweis.ts`: dieselbe Abfrage (gegated wie 3.3, dazu
  `refetchIntervalInBackground`). Er wartet auf die Einsatz-Einstellungen, wertet bei jedem
  neuen Datenstand `erkenneNeue` über das Gedächtnis aus und löst bei `neu`
  `spieleAlarmTon('dezent')` und `lfh:unwetter-alarm` mit `{ schluessel, titel, beschreibung }`
  aus. Er wird über die Wächter-Komponente `wetter/UnwetterHinweis.tsx` im
  `EinsatzAnzeigeProvider` des `EinsatzLayout` montiert. Prüfen: Hook-Test zeigt genau ein
  Ereignis beim ersten Stand und keines nach erneutem Mount (Neuladen) mit demselben
  Gedächtnis. Keines kommt bei `Stand unbekannt`, bei ausgeblendetem Modul und bei noch
  ladenden Overrides. Der Observer fragt im Hintergrund nach. `UnwetterHinweis.test.tsx` zeigt
  den Zeitraum in der Zeitzone des Einsatzes, auch wenn die Einstellungen nach dem Wetter
  eintreffen.
- [x] 4.2 `AlarmZentrale`: `AlarmZiel` `'wetter-pegel'` mit `wetterPegelPfad`, Knopf „Zu
  Wetter & Pegel“ in der Zusammenfassung, Listener für `lfh:unwetter-alarm` über
  `zeigeAlarmToast` samt Desktop-Meldung, ein Key je Auslösung. Ein noch sichtbarer älterer
  Unwetterhinweis wird ersetzt. Prüfen: `einsatz/AlarmZentrale.test.tsx` zeigt Titel „Unwetterwarnung“, die
  Beschreibung, den Sprung zur Modulseite, nur einen sichtbaren Unwetterhinweis nach zwei
  Ereignissen und das Budget (drei Sofortmeldungen plus Unwetter ergibt eine Zusammenfassung).
  Dazu zeigt er, dass derselbe Paar-Hinweis erneut erscheint, während der alte gebündelt ist.

## 5. Überblick-Marke (D8)

- [x] 5.1 `MarkenArt` um `'unwetter'` erweitern, `naechsteMarken` um den optionalen Parameter
  der angekündigten Unwetterwarnungen. Prüfen: `pages/fuehrung/ueberblickDaten.test.ts` deckt
  Marke mit Text und Wort „in 2 h 00 min“, keine Marke ab Beginn, keine für „mäßig“,
  Sortierung zusammen mit Fristen und MARKEN_MAX ab.
- [x] 5.2 `UeberblickPage` lädt `wetterAbfrage` nur bei `wetterPegelFrei`, reicht
  `unwetterLage(…).angekuendigt` hinein und führt `markenZiel` für `unwetter` zu
  `wetterPegelPfad`. Ein Wetterfehler setzt `zMarken` nicht auf Fehler. Prüfen: Seitentest mit
  Marke und Link sowie Abwesenheit bei ausgeblendetem Modul.

## 6. Abschluss

- [x] 6.1 Kommentarverweise: `einsatz/aktiveWarnung.ts` (Satz „DWD-Unwetter (nur seitenlokal
  abgefragt, Folgeticket)“) auf den neuen Stand bringen (Abfrage jetzt im Rahmen, Sperre bleibt
  Folgeticket). Für die Warnsperre per `clickup-task-anlegen` ein Ticket anlegen, falls keines
  besteht. Prüfen: grep nach „seitenlokal“ und Ticketnummer im Kommentar.
- [x] 6.2 `./scripts/check-all.sh` grün (Lint, Prettier, `tsc`, Vitest, Gates). Prüfen: Lauf
  ohne Fehler, sonst in der CI des PRs belegt. Lokal am 01.10.2026: Bündel `schnell` und
  `frontend` grün (578 Dateien, 7913 Tests); `rust` und `e2e` belegt die CI des PRs (keine
  Backend-Änderung).
