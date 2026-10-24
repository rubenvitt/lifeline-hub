# Tasks

## 1. Rote Tests für die neue Regel

- [ ] 1.1 In `tests/einsatz_material.rs` einen Test für das Scenario „Frühere Einheiten-Route“ schreiben: `PUT` und `DELETE` auf `…/einheiten/{eid}/material/{em}` antworten 404, der Posten bleibt ohne bzw. an seinem Ort, kein neuer System-ETB-Eintrag. Verifizieren: `cargo test --test einsatz_material` zeigt ihn rot (heute 204)
- [ ] 1.2 In `tests/einsatz_material.rs` einen Test für das Scenario „Einheiten-Recht ohne Freigabe Material“ schreiben: Modul `material` per `modul-overrides` ausgeblendet, Person mit Rolle `fuehrungspersonal`, PATCH mit `einheit_id` ist 403 und der frühere `PUT` 404, der Posten bleibt ohne Ort. Verifizieren: rot wegen des `PUT` (heute 204)

## 2. Routen entfernen

- [ ] 2.1 Die beiden Routen aus `src/app.rs` und `material_zuordnen`, `material_freigeben`, `set_material_ort` samt unbenutzter Imports aus `src/routes/einsatz_einheit.rs` entfernen. Verifizieren: `cargo build` ohne Warnung, die Tests aus 1.1 und 1.2 grün
- [ ] 2.2 Backend-Tests umstellen (design.md D3): `tests/einsatz_einheit.rs` (Listenabruf, `material_umhaengen_nennt_die_alte_einheit`) und `tests/einsatz_material.rs` (`in_einheit`, LFH-66-Event-Test, `material_einheit_zuordnen_freigeben_und_aufloesen`, Schleife „beendet ist 409“) auf den PATCH. `fremde_em_id_an_einheit_ist_404` entfernen, wenn ein PATCH-Test die unbekannte `em_id` mit 404 belegt, sonst umstellen. Verifizieren: `cargo test --test einsatz_einheit --test einsatz_material` grün, kein Treffer mehr für `einheiten/{eid}/material` bzw. `einheiten/{einheit}/material` unter `tests/`
- [ ] 2.3 `scripts/check-typ-codegen.sh` laufen lassen. Verifizieren: kein Diff an den generierten Dateien

## 3. Frontend nachziehen

- [ ] 3.1 `frontend/e2e/meldebild-druck.spec.ts` und `frontend/e2e/trefflaeche-pruefflaechen.spec.ts`: die Vorbereitung „Material an die Einheit“ über `PATCH …/material/{id}` mit `{ einheit_id }`. Verifizieren: kein Treffer mehr für `einheiten/…/material` unter `frontend/e2e/`, `tsc` und ESLint der e2e-Dateien grün, beide Specs laufen, soweit die Umgebung Playwright gegen den Dev-Stack erlaubt
- [ ] 3.2 Kommentar in `frontend/src/api/einsatzMaterial.ts` nachziehen: die Einheiten-Routen gibt es nicht mehr (LLH-1253). Verifizieren: Prettier grün

## 4. Gesamtprüfung

- [ ] 4.1 `./scripts/check-all.sh` grün (lokal oder über die CI des PRs)

## Workflow follow-up

- Review (`superpowers:requesting-code-review`), dann `/opsx:archive` im selben Branch vor dem PR.
- PR gegen `alpha` mit Plan, Umsetzung und Archiv zusammen.
