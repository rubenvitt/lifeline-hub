# Tasks

## 1. Fußabstand der Erfassungs-Hülle (D3)

- [x] 1.1 `components/Erfassung.tsx` in `MIT_NACHBARSCHAFT` von `components/aktionsabstand.guard.test.ts` aufnehmen (mit Kommentar: Primärknopf `danger={unumkehrbar}` neben „Abbrechen“). Prüfen: Guard rot mit Befund an der Knopf-`<Space>` der Hülle
- [x] 1.2 Die Knopf-`<Space>` in `components/Erfassung.tsx` auf `size="middle"` setzen und den Dateikopf um den Abstand ergänzen. Prüfen: Guard grün, `Erfassung.test.tsx` grün

## 2. Klappkopf über den Kontext (D1)

- [x] 2.1 Test in `theme/tokens.test.ts`: `antdKlappkopf('kompakt' | 'komfortabel' | 'handschuh')` liefert `styles.header` mit `minHeight` 30 / 48 / 72 (Literale) und `alignItems: 'center'`. Prüfen: rot, weil die Funktion fehlt
- [x] 2.2 `antdKlappkopf(dichte)` in `theme/tokens.ts` umsetzen (rein, exportiert, Doku-Kommentar mit Bezug LFH-653/LFH-365 und den antd-Messwerten 36 / 45 / 55). Prüfen: Test aus 2.1 grün
- [x] 2.3 Vor dem Verdrahten `grep -n -A6 '<Collapse' frontend/src` auf lokale `styles=`/`size=` durchsehen und Treffer im Commit vermerken. Prüfen: Liste steht in der Commit-Nachricht
- [x] 2.4 Test in `theme/ThemeModeProvider.test.tsx`: in `handschuh` gerendertes `Collapse` trägt am Kopf `min-height: 72px` und `align-items: center`. Danach `collapse={…}` im `ThemeModeProvider` neben `button={knopf}` verdrahten (memoisiert wie `knopf`). Prüfen: erst rot, dann grün

## 3. antds eigene Füße (D4)

- [ ] 3.1 Test in `theme/tokens.test.ts`: `antdKomponenten(…).Modal.marginXS` und `.Popconfirm.marginXS` = 11 / 18 / 26, `.Modal.headerMarginBottom` = 3 / 5 / 7 (Literale), dazu die Ungleichungen ≥ 16 in `handschuh` und ≥ 8 in `komfortabel`. Prüfen: rot
- [ ] 3.2 Test in `theme/ThemeModeProvider.test.tsx` (Muster „Switch folgt der Staffel bis in den CSS-Text“): in `handschuh` ein offenes `<Modal>` mit Standardfuß und ein offenes `Popconfirm` rendern. Das erzeugte CSS ihrer `css-var-…`-Klasse trägt `marginXS` = 26 px. Prüfen: rot
- [ ] 3.3 `Modal`/`Popconfirm` in `antdKomponenten` ergänzen (Kommentar: welche antd-Regeln das trifft, welche Nebenwirkungen hingenommen sind, warum `headerMarginBottom` gepinnt ist). Prüfen: 3.1 und 3.2 grün. Bleibt 3.2 rot, weil die Überschreibung im cssVar-Modus nicht greift: anhalten, Rückweg D über `/opsx:update` mit dem Menschen klären

## 4. Nachweis im Browser

- [ ] 4.1 `e2e/dokumente.spec.ts` „Dichte-Staffel …“: Klappkopf „Bezug (optional)“ ≥ `soll` zusichern; Fuge Abbrechen │ Ablegen ≥ 16 in `handschuh`, ≥ 8 in `komfortabel` zusichern (Böden als Literale in `STAFFEL`), `kompakt` weiter annotiert; den Kommentar „NUR GEMESSEN“ anpassen. Prüfen: die drei Tests grün
- [ ] 4.2 Im selben Test die Bestätigungsblase „Dokument … entfernen“ öffnen und die Fuge zwischen ihren zwei Knöpfen mit denselben Böden zusichern; Messwert in die Annotation. Prüfen: grün in allen drei Stufen
- [ ] 4.3 Mutationsprobe „Stufe festgenagelt → rot“: in `antdKlappkopf` und im Fußabstand von `antdKomponenten` `dichten.kompakt` statt `dichten[dichte]` einsetzen, e2e aus 4.1/4.2 und die Unit-Tests laufen lassen. Erwartet: `komfortabel`/`handschuh` rot. Zurückdrehen, Ergebnis hier vermerken
- [ ] 4.4 Die übrigen e2e-Specs mit `Collapse` oder Rückfrage im Ablauf laufen lassen (mindestens `dokumente`, `gate3-trefflaeche`, `trefflaeche-tablet`, `personen-aufnahme`, `stab-checkliste`). Prüfen: grün

## 5. Regeln und Doku

- [ ] 5.1 `frontend/AGENTS.md`: im Abschnitt „Tabelle und Dichte“ den Klappkopf-Boden über `antdKlappkopf` nennen; bei „Rot steht nicht bündig neben Neutralem“ die Fußfuge der Erfassungs-Hülle und der antd-Füße (`antdKomponenten`, Modal/Popconfirm) nennen. Prüfen: `prettier --check` auf `frontend/` grün
- [ ] 5.2 `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: Zeile 2 · 2 und Kriterium 2 der Fläche Dialog auf „erfüllt“ mit den neuen Messwerten und Verweis auf diese Change. Prüfen: die Messwerte stimmen mit der e2e-Annotation aus 4.1/4.2 überein

## 6. Gate

- [ ] 6.1 `./scripts/check-all.sh` (ohne `| tail`) läuft grün durch. Prüfen: Exit-Code 0
