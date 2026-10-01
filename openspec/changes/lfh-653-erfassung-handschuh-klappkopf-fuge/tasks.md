# Tasks

## 1. Fußabstand der Erfassungs-Hülle (D3)

- [x] 1.1 `components/Erfassung.tsx` in `MIT_NACHBARSCHAFT` von `components/aktionsabstand.guard.test.ts` aufnehmen (mit Kommentar: Primärknopf `danger={unumkehrbar}` neben „Abbrechen“). Prüfen: Guard rot mit Befund an der Knopf-`<Space>` der Hülle
- [x] 1.2 Die Knopf-`<Space>` in `components/Erfassung.tsx` auf `size="middle"` setzen und den Dateikopf um den Abstand ergänzen. Prüfen: Guard grün, `Erfassung.test.tsx` grün

## 2. Klappkopf über den Kontext (D1)

- [x] 2.1 Test in `theme/tokens.test.ts`: `antdKlappkopf('kompakt' | 'komfortabel' | 'handschuh')` liefert `styles.header` mit `minHeight` 30 / 48 / 72 (Literale) und `alignItems: 'center'`. Prüfen: rot, weil die Funktion fehlt
- [x] 2.2 `antdKlappkopf(dichte)` in `theme/tokens.ts` umsetzen (rein, exportiert, Doku-Kommentar mit Bezug LFH-653/LFH-365 und den antd-Messwerten 36 / 45 / 55). Prüfen: Test aus 2.1 grün
- [x] 2.3 Vor dem Verdrahten `grep -n -A6 '<Collapse' frontend/src` auf lokale `styles=`/`size=` durchsehen und Treffer im Commit vermerken. Prüfen: Liste steht in der Commit-Nachricht
- [x] 2.4 Test in `theme/ThemeModeProvider.test.tsx`: in `handschuh` gerendertes `Collapse` trägt am Kopf `min-height: 72px` und `align-items: center`. Danach `collapse={…}` im `ThemeModeProvider` neben `button={knopf}` verdrahten (memoisiert wie `knopf`). Prüfen: erst rot, dann grün

## 3. antds eigene Füße (D4, revidiert 01.10.2026)

Die erste Fassung (Komponenten-Token `marginXS`) war umgesetzt, griff im Browser aber nicht
(Blase in `handschuh` 7 px; Begründung in `design.md`, D4, Alternativen). Sie wird hier
zurückgebaut.

- [x] 3.1 `Modal`/`Popconfirm`-Overrides (`antdFussfuge`) aus `antdKomponenten` in `theme/tokens.ts` entfernen, dazu ihre Tests in `theme/tokens.test.ts` („Fußfuge der antd-Füße …“) und `theme/ThemeModeProvider.test.tsx` („… bis in den CSS-Text“, Fehlbeleg). Prüfen: theme-Suite grün, `grep -n antdFussfuge frontend/src` leer
- [x] 3.2 Quelltext-Test in `theme/tokens.test.ts` (Muster „Radio-Knopf: Text in bedienText“): `index.css` trägt eine Regel mit den drei Fußselektoren aus D4 (je mit `:root`-Präfix) und `margin-inline-start: var(--ant-padding)`. Prüfen: rot
- [x] 3.3 Die Regel aus D4 mit Kommentar (warum Stilregel statt Token, warum `:root`) in `frontend/src/index.css` umsetzen. Prüfen: 3.2 grün; e2e „Dichte-Staffel …“ misst die Fuge der Blase ≥ 16 in `handschuh` und ≥ 8 in `komfortabel`

## 4. Nachweis im Browser

