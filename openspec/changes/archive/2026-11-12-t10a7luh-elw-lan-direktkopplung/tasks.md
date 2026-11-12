# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: erst der rote Test, dann der
Code.

- **Migrationen:** die nächste freie Nummer über `origin/alpha` (`scripts/check-migrationen.sh`,
  vorher `git fetch origin alpha`).
- **Integrationstests mit zwei oder drei Instanzen:** nach `tests/instanz_kopplung.rs`,
  `tests/instanz_fuehrung.rs`, `tests/instanz_spiegel.rs` und `tests/instanz_stammdaten.rs`,
  Hilfen in `tests/instanz_hilfen/`. Für Direktkopplungen kommen die Instanzen mit TLS auf
  Loopback.
- **Typen:** Nach jeder Änderung an Response-DTOs oder Enums `scripts/check-typ-codegen.sh`
  laufen lassen und beide generierten Dateien mitcommitten.

## 1. Art der Kopplung (D1, D2, D7)

- [x] 1.1 Migration: `instanz_kopplung.art`, `instanz_kopplungscode.art` (Vorgabe `standard`, CHECK), `instanz_kopplung.tls_zertifikat`. Wire-Enum `InstanzKopplungArt` per `wire_enum!` mit Fällen in `tests/enum_wire_kontrakt.rs`. `PROTOKOLL = 3`. Prüfung: Test „bestehende Kopplung gilt als standard“ grün, `scripts/check-migrationen.sh` grün
- [x] 1.2 Code ausstellen mit `art`. Ohne eigenes TLS → 409 mit Hinweis. `KoppelnAntwort.art`; die einlösende Seite übernimmt sie. Ein Code `vor_ort` an `protokoll < 3` → 426, ohne Verbrauch und ohne angebahnte Kopplung. Eine weitere Org mit anderer Art → 409. Prüfung: Integrationstests je Szenario aus Spec `instanz-kopplung` („Direktkopplung zweier ELW“, „ELW am Hub und vor Ort“, „Art passt nicht“, „Einlösende Seite zu alt“, „Ausstellen ohne eigenes TLS“)
- [x] 1.3 `InstanzKopplungArt::traegt(Fluss)` mit den Flüssen Stammdaten, Geheimnisse, Verwahrung und Führungswechsel. Unit-Test der Tabelle. Wächter-Test, der die Aufrufstellen je Fluss zählt (Liste aus D2). Prüfung: Wächter rot ohne Aufrufe, grün mit
- [x] 1.4 Admin-Spur: Art beim Ausstellen und Einlösen nennen. Prüfung: Test auf den Spur-Eintrag mit Art

## 2. Beglaubigtes Zertifikat (D3, D9)

- [x] 2.1 Fingerabdruck des eigenen TLS-Zertifikats beim Start (`src/tls/mod.rs`, `main.rs`), in `AppState`; die Identitäts-Antwort meldet ihn als vorhanden ja/nein. Prüfung: Unit-Test mit einem rcgen-Zertifikat (fester Hash) und Test „ohne --tls kein Fingerabdruck“
- [x] 2.2 Verifier in `src/instanz/zertifikat.rs` mit Erfassungs- und Prüfmodus. Die Handshake-Signatur prüft rustls, Kette und Hostname nicht. Client-Cache je Fingerabdruck. Prüfung: Tests gegen eine lokale TLS-Gegenstelle mit rcgen-Zertifikat: passt → Verbindung; anderes Zertifikat → Fehler „passt nicht“; Erfassungsmodus merkt den Fingerabdruck
- [x] 2.3 Koppeln `vor_ort`: Die einlösende Seite ruft im Erfassungsmodus auf, vergleicht `KoppelnAntwort.tls_zertifikat` und speichert erst dann. Prüfung: Integrationstests „Selbstsigniertes Zertifikat“ und „Angreifer in der Mitte mit eigenem Zertifikat“ (TLS-Proxy mit eigenem Zertifikat im Test, keine Seite speichert)
- [x] 2.4 Route `POST /api/instanz/zertifikat` (signiert, leerer Body, signierte Antwort mit Fingerabdruck). In `melden` bei Abweichung zuerst bestätigen, dann neu senden, mit Admin-Spur „Zertifikat der Gegenstelle gewechselt“. Sonst nichts senden und Zustand „Zertifikat passt nicht“. Prüfung: Integrationstests „Neues Zertifikat nach IP-Wechsel“ und „Fremdes Zertifikat“; Abgleich und Anträge laufen nach dem Wechsel weiter
- [x] 2.5 Meldung trägt den gespeicherten Fingerabdruck; die erreichte Seite zeigt „Zertifikat bestätigt“ oder „Gegenstelle kennt ein älteres Zertifikat“. Standardkopplungen unverändert (Plattform-Verifier, `https://`). Prüfung: Test je Anzeigezustand und Test „Hub mit öffentlichem Zertifikat“ ohne gespeicherten Fingerabdruck
- [x] 2.6 ADR-0027 nach `docs/architektur/entscheidungen/VORLAGE.md` mit Prüfzeilen (ADR-0014 als Herleitung, akzeptierte ADRs bleiben unverändert); `src/AGENTS.md`, Abschnitt Instanzkopplung: Art und beglaubigtes Zertifikat. Prüfung: `scripts/adr-fuer.sh src/instanz/melden.rs` nennt ADR-0027, `scripts/check-architektur.sh` grün

