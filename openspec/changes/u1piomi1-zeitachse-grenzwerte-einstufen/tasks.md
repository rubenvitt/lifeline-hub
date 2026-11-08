## 1. Server: Grenzwerte lesen (D5)

- [ ] 1.1 Integrationstest in `tests/kraefte_zeitachse.rs` (rot): `GET …/einheiten/zeitachse/grenzwerte` liefert ohne Modul Ablösung 720/480 als Vorgabe (`*_eigen` false), nach dem Setzen über `PATCH …/abloesungen/schichtplan/grenzwerte` den eigenen Wert. `GET …/personal/zeitachse/grenzwerte` liefert 403, wenn Personal ausgeblendet ist.
- [ ] 1.2 Handler `einheiten_grenzwerte` (`EinsatzLesezugriff<Einheiten>`) und `personal_grenzwerte` (`EinsatzLesezugriff<Personal>`) in `src/routes/zeitachse.rs`, beide über `abloesung::schichtplan::repo::grenzwerte`. Routen in `src/app.rs` neben den Perioden-Routen, Pfade in `src/api_doc.rs`.
- [ ] 1.3 `tests/einsatz_kontext_guard.rs` und die Geräte-Routenlisten (`src/geraet/mod.rs`) prüfen: Ein Gerät bekommt die Route nur, wenn eine Geräteansicht die Zelle „Im Einsatz“ zeigt. Sonst bleibt es bei 403, und die Zelle steht ohne Einstufung da.
- [ ] 1.4 Kommentare in `src/abloesung/schichtplan/mod.rs` und `pruefung.rs` („Zeitachse stuft nicht ein (LFH-860)“) berichtigen. Bei `dienststrecken` einen Verweis auf das Gegenstück `stufeEin` in `frontend/src/kraefte/zeitachse.ts` ergänzen.

## 2. Client: Einstufung rechnen (D2–D4)

- [ ] 2.1 Tests in `kraefte/zeitachse.test.ts` (rot) für `stufeEin(perioden, grenzwerte, jetztMs)` mit den Zahlen der Spec-Szenarien: 12 h 20 → `zu_lang`; genau 12 h 00 → keine; 08–14 und ab 16:00 um 22:30 → `zu_lang` mit Strecke ab 08:00 und 14 h 30; dieselben um 17:00 → `ruhe_zu_kurz` mit 2 h Ruhe; 06–12 und ab 20:00 → keine; Lücke 0 → keine `ruhe_zu_kurz`; beide treffen zu → `zu_lang`; ohne offene Periode, ohne Perioden und ohne Grenzwerte (`undefined`) → `null`.
- [ ] 2.2 `stufeEin` in `kraefte/zeitachse.ts` umsetzen: rein, Trennregel wie `pruefung.rs:dienststrecken`, mit Verweis darauf. Der Kopfkommentar „Keine Grenzwerte, keine Einstufung“ wird berichtigt.
- [ ] 2.3 `ladeZeitachseGrenzwerte(einsatzId, art)` in `api/kraefteZeitachse.ts` und `einsatzKeys.kraefteZeitachseGrenzwerte(einsatzId, art)` unter dem Prefix `kraefteZeitachse` in `api/queryKeys.ts`. Prüfen, dass Live (`abloesung`) und `lagebildOffline.guard.test.ts` den Key ohne eigenen Eintrag abdecken.

## 3. Client: Anzeige (D6)

- [ ] 3.1 Komponente `kraefte/DauerEinstufung.tsx` mit Test (rot, dann grün): Zahl in Mono, daneben das Wort „zu lang“ bzw. „Ruhe zu kurz“ in `rollen.achtungText`, Beschreibung im Attribut `title` und als Text für den Screenreader. Ohne Einstufung ist die Darstellung genau wie bisher.
- [ ] 3.2 Meldebild: `KraefteuebersichtPage.tsx` lädt die Grenzwerte (Einheiten), `ImEinsatzZelle` zeigt die Einstufung. Test in `KraefteuebersichtPage.test.tsx` für „zu lang“, ohne Grenzwerte (Abruf scheitert) keine Einstufung, und „—“ unverändert.
- [ ] 3.3 Personal: `PersonalPage.tsx` lädt die Grenzwerte (Personal), `dauerZelle` der Spalte „Einsatzdauer“ zeigt die Einstufung, die Spalte „Ruhe“ bleibt neutral. Sortierung unverändert. Test in `PersonalPage.test.tsx`.
- [ ] 3.4 Druck des Meldeblatts prüfen: Das Wort erscheint lesbar ohne Farbe.

## 4. Regeln und Doku (D7)

- [ ] 4.1 `frontend/src/kraefte/AGENTS.md`, Absatz Kräfte-Zeitachse: „keine Grenzwerte (LFH-860)“ ersetzen durch die Regel aus D7 (nur `stufeEin`, wirksame Grenzwerte des Schichtplans, Anzeige nur in Meldebild und Personal, kein Alarm, kein Zähler). Wer „LFH-860“ in Code und Doku verwendet, wird per grep nachgezogen.
- [ ] 4.2 Anwenderdoku: `docs/anwender/kapitel/meldebild.md` („Einsatzdauer und Ruhezeit“: Grenzwerte, Wörter, woher die Werte kommen) und `personal.md` („Einsatzdauer und Zeitachse ablesen“). `quellen:` um die neuen Dateien ergänzen. Betroffene Bilder neu erzeugen (`pnpm doku:bilder --grep meldebild`, `--grep personal`), wenn sie die Spalte zeigen.
- [ ] 4.3 `docs/anwender/kapitel/abloesung.md`: Bei den Grenzwerten des Schichtplans einen Satz ergänzen, dass dieselben Werte das Ist im Meldebild und auf der Personal-Seite einstufen.

## 5. Abschluss

- [ ] 5.1 `scripts/check-typ-codegen.sh` (kein neuer Typ erwartet), `./scripts/check-all.sh` grün.
- [ ] 5.2 Review (`requesting-code-review`), Bilder der Änderung (Meldebild mit „zu lang“, Personal mit „Ruhe zu kurz“) für PR und Meldung.
- [ ] 5.3 `/opsx:archive`. Dabei den Purpose von `openspec/specs/kraefte-zeitachse/spec.md` anpassen („bleiben LFH-860 vorbehalten“ → Verweis auf die neue Anforderung).
