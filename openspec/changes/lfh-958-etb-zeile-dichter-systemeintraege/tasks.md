## 1. Server: Ausschluss der Systemeinträge (D3)

- [x] 1.1 Tests zuerst (`tests/etb_zaehler.rs`): Parität Liste/Zähler/Anzahl mit `ohne_system=true` (allein und mit `q`, `von`/`bis`, `einheit_id`); `typ=system` + `ohne_system=true` → 422 an Liste und Zählung; ohne Parameter unverändert.
- [x] 1.2 `EtbAbfrageParams.ohne_system`, `EtbZaehlFilter.ohne_system`, `EtbFilter::merkmale`, `filter_bedingung`, Validierung in `filter_merkmale`. Mutationsprobe: Bedingung nur in der Liste → 1.1 rot.

## 2. Frontend: Filter (D4, D5)

- [x] 2.1 Tests zuerst: `routing/deeplinks.test.ts` (Rundlauf `ohne_system`, Druckpfad), `etb/zeitachseModell.test.ts` (Zusammenführen entfernt den Schlüssel, Segment `system` hebt den Ausschluss auf), `api/etb.test.ts` (Parameter).
- [x] 2.2 Tests zuerst (`pages/EtbPage.test.tsx`): Schalter aus → URL trägt `ohne_system=true`, Liste und Zählung werden mit dem Parameter abgefragt, Kopf „n Treffer“; Zahl der ausgeblendeten Einträge; Sprung auf einen Systemeintrag bei aktivem Ausschluss blendet ein und hebt hervor.
- [x] 2.3 Umsetzen in `api/etb.ts`, `routing/deeplinks.ts`, `etb/zeitachseModell.ts`, `pages/EtbPage.tsx`, `etb/druckAuswahl.ts`. Mutationsprobe: `parseEtbFilter` ohne den Schlüssel → 2.1 rot.

## 3. Frontend: kompakte Zeile (D1, D2)

- [ ] 3.1 Tests zuerst (`components/instrument/Zeitachseneintrag.test.tsx`): `zeitachsenAufbau` je Token; kompakt: Verfasser und Weg in der Metazeile, Menü in der Kopfzeile, keine senkrechte Metaspalte, Verfasser mit `title`; komfortabel: Spalte wie bisher; `aktionen` bleiben rechts.
- [ ] 3.2 `Zeitachseneintrag` umbauen, `EtbZeitachse` reicht das Menü über `menue`. Mutationsprobe: Aufbau fest auf `spalte` → 3.1 rot.
- [ ] 3.3 Übrige Verwender gegenprüfen (Archivakte, Infotelefon, Lagemeldungen, Überblick, Meldeverlauf, Kräfte, Verpflegung, Lage-Dashboard): ihre Vitest-Dateien grün, Sichtprüfung in kompakt.

## 4. e2e

- [ ] 4.1 Neues Gate (`e2e/etb-zeilenhoehe.spec.ts`): einzeiliger Eintrag mit „Administrator · EL“ und Meldeweg in kompakt bei 1440×900 und 1366×768 ≤ 56 px, bei 1440×900 ≥ 9 Einträge zwischen den Leisten; auch als Beobachter über `e2e/rollen-kern.ts`.
- [ ] 4.2 `etb-chronologie`, `leisten-flaeche`, `gate3-trefflaeche`, `fokus-verdeckung` grün halten.

## 5. Regeln und Abschluss

- [ ] 5.1 `frontend/src/etb/AGENTS.md`: Ausschluss über denselben Filter; Kopfplatz der Zeile für Menüs (`menue`).
- [ ] 5.2 Lint, Typecheck, Vitest der berührten Dateien, Rust-Tests `etb_zaehler`, `etb_anzahl`.
- [ ] 5.3 `./scripts/check-all.sh` (Bündel `schnell`, Rust, Vitest; e2e der ETB-Specs).
