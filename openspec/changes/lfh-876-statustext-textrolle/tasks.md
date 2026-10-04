# Tasks

## 1. Statustext-Tokens auf die Textrollen (gerechnet)

- [ ] 1.1 `frontend/src/theme/statustextKontrast.test.ts` anlegen (Muster `gefahrKontrast.test.ts`, Böden 7 / 5 als Literale). Je Modus mit `antdTheme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) })`: `colorErrorText`, `colorErrorTextHover`, `colorErrorTextActive` = `alarmText`, `colorWarningText` = `achtungText`, `colorSuccessText` = `normalText`; `colorError`/`colorWarning`/`colorSuccess` bleiben `alarm`/`achtung`/`normal`. Dazu der Kontrast jedes aufgelösten Statustexts auf jeder deckenden Fläche (`grund`, `flaeche`, `flaeche2`, `paneel`, `kopf`, `flaeche3`, Statusflächen) ≥ Boden. Prüfen: Der Test läuft vor 1.2 ROT (Tag `colorErrorText` 5,31 auf `flaeche3`, Nacht `#dc5e5e`)
- [ ] 1.2 `antdToken` in `frontend/src/theme/tokens.ts` setzt die fünf Tokens, mit Kommentar am Wert: warum Map-Token und global (design.md E1, Leser bei antd 6.6.5 samt grep), warum Zeiger und Drücken nicht wechseln (E2). Den Absatz „Geerbter Text“ im Kommentar über `farbenHell` und die Statusflächen-Zeile über `farbenDunkel` um die Statustext-Werte ergänzen. Prüfen: 1.1 grün, `tokens.test.ts`, `rollen.guard.test.ts`, `gate5.guard.test.ts` grün. Mutationsprobe: `colorWarningText` entfernt → 1.1 rot

## 2. Browser-Nachweis

- [ ] 2.1 `frontend/e2e/statustext-kontrast.spec.ts`, Tag und Nacht (Muster `gefahr-kontrast.spec.ts`, Messung über `e2e/kontrast-kern.ts`, Böden als Literale): neuer Einsatz; „Befehl nicht gefunden.“ auf der Detailseite eines nicht vorhandenen Befehls (zugesichert als `ant-typography-danger`) und „nicht verortet“ im Paneel „Einsatzort“ der Lagekarte (zugesichert als `ant-typography-warning`). Prüfen: Spec grün in light und dark. Mutationsprobe: die Zeile `colorErrorText` in `antdToken` entfernt → Tagmessung „Befehl nicht gefunden.“ rot

## 3. Regel und Gesamtlauf

- [ ] 3.1 `frontend/AGENTS.md`, Eintrag „Geerbter Text auf Textrollen“: Statustext (`Typography` `danger`/`warning`/`success`) liest `alarmText`/`achtungText`/`normalText` über die `…Text`-Map-Tokens in `antdToken`, die Füllfarben bleiben. Prüfen: Prettier über `frontend/` grün, Stil der Nachbareinträge
- [ ] 3.2 Übrige Kontrast-Specs gegen die neuen Tokens laufen lassen (`hellmodus-`, `betroffene-`, `gefahr-`, `hinweis-`, `lagekarte-ebenen-kontrast.spec.ts`). Prüfen: grün; liegt etwas unter dem Boden, als Nachzug erfassen und die Nummer hier eintragen
- [ ] 3.3 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt)
