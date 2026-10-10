# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der rote Test, dann der Code.

## 1. Anmeldeweg als geschlossenes Enum (D1)

- [x] 1.1 `wire_enum!` `Anmeldeweg` in `src/auth/provider/mod.rs` mit den acht Werten anlegen; Rust-Test, dass `ID_PASSWORT`, `ID_DEV`, `ID_OIDC`, `ID_WEBAUTHN`, `totp::PROVIDER`, `geraet::PROVIDER` und `huelle::PROVIDER` je als `Anmeldeweg` parsen (`cargo test` grün)
- [x] 1.2 `AnmeldeEintragAnzeige.provider` auf `#[schema(value_type = Anmeldeweg)]` umstellen, Enum in `api_doc.rs` registrieren, `scripts/check-typ-codegen.sh` laufen lassen und beide generierten Dateien mitnehmen (Skript grün)
- [x] 1.3 `zugangsprotokollText.ts`: exhaustive `ANMELDEWEG_TEXT: Record<Anmeldeweg, string>` mit „Zweiter Faktor“, „Gerätecode“, „Mac-App“, „—“; `anmeldewegText` fällt für Unbekanntes auf „—“; Vitest für alle Werte und den Rückfall (`pnpm exec vitest run src/zugangsprotokoll` grün, Typecheck grün)

## 2. Anmeldeweg der Sitzung (D2)

- [x] 2.1 Migration `session.anmeldeweg` mit der nächsten freien Nummer anlegen (`scripts/check-migrationen.sh` grün)
- [x] 2.2 `session::anlegen` um den Parameter `anmeldeweg: Anmeldeweg` erweitern, alle sechs Aufrufer in `routes/auth.rs` (und Tests) mit dem Weg ihres `login_ok` versorgen, `anlegen_geraet` schreibt `geraetecode`; Repo-Test: angelegte Sitzung trägt den Weg (`cargo test auth::session` grün)
- [x] 2.3 Logout: Nachschlag liefert Benutzer und Anmeldeweg, Audit schreibt ihn, NULL → `unbekannt`; Routen-Test je Anmeldung mit Passwort und mit Passkey bzw. zweitem Faktor, danach Abmeldung, Spur zeigt den Weg; Test für eine Sitzung ohne Weg → `unbekannt` (`cargo test` grün)
- [x] 2.4 `BeendeteSitzung` um `anmeldeweg` erweitern, `nach_dem_beenden` schreibt ihn in die Anmeldespur (Person selbst); Test in `routes/sitzung.rs` (`cargo test routes::sitzung` grün)

## 3. Detail strukturiert (D3)

- [x] 3.1 Flache Serde-Struktur `ZugangsAngaben` (Rollen alt/neu, Gerät, Anmeldezeit) in `auth/admin_audit.rs`; `liste` liest `detail` als `angaben`, sonst Rohtext; Tests für alle drei Arten, Rohtext und kaputtes JSON (`cargo test auth::admin_audit` grün)
- [x] 3.2 `routes/benutzer.rs` (Anlage, Rollenwechsel) und `routes/sitzung.rs` (Admin beendet) schreiben `ZugangsAngaben`; bestehende Routen-Tests auf die neue Form umstellen (`cargo test` grün)
- [x] 3.3 `ZugangsaenderungAnzeige.angaben` ins Schema, Typ-Codegen nachziehen (`scripts/check-typ-codegen.sh` grün)
- [x] 3.4 Rollen-Bezeichnungen als exhaustive Records nach `stammdaten/rechteText.ts`, `BenutzerPage.tsx` nutzt sie (Dialog unverändert: „Benutzer“, „Admin“, „Keine“, „Führungskraft (darf Einsätze anlegen)“); bestehende Tests der Seite grün
- [x] 3.5 Spalte „Detail“ der Zugangsänderungen rendert `angaben`: „System-Rolle: Benutzer, Org-Rolle: Keine“, „Org-Rolle: Keine → Führungskraft“, „iPad, angemeldet <DTG>“ über `ZeitAnzeige`; ohne `angaben` der Rohtext; Vitest in `ZugangsprotokollPage.test.tsx` mit Zone Europe/Berlin (grün)

## 4. Kontofilter mit Teiltreffern (D4)

- [x] 4.1 `auth/audit.rs` und `auth/admin_audit.rs` vergleichen per `instr(lower(…), lower(?)) > 0`; Admin-Spur trifft weiter nie einen Anmeldeweg; Tests: Anfang, Mitte, andere Schreibweise, `%`/`_` wörtlich, Anmeldeweg-Ziel bleibt draußen (`cargo test` grün)
- [x] 4.2 `routes/zugangsprotokoll.rs` kürzt den Filter auf 64 Zeichen ohne „…“, `SpurFilter`-Doku nachziehen; Routen-Test mit einem langen Namen (`cargo test routes::zugangsprotokoll` grün)

## 5. Anwenderdoku (Mitänderungsregel)

- [x] 5.1 `docs/anwender/kapitel/zugangsprotokoll.md`: Abschnitte „Die Spalten“, „Suchen und Filtern“ und „Zugangsänderungen“ auf das neue Verhalten, Altbestand (D5) nennen; Wächter `src/hilfe/anwenderdoku.guard.test.ts` grün
- [x] 5.2 Bilder des Kapitels neu erzeugen (`pnpm doku:bilder --grep zugangsprotokoll`) und committen; geht der Bildlauf in der Umgebung nicht, das im PR ausdrücklich nennen

## 6. Gesamtprüfung

- [ ] 6.1 `./scripts/check-all.sh` grün (Format, Lint, Typecheck, Rust- und Vitest-Suite, Migrationsnummern, OpenSpec-Archiv)

## Workflow follow-up

- `/opsx:archive lfh-1152-zugangsprotokoll-klartext` im selben Branch vor dem PR (Spec `zugangsprotokoll` nach `openspec/specs/`).
- PR gegen `alpha` mit Plan, Umsetzung und Archiv; Board-Status `in review`.
