# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code. Migrationen bekommen die nächste freie Nummer über `origin/alpha`
(`scripts/check-migrationen.sh`, vorher `git fetch origin alpha`). Integrationstests mit zwei
Instanzen kommen nach `tests/instanz_stammdaten.rs` (Muster `tests/instanz_kopplung.rs`).

## 1. Änderungslog (D1)

- [x] 1.1 Migration `stammdaten_aenderung` (globaler `stand`, `org_id`, `art`, `schluessel`, UNIQUE `(art, schluessel)`) und Trigger `AFTER INSERT/UPDATE/DELETE` an `fahrzeug`, `personal`, `qualifikation`, `material`, `fahrzeug_status`, `personal_status`, `einheit_typ`, `einheit_vorlage`, `org_fuehrungsfunktion`, `org_einstellungen`, `org_modul_einstellung`; Unterlisten (`personal_qualifikation`, `einheit_vorlage_fahrzeug/_personal/_material`) melden die Elternzeile; `benutzer` nur `AFTER UPDATE OF` den verteilten Spalten und `AFTER INSERT`. Tests in `src/instanz/stammdaten/`: jede Art erhöht den Stand bei Anlegen, Ändern, weichem und hartem Löschen; eine Anmeldung (`totp_letzter_schritt`) erhöht ihn nicht; je Zeile bleibt eine Logzeile
- [x] 1.2 Beschreibung je Art (`instanz::stammdaten::art`): Tabelle, Spalten von `daten`, natürlicher Schlüssel (D5), Löschspalte, Verweise und Unterlisten; Wire-Enum `StammdatenArt` per `wire_enum!` mit Fall in `tests/enum_wire_kontrakt.rs`. Test: jede Tabelle mit Log-Trigger hat eine Beschreibung und umgekehrt (Guard über `sqlite_master`)

## 2. Liefern an der erreichten Seite (D2)

- [x] 2.1 `nachlieferung(org, seit, budget)`: Zeilen nach `stand`, gelöschte als `geloescht`, Abhängigkeiten mit höherem Stand vorher mitliefern, `stammdaten_bis`. Tests: Reihenfolge, Budget (der Rest kommt mit dem nächsten Aufruf, nichts fehlt, nichts doppelt), Vorlage mit später geändertem Fahrzeug liefert das Fahrzeug vorher
- [x] 2.2 Additive Felder in `MeldenOrg`, `MeldenAnfrage`, `MeldenOrgAntwort` (alle `serde(default)`), Grenzen in `check_antwort` (`STAMMDATEN_MAX`, Unterlisten je Zeile). Test rechnet die größte zulässige Antwort gegen `ANTWORT_MAX`; Test mit einer Meldung im alten Schema (ohne neue Felder) bleibt grün
- [x] 2.3 `handle_meldung` liefert je aktiver Org die Stammdaten, `stammdaten_stand = -1` liefert nichts; Integrationstest: Grundstock bei der ersten Meldung, Änderung kommt mit der nächsten

## 3. Übernehmen an der meldenden Seite (D3, D4, D5)

- [x] 3.1 Migration `stammdaten_herkunft`, `stammdaten_uebernahme` (Merker) und Schreibschutz-Trigger `BEFORE UPDATE/DELETE` (Unterlisten auch `BEFORE INSERT`), an `benutzer` nur die verteilten Spalten; `AppError`: Nachricht `stammdaten_vom_hub` → 409 „Wird am Hub gepflegt“, Fall in `tests/fehler_vertrag.rs`. Tests: Route `PUT /api/fahrzeuge/{id}` auf übernommene Zeile → 409, auf lokale → 200; Passwort nach Einmalpasswort und TOTP-Zähler bleiben schreibbar
- [x] 3.2 Übernahme in einer Transaktion mit Merker, zwei Durchgänge (Zeilen, dann Verweise), Abgleich über natürliche Schlüssel, Löschung als Löschen oder Deaktivieren bei Verweisen, Quelle je lokaler Org (älteste Zuordnung, sonst `-1` und Hinweis), Stand nur bis `stammdaten_bis`. Integrationstests: vorher angelegtes Fahrzeug wird zusammengeführt und Einsatzdaten zeigen weiter darauf; hart gelöschtes, verwendetes Material wird deaktiviert; zweite Quelle liefert nichts
- [x] 3.3 Konten übernehmen: nie abgleichen, Namenskonflikt überspringen mit Hinweis an der Kopplung, `personal.benutzer_id` über die Herkunft auflösen, Deaktivieren beendet Sitzungen über `auth::session`; Aktion „Erneut abgleichen“ (`POST /api/admin/instanz/kopplungen/{id}/stammdaten-neu`, nur eigene Org, meldende Seite). Integrationstests: Konflikt mit lokalem „admin“, Auflösen und erneut abgleichen, Deaktivierung am Hub beendet Sitzung am ELW
- [x] 3.4 Widerruf einer Zuordnung löscht deren Herkunftszeilen (Zeilen gehören danach der Instanz); nach der Übernahme mit Änderung `stammdaten`-Ereignis an die Org (Spec `org-live`), ohne Änderung keins. Tests: nach Widerruf ist die Zeile per Route änderbar; Ereignis-Test mit Abonnent

## 4. Geheimnisse (D6, D7, D8)

