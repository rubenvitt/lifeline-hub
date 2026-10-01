# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Pfade relativ zu `frontend/src/`, sofern nicht anders genannt.

## 1. Transport: Upload mit Fortschritt (design.md D1, D2)

- [ ] 1.1 `api/client.ts`: Fehlerklasse `AusgangUnbekannt extends NetzFehler` mit eigenem Text; `fehlerText` prüft sie vor `NetzFehler`. Verifiziert durch Tests in `api/client.test.ts`: `fehlerText(new AusgangUnbekannt())` liefert den neuen Text, `instanceof NetzFehler` bleibt wahr, `fehlerText(new NetzFehler())` unverändert
- [ ] 1.2 `api/client.ts`: `apiUploadMitFortschritt(pfad, formData, { timeoutMs, onFortschritt })` über `XMLHttpRequest` (POST, `withCredentials` gleichwertig zu `same-origin`, `schreibKoepfe()`, `timeout`). Meldet `{ phase: 'senden', anteil }` (`null` ohne `lengthComputable`) und nach `upload.onload` `{ phase: 'pruefen' }`; 2xx → JSON; Nicht-2xx → `Response` bauen und durch `fehlerWerfen` (gleiches `ApiError`/401-Verhalten wie `apiUpload`); `error`/`timeout`/`abort` vor `upload.onload` → `NetzFehler`, danach → `AusgangUnbekannt`. Dateikopf nennt `apiUpload` als Bestandsweg. Verifiziert durch Tests mit einer `XMLHttpRequest`-Attrappe (`vi.stubGlobal`): Fortschrittsfolge, `anteil: null`, Prüfphase, JSON-Antwort, 400 mit `{error}` → `ApiError` samt Meldung, 401 → dasselbe wie `apiUpload` (Bestandstest als Vorbild), Netzfehler vor/nach Übertragung, Zeitlimit nach Übertragung → `AusgangUnbekannt`, Kopf `ERWARTETER_BENUTZER_HEADER` gesetzt
- [ ] 1.3 `api/dokumente.ts`: `legeDokumentAb(einsatzId, eingabe, onFortschritt?)` nutzt `apiUploadMitFortschritt` mit `UPLOAD_TIMEOUT_MS`. Verifiziert durch einen Test, der Pfad, Formularfelder und Zeitlimit an der Attrappe prüft, und `pnpm vitest run src/api` grün

## 2. Dialog „Dokument ablegen“ (Spec: Fortschritt, Prüfphase, Phase des Abbruchs, keine Vormerkung; design.md D3, D5)

- [ ] 2.1 `dokumente/DokumentAblegenModal.tsx`: Fortschritts-State aus `onFortschritt` (monoton per `Math.max`), Anzeige unter `SpeicherFehler` mit antds `Progress` (Linie, kein `size`, Farbe aus dem Theme), Etikett „Wird hochgeladen · n %“ bzw. „Datei wird geprüft“, Balken ohne Zahl bei `anteil: null`; geleert bei Erfolg, Fehler und Schließen. Ansage per `aria-live="polite"` nur bei Phasenwechsel und 10-%-Schritten. Dateikopf um LFH-654 ergänzen. Verifiziert durch Tests in `DokumentAblegenModal.test.tsx` mit gemocktem `legeDokumentAb`, das `onFortschritt` steuert: 25 % sichtbar, Rückschritt bleibt 40 %, Prüfphase ohne Zahl, ohne Gesamtgröße kein Prozent, nach Erfolg und Wiederöffnen kein Fortschritt, Live-Region spricht nicht bei jedem Ereignis
- [ ] 2.2 Fehlerfälle im Dialog: `NetzFehler` vor Übertragungsende → „nichts abgelegt“, `AusgangUnbekannt` → „Liste prüfen“, Serverablehnung → Servermeldung; in allen Fällen bleiben Datei, Titel und Kategorie stehen, kein Fortschritt mehr sichtbar, und ein zweites „Ablegen“ sendet erneut. Keine Vormerkung: `offline/queue` wird nicht berührt. Verifiziert durch Tests je Fall, einer davon mit Spion auf `schreibaktionEinreihen` (nie aufgerufen)

## 3. Entfernen-Zustand (Spec: Sichtbarer Entfernen-Zustand; design.md D4)

- [ ] 3.1 `components/Datensicht.tsx`: `PrimaerAktion.laeuft?: (zeile: T) => boolean` → `loading` am Auslöser des Kartenzweigs; ein laufender Auslöser öffnet keine Rückfrage. JSDoc nennt den Zweck. Verifiziert durch Tests in `Datensicht.test.tsx`: Auslöser der passenden Karte lädt, andere nicht; Klick auf den ladenden Auslöser öffnet keine Rückfrage; ohne `laeuft` unverändert (Bestandstests grün)
- [ ] 3.2 `pages/DokumentePage.tsx`: Menge `entferntGerade` aus `onMutate`/`onSettled` der `entfernenMutation`; Tabellenknopf `loading`, Titelzelle mit Textzusatz „wird entfernt“ (beide Zweige über das Spalten-`render`), Kartenaktion mit `laeuft`. Dateikopf-Abschnitt „Entfernen“ ergänzen. Verifiziert durch Tests in `DokumentePage.test.tsx` mit einer msw-Antwort, die erst auf Freigabe antwortet: Zeile steht und trägt „wird entfernt“ samt ladendem Knopf (Tabelle und Kartenzweig), die übrige Zeile nicht; nach Erfolg verschwindet die Zeile; nach 500 verliert sie den Zusatz und der Fehler steht im Hinweis-Slot

## 4. Browserbeleg und Prüfliste

- [ ] 4.1 `frontend/e2e/dokumente.spec.ts`, neuer Test „Rückmeldung: Fortschritt, Prüfphase und Entfernen-Zustand“: Upload-Drossel über CDP (`Network.emulateNetworkConditions`, niedriger `uploadThroughput`) mit einer Datei von einigen MiB → Prozentanzeige steigt sichtbar; `page.route` hält die POST-Antwort nach der Übertragung zurück → „Datei wird geprüft“; danach Erfolg. Eine zurückgehaltene DELETE-Antwort → Zeile mit „wird entfernt“ und ladendem Knopf, dann weg. Verifiziert durch den grünen Test und eine **Mutationsprobe** (Anzeige testweise entfernt → rot, zurückgedreht; Ergebnis hier notieren)
- [ ] 4.2 `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: Zeilen 1 · 3 und 2 · 3 nachtragen (Verdikt mit Testnamen, eingelöst durch LFH-654, Offline-Entscheidung mit Verweis auf diese Change), Bilanzen und „Offene Punkte“ anpassen; der Satz „Offline-Ablage — nicht gebaut“ im Geltungsbereich verweist auf die Entscheidung. Verifiziert durch `grep -n 'LFH-654' docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md` und stimmige Summen der Bilanztabellen
- [ ] 4.3 Nachzug „Upload-Fortschritt für ETB- und Schaden-Anhänge auf `apiUploadMitFortschritt`“ per `clickup-task-anlegen` auf dem Entwicklungsboard anlegen. Verifiziert durch die Ticketnummer im PR-Text

## 5. Verifikation

- [ ] 5.1 `./scripts/check-all.sh` grün (Format, Lint `--max-warnings 0`, Typprüfung, Vitest, e2e, OpenSpec-Archivwächter nach `/opsx:archive`). Verifiziert durch den Exit-Code bzw. die CI des PRs
