# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der rote Test, dann der
Code; jede neue Prüfung bekommt eine Gegenprobe (Prüfung entfernt → Test rot). Migrationen bekommen
die nächste freie Nummer über `origin/alpha` (`scripts/check-migrationen.sh`, vorher
`git fetch origin alpha`). Vor jeder Datei `scripts/adr-fuer.sh <pfad>` (ADR-0005, ADR-0006,
ADR-0012 treffen die Kernstellen).

## 1. Schalter und Datenmodell (D1, D2, D4 Schalter)

- [x] 1.1 Schalter `--fuehrung` / `LIFELINE_FUEHRUNG` (Vorgabe aus) in `src/config.rs`, beim Start nach `instanz_identitaet.fuehrung_an` geschrieben (`instanz::fuehrung::save_schalter`, design.md D4); Config-Test wie bei `LIFELINE_WEB_PUSH`, Zeile in `docs/betrieb/env-registry.md`
- [x] 1.2 Migration (0311, Admin-Spur in 0312 ohne Transaktion): Tabellen `einsatz_fuehrung` und `einsatz_fuehrung_verlauf`, Spalte `einsatz.fuehrung_bei`, Spalten `fuehrung_gesendet_bis`/`fuehrung_empfangen_bis` an `instanz_kopplung`, Neuaufbau von `admin_audit` (`fuehrung_notuebernahme`, `fuehrung_verworfen`, `fuehrung_widerspruch`) und des CHECK von `benachrichtigung` (`fuehrung_ungueltig`, `fuehrung_uebernommen`); prüfen mit `cargo test --lib db::` und `scripts/check-migrationen.sh`
- [x] 1.3 Typen in `src/instanz/fuehrung/`: `Epoche` (Paar mit `Ord`, D2), `FuehrungWechselArt` und neue `AdminAktion`/Benachrichtigungsart per `wire_enum!`, je ein Fall in `tests/enum_wire_kontrakt.rs`; Unit-Tests: Zähler entscheidet, bei Gleichstand die Kennung, `naechste` nimmt max+1 und die eigene Kennung
- [x] 1.4 Repo der Akte: anlegen (Epoche 1, Ursprung als Führer) für jeden nicht gelöschten Einsatz einer zugeordneten Org (`repo::ensure_akten` beim Start, vor jeder Meldung und vor jedem Lesen der Führung; damit auch nach dem Anlegen und dem Koppeln); jede Änderung vergibt einen neuen `stand` und schreibt eine Verlaufszeile; `fuehrung_bei` nur hier; Repo-Tests für alle drei Anlässe, gelöschter Einsatz ohne Akte, Schalter aus legt nichts an

## 2. Schreibsperre (D4, D5)

- [x] 2.1 `berechtigung::fordere_aktiv` und `einsatz::repo::fordere_aktiv_in_tx` lehnen bei gesetztem `fuehrung_bei` (und Schalter an) mit 409 „Führung liegt bei „…“.“ ab; Unit-Tests beider Wege, Gegenprobe Schalter aus → schreibbar; Integrationstest: ETB-Eintrag an einem Einsatz mit fremder Führung → 409, Lesen → 200
- [x] 2.2 Gate `EinsatzFuehrungszugriff` (Org-Grenze, Einsatzleitung, ohne `fordere_aktiv`) in `src/einsatz/kontext.rs`, eingetragen in `SANKTIONIERTE_GATES` von `tests/einsatz_kontext_guard.rs`; Tests: Führungspersonal → 403, abgeschlossener Einsatz → erlaubt, fremde Führung → erlaubt
- [x] 2.3 Einsatzanzeige bekommt `fuehrung { fuehrend, bei, epoche, offen }` (fehlt ohne Akte); jeder Wechsel sendet das `einsatz`-Ereignis; `scripts/check-typ-codegen.sh` und beide generierten Dateien mitcommitten; Integrationstest der Anzeige mit und ohne Akte
- [x] 2.4 Hintergrundläufe (Erinnerung, Benachrichtigung, Ablösung, `planung/uebernahme.rs`) darauf prüfen, ob sie Einsatzinhalt schreiben; wer es tut, geht über `fordere_aktiv_in_tx` oder überspringt Einsätze mit `fuehrung_bei`; je betroffenem Lauf ein Test, Ergebnis der Prüfung als Kommentar an LLH-1491 (Rest als Nachzug zu LLH-1492)

## 3. Austausch in der Meldung (D3, D7)

