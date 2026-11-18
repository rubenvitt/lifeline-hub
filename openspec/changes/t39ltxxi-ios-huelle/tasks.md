# Tasks

Jede Aufgabe per `test-driven-development` (erst rot, dann grün). Swift-Code lässt sich im
Linux-Container nicht bauen: Belege für Swift sind grüne Läufe der CI (Linux-Job `ios` bzw.
`ios-pruefung.yml`), verlinkt im Kommentar an LLH-1978.

## 1. Vorarbeit Regeln

- [x] 1.1 Abschnitte „Backend — Migrationsvergabe“ und „Backend — Tabellenumbau und `-- no-transaction`“ aus der Wurzel-`AGENTS.md` nach `migrations/AGENTS.md` verschieben (Verweis in `src/AGENTS.md`) (eigener `refactor`-Commit), Verweise per `git grep` nachziehen; belegt durch `wc -l AGENTS.md` < 190 und grünes `scripts/check-all.sh --nur schnell`
- [x] 1.2 Freie ADR-Nummer gegen offene PRs prüfen und für ADR-0065 vormerken; belegt durch den Befund im Kommentar an LLH-1978

## 2. Server-Vertrag `GET /api/shell`

- [x] 2.1 Roter Integrationstest `tests/shell.rs`: anonym 200, `version` gleich `/api/health`, `shell_contract` ganze Zahl ≥ 1 (Pflichtfelder per `contains_key`, keine feste Feldzahl), erreichbar mit Gerätesitzung, 200 auch bei gestörter DB
- [x] 2.2 `src/routes/shell.rs` (`load_shell`, `SHELL_CONTRACT = 1` mit Doc-Kommentar zur Bruchregel, DTO `ShellInfo`), Route in `src/app.rs`, Modul in `src/routes/mod.rs`; Test aus 2.1 grün
- [x] 2.3 `ShellInfo` in `src/api_doc.rs` aufnehmen, `scripts/check-typ-codegen.sh` laufen lassen, `frontend/src/api/openapi.json` und `types.generated.ts` mitcommitten; Gate grün
- [x] 2.4 Mutationsprobe: `shell_contract` testweise auf 0 bzw. Route hinter `CurrentUser` → Test rot; Ergebnis im Kommentar

## 3. Plattformneutrale Texte (Lifeline-App)

- [x] 3.1 `frontend/src/pages/AppAnmeldungPage.tsx` und Test: „In der Lifeline-App anmelden als …“ und neutrale Fehler-/Untertitel; vitest grün, `git grep -n 'Mac-App' frontend/src` zeigt nur noch begründete Stellen
- [x] 3.2 Klartext des Anmeldewegs `systembrowser` im Zugangsprotokoll auf „Lifeline-App“ samt Test; vitest grün
- [x] 3.3 Anwenderkapitel, die die Mac-App bei der Anmeldung im Browser nennen, auf „Lifeline-App“ (Mitänderungsregel `docs/anwender/AGENTS.md`); Wächter der Anwenderdoku grün

## 4. Frontend: Kennung und Haptik

- [x] 4.1 Init-Skript der iOS-Hülle `ios/App/Huelle/huelle.js` (reines JS: Kennung mit `platform`, `version`, `passkey: false`, `anmeldungImBrowser`, `haptics`, `benachrichtigungZeigen`, `setAppBadge`, Ersatz für `window.print`, Message-Handler `lifeline`) und Testhelfer in `frontend/src/test/huelle.ts`, der es wie die Tauri-Skripte ausführt; Test „Kennung vollständig“ grün
- [x] 4.2 `frontend/src/huelle/faehigkeiten.ts`: `huellePlatform()`, `huelleVersion()`, `huelleHaptics(kind)` (feuern und vergessen, wirft nie, ohne Hülle nichts); Tests für Browser, Desktop-Hülle ohne Felder, iOS-Hülle, werfende Brücke
- [x] 4.3 Rückmeldung (`rueckmeldung/adresse.ts`) nennt bei `platform: 'ios'` die iOS-App, sonst wie bisher; bestehende Tests unverändert grün, neuer Fall grün
- [x] 4.4 Haptik in der gemeinsamen Erfassung und der ETB-Schnellerfassung: angenommen → `success`, vorgemerkt → `tap`, abgelehnt → `error`, je genau einmal; Tests je Fall, Mutationsprobe (Aufruf entfernt → rot)
- [x] 4.5 Haptik beim neu eingehenden Alarm der Stufe `alarm` (`warning`), nicht beim Nachspielen, nicht bei Stummschaltung; Tests
- [x] 4.6 Haptik in der Segmentleiste (`selection`, einmal je Wechsel, zentral); Test
- [x] 4.7 Test: Push-Schalter fehlt bei `platform: 'ios'`; Test: Start ohne `navigator.serviceWorker` (Registrierung, Alarm, Web Push) bleibt still und meldet keinen Client-Fehler
- [ ] 4.8 Haptik in den Anwenderkapiteln, die die Rückmeldung beim Speichern und den Alarm beschreiben (einsatztagebuch, einsatz-oberflaeche), erst mit dem ersten TestFlight-Build nach 10.2 (Anwenderdoku nur Ist-Stand); Wächter grün

