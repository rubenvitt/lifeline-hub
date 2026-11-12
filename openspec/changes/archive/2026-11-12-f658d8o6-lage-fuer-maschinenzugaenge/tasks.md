# Tasks

Zunder: https://zunder.rubeen.dev/#/aufgabe/f658d8o6lb9iyedtr5c7wgx0 (LLH-1638). Jede Aufgabe per
TDD; vor jeder Gruppe `scripts/adr-fuer.sh <pfade>` und die `AGENTS.md` auf dem Weg lesen.

## 1. Kartenbau umziehen, ohne Verhalten zu ändern (D7, D9)

- [x] 1.1 Test in `src/routes/lagemonitor.rs`, der für einen festen Einsatz (Einsatzort, Zone, Abschnitt, UHS, freies Zeichen) die Karte des Lagebild-Links als JSON festhält; er läuft gegen den heutigen `baue_karte` grün
- [x] 1.2 Getypte Zwischenform `KartenFeature` und `load_karten_features` in `src/routes/lagemonitor.rs`; `baue_karte` serialisiert daraus; der Test aus 1.1 und `cargo test --test lagebild_extern` bleiben grün
- [x] 1.3 `karte_etag`, `lagemeldung`, `LageQuery`, `KARTE_AUS`, `LagemonitorUhsZahl`, `LagemonitorLagemeldung` und den Kartenbau nach `src/routes/lagemonitor.rs` verschieben, `lagebild_extern.rs` darauf umstellen; `cargo test --test lagebild_extern` und die verschobenen Unit-Tests grün
- [x] 1.4 Eigener `refactor`-Commit: `baue_karte` → `build_karte` samt Verwendungen; `cargo check` und `git grep baue_karte` ohne Treffer in `src/`

## 2. Freigabe-Tabelle und Repo (D2, D3)

- [x] 2.1 `git fetch origin alpha`, dann Migration `0339_maschinenzugang_freigabe.sql` nach D2; `scripts/check-migrationen.sh` und `cargo test db::tests::migrationsnummern_sind_eindeutig` grün
- [x] 2.2 Tabelle in `einsatz::schwaerzung_registry::TABELLEN` und `instanz::spiegel::art::AUSGENOMMEN` einordnen; die Wächter `jede_einsatz_scoped_spalte_ist_klassifiziert`, `entdeckte_tabellen_gleich_registry_tabellen` und `art::tests::jede_einsatztabelle_ist_eingeordnet` grün
- [x] 2.3 `Scope::has_einsatzbezug()` mit Unit-Test: wahr für `lage:read`, falsch für alle anderen heutigen Scopes
- [x] 2.4 `src/public_api/freigabe.rs` mit `list_fuer_einsatz`, `freigeben_tx`, `beenden_tx`, `delete_fuer_einsatz_tx`, `delete_fuer_zugang_tx`, `freigegebener_einsatz`; Unit-Tests: Neu, Keine, Abgelöst, ein Einsatz für zwei Zugänge, wirksam nur am aktiven und nicht gelöschten Einsatz, Liste ohne widerrufene, abgelaufene und nicht freigebbare Zugänge
- [x] 2.5 ADR-0031 nach D12 anlegen (`scripts/adr-fuer.sh --alle` für die Nummer, Vorlage `VORLAGE.md`, unter 80 Zeilen, Prüfblock); `scripts/check-architektur.sh` grün

## 3. Route `GET /api/v1/lage` (D1, D6, D7, D8; Spec `lage-schnittstelle`)

