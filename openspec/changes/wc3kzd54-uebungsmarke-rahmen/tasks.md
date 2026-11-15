# Tasks

Arbeitsweise je Aufgabe: `superpowers:test-driven-development` (Test zuerst rot, dann grün).
Pfade relativ zu `frontend/src/`, falls nicht anders angegeben.

## 1. Quelle und Farbrolle

- [x] 1.1 `istUebung` in `einsatz/einsatzart.ts` (D1) mit Test `einsatzart.test.ts`: wahr nur bei
  `uebung`, falsch bei den drei anderen Arten, bei `null` und bei `undefined`; Vitest grün.
- [x] 1.2 Rollen `uebungFuellung`, `uebungSchraffur`, `uebungText`, `uebungKante` in `theme/tokens.ts`
  (Nacht/Tag) und `theme/rollen.css` (D2); neuer Test `theme/uebungKontrast.test.ts` mit den
  Grenzen aus D2 (Wort ≥ 7 auf beiden Streifentönen, Umriss ≥ 3 gegen Rahmen und Flächen),
  dazu `rollen.guard.test.ts` und `gate5.guard.test.ts` grün.

## 2. Baustein

- [x] 2.1 `components/instrument/Uebung.tsx` mit `UebungsMarke` (inkl. `groesse="monitor"`) und
  `UebungsBand` (D3), Export über `components/instrument/index.ts`; Test `Uebung.test.tsx`: Wort
  „ÜBUNG“ steht, `null` bei Realeinsatz und ladendem Einsatz, Band trägt `data-lfh="uebung-band"`,
  Monitor-Marke ≥ 28 px.
- [x] 2.2 Karte in `frontend/scripts/design-system/previews.tsx` (Nacht und Tag), Eintrag in der
  Bausteinliste von `frontend/AGENTS.md`; `mise exec -- pnpm -C frontend design-system` gelaufen,
  `designSystem.guard.test.ts` grün.

## 3. Einsatzrahmen

- [x] 3.1 `components/rahmenOben.ts`: `useRahmenObenStapel` (D4) mit Unit-Test (Summe ohne eigene
  Quelle, keine Rückkopplung bei Höhenänderung); `rahmenOben.guard.test.ts` kennt das Band.
- [x] 3.2 `einsatz/EinsatzLayout.tsx`: `UebungsBand` direkt nach dem Kopf, klebt in jeder Breite
  (D4); Kopfmarke ab `md` vor dem Einsatznamen (D5); Test in der Layout-Testdatei: Band und Marke
  bei Übung, beides fehlt bei Realeinsatz und während des Ladens.
- [x] 3.3 Tab-Titel mit Präfix (D6) in `components/useDokumentTitel.ts`, Aufruf im Einsatzrahmen;
  Tests in `useDokumentTitel.test.ts` für „ÜBUNG · ETB · Starkregen Nord · lifeline-hub“ und
  „ÜBUNG · (3) ETB · …“, Realeinsatz unverändert.
- [x] 3.4 e2e `frontend/e2e/rahmen-stehen-bleiben.spec.ts` um die Übung erweitern: Band bei 390,
  820, 1180, 1440 px nach 1500 px Rollen im Bild, Tabellenkopf unter dem Band, offline am Handy
  Betriebszeile und Band übereinander; lokal gegen den Branch grün.

## 4. Liste und Wechsler

- [x] 4.1 `pages/EinsaetzePage.tsx`: `UebungsMarke` statt grauem Tag bei Übung (D9); Test in
  `EinsaetzePage.test.tsx`: Übung trägt Marke, Realeinsatz den Tag „Realeinsatz“.
- [x] 4.2 `einsatz/EinsatzSwitcher.tsx`: Marke im Eintrag einer Übung (D9); Test: nur der
  Übungseintrag trägt „ÜBUNG“.

## 5. Gerät und Lagemonitor

- [x] 5.1 `geraet/GeraeteLayout.tsx`: `UebungsBand` nach `GeraeteKopf` (D7); Test in der Testdatei
  der Gerätehülle: Band bei Übung, keins bei Realeinsatz.
- [x] 5.2 `geraet/LagemonitorPage.tsx`: `UebungsMarke groesse="monitor"` in der Statusleiste (D7);
  Vitest grün, `frontend/e2e/geraet-lagemonitor.spec.ts` lokal grün (ohne Bildlauf, Texte ≥ 28 px).
- [x] 5.3 Satz mit Verweis in `frontend/src/geraet/AGENTS.md` (D10).

## 6. Druck

- [x] 6.1 `components/druck/Druckkopf.tsx`: Prop um `einsatzart?` weiten, „ÜBUNG“-Block neben der
  Bezeichnung (D8); Test im Druckkopf-Test: Block bei Übung, keiner bei Realeinsatz.
