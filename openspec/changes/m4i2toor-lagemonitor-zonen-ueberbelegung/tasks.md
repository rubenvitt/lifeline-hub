# Tasks

## 1. Server: Gebietsangaben an der Gefahrenzone

- [x] 1.1 Test zuerst in `tests/geraet_kopplung.rs`: ein Gefahrengebiet „Hangrutsch Kirchberg“ mit einer Zone (Beschriftung „Haus Muster“, Notiz „Herr Muster wartet“), Matrixzelle `hoch`, einmal unbestätigt und nach „Beurteilung bestätigen“ bestätigt; `GET …/lagemonitor` liefert an der Zone `gebiet.bezeichnung`, `gebiet.warnstufe = "hoch"`, `gebiet.bestaetigt`, und weder „Muster“ noch den Anzeigenamen des Bestätigenden noch die Schlüssel `label`/`notiz`/`beurteilt_von_name`; ein Absperrbereich trägt kein `gebiet`. Rot gegen den Ist-Stand belegt.
- [x] 1.2 `LagemonitorGefahrengebiet` und `LagemonitorZone.gebiet` (Option, `skip_serializing_if`) in `src/routes/lagemonitor.rs`, in `verdichte` aus `gefahr::repo::gebiete_liste` befüllt (D1), Schema in `src/api_doc.rs`; Test aus 1.1 grün, ebenso `lagemonitor_zeigt_gefahrenzonen_und_abschnittsflaechen` und die Pins der Lagekarte für Externe (`cargo test --lib routes::lagemonitor`).
- [x] 1.3 `scripts/check-typ-codegen.sh` laufen lassen und `frontend/src/api/openapi.json` sowie `frontend/src/api/types.generated.ts` mitcommitten; `extern/lagebildKarte.ts` typprüft ohne `gebiet` (`mise exec -- pnpm -C frontend exec tsc --noEmit`).

## 2. Monitorkarte: Zonen beschriften und färben

- [x] 2.1 Tests zuerst in `frontend/src/geraet/lagemonitorFlaechen.test.ts`: Markentext „Hangrutsch Kirchberg · hoch“, „· mittel · unbestätigt“, „Gefahrengebiet · akut“ ohne Bezeichnung, „Gefahrengebiet“ ohne `gebiet`, „Absperrbereich“/„Absperrgrenze“/„Sperrgebiet“; Ort am Schwerpunkt bzw. mittleren Linienpunkt; Stil aus `gefahrengebietStil` mit `gebiet`, sonst `zoneStil`. Rot belegt.
- [x] 2.2 `baueMonitorFlaechen` um Zonenmarken und Stil nach Warnstufe erweitern (D2, D3, Token als Parameter); Tests aus 2.1 grün.
- [x] 2.3 `LagemonitorKarte.tsx`: Zonenmarken als DOM-Marken in `schrift` mit Rand in der Rolle der Stufe zeichnen, Token aus `useRollen()` übergeben; `geraet/LagemonitorKarte.test.tsx` zeigt die Marke „Hangrutsch Kirchberg · hoch“ mit `data-lfh="monitor-zone"`.

## 3. Überbelegung

- [x] 3.1 Tests zuerst: `istUeberbelegt` (8/5 ja, 5/5 nein, 2/0 nein) in `lagemonitorFlaechen.test.ts`; in `geraet/LagemonitorPage.test.tsx` zeigt eine UHS 8/5 „8/5“ mit `data-hervorgehoben="ja"`, die Titelzeile „1 überbelegt“, und eine überbelegte kleine UHS steht bei sieben größeren an erster Stelle; 5/5 ohne Alarm. Rot belegt.
- [x] 3.2 Kachel „Belegung der Unfallhilfsstellen“ nach D4 umsetzen (Sortierung, Alarmzahl, Zusatz); Tests aus 3.1 grün.
- [x] 3.3 UHS-Marke der Karte „Name · belegt/plaetze“ mit Alarmrand und -text bei Überbelegung (D4, D5); Komponententest der Karte deckt Marke mit und ohne Überbelegung ab.

## 4. e2e, Regeln, Doku

- [x] 4.1 `frontend/e2e/geraet-lagemonitor.spec.ts`: Gefahrengebiet mit Stufe anlegen, Marke „… · hoch“ und überbelegte UHS („x/y“ mit `data-hervorgehoben="ja"`) prüfen, Markerzahlen nachziehen; „keine Kachel schneidet ab“ bleibt grün (`mise exec -- pnpm -C frontend exec playwright test e2e/geraet-lagemonitor.spec.ts --trace off`).
- [x] 4.2 `frontend/src/geraet/AGENTS.md`, Lagemonitor: „Gefahrenzonen (Typ und Geometrie)“ ersetzen durch Typ, Geometrie und bei Gefahrengebieten Bezeichnung, höchste Warnstufe und Bestätigung des Gebiets, ohne Freitext der Zone und ohne Namen; Prettier über `frontend/` grün.
- [x] 4.3 Anwenderkapitel `docs/anwender/kapitel/lagemonitor.md` (Abläufe „Lagebild lesen“: Beschriftung und Farbe der Gefahrenzonen, „überbelegt“; `quellen` um `frontend/src/geraet/lagemonitorFlaechen.ts` ergänzen), Bildlauf `frontend/e2e/doku-bilder/lagemonitor.bilder.ts` an die neue Markerzahl anpassen und die Bilder neu erzeugen (in `frontend/`: `mise exec -- pnpm doku:bilder --grep lagemonitor`, vorher `cargo build`); Wächter `hilfe/anwenderdoku.guard.test.ts` grün.

## 5. Abschluss

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; Ergebnis für den PR unter „Geprüft“ notiert.

## Workflow follow-up

- Review vor dem PR (Agent mit frischem Kontext, Gegenprüfung), Befunde behandeln.
- Bilder der Änderung (Monitor vorher/nachher) für PR und Meldung aufnehmen.
- `/opsx:archive m4i2toor-lagemonitor-zonen-ueberbelegung` im selben Branch, dann PR gegen `alpha`.