- [x] 3.1 Schema-Typen und eigene Wire-Enums in `src/public_api/lage.rs` mit erschöpfendem `From`; Einträge in `tests/enum_wire_kontrakt.rs`; Unit-Tests für die Abbildung von `LagemonitorAnzeige` und `KartenFeature` (Namen nach D6/D7, `subkind`, kein `typ`, kein `api_version`)
- [x] 3.2 Neue Testdatei `tests/public_api_lage.rs` mit den Helfern aus `tests/maschinenzugang.rs` (in `tests/common` teilen statt kopieren): ohne Freigabe 200 mit `einsatz: null` ohne Karte; mit Freigabe Kopf, Zahlen, UHS mit `kind`/`state`, Lagemeldung, Antwortsignatur gültig; zuerst rot
- [x] 3.3 Handler `lage` mit `#[utoipa::path]`, `security(("machine" = ["lage:read"]))`, in `public_api::router()` mit `ScopeAnforderung::Scope(Scope::LageRead)`; Tests aus 3.2 grün, dazu `tests/maschinenzugang.rs` (`jede_route_mit_maschinenanmeldung_traegt_eine_scope_angabe`) und `tests/public_api.rs` grün
- [x] 3.4 Tests und Umsetzung: Scope fehlt → 403 `missing_scope`; Bearer `llh_lm_…` an `/api/v1/lage` → 401; abgeschlossener Einsatz → `einsatz: null`; Org-Doppelprüfung
- [x] 3.5 Tests und Umsetzung Karte: `karte` und `karte_etag` bei der ersten Abfrage, `?karte=<etag>` ohne Karte, geänderte Zone ergibt neue Fassung, `?karte=none` ohne beides; `htu` mit Abfrage wird akzeptiert
- [x] 3.6 Test und Umsetzung: keine Namen, keine Personenkennungen, kein Sachverhalt, kein Meldungstext, kein Zeichentext in der Antwort (Muster `lagebild_traegt_zahlen_karte_und_lagemeldung_aber_keine_personen`); Block `sanitaetsdienst` nur bei gewählter Reihe; der Abruf zählt im Abrufprotokoll unter `/api/v1/lage`
- [x] 3.7 Test und Umsetzung Spiegel in `tests/instanz_spiegel.rs` oder daneben: gespiegelter Einsatz liefert Zahlen und `einsatz.spiegel`; selbst geführter ohne den Block; Freigabestufe ohne alle Kategorien ergibt `einsatz: null` (Unit-Test der Prüffunktion)
- [x] 3.8 `cargo test --test public_api_spec_aktuell`, `docs/api/public-v1.json` mitcommitten; `scripts/check-typ-codegen.sh` grün
- [x] 3.9 `docs/api/maschinenzugang.md`: Abschnitt „Lage lesen“ (Freigabe, Beispielantwort, `?karte=`, Kartenarten, `einsatz.spiegel`), Satz zur Freigabe in `src/public_api/description.md`; Prettier und der Test `beschreibung_nennt_genau_die_fehlercodes` grün

## 4. Freigabe durch die Einsatzleitung (D4, D5; Spec `maschinenzugang`)