## 3. Nebenwirkungen der Richtung auf `vor_ort` sperren (D2)

- [x] 3.1 Stammdaten: `find_quelle`, Liefern und Übernehmen nur über `standard`. Prüfung: Integrationstest „Erst vor Ort, dann Hub“ (Quelle ist der Hub, von ELW 1 kommt nichts)
- [x] 3.2 Geheimnisse und Passkey-Pflicht: `is_org_verteilend` nur über `standard`; „ELW verloren“ auf `vor_ort` → 409. Prüfung: Tests „Admin an ELW 1 mit Passwort“ und „Kein ELW verloren vor Ort“
- [x] 3.3 Verwahrung: `faellige_verwahrungen` nur für `standard`; die erreichte Seite lehnt `verwahrt` auf `vor_ort` ab. Prüfung: Integrationstests „Nachbereitung abgelaufen, ELW mit Hub und vor Ort“ und „Nur vor Ort gekoppelt“

## 4. Führung über eine Direktkopplung (D4)

- [x] 4.1 `entscheide` mit Art als Parameter, Tabelle aus D4 als reine Funktion mit Unit-Tests je Zeile und Richtung. Prüfung: Unit-Tests grün, bestehende Tests für `standard` unverändert grün
- [x] 4.2 `austausch`: Führungswechsel zwischen den Seiten einer Direktkopplung verwerfen, mit Hinweis an der Kopplung; eine Abgabe des bisherigen Führers an eine Dritte annehmen, und der Spiegel folgt (`richte_aus`). Prüfung: Integrationstests mit drei Instanzen „Gegenstelle beansprucht die Führung“, „ELW übergibt an den Hub“, „Neuer Führer hier nicht gekoppelt“
- [x] 4.3 `fuehrung::repo` (Ziele der Übergabe) und `fuehrung::dienst` (Anfrage, Notübernahme, Abgabecode) für Gegenstellen vor Ort sperren, 409. Prüfung: Tests „Notübernahme per Route“ und Übergabe-Ziele ohne Gegenstelle vor Ort; „Einsätze beim Gegenüber“ zeigt den Einsatz weiter

## 5. Ursprungskennung (D5)

- [x] 5.1 Migration `stammdaten_herkunft.ursprung` mit Index `(org_id, art, ursprung)` und Backfill `<gegenueber_kennung>/<fremder_schluessel>`. Prüfung: Migrationstest auf einer DB mit Herkunft
- [x] 5.2 Stammdaten-Lieferung trägt `ursprung` je Zeile; weitergereichte Zeilen nennen den gespeicherten Ursprung. Die Übernahme speichert und berichtigt ihn. Bei der ersten Lieferung mit Protokoll 3 wird der Stand einmal auf 0 gesetzt. Prüfung: Integrationstests „Konto vom Hub an zwei ELW“, „Ergänzung vor Ort“, „Zeile kam schon vor dieser Änderung“
- [x] 5.3 `abbildung::nach_ursprung` (eigenes Präfix → lokale Zeile, nie Stellvertreter; sonst Herkunft). Prüfung: Unit-Tests je Fall, auch für ein fremdes Org-Präfix und einen Stellvertreter
- [x] 5.4 Spiegel: `Zeile.ursprung` und `KontoAngabe.ursprung` liefern; `uebernehmen` und `konto_lokal` mit Ursprung als letztem Versuch; `katalog` bleibt unverändert (design.md, Nachtrag „D5: Kataloge unverändert“). Prüfung: Integrationstests mit Hub und zwei ELW: „Fahrzeug vom Hub im Spiegel vor Ort“, „Gleiches Konto an beiden ELW“, „Spontanhelfer nur an ELW 1“, „Einsatzleitung liest vor Ort mit“
- [x] 5.5 Anträge: `KontoAngabe.ursprung` und Ursprung für `AntragZiel::Stammdaten`; der Führer bildet ab, ohne Treffer Ablehnung bzw. leerer Verweis. Prüfung: Integrationstests „ETB-Eintrag vom ELW vor Ort“, „Konto nur an ELW 2“, „Eintreffen mit Einheitsvorlage vom Hub“
- [x] 5.6 Gegenseite mit Protokoll 2 überliest die neuen Felder, und die Standardkopplung arbeitet weiter. Prüfung: Integrationstest mit herabgesetzter Version

## 6. Entdeckung im LAN (D6)

