# Tasks

Jede Aufgabe per TDD (`superpowers:test-driven-development`): erst der rote Test, dann der Code.
Abschnittsbezüge D1–D6 auf `design.md`.

## 1. Server: Aufteilen mit Ziel (D1, D2)

- [x] 1.1 `teile_auf_tx` nimmt einen `OrtPatch` und liefert `(neu_id, OrtWechsel)`; Ziel vor dem `INSERT` per `ort::require_ziel_tx` prüfen, danach `ort::set_ort_tx` an der neuen Zeile. Bestehende Aufrufer und Repo-Tests auf `OrtPatch::default()` ziehen. Verifikation: neuer Repo-Test „Aufteilen mit Zielort legt genau eine Zeile am Ziel an, der Rest bleibt am alten Ort“ grün, die bestehenden Aufteilen-Tests in `disposition_repo.rs` unverändert grün (`cargo test material::`).
- [x] 1.2 Repo-Tests für die Grenzen mit Ziel: aufgelöste UHS 422, entlassenes Fahrzeug 409, fremde Einheit 404, `null` am aktuellen Ort → ohne Ort, gleicher Ort → kein Wechsel; nach jeder Ablehnung Ausgangsmenge unverändert und keine neue Zeile. Verifikation: `cargo test material::disposition_repo` grün.

## 2. Server: Route, ETB und Live (D1, D3, D4)

- [x] 2.1 `etb_text_aufgeteilt` um den optionalen Ortswechsel erweitern („…, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“). Verifikation: Unit-Test in `src/material/mod.rs` für beide Formen grün.
- [x] 2.2 `AufteilenBody` um die vier Ort-Felder (`deserialize_optional_field`) erweitern, `OrtPatch::validate` nach der 400-Prüfung, Handler reicht den Patch durch, schreibt genau einen ETB-Eintrag (mit `ort_text_tx` für vorher/nachher bei Wechsel) und meldet zusätzlich `sse_ort` für das Ziel; Doc-Kommentar des Handlers nachziehen. Verifikation: in `tests/einsatz_material.rs` „Aufteilen mit Zielort: Zeile am Ziel, genau ein ETB-Eintrag mit Ortswechsel“, „zwei Orte → 422, nichts geschrieben“, „aufgelöste UHS → 422, nichts geschrieben“ grün; die bestehenden Aufteilen-Tests unverändert grün.
- [x] 2.3 Live-Test: Aufteilen an einen anderen Ort meldet den Ort der Ausgangszeile und das Ziel (bestehendes SSE-Testmuster der Datei). Verifikation: Test grün.

## 3. Frontend: API und Dialog „Aufteilen …“ (D1, D5)

- [x] 3.1 `teileAuf(einsatzId, emId, menge, ort?)` sendet die Ort-Felder nur, wenn `ort` gesetzt ist; `hoechsteMenge` nach `kraefte/materialPosten.ts` ziehen und exportieren. Verifikation: `materialPosten.test.ts` deckt `hoechsteMenge` (Rest, Menge − 1, aufgebraucht) ab und ist grün.
- [x] 3.2 `MaterialAufteilenModal` bekommt das Feld „Ort“ (Optionen und Vorbelegung über Props aus `buildOrtOptions`/`toOrtValue`), `onAufteilen(menge, ortPatch | null)`; Kommentar „Entscheidung 13.10.2026 Nr. 4“ durch Verweis auf diese Change ersetzen. Verifikation: `MaterialAufteilenModal.test.tsx` — Vorbelegung mit dem Ort des Postens, unveränderter Ort sendet keine Ort-Felder, „UHS Turnhalle“ sendet `uhs_id`, „ohne Ort“ sendet das Ort-Feld des bisherigen Orts mit `null`.
- [x] 3.3 `MaterialPage` reicht `ortKontext` an den Dialog, die Mutation sendet den Ort und invalidiert zusätzlich die Liste des Ziels. Verifikation: Fall „20 von 50 an die UHS“ in `MaterialPage.test.tsx` grün (Request-Body mit `menge: 20, uhs_id`).

## 4. Frontend: „Teilmenge hierher“ am Ort (D6)

- [x] 4.1 `useMaterialOrt` bekommt `teileAufNach(p, menge, ziel)` (Aufteilen mit `ortPatch(ziel, ortVon(p))`, Invalidierung wie `setOrt` für alten und neuen Ort). Verifikation: `useMaterialOrt.test.tsx` — Request und invalidierte Schlüssel.
- [x] 4.2 Neuer Dialog „<Bezeichnung> hierher“ (`ErfassungsModal`, Feld „Menge hierher“, vorbelegt mit der ganzen Menge, gültig: ganze Menge oder 1 bis `hoechsteMenge`, Zeile „Danach hier 20, Staffel A 30“). Verifikation: eigene Vitest-Datei — Vorbelegung, Grenzen mit Meldung „1 bis 30 oder alle 50“, Enter auf der Vorbelegung sendet „ganz“.
- [x] 4.3 `MaterialAmOrt`: Wahl eines aufteilbaren Postens öffnet den Dialog; ganze Menge → `setOrt` wie bisher, kleiner → `teileAufNach`; Gerät, Menge 1 und aufgebraucht ohne Dialog; Ablehnung im Dialog. Verifikation: `MaterialAmOrt.test.tsx` — „20 von 50 an die UHS, Rest bleibt am alten Ort“ (Request), „Gerät sofort“, „ganze Menge schickt den PATCH wie bisher“; bestehende Zuordnen-Fälle angepasst und grün; `materialSchreibweg.test.tsx` grün.

## 5. e2e

- [ ] 5.1 `material-liste.spec.ts`: Aufteilen 50 → 30 + 20 mit Ort UHS; danach 30 am alten Ort, 20 an der UHS (Liste und UHS-Bereich „Material“), ein ETB-Eintrag. Verifikation: Spec grün.
- [ ] 5.2 `material-am-ort.spec.ts`: an der UHS „Material zuordnen …“ → Wolldecke, 20 eintragen → UHS zeigt 20, Ausgangsort 30. Verifikation: Spec grün.

## 6. Anwenderdoku (Mitänderungsregel, `docs/anwender/AGENTS.md`)

- [ ] 6.1 `material.md`: Abschnitt „Einen Posten aufteilen“ (Feld „Ort“, kein zweiter Schritt mehr), ETB-Beispiel mit Ortswechsel; Bild `aufteilen.png` neu erzeugen (`pnpm doku:bilder --grep material`). Verifikation: Guard-Test `anwenderdoku.guard.test.ts` grün, Bild zeigt das Feld „Ort“.
- [ ] 6.2 Zuordnen-Abschnitte in `einheiten.md`, `fahrzeuge.md`, `unfallhilfsstellen.md`, `bereitstellungsraeume.md` um die Mengenfrage ergänzen; neue Quellen (`MaterialHierherModal.tsx` o. ä.) in den `quellen:` der Kapitel. Verifikation: Guard-Test grün.

## 7. Abschluss

- [ ] 7.1 `./scripts/check-all.sh` grün (lokal oder der CI-Lauf des PRs).
- [ ] 7.2 Review (`superpowers:requesting-code-review`) ohne offene bestätigte Findings.

## Workflow follow-up

- `/opsx:archive t1hvaqzu-aufteilen-mit-zielort` im selben Branch, vor dem PR (Spec-Sync nach `material-liste`, `material-am-ort`, `material-modell`).
- PR gegen `alpha` mit der Zeile `Zunder: https://zunder.rubeen.dev/#/aufgabe/t1hvaqzuetc7tal6yoagea6z`.
