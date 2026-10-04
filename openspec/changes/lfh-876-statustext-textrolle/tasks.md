# Tasks

## 0. Basis

- [ ] 0.1 Erst nach dem Merge der Schwester-Change `lfh-874-fehlertext-alarmtext` beginnen: `origin/alpha` in den Branch mergen. Prüfen: `antdToken` in `frontend/src/theme/tokens.ts` trägt `colorErrorText` auf `alpha`

## 1. Warn- und Erfolgstext auf die Textrollen (gerechnet)

- [x] 1.1 `frontend/src/theme/statustextKontrast.test.ts` anlegen (Muster des roten Gegenstücks bzw. `gefahrKontrast.test.ts`, Böden 7 / 5 als Literale). Je Modus mit `antdTheme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) })`: `colorWarningText` = `achtungText`, `colorSuccessText` = `normalText`; `colorWarning`/`colorSuccess` bleiben `achtung`/`normal`. Dazu der Kontrast beider aufgelöster Werte auf jeder deckenden Fläche (`grund`, `flaeche`, `flaeche2`, `paneel`, `kopf`, `flaeche3`, Statusflächen) ≥ Boden. Prüfen: Der Test läuft vor 1.2 ROT (Tag `colorWarningText` 5,43 auf `flaeche3`)
- [x] 1.2 `antdToken` in `frontend/src/theme/tokens.ts` setzt die zwei Tokens neben den roten, mit Kommentar am Wert (Leser bei antd 6.6.5 samt grep, Verweis auf die Begründung der roten Zeilen, design.md E1/E2). Die Kontrast-Kommentare über `farbenHell` und `farbenDunkel` um Warn- und Erfolgstext ergänzen. Prüfen: 1.1 grün, `tokens.test.ts`, `rollen.guard.test.ts`, `gate5.guard.test.ts` grün. Mutationsprobe: `colorWarningText` entfernt → 1.1 rot. **Ergebnis:** vorher 12 von 24 rot, danach Theme-Tests 527/527 grün; Mutationsprobe 12 rot

## 2. Browser-Nachweis

- [x] 2.1 `frontend/e2e/statustext-kontrast.spec.ts`, Tag und Nacht (Muster `lagekarte-ebenen-kontrast.spec.ts`, Messung über `e2e/kontrast-kern.ts`, Böden als Literale): neuer Einsatz ohne Ort, „nicht verortet“ im Paneel „Einsatzort“ der Lagekarte, zugesichert als `ant-typography-warning`. Prüfen: Spec grün in light und dark. Mutationsprobe: `colorWarningText` aus `antdToken` entfernt → Tagmessung rot. **Ergebnis:** grün in light und dark; Mutationsprobe light 6,34 auf der Leiste (`paneel`) rot, dark bleibt grün (antds Nachtton hält 5, verfehlt aber die Rolle — das fängt 1.1)

## 3. Regel und Gesamtlauf

- [x] 3.1 `frontend/AGENTS.md`, Eintrag „Geerbter Text auf Textrollen“: Warn- und Erfolgstext (`Typography` `warning`/`success`) liest `achtungText`/`normalText` über `colorWarningText`/`colorSuccessText` in `antdToken`, neben dem roten Fehlertext; die Füllfarben bleiben. Prüfen: Prettier über `frontend/` grün, Stil der Nachbareinträge
- [ ] 3.2 Übrige Kontrast-Specs gegen die neuen Tokens laufen lassen (`hellmodus-`, `betroffene-`, `hinweis-`, `lagekarte-ebenen-kontrast.spec.ts` und der rote Fehlertext-Spec). Prüfen: grün; liegt etwas unter dem Boden, als Nachzug erfassen und die Nummer hier eintragen
- [ ] 3.3 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt)
