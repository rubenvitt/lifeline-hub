## 1. Datenmodell und Typen

- [x] 1.1 Migration 0306 (`haushalt`; `einsatz_person.haushalt_id`, `kostform`, `unvertraeglichkeiten`; `betreuungsstelle.belegungsart`; `betreuungsstelle_belegung.quelle`) mit Vorgaben, die den Bestand unverändert lassen. Nachweis: `scripts/check-migrationen.sh` grün, `db::tests::migrationsnummern_sind_eindeutig` grün, ein Test liest eine Bestandsstelle als `gezaehlt` und eine Bestandsmeldung als `meldung`.
- [x] 1.2 Wire-Enums `Kostform`, `Belegungsart`, `BelegungQuelle` (`wire_enum!`) und Guard-Test „Sonderkost-Werte von `Kostform` = Felder von `Sonderkost`“. Nachweis: `cargo test` des Guards, `scripts/check-typ-codegen.sh` mit beiden generierten Dateien im Commit.
- [x] 1.3 Kostform, Unverträglichkeiten und Haushalt im Personen-DTO und im Personen-PATCH (Feld-CAS, 400 bei unbekannter Kostform und > 200 Zeichen, ETB nur „weitere Angaben“). Nachweis: Integrationstests in `tests/` für PATCH, 400 und ETB-Wortlaut.
- [x] 1.4 Unverträglichkeiten in Aufbewahrungskategorie „Behandlung“, Schwärzung leert sie, Lagestand ohne sie. Nachweis: Tests in Schwärzung und Aufbewahrung analog zu `melder_kontakt`.

## 2. Belegung namentlich geführter Stellen (D5)

- [x] 2.1 Belegungsart an Stelle anlegen/ändern (DTO, PATCH dreiseitig, ETB), Wechsel auf `namentlich` schreibt eine Meldung mit der Zahl der Registrierten. Nachweis: Integrationstests „Auf namentlich umstellen“ und „Zurück auf gezählt“.
- [x] 2.2 `belegung_nachfuehren_tx` mit Aufruf aus `verbleib_repo::erfassen_tx` (alte und neue Stelle), Personen-Storno; Meldung nur bei geänderter Zahl, `quelle = registrierung`, ETB-Meldungseintrag mit Herkunft. Nachweis: Integrationstest je Weg, dazu Mutationsprobe (Aufruf in `erfassen_tx` entfernen → Test rot).
- [x] 2.3 Handmeldung und Rücknahme an namentlicher Stelle → 409 „Stelle wird namentlich geführt“; Schließen mit Registrierten → 422. Nachweis: Integrationstests der drei Szenarien.

## 3. Registrieren, Abmelden, Kostformen (Backend)

- [x] 3.1 `POST …/betreuung/stellen/{sid}/registrierungen` (D2): Haushalt neu oder anhängen, Personen mit Verbleib, D5, ein ETB-Eintrag ohne Namen; Prüfkette 403 → Replay → 404 → 409 → 422 → 400. Nachweis: Integrationstests aller Szenarien aus „Haushalt an einer Betreuungsstelle registrieren“ und „Rechte der Registrierung“, Replay nach Einsatzende.
- [x] 3.2 `POST …/betreuung/stellen/{sid}/abmeldungen` (D6) mit Haushalt oder Personen, Überspringen nicht mehr Registrierter, D5, ein ETB-Eintrag. Nachweis: Integrationstests „Haushalt abmelden“, „Eine Person abmelden“, Replay.
- [x] 3.3 `GET …/betreuung/registrierungen?stelle=` für die Registrierliste (Haushalte, Personen der Stelle; Module Betreuung und Personen) und `GET …/betreuung/kostformen` (nur Betreuung, Feldmenge gepinnt). Nachweis: Integrationstests „Zählung“, „Nur Betreuung“, 403 ohne Personen für die Liste.
- [x] 3.4 Gerät „Betreuungsstelle“: Allow-Liste um die drei Routen, nur eigene Stelle (403 sonst); Live-Ereignisse `betreuung` und `person` bei Registrieren und Abmelden. Nachweis: Tests in `tests/geraet*.rs` und Live-Test.
- [x] 3.5 OpenAPI (`src/api_doc.rs`) und Typ-Codegen für die neuen DTOs. Nachweis: `scripts/check-typ-codegen.sh` grün.

