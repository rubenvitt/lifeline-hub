# Tasks

Jede Aufgabe mit Verhaltensänderung entsteht per TDD: zuerst der Test, der ohne die Änderung rot
ist. Pfade im Frontend relativ zu `frontend/src/`.

## 1. Backend: Vorzustand und Rücknahme

- [x] 1.1 `src/material/mod.rs`: `MaterialEntlassungVorzustand` (D1), `MaterialEntlassungAntwort`, `MaterialRuecknahmeAntwort` (mit `fahrzeug::RuecknahmeAusgelassen`), Prüfung „höchstens eine Ortsspalte“ (422) und `etb_text_herausnahme_zurueckgenommen`; Unit-Tests für ETB-Text und Prüfung rot→grün
- [x] 1.2 `src/material/disposition_repo.rs`: `Entlassen::vorzustand(entlassen_at)` aus dem gelösten Ort; Repo-Test „Vorzustand nennt den Ort davor“ rot→grün
- [x] 1.3 `zuruecknehmen_tx` (D2): Riegel (Art, Person, `entlassen_at`, Frist), Endzustand aufheben mit `disponiert_at`, Menge, Status und Storno-Sperre unverändert, Ort über `ort::set_ort_tx`; Repo-Tests: Rückgängig stellt Ort und Dispositionszeit her; Storno danach gesperrt; 409 nach Reaktivieren, für andere Person, nach Ablauf der Frist, bei zweiter Rücknahme
- [x] 1.4 `zuruecknehmen_tx`: ausgelassener Ort je Art (Einheit aufgelöst, Fahrzeug entlassen, UHS/Raum nicht mehr aktiv) → aktiv ohne Ort mit Eintrag in `ausgelassen`; bestimmtes Stück inzwischen in anderer Zeile aktiv → 409 ohne Änderung; Repo-Tests rot→grün
- [x] 1.5 Route `POST …/material/{em_id}/entlassen/zuruecknehmen` in `src/routes/einsatz_material.rs` und `src/app.rs` (Gate `EinsatzSchreibzugriff<Material>`, ETB, `sse_material` + `sse_ort`); `…/entlassen` antwortet `{ material, vorzustand }`; Doc-Kommentare beider Routen und von `reaktivieren` berichtigen; `src/api_doc.rs` um Route und Typen
- [x] 1.6 Integrationstest in `tests/einsatz_material.rs`: Herausnehmen und Rückgängig vergleicht Ort, Menge, Status, `disponiert_at` und ETB; 409 für andere Person; Fahrzeug inzwischen entlassen → `ausgelassen`, Posten ohne Ort
- [x] 1.7 Typ-Codegen (`scripts/check-typ-codegen.sh`), `api/openapi.json` und `api/types.generated.ts` mitcommitten

## 2. Frontend: Rückgängig nimmt vollständig zurück

- [ ] 2.1 `kraefte/ruecknahme.ts` mit `ausgelassenSatz(name, ausgelassen)` (D4) samt Test; `pages/FahrzeugePage.tsx` darauf umstellen, ihr Export entfällt; `pages/FahrzeugePage.test.tsx` grün
- [ ] 2.2 `api/einsatzMaterial.ts`: `nimmAusDemEinsatz` liefert `MaterialEntlassungAntwort`, neu `nimmHerausnahmeZurueck`; Doc-Kommentare berichtigen
- [ ] 2.3 `pages/MaterialPage.tsx`: Rückgängig aus dem Hinweis ruft die Rücknahme mit dem Vorzustand, invalidiert Liste und Einheiten, `ausgelassen` als `SeitenHinweis`; Kommentar an `herausnehmenMutation` berichtigen; Tests in `pages/MaterialPage.test.tsx` („bietet Rückgängig an“ ruft die Rücknahme mit dem Vorzustand, „nennt den ausgelassenen Ort“, „scheitert Rückgängig …“) rot→grün

## 3. Regel und Doku

- [ ] 3.1 `frontend/AGENTS.md`, „Beenden: Verb, Ort und Sicherung je Art“: Material aus der bekannten Lücke streichen (Personal, LLH-1922, bleibt), Material neben dem Fahrzeug als vollständig zurücknehmend nennen; Prettier grün
- [ ] 3.2 `docs/anwender/kapitel/material.md`, „Material aus dem Einsatz nehmen“: Rückgängig bringt den Posten an seinen Ort zurück, ein nicht mehr bestehender Ort wird genannt; Mitänderungsregel aus `docs/anwender/AGENTS.md` prüfen (kein Bild ändert sich)

## 4. Verifikation

- [ ] 4.1 `./scripts/check-all.sh --geaendert --ohne-e2e` grün

## Workflow follow-up

- Review vor dem PR (`dev-zunder-ausfuehren`, „Review vor dem PR“), bestätigte Befunde behandeln.
- `/opsx:archive nw7tvxsj-material-herausnahme-zuruecknehmen` im selben Branch, Verweise nachziehen.
- PR gegen `alpha` mit Bildern der Materialseite und Abschnitt „Review“.
