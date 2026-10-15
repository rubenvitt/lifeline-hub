# Tasks

Gliederung nach Teilaufgaben von LLH-1187; jede Gruppe ist eine Zunder-Unteraufgabe (Kennung im
Kopf der Gruppe). Gruppen 1 und 2 sind das Fundament, alle weiteren bauen darauf auf und sind
untereinander unabhängig, außer wo vermerkt. Der Plan kam auf Rubens Wunsch als eigener PR
(13.10.2026); jede Teilaufgabe hakt ihre Gruppe im eigenen PR ab, archiviert wird mit LLH-1222.

## 1. Fundament Server: Speicher, Auflösung, Zustellung (D1–D4, D6) · LLH-1207

- [x] 1.1 Migration `benachrichtigung` anhängen (Nummer per `scripts/check-migrationen.sh`), Spalten klassifizieren (`klassifikation_von`), Purge mit dem Einsatz; Test `jede_archivspalte_ist_retain` und ein Purge-Test bleiben grün
- [x] 1.2 `BenachrichtigungArt` als `wire_enum!` mit fester Stufe je Art (D4), in `tests/enum_wire_kontrakt.rs`; Test: jede Art hat genau eine Stufe, Alarm-Arten sind genau die vier aus D4
- [x] 1.3 Empfängerauflösung `benachrichtigung::melden` (Funktion über Stab-Besetzung mit Ersatz Mitgliedschaft, Person, Nutzer, ModulLeser; ohne Auslöser, Gerätekonten, Nutzer ohne Modulrecht, abgeschaltete Hinweis-Arten); Rust-Tests je Szenario der Anforderungen „Der Server bestimmt die Empfänger“, „Meine Funktion“, „Eigene Aktionen benachrichtigen den Auslöser nicht“
- [x] 1.4 `LiveEvent::Benachrichtigung` mit internem Empfängerfilter im Stream-Builder und im Replay, `OrgLiveEvent::Benachrichtigung`; Test: fremder Nutzer erhält das Ereignis weder live noch im Replay, `LiveEvent::ALLE` und Vertragstest aktualisiert, `scripts/check-typ-codegen.sh` grün, beide generierten Dateien committet
- [x] 1.5 Endpunkte `GET /api/benachrichtigungen/{id}` (fremd 404), `GET /api/benachrichtigungen?offen=true` (letzte 12 h), `POST …/{id}/quittieren` (sendet das Quittier-Ereignis); Text beim Lesen aus dem Bezug gebildet; Routentests inkl. 404 und Statuscode-Konvention
- [x] 1.6 Schlüssel `benachrichtigungen_aus` in `benutzer_einstellungen` (Whitelist), 422 für Alarm-Arten; Test für Annahme und Ablehnung
- [x] 1.7 Aufräumen im Scheduler: quittierte Zeilen nach 24 h, unquittierte nach 12 h; Test mit gesetzter Uhr
- [x] 1.8 `src/AGENTS.md` um einen Abschnitt „Benachrichtigungen“ ergänzen (eine Stelle für Empfänger, `melden` nach dem Commit, ungegatetes Ereignis mit Empfängerfilter)

## 2. Fundament Client: Benachrichtigungszentrale (D5, D6) · LLH-1208

- [ ] 2.1 `AlarmZentrale` hört auf `benachrichtigung`, holt den Text, Ton je Stufe, Toast im bestehenden Budget, OS-Meldung bei verdecktem Tab; Vitest für Stufe Hinweis und Alarm, sichtbar und verdeckt
- [ ] 2.2 Quittieren beim Schließen oder Öffnen, Entfernen auf Quittier-Ereignis; Vitest „Zwei Tabs“
- [ ] 2.3 Nachreichen nach `lagged`, nach eigenem Neuaufbau und beim Öffnen eines Einsatzes, mit Uhrzeit und höchstens einem dezenten Ton; Vitest „Server-Neustart“
- [ ] 2.4 Sammeltoast nennt alle neuen Arten mit Sprung; Vitest „Fünf Hinweise“
- [ ] 2.5 Org-Layout bekommt eine schlanke Zentrale für Org-Arten; Vitest
- [ ] 2.6 Benutzermenü → „Benachrichtigungen“: Schalter je Hinweis-Art, Alarm-Arten „immer an“; Vitest und Anwenderkapitel `einsatz-oberflaeche` (Abschnitt Benachrichtigungen) nach `docs/anwender/AGENTS.md`

