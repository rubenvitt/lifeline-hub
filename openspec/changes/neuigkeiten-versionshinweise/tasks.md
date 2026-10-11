# Tasks

## 1. Versionsstand im Server

- [ ] 1.1 Migration anlegen: Tabelle `instanz_versionsstand` mit fester Zeile `id = 1`, Spalten `laufend`, `zuletzt_gestartet` (nullable), `gelesen_bis`. Nummer per `scripts/check-migrationen.sh` gegen `origin/alpha`. Prüfung: Netz-Test `db::tests::migrationsnummern_sind_eindeutig` grün.
- [ ] 1.2 Test zuerst: Start ohne Zeile legt sie an, gleicher Start ändert nichts, Versionswechsel setzt `zuletzt_gestartet` und `laufend` und lässt `gelesen_bis` stehen. Prüfung: Test rot, dann grün nach 1.3.
- [ ] 1.3 Versionserkennung beim Start nach dem Migrationslauf umsetzen. Prüfung: Tests aus 1.2 grün, Szenarien der Spec `versionsstand` abgedeckt.
- [ ] 1.4 Test zuerst: `POST /api/versionsstand/gelesen` setzt `gelesen_bis` auf die laufende Version, ohne Anmeldung 401 und keine Änderung. Prüfung: Test rot, dann grün.
- [ ] 1.5 `GET /api/versionsstand` und `POST /api/versionsstand/gelesen` umsetzen und die Antwort in den Typ-Codegen aufnehmen. Prüfung: `scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet.

## 2. Neuigkeiten aus CHANGELOG.md

- [ ] 2.1 Vite-Plugin, das `CHANGELOG.md` liest und an den Versionsüberschriften zerlegt. Ausgabe je Eintrag: Version, Datum, Kanal, Text. Prüfung: Vitest gegen die echte Datei im Repo; enthält sie Alpha-Einträge. Beta fehlt, bis es Beta-Releases gibt, und wird nicht vorausgesetzt.
- [ ] 2.2 Test zuerst: Kanal aus dem Suffix (`-alpha.N`, `-beta.N`, sonst stabil), Eintrag ohne Datum bleibt sichtbar, Überschriften in Codeblöcken werden nicht zerlegt. Prüfung: Test rot, dann grün nach 2.1.
- [ ] 2.3 Build bricht, wenn ein Eintrag keine erkennbare Version trägt. Prüfung: Testlauf mit präparierter Datei schlägt fehl.

## 3. Oberfläche

- [ ] 3.1 Startseite festlegen, auf der die Hinweiskarte erscheint. Festgelegt: die Einsatzliste unter `/einsaetze`, dorthin landen Angemeldete nach dem Login. Prüfung: `NeuigkeitenHinweis` steht in `pages/EinsaetzePage.tsx`.
- [ ] 3.2 Test zuerst: Hinweiskarte erscheint nur bei `gelesen_bis` vor der laufenden Version, zeigt die Anzahl, ist schließbar und ruft den Lesestand-Endpunkt. Prüfung: Test rot, dann grün nach 3.3.
- [ ] 3.3 Hinweiskarte umsetzen, nicht modal, mit Link zur Neuigkeiten-Seite. Prüfung: Tests aus 3.2 grün, Playwright-Prüfung zeigt die Karte ohne Blockade des Startbildschirms.
- [ ] 3.4 Test zuerst: Neuigkeiten-Seite zeigt den Abschnitt „Seit deiner letzten Version“ nur bei Versionswechsel, Kanalfilter, Hinweis bei leerem Beta-Kanal, Vorschau für Einträge über 20 000 Zeichen. Prüfung: Test rot, dann grün nach 3.5.
- [ ] 3.5 Neuigkeiten-Seite umsetzen, eigener nachgeladener Chunk, Route im Benutzermenü. Prüfung: Tests aus 3.4 grün.
- [ ] 3.6 Punkt am Benutzermenü-Eintrag „Neuigkeiten“, solange ungelesen. Prüfung: Test für beide Zustände grün.
- [ ] 3.7 Öffnen der Seite setzt den Lesestand; Schließen der Karte setzt ihn ebenfalls. Prüfung: Test, der den Endpunkt aufruft, grün.

## 4. Abschluss

- [ ] 4.1 Playwright-Test: Update simulieren (Versionsstand auf alte Version setzen), Karte und Punkt sichtbar, nach Öffnen der Seite beides weg. Prüfung: Test grün.
- [ ] 4.2 `./scripts/check-all.sh` vollständig grün, kein Schritt übersprungen. Prüfung: Gesamtstatus aus dem Lauf.
- [ ] 4.3 Anwenderdokumentation: Kapitel „Neuigkeiten“ nach `docs/anwender/AGENTS.md`. Prüfung: Kapitel vorhanden und verlinkt.

## Workflow follow-up

- Nach der Umsetzung `/opsx:archive` im selben Branch, dann erst der PR (Regel aus `AGENTS.md`).
- `scripts/check-openspec-archiv.sh` muss nach dem Archivieren grün sein.