- [x] 6.1 Crate `mdns-sd` mit fester Version aufnehmen. Prüfung: `scripts/check-deps.sh` grün, Lizenz in der Drittanbieter-Übersicht, falls das Repo eine führt
- [x] 6.2 Schalter `--lan-entdeckung` / `LIFELINE_LAN_ENTDECKUNG` in `src/config.rs` (Vorgabe aus). Start nur mit `--tls` und ohne Loopback-Bind, sonst eine Zeile im Log. Prüfung: Unit-Tests der Startbedingung (aus, ohne TLS, Loopback, an)
- [x] 6.3 `src/instanz/entdeckung.rs`: Ankündigen mit TXT `k`, `n`, `f`, `pv` und Suchen ohne die eigene Instanz. Prüfung: Unit-Test der TXT-Bildung (ohne Org-, Konto- oder Einsatzdaten); Test mit zwei Daemons auf derselben Maschine, wo Multicast verfügbar ist (sonst mit `#[ignore]` und Grund, im Nachtrag dokumentiert)
- [x] 6.4 Route `GET /api/admin/instanz/lan` (Admin, 3 s, `{aus: true}` ohne Schalter, Markierung „schon gekoppelt“). Prüfung: Tests „Nicht-Admin“ → 403 und „Schalter aus“
- [x] 6.5 Neuauflösen in `melden` für `vor_ort` nach einem Netzfehler, höchstens einmal je Backoff-Stufe. Eine neue Adresse gilt erst nach signierter Antwort und landet in der Admin-Spur. Prüfung: Tests mit einer Such-Naht (Trait) für „Neue IP per DHCP“ und „Antwort nicht signiert“
- [x] 6.6 Betriebsdoku: `docs/betrieb/packaging.md` (Satz zu mDNS, `network_mode: host`), `docs/betrieb-tls.md` (Direktkopplung braucht `--tls`), Schalter in der Konfigurationsübersicht. Prüfung: Wächter der Doku grün

## 7. Oberfläche (D8)

- [x] 7.1 API und Typen: `api/instanz.ts` (Art, Zertifikatszustand, LAN-Liste), Query-Keys aus der Registry. Prüfung: `scripts/check-typ-codegen.sh` grün, Vitest für die Abfrage
- [x] 7.2 Code ausstellen mit der Wahl „Direktkopplung vor Ort“, gesperrt ohne TLS mit Grund; Code einlösen mit „Im Netz suchen“ und Liste, Klick übernimmt die Adresse. Prüfung: Vitest/RTL je Zustand (Liste, leer, „LAN-Entdeckung ist aus“, schon gekoppelt)
- [x] 7.3 Kopplungskarte: Chip „vor Ort“, Zeile „Zertifikat“, kein „ELW verloren“ auf `vor_ort`. Texte in `instanzText.ts`. Prüfung: Vitest je Zustand
- [x] 7.4 Paneel „Führung“: Gegenstelle vor Ort nicht als Ziel, Hinweis mit Grund. Prüfung: Vitest
- [x] 7.5 e2e: Seite „Instanzkopplung“ mit gemockter LAN-Liste, Ausstellen „vor Ort“. Prüfung: e2e grün nach `frontend/e2e/AGENTS.md`

## 8. Doku

- [x] 8.1 Architekturdoku: Kapitel 5 (Bausteine `entdeckung`, `zertifikat`), 6 (Ablauf Koppeln vor Ort und Zertifikatswechsel), 7 (Satz zu mDNS ersetzt, Port 5353/UDP), 8 (Sicherheit: beglaubigtes Zertifikat, Ursprungskennung), 11 (Risiken aus diesem Entwurf), 12 (Glossar: Direktkopplung, Ursprungskennung). Konzeptnotiz: offene Frage „Entdeckung im LAN“ beantwortet. Prüfung: `scripts/check-architektur.sh` grün
- [x] 8.2 Anwenderdoku `docs/anwender/kapitel/instanzkopplung.md`: Direktkopplung vor Ort, „Im Netz gefunden“, Zertifikat, was vor Ort nicht geht. Nach `docs/anwender/AGENTS.md`. Prüfung: Wächter der Anwenderdoku grün

## 9. Abschluss

- [x] 9.1 Verifikation `superpowers:verification-before-completion`: Gesamtszenario mit Hub, ELW 1 und ELW 2. ELW 2 liest einen Einsatz von ELW 1 über die Direktkopplung und stellt einen Antrag, ELW 1 übernimmt ihn. Prüfung: Integrationstest grün
- [x] 9.2 Review vor dem PR (Phase 4 von `dev-zunder-orchestrieren`); bestätigte Befunde behandelt. Prüfung: Abschnitt „Review“ im PR
- [x] 9.3 Bilder der Änderung: Ausstellen „vor Ort“, Liste „Im Netz gefunden“, Kopplungskarte mit Chip und Zertifikat, Paneel „Führung“ mit Hinweis. Prüfung: Bilder in PR und Meldung
- [x] 9.4 `./scripts/check-all.sh` grün (lokal das Bündel `schnell` und die betroffenen Suiten, voll über die CI des PRs)

## Workflow follow-up

- `/opsx:archive` samt Spec-Sync im selben Branch, dann PR gegen `alpha`
- LLH-1497 auf `review`, nach dem Merge `done`; LLH-1678 wird danach frei
