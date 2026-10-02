# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Vor jeder „fertig“-Aussage stehen `verification-before-completion` und
`requesting-code-review`. Die Gruppen 1 bis 6 sind Backend und bauen aufeinander auf. Gruppe 7
ist das Frontend, Gruppe 8 schließt ab.

## 1. Registry: Zuordnung je Scrub-Spalte (design.md D1, D2)

- [x] 1.1 Enum `Datenkategorie` (`behandlung`, `personenauskunft`, `anhaenge`) als Wire-Enum in `src/einsatz/retention.rs` oder einem neuen Modul `einsatz::kategorie`, registriert in `src/api_doc.rs`. Verifiziert durch `enum_wire_as_str!` in `tests/enum_wire_kontrakt.rs`
- [x] 1.2 `Klassifikation::Scrub(Strategie, Zuordnung)` mit `Zuordnung::{Kategorie(Datenkategorie), Personenstamm, Einsatz}`. Der Helfer `scrub` bekommt die Zuordnung als dritten Parameter, und alle Registry-Einträge werden nach der Tabelle in D1 zugeordnet. `TabellenRegel` bekommt `person_bezug: Option<&'static str>` (D3). Verifiziert durch `cargo build` und die unverändert grünen Registry-Guards (`jede_einsatz_scoped_spalte_ist_klassifiziert`, `keine_toten_registry_eintraege`, `entdeckte_tabellen_gleich_registry_tabellen`, `zeile_loeschen_ist_kohaerent`)
- [x] 1.3 Guard `kategorie_zuordnung_ist_gepinnt`: Er listet die Spalten von `behandlung`, `personenauskunft`, `anhaenge` und Personenstamm namentlich und vergleicht sie mit der Registry. Zusätzlich gilt: Jede Personenstamm-Tabelle trägt `person_bezug`, und `ZeileLoeschen`-Tabellen gehören geschlossen einer Zuordnung an. Verifiziert durch den Test und eine Mutationsprobe (`einsatz_person.zustand` auf `Einsatz` umhängen → rot)
- [x] 1.4 `scrubbe_aus_registry(conn, einsatz_id, Umfang)` mit `Umfang::{Alles, Kategorie(k)}`. Alle bisherigen Aufrufer übergeben `Alles`. Verifiziert durch die unveränderten Schwärzungstests in `src/einsatz/repo.rs` und `tests/aufbewahrung_e2e.rs` sowie durch einen neuen Repo-Test: `Umfang::Kategorie(personenauskunft)` leert genau `herkunft_adresse` und `melder_kontakt`, alle übrigen Werte bleiben

## 2. Migration und Org-Vorgabe (D4, D8)

