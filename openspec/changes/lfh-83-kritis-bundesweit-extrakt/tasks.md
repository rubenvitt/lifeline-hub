# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst den roten
Test, dann den Code. Grundlage sind `specs/lagekarte-fachebenen/spec.md` und `design.md`.

## 1. Backend: Tag-Normalisierung

- [x] 1.1 In `src/karte/normalisierung.rs` die KRITIS-Tag-Logik als Funktion über eine Tag-Map (`kritis_properties(tags) -> Option<(kategorie, properties)>`) herauslösen; die bestehenden `overpass_tests` auf diese Funktion umschreiben, sodass Kategorie-Wörter, Titel-Rückfall, Adresse, Kontakt und `notaufnahme` weiter gepinnt sind, plus ein Test, der für jede der elf Tag-Kombinationen der bisherigen Overpass-Query die Kategorie prüft und für ein Objekt ohne passende Tags `None` liefert; verifiziert durch `cargo test --lib normalisierung`

## 2. Backend: PBF-Import

- [x] 2.1 `osmpbf` in `Cargo.toml` aufnehmen, Lizenz prüfen und `./scripts/check-deps.sh` laufen lassen; verifiziert durch grünes `cargo build` und `check-deps.sh` ohne neue Advisory — Befund: `check-deps.sh` exitet 0, meldet aber als erlaubte Warnung RUSTSEC-2026-0186 (`memmap2` 0.5.10 „unsound“, transitiv über `osmpbf`); der Import nutzt `ElementReader::from_path` (gepufferter Leser), nicht den mmap-Weg
- [x] 2.2 Neues Modul `src/karte/kritis/` mit `extrakt.rs`: die drei Durchläufe aus design.md §2 (Nodes/Ways/Relations → Bounding-Box-Mitte) in einer synchronen Funktion `lies_extrakt(pfad) -> Vec<KritisObjekt>`; Testfixture: kleine `.osm.pbf` unter `tests/fixtures/` (per `osmium`/Skript aus einem handgeschriebenen `.osm` erzeugt, Erzeugungsweg im Fixture-README) mit einem getaggten Node, einem getaggten Way, einer Multipolygon-Relation und einem ungetaggten Objekt; verifiziert durch `cargo test --lib kritis::extrakt` (Zahl der Objekte, Kategorie je Objekt, Way-Punkt = bbox-Mitte)
- [x] 2.3 `bestand.rs`: Schema `kritis_objekt`/`kritis_objekt_neu`/`kritis_import` in `src/cache_db.rs::schema_anlegen` ergänzen; `ersetze_bestand(pool, objekte, meta)` schreibt in die Staging-Tabelle und tauscht in einer Transaktion; verifiziert durch Tests: nach Tausch ist nur der neue Bestand sichtbar, eine liegengebliebene Staging-Tabelle aus einem Abbruch wird beim nächsten Lauf verworfen, `kritis_import` trägt `stand`/`anzahl`

## 3. Backend: Abfrage und Verdichtung

- [x] 3.1 `bestand.rs`: `abfrage(pool, bbox) -> FachebeneAntwort` mit Einzelobjekten bis 5 000, darüber Sammelpunkte nach fester Rasterleiter (design.md §5); Tests: ≤ 5 000 → nur Einzelobjekte; > 5 000 → höchstens 5 000 Features mit `sammelpunkt: true`, Summe `anzahl` = Objekte in den berührten Rasterzellen; zwei überlappende bboxes liefern für dieselbe Zelle identische Sammelpunkte; kein Bestand → `offline`; bbox ohne Objekte → `leer`; `stand` = Stand des Imports
- [x] 3.2 Messung der DE-Ansicht gegen einen Bestand realistischer Größe (z. B. 400 000 synthetische Zeilen, Test mit `#[ignore]` und dokumentiertem Aufruf); Ziel < 300 ms. Liegt es darüber, Zellen beim Import vorberechnen (Plan B aus design.md §5) ohne Schnittstellenänderung; verifiziert durch die in der Task-Notiz festgehaltene Messzahl — Befund (Release-Build, 400 000 synthetische Objekte über DE): zur Abfragezeit gerechnet DE 384 ms, über dem Ziel → Plan B umgesetzt (`kritis_zelle`, beim Import je Leiterstufe vorberechnet, gedeckelte Zählung `LIMIT 5001`): DE 4,5 ms · NRW 9 ms · Region 28 ms · Stadt 2 ms; Tausch inkl. Zellen 12 s
- [x] 3.3 `Bbox::parse` ohne 1°-Grenze (Bereichs- und Reihenfolgeprüfung bleiben), Route `kritis` in `src/routes/karte.rs` auf `abfrage` umstellen, `fetch_kritis`/`erneuere_kritis`/`overpass_query`/`OVERPASS_URLS`/`Bbox::overpass`/`cache_key` entfernen; Integrationstests in `tests/karte.rs`: DE-bbox → 200 (nicht 400), fehlende/kaputte bbox → 400, leerer Bestand → 200 `offline`, befüllter Bestand → `ok` mit Features; verifiziert durch `cargo test --test karte kritis`

## 4. Backend: Scheduler und Schalter