- [x] 3.1 `MeldenAnfrage`/`MeldenAntwort` um `fuehrung` und `fuehrung_bis` erweitern (`#[serde(default)]`, nur additiv); Serde-Test: alte Nachricht ohne Felder liest sich, neue Felder fehlen bei Schalter aus
- [x] 3.2 Senden: Akten mit `stand > fuehrung_gesendet_bis`, höchstens 50 je Nachricht, bei Rest sofort neu melden; Empfangen: Akte nur für zugeordnete Org und mit Führer ∈ {ich, Gegenüber}, sonst verwerfen; `fuehrung_empfangen_bis` nachziehen; Tests: Delta, Obergrenze mit 120 Akten in drei Meldungen, fremde Org verworfen
- [x] 3.3 Annahmeregel nach D7 als reine Funktion (Richtung × Herkunft der Epoche × Beweis → annehmen / offen halten / verwerfen); Tabellentest über alle Zellen
- [x] 3.4 Ende-zu-Ende über zwei Instanzen (`tests/instanz_kopplung.rs`-Muster): Einsatz am ELW angelegt → Akte am Hub mit Epoche (1, ELW); Schalter nur an einer Seite → nichts fließt

## 4. Übergabe und Anfrage (D9)

- [x] 4.1 Route `POST /api/einsaetze/{id}/fuehrung/uebergeben` (`EinsatzFuehrungszugriff`): vergibt `(n+1, ich)` an das Gegenüber, setzt `fuehrung_bei`, stößt die Meldung an; Integrationstest: danach 409 beim Schreiben, nach der Meldung führt der Hub; auch nach dem Einsatzabschluss
- [x] 4.2 Anfrage: Admin-Route `POST /api/admin/instanz/fuehrung/{kennung}/anfragen` am ELW (Org des Admins, Akte des Gegenübers); der Hub gibt bei der Meldung ab und bestätigt in der Antwort; Ende-zu-Ende-Test: Hub-Einsatz (1, Hub) → nach der Meldung führt der ELW mit (2, Hub); Nicht-Admin 403, fremde Org 404
- [x] 4.3 Notübernahme gegen die erreichte Seite: am ELW über `/api/einsaetze/{id}/fuehrung/notuebernahme` bzw. die Admin-Route für eine Akte des Gegenübers, Grund Pflicht (422 ohne); der Hub nimmt die höhere Epoche ohne Rückfrage an und zeigt „Notübernahme“; Ende-zu-Ende-Test

## 5. Notübernahme mit Unterschrift oder Code (D6, D8, D7)

- [x] 5.1 Erklärung als kanonischer Text (Typ `lifeline-fuehrung-notuebernahme/1`) mit Bau- und Lesefunktion; Unit-Tests: gleiche Eingabe → gleicher Hash, jedes Feld ändert den Hash
- [x] 5.2 Zeremonie `Fuehrungserklaerung` in `zeremonie.rs`, Routen `…/fuehrung/{kennung}/notuebernahme/start` und `/abschluss` (Admin der Org, eigener gültiger Unterschriftsschlüssel; ohne Schlüssel und ohne Code 409 mit Hinweis); Integrationstests mit `SoftwarePasskey`: gültig → Hub führt mit (n+1, Hub), fremder Schlüssel → 422, abgelaufene Zeremonie → 409
- [x] 5.3 Abgabecode am ELW: Route `POST /api/einsaetze/{id}/fuehrung/code` erzeugt Code, speichert nur `abgabe_schluessel` (HKDF, eigenes Salz), gibt die Führung ab, ein neuer Code ersetzt den alten; Unit-Tests der Ableitung (Kennung und Epoche gehen ein), Integrationstest: Code nur einmal in der Antwort, danach 409 beim Schreiben
- [x] 5.4 Code am Hub: Notübernahme-Abschluss mit Code statt Assertion, Beweis = HMAC(Schlüssel, Erklärungshash); Ende-zu-Ende: richtiger Code → ELW nimmt an, falscher Code → ELW verwirft (5.6)
- [x] 5.5 Prüfung am ELW: Unterschrift gegen `gueltig`-Schlüssel der lokal zugeordneten Org (`pruefen::verify`), Code gegen `abgabe_schluessel`; gültig → offen halten, ELW schreibt weiter, Benachrichtigung `fuehrung_uebernommen`; Tests: gültig, wartender Schlüssel → ungültig, widerrufener → ungültig, Unterschrift über andere Erklärung → ungültig
- [x] 5.6 Verwerfen (D10): ELW vergibt (max+1, ELW), Alarm `fuehrung_ungueltig` an die Einsatzleitung, Admin-Spur `fuehrung_verworfen`; nach der nächsten Meldung führt wieder der ELW und der Hub zeigt den Hinweis; Ende-zu-Ende-Test

## 6. Bestätigen und Widersprechen (D7, D10, D11)