- [x] 2.1 Migration `0135_aufbewahrung_kategorie.sql` mit beiden Tabellen aus D4. Vorher `git fetch origin alpha` und `scripts/check-migrationen.sh`; die Nummer liegt über jeder auf `origin/alpha`. Registry-Regel für `einsatz_aufbewahrung_kategorie` mit nur Retain-Spalten. Verifiziert durch `scripts/check-migrationen.sh`, `db::tests::migrationsnummern_sind_eindeutig` und die grünen Registry-Guards
- [x] 2.2 `src/org/einstellungen.rs`: Laden und Speichern von `aufbewahrung_kategorien` (Liste ersetzen, wenn das Feld mitkommt; fehlende Kategorie → Zeile löschen). Validierung nach design.md D8: Dauer außerhalb 0 bis 3650, Rechtsgrundlage fehlend, leer oder über 500 Zeichen und unbekannte Kategorie jeweils 400. Verifiziert durch Repo-Tests für Ersetzen, Löschen und Validierung
- [x] 2.3 Route der Org-Einstellungen (`src/routes/org_einstellungen.rs`) und Admin-DTO um `aufbewahrung_kategorien` erweitern. Verifiziert durch Routentests: Admin speichert 0 Tage mit Rechtsgrundlage → GET liefert beides. Ohne Rechtsgrundlage → 400 ohne Änderung. Führungskraft → 403. Neue Organisation → leere Liste
- [x] 2.4 `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien committen. Verifiziert durch das grüne Skript

## 3. Kategorie-Frist beim Abschluss (Spec „Kategorie-Frist beim Abschluss“)

- [x] 3.1 `einsatz::repo::abschliessen`: Im selben Vorgang je Org-Kategorie mit Dauer eine Zeile in `einsatz_aufbewahrung_kategorie` anlegen (`frist_bis = abgeschlossen_at + dauer`, Rechtsgrundlage kopiert) und je Kategorie einen ETB-Systemeintrag mit Kategorie, Frist und Rechtsgrundlage schreiben. Nur wenn dieser Aufruf den Einsatz tatsächlich abgeschlossen hat. Verifiziert durch Repo-Tests: mit Dauer 0 → Frist gleich Abschlusszeitpunkt, ETB-Eintrag vorhanden; ohne Org-Dauer → keine Zeile, kein Eintrag; die Org-Dauer danach ändern → Einsatz-Zeile unverändert; erneuter Abschluss (No-Op) → keine zweite Zeile
- [x] 3.2 Den Scrub-Wert-Check `AUSNAHMEN_SYSTEM_ETB` (`tests/aufbewahrung_e2e.rs`) um die neuen System-Einträge prüfen; Rechtsgrundlage ist kein Scrub-Wert. Verifiziert durch den grünen E2E-Test

## 4. Kategorie-Frist am Einsatz (Spec „Kategorie-Frist am Einsatz ändern“, „Kategorie-Vormerkung und Wiederherstellen“)

- [x] 4.1 Repo-Funktion `kategorie_frist_setzen` im Muster von `frist_setzen`. In der Karenz hebt eine künftige Frist `vorgemerkt_at` auf. Fehlt die Zeile, wird sie mit der mitgegebenen Rechtsgrundlage angelegt. Der ETB-Eintrag nennt alt und neu. Verifiziert durch Repo-Tests für Setzen, Verlängern, Aufheben, Wiederherstellen in der Karenz und die unveränderte Frist (kein Schreibvorgang, kein Eintrag)
- [x] 4.2 Route `PUT /api/einsaetze/{id}/aufbewahrungsfrist/{kategorie}`. Rechte wie `aufbewahrungsfrist_setzen`. Antworten: aktiver Einsatz 409; Einsatz vorgemerkt 422; Einsatz geschwärzt 409; Kategorie nach der Karenz bzw. geschwärzt 409; Verkürzung ohne Bestätigung 409; erste Frist ohne Rechtsgrundlage 422; unbekannte Kategorie 400. Verifiziert durch `tests/aufbewahrung_kategorie.rs` mit Tests je Antwort, jeder Fehlerfall mit unveränderter Zeile und ETB-Zahl

## 5. Purge-Lauf K1 und K2 mit Personenstamm (D3, D5)

- [x] 5.1 Repo `faellige_kategorie_vormerkung` und `kategorie_vormerken` (bewachter UPDATE plus `system_audit_tx`). Verifiziert durch `purge_scheduler`-Tests: Fälliges `personenauskunft` wird vorgemerkt, der Einsatz bleibt lesbar (`darf_lesen` für die Einsatzleitung), der ETB-Eintrag ist vorhanden. Ein zweiter Tick ändert nichts. Ein aktiver Einsatz bleibt unberührt. Ohne Akteur bleibt alles unverändert, und der nächste Tick mit Admin merkt vor
- [x] 5.2 Repo `kategorie_schwaerzen`: Tombstone, `scrubbe_aus_registry(Umfang::Kategorie)`, Personenstamm-Schritt nach D3 und ETB-Eintrag mit Kategorie und Rechtsgrundlage, alles atomar. Verifiziert durch Repo-Tests zu den Szenarien „Nur registriert“, „Behandelt, Auskunft abgelaufen“, „Beide Zwecke abgelaufen“ und „Anhänge nach Ablauf“, je Bezugsart (Sichtung, Verlaufsnotiz, UHS-Belegung, Zustand, storniert) eine gepflanzte Person, deren Stamm bleibt. Zusätzlich die Fremdschlüsselprüfung ohne Verstoß und Idempotenz (zweiter Aufruf → `false`, kein Eintrag)
- [x] 5.3 Guard `behandlungsbezug_kennt_jede_personentabelle`: Er listet alle einsatzbezogenen Tabellen mit FK auf `einsatz_person` und verlangt, dass jede im Behandlungsbezug-Prädikat steht oder begründet ausgenommen ist. Verifiziert durch den Test und eine Mutationsprobe (eine Tabelle aus der Liste nehmen → rot)
- [x] 5.4 `tick_mit_rueckschrieb`: Phasen K1 und K2 zwischen A und B. Nach K2 werden `rueckschrieb_ausstehend` gesetzt und `LiveEvent::Person`, `Dokument`, `Schaden`, `Chat`, `Etb` publiziert. K2 läuft auch an vorgemerkten Einsätzen. Phase B setzt `geschwaerzt_at` an allen offenen Kategorie-Zeilen. Verifiziert durch `purge_scheduler`-Tests: Ablauf über Frist, 29 Tage (nicht geschwärzt) und 30 Tage (geschwärzt); gesperrter Einsatz mit fälliger Kategorie (Kategorie geschwärzt, `geloescht_at` unverändert); Einsatz-Schwärzung setzt die Kategorie-Tombstones
- [x] 5.5 Physische Entfernung: Der bestehende Test `schwaerzung_hinterlaesst_keine_altbytes` bekommt eine Variante für eine Kategorie-Schwärzung (gepflanzter Klartext in `herkunft_adresse` und in einem Anhang). Verifiziert durch den Test

## 6. Zustand und DTOs (D7)

- [x] 6.1 Zustand je Kategorie über `retention::zustand` mit Einsatz-geschwärzt-Vorrang. Verifiziert durch Unit-Tests je Zustand und durch „Einsatz geschwärzt → jede Kategorie `geschwaerzt`“, auch ohne Zeile
- [x] 6.2 `KategorieAufbewahrungAnzeige` über `GET /api/einsaetze/{id}/aufbewahrung-kategorien` (mit `dauer_tage_vorgabe` bei aktiven Einsätzen, design.md D7) und in `ArchivAkteAnzeige`. Verifiziert durch Routentests: Szenario „Gemischte Zustände“ über die Einsatz-Route; „Kategorien in der Akte“ über die Archiv-Route; die Akte enthält weiter keinen Personennamen (bestehender Test bleibt grün). `jede_archivspalte_ist_retain` bleibt grün
- [x] 6.3 `scripts/check-typ-codegen.sh` und beide generierten Dateien committen. Verifiziert durch das grüne Skript

## 7. Frontend (D9)

- [x] 7.1 `aufbewahrung/kategorieText.ts`: Bezeichnung, Datenbeschreibung, Vorschlag und Quelle je Kategorie. Verifiziert durch einen Test, der alle drei Kategorien des generierten Typs abdeckt
- [x] 7.2 Org-Einstellungen, Abschnitt Aufbewahrung: Dauer und Rechtsgrundlage je Kategorie, Vorschlag als Text, nicht vorbelegt, Hinweis bei Dauer über der Org-Aufbewahrungsdauer, Rechtsgrundlage Pflicht bei gesetzter Dauer. Verifiziert durch Komponententests zu den Szenarien „Vorschlag wird nicht eingesetzt“ und „Dauer länger als Einsatz-Dauer“ sowie zur Pflichtfeldprüfung
- [x] 7.3 `FristPaneel`: Kategorie-Zeilen mit Statusetikett (Wort), Frist, Rechtsgrundlage und Aktion mit Rückfrage bei Verkürzung. Bei aktivem Einsatz der Hinweis aus der Vorgabe; ohne Recht gesperrt mit Grund. Verifiziert durch Komponententests zu „Kategorie verlängern“, „Aktiver Einsatz“, Verkürzung mit Rückfrage und „Ohne Recht“
- [x] 7.4 `ArchivAktePage`: Block „Datenkategorien“, nur lesend. Verifiziert durch einen Komponententest mit geschwärzter Kategorie samt Zeitpunkt und Rechtsgrundlage
- [x] 7.5 Frontend-Gates: `mise exec -- pnpm -C frontend lint`, `typecheck` und `test`. Verifiziert durch grüne Läufe

## 8. Abschluss

- [x] 8.1 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung“: Regel zur Zuordnung (jede Scrub-Spalte braucht eine `Zuordnung`, Kategorie-Spalten sind im Guard gepinnt, Behandlungsbezug-Guard) mit Verweis auf diese Change. Verifiziert durch Prettier/Format-Gate und Lesen des Abschnitts
- [x] 8.2 `./scripts/check-all.sh` grün. Verifiziert durch den Lauf; die CI des PRs belegt ihn erneut. Lokal (Cloud-Sitzung, 02.10.2026): Schritte 1–3, 5, 6, 8–13 grün; Schritt 4 Workspace grün (2245 Lib-Tests, alle Integrationstests), nur die Desktop-Hülle baut hier mangels `gdk-3.0` nicht; Schritt 7 nur Chromium (Firefox/WebKit nicht installierbar), Befund im PR. Abschließender Beleg: CI-Lauf des PRs
- [x] 8.3 Folgeticket per `clickup-task-anlegen`: Kartenhintergrund (`karte_hintergrundbild.daten`) bei Drohnen-Orthofotos (§ 32b Abs. 3 NKatSG), Klassifikation prüfen. Verifiziert durch die Ticketnummer in der Abschlussmeldung (angelegt: LFH-997)
- [x] 8.4 `/opsx:archive lfh-749-fristen-je-datenkategorie` im selben Branch vor dem PR, mit Spec-Sync und nachgezogenen Verweisen. Verifiziert durch `scripts/check-openspec-archiv.sh`