## 5. Gemeinsame Fälle der Hüllen

- [x] 5.1 Fälle von `adresse.rs`, `deeplink.rs` (`deute`, `entscheide`) und `links.rs` als JSON unter `src-tauri/faelle/` auslagern; die Rust-Tests lesen sie (`cargo test -p lifeline-desktop` grün, Mutationsprobe an einem Fall rot)
- [x] 5.2 `src-tauri/AGENTS.md`: Fälle sind die gemeinsame Quelle beider Hüllen; Prettier/Gates grün

## 6. Gate und CI für iOS

- [x] 6.1 Swift-Paket `ios/LifelineKern` als Gerüst (Package.swift, leeres Modul, ein Platzhaltertest), Swift-Version gepinnt
- [x] 6.2 Schritt `ios` in `scripts/check-all.sh` (Bündel `ios`, in `alle`): `swift test` in `ios/LifelineKern`; ohne Toolchain „OK mit Lücke“, mit `IOS_SWIFT_PFLICHT=1` rot; Selbsttest des Skripts nach `scripts/AGENTS.md` grün
- [x] 6.3 `scripts/bereiche.sh` kennt `ios/*` und den Querbezug `src-tauri/faelle/*` (Desktop- und iOS-Prüfung); Selbsttest grün
- [ ] 6.4 `suiten.yml`: Job `ios` auf `ubuntu-latest` mit `IOS_SWIFT_PFLICHT=1`; Lauf mit Label `voll` grün
- [ ] 6.5 XcodeGen-Version unter `scripts/` pinnen (eine Stelle); `ios-pruefung.yml` (`pull_request`, Pfadfilter `ios/**`, `src-tauri/faelle/**`, `macos-latest`): Projekt erzeugen, Simulatorbau, Swift-Tests auf iOS, Simulator-Bilder als Artefakt; erster Lauf grün
- [x] 6.6 Architektur-Wächter kennt das Teilprojekt `ios`, Kapitel 5 der arc42 nennt es; `check-architektur.sh` grün

## 7. Swift-Kern `LifelineKern`

- [x] 7.1 Adressprüfung gegen die gemeinsamen Fälle (gleiche Meldungstexte); Linux-Job grün
- [x] 7.2 Deeplink deuten und entscheiden (vorbelegen, bestätigen, nichts) gegen die gemeinsamen Fälle; grün
- [x] 7.3 Linkregeln (Webview, Download, System) gegen die gemeinsamen Fälle; grün
- [x] 7.4 Serverliste (Codable: UUID, Name, Adresse, zuletzt verbunden, zuletzt bestätigter Vertrag): hinzufügen, umbenennen, wechseln, entfernen nur nicht-aktiv, Vorgabename Hostname; grün
- [x] 7.5 Vertragsprüfung: `ShellInfo` lesen, bekannte Verträge `[1]`, Richtung bei unbekanntem Vertrag, 404 → zu alt, ohne Netz letzter bestätigter Vertrag; grün
- [x] 7.6 Onboarding-Ablauf als Zustandsfunktion (Adresse → Prüfung → speichern nur bei verträglich) und Fehlerklassen (Zertifikat, nicht erreichbar, zu alt, zu neu) aus URL-Fehlercodes; grün
- [x] 7.7 Haptik-Abbildung Art → Rückmeldungsart (unbekannt → nichts, Schalter aus → nichts); grün

## 8. iOS-App

