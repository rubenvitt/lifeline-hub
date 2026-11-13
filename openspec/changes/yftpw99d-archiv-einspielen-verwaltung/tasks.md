# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/yftpw99d7ew1s1qpsvry6d7k (LLH-1711). Jede Aufgabe per
TDD: zuerst der Test, der rot wird, dann der Code.

## 1. Kern: Ziel und Akteur (D2)

- [x] 1.1 `Ziel` (`AusArchiv`, `Org`, `EigeneOrg`) und `Akteur` (`Befehl`, `Person`) in `src/einsatz/archiv/einspielen.rs` einführen und den Befehl in `src/main.rs` auf `Ziel::AusArchiv`/`Ziel::Org` mit `Akteur::Befehl` umstellen. Prüfung: die bestehenden Tests in `src/einsatz/archiv/tests.rs` bleiben grün, ohne Änderung ihrer Erwartungen.
- [x] 1.2 `Ziel::EigeneOrg` mit Namensprüfung und eigener Meldung ohne `--org`. Prüfung: Ein neuer Test in `src/einsatz/archiv/tests.rs` lehnt einen Block mit anderem Org-Namen ab, ohne einen Einsatz anzulegen; ein Block mit gleichem Namen geht ein, auch bei anderer Org-ID.
- [x] 1.3 `admin_audit::schreibe_tx` mit Akteur und `peer_ip` in der Transaktion; `Akteur::Person` schreibt darüber. Prüfung: Ein Test findet nach dem Einspielen `archiv_eingespielt` mit `akteur_id`, `akteur_name` und `peer_ip` der Person. Ein Test mit falschem Schlüssel findet keinen Eintrag.
- [x] 1.4 `frist_endet_at` an `Eingespielt` (D7). Der Befehl gibt weiter denselben Satz aus. Prüfung: Unit-Test im Kern für einen Block mit früherer Kategorie-Frist.

## 2. Hub-Sperre (D3)

- [x] 2.1 `instanz::repo::wird_erreicht` mit Test in `src/instanz/repo.rs`. Prüfung: `wird_gemeldet` angebahnt und aktiv liefern `true`. `widerrufen`, `vom_gegenueber_widerrufen`, `meldet_sich` und die Pseudo-Kopplung eines Einspielens liefern `false`.

## 3. Schlüssel aus dem Speicher (D4)

- [x] 3.1 `Schluessel::laden` nimmt einen geliehenen Puffer (Variante neben der bestehenden), ohne ungeschützte Kopie. Der Befehl nutzt sie unverändert weiter. Prüfung: Unit-Tests in `src/backup/verschluesselung.rs` laden Klartext-Identität, Identität mit Passphrase und lehnen eine fehlende Passphrase mit `Validation` ab.
- [x] 3.2 Neuer Teil `TEIL_HOCHGELADEN` für die Zwischendatei des hochgeladenen Blocks. `zwischendateien_aufraeumen` räumt ihn mit auf. Prüfung: Test in `src/einsatz/archiv/tests.rs` oder `bauen.rs`, dass eine alte Datei dieses Teils gelöscht wird und eine junge bleibt.

## 4. Route `/api/admin/archiv/einspielen` (D1, D4, D5, D6)

- [ ] 4.1 `GET` liefert `ArchivEinspielenVerfuegbarkeit { verfuegbar }` (AdminUser). Prüfung: Integrationstest in `tests/archiv_einspielen.rs`: Admin 200 mit `true`/`false` je nach Kopplung, Führungskraft 403.
- [ ] 4.2 `POST` als Multipart (`schluessel` | `schluessel_datei`, `passphrase`, `block`): Hub-Prüfung vor dem Body (422), Schlüssel in `SecretSlice`, Block gestreamt in die Zwischendatei. Dann Kern mit `Ziel::EigeneOrg(benutzer.org_id)` und `Akteur::Person`, Antwort `ArchivEingespieltAnzeige`. Prüfung in `tests/archiv_einspielen.rs`:
  - Erfolg mit Spur und Person
  - eingefügter Text
  - geschützte Datei mit und ohne Passphrase
  - kein, doppelter oder falsch angeordneter Schlüssel: 400
  - falscher Schlüssel 400
  - abgelaufen 400
  - fremde Org 400
  - Hub (angebahnt und aktiv) 422
  - Kopplung einer anderen Org 422
  - nach einem früheren Einspielen weiter verfügbar
  - Führungskraft 403
