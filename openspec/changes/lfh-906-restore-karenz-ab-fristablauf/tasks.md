# Tasks

## 1. Datenmodell

- [x] 1.1 Migration `0149_einsatz_retention_gesetzt_at.sql` anlegen (Spalte plus Befüllung `MIN(retention_bis, datetime('now'))` für Einsätze mit Frist und ohne Vormerkung, design.md D2/D3); belegt durch einen Migrationstest, der eine künftige und eine abgelaufene Frist befüllt sieht, und `scripts/check-migrationen.sh` grün

## 2. Schreibwege der Frist

- [x] 2.1 Abschluss setzt `retention_gesetzt_at = abgeschlossen_at` zusammen mit der automatischen Frist; belegt durch einen Repo-Test (rot vor der Änderung)
- [x] 2.2 `frist_setzen` setzt `retention_gesetzt_at` auf den Zeitpunkt des Aufrufs (Signatur bekommt `jetzt`, Route reicht `Utc::now()` durch); belegt durch einen Repo-Test
- [x] 2.3 `wiederherstellen` setzt `retention_gesetzt_at = jetzt`; belegt durch Erweiterung von `wiederherstellen_hebt_vormerkung_auf_und_setzt_frist_mit_audit`

## 3. Phase A

- [x] 3.1 `soft_delete_einsatz` setzt `geloescht_at` auf `MIN(jetzt, MAX(retention_bis, retention_gesetzt_at))`, bei `NULL` auf `jetzt` (D1); belegt durch Purge-Tests „Erster Lauf lange nach dem Fristablauf“ und „Frist in die Vergangenheit verkürzt“ (Spec-Szenarien), beide rot vor der Änderung
- [x] 3.2 ETB-Audit nennt den Karenz-Beginn, wenn er vor `jetzt` liegt (D4); belegt im Test aus 3.1
- [x] 3.3 Test „Vormerkung mit schon abgelaufener Karenz“: Frist seit 40 Tagen abgelaufen, ein Tick merkt vor und schwärzt
- [x] 3.4 Modul-Doku von `purge_scheduler.rs` (Phase A „Karenz-Start“) und Doc-Kommentar von `soft_delete_einsatz` nachziehen
- [x] 3.5 Abschluss als untere Schranke des Karenz-Beginns (Review-Befund, D1); belegt durch Test „Frist am aktiven Einsatz abgelaufen“, Mutationsprobe ohne `abgeschlossen_at` rot

## 4. Restore-Fall

- [x] 4.1 Test `restore_von_vor_der_vormerkung_rechnet_karenz_ab_fristablauf` neben `restore_von_vor_der_schwaerzung_wird_erneut_geschwaerzt`: Sicherung vor der Vormerkung, Restore nach Frist + 30 Tagen → nächster Tick schwärzt (Akzeptanzkriterium des Tickets), rot vor der Änderung
- [x] 4.2 Test zur Restkarenz: Restore 10 Tage nach Fristablauf → vorgemerkt mit `retention_bis`, Friständerung 422, Wiederherstellen gelingt; 20 Tage später geschwärzt
- [x] 4.3 `docs/betrieb/backup-restore.md`, „Sicherungen und Schwärzung“: Lücke durch das neue Verhalten ersetzen, Stillstand des Servers nennen
- [x] 4.4 Test `sicherung_von_vor_dem_update_rechnet_karenz_ab_fristablauf`: Datenbank auf dem Stand 0148, Start migriert, erster Lauf schwärzt

## 5. Abschluss

- [ ] 5.1 `cargo test` der betroffenen Module und `./scripts/check-all.sh` grün (Umgebungsrot nach `cloud-sitzung-gate-umgebungsrot` gegen `alpha` gegengeprüft)
- [x] 5.2 Folgeticket für die Datenkategorien (Phase K1) auf dem Entwicklungsboard anlegen (LFH-1049)
