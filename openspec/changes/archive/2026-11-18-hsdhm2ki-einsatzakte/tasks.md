# Tasks

## 1. Backend: Bausteine für das ZIP

- [x] 1.1 CSV-Builder der Exporte Personen, Tiere, Schäden als Funktionen herausziehen und von den bestehenden Export-Routen nutzen lassen; Nachweis: bestehende Tests `tests/einsatz_person.rs`, `tests/einsatz_tier.rs`, `tests/einsatz_schaden.rs` grün, Ausgabe bytegleich
- [x] 1.2 `routes/support.rs`: Funktion für bereinigte Bytes eines Anhangs für die Akte (Fehler „unbereinigbar“ getrennt); Nachweis: Unit-Test und Wächter `nur_support_liefert_anhang_bytes_aus` grün
- [x] 1.3 `src/einsatzakte/`: Sammeln aller Anhänge des Einsatzes über `MODUL_LINKER` (ohne gelöschte, ohne Chat, Lagebericht/Befehl nur freigegeben, ausgeblendete Module raus) mit Ordnerpfad, sanitisiertem und kollisionsfreiem Dateinamen; Nachweis: Tests für Pfade, `..`/Steuerzeichen, Dubletten ` (2)`
- [x] 1.4 ZIP-Schreiber in Temp-Datei (Anhänge `Stored`, CSVs `Deflated`, `inhalt.csv` mit Pfad, Modul, Datensatz, Dateiname, Größe, SHA-256, „nicht enthalten“ mit Grund); Nachweis: Test liest das ZIP zurück und prüft Einträge und Prüfsummen

## 2. Backend: Route

- [x] 2.1 `GET /api/einsaetze/{id}/einsatzakte/anlagen.zip` in `src/app.rs`, Handler `src/routes/einsatzakte.rs`, Gate `EinsatzLesezugriff<OhneModul>` + `PFAD_KEY`, je Modul ausgeblendet → weg, sonst `fordere_zielmodul` (403); Nachweis: Integrationstest „Modul gesperrt → 403“, „ausgeblendet → Teil fehlt“, Guard `tests/einsatz_kontext_guard.rs` grün
- [x] 2.2 Audit in einer Transaktion vor dem Bau (`export` Personen, `anhang` je Personen-Anhang, `anhang_zugriff_audit` je UHS-Anhang), scheitert → keine Daten; Nachweis: Integrationstest prüft die Protokollzeilen
- [x] 2.3 Streaming-Antwort mit `Content-Type`, `Content-Disposition` (Einsatznummer, Datum), Temp-Datei danach gelöscht; Sperre je Einsatz → 409 ohne Audit; Nachweis: Integrationstests ZIP-Inhalt (ETB-Foto, gelöschter Schaden-Anhang fehlt, Dubletten) und 409
- [x] 2.4 Aufbewahrung: abgelaufene Frist bzw. geschwärzte Anhänge → 403 bzw. fehlen; Nachweis: Integrationstest

## 3. Frontend: Bausteine herauslösen

- [x] 3.1 `freigabeDerQuelle` aus `druck/einsatzbericht/quellen.ts` exportieren; Lesefassung des Lageberichts und Befehls samt `DokumentAnlagen` als Baustein ohne Seitenrahmen nutzbar machen, Einzelseiten unverändert; Nachweis: bestehende Vitest-Tests und `dokument-anlage-druck`-Spec grün
- [x] 3.2 `druck/einsatzakte/quellen.ts` mit `akteFreigabe` (Bericht voll + etb, personen, auftraege, lageberichte); Nachweis: Vitest gesperrt / nicht genutzt / abrufen, Module nur aus der Registry
- [x] 3.3 `druck/einsatzakte/abruf.ts`: paralleler Schnappschuss aller Kapitel, nur freigegebene Befehle/Lageberichte, Zustände bereit / kein-zugriff / fehler; Query-Key `einsatzKeys.einsatzakteDruck` nicht live; Nachweis: Vitest mit Testdaten, Query-Key-Guard grün
- [x] 3.4 `druck/einsatzakte/AuftragsListe.tsx` über `DruckTabelle`, aufsteigend nach Nummer, aufgehobene bleiben; Nachweis: Vitest

## 4. Frontend: Seite und Einstiege

- [x] 4.1 `pages/EinsatzakteDruckPage.tsx` unter `einsatzdaten/akte`: Sackgasse bei Sperre, Kapitel als `druck-kapitel` mit eigenem `Druckkopf` (Stand, Vorläufig), „keine Einträge“/„nicht genutzt“, `DruckKnopf` erst bei `bereit`, „Neu laden“, ZIP-Knopf als Download-Link; Nachweis: Vitest der Seite
- [x] 4.2 Pfad `einsatzaktePfad` in `routing/deeplinks.ts`, Route in `App.tsx`, Aktion auf der Einsatzdaten-Seite, Eintrag in der Sprungpalette; Nachweis: Vitest Deeplinks/Palette
- [x] 4.3 e2e `e2e/einsatzakte-druck.spec.ts` in `DRUCK_SPECS`: Kapitelreihenfolge, Seitenumbruch je Kapitel, PDF in Chromium (`pdf-kern.ts`), ZIP-Download liefert `application/zip`; Nachweis: Lauf in drei Engines grün (lokal Chromium grün samt Mutationsprobe; Firefox/WebKit sind in der Cloud-Sitzung nicht installiert, laufen in der CI auf `alpha`)

## 5. Doku und Abschluss

- [x] 5.1 Anwenderdoku `docs/anwender/kapitel/drucken-export.md` und `einsatzabschluss.md` (Regeln `docs/anwender/AGENTS.md`, `quellen:` nachziehen); Nachweis: Doku-Wächter grün
- [x] 5.2 Regeln in `frontend/src/druck/AGENTS.md` (Abschnitt Einsatzakte) und `src/AGENTS.md` (ZIP-Route bei Anhänge); Nachweis: Prettier grün
- [x] 5.3 `./scripts/check-all.sh --geaendert --ohne-e2e` grün, Typ-Codegen falls DTOs betroffen (Lauf im PR unter „Geprüft“: Schnellprüfungen grün bis auf Umgebungsfolgen ohne mise/Node 26; Rust-Bibliothek und berührte Testdateien grün, die volle Rust-Suite passt nicht ins Plattenkontingent der Sitzung)

## Workflow follow-up

- `/opsx:archive hsdhm2ki-einsatzakte` im selben Branch, dann PR gegen `alpha`