- [ ] 8.1 `ios/project.yml` (XcodeGen), App-Target ab iOS 17.4, iPhone und iPad, Bundle-ID `dev.rubeen.lifeline.ios`, Info.plist-Schlüssel (`LifelineVersion`, `ITSAppUsesNonExemptEncryption`, Kamera, lokales Netz, Schema `lifeline`); `ios/AGENTS.md` angelegt und in der Wurzel-Tabelle; ADR-0065 im selben Commit; `ios-pruefung.yml` grün
- [x] 8.2 Versionsskript unter `scripts/` schreibt Marketing-Version, `LifelineVersion` und Build-Nummer (Zeitstempel) aus `[workspace.package]`; Selbsttest für Alpha-, Beta- und stabile Version grün
- [ ] 8.3 App-Symbol aus der Bildmarke (1024 px, Kopf-Schwarz) und Startbildschirm; Simulator-Bild im Artefakt
- [ ] 8.4 Webview-Host: Datenspeicher je Server, Init-Skript aus 4.1, Brücke nur Hauptframe und Origin des aktiven Servers (Test mit fremder Origin und nach Serverwechsel, Mutationsprobe)
- [ ] 8.5 Native Seiten: Onboarding (Eingabe, QR-Scan, Vorbelegung per Deeplink), Serverliste, Einstellungen (Schalter Haptik), Status-Seiten kein Server, nicht erreichbar (mit Wiederholung und automatischem Laden), Zertifikat nicht vertrauenswürdig (Anleitung), nicht verträglich (Richtung, Versionen); Simulator-Bilder je Seite
- [ ] 8.6 Vertragsprüfung bei Start, Wechsel und Rückkehr in den Vordergrund; Neuladen nach `webViewWebContentProcessDidTerminate`; UI-Test im Simulator
- [ ] 8.7 Haptik, native Meldung (Berechtigung beim ersten Aufruf) und App-Badge über die Brücke; Test der Brückenbefehle
- [ ] 8.8 Anmeldung über `ASWebAuthenticationSession` (Schema `lifeline`, `verifier` bleibt in der App, Rücksprung nur aus der Sitzung, Einlösung im Webview, Ereignis `lifeline:app-anmeldung`); Test „Rücksprung von außen wirkungslos“
- [ ] 8.9 Links, `target=_blank`/`window.open`, Downloads über `WKDownload` (auch `blob:`) mit Teilen-Blatt, Drucken über `UIPrintInteractionController`; Tests gegen die Linkregeln
- [ ] 8.10 Natives Gefühl: Safe Area, kein Nachfedern, kein Pull-to-Refresh, keine Lupe und kein Textmenü außerhalb von Eingaben; Simulator-Bild und UI-Test
- [ ] 8.11 Entfernen eines Servers: Rückfrage, Webview schließen, Datenspeicher löschen, Fehler melden; Test
- [ ] 8.13 JS-Dialoge der Seite (`alert`, `confirm`, `prompt`) als native Dialoge über `WKUIDelegate` (sonst liefert `confirm` still `false`, etwa bei Feldkonflikt, Kartenkontext, Blockmenü, Tier löschen); App-Test und Bild im Artefakt
- [x] 8.12 `docs/betrieb/ios-app.md` (Installation über TestFlight, CA-Profil für das Einsatz-LAN, mkcert statt Rückfall-Zertifikat, Grenzen: keine Meldung im Hintergrund, kein Passkey im Webview, kein Start ohne Server) und `docs/betrieb/endgeraete.md` verweisen; Prettier grün

## 9. Auslieferung

- [ ] 9.1 `ios.yml` (`workflow_call` und `workflow_dispatch`): Versionsskript, Archiv, automatische Signierung per API-Schlüssel, Upload zu TestFlight; `artefakte.yml` ruft ihn nach `freigeben` nur für Tags der Kanäle `beta` und `main`, ohne das Release aufzuhalten; actionlint grün
- [x] 9.2 arc42 Kapitel 7 (Verteilung), 8 (Hüllen-Vertrag) und 11 (Risiken) nachziehen; Wächter der Architekturdoku grün

## 10. Übergaben an Ruben und Abnahme

- [ ] 10.1 Ruben: Bundle-ID registrieren, App in App Store Connect anlegen, API-Schlüssel (Rolle Admin, falls die Cloud-Signierung mit App Manager scheitert, siehe docs/betrieb/ios-app.md) als Secrets (`APP_STORE_CONNECT_*`) hinterlegen; Aufgabe bis dahin `blocked`
- [ ] 10.2 Handstart von `ios.yml` auf einem Beta-Stand lädt einen Build zu TestFlight; Link zum grünen Lauf im Kommentar
- [ ] 10.3 Ruben prüft auf iPhone und iPad: Onboarding mit `elw.local` (CA-Profil), zwei Server mit getrennten Sitzungen, Anmeldung im Browser mit Passkey, Haptik beim ETB-Eintrag (iPhone), Alarm mit Meldung bei offener App, CSV-Export, Drucken; Ergebnis im Kommentar

## 11. Integration

- [ ] 11.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, dazu `--nur ios` mit Toolchain in der CI; Links zu den grünen Läufen von `suiten.yml` (Label `voll`) und `ios-pruefung.yml` im PR

## Workflow follow-up

- Folgeaufgaben (angelegt 18.11.2026): LLH-1980 Start ohne Server (D5, im Blick behalten), LLH-1981 APNs, LLH-1982 Desktop-Hülle nutzt `/api/shell`, LLH-1979 API-Routen englisch.
- `/opsx:archive` samt Spec-Sync vor dem PR, dann PR gegen `alpha` mit Bildern der Änderung (Simulator-Artefakte).