- [x] 6.2 Der Druckkopf trägt bei Übung `data-uebung`, `druck/druck.css` setzt die Wurzel über
  `:has()` auf `page: uebung` mit `@page uebung { @top-center }` (D8); Prettier grün,
  `druck/druck.test.ts` grün.
- [x] 6.3 Schichtplan (`abloesung/schichtplan/ausgabe/SchichtplanBlaetter.tsx`), Lageplan
  (`pages/lagekarte/useLageplan.ts`), Planung (`planung/PlanungDruckPage.tsx`) und Einsatzbericht
  (`einsatzStand`) reichen die Art durch; `tsc` grün, je ein Test, dass der Kopf einer Übung
  „ÜBUNG“ trägt.
- [x] 6.4 e2e: `frontend/e2e/etb-druck.spec.ts` um eine Übung erweitern (Druckkopf trägt „ÜBUNG“,
  in Chromium das Randfeld laut erzeugtem PDF-Text); lokal in Chromium grün.
- [x] 6.5 Satz mit Verweis in `frontend/src/druck/AGENTS.md` (D10).

## 7. Regel und Anwenderdoku

- [x] 7.1 `frontend/AGENTS.md`, Abschnitt „Rahmen“: Spiegelstrich „Übung“ (D10); Prettier grün.
- [x] 7.2 `docs/anwender/kapitel/einsatz-oberflaeche.md`: Band und Marke beschreiben, dazu je ein
  Satz in `drucken-export.md`, `geraet-bedienen.md` und `lagemonitor.md`;
  `hilfe/anwenderdoku.guard.test.ts` grün.
- [ ] 7.3 Bilder der Anwenderdoku mit Einsatzrahmen neu erzeugen (`pnpm doku:bilder`, mindestens
  `einsatz-oberflaeche` und die Gerätekapitel); was in der Sitzung nicht läuft, als Folgeaufgabe auf
  dem Board und im PR genannt.

## 9. Folgen aus dem Review vor dem PR (abgestimmt 15.11.2026)

- [x] 9.1 ADR für die Entscheidung (E1): `docs/architektur/entscheidungen/ADR-<n>-…` mit Regeln und
  Prüfung zu `istUebung`, Baustein und Rolle; `scripts/check-architektur.sh` bzw. der ADR-Wächter grün.
- [x] 9.2 Violett-Aussagen berichtigen (Abschnittsflächen und Führungscluster der Lagekarte sind
  ebenfalls violett gefüllt): Spec `uebungsmarke` verlangt Unterscheidung durch Form und Wort statt
  Exklusivität des Farbtons; Regel, Doku, Kommentare und design.md nachziehen.
- [x] 9.3 Test, dass das Gerätband (`klebend={false}`) keine Rahmenhöhe meldet und das klebende sie
  meldet (gestubbte `offsetHeight`); Mutationsprobe am Hook-Argument rot.
- [x] 9.4 Druck: benannte Seiten `lageplan`, `dokument-anlage`, `fernmeldeskizze-a3/-a4` erhalten
  bei einer Übung eine Variante mit Randfeld „ÜBUNG“; der Titel jedes Anlageblatts einer Übung trägt
  „ÜBUNG“; CSS-Tests und `etb-druck`/Anlagen-Test grün.
- [x] 9.5 Gerätehülle und Lagemonitor laden den Einsatzkopf ohne Daten alle 30 s nach und zeigen nach
  einem Fehler „Einsatzart nicht geladen“ (Gerät unter dem Kopf, Monitor in der Statusleiste); Tests.
- [ ] 9.6 Marke zusätzlich in Sprungpalette (Einsatz-Wechsel), Planungsübernahme („Laufender
  Einsatz“), externem Lagebild, „Zurück zu …“ (Ebene 1) und im Bildkopf des Lageplan-PNG; je ein Test.

## 8. Abschluss

- [ ] 8.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün (Ergebnis im PR unter „Geprüft“).
- [ ] 8.2 Bilder der Änderung (Rahmen Nacht/Tag, Handy gerollt, Liste, Wechsler, Gerät,
  Lagemonitor, Druck) für PR und Meldung aufgenommen.

## Workflow follow-up

- Review vor dem PR (Agent mit frischem Kontext, Befunde gegengeprüft), Verbleib im PR.
- `/opsx:archive wc3kzd54-uebungsmarke-rahmen` im selben Branch, dann PR gegen `alpha`.
- Nach dem Merge das Design System veröffentlichen (`frontend/AGENTS.md`, Gestaltungssprache).