## 3. Bestehende Alarme auf den neuen Weg (benötigt 1, 2) · LLH-1209

- [ ] 3.1 Sofortmeldung und Eskalation melden über `melden` (Erfasser ausgenommen, Eskalation ohne Auslöser); Rust-Tests „Neue Sofortmeldung“, „Eskalation“, „Eigene Sofortmeldung“
- [ ] 3.2 Überfälliger Auftrag an Auftraggeber und nicht quittierende Empfänger; Rust-Tests „Auftrag an S2 überfällig“, „Empfänger hat quittiert“
- [ ] 3.3 Fällige Erinnerung an die Empfängerfunktion, sonst den Ersteller; Rust-Tests „Erinnerung an S1“, „Erinnerung ohne Empfänger“
- [ ] 3.4 Ablösung (Vorwarnung, fällig) über `melden` an Modul-Leser, kein Doppel mit der Erinnerung; bestehende Szenarien in `kraefte-abloesung` bleiben grün
- [ ] 3.5 Sonderwege für Ton und Toast in `useEinsatzLiveStream` entfernen, Unwetter prüft die Einstellung und nutzt das Budget; bestehende Vitest-Fälle angepasst, `e2e/alarm-verdeckung.spec.ts` grün
- [ ] 3.6 Anwenderkapitel `meldungen`, `erinnerungen`, `abloesung`, `wetter-pegel` auf Adressierung und „eigene Aktionen still“ nachziehen

## 4. Gekoppelte Geräte still und Lagemonitor (D12, benötigt 1) · LLH-1210

- [x] 4.1 Geräte-Layout ohne Ton; Vitest „Gerät mit Modul Meldungen“
- [x] 4.2 Verdichtete Lagemonitor-Antwort um offene Sofortmeldungen erweitern (ohne Text); Routentest, dass keine Meldungsfelder enthalten sind
- [x] 4.3 Kopfzahl „Sofortmeldungen offen“ und Hervorhebung 60 s bei Anstieg (Sofortmeldungen, SK I), ohne Blinken; Vitest „Neue Sofortmeldung“, „Sofortmeldung bestätigt“
- [x] 4.4 Anwenderkapitel `lagemonitor` und `geraet-bedienen` nachziehen

## 5. Native Meldung in der Desktop-App (D7, benötigt 2) · LLH-1211

- [ ] 5.1 `tauri-plugin-notification` und Befehl `benachrichtigung_zeigen` in der Hülle, Eintrag in `SERVER_RECHTE` und AppManifest; `cargo test` der Hülle grün
- [ ] 5.2 Frontend nutzt den Befehl in der Hülle bei verdecktem Fenster; Fokus bei Aktivierung; Vitest mit gestubbter Hülle
- [ ] 5.3 `src-tauri/AGENTS.md` und `docs/betrieb` (Berechtigung für Mitteilungen auf macOS/Windows) nachziehen

## 6. Auftrag erteilt, quittiert, erledigt (benötigt 1, 2) · LLH-1212

- [x] 6.1 Erteilen meldet `auftrag_erteilt` an Funktions- und Personen-Empfänger; Rust-Tests „Auftrag an eine Person“, „Auftrag an eine Einheit“, „Auftrag an die eigene Funktion“
- [x] 6.2 Quittung und Erledigt melden an den Auftraggeber; Rust-Test „Quittung“
- [x] 6.3 Anwenderkapitel `auftraege` nachziehen

## 7. Befehl und Lagebericht im Verteiler (benötigt 1, 2) · LLH-1213

- [x] 7.1 Freigabe meldet `befehl` bzw. `lagebericht` an Funktionen im Verteiler, Modulrecht geprüft; Rust-Tests „Befehl an S3 und S4“, „Empfänger ohne Modulrecht“
- [x] 7.2 Anwenderkapitel zu Befehlen und Lagebericht nachziehen

## 8. Meldung an meine Funktion (D8, benötigt 1, 2) · LLH-1214

- [ ] 8.1 Migration `meldung.empfaenger_funktion` anhängen, DTO, Codegen; Routentest Annahme und ungültiger Code 422
- [ ] 8.2 Erfassung bietet Empfängerfunktion an und füllt den Freitext vor; Vitest
- [ ] 8.3 Erfassen meldet `meldung` an die Funktion, bei Sofortmeldung nur der Alarm; Rust-Tests „Meldung an S2“, „Sofortmeldung an S2“
- [ ] 8.4 Anwenderkapitel `meldungen` (Empfängerfunktion) nachziehen

