# Tasks

Zunder LLH-1261 (`k22fpk5p`). Jede Aufgabe entsteht per TDD. Backend wird mit
`cargo test <filter>` geprüft, Frontend mit
`mise exec -- pnpm -C frontend exec vitest run <Datei>`.

## 1. Vorlage: Material-Positionen (Backend)

- [x] 1.1 Migration `einheit_vorlage_material` (D1) mit der nächsten freien Nummer über `origin/alpha`; `scripts/check-migrationen.sh` grün, dazu ein `db::tests`-Fall: Kaskade beim Löschen der Vorlage, Material bleibt NO ACTION. (Nummer 0250; die neue Tabelle steht auch in den Wächtern `demo::schema_tests` (erlaubte Kaskade), `stammdaten_tests` und `schwaerzung_registry` (nie einsatzbezogen).)
- [x] 1.2 DTO `EinheitVorlageMaterial` und `EinheitVorlage.material`, Lesen in `repo` (Liste und `load_tree_tx`) live aus dem Stamm; Test in `einheit_vorlage/tests.rs`: Liste nennt Bezeichnung, Art, Bestandsnummer, Menge, Fahrzeug, Dienststatus.
- [x] 1.3 Ersetzen `replace_material_tx` mit den Prüfungen aus D2 (400 Deckel und Menge, 422 Verweis, Fahrzeug außerhalb, neu außer Dienst, Gerät über 10, Bestandsnummer mit Menge über 1, Bestandsnummer zweimal im Baum); je Regel ein Test, dazu „später außer Dienst bleibt speicherbar“ und „dasselbe Verbrauchsgut auf zwei Fahrzeugen“.
- [x] 1.4 Ersetzen der Fahrzeugliste löst die Fahrzeugbindung des Materials auf entfernten Fahrzeugen (D2); Test.
- [x] 1.5 Route `PUT /api/einheit-vorlagen/{id}/material` (nur Admin, 403 sonst; 404 fremde Vorlage) in `src/app.rs` und `api_doc.rs`; Routentest für 200, 403, 404.
- [x] 1.6 Demo-Daten: Test, dass das Entfernen ein Demo-Material behält, auf das eine echte Vorlage verweist, und eine Demo-Vorlage samt Positionen entfernt (D1).

## 2. Bilden mit Material (Backend)

- [x] 2.1 `ZeilenArt::Material` (Wire `material`) und `VorschauMaterialZustand` (`neu`, `ausser_dienst`, `im_einsatz`) per `wire_enum!`, beide in `tests/enum_wire_kontrakt.rs`; Kontrakttest grün.
- [x] 2.2 `plan_tx` liest mit `Lesen.material` alle Positionen des Baums in einer Abfrage samt Zustand (D5); Vorschau nennt je Knoten `material` und `material_gesperrt`; Tests: neu, außer Dienst, Gerät mit Bestandsnummer im Einsatz, Verbrauchsgut mehrfach bleibt neu, Bestandsnummer zeigt Menge 1, Anzahl Anweisungen unabhängig von der Zahl der Positionen. (Eine Zählprobe für Anweisungen gibt es im Haus nicht: Die Stamm-Daten kommen mit der Vorlage aus `load_where`, die Stücke im Einsatz aus einer `json_each`-Abfrage; Vorschau-Test `vorschau_nennt_material_mit_zustand`.)
- [x] 2.3 `check_against_plan` mit Material-Wahl: Gründe „nicht in der Vorlage“, „außer Dienst“, „schon im Einsatz“ an `material:<id>`; reine Tests.
- [x] 2.4 `bilde_tx` disponiert die Wahl nach den Personen (D3, D5): Gerät je Stück, Bestandsnummer genau ein Posten, Verbrauchsgut mit Menge, Ort Fahrzeug wenn es mitkommt, sonst Einheit; `Gebildet.material`. Tests: Rucksack auf RTW, Decken an der Staffel, Gerät mit Menge 3, Fahrzeug abgewählt, 422 ohne jede Schreibspur.
- [x] 2.5 `etb_text_aus_vorlage` mit Material-Teil und Budget (D6); Tests für die Form „Material: 50× Wolldecke, 1× Sanitätsrucksack“, „und N weitere“ und den erweiterten Höchstfall unter `etb::INHALT_MAX`.
- [x] 2.6 Handler: Body `material: [{vorlage_material_id}]` mit Deckel 50 vor dem Entdoppeln (400), `fordere_zielmodul::<Material>` (403), Vorschau mit Sperre des Moduls, `sse_material` je Posten nach dem Commit, `AusVorlageErgebnis.material` (D7); Routentests für 400, 403, Vorschau gesperrt, ein ETB-Eintrag.
- [x] 2.7 Typ-Codegen: `scripts/check-typ-codegen.sh` grün, beide generierten Dateien mitcommittet. (Im Container braucht der Typecheck `NODE_OPTIONS=--max-old-space-size=6144`, sonst bricht `tsc` am Heap ab.)

