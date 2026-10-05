# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test,
dann der Code. Gruppe 1–3 bringen das Backend, 4–5 das Frontend, 6 die Gesamtnachweise.
Gates ohne `| tail`, Node und pnpm über `mise exec --`.

## 1. Tabelle, Annahme eines Bildes, Repo (design.md D2, D3, D5)

- [ ] 1.1 Migration `0150_uhs_plan.sql` (Nummer gegen frisches `origin/alpha` prüfen) nach D2 anlegen, mit Kopfkommentar (kein Anhang, Schwärzung `ZeileLoeschen`).
  - Verifiziert durch `scripts/check-migrationen.sh` und `cargo test --lib db::tests`.
- [ ] 1.2 `src/uhs/plan.rs`: `pruefe_bild(bytes) -> GeprueftesBild` (Größe, Format PNG/JPEG/WebP, Bereinigung, Maße, Kantengrenze 10 000 px, sha256) und `raste(v)`, `startlage(plaetze, bild_breite, bild_hoehe)`.
  - Unit-Tests zuerst: PNG/JPEG/WebP angenommen; PDF, GIF, HEIC, leer und 25 MiB + 1 abgelehnt mit dem Fehler nach D3; JPEG mit GPS-EXIF kommt ohne GPS heraus; Maße aus dem Kopf; Kante 10 001 px → 422; `raste(37) = 40`, `raste(-37) = -40`, `raste(35) = 40`; `startlage` ohne Plätze `0/0/820`, mit zehn Rasterplätzen überdeckt sie alle (Rahmen plus 20 px).
  - Verifiziert durch `cargo test --lib uhs::plan`.
- [ ] 1.3 `src/uhs/plan_repo.rs`: `laden_meta`, `laden_bytes`, `hinterlegen_tx` (Upsert: neu mit Startlage, Ersetzen behält Lage und Darstellung), `aendern` (mit Einrasten und Grenzen), `entfernen_tx`.
  - Repo-Tests: Ersetzen behält `x/y/breite/helligkeit`; fremde UHS bzw. fremder Einsatz → 404; `breite` 99 und 5001 → 400; Helligkeit 19/101 und Kontrast 49/151 → 400; Entfernen ohne Plan → 404.
  - Verifiziert durch `cargo test --lib uhs::plan_repo`.

## 2. Routen, Rechte, ETB, Live (design.md D4, D6, D7)

- [ ] 2.1 DTO `UhsPlanAnzeige` und Feld `plan` an `UhsDetail` (`skip_serializing_if`), Eintrag in `src/api_doc.rs`.
  - Verifiziert durch `scripts/check-typ-codegen.sh` (beide generierten Dateien im Commit) und einen Test in `tests/einsatz_uhs.rs`: Detail ohne Plan hat keinen Schlüssel `plan` (`contains_key`), mit Plan die Felder aus D7.
- [ ] 2.2 `src/routes/uhs_plan.rs` mit `hinterlegen` (PUT, Multipart, Scan vor Persist), `aendern` (PATCH), `entfernen` (DELETE), `bild` (GET), Router-Block in `src/app.rs` mit `DefaultBodyLimit::max(26 MiB)` am PUT und `ConcurrencyLimitLayer` am GET.
  - Integrationstests in neuer Datei `tests/uhs_plan.rs`: Upload 200 mit DTO und ETB „UHS BHP 50: Plan hinterlegt“ ohne Dateinamen; Ersetzen; PDF → 400 ohne Zeile; PATCH ohne ETB-Eintrag und mit Einrasten; DELETE mit ETB „Plan entfernt“; Beobachter → 403 auf PUT/PATCH/DELETE, 200 auf GET; stornierte UHS → 409 auf PUT/PATCH/DELETE, GET 200; fremde UHS → 404; GET mit passendem ETag → 304; GET-Antwort `inline`, `nosniff`, `ANHANG_CSP`; zehn GETs lassen `anhang_zugriff_audit` und ETB unverändert; jede schreibende Route publiziert `LiveEvent::Uhs`.
  - Verifiziert durch `cargo test --test uhs_plan`.
- [ ] 2.3 Scan-Fall in `tests/uhs_plan_scan.rs` nach dem Muster `tests/uhs_anhang_scan.rs`: clamd gegen `127.0.0.1:1` → 503, weder Plan noch ETB-Eintrag.
  - Verifiziert durch `cargo test --test uhs_plan_scan` und `cargo test --no-default-features --test uhs_plan`.
- [ ] 2.4 Übernahme `POST …/plan/aus-anhang` mit `support::anhang_bereinigt_kopieren` in `routes/support.rs` (D4).
  - Tests in `tests/uhs_plan.rs`: PNG-Anhang wird Plan, Anhang bleibt in der Liste; genau eine neue Zeile in `anhang_zugriff_audit` (Fassung `bereinigt`, Ablage „UHS BHP 50“); Anhang danach entfernt → Plan bleibt; PDF-Anhang → 422 ohne Audit-Zeile; Anhang einer anderen UHS und entfernter Anhang → 404 ohne Zeile; Beobachter → 403.
  - Verifiziert durch `cargo test --test uhs_plan` und unverändert grünes `cargo test --test anhang_metadaten` (Guard `nur_support_liefert_anhang_bytes_aus`).
