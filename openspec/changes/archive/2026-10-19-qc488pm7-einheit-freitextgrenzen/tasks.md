# Tasks

## 1. Backend

- [x] 1.1 Rust-Test in `tests/einsatz_einheit.rs` je Feld (Bemerkung 2 001, Funkrufname 201, Erreichbarkeit 201): POST → 400, keine Einheit, kein ETB-Eintrag; PATCH → 400, Wert unverändert; genau an der Grenze → gespeichert. Erst rot sehen (`cargo test --test einsatz_einheit freitext`).
- [x] 1.2 `einheit::FUNKRUFNAME_MAX` und `einheit::ERREICHBARKEIT_MAX` (je 200) anlegen, Doku an `BEMERKUNG_MAX` nachziehen; `bilden` und `update` prüfen mit `optional_max`/`optional_max_tri` vor dem ersten 409/422 (design.md D2). Test aus 1.1 grün.

## 2. Spiegel

- [x] 2.1 `EINHEIT_FUNKRUFNAME_MAX` und `EINHEIT_ERREICHBARKEIT_MAX` in `frontend/src/api/eingabegrenzen.ts`, Paare in `tests/eingabegrenzen_spiegel.rs`; `cargo test --test eingabegrenzen_spiegel` grün.

## 3. Einheit-Ansicht

- [x] 3.1 Vitest: Funkrufname und Erreichbarkeit tragen `maxLength` der Grenze; eine Bemerkung über der Grenze zeigt die Überlänge und sendet keinen PATCH. Erst rot sehen.
- [x] 3.2 `EinheitKopf` (Funkrufname `maxLength`, Bemerkung `zeichenGrenze` + `pruefe`) und `EinheitFunk` (Erreichbarkeit `maxLength`) umsetzen (design.md D3); Vitest aus 3.1 grün.

## 4. Abschluss

- [x] 4.1 `./scripts/check-all.sh` grün (lokal `--geaendert` vor dem PR, voll in der CI des PRs).
