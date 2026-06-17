# Task-5-Report: HTTP-Routen + ETB + SSE (LFH-14)

**Status:** DONE

**Commit:** `62be1ce feat(br): HTTP-Routen + ETB + SSE (LFH-14)`

## Tests

- `cargo test --test einsatz_bereitstellungsraum`: **15/15 grün**
- `cargo test --test einsatz_uhs` (Regression): **28/28 grün**

## Umgesetzt

**Neue Dateien:**
- `src/routes/einsatz_bereitstellungsraum.rs` — 7 Handler (liste, anlegen, detail, aktualisieren, status_wechsel, stornieren, belegung)
- `tests/einsatz_bereitstellungsraum.rs` — 15 HTTP-Integrationstests

**Geänderte Dateien:**
- `src/routes/mod.rs` — `pub mod einsatz_bereitstellungsraum;` ergänzt
- `src/app.rs` — 7 Routen nach den UHS-Routen registriert

## Detail-Entscheidungen

- `BrDetail` = `#[serde(flatten)] BrAnzeige` + `einheiten: Vec<BrEinheitKurz>` + `fahrzeuge: Vec<BrFahrzeugKurz>`, jeweils via `aktueller_br_id`-Cache aus `einsatz_einheit`/`einsatz_fahrzeug`.
- ETB **nicht pseudonym** (reale Namen): `einsatz_einheit.name` bzw. `einsatz_fahrzeug.snap_funkrufname`. Belegungs-ETB-Text wird nach dem Event geladen (kein "vorher"-Dance nötig).
- `sse_br` → `publiziere_event(einsatz_id, "bereitstellungsraum", data)` — keine Änderung an `src/live`.
- Kein Stream-Endpunkt (gemeinsamer Einsatz-Stream; Memory-Note "eine Verbindung pro Einsatz").
- Status-Übergangsprüfung (`darf_uebergehen`) bereits im Repo — der Handler delegiert.
- Stornierter BR wird auf Schreiboperationen mit 409 abgelehnt (analog UHS).

## Concerns

- **Spec-Datei fehlt:** `docs/superpowers/specs/2026-06-17-kraefte-bereitstellungsraum-design.md` existiert nicht. ETB-Texte und Route-Pfade wurden aus dem Task-Brief und dem UHS-Muster abgeleitet. ETB-Tests prüfen Substrings (BR-Bezeichnung + Objekt-Name), nicht Exakt-Wortlaut.

---

## Fix-Runde (Review-Findings)

**Status:** DONE

**Findings adressiert:**
- **Finding 1 (SSE):** Im `belegung`-Handler wird nach `belege(...)` zusätzlich ein objekt-typ-spezifisches SSE-Event gefeuert — `"einheit"` bzw. `"fahrzeug"` (Payload `{einsatz_id, objekt_id}`), analog `sse_person` in UHS. Damit refetchen die Kräfte-Ansichten live.
- **Finding 2 (ETB-Objektname):** `belegungs_etb_text` nutzt jetzt `.ok_or(AppError::NotFound)?` statt `unwrap_or_default()` — kein leerer Name mehr im ETB-Text bei inkonsistentem Zustand.
- **Finding 3 (Testlücken):** Zwei HTTP-Tests ergänzt: `wechsel_verschiebt_einheit_zwischen_br` (Einheit A→B, Detail B zeigt sie, A nicht) und `belegung_unbekanntes_objekt_404`.
- Zusätzlich zwei gezielte SSE-Verifikationstests (`belegung_einheit_feuert_einheit_sse`, `belegung_fahrzeug_feuert_fahrzeug_sse`) via `setup_mit_live`-Harness, die den `LiveHub` abonnieren und das objekt-Event prüfen.

ETB-Textformat-Finding (Minor) bewusst NICHT geändert.

**Tests:**
- `cargo test --test einsatz_bereitstellungsraum`: **19/19 grün** (15 aus Task 5 + 4 neue: `wechsel_verschiebt_einheit_zwischen_br`, `belegung_unbekanntes_objekt_404`, `belegung_einheit_feuert_einheit_sse`, `belegung_fahrzeug_feuert_fahrzeug_sse`)
- `cargo test --test einsatz_uhs` (Regression): **28/28 grün**
