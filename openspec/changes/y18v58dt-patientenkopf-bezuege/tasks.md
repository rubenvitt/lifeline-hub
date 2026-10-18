# Tasks

Gemeinsame Change für LLH-1094 (`bti508xb`) und LLH-1129 (`mtcm6ied`) von LLH-1018. Sie setzt
`knc0jyjd-sichtungswahl-flaechen` voraus. Jede Aufgabe entsteht per TDD. Frontend wird mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>` geprüft, Backend mit `cargo test <Filter>`.

## 1. Server: Aufenthalt im Detail — LLH-1129 (mtcm6ied)

- [x] 1.1 `AufenthaltAnzeige` (`uhs_id`, `uhs_bezeichnung`, `platz_id`, `platz_bezeichnung`, `seit`) und `PersonDetail.aufenthalt` mit Abfrage über `uhs`/`uhs_platz`/`person_uhs_belegung`. Servertest: ohne UHS `null`, im Wartebereich ohne Platz, auf Platz mit Name, nach Wechsel `seit` vom Wechsel, nach Austritt `null`.
- [x] 1.2 `api_doc.rs` und Typ-Codegen (`scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet).

## 2. Geteilte Helfer — LLH-1094 (bti508xb)

- [ ] 2.1 `anzeige/abstand.ts` `formatVor` („gerade eben“, „vor 1 min“, „vor 42 min“, „vor 3 h 5 min“) mit Vitest.
- [ ] 2.2 `SichtungFelder` aus `SichtungDialog` herauslösen (Wahl, Kurzbegründung, „Bestätigt von“). Der Dialog nutzt sie weiter; `SichtungDialog`-Test grün.

## 3. Patientenkopf — LLH-1094 (bti508xb)

- [ ] 3.1 `personen/Patientenkopf.tsx` lesend: Sichtung mit DTG, „vor n min“ und Bestätigt; Zustand / Verdacht; Aufenthalt bzw. Verbleib; letzte Notiz. Vitest für ungesichtet, Wartebereich, auf Platz, abtransportiert, verstorben und storniert.
- [ ] 3.2 Sichten im Kopf (Knopf → `ErfassungsFormular` mit `SichtungFelder`, Fehler am Ort, nur das eigene Paneel gesperrt). Vitest mit Ablehnung (Grund bleibt, Eingabe bleibt).
- [ ] 3.3 Verbleib-Paneel im Kopf (Felder aus `verbleibErfassungKern.ts`, Rückfrage bei „verstorben“). Vitest.
- [ ] 3.4 Notiz-Zeile (`Schnellerfassungszeile`, Hinweis als Beschreibung) und Zustand / Verdacht über `BemerkungZelle`. Vitest.
- [ ] 3.5 Ohne Schreibrecht und am Gerät: nur lesen bzw. Gerätevarianten (`useGeraetDarf`). Vitest.

## 4. Seite umbauen — LLH-1094 (bti508xb)

- [ ] 4.1 `PersonenDetailPage`: eine Spalte in der Folge Kopf, Verlauf, Personendaten, Bezüge, Dateien, Audit. Das Notizformular, die Medizin-Spalte und `order` entfallen. „Sichten“/„Verbleib erfassen“ verlassen `aktionenPlan`. Das Bearbeiten-Formular hängt nur einmal. Seitentests nachgezogen; der Lese-Audit-Test belegt einen GET beim Öffnen.
- [ ] 4.2 Wortlaut „Zustand / Verdacht“ in `AufnahmeFelder`, `personenSpalten`, `PersonVorschau`, `PersonenDruckTabelle` und im Detail; Wort-Test über alle Stellen.

## 5. Aufenthalt und Bezüge — LLH-1129 (mtcm6ied)

- [ ] 5.1 Aufenthalt im Kopf mit „In UHS aufnehmen“/„Verlegen“/„Austragen“ (`UhsZuweisenDialog` mit Titel je Fall), nicht am Gerät. Vitest.
- [ ] 5.2 `personen/PersonBezuege.tsx`: Liste in Einsatzsprache mit Sprung und „Bezug lösen“, Zeilenfehler, „Bezüge 0“ leer. Lädt erst beim Aufklappen. Vitest.
- [ ] 5.3 `personen/BezugSuche.tsx`: lädt beim Öffnen, gruppierte Treffer, eine Wahl speichert über den vorhandenen PATCH, die XOR-Leerung am Tier bleibt. Vitest. Danach `ZuweisungsDialoge.tsx` ohne Tier- und Schaden-Dialog.
- [ ] 5.4 Wortlaut der Gegenrichtung auf `TiereDetailPage`/`SchaedenDetailPage` („Halter“, „Geschädigte Person“, „Bezug lösen“). Vitest der Seiten grün.

## 6. Nachweise, Regeln, Doku

- [ ] 6.1 e2e `personen-detail.spec.ts` (Kopf bei 1280 × 800 und 1440 × 900 ohne Bildlauf, Nachsichten ohne Dialog, Bezug hinzufügen), `betroffene-handy.spec.ts` (390 × 844: SK, Zustand und Aufenthalt in der ersten Höhe), `geraet-uhs-tablet.spec.ts`. `tsc` und `eslint` über `frontend/e2e` grün.
- [ ] 6.2 `frontend/src/personen/AGENTS.md`: „Personen-Detail“ (Kopf statt zweier Spalten) und neuer Abschnitt „Bezüge“. Prettier grün.
- [ ] 6.3 Kapitel `betroffene.md`, `geraet-uhs.md`, `tiere.md` und `schaeden.md` mit neu erzeugten Bildern, Wächter der Anwenderdoku grün.
- [ ] 6.4 Folgetask auf dem Board: die drei lokalen „vor n min“-Kopien auf `anzeige/abstand.ts` umstellen.