- [x] 4.1 Migration `instanz_identitaet.age_privat`, `instanz_kopplung.gegenueber_age_empfaenger` und `gegenueber_datentraeger_verschluesselt`, `instanz_geheimnis_lieferung`; age-Schlüssel beim Start erzeugen (Test: bleibt über Neustarts gleich, Debug-Ausgabe zeigt ihn nicht); meldende Seite schickt Empfänger und Bestätigung aus `--datentraeger-verschluesselung-extern`
- [x] 4.2 Geheimnis liefern (age an den Empfänger) nur mit Empfänger, bestätigter Platte und nicht für Admins ohne Anmelde-Passkey; Lieferung festhalten. Tests: ohne Bestätigung kein Geheimnis und Hinweis „Geheimnisse nicht verteilt …“; mitgelesener Antwortrumpf enthält weder Hash noch TOTP im Klartext; Admin ohne Passkey ohne Geheimnis
- [x] 4.3 Geheimnis übernehmen: Platzhalter `PASSWORT_HASH_KEIN_LOKALES` ohne Geheimnis (`verifizieren` → `false` mit Wegwerf-Lauf, Test zur Antwortzeit wie LFH-310), Übernahme nur bei geändertem `geheimnis_merkmal`. Integrationstests: Anmeldung am ELW mit Passwort und TOTP vom Hub, auch nach Stoppen des Hubs; Einmalpasswort am ELW bleibt, bis der Hub das Passwort ändert
- [x] 4.4 Passwort-Provider: 403 „Admins melden sich hier per Passkey an“ für System-Admins mit Anmelde-Passkey in einer verteilenden Org, kein Fehlversuch; Tests: Admin mit Passkey am Hub 403, falsches Passwort weiter 401, Admin ohne Passkey 200, ELW unberührt, nicht verteilende Org unberührt
- [x] 4.5 „ELW verloren“: `POST /api/admin/instanz/kopplungen/{id}/verloren` (nur eigene Org, nur erreichte Seite), Widerruf, Platzhalter-Hash und Zweitfaktor zurücksetzen für gelieferte Konten, Sitzungen beenden, Aktion `instanz_elw_verloren` (Migration für den CHECK, Fall in `tests/admin_audit.rs`) mit `anzahl`. Integrationstests: altes Passwort scheitert mit 401, Einmalpasswort führt zurück, Sitzung ist beendet, anderer ELW bekommt die Konten ohne gültiges Passwort

## 5. Oberfläche (D9)

- [x] 5.1 `GET /api/instanz/stammdaten/herkunft` samt `scripts/check-typ-codegen.sh` und beiden generierten Dateien; Hook `useStammdatenHerkunft` mit Query-Key nach `frontend/AGENTS.md`, Abzeichen `HerkunftAbzeichen`; Vitest für Hook und Abzeichen
- [x] 5.2 Abzeichen und Bearbeitungssperre („Wird am Hub gepflegt“) in den Reitern Fahrzeuge, Material, Fahrzeug-Status, Personal, Qualifikationen, Personal-Status, Einheitstypen, Einheiten-Vorlagen, Führungsfunktionen, Anzeige, Einsatz-Vorgaben und in der Benutzerverwaltung; Vitest je Reiter: übernommene Zeile gesperrt, lokale Zeile „nur hier“ und bearbeitbar
- [x] 5.3 Seite „Instanzkopplung“: Hinweise (Stand, Konten-Konflikt, Geheimnisse nicht verteilt, zweite Quelle), „ELW verloren“ mit Bestätigung und Zahl der Konten, „Erneut abgleichen“; Benutzerverwaltung am Hub: Hinweis an Admins ohne Passkey; Anmeldeseite zeigt den 403-Text. Vitest für Texte und Knöpfe, Wortlaut mit `design:ux-copy`
- [x] 5.4 e2e-Fall in `frontend/e2e/` für die Sperre einer übernommenen Zeile (Herkunft per Testhelfer gesetzt, zweite Instanz nicht nötig); Lauf grün

## 6. Doku und Regeln

- [x] 6.1 ADR-0016 (ersetzt ADR-0011, Ausnahme D7), ADR-0011 auf `status: ersetzt`; `scripts/check-architektur.sh` grün
- [x] 6.2 Architekturdoku Kapitel 5 (Baustein `instanz::stammdaten`), 8 (Schreibschutz per Trigger), 11 (Risiken aus diesem Entwurf); `src/AGENTS.md`, Abschnitt Instanzkopplung (Trigger-Pflicht für neue verteilte Arten, Merker, 409); Konzeptnotiz: offene Frage „Anmeldung am ELW ohne Netz“ beantwortet
- [x] 6.3 Anwenderdoku `instanzkopplung.md` (Stammdaten, Anmeldung ohne Netz, Plattenbestätigung, ELW verloren, Admins mit Passkey) und Kapitel Benutzerverwaltung; Wächter der Anwenderdoku grün
- [x] 6.4 Folgeaufgabe in Zunder für die übrigen Kataloge (`zunder-task-anlegen`), Verweis im Kommentar an LLH-1493

## 7. Abschluss

- [x] 7.1 Review-Fan-out (Sicherheit, Korrektheit, Konventionen) und `superpowers:requesting-code-review`; bestätigte Befunde behoben
- [ ] 7.2 Bilder der Änderung (Abzeichen und Sperre, Seite „Instanzkopplung“ mit Hinweisen und Dialog „ELW verloren“) für PR und Meldung
- [ ] 7.3 `./scripts/check-all.sh` grün (lokal das Bündel `schnell` und die betroffenen Suiten, voll über die CI des PRs)

## Workflow follow-up

- `/opsx:archive` samt Spec-Sync im selben Branch, dann PR gegen `alpha`
- LLH-1493 auf `review`, nach dem Merge `done`