- [x] 4.1 `e2e/dokumente.spec.ts` „Dichte-Staffel …“: Klappkopf „Bezug (optional)“ ≥ `soll` zusichern; Fuge Abbrechen │ Ablegen ≥ 16 in `handschuh`, ≥ 8 in `komfortabel` zusichern (Böden als Literale in `STAFFEL`), `kompakt` weiter annotiert; den Kommentar „NUR GEMESSEN“ anpassen. Prüfen: die drei Tests grün
- [x] 4.2 Im selben Test die Bestätigungsblase „Dokument … entfernen“ öffnen und die Fuge zwischen ihren zwei Knöpfen mit denselben Böden zusichern; Messwert in die Annotation. Prüfen: grün in allen drei Stufen
- [x] 4.3 Mutationsprobe „Stufe festgenagelt → rot“: in `antdKlappkopf` `dichten.kompakt` statt `dichten[dichte]` und in der Regel aus D4 `11px` statt `var(--ant-padding)` einsetzen, e2e aus 4.1/4.2 und die Unit-Tests laufen lassen. Erwartet: `komfortabel`/`handschuh` rot. Zurückdrehen, Ergebnis hier vermerken — **Ergebnis 01.10.2026:** beide Mutationen zusammen: Unit 3 rot (Klappkopf-Literale, Verdrahtung `handschuh`, Quelltext der Fußregel), e2e rot in `dokumente` komfortabel (Klappkopf 45 < 48) und handschuh (55 < 72) sowie im Standardfuß handschuh (Fuge 11 < 16); nur die CSS-Mutation: Rückfrage-Fuge handschuh 11 < 16 rot. `kompakt` blieb grün, wie erwartet. Zurückgedreht, alles wieder grün
- [x] 4.5 (Nachtrag, Lücke im Plan) Neues `e2e/dialogfuss-dichte.spec.ts` für das Spec-Szenario „Dialog mit Standardfuß“: „Neue Ansicht“ auf der Lagekarte, Fuge ≥ 8 / ≥ 16, Knöpfe ≥ Steuerhöhe, Titelabstand unverändert 3 / 5 / 7 (Literale). Gemessen: Fuge 11 / 18 / 26, Knöpfe 30 / 48 / 72, Titelabstand 3 / 5 / 7. `modal.confirm` ist im e2e nicht erreichbar (nur nach 409-Konflikt); sein Selektor ist im Quelltext-Test aus 3.2 festgehalten
- [x] 4.4 Die übrigen e2e-Specs mit `Collapse` oder Rückfrage im Ablauf laufen lassen (mindestens `dokumente`, `gate3-trefflaeche`, `trefflaeche-tablet`, `personen-aufnahme`, `stab-checkliste`). Prüfen: grün — **Ergebnis 01.10.2026:** 86 von 87 grün (dazu `betreuung-pruefliste`, `lagekarte-leiste-dichte`, `dialogfuss-dichte`). Rot nur `gate3-trefflaeche` „Führungsfunktionen: der Bearbeiten-Knopf je Zeile …“ (0 statt 9 Knöpfe, Liste bleibt im Ladezustand) — **ebenso rot mit `frontend/src` auf `origin/alpha`**, also nicht von dieser Change; Klärung über die CI des PRs

- [x] 4.6 (Review-Befunde) Kommentar über der Rückfrage-Messung in `e2e/dokumente.spec.ts` auf die Regel in `src/index.css` richten; Spec-Szenario „Kompakt wird nicht gekürzt“ zusichern: Klappkopf in `kompakt` ≥ 36 px (Literal, Stand vor der Änderung). Prüfen: e2e „Dichte-Staffel …“ grün; Mutation `minHeight` 30 + Polsterung auf `controlHeight` gerechnet würde 30 messen und rot werden — **Ergebnis:** e2e drei Stufen grün (36 / 48 / 72); Mutation `paddingBlock: 0` am Kopf → `kompakt` 30 < 36 rot, zurückgedreht

## 5. Regeln und Doku

- [x] 5.1 `frontend/AGENTS.md`: im Abschnitt „Tabelle und Dichte“ den Klappkopf-Boden über `antdKlappkopf` nennen; bei „Rot steht nicht bündig neben Neutralem“ die Fußfuge der Erfassungs-Hülle und der antd-Füße (Stilregel in `index.css`, Modal/`modal.confirm`/Popconfirm) nennen. Prüfen: `prettier --check` auf `frontend/` grün
- [x] 5.2 `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: Zeile 2 · 2 und Kriterium 2 der Fläche Dialog auf „erfüllt“ mit den neuen Messwerten und Verweis auf diese Change. Prüfen: die Messwerte stimmen mit der e2e-Annotation aus 4.1/4.2 überein

## 6. Gate

- [ ] 6.1 `./scripts/check-all.sh` (ohne `| tail`) läuft grün durch. Prüfen: Exit-Code 0
