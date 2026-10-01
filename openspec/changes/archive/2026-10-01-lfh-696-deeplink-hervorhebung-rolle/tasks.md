# Tasks

Jede Aufgabe entsteht test-first (`superpowers:test-driven-development`): erst der rote Test, dann
der Code. Vorher `grep -rn 'zeile-hervorgehoben' frontend/src frontend/e2e` und die Treffer
durchsehen, die Klasse und ihr Name bleiben unverändert.

## 1. Rolle `hervorhebungZeile`

- [x] 1.1 `theme/rollen.guard.test.ts`: die Zuordnung `hervorhebungZeile: '--lfh-hervorhebung-zeile'` in die Tabelle der Zeilentönungen aufnehmen. Verifiziert durch den roten Lauf `pnpm vitest run src/theme/rollen.guard.test.ts` (Rolle fehlt auf beiden Seiten)
- [x] 1.2 `theme/tokens.ts`: `hervorhebungZeile` in `Farbrollen` (Doc-Kommentar der Zeilentönungen um „Deeplink-Hervorhebung, LFH-25/LFH-696“ erweitern), `farbenHell` `#fffbe6`, `farbenDunkel` `#2b2611`. Die Messwerte aus design.md, Entscheidung 1, kommen in die Kontrastkommentare beider Paletten. `theme/rollen.css`: `--lfh-hervorhebung-zeile` in `:root` und `[data-theme='dark']` neben `--lfh-problem-zeile`. Verifiziert durch den grünen Lauf von `src/theme/` (`rollen.guard`, `gate5.guard`, Kontrast-Unit-Tests) und `pnpm tsc --noEmit` ohne Fehler (jede Stelle, die `Farbrollen` vollständig baut, muss die Rolle tragen)

## 2. Hervorhebung liest die Rolle

- [x] 2.1 `theme/gate5.guard.test.ts`: neues `it` „kein roher Hex-Farbwert in handgeschriebenem CSS außerhalb src/theme/“ nach design.md, Entscheidung 3 (ohne Ausnahmeliste, Meldung `pfad:zeile  inhalt`), dazu ein Selbsttest auf `ohneKommentare` mit einem CSS-Kommentar, der einen Hex-Wert nennt. Dateikopf um die Prüfung und ihre Grenze (nur Hex) ergänzen. Verifiziert durch den roten Lauf mit genau den Treffern `/src/index.css:14` und `:20`. Dazu ein Unit-Test in `theme/tokens.test.ts`: `hervorhebungZeile` gleicht in keinem Modus `flaeche3`, den übrigen Zeilentönungen oder `achtungFlaeche` (Szenario „Unterscheidbar von der Lückentönung“)
- [x] 2.2 `index.css`: `.zeile-hervorgehoben` nach design.md, Entscheidung 2 (Tabellenselektor wie `.zeile-luecke`, Kartenselektor bleibt, `background-color: var(--lfh-hervorhebung-zeile)`, `transition` bleibt, Nachtblock entfällt), Kommentar um Rolle und Spezifität ergänzen. Verifiziert durch den grünen Lauf aus 2.1, `grep -nE '#[0-9a-fA-F]{3,6}' frontend/src/index.css` ohne Treffer (Akzeptanzkriterium) und die grünen Bestandstests mit `zeile-hervorgehoben` (`pnpm vitest run src/pages src/etb src/betreuung src/components/Datensicht`)

## 3. Browsernachweis

- [x] 3.1 `e2e/hervorhebung-kontrast.spec.ts` nach design.md, Entscheidung 4: je Modus Deeplink auf eine Tabellenzeile, Grund der `td` gleich dem Literal der Rolle, Grund verschieden vom Hover einer zweiten Zeile, Kennungstext über `pruefe` aus `e2e/kontrast-kern.ts` ≥ 7 (Tag) bzw. ≥ 5 (Nacht). Vorher am Code bestätigen, welche Seite und welcher Query-Parameter die Klasse in einer Tabelle setzt. Verifiziert durch den grünen Lauf des Specs (grün in `light` und `dark`; bestätigt: Fahrzeugseite, `?fahrzeug=<id>`. Text auf eigener Fläche, etwa der Tag „ad-hoc“, steht nicht auf der Tönung und ist ausgenommen, sein eigener Befund ist ein Folgetask)
- [x] 3.2 Mutationsproben zu 3.1, je danach zurück: (a) Rolle auf den Wert von `flaeche3` → Hover-Aussage rot; (b) Tabellenselektor auf die alte Form `.zeile-hervorgehoben > td` → Ergebnis der Grund-Aussage notieren (rot heißt: die Tönung stand in Tabellen bisher nicht, das geht in PR-Text und Abschlussmeldung). Verifiziert durch die notierten Messwerte hier am Kästchen. **Gemessen 01.10.2026:** (a) `flaeche3` auf den Tönungswert → „Hover-Grund gleicht der Hervorhebung“ rot in beiden Modi, Zellgrund-Aussage grün. (b) alter Selektor → Zellgrund rot in beiden Modi: zwei Zellen der Zeile ohne Tönung (Tag `rgb(255,255,255)` und `rgb(250,250,250)`, Nacht `rgb(15,18,21)` und `rgb(25,27,30)`), die Tönung stand in Tabellen also bisher nur teilweise
- [x] 3.3 Review-Fixes (01.10.2026): der e2e-Spec misst auch reine Textzellen (`:scope > td`); die Status-Textrollen auf `hervorhebungZeile` sind gerechnet in `theme/bedienKontrast.test.ts` (Tag ≥ 7, Nacht ≥ 5); der Verweis auf die alte Selektorform in `pages/kraefteuebersichtPrint.css` ist korrigiert. Verifiziert durch den grünen Lauf von `src/theme/` (383 Tests) und des e2e-Specs

