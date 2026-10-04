# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. „Verifiziert“ heißt, der genannte Test läuft grün **und** war vorher rot.

## 1. Vorgabe „jetzt“ nach der Serveruhr (D1, D2)

- [x] 1.1 `frontend/src/etb/Schnellerfassung.tsx`: `jetztIso` aus `serverJetzt()` statt `new Date()`, weiter vor dem Upload genommen; Kommentar mit Verweis auf diese Change. Verifiziert mit `Schnellerfassung.test.tsx`: Geräteuhr +5 min (Fake-Timer) nach `merkeServerzeit` mit der Serverzeit → `ereigniszeit` und `erfasst_lokal_at` der gesendeten Nutzlast sind die Serverzeit (±1 s); ein gesetzter Zeit-Chip „09:30“ bleibt „09:30“; ohne Messung gilt die Geräteuhr (Bestandstests bleiben grün).
- [x] 1.2 `frontend/src/meldungen/MeldungFormular.tsx`: Rückfall `w.ereigniszeit ?? serverJetzt()`. Verifiziert mit `MeldungFormular.test.tsx`: Gerät +5 min nach Messung, leeres Feld → Ereigniszeit = Serverzeit; eingetragenes „09:30“ bleibt.

## 2. Sichtbarer Vorschlag nach der Serveruhr (D3)

- [x] 2.1 `frontend/src/etb/MetaChip.tsx`: Editor des Zeit-Chips mit `defaultValue = serverJetzt()`, wenn kein Wert gesetzt ist. Verifiziert mit `MetaChip.test.tsx`: Gerät +5 min nach Messung, Chip ohne Wert öffnen und bestätigen → übergebener Zeitpunkt = Serverzeit.
- [x] 2.2 `frontend/src/anzeige/ZeitpunktEingabe.tsx`: „Jetzt“ setzt `serverJetzt()`; Kopfkommentar anpassen. Verifiziert mit dem Test der Zeiteingabe: Gerät +5 min nach Messung, „Jetzt“ → gemeldeter Zeitpunkt = Serverzeit; Bestandsszenario „Jetzt bei abweichender Browserzone“ bleibt grün.
- [x] 2.3 Befunde aus dem Review (D5): Zukunftsprüfung in `betreuung/BetreuungDialoge.tsx` (`zeitRegel`) und `personen/LagedatenFelder.tsx` („vermisst seit“) an `serverJetzt()`; Bausteine `{datum}`/`{uhrzeit}` in `etb/bausteinEinsetzen.ts` und Vorbelegung des Nachtrags in `kraefte/KraftZeitachse.tsx` aus `serverJetzt()`. Verifiziert mit je einem Test, vorher rot: „Jetzt“ auf einem 10 min nachgehenden Gerät besteht die Prüfung (`BetreuungDialoge.test.tsx`, `LagedatenFelder.test.tsx`); `{uhrzeit}` und der Nachtrag eines 5 min vorgehenden Geräts tragen die Serverzeit (`bausteinEinsetzen.test.ts`, `KraftZeitachse.test.tsx`).

## 3. Regeln nachziehen

- [x] 3.1 `frontend/src/offline/AGENTS.md`, „Schreiben ohne Netz“: Der Satz „Die Ereigniszeit von Meldung und ETB-Eintrag kommt weiter aus der Geräteuhr; ob sie umgerechnet wird, ist offen (LFH-895)“ wird zur Regel: „jetzt“ beim Erfassen (Vorgabe, Chip-Vorschlag, „Jetzt“) gilt nach `serverJetzt()`, eine eingetragene Zeit bleibt, Verweis auf diese Change. Geltungsbereich im Kopf von `offline/AGENTS.md` erweitert, Verweis in `frontend/AGENTS.md` (Zeiteingabe). Verifiziert per Prettier-Lauf über `frontend/` und Sichtprüfung des Diffs.

## 4. Ende zu Ende

- [x] 4.1 `frontend/e2e/ereigniszeit-uhrversatz.spec.ts` nach dem Muster von `betreuung-offline-uhrversatz.spec.ts`: Geräteuhr per `page.clock` 5 min vor, ETB-Seite laden (Messung über echte Antworten), Eintrag ohne Zeit-Chip erfassen, Meldung mit leerem Feld „Ereigniszeit“ anlegen. Verifiziert, wenn Ereigniszeit beider (API) höchstens 60 s von der Serverzeit abweicht und der ETB-Eintrag nicht als nachgetragen markiert ist. Mutationsprobe: `serverJetzt()` ohne Versatz macht den Test rot. **Ergebnis:** grün, zweimal hintereinander (`--repeat-each=2`). Mutationsprobe (`serverJetzt()` gibt die Geräteuhr): beide Fälle rot, Abweichung ~300 s.

## 5. Abschluss

- [x] 5.1 Review über die Dimensionen Fehler, Projektregeln und Tests, jeder Befund adversarial geprüft. Verifiziert, wenn jeder bestätigte Befund behoben ist. **Ergebnis:** Review per Subagent (kein Workflow-Lauf), 6 Befunde bestätigt: „Jetzt“ fiel an zwei Zukunftsprüfungen eines nachgehenden Geräts durch (behoben, 2.3); e2e prüfte ein Feld `faellig_at`, das die Meldungsliste nicht trägt, und das Spec-Szenario band die Bestätigungsfrist an die Ereigniszeit (beides korrigiert: Rückmeldefrist, Szenario ohne ungeprüfte Fälligkeit); Regelzeile in `frontend/AGENTS.md` doppelt und zu breit (auf Verweis gekürzt), Kräfte-Nachtrag scheiterte weiter (behoben, 2.3), übrige Vorbelegungen als Nachzug LFH-1031; Bausteine `{uhrzeit}` aus der Geräteuhr (behoben, 2.3); Verweise auf den aktiven Change-Pfad (beim Archiv umschreiben, 5.2); Kleinkram in `proposal.md` (behoben).
- [ ] 5.2 Beim `/opsx:archive` alle Verweise auf `openspec/changes/lfh-895-ereigniszeit-serveruhr/` auf den Archivpfad umschreiben (`grep -rn lfh-895-ereigniszeit-serveruhr`). Verifiziert, wenn der grep nur noch den Archivpfad findet.
- [ ] 5.3 `./scripts/check-all.sh` grün. Verifiziert durch Exit-Code 0 ohne `| tail`, Ergebnis hier eintragen.