## 3. Frontend

- [x] 3.1 `api/einheitVorlagen.ts`: `replaceVorlageMaterial`; Testdaten in `test/einheitVorlagen.ts` mit Material; Vitest in `api/einheitVorlagen.test.ts`.
- [x] 3.2 `MaterialSection` auf der Detailseite (D8): Liste, Hinzufügen aus dem Stamm (nur in Dienst), Menge (Bestandsnummer fest 1), Ort Einheit oder Fahrzeug der Vorlage, „außer Dienst“ als Wort, nur lesen ohne Admin, 422 an der Sektion; Vitest in `EinheitVorlageDetailPage.test.tsx`.
- [x] 3.3 `ausVorlageKern.ts`: Wahl `material` mit Vorgabe an, Sperre, `anDerEinheit`, Zusammenfassung „N Material“ nur mit Material, Anfrage, Gründe je Zeile; Vitest im Kerntest.
- [x] 3.4 `EinheitAusVorlagePage.tsx`: Material-Zeilen je Einheit mit Häkchen, Zustandswort, Menge, Ort und „an der Einheit“, Sperre des Moduls als Hinweis, Grund an der Zeile; Vitest in `EinheitAusVorlagePage.test.tsx`. (Dabei gefunden: `api/client.ts` ließ in `ApiError.zeilen` nur `personal` und `fahrzeug` durch; die Liste ist jetzt ein `Record` über `ZeilenArt`, eine neue Art macht den Typecheck rot. Test in `api/client.test.ts`.)
- [x] 3.5 e2e `frontend/e2e/einheit-aus-vorlage.spec.ts` erweitert: Vorlage mit Rucksack auf RTW und Decken an der Staffel bilden, Posten über die API am richtigen Ort, ein ETB-Eintrag mit „Material:“. (Gesät über `seedeVorlagenMaterial` in `e2e/vorlage-kern.ts`; lokal in Chromium 2/2 grün.)

## 4. Doku und Gates

- [x] 4.1 Anwenderdoku: `docs/anwender/kapitel/stammdaten.md` (Sektion Material der Einheiten-Vorlage) und `docs/anwender/kapitel/einheiten.md` (Material beim Bilden aus Vorlage), Regeln aus `docs/anwender/AGENTS.md`; Wächter der Anwenderdoku grün. (Bilder unverändert: Die Demo-Vorlagen führen kein Material, die fotografierten Ansichten bleiben gleich.)
- [x] 4.2 `./scripts/check-all.sh` grün (Bündel `schnell` lokal, voll in der CI des PRs). (Lokal: `--nur schnell` grün bis auf Schritt 6, zwei neue `high`-Advisories in Frontend-Dev-Abhängigkeiten (zod, undici), Lockfile in diesem Branch unverändert, also nicht von diesem PR. Dazu die Rust-Tests der berührten Module und Integrationstests (Vorlage, Bilden, Wire-Kontrakt), Vitest voll und e2e `einheit-aus-vorlage` in Chromium. Die volle Rust-Suite passt nicht auf die Platte der Cloud-Sitzung (Linker: kein Platz); sie belegt die CI dieses PRs.)

## Workflow follow-up

- `/opsx:archive k22fpk5p-vorlage-material` im selben Branch vor dem PR.
- PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/k22fpk5p0q5177swqyflm8u7`.