## 4. Oberfläche

- [x] 4.1 API-Client und Query-Keys (`api/betreuung.ts`, `einsatzKeys`), Offline-Arten `registrierung` und `abmeldung` in `offline/schreiben.ts` mit `client_id` und Erfassungszeit, Räumung beim Abgleich. Nachweis: Vitest analog zu `offline/standReplay.test.tsx`.
- [x] 4.2 Maske „Registrieren“ (`betreuung/registrierung/`): Haushaltsangaben oben, je Person eine Zeile (ab `md` Raster mit Spaltenkopf, schmal Block in zwei Spalten), nichts eingeklappt, sichtbare Beschriftungen, Tab-Reihenfolge und Fokusführung bei „Person hinzufügen“/„Entfernen“, Kostform als Radiogruppe mit Pfeiltasten, Fehler per `aria-describedby`, Hinweis bei Unverträglichkeit und Normalkost, Sperrgrund ohne Schreibrecht oder bei geschlossener Stelle. Nachweis: Vitest „Haushaltsangaben einmal“, „Zweite Person übernimmt den Nachnamen“, „Nichts eingeklappt“ (inkl. Tab-Folge), axe-Prüfung der Maske ohne Befund; Playwright bei 390 px ohne waagerechten Bildlauf und im Handschuh-Modus mit Trefferhöhe.
- [x] 4.3 Registrierliste mit Band „Kostformen“, Haushalte aufklappbar, Abmelden mit Rückfrage für den Haushalt, vorgemerkte Einträge, Grund ohne Personenrecht; eingebaut in `BetreuungsstelleDetailPage` und `GeraetBetreuungsstellePage`. Nachweis: Vitest „Liste mit Band“, „Ohne Personenrecht“, Abmelden.
- [x] 4.4 Belegungsart im Datenraster der Stelle; „Belegung melden“ an namentlicher Stelle gesperrt mit Grund; Meldeverlauf zeigt Herkunft „Registrierung“ ohne „Zurücknehmen“. Nachweis: Vitest an `MeldeVerlauf` und `StelleBelegung`.
- [x] 4.5 Personen-Detail: Kostform und Unverträglichkeiten als `InlineAngabe`, Lesezeile Haushalt. Nachweis: Vitest an `Personendaten`.
- [x] 4.6 Verpflegung: `useBedarfsvorschlag` mit Quelle `sonderkost`, Vorbelegung der Sonderkost-Felder in `VerpflegungDialoge.tsx` mit `beruehrt`-Schutz und Hinweis. Nachweis: Vitest „Sonderkost aus der Registrierung“ und „Keine Registrierten“.
- [x] 4.7 e2e: Familie an der Stelle registrieren (Desktop und 390 px), Belegung der namentlichen Stelle steigt, Zeitfenster schlägt Sonderkost vor. Nachweis: neue Spec unter `frontend/e2e/` grün.

## 5. Regeln, Doku, Gate

- [x] 5.1 `frontend/src/betreuung/AGENTS.md`: Absatz „Registrierstelle“ (D1–D8 als Regeln, eine Wahrheit „in Betreuung“ auch bei namentlicher Führung); Verweis in `frontend/src/personen/AGENTS.md`. Nachweis: Prettier grün, `scripts/adr-fuer.sh` für die berührten Pfade geprüft.
- [x] 5.2 Anwenderdoku `docs/anwender/kapitel/betreuung.md`, `geraet-betreuungsstelle.md`, `verpflegung.md`, `betroffene.md` samt Bildern im Bildlauf (Regeln `docs/anwender/AGENTS.md`). Nachweis: Doku-Wächter grün.
- [x] 5.3 `./scripts/check-all.sh` grün; Bilder der Änderung für PR und Meldung.

## Workflow follow-up

- `/opsx:archive` im selben Branch, dann PR gegen `alpha` mit Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/hitr91obm7m7zvy3mnur82z5`.
- Folgeaufgaben anlegen: Bezugsperson wechseln, Registrierliste drucken, Personenauskunft.