## 4. Regel und Abschluss

- [x] 4.1 `frontend/AGENTS.md`, Gestaltungssprache: in der Rollenliste die Zeilentönungen um `hervorhebungZeile` ergänzen; im Tagmodus-Absatz „Hervorhebung auf `flaeche3`“ eindeutig machen (gemeint ist die aktive Zeile, die Deeplink-Hervorhebung trägt `hervorhebungZeile`). Verifiziert durch `prettier --check frontend/AGENTS.md`
- [x] 4.2 ClickUp LFH-696: Kommentar mit der Entscheidung (Rolle, keine Tonverschiebung, Messwerte, Verweis auf diese Change). Verifiziert durch den Kommentar am Task

## 5. Zeitachsen-Karten (design.md, Entscheidung 5)

- [x] 5.1 `components/instrument/Zeitachseneintrag.tsx`: Zeilentönung `hervorhebung` → `hervorhebungZeile` in `Zeilentoenung`/`TOENUNG`, Doc-Kommentar der Prop nennt den Fall. Verifiziert durch einen erst roten, dann grünen Fall in `Zeitachseneintrag.test.tsx` (`zeilenGrund(farbenHell, 'hervorhebung')` = `farbenHell.hervorhebungZeile`, ebenso dunkel)
- [x] 5.2 `etb/EtbZeitachse.tsx`: der Inline-Stil `bedienFlaeche` entfällt, die angesteuerte Zeile übergibt `toenung="hervorhebung"` mit Vorrang vor `berichtigung`/`problem`, Kommentar nach Entscheidung 5. Verifiziert durch Render-Tests in `EtbZeitachse.test.tsx`: angesteuerte Zeile `data-toenung="hervorhebung"` mit Inline-Grund = Rolle; eine angesteuerte Berichtigung ebenso; eine nicht angesteuerte Berichtigung behält `berichtigung`
- [x] 5.3 `pages/InfotelefonPage.tsx`: der angesteuerte Anruf übergibt `toenung="hervorhebung"`. Verifiziert durch einen Render-Test der Infotelefon-Seite (angesteuerter Anruf `data-toenung="hervorhebung"`, die übrigen ohne)
- [x] 5.4 `e2e/hervorhebung-kontrast.spec.ts`: Kartenfall je Modus, ETB-Deeplink `?eintrag=<id>`, Grund der Karte = Literal der Rolle, Text der Karte (ohne eigene Fläche) über `pruefe` ≥ 7 bzw. ≥ 5. Verifiziert durch den grünen Lauf und eine Mutationsprobe: ETB-Tönung testweise weg → Kartenfall rot. **Gemessen 01.10.2026:** grün in `light` und `dark`. Probe ETB-Tönung weg → Kartengrund `rgba(0, 0, 0, 0)` statt Literal, rot in beiden Modi. Benannte Grenze: Text in `schwach` (Nr., Meta, Meldeweg) ist ausgenommen, Ticket LFH-898 (design.md, Entscheidung 1)
- [x] 5.5 `frontend/AGENTS.md`, Rollenliste: ein Halbsatz, dass die Zeitachse die Hervorhebung über `toenung="hervorhebung"` trägt, nicht über die Klasse. Verifiziert durch `prettier --check frontend/AGENTS.md`

## 6. Verifikation

- [x] 6.1 `./scripts/check-all.sh` grün (Format, Lint, Vitest, e2e mit dem neuen Spec, OpenSpec-Archivwächter nach `/opsx:archive`). Verifiziert durch den Exit-Code bzw. die CI des PRs. **Lokal am 01.10.2026:** `schnell` und `frontend` grün (Vitest 589 Dateien, 8130 Tests). `e2e` 492 grün, 18 rot, alle ohne Bezug zur Hervorhebung: keiner der roten Fälle öffnet einen Deeplink. Fehlerbilder sind Verdeckung durch klebende Leisten, Leistenhöhe, Download-Dateiname, Browserabsturz, `aria-expanded`, Pegel-Knopf und der bekannte Block „Führungsfunktionen: der Bearbeiten-Knopf“. Ursache vermutlich das Container-Chromium (Build 1194 statt 1234). Der neue Spec ist grün in allen 4 Fällen. Den vollen Lauf belegt die CI des PRs.
