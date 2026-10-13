# Tasks

## 1. Backend: Lesepfad `GET /api/einsaetze/{id}/modul-vorgaben`

- [ ] 1.1 Tests zuerst (rot) in `tests/modul_override.rs`: Einsatzleitung ohne Org-Rolle bekommt 200 mit Rolle und `sichtbar: false` aus der Org-Vorgabe; dieselbe Person bekommt auf `GET /api/org-modul-einstellungen` weiter 403; Nicht-Mitglied ohne Org-Rolle 403; System-Admin einer fremden Org ohne Mitgliedschaft 403; fremde Einsatzleitung (Mitglied) 200 mit den Vorgaben der Einsatz-Org; Admin der Org bekommt dieselbe Antwort wie am Org-Endpunkt. Prüfen: `cargo test --test modul_override modul_vorgaben` scheitert am fehlenden Pfad.
- [ ] 1.2 Handler `modul_vorgaben_laden` in `src/routes/einsatz.rs` (`EinsatzLesezugriff`, zusätzliches Gate aus design.md D2, `modul_einstellung::laden_alle(einsatz.org_id)`), Route in `src/app.rs`, `PFAD_KEY`-Eintrag modul-los in `src/einsatz/modul.rs`, Pfad in `src/api_doc.rs`. Prüfen: die Tests aus 1.1 sind grün, der `PFAD_KEY`-Guard ebenso.
- [ ] 1.3 Gerät: Test, dass ein gekoppeltes Gerät 403 bekommt (Muster der Geräte-Tests). Prüfen: `cargo test` des betreffenden Testmoduls grün.
- [ ] 1.4 `scripts/check-typ-codegen.sh` laufen lassen und die generierten Dateien mitcommitten, falls sie sich ändern. Prüfen: das Skript ist grün.

## 2. Frontend: Editor „Module“ liest die Vorgaben am Einsatz

- [ ] 2.1 `ladeModulVorgaben(einsatzId)` in `api/einsaetze.ts`, Key `einsatzKeys.modulVorgaben` in `api/queryKeys.ts`, in `NICHT_LIVE_KEYS` samt Begründung im Kommentar. Prüfen: `queryKeys.guard.test.ts` grün.
- [ ] 2.2 Test zuerst (rot): Editor „Module“ zeigt bei einer Einsatzleitung, deren Org-Endpunkt 403 liefert, „Vorgabe der Organisation: Führung im Einsatz“ und bei eigenem Wert „Vorgabe der Organisation: ausgeblendet“ samt „Vorgabe übernehmen“. Danach `EinsatzModule.tsx` auf `modulVorgaben` umstellen, Kopfkommentar und `orgBlendetAus`-Kommentar nachziehen. Prüfen: Vitest der Seite grün.
- [ ] 2.3 `EinsatzDefaults.tsx`: nach dem Speichern einer Modul-Vorgabe den Präfix `einsatz-modul-vorgaben` invalidieren; Test dafür. Prüfen: Vitest grün.

## 3. Doku und Abschluss

- [ ] 3.1 `docs/anwender/kapitel/einsatz-einstellungen.md` gegen das neue Verhalten lesen (Mitänderungsregel `docs/anwender/AGENTS.md`); die Hinweise stehen dort schon ohne Einschränkung, Änderung nur falls nötig. Prüfen: Abschnitt „Woher ein Wert kommt“ stimmt mit der Spec überein.
- [ ] 3.2 `./scripts/check-all.sh` grün (bzw. die CI des PRs belegt es).

## Workflow follow-up

- `/opsx:archive` im selben Branch vor dem PR, Spec `modul-freigabe` fortschreiben.
- PR gegen `alpha`, Zunder LLH-1183 auf `review`.