- [x] 4.1 `src/config.rs`: `--kritis-extrakt` (bool, Vorgabe `true`, `ArgAction::Set`), `--kritis-extrakt-url`, `--kritis-extrakt-intervall-stunden` (Vorgabe 168) mit `env`; Tests in den bestehenden `config`-Tests (Vorgabe an, `false` per CLI und per Env abschaltbar, `parse_hermetisch`-Muster); verifiziert durch `cargo test --lib config`
- [x] 4.2 `scheduler.rs` nach `backup::scheduler`-Muster: `ist_faellig(meta, jetzt, intervall)` und `tick_einmal(...)` mit HEAD-Vergleich (`Last-Modified`/`ETag`), Download über `download::lade_datei` nach `<karten_dir>/kritis/`, Import in `spawn_blocking`, Datei-Löschen auch im Fehlerfall, Sperre gegen parallele Läufe; Tests: nicht fällig → nichts; unveränderte Header → kein GET, nur `importiert_at` fortgeschrieben; Download-/Parse-Fehler → alter Bestand unverändert und keine Datei im Verzeichnis (lokaler Fixture-Server mit `download_allow_loopback`-Testweg wie in den Download-Tests); verifiziert durch `cargo test --lib kritis::scheduler`
- [x] 4.3 `main.rs`: Scheduler nur bei `--kritis-extrakt true` starten (60 s Startverzögerung, stündlicher Fälligkeits-Tick), Schalterzustand und URL beim Start protokollieren; verifiziert durch `cargo run -- --kritis-extrakt false` (Log nennt „abgeschaltet", kein Download) und `cargo build`
- [x] 4.4 `frontend/playwright.config.ts`: `--kritis-extrakt false` im Backend-Kommando, Kommentar mit Grund; verifiziert durch `pnpm e2e` grün und kein `kritis/`-Verzeichnis im Temp-Datenpfad der Suite

## 5. Frontend: Laden und Bündeln

- [x] 5.1 `fachebenen.ts`: `KRITIS_MIN_ZOOM`, `mergeFeatures` entfernen; `rasterBbox` rastert mit einer Weite, die mit der bbox-Breite wächst; `FACHEBENEN.kritis` bekommt `aufwaermPollMs` und einen `geltung`-Text (OSM-Daten, wöchentlicher Stand, keine amtliche Liste); Tests in `fachebenen.test.ts` (Raster stabil beim Pannen innerhalb einer Zelle auf Stadt- und DE-Ebene, Aufwärm-Takt für `offline`/`undefined`); verifiziert durch `pnpm vitest run src/pages/lagekarte/fachebenen`
- [x] 5.2 `Kartenflaeche.tsx`/`useFachebenen.ts`/`LagekartePage.tsx`: bbox in jeder Zoomstufe melden, Akkumulation und `kritisZoomZuKlein` samt Hinweis entfernen, KRITIS-Query mit `keepPreviousData` und Aufwärm-Takt; Tests in `useFachebenen.test.tsx` (neue bbox ersetzt statt akkumuliert, Takt bei `offline`); verifiziert durch `pnpm vitest run src/pages/lagekarte`
- [x] 5.3 `fachebenenLayer.ts`: für `kritis` Cluster-Source (`cluster: true`, `clusterProperties.anzahl`) mit Bündel-Kreis, Bündel-Zahl und Einzelpunkt-Layer; Farben aus `theme/tokens.ts`; `entferneFachebeneLayer` räumt alle drei; Tests in `fachebenenLayer.test.ts` gegen eine Map-Attrappe (Source-Optionen, Layer-Filter, idempotentes Anlegen/Entfernen); verifiziert durch `pnpm vitest run src/pages/lagekarte/fachebenenLayer.test.ts`
- [ ] 5.4 Klickweg in `Kartenflaeche.tsx`: Client-Bündel → `getClusterExpansionZoom` + `easeTo`, Server-Sammelpunkt → `easeTo` Zoom + 2, Einzelpunkt → bestehender `onFachebeneKlick`; Glyphen-Quelle für die Bündel-Zahl in Online- und Offline-Style prüfen und ggf. nachziehen; verifiziert durch einen Test des reinen Klick-Entscheiders (Bündel/Sammelpunkt/Einzelobjekt) und die Browser-Prüfung in 6.3

## 6. Doku und Abschluss

- [ ] 6.1 `docs/fachebenen-quellen.md`: KRITIS-Zeile auf Geofabrik-Extrakt umstellen (Quelle, Stand = `Last-Modified`, Intervall, Schalter, Lizenz ODbL, Attribution, Offline-Verhalten), Abschnitt zu Verdichtung und Speicherort; verifiziert durch Lesen des Abschnitts
- [ ] 6.2 Echter Import einmal lokal mit dem vollen DE-Extrakt: Dauer, Spitzen-RSS, Objektzahl je Kategorie und Tabellengröße messen und in 6.1 eintragen; verifiziert durch die eingetragenen Messwerte
- [ ] 6.3 Browser-Prüfung auf der Lagekarte (Dev-Stack mit importiertem Bestand): DE-Ansicht zeigt Bündel mit Zahlen und bleibt bedienbar, Klick auf Bündel zoomt, Klick auf ein Krankenhaus öffnet das Detail-Panel, Attribution sichtbar, Hell/Dunkel; verifiziert durch Screenshots
- [ ] 6.4 Prüfliste Einsatztauglichkeit (15 Kriterien) für die geänderte Ebene ausfüllen; verifiziert durch die ausgefüllte Liste im Change-Ordner
- [ ] 6.5 Voller Gate-Lauf `./scripts/check-all.sh` grün; verifiziert durch Exit-Code 0