## 9. Lagebesprechung steht an (D10, benötigt 1, 2) · LLH-1215

- [x] 9.1 Migration für die Merker am Termin anhängen; Setzen eines Termins leert sie; Test
- [x] 9.2 Scheduler meldet 10 min vorher und bei Termin an EL und S1–S7; Rust-Tests „Termin 14:00“, „Termin verschoben“
- [x] 9.3 Anwenderkapitel zur Lagebesprechung nachziehen

## 10. Status einer Nachforderung (benötigt 1, 2) · LLH-1216

- [ ] 10.1 Statuswechsel meldet `nachforderung_status` an Ersteller und S4; Rust-Test „Nachforderung eingetroffen“
- [ ] 10.2 Anwenderkapitel zu Nachforderungen nachziehen

## 11. Neue Gefahr (benötigt 1, 2) · LLH-1217

- [x] 11.1 Neu eingetragene Gefahr meldet `gefahr` an Leser der Lagekarte, Änderung bleibt still; Rust-Test „Gefahr eingetragen“ und Test für die Änderung
- [x] 11.2 Anwenderkapitel zur Lagekarte (Gefahren) nachziehen

## 12. Neue Person der Sichtungskategorie I (benötigt 1, 2) · LLH-1218

- [x] 12.1 Neuerfassung mit SK I und Hochstufung auf SK I melden `sichtung_eins` an Leser des Moduls Personen; Rust-Test „Hochstufung“
- [x] 12.2 Anwenderkapitel zu Personen und Sichtung nachziehen

## 13. Einheit oder Fahrzeug wieder verfügbar (D11, benötigt 1, 2) · LLH-1219

- [x] 13.1 Wechsel der Statuskategorie auf verfügbar meldet `wieder_verfuegbar` an EL und S3 (Fahrzeug immer, Einheit nur bei Handstatus); Rust-Tests „Fahrzeug einsatzbereit“, „Wechsel innerhalb gebunden“
- [x] 13.2 Anwenderkapitel zu Einheiten und Fahrzeugen nachziehen

## 14. Chat-Erwähnung (D9, benötigt 1, 2) · LLH-1220

- [x] 14.1 Migration `chat_erwaehnung` anhängen, Nachricht nimmt die Liste der Erwähnungen an (Grenzen nach `src/AGENTS.md`, Eingabegrenzen); Routentests
- [x] 14.2 `@`-Vervollständigung aus Mitgliedern und besetzten Funktionen in der Chat-Eingabe; Vitest
- [x] 14.3 Erwähnung meldet `chat_erwaehnung` an Nutzer, die den Kanal sehen dürfen; Rust-Test „Erwähnung einer Funktion“
- [x] 14.4 Anwenderkapitel `chat` nachziehen

## 15. Org-Ebene: Aufnahme und neuer Einsatz (benötigt 1, 2.5) · LLH-1221

- [x] 15.1 Aufnahme in einen Einsatz meldet `einsatz_aufnahme` an den Aufgenommenen über den Org-Kanal; Rust-Test „Aufnahme außerhalb eines Einsatzes“
- [x] 15.2 Anlegen eines Einsatzes meldet `einsatz_neu` an Führungskräfte mit Leserecht, ohne den Anleger; Rust-Test „Neuer Einsatz“
- [x] 15.3 Anwenderkapitel zur Einsatzliste nachziehen

## 16. Abschluss · LLH-1222

- [ ] 16.1 `./scripts/check-all.sh` grün (lokal oder als CI-Lauf des PRs belegt)
- [ ] 16.2 Mutationsprobe an der Empfängerauflösung (Auslöser-Ausschluss und Ersatz über Mitgliedschaft auskommentieren → Tests rot)

## Workflow follow-up

- Mit LLH-1222: `/opsx:archive kcjecn9e-benachrichtigungskonzept` im Branch dieser Teilaufgabe, Spec-Sync nach `openspec/specs/benachrichtigungen` und `openspec/specs/lagemonitor`, dann PR gegen `alpha`.
- Web Push bei geschlossenem Tab (Non-Goal dieser Change) steht als LLH-1223 auf dem Board.
