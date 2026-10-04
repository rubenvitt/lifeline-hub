# Tasks

## 1. Fehlertext-Tokens (gerechnet)

- [ ] 1.1 `frontend/src/theme/fehlertextKontrast.test.ts` anlegen (Muster `gefahrKontrast.test.ts`, Böden als Literale Tag 7, Nacht 5). Die Werte kommen aus `theme.getDesignToken({ token: antdToken(farben), algorithm: antdAlgorithmus(dunkel) })`: `colorErrorText`, `colorErrorTextHover` und `colorErrorTextActive` gegen `grund`, `flaeche`, `flaeche2`, `flaeche3`, `paneel`, `kopf` und `alarmFlaeche`. Dazu kommt: `colorError` bleibt gleich `alarm`. Prüfen: Der Test läuft vor 1.2 ROT (Tag `grund` 5,67, Nacht `flaeche2` 4,97)
- [ ] 1.2 `antdToken` in `frontend/src/theme/tokens.ts`: `colorErrorText: alarmText`, `colorErrorTextHover`/`colorErrorTextActive: alarmHover`. Dazu ein Kommentar, warum der Weg global ist (nur Schriftleser, mit den drei Lesern von antd 6.6.5 und dem grep für ein antd-Update). Die Kontrast-Kommentare über `farbenHell`/`farbenDunkel` und an `antdKomponenten` (Absatz „Textrollen statt Füll- und Hover-Tönen“) fortschreiben. Prüfen: 1.1 grün, `tokens.test.ts`, `gefahrKontrast.test.ts` und `bedienKontrast.test.ts` grün. Mutationsprobe: Nimmt man `colorErrorText` heraus, wird 1.1 rot
- [ ] 1.3 Leser belegen: `grep -rln colorErrorText frontend/node_modules/antd/es` trifft nur `typography/`, `input/` und `select/` (dazu die Token-Tabellen), und dort nur Schriftfarben. Prüfen: Das Ergebnis steht im Kommentar aus 1.2. Trifft der grep einen Flächen- oder Randleser, wird E1 neu entschieden
- [ ] 1.4 Aufrufer durchgehen (design.md E3): die acht `type="danger"`-Stellen brauchen keine Änderung. Jede Stelle mit `token.colorError` und `rollenFarbe('alarm')` färbt keine Schrift. Prüfen: `grep -rn 'token.colorError\b' frontend/src` und die Aufrufer von `rollenFarbe` gesichtet. Färbt eine Stelle Schrift, wird sie auf `alarmText` umgestellt und hier eingetragen

## 2. Browser-Nachweis

- [ ] 2.1 `frontend/e2e/fehlertext-kontrast.spec.ts`, Tag und Nacht. Ein Einsatz, ein offener Auftrag mit abgelaufener Frist, gesät wie `stab-vorbereitung.spec.ts`. Gemessen wird „Befehl nicht gefunden.“ unter `…/auftraege/befehle/<unbekannte Id>` gegen den Seitengrund und „Überfällig“ auf der Auftragskarte (`data-ueberfaellig="true"`) gegen die alarmierte Kartenfläche, mit `pruefe` aus `kontrast-kern.ts`. Dazu die Zusicherung, dass die linke Kante dieser Karte die Füllfarbe `alarm` trägt. Prüfen: Spec grün. Mutationsprobe: Nimmt man `colorErrorText` aus `antdToken`, wird die Tagmessung beider Stellen rot

## 3. Regel und Gesamtlauf

- [ ] 3.1 `frontend/AGENTS.md`, Eintrag „Geerbter Text auf Textrollen“: Roter Fehler- und Verzugstext außerhalb von Formularen (`Typography` `danger`) liest `alarmText` über das globale `colorErrorText`. Unter dem Zeiger liest er `alarmHover`, das globale `colorError` bleibt Füllfarbe, Nachweis in `e2e/fehlertext-kontrast.spec.ts`. Prüfen: Prettier über `frontend/` grün, Datei im Stil der Nachbareinträge
- [ ] 3.2 Übrige Kontrast-Specs gegen die neuen Tokens laufen lassen (`betroffene-`, `hellmodus-`, `gefahr-`, `hinweis-`, `kraefte-kontrast.spec.ts`). Prüfen: grün. Liegt eine Stelle unter dem Boden, kommt sie als Nachzug aufs Entwicklungsboard, mit der Ticketnummer hier
- [ ] 3.3 `./scripts/check-all.sh` grün (bzw. die Bündel, die in der Umgebung laufen; der volle Lauf wird mit der CI des PRs belegt), dazu Vitest voll. Prüfen: Ergebnis hier vermerkt
