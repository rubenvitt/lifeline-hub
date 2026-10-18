# Tasks

Subtask LLH-1125 (`pao1s6uw`) von LLH-1018. Jede Aufgabe entsteht per TDD. Geprüft wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` bzw. mit der genannten e2e-Spec.

## 1. Rückweg im Routing

- [ ] 1.1 `routing/deeplinks.ts`: `zurueck` im `lagekartePfad` und im Parser (nur `1`), dazu `rueckwegPfad` mit exhaustivem `Record` (UHS `null` mit Begründung). Vitest in `deeplinks.test.ts`: kein Pfad aus der URL, unbekannter Typ `null`.

## 2. Karte

- [ ] 2.1 Reducer in `useKartenInteraktion`: `verortungsTyp` und Zustand `verortet` statt Toast und Beenden. Vitest: Start setzt den Typ, Erfolg setzt `verortet`, „Auf der Karte bleiben“ räumt nur die Rückmeldung.
- [ ] 2.2 `LagekartePage`: `layerEffektiv` mit Vorrang, Schalter und Speichern lesen weiter `layer`, Modulsperre unverändert, Zusatz „eingeblendet“ in der Schalterzeile. Vitest: Ansicht nicht geändert, ohne Freigabe keine Marker.
- [ ] 2.3 `PlatzierSteuerung` (unter `lg`) und Sidebar (ab `lg`) zeigen „<Kennung> verortet“ mit „Zurück zu …“/„Auf der Karte bleiben“; Marker hervorgehoben. Vitest.

## 3. Einstiege

- [ ] 3.1 Personen-Detail, `SchadenDaten`, `BetreuungPage` und `AufKarteVerorten` setzen `zurueck: true`. Vitest der Links.

## 4. Nachweise, Regeln, Doku

- [ ] 4.1 e2e `lagekarte-betroffene.spec.ts`: Ebene aus → verorten → Marker sichtbar und hervorgehoben → kein Ansichts-PUT → „Zurück zu R-…“ zeigt die Koordinate im Detail. `lagekarte-touch.spec.ts`: 390 px, ein Knopf je Handlung.
- [ ] 4.2 `frontend/src/pages/lagekarte/AGENTS.md` (Verortungsauftrag: Vorrang, Rückweg) und `frontend/src/personen/AGENTS.md` („Verortungsauftrag“). Prettier grün.
- [ ] 4.3 Kapitel `lagekarte.md` und `betroffene.md` nachgezogen, Wächter der Anwenderdoku grün.
