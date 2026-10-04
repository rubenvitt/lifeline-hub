# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development` (erst der rote Test).

## 1. Server: Systemkennung und Pflicht

- [ ] 1.1 `etb::SYSTEM_RUFNAME` und Rückfall in `etb::repo::einfuegen` (fehlende Seite → „System“, gesetzte bleibt, D5); verifiziert durch Repo-Tests in `src/etb/repo.rs` (`None`/`None` → „System“/„System“, `None`/`Some("EA-Süd")` → „System“/„EA-Süd“) und einen Integrationstest über einen Kopplungspfad (Auftrag erteilen → ETB-Anordnung mit Von „System“, An = Empfänger)
- [ ] 1.2 Demo-Szenario (`src/demo/szenario.rs`) und Dev-Seeds (`src/dev/seed.rs`) geben ihren Hand-Einträgen ausdrücklich Von und An („Einsatzleitung“); verifiziert durch einen Test in `tests/demo_daten.rs`: nach dem Import hat kein ETB-Eintrag des Einsatzes ein leeres Von oder An
- [ ] 1.3 Pflicht in `routes/etb.rs::erfassen` über `pflicht(…, "Von")`/`pflicht(…, "An")` vor Insert und Idempotenzprüfung (D6); verifiziert durch Tests in `tests/etb.rs`: ohne `an` → 400 und ETB unverändert, `von` aus Leerzeichen → 400, Berichtigung ohne `von` → 400, mit beiden → 201 mit getrimmten Werten
- [ ] 1.4 Alle Rust-Integrationstests, die `POST …/etb` ohne `von`/`an` senden, ziehen beide Felder nach (skriptgestützt, kein still auffüllender Helfer); verifiziert durch `cargo test` grün
- [ ] 1.5 Präferenz-Schlüssel `etb_standard_rufname` in `BEKANNTE_SCHLUESSEL` (D1); verifiziert durch den erweiterten Whitelist-Test in `src/benutzer_einstellungen/mod.rs` und einen Routentest (PUT des Schlüssels → 200, GET liefert ihn; fremde Person sieht ihn nicht)

## 2. Client: Standard lesen, schreiben, wirksam machen

- [ ] 2.1 Kern `etb/standardRufname.ts`: Wert lesen (defensiv, D1), Wert bilden (`an = von` bei „Empfänger wie Absender“), `wirksameMetadaten(metadaten, standard)` (D2); verifiziert durch `standardRufname.test.ts` (ungültiges JSON/leere Seite → kein Standard, Ableitung `an === von`, Ausdrückliches schlägt Standard je Seite)
- [ ] 2.2 Hook `etb/useStandardRufname.ts` auf `globalKeys.benutzerEinstellungenVon` (Lesen nur angemeldet, Schreiben per `setzeBenutzerEinstellung`, Antwort in den Cache); verifiziert durch `useStandardRufname.test.tsx` mit MSW (Laden, Setzen aktualisiert den Cache, das Gedächtnis der Sprungpalette im selben Fach bleibt unberührt)
- [ ] 2.3 `baueEintrag` und Chip-Zeile nutzen `wirksameMetadaten`; Standard-Chips tragen den Titel „Standard“, ein entfernter ausdrücklicher Chip fällt auf den Standard zurück; `@`/`atZielFeld` unverändert; verifiziert durch `schnellerfassungModell.test.ts` und `Schnellerfassung.test.tsx` (ohne Angabe → Standard in beiden Seiten, Meldung mit `@` → Von ersetzt, An Standard, Anordnung mit `@` → An ersetzt, zweiter Eintrag nach `/von` wieder Standard, Berichtigung vorbelegt)
- [ ] 2.4 `anVorbelegung` belegt nicht mehr vor (D3): Parameter `fuehrungsstelle` aus `useEtbEntwuerfe`, Mount-Vorbelegung aus `Schnellerfassung`/`EtbEntwurfsTabs` entfernen; verifiziert durch angepasste Tests in `entwuerfe/` (leerer Entwurf ohne An, Entwurf zeigt geänderten Standard) und `funktionsOptionenKern.test.ts` (Vorrangregel unverändert als Vorschlag)

## 3. Client: Abfrage und Pflicht in der Erfassung

- [ ] 3.1 Abfragezeile in der Erfassung (D4): ohne Standard mit Schreibrecht im laufenden Einsatz sichtbar, `AutoComplete` über Funkrufnamen und Sachgebiete mit dem Vorrangregel-Vorschlag vorgewählt, Freitext, „Empfänger wie Absender“ (Vorgabe an), „Übernehmen“; mit Standard stehen Von/An als gekennzeichnete Chips da, „Standard-Rufname ändern“ steht in der Chip-Zeile; verifiziert durch Komponententests (erste Abfrage, Beobachter ohne Zeile, Freitext übernommen, getrennte Seiten, Ändern, keine Zeile in der Berichtigung)
- [ ] 3.2 Pflicht vor dem Absenden (D7): fehlendes Von/An sendet nichts, nennt das Feld, öffnet ohne Standard die Abfragezeile, Text/Metadaten/Anhänge bleiben, nichts geht in die Offline-Warteschlange; verifiziert durch `Schnellerfassung.test.tsx` (kein `erfassen`-Aufruf, Meldung steht, Text steht) und einen Test der Entwurfsspeicherung ohne Von/An
- [ ] 3.3 Regeln nachziehen: `frontend/src/etb/AGENTS.md` (Von/An-Pflicht, Standard je Person, Vorbelegung zur Anzeige-/Sendezeit, Systemkennung), `frontend/src/fuehrung/AGENTS.md` (Vorrangregel nur noch Vorschlag); verifiziert durch `prettier --check` über `frontend/` grün

## 4. e2e

- [ ] 4.1 e2e-Helfer setzt den Standard per `PUT /api/benutzer-einstellungen/etb_standard_rufname` nach der Anmeldung; jede Spec, die über die Oberfläche ins ETB schreibt, nutzt ihn; verifiziert durch die betroffenen Specs grün
- [ ] 4.2 Neue Spec `e2e/etb-standard-rufname.spec.ts`: ohne Standard erscheint die Abfrage, Übernehmen zeigt Von/An-Chips, Erfassen speichert beide (Zeile der Zeitachse zeigt sie), Neuladen behält den Standard; als Beobachter keine Abfrage; verifiziert durch die Spec grün und eine Mutationsprobe (Pflichtprüfung im Client entfernt → Spec rot)

## 5. Abschluss

- [ ] 5.1 Gates: `./scripts/check-all.sh` lokal grün bis auf umgebungsbedingte Schritte; vollständig belegt durch die CI des PRs
- [ ] 5.2 Sichtprüfung im echten Stack (Backend-Binary, Vite, Chromium): erste Abfrage, Erfassen mit Standard, `@` überschreibt eine Seite, Systemeintrag „System“ nach einem erteilten Auftrag; Screenshot im PR-Thread
