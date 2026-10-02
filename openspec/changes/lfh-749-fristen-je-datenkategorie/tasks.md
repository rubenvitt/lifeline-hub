# Tasks

## 1. Datenmodell und Registry (Backend)

- [ ] 1.1 Migration (Nummer größer als jede auf `origin/alpha`, `scripts/check-migrationen.sh` grün): `org_aufbewahrung_kategorie` und `einsatz_aufbewahrung_kategorie` nach design.md D4, mit CHECK auf die drei Kategorien, PK, `ON DELETE CASCADE` zum Einsatz und Index für die Purge-Abfragen. Verifikation: `cargo test db::tests` grün
- [ ] 1.2 Test zuerst (rot): Guard pinnt den Zuschnitt Kategorie → `(tabelle, spalte)` aus der Spec (Behandlung, Personenauskunft, Identität) und `kategorie_zeilen` von `anhang` (Bildaufnahmen); `einsatz_aufbewahrung_kategorie` ist vollständig `Retain` klassifiziert. Danach `Fristkategorie`, `Klassifikation::Scrub(Strategie, Fristkategorie)`, `scrub_k`, `TabellenRegel::kategorie_zeilen` und die Umbuchung der Spalten in `schwaerzung_registry.rs` (D1); `projektion.rs` und `tests/aufbewahrung_e2e.rs` an die neue Variante anpassen. Verifikation: Guard grün, alle bisherigen Registry-Guards und `cargo test --test aufbewahrung_e2e` grün; Mutationsprobe (eine Spalte umbuchen) macht den Guard rot
- [ ] 1.3 `scrubbe_kategorie` mit gemeinsamem SQL-Kern zu `scrubbe_aus_registry`, inkl. Identitäts-Zeilenfilter (D3) und Bild-Zeilenfilter. Tests zuerst: Personenauskunft schwärzen lässt Behandlungs- und Identitätswerte behandelter Personen stehen und nullt die Identität nur registrierter Personen; Bildaufnahmen löschen nur `image/*`-Anhänge, die ETB-Einträge bleiben, `PRAGMA foreign_key_check` leer. Verifikation: Unit-Tests in `schwaerzung_registry.rs` grün, `scrubbe_aus_registry` unverändert grün

## 2. Fristen einstellen und einfrieren (Backend)

- [ ] 2.1 Höchstdauer 3660 Tage: `ist_gueltige_retention_dauer`, Fehlertexte in `routes/einsatz.rs` und `routes/org_einstellungen.rs`. Test zuerst (3660 gültig, 3661 → 422). Verifikation: `cargo test einstellungen` und die Routentests grün
- [ ] 2.2 Route `GET/PUT /api/org-einstellungen/aufbewahrung-kategorien` (D8) samt Repo in `src/org/`. Tests zuerst in `tests/`: Admin speichert und liest, Dauer ohne Rechtsgrundlage 422, Dauer 0/3661 422, Führungskraft 403, ohne Einträge leer. Verifikation: Tests grün, DTOs in `src/api_doc.rs`, Request-DTO in `frontend/src/api/types.ts`
- [ ] 2.3 Abschluss friert die Kategorie-Fristen ein (D4) und schreibt einen ETB-System-Eintrag mit Kategorie, Frist, Dauer und Rechtsgrundlage. Tests zuerst in `tests/aufbewahrung.rs`: zwei Kategorien gesetzt, ETB nennt beide; spätere Org-Änderung lässt den Einsatz unverändert; Org ohne Einstellung → keine Zeile, kein zusätzlicher Eintrag. Verifikation: Tests grün, bestehende Abschluss-Tests grün

## 3. Sperre auf den Lesewegen (Backend)

- [ ] 3.1 `KategorieSperre::laden` und `sperr_projektion` (D2, D3) mit Unit-Tests: Grenze `jetzt >= frist_bis` ohne Purge-Vermerk, aktiver Einsatz nie gesperrt, Identität je nach Behandlung, Platzhalter-Strategie liefert den Platzhalter. Verifikation: Unit-Tests grün
- [ ] 3.2 Die fünf SELECT-Konstanten (`person/repo.rs`, `sichtung_repo.rs`, `verbleib_repo.rs`, `verlaufsnotiz_repo.rs`, `uhs/belegung_repo.rs`) über `sperr_projektion` bauen; Guard-Test, dass keine andere Produktionsstelle diese Tabellen mit Kategorie-Spalten selektiert. Ende-zu-Ende-Test zuerst (rot): eindeutige Werte in jeder Kategorie-Spalte, Frist abgelaufen → Personenliste, Detail, CSV-Export, Druck und UHS-Detail enthalten keinen davon, antworten 200, Registriernummer und Sichtungskategorie stehen. Verifikation: Test grün; Mutationsprobe (Projektion in einer der fünf Funktionen umgehen) macht ihn rot
- [ ] 3.3 Bildaufnahmen: `anhang_antwort` 404 und Filter in den vier Metadatenlisten (Chat, ETB, Schaden, Dokumentablage). Test zuerst: ETB-Eintrag mit Foto und PDF nach Ablauf der Bild-Frist führt nur das PDF, Abruf des Fotos 404, des PDFs 200. Verifikation: Test grün