- [x] 4.1 Helfer `im_tx_aktiv` und `etb_vermerken` aus `routes/lagebild_extern.rs` an einen gemeinsamen Ort legen; `cargo test --test lagebild_extern` grün
- [x] 4.2 Neue Testdatei `tests/einsatz_anbindungen.rs`: Liste zeigt nur freigebbare Zugänge der Org; Freigeben und Beenden mit ETB-Eintrag; idempotent ohne zweiten Eintrag; Umstellen mit Eintrag in beiden Einsätzen; zuerst rot
- [x] 4.3 `src/routes/einsatz_anbindungen.rs` mit den drei Routen, `AnbindungFreigabe` in `src/api_doc.rs`, Routen in `src/app.rs`, modul-loser Eintrag in `src/einsatz/modul.rs`; Tests aus 4.2 grün
- [x] 4.4 Tests und Umsetzung Rechte: Mitglied ohne Leitung und Admin ohne Rolle → 403; Zugang fremder Org, widerrufen, abgelaufen oder ohne Scope nach D3 → 404; abgeschlossener Einsatz → 409; Abschluss zwischen Extractor und Transaktion hinterlässt keine Freigabe
- [x] 4.5 Tests und Umsetzung Spiegel: Freigabe an einem Spiegel legt einen ETB-Antrag an und wirkt sofort; Beenden bei beendetem Abgleich wirkt ohne Antrag; Umstellen mit früherem Einsatz als Spiegel
- [x] 4.6 Ende beim Abschluss: `einsatz::repo::abschliessen` löscht die Freigaben des Einsatzes; Test „Abschluss beendet die Freigabe, `/api/v1/lage` zeigt `einsatz: null`“
- [x] 4.7 Ende bei Widerruf und Scope-Entzug in `routes/anbindungen.rs`: Zeile löschen, ETB-Eintrag beim Führer, keiner am Spiegel; Tests: Widerruf, Entzug von `lage:read`, erneutes Erteilen ohne Freigabe, andere Änderung (Name) lässt die Freigabe stehen
- [x] 4.8 `AnbindungAnzeige` um `einsatz_id?` und `einsatz_bezeichnung?` ergänzen (nur wirksame Freigabe); Test in `tests/maschinenzugang.rs`
- [x] 4.9 `scripts/check-typ-codegen.sh`; `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten

## 5. Oberfläche (D10)

- [x] 5.1 `frontend/src/api/anbindungen.ts`: `loadEinsatzAnbindungen`, `schalteAnbindungFreigabe`; Query-Key `einsatzKeys.anbindungen` in `NICHT_LIVE_KEYS` mit Doku-Zeile; `queryKeys.guard.test.ts` und `queryKeys.test.ts` grün
- [x] 5.2 `EinsatzAnbindungen.tsx` mit reiner Funktion für die Zustandszeile; Tests: drei Zustände, „wartet auf Schlüssel“, Rechte sichtbar, Schalter gesperrt ohne Leitung und am abgeschlossenen Einsatz, Paneel fehlt ohne Zugang, Ladefehler sichtbar, Umschalten setzt die Antwort
- [x] 5.3 In `EinsatzGeraete.tsx` einbinden mit der Bedingung von `darfLagebild`; `EinsatzGeraete.test.tsx` um den Block „Anbindungen“ ergänzen
- [x] 5.4 `Anbindungen.tsx` und `AnbindungAnsicht.tsx` zeigen „liest {Einsatz}“ oder „kein Einsatz freigegeben“ bei Zugängen mit „Lage lesen“, sonst nichts; Tests in `Anbindungen.test.tsx`
- [x] 5.5 e2e in `frontend/e2e/anbindungen.spec.ts`: Admin legt Anbindung mit „Lage lesen“ an, Einsatzleitung schaltet sie auf „Geräte“ ein, die Seite „Anbindungen“ nennt den Einsatz; lokal mit `./scripts/check-all.sh --geaendert` oder Label `e2e` am PR belegt
- [x] 5.6 `mise exec -- pnpm -C frontend lint`, `typecheck` und die betroffenen Vitest-Dateien grün; Prettier über `frontend/`

## 6. Alten Weg entfernen (D9)

- [x] 6.1 Backend: `src/lagemonitor_zugang/`, `src/routes/lagemonitor_zugang.rs`, `src/routes/lagemonitor_v1.rs`, Routen in `src/app.rs`, Eintrag in `src/einsatz/modul.rs`, Typen in `src/api_doc.rs`, `BEZEICHNUNG_MAX` in `tests/eingabegrenzen_spiegel.rs` entfernen; `tests/lagemonitor_v1.rs` löschen, seine Inhaltsprüfungen sind in Gruppe 3 und 4 aufgegangen (vorher gegenlesen); `cargo check --all-targets` grün
- [x] 6.2 Tests anpassen: `tests/lagebild_extern.rs` (ein `llh_lb_`-Schlüssel an `/api/v1/lage` → 401), `tests/maschinenzugang.rs` (`kein_bearer_und_keine_sitzung_unter_v1` ohne Lagemonitor-Zugang), `tests/programmpunkt.rs` (`/api/v1/lage` trägt kein Programm); neuer Test: `GET /api/lagemonitor/v1/lage` → 404
- [x] 6.3 Migration `0340_lagemonitor_zugang_entfernen.sql` (Kind zuerst, ohne Marker), Einträge in `schwaerzung_registry` und `spiegel::art` entfernen; Registry-Wächter, `keine_toten_registry_eintraege` und `scripts/check-migrationen.sh` grün; Test: eine Datenbank mit Zeilen in beiden Tabellen migriert ohne Fehler
- [x] 6.4 Admin-Spur: `LesezugangAngelegt`/`LesezugangWiderrufen` bleiben lesbar, der Schreibweg (`Ziel::Lesezugang`) entfällt, soweit ungenutzt; `tests/enum_wire_kontrakt.rs` und der Test zu Migration 0269 in `src/db.rs` grün
- [x] 6.5 Frontend: `LagemonitorZugaenge.tsx`, `EinsatzLagemonitore.tsx`, `api/lagemonitorZugaenge.ts`, Nav-Eintrag, beide Query-Keys, `LAGEMONITOR_BEZEICHNUNG_MAX`, Barrel-Exporte und ihre Tests entfernen; Texte des Zugangsprotokolls für alte Einträge bleiben; `scripts/check-typ-codegen.sh`, Lint, Typecheck und Vitest grün
- [x] 6.6 `git grep -n 'llh_lm_\|lagemonitor-zugaenge\|lagemonitor/v1\|lagemonitor_zugang\|lagemonitor_freigabe'` zeigt nur noch Migrationen 0269/0270/0340, den 401- und den 404-Test, Admin-Spur-Texte und Doku-Verweise auf die Vergangenheit

## 7. Referenz-Client und Kommando (D11)

- [x] 7.1 `crates/lifeline-machine-client`: `http::lage` mit `?karte=`; Test gegen den Testserver (signiert, Antwortsignatur geprüft, `htu` mit Abfrage)
- [x] 7.2 `lifeline-hub zugang lage` in `src/public_api/kommando.rs` und `src/config.rs`; Unit-Test der Ausgabe, offene Frage zur Karte aus design.md dabei entscheiden und dort vermerken
- [x] 7.3 `docs/api/maschinenzugang.md`: Kommando und Client-Aufruf im Abschnitt „Lage lesen“ und unter „Referenz-Clients“; das dokumentierte Kommando läuft wie beschrieben gegen einen lokalen Server

## 8. Doku und Architektur (D12, D13)

- [x] 8.1 Anwenderkapitel `externe-lagemonitore.md` neu fassen (Kopf mit neuen `quellen`, vier Abschnitte), jeden Ablauf am laufenden System nachklicken; `anbindungen.md` um Freigabe und gelesenen Einsatz ergänzen; Verweise in `verwaltung.md`, `zugangsprotokoll.md`, `lagebild-extern.md`, `README.md`; `mise exec -- pnpm exec vitest run src/hilfe/anwenderdoku.guard.test.ts` grün
- [x] 8.2 arc42: Kapitel 5 (Zeile `src/lagemonitor_zugang` weg, `public_api` und `routes/einsatz_anbindungen` ergänzt), Kapitel 11 (R33 ohne Lagemonitor-Bearer); ADR-0022 `gilt_fuer` ohne die entfernten Pfade; `scripts/check-architektur.sh` grün
- [x] 8.3 Konzept `docs/konzepte/2026-11-11-oeffentliche-api.md`: datierter Nachtrag an D6 (kein Übergang, Verweis auf diese Change); `grep` nach verbliebenen Verweisen auf `/api/lagemonitor/v1/lage` in `docs/` außerhalb von Archiv und Konzepthistorie ohne Treffer
- [x] 8.4 Kommentar an LGM-13 und LGM-14 in Zunder: neue Adresse `GET /api/v1/lage`, Einlösen per Code, Wire-Namen nach D6/D7 (über `add_comment`, im Main-Loop)

## 9. Integration

- [x] 9.1 `./scripts/check-all.sh` ohne `| tail` grün: belegt der CI-Lauf des PRs zum Branch `claude/clever-davinci-43ghos` (lokal nicht als Ganzes fahrbar: in der Cloud-Sitzung fehlt `mise`; die Bereichssuiten liefen einzeln, siehe PR, „Geprüft“)
- [x] 9.2 Handprobe am laufenden System: Anbindung anlegen, `lifeline-hub zugang redeem`, Einsatz freigeben, `lifeline-hub zugang lage` zeigt den Einsatz; Freigabe beenden zeigt `einsatz: null`; Bilder des Paneels „Anbindungen“ und der Seite „Anbindungen“ für PR und Meldung aufnehmen

## Workflow follow-up

- Review vor dem PR über den ganzen Branch (`dev-zunder-ausfuehren`, „Review vor dem PR“), Befunde in den Abschnitt „Review“ des PRs.
- `/opsx:archive f658d8o6-lage-fuer-maschinenzugaenge` im selben Branch vor dem PR, Verweise auf den Archivpfad nachziehen (ADR-0031 `herleitung`, Code-Kommentare).
- PR gegen `alpha`, Aufgabe auf `review` mit `pr_url`.