- [x] 6.1 Route `POST /api/einsaetze/{id}/fuehrung/bestaetigen`: übernimmt die offene Epoche, setzt `fuehrung_bei` und `bruch_at` (= `zuletzt_gesehen_at` vor der Meldung mit der Übernahme), Admin-Spur `fuehrung_notuebernahme`; ohne offene Übernahme 409; Integrationstest inklusive Bruchstelle im Verlauf
- [x] 6.2 Route `…/fuehrung/widersprechen`: ELW vergibt (max+1, ELW), Admin-Spur `fuehrung_widerspruch` an beiden Seiten, Hinweis an der Kopplung des Hubs; Ende-zu-Ende-Test: Hub (3, Hub) → Widerspruch → beide zeigen (4, ELW)
- [x] 6.3 Gleichstand Ende-zu-Ende: beide Seiten erklären ohne Verbindung den Zähler 5 → nach dem Austausch gilt die größere Kennung, die andere Seite durchläuft ihren Ablauf (Hub: annehmen, ELW: prüfen und offen halten)
- [x] 6.4 Verlauf: `GET /api/einsaetze/{id}/fuehrung` und Admin-Übersicht der Akten des Gegenübers (Seite „Instanzkopplung“) mit Epoche, Art, von, nach, wer, Grund, Bruchstelle; Integrationstests der Inhalte

## 7. Oberfläche

- [x] 7.1 `einsatz/schreibrecht.ts`: Führung als weitere Achse, `darfFuehrungBedienen` neu; `components/nurAnsicht.ts`: Grund „Führung liegt bei …“; Vitest: fremde Führung → Schreiben, Leiten, Verwalten falsch, Bedienen wahr; Guard `schreibrecht.guard.test.ts` grün
- [x] 7.2 `api/instanz.ts`: `unterschreibeErklaerung(start, abschluss)` aus `gegenzeichne` herauslösen, Gegenzeichnung nutzt es; Vitest beider Aufrufer
- [x] 7.3 Chip „Führung: <Instanz> · E<n>“ in `einsatz/EinsatzLayout.tsx` (nur mit Akte) und Hinweisband unter der Kopfleiste bei offener Übernahme mit „Übernahme bestätigen“ (Rückfrage) und „Widersprechen“ (Rückfrage, `danger`); Vitest: Band nur bei `offen`, Knöpfe rufen die Routen, Speicherfehler am Ort
- [x] 7.4 Paneel „Führung“ auf `pages/EinsatzdatenPage.tsx` vor „Einsatzabschluss“: Stand, Verlauf, „Führung an <Gegenüber> übergeben“, „Führung per Code abgeben“ (Code-Anzeige wie beim Kopplungscode, nicht per Esc schließbar), „Notübernahme“ mit Grund, wenn das Gegenüber führt; Vitest der Zustände und Rückfragen (`rueckfrage.guard.test.ts`, `erklaertext.guard.test.ts` grün)
- [x] 7.5 Seite „Instanzkopplung“: Abschnitt „Einsätze beim Gegenüber“ mit Führung, Epoche und Aktionen „Führung übernehmen“ (ELW), „Notübernahme“ mit Grund und Wahl Unterschrift oder Code (`OtpEingabe` bzw. Codefeld, Hub), Hinweise „widersprochen“/„verworfen“; Vitest der Aktionen
- [x] 7.6 Texte der neuen Benachrichtigungsarten (`alarm/benachrichtigungKatalog.ts`) und der Admin-Spur (Zugangsprotokoll); Vitest der Texte; Query-Keys klassifiziert (Guard grün)
- [x] 7.7 Bilder der Änderung für PR und Meldung (Chip, Hinweisband, Paneel, Abschnitt an der Kopplung, Code-Anzeige) per Wegwerf-Spec im Bildlauf

## 8. Doku

- [x] 8.1 Anwenderkapitel `docs/anwender/kapitel/instanzkopplung.md`: Führung, Übergabe, Notübernahme mit Unterschrift oder Code, Bestätigen und Widersprechen, Schalter; Wächter aus `docs/anwender/AGENTS.md` grün
- [x] 8.2 Architektur: Kapitel 6 (Ablauf Notübernahme), Kapitel 8 (Führung je Einsatz), Kapitel 11 (Risiko „erschlichene Unterschrift für eine Notübernahme“, bestätigt am ELW), neue ADR-0018 mit Regeln und Prüfung, Kapitel 9 listet sie, Kapitel 5 nennt `src/instanz/fuehrung`; `src/AGENTS.md`, Abschnitt „Instanzkopplung“, um die Führungsregeln (Sperre in `fordere_aktiv`, `fuehrung_bei` nur im Modul); `scripts/check-architektur.sh` grün
- [x] 8.3 Konzeptnotiz: offene Frage „Gleichzeitige Notübernahmen“ als beantwortet markieren (Verweis auf diese Change)

## 9. Abschluss

- [ ] 9.1 Gates: Bündel `schnell` lokal grün, dazu die betroffenen Rust-Suiten (`instanz::`, `einsatz::`, `auth::`, `db::`, `tests/instanz_kopplung.rs`, `tests/einsatz_kontext_guard.rs`, Wire-Kontrakt) und Vitest; den vollen `./scripts/check-all.sh` bringt die CI des PRs

## Workflow follow-up

- `superpowers:requesting-code-review` vor dem PR
- `/opsx:archive` samt Spec-Sync im selben Branch, dann der PR gegen `alpha`
- Nachzug für LLH-1492: Bruchstelle → Anträge, Führungswechsel ins ETB, Schalter einschalten oder entfernen