- [ ] 2.5 Geräte: `GET …/plan/bild` in `uhs-tablet` und `uhs-laptop`, die vier schreibenden Routen nur in `uhs-laptop` (`src/geraet/mod.rs`).
  - Tests zuerst in `tests/geraet_kopplung.rs`: Tablet liest das Bild der eigenen UHS (200), fremde UHS 404, PUT/PATCH/DELETE/POST abgelehnt; Laptop darf hinterlegen.
  - Verifiziert durch `cargo test --test geraet_kopplung --test geraet_routen_guard`.

## 3. Schwärzung und Dokumentation (design.md D9, D10)

- [ ] 3.1 `TabellenRegel` `uhs_plan` mit `Scoping::EinsatzId`, `ZeileLoeschen`, vor `uhs`; Plan in den Testeinsatz von `schwaerzung_hinterlaesst_keine_altbytes`.
  - Verifiziert durch `cargo test --lib einsatz::schwaerzung_registry einsatz::purge_scheduler` und einen Test, dass nach der Schwärzung kein Plan, aber alle Plätze mit Positionen stehen.
- [ ] 3.2 `src/AGENTS.md`, Abschnitt „Anhänge“: Satz zum UHS-Plan nach D10.
  - Verifiziert durch `scripts/check-fmt.sh`.

## 4. Frontend: Bildebene (design.md D8)

- [ ] 4.1 `api/uhsPlan.ts` mit `ladePlanBild`, `hinterlegePlan`, `uebernehmePlan`, `aenderePlan`, `entfernePlan` und der reinen Funktion `einpassen`; Query-Key in der Registry (`api/queryKeys.ts`, `NICHT_LIVE`).
  - Vitest zuerst: Pfade; `einpassen` liefert für zehn Rasterplätze dieselben Werte wie `startlage` im Server (gleiche Testdaten); Registry-Test bleibt grün.
  - Verifiziert durch `mise exec -- pnpm -C frontend test -- uhsPlan queryKeys`.
- [ ] 4.2 `Grundriss.tsx`: Planebene als erstes Kind der Fläche, Flächengröße mit Plan, Filter nach D8.
  - Vitest zuerst in `Grundriss.test.tsx`: mit Plan steht ein `img` mit `pointer-events: none`, `aria-hidden` und `left/top/width` aus dem DTO vor den Karten; Fläche wächst auf `x + breite`; im hellen Thema Filter nur `brightness/contrast`, im dunklen mit `invert(1) hue-rotate(180deg)` davor, ohne bei `nacht_umkehren: false`; Platzkarte behält deckenden Grund und 140 × 116; ohne Plan kein `img`. Ein Tipp in „komfortabel“ auf einen Platz über dem Plan öffnet das Menü.
  - Verifiziert durch `mise exec -- pnpm -C frontend test -- Grundriss`.

## 5. Frontend: Bedienfeld „Plan“ (design.md D8)

- [ ] 5.1 Knopf „Plan“ in der Kopfzeile der Fläche nur bei `platzEditAktiv`; Seitenpaneel mit Upload, Übernahme aus Dateien (nur Bild-Anhänge, Hinweis auf das Protokoll), Lagefeldern (Schritt 10), Helligkeit, Kontrast, Umkehr-Schalter, „An Plätze einpassen“, „Plan entfernen“ mit roter Rückfrage, Hinweis „Nur Pläne, keine Fotos von Patienten“.
  - Vitest zuerst: Knopf fehlt ohne Schreibrecht, ohne Bearbeiten-Modus und mit `platzBearbeitbar={false}`; Übernahme listet nur PNG/JPEG/WebP-Anhänge; PATCH erst beim Loslassen des Reglers; Einpassen schickt die Werte von `einpassen`; Entfernen fragt vorher.
  - Verifiziert durch `mise exec -- pnpm -C frontend test -- Grundriss UhsPlan`, `mise exec -- pnpm -C frontend lint` und `typecheck`.
- [ ] 5.2 e2e in `frontend/e2e/` (Regeln `frontend/e2e/AGENTS.md`): Plan hochladen, in „Handschuh“ auf einen Platz über dem Plan tippen → Menü; Plätze verschieben, einpassen; Seite neu laden → kein neuer Eintrag in „Zugriffe“.
  - Verifiziert durch den e2e-Lauf dieser Spec.

## 6. Gesamtnachweise

- [ ] 6.1 Mutationsproben: (a) Audit-Zeile in der Übernahme entfernt → Test „genau eine Zeile“ rot; (b) `pointer-events: none` entfernt → Vitest der Bildebene rot; (c) Stornoprüfung im PATCH entfernt → 409-Test rot. Ergebnis im Commit-Text.
  - Verifiziert durch die drei roten Läufe vor dem Zurücknehmen.
- [ ] 6.2 `./scripts/check-all.sh` grün (umgebungsbedingte Schritte gegen `alpha` gegengeprüft).
  - Verifiziert durch den Exit-Code bzw. die CI des PRs.
