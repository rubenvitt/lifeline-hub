# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code; jede neue Prüfung bekommt eine Gegenprobe (Prüfung entfernt → Test rot). Migrationen bekommen
die nächste freie Nummer über `origin/alpha` (`scripts/check-migrationen.sh`, vorher
`git fetch origin alpha`).

## 1. Datenmodell (D1)

- [x] 1.1 Migrationen 0305/0306: `unterschrift_schluessel` neu aufbauen mit den Zuständen `wartet_auf_bestaetigung` und `abgelehnt` (CHECK: nur bei Herkunft `gegenueber`), Spalten `entschieden_at` und `entschieden_von` (`ON DELETE SET NULL`), alle Indizes; `admin_audit` neu aufbauen mit `unterschrift_bestaetigt` und `unterschrift_zurueckgewiesen` (`unterschrift_abgelehnt` gibt es schon für das automatische Verwerfen); prüfen mit `cargo test --lib db::` und `tests/instanz_kopplung.rs` über die neue Migration
- [x] 1.2 `UnterschriftSchluesselZustand` und `AdminAktion` um die neuen Werte erweitern, je ein Fall in `tests/enum_wire_kontrakt.rs`; `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten

## 2. Übernahme (D2)

- [x] 2.1 `accept_lieferungen`: gültig gegengezeichneter neuer Schlüssel → `wartet_auf_bestaetigung`, Grundstock → `gueltig`; Repo-Tests: Nachlieferung wartet, Grundstock gilt sofort, Widerruf trifft auch einen wartenden, erneute Lieferung ändert einen wartenden oder abgelehnten nicht, derselbe Schlüssel unter neuer id lebt nach `abgelehnt` nicht wieder auf
- [x] 2.2 Ein wartender Schlüssel taugt nicht als Unterzeichner; Repo-Test: Lieferung, gegengezeichnet vom wartenden Schlüssel, wird verworfen

## 3. Bestätigen und Ablehnen (D3)

- [x] 3.1 Repo: `confirm` und `reject` mit bedingtem `UPDATE` auf `wartet_auf_bestaetigung`, Vergleich der letzten vier Zeichen (ohne Trennzeichen, Groß- und Kleinschreibung egal) als reine Funktion; Unit-Tests: passende und unpassende Zeichen, Kleinschreibung, mit Bindestrich
- [x] 3.2 Routen `POST /api/admin/instanz/unterschrift/{id}/bestaetigen` und `/zurueckweisen` (`AdminUser`, eigene Org) samt Spur und OpenAPI; Integrationstests in `tests/instanz_kopplung.rs`: Bestätigen mit den richtigen Zeichen → gültig, mit falschen → 422 und wartet weiter, ohne Feld → 400, fremde Org → 404, nicht wartend → 422, Nicht-Admin → 403, Ablehnen → abgelehnt und bleibt es nach der nächsten Meldung; der Fehlerumschlag der 422 ist dort geprüft, `tests/fehler_vertrag.rs` deckt nur die öffentlichen Instanzrouten ab
- [x] 3.3 Ende-zu-Ende über zwei Instanzen: neuer Schlüssel am Hub, gegengezeichnet, ELW meldet sich → wartet; Admin am ELW bestätigt → gültig (ersetzt die Erwartung in `neuer_schluessel_braucht_gegenzeichnung_und_wird_nachgeliefert`)

## 4. Anzeige und Warnung (D4, D5)

- [x] 4.1 `UnterschriftSchluesselAnzeige` um `unterzeichner_fingerabdruck` und `erklaert_at`, `InstanzKopplungAnzeige` um `wartende_schluessel` und `ohne_gueltigen_schluessel`; Integrationstests: Zähler nach Nachlieferung 1, nach Bestätigen 0; `ohne_gueltigen_schluessel` nach Deaktivieren des einzigen Schlüsselhalters am Hub
- [x] 4.2 `GET /api/admin/instanz/letzte-schluessel`; Integrationstests: Halter des einzigen Schlüssels einer verteilenden Org wird genannt, mit zweitem gültigem Schlüssel nicht, ohne Kopplung nicht, fremde Org nicht
- [x] 4.3 Deaktivieren und Herabstufen eines Halters gelingen und widerrufen den Schlüssel; Integrationstest (Vorrang statt 409)
- [x] 4.4 Frontend `instanz/`: Hinweise in `kopplungHinweise`, Schlüsselzeile für `wartet_auf_bestaetigung` und `abgelehnt` („zurückgewiesen“), Bestätigungsdialog (Angaben, Hinweis, vier Zeichen, Abbrechen gesperrt während des Speicherns, Ablehnung am Ort), Zurückweisen mit Rückfrage; Vitest: Dialog schickt die eingegebenen Zeichen, 422 steht im Dialog, Zurückweisen ruft die Route
- [x] 4.5 Frontend `BenutzerPage`: Rückfrage vor dem Deaktivieren eines Halters, `Alert` im Bearbeiten-Dialog bei Rollenverlust oder Deaktivieren; Vitest: Halter → Rückfrage mit Kopplungsnamen, Nicht-Halter → direkt wie bisher
- [x] 4.6 Zugangsprotokoll-Texte für die zwei neuen Aktionen; Vitest der Texte

## 5. Doku und Abschluss

- [x] 5.1 Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md`: Bestätigen, Ablehnen, warum abgleichen, Vorrang beim Deaktivieren und Ausweg; Wächter aus `docs/anwender/AGENTS.md` grün
- [x] 5.2 Architektur: R24 in Kapitel 11 verengt nachführen, Kapitel 8 (Querschnitt Sicherheit) um die Bestätigung; `scripts/check-architektur.sh` grün
- [x] 5.3 Bilder der Änderung für PR und Meldung (Bestätigungsdialog, Hinweis an der Kopplung, Rückfrage beim Deaktivieren)
- [x] 5.4 Gates: Bündel `schnell` lokal grün, dazu die betroffenen Rust-Suiten (`auth::`, `instanz::`, `db::`, `tests/instanz_kopplung.rs`, Wire-Kontrakt) und Vitest; den vollen `./scripts/check-all.sh` bringt die CI des PRs

## Workflow follow-up

- `superpowers:requesting-code-review` vor dem PR
- `/opsx:archive` samt Spec-Sync im selben Branch, dann der PR gegen `alpha`
- LLH-1605 nach dem Merge auf `done`; LLH-1491 ist dann frei
