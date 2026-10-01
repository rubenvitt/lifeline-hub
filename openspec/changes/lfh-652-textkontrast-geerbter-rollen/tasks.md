# Tasks

Jede Aufgabe entsteht per `superpowers:test-driven-development`: zuerst der Test, er wird rot,
dann die Zeile. Belegt ist eine Aufgabe erst, wenn die Mutationsprobe aus `design.md` (E6) ihren
Test rot macht.

## 1. Link in der Textrolle (E2)

- [x] 1.1 `tokens.test.ts`: Die Tokens werden je Modus über `theme.getDesignToken({ token: antdToken(…), algorithm: antdAlgorithmus(…) })` aufgelöst. Zugesichert wird `colorLink`/`colorLinkHover`/`colorLinkActive` = `bedienText` und `linkHoverDecoration` = `'underline'`. Verifikation: Der Test ist vor der Änderung rot, und nachts ist er auch dann rot, wenn nur `antdToken` gesetzt ist und `seedTreu` fehlt.
- [x] 1.2 `antdToken` setzt `colorLink`, `colorLinkHover`, `colorLinkActive` und `linkHoverDecoration`. `seedTreu` pinnt `colorLink`. Verifikation: 1.1 ist grün.
- [x] 1.3 `antdKomponenten`: `Button.linkHoverBg = bedienFlaeche`, mit Test am reinen Objekt in `tokens.test.ts`. Verifikation: Der Test ist rot ohne die Zeile.
- [x] 1.4 Kontrast-Kommentar an `farbenHell`/`farbenDunkel` in `tokens.ts` um `bedienText` auf `grund`/`kopf`/`paneel` ergänzen, mit den Werten aus `design.md`. Kommentare an den lokalen Überschreibungen (`Datensicht.tsx`, `InlineAngabe.tsx`, `BemerkungZelle.tsx`, `etb/EtbAnhaenge.tsx`, `personen/personBearbeiten.ts`) berichtigen: Sie sind jetzt wertgleich mit `colorLink`, der Grund „Linkton unterschreitet“ entfällt. Verifikation: `grep -rn "colorLink" frontend/src` zeigt keinen Kommentar mehr, der den Linkton als zu schwach beschreibt.

## 2. Beschreibung und Tabellenkopf auf `gedaempft` (E3)

- [x] 2.1 `tokens.test.ts`: aufgelöstes `colorTextDescription` = `gedaempft` in beiden Modi, `colorTextTertiary` und `colorTextPlaceholder` bleiben `schwach`. Danach `antdToken` setzen. Verifikation: Der Test ist rot ohne die Zeile und grün mit ihr.
- [x] 2.2 `KatalogTabelle`: `tabellenTokens.headerColor` = `gedaempft`, Dateikopf-Kommentar „Kopftext `schwach`“ nachziehen. Test über die exportierte Funktion oder ihren bestehenden Testweg in `KatalogTabelle.test.tsx`. Verifikation: Der Test ist rot mit `schwach`.

## 3. Formularmeldung und Standardknopf (E4, E5)

- [x] 3.1 `tokens.test.ts`: `antdKomponenten(…).Form` trägt `colorError = alarmText` und `colorWarning = achtungText`. `Button.defaultHoverColor` und `defaultActiveColor` = `bedienText`, `defaultHoverBorderColor` bleibt ungesetzt. Je Modus. Danach `antdKomponenten` ergänzen. Verifikation: Die Tests sind rot ohne die Zeilen.
- [x] 3.2 Sichten, wo `colorError`/`colorWarning` sonst als TEXT erscheint (`Typography` `danger`/`warning`, `Alert`, `Form.ErrorList` außerhalb von `Form.Item`). Stellen ohne Befund kommen per `clickup-task-anlegen` aufs Entwicklungsboard. Verifikation: Liste der Fundstellen steht im PR-Text, und es gibt eine Task-ID oder ein „keine Fundstelle“.

## 4. Browsermessung (Spec „Böden für geerbten Text“)

- [x] 4.1 `e2e/dokumente.spec.ts`, Test „Kontrast …“: Der „geerbt“-Block (Tabellenkopf, „—“) und die Pflichtmeldung prüfen gegen `KONTRAST_ZIEL[modus]` statt `KONTRAST_BODEN`. Der Anhang mit den Messwerten bleibt. Verifikation: Vor der Umsetzung 1–3 wäre der Test rot (Tag), nach ihr ist er in beiden Modi grün.
- [x] 4.2 Ebenda: „Abbrechen“ im Ablegen-Dialog unter dem Zeiger (`hover()`, Messung mit `pruefe`) gegen `KONTRAST_ZIEL[modus]`. Verifikation: rot mit `defaultHoverColor` zurückgedreht.
- [x] 4.3 Titel-Link einer `Datensicht` mit `titel.ziel` ohne lokale Farbe (react-router-`Link`, erbt `colorLink`), etwa in der Schadensliste. Gemessen in beiden Modi gegen 7/5 in einer bestehenden Kontrast-Spec oder in `dokumente.spec.ts`, wenn sich dort ein Datensicht-Link findet. Verifikation: rot mit `colorLink` zurückgedreht.
- [x] 4.4 Mutationsproben aus `design.md` E6 einzeln ausführen und das Ergebnis (welcher Test wird rot) im PR-Text festhalten. Verifikation: Jede der fünf Rücknahmen macht mindestens einen Test rot.

## 5. Regeln und Prüfspur

- [x] 5.1 `frontend/AGENTS.md`, Farbachsen: Die Regel „Blauer Bedien-TEXT nimmt `rollen.bedienText`, nicht `colorLink`“ fortschreiben. `colorLink` ist `bedienText` (`tokens.ts`), ein lokales `style` dafür ist unnötig. Beschreibung und Tabellenkopf lesen `gedaempft`, Formularmeldungen lesen `alarmText`/`achtungText`. Verweis auf diese Change. Verifikation: Prettier über `frontend/` ist grün, die Datei bleibt die einzige Fundstelle der Regel.
- [x] 5.2 `docs/superpowers/specs/2026-09-22-lfh-632-pruefliste.md`: Die Zeilen 1 · 5 und 2 · 5 (LFH-652) mit den neuen Messwerten aus dem e2e-Anhang nachtragen. Verifikation: Die Werte stimmen mit dem Anhang des Laufs überein.
- [x] 5.3 ClickUp: Folgetask „Hervorhebungsfläche `flaeche3` am Tag unter 7 : 1 für `bedienText`/`gedaempft`“ per `clickup-task-anlegen`. Kommentar an LFH-643, dass „Seitenbeschreibung“ hier gelöst ist. Verifikation: Task-ID steht im PR-Text.

## 6. Abschluss

- [ ] 6.1 `./scripts/check-all.sh` grün (lokal, soweit die Umgebung trägt, sonst die CI des PRs). Dazu `mise exec -- pnpm -C frontend exec playwright test e2e/dokumente.spec.ts`. Verifikation: Ausgabe ohne Fehler.
- [ ] 6.2 Review (`superpowers:requesting-code-review`), Befunde abgearbeitet. Verifikation: keine offenen bestätigten Befunde.