## 4. Purge-Phasen und Wiederherstellen (Backend)

- [ ] 4.1 Phase A2 Sperrvermerk (D5) mit Unit-Tests in `purge_scheduler.rs`: fällig → vermerkt + ETB; zweiter Lauf idempotent; ohne Akteur kein Vermerk, kein Eintrag, nächster Lauf holt nach; geschwärzter Einsatz unberührt. Verifikation: Tests grün
- [ ] 4.2 Phase B2 Schwärzung (D5): 29 Tage nach Vermerk unverändert, 30 Tage geschwärzt nur diese Kategorie + ETB, zweiter Lauf idempotent, WAL-Rückschrieb ausgelöst; Bytes-Test analog `schwaerzung_hinterlaesst_keine_altbytes` für einen gepflanzten Personenauskunft-Wert. Verifikation: Tests grün
- [ ] 4.3 Zustand je Kategorie über `retention::zustand` (D6), geschwärzter Einsatz → jede Kategorie `geschwaerzt`. Unit-Test. Verifikation: Test grün
- [ ] 4.4 Route Kategorie wiederherstellen (D7). Tests zuerst in `tests/aufbewahrung.rs`: 200 mit Frist und mit `null` (Werte wieder lesbar, ETB-Eintrag des Admins), Feld fehlt 400, Frist vergangen 422, nicht gesperrt 422, Karenz abgelaufen 409, geschwärzt 409, Führungskraft und fremde Org 403; Guard `archiv_namensraum_nur_lesend_und_admin` um die zweite Ausnahme erweitert. Verifikation: Tests grün
- [ ] 4.5 Archiv-DTOs: `kategorien` in der Akte, Zähler `gesperrt`/`geschwaerzt` in der Übersicht, Lese-Route `GET /api/einsaetze/{id}/aufbewahrung/kategorien` (D9). Tests: Akte mit gesperrter Kategorie zeigt Karenz-Ende, ohne Kategorien leere Liste, Übersicht zählt; Kategorie-Stand enthält keinen gepflanzten Personenwert. Danach `scripts/check-typ-codegen.sh`, `openapi.json` und `types.generated.ts` mitcommitten; neue Enum-Werte in `tests/enum_wire_kontrakt.rs`. Verifikation: Tests und Skript grün

## 5. Oberfläche (Frontend)

- [ ] 5.1 `EinsatzDefaults.tsx`: Abschnitt „Fristen je Datenkategorie“ mit Dauer, Rechtsgrundlage (Pflicht bei Dauer) und Vorschlag mit Übernehmen-Knopf; Höchstwert 3660 in beiden Aufbewahrungsformularen. Tests zuerst: Vorschlag übernehmen füllt Dauer und Quelle, ohne Handlung bleibt alles leer, Dauer ohne Rechtsgrundlage blockiert das Speichern. Verifikation: vitest grün
- [ ] 5.2 `EinsatzAufbewahrung.tsx`: Kategorie-Tabelle (Kategorie, Frist, Dauer, Rechtsgrundlage, Zustand als Statusetikett mit Wort, „gesperrt“ statt „vorgemerkt“). Test: gesperrte Personenauskunft erscheint mit Frist und Rechtsgrundlage. Verifikation: vitest grün
- [ ] 5.3 Archivakte: Abschnitt Kategorien mit Wiederherstellen-Dialog (neue Frist oder „folgt der Einsatz-Frist“); Übersicht zeigt die Zähler. Tests: Dialog sendet `frist_bis` bzw. `null`, Hinweis „alle Daten folgen der Einsatz-Frist“ ohne Kategorien. Verifikation: vitest grün
- [ ] 5.4 Personenansicht: Hinweis bei gesperrter Personenauskunft oder Behandlung mit Frist; Query-Key nach `frontend/AGENTS.md`. Test: Hinweis erscheint nur bei Sperre. Verifikation: vitest grün, `pnpm lint`, `tsc`, Prettier grün

## 6. Regeln und Abschluss

- [ ] 6.1 `src/AGENTS.md`, Abschnitt „Backend — Aufbewahrung“: Fristkategorie je Scrub-Regel, Sperre nur über `sperr_projektion` bzw. `anhang_antwort`, Identitätsregel, Offline-Restfenster, Verweis auf diese Change. Verifikation: Prettier/Lint grün, Verweis zeigt nach dem Archivieren auf den Archivpfad
- [ ] 6.2 Folgeticket über `clickup-task-anlegen`: Kategorie Einsatzkräfte (Lesewege laut design.md Context). Verifikation: Ticket-ID hier eingetragen
- [ ] 6.3 `cargo test` (Backend), Frontend-Tests und `./scripts/check-all.sh` grün (bzw. mit Verweis auf den CI-Lauf des PRs, falls lokal Werkzeuge fehlen)
