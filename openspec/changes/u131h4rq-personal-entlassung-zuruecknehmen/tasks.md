# Tasks

Jede Aufgabe per `superpowers:test-driven-development`: erst der Test, der ohne die Änderung rot
ist, dann der Code.

## 1. Backend: Vorzustand beim Entlassen

- [ ] 1.1 `RUECKNAHME_FRIST_MINUTEN` nach `crate::entlassung` heben (Fahrzeug nutzt sie von dort), dazu `GRUND_RUECKNAHME` = „Entlassung zurückgenommen“; Fahrzeug-Tests bleiben grün
- [ ] 1.2 Typen in `src/personal/mod.rs`: `PersonalEntlassungVorzustand` (D1), `PersonalEntlassungAntwort { personal, vorzustand }`, `PersonalEntlassungRuecknahmeAntwort { personal, ausgelassen }` mit `RuecknahmeAusgelassen`, Listen-Höchstzahl; in `api_doc.rs` eintragen; Serde-Test (fehlende Listen = leer)
- [ ] 1.3 `entlassen_tx` liest vor dem Lösen Einheit, Fahrzeug, UHS, geführte Einheiten, geleitete Abschnitte und Einsatzleitung und liefert den Vorzustand; Repo-Test `entlassen_liefert_den_vorzustand` rot→grün
- [ ] 1.4 Route `entlassen` antwortet mit `{ personal, vorzustand }`; Routen-Test prüft die Form; `scripts/check-typ-codegen.sh` und beide generierten Dateien

## 2. Backend: Rücknahme

- [ ] 2.1 `zuruecknehmen_tx` in `src/personal/disposition_repo.rs`: Riegel (D2) und Zeitachsen-Prüfung (D3) vor jedem Schreiben; Tests: andere Person, anderes `entlassen_at`, nach elf Minuten, schon reaktiviert, Zeitachse berichtigt (Entlassung gestrichen; Nachtrag danach) → je 409 und nichts geändert
- [ ] 2.2 Endzustand aufheben, Entlassung streichen (D3); Tests: Status, `disponiert_at`, Stärke-Position und Storno-Sperre unverändert; Zeitachse mit offener Periode ab vorher, Entlassung gestrichen mit Grund, keine neue Periode; ohne offene Periode beim Entlassen bleibt die Zeitachse unverändert
- [ ] 2.3 Bindungen nach D4/D5 mit `RuecknahmeRechte` je Modul; Test `entlassen_und_zuruecknehmen_ergibt_denselben_zustand` (alle sechs Bindungen) und je Teil ein Auslass-Test (Einheit aufgelöst, anderer Führer, Fahrzeug beendet, UHS aufgelöst, Abschnitt mit anderem Leiter oder gelöscht, anderer bzw. externer oder ausgetragener Einsatzleiter, fehlendes Modulrecht) mit Bezeichnung und Grund in Worten
- [ ] 2.4 ETB-Text `etb_text_entlassung_zurueckgenommen` mit Unit-Test (ohne und mit Auslassungen)
- [ ] 2.5 Route `POST …/personal/{ep}/entlassen/zuruecknehmen` in `routes/einsatz_personal.rs` und `app.rs`: Listen deckeln und entdoppeln, Rechte vor der Transaktion (`darf_zielmodul` generisch über den Gate-Marker), ETB, Live über `Betroffen` aus dem Zurückgebundenen; Routen-Tests: Erfolg, 409, Body über der Höchstzahl → 400, ETB-Eintrag; Modul-Präfix-Tabelle (`einsatz::modul`) prüfen
- [ ] 2.6 Gegenprobe Storno: nach Entlassen und Rücknahme lehnt `stornieren` ab (Test)

## 3. Frontend

- [ ] 3.1 `api/einsatzPersonal.ts`: `entlasseDisposition` liefert die Antwort mit Vorzustand, neu `nimmEntlassungZurueck`; `ausgelassenSatz` aus `pages/FahrzeugePage.tsx` in ein gemeinsames Modul (`kraefte/`), Fahrzeugliste nutzt es; Tests grün
- [ ] 3.2 `pages/EinsatzkraftPage.tsx`: Rückgängig ruft die Rücknahme mit dem Vorzustand; Ausgelassenes im Seitenhinweis, Ablehnung im Seitenhinweis; „Erneut disponieren“ bleibt `reaktivieren`; `EinsatzkraftPage.test.tsx` rot→grün (Rücknahme statt Reaktivieren, Hinweis mit Ausgelassenem, 409 im Hinweis)

## 4. Regeln und Doku

- [ ] 4.1 `frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“: Personal aus der bekannten Lücke streichen, Rücknahme der Person nennen; `frontend/src/kraefte/AGENTS.md`, Kräfte-Zeitachse: Rücknahme streicht die Entlassung dieses Entlassens, bei berichtigter Zeitachse 409; Prettier grün
- [ ] 4.2 `docs/anwender/kapitel/personal.md`, „Eine Person entlassen oder stornieren“: was „Rückgängig“ zurückholt und was der Hinweis nennt (Vorbild `fahrzeuge.md`); `quellen` prüfen; Wächter von `docs/anwender/AGENTS.md` grün

## 5. Integration

- [ ] 5.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün; die e2e-Specs, die Personal-Entlassen berühren, einzeln grün

## Workflow follow-up

- Review vor dem PR (Phase 4 von `dev-zunder-orchestrieren`), bestätigte Befunde behandeln.
- `/opsx:archive u131h4rq-personal-entlassung-zuruecknehmen` im selben Branch, Verweise auf den Change-Pfad nachziehen.
- PR gegen `alpha` mit Bildern und Abschnitt „Review“.