- [ ] 4.3 Route in `src/app.rs` mit `DefaultBodyLimit::max(ARCHIV_BLOCK_MAX)` (256 MiB) und `upload_grenze`, Eintrag in `zulassung::OHNE_ZULASSUNGSGRENZE`. Prüfung: `tests/zulassung_guard.rs` grün und ein Test „über 256 MiB ist 413“ in `tests/archiv_einspielen.rs`. Der Test darf die Grenze per Hilfsrouter mit kleinerem Wert prüfen, wenn 256 MiB im Test zu teuer sind.
- [ ] 4.4 Schlüssel bleibt nicht liegen. Prüfung: Ein Test in `tests/archiv_einspielen.rs` durchsucht nach Erfolg und nach Fehler alle Tabellen (Textspalten, inkl. `admin_audit`) und alle Dateien im Datenverzeichnis nach dem Schlüssel (`AGE-SECRET-KEY-1…`) und der Passphrase und findet nichts. Es bleibt keine Zwischendatei `lifeline-zwischen-…` zurück.
- [ ] 4.5 Abbruch. Prüfung: Ein Test fällt das Future des Handlers mitten im Einspielen (oder nach dem Streamen) fallen und findet danach keine Zwischendatei.
- [ ] 4.6 OpenAPI-Einträge (`src/api_doc.rs`) und Typ-Codegen. Prüfung: `scripts/check-typ-codegen.sh` grün, generierte Dateien mitcommittet.
- [ ] 4.7 Betriebsdoku `docs/betrieb/backup-restore.md`, Abschnitt „Archiv eines Einsatzes einspielen“: Weg über die Verwaltung, nicht am Hub, 256 MiB, Proxy-Timeout, Befehl für große Blöcke und `--org`. Prüfung: Abschnitt gelesen gegen die Tests aus 4.2 bis 4.5; die Prettier-Prüfung von `scripts/check-all.sh` grün.

## 5. Oberfläche (D8)

- [ ] 5.1 API-Modul `frontend/src/api/archivEinspielen.ts` (Verfügbarkeit, `apiUpload` mit 10 Minuten) und Query-Key in `queryKeys.ts`. Prüfung: Vitest für den Aufbau des FormData (Reihenfolge Schlüssel, Passphrase, Block; nur eines der Schlüsselfelder).
- [ ] 5.2 Primäraktion und `ErfassungsModal` auf `AufbewahrungUebersicht.tsx`: Block, Schlüssel (Datei oder Text), Passphrase. Nur System-Admin und `verfuegbar`; Fehler im Dialog mit erhaltenen Eingaben; nach Erfolg Schlüsselfelder geleert, Ergebnisfeld mit Einsatz, „bis …“ in der Anzeigezone, Inhalten, Hinweisen und „Einsatz öffnen“; Einsatzliste und Aufbewahrung invalidiert. Prüfung: Vitest
  - ausgeblendet bei `verfuegbar: false` und für Führungskraft
  - Fehler hält die Eingaben
  - Erfolg zeigt das Ergebnis
- [ ] 5.3 e2e in `frontend/e2e/aufbewahrung.spec.ts`: Admin spielt einen Block ein (Block über den Download der Akte erzeugt, Schlüssel aus dem Test-Setup). Danach erscheint der Einsatz mit „Aus dem Archiv · bis …“. Prüfung: Spec grün lokal (`--trace off`).
- [ ] 5.4 Anwenderkapitel `docs/anwender/kapitel/aufbewahrung.md` („Ein Archiv herunterladen“ → Einspielen in der Verwaltung, „Wer was darf“) mit Bild des Dialogs und des Ergebnisses (`frontend/e2e/doku-bilder/aufbewahrung.bilder.ts`, `pnpm doku:bilder --grep aufbewahrung`). Prüfung: Wächter der Anwenderdoku in `scripts/check-all.sh` grün.

## 6. Abschluss

- [ ] 6.1 Architekturdoku nach `docs/architektur/AGENTS.md` (Mitänderungsregel) geprüft und, falls ein Kapitel den Weg „nur per Befehl“ nennt, nachgezogen. Prüfung: `grep -rn "archiv einspielen" docs/architektur` gesichtet.
- [ ] 6.2 `./scripts/check-all.sh --geaendert` grün; der volle Lauf belegt die CI des PRs.

## Workflow follow-up

- Review vor dem PR (`dev-zunder-orchestrieren`, Phase 4), bestätigte Befunde behandeln.
- `/opsx:archive yftpw99d-archiv-einspielen-verwaltung` im selben Branch, dann PR gegen `alpha`.
