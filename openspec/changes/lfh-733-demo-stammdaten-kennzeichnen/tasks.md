# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote
Test, dann der Code. Rust-Gates je Aufgabe gescopt (`cargo test --lib …`, `--test …`),
Frontend-Aufgaben mit der vollen Vitest-Suite, weil Guards sonst durchrutschen.

## 1. Backend: Feld `demo` im Lese-Vertrag (D2, D3)

- [x] 1.1 Fahrzeug: abgeleitete Spalte `EXISTS (… demo_herkunft … 'fahrzeug' …) AS demo` in `SPALTEN` (`src/fahrzeug/repo.rs`), Feld `demo: bool` in `Fahrzeug` und `FahrzeugAnzeige`, `anzeige()` reicht es durch. Vorher prüfen, dass jede Abfrage über `SPALTEN` `FROM fahrzeug` ohne Alias liest. Verifiziert durch Repo-Tests: Zeile mit Marke → `liste` und `laden` liefern `demo = true`, Zeile ohne Marke → `false`, und einen Routen-Test in `tests/fahrzeug.rs`: `GET /api/fahrzeuge`, die Antwort auf `PATCH /api/fahrzeuge/{id}` und auf `POST …/ausser-dienst` tragen für eine von Hand markierte Zeile `demo: true`
- [x] 1.2 Personal: dasselbe in `src/personal/{mod,repo}.rs` (`'personal'`), `liste_anzeige` reicht das Feld durch. Verifiziert durch Repo-Tests wie 1.1 und einen Routen-Test in `tests/personal.rs` für Liste und `PATCH`
- [x] 1.3 Material: dasselbe in `src/material/{mod,repo}.rs` (`'material'`). Verifiziert durch Repo-Tests wie 1.1 und einen Routen-Test in `tests/material.rs` für Liste, `PATCH` und `POST …/ausser-dienst`
- [x] 1.4 Szenarien aus dem Demo-Ablauf in `tests/demo_daten.rs`: nach dem Import tragen angelegte Zeilen `demo: true` und mitbenutzte `demo: false`; ein in einem echten Einsatz disponiertes Demo-Fahrzeug trägt nach dem Entfernen `demo: false`; eine markierte Zeile liest ein Server ohne Freischaltung weiter als `demo: true`. Verifiziert durch die grünen Tests und eine Mutationsprobe (`tabelle`-Literal im Fahrzeug-`SPALTEN` auf `'personal'` gedreht → mindestens ein Test rot)
- [x] 1.5 Codegen: `scripts/check-typ-codegen.sh`, `frontend/src/api/openapi.json` und `frontend/src/api/types.generated.ts` mitcommitten, Fixtures mit vollständigen `Fahrzeug`/`Personal`/`Material`-Objekten um `demo: false` ergänzen. Verifiziert durch das grüne Codegen-Skript und `mise exec -- pnpm -C frontend typecheck`

## 2. Frontend: Marke in Katalogen, Detailseiten, Auswahllisten (D4, D5)

- [x] 2.1 `components/DemoMarke.tsx` mit `DEMO_MARKE = { rolle: 'neutral', label: 'Demo' }` über `StatusTag` in der Rand-Form, Dateikopf nennt LFH-733 und WCAG 1.4.1. Verifiziert durch einen Komponententest (Wortlaut „Demo“ sichtbar und zugänglich) und die unverändert grünen `theme/statusFarben.test.ts` (dreißig Karten) und `theme/statusVertrag.guard.test.ts`
- [x] 2.2 Kataloge: `stammdaten/FahrzeugeTab.tsx`, `PersonalTab.tsx`, `MaterialTab.tsx` zeigen `DemoMarke` neben der Kennung, nur bei `demo: true`. Verifiziert durch je einen Test im zugehörigen `*.test.tsx`: eine Zeile mit und eine ohne Marke, „Demo“ steht nur in der ersten
- [x] 2.3 Detailseiten: `stammdaten/FahrzeugDetailPage.tsx` und `PersonalDetailPage.tsx` zeigen `DemoMarke` im Kopf. Verifiziert durch je einen Test im zugehörigen `*.test.tsx` (mit Marke sichtbar, ohne nicht)
- [x] 2.4 Reine Funktion in `stammdaten/demoMarke.ts`: hängt „ · Demo“ an das Label einer markierten Option und sortiert stabil um (ohne Marke zuerst, Serverreihenfolge in beiden Gruppen). Verifiziert durch Unit-Tests: Wortlaut, Reihenfolge mit gemischter Eingabe, Eingabe ohne Marke unverändert (Identität von Wortlaut und Reihenfolge)
- [x] 2.5 Auswahllisten: `pages/FahrzeugePage.tsx`, `PersonalPage.tsx` und `MaterialPage.tsx` bauen ihre Stammdaten-Optionen über die Funktion aus 2.4. Verifiziert durch je einen Test im zugehörigen `*.test.tsx`: das Demo-Element steht mit „Demo“ hinter allen anderen, Tippen von „Demo“ behält jede markierte Option und eine unmarkierte nur mit „Demo“ im eigenen Wortlaut, „· Demo“ lässt genau die markierten übrig (an einer Seite), und nach der Wahl zeigt das geschlossene Feld den Wortlaut samt „Demo“ (an einer Seite)

## 3. Regel und Abschluss

- [x] 3.1 `src/AGENTS.md`, Abschnitt „Backend — Demo-Daten zur Laufzeit“: die Zeile „das Frontend liest nur `GET /api/demo-daten`“ richtigstellen. Die Regel (Marke beim Lesen aus `demo_herkunft`, keine Spalte; die Oberfläche kennzeichnet Demo-Stammdaten und blendet sie nie aus) steht als Block mit Client-Anteil einmal in `frontend/AGENTS.md`, Bedien-Leitlinie; der Kopf von `src/AGENTS.md` verweist dorthin. Verifiziert durch `scripts/check-fmt.sh` und einen Grep, dass kein anderer Verweis auf den alten Wortlaut bricht
- [ ] 3.2 `./scripts/check-all.sh` grün (ohne `| tail`). Verifiziert durch den Lauf bzw. die CI des PRs
