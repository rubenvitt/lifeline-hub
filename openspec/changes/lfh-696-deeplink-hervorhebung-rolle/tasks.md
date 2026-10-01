# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test, dann
der Code. Vorher `grep -rn 'zeile-hervorgehoben' frontend/src frontend/e2e` und die Treffer
durchsehen, die Klasse und ihr Name bleiben unverändert.

## 1. Rolle `hervorhebungZeile`

- [ ] 1.1 `theme/rollen.guard.test.ts`: die Zuordnung `hervorhebungZeile: '--lfh-hervorhebung-zeile'` in die Tabelle der Zeilentönungen aufnehmen. Verifiziert durch den roten Lauf `pnpm vitest run src/theme/rollen.guard.test.ts` (Rolle fehlt auf beiden Seiten)
- [ ] 1.2 `theme/tokens.ts`: `hervorhebungZeile` in `Farbrollen` (Doc-Kommentar der Zeilentönungen um „Deeplink-Hervorhebung, LFH-25/LFH-696“ erweitern), `farbenHell` `#fffbe6`, `farbenDunkel` `#2b2611`. Die Messwerte aus design.md, Entscheidung 1, kommen in die Kontrastkommentare beider Paletten. `theme/rollen.css`: `--lfh-hervorhebung-zeile` in `:root` und `[data-theme='dark']` neben `--lfh-problem-zeile`. Verifiziert durch den grünen Lauf von `src/theme/` (`rollen.guard`, `gate5.guard`, Kontrast-Unit-Tests) und `pnpm tsc --noEmit` ohne Fehler (jede Stelle, die `Farbrollen` vollständig baut, muss die Rolle tragen)

## 2. Hervorhebung liest die Rolle

- [ ] 2.1 `theme/gate5.guard.test.ts`: neues `it` „kein roher Hex-Farbwert in handgeschriebenem CSS außerhalb src/theme/“ nach design.md, Entscheidung 3 (ohne Ausnahmeliste, Meldung `pfad:zeile  inhalt`), dazu ein Selbsttest auf `ohneKommentare` mit einem CSS-Kommentar, der einen Hex-Wert nennt. Dateikopf um die Prüfung und ihre Grenze (nur Hex) ergänzen. Verifiziert durch den roten Lauf mit genau den Treffern `/src/index.css:14` und `:20`
- [ ] 2.2 `index.css`: `.zeile-hervorgehoben` nach design.md, Entscheidung 2 (Tabellenselektor wie `.zeile-luecke`, Kartenselektor bleibt, `background-color: var(--lfh-hervorhebung-zeile)`, `transition` bleibt, Nachtblock entfällt), Kommentar um Rolle und Spezifität ergänzen. Verifiziert durch den grünen Lauf aus 2.1, `grep -nE '#[0-9a-fA-F]{3,6}' frontend/src/index.css` ohne Treffer (Akzeptanzkriterium) und die grünen Bestandstests mit `zeile-hervorgehoben` (`pnpm vitest run src/pages src/etb src/betreuung src/components/Datensicht`)

## 3. Browsernachweis

- [ ] 3.1 `e2e/hervorhebung-kontrast.spec.ts` nach design.md, Entscheidung 4: je Modus Deeplink auf eine Tabellenzeile, Grund der `td` gleich dem Literal der Rolle, Grund verschieden vom Hover einer zweiten Zeile, Kennungstext über `pruefe` aus `e2e/kontrast-kern.ts` ≥ 7 (Tag) bzw. ≥ 5 (Nacht). Vorher am Code bestätigen, welche Seite und welcher Query-Parameter die Klasse in einer Tabelle setzt. Verifiziert durch den grünen Lauf des Specs
- [ ] 3.2 Mutationsproben zu 3.1, je danach zurück: (a) Rolle auf den Wert von `flaeche3` → Hover-Aussage rot; (b) Tabellenselektor auf die alte Form `.zeile-hervorgehoben > td` → Ergebnis der Grund-Aussage notieren (rot heißt: die Tönung stand in Tabellen bisher nicht, das geht in PR-Text und Abschlussmeldung). Verifiziert durch die notierten Messwerte hier am Kästchen

## 4. Regel und Abschluss

- [ ] 4.1 `frontend/AGENTS.md`, Gestaltungssprache: in der Rollenliste die Zeilentönungen um `hervorhebungZeile` ergänzen; im Tagmodus-Absatz „Hervorhebung auf `flaeche3`“ eindeutig machen (gemeint ist die aktive Zeile, die Deeplink-Hervorhebung trägt `hervorhebungZeile`). Verifiziert durch `prettier --check frontend/AGENTS.md`
- [ ] 4.2 ClickUp LFH-696: Kommentar mit der Entscheidung (Rolle, keine Tonverschiebung, Messwerte, Verweis auf diese Change). Verifiziert durch den Kommentar am Task
- [ ] 4.3 `./scripts/check-all.sh` grün (Format, Lint, Vitest, e2e mit dem neuen Spec, OpenSpec-Archivwächter nach `/opsx:archive`). Verifiziert durch den Exit-Code bzw. die CI des PRs
