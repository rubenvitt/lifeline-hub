# Tasks

Jede Aufgabe per TDD (`superpowers:test-driven-development`): erst der rote Test, dann der Code.
Vitest-Läufe in `frontend/` mit `mise exec -- pnpm exec vitest run <datei>`, Rust-Tests mit
`cargo test <filter>`. Reihenfolge der Abschnitte: 1804 → 1803 → 1802 → 1805.

## 1. LLH-1804 (y1we3nsc) Treffer der Sprungpalette (D1, D6)

- [x] 1.1 Normalisierung und Abgleich in `command-palette/fuzzy.ts` (`normalisiere`, Wortanfang oder Teilwort ab drei Zeichen, jedes Suchwort muss treffen, Stufen 0–3, Score 0/0,5). Prüfung: `fuzzy.test.ts` mit Fällen „rtw“ trifft „Lagekarte“/„Gefahrengebiet zeichnen“/„Benutzerverwaltung“ nicht, „funk“ trifft „Dunkel“ nicht, „kraefte“ = „Kräfte“, „hilfsstelle“ trifft „Unfallhilfsstellen“, „neuer etb“ trifft das Schlagwort, „ea“ (2 Zeichen) nur am Wortanfang
- [x] 1.2 `textStufe` mit derselben Normalisierung; `fuse.js` aus `fuzzy.ts` und `frontend/package.json` entfernen, Lockfile nachziehen. Prüfung: `grep -rn "fuse" frontend/src` leer, `datensaetze.test.ts` und `fuzzy.test.ts` grün
- [x] 1.3 Gepinnte Ranglisten in `befehle.test.ts`, `CommandPalette*.test.tsx`, `CommandPaletteProvider*.test.tsx` nur dort anpassen, wo das neue Verhalten es verlangt; die Spec-Szenarien „Funk findet den Funkplan“, „Schlagwort ohne Namensteil“, „Bestehende Marke“, „Alte Beschriftung findet“ bleiben grün. Prüfung: Vitest über `command-palette/` grün
- [x] 1.4 Datensatz-Merkmale (D3): `merkmale` je Quelle in `datensaetze.ts`, Fahrzeug `fahrzeugtyp`/`kennzeichen`, Personal `funktion`/`einsatzfunktion`, Hinweis mit dem getroffenen Merkmal. Prüfung: `datensaetze.test.ts` („rtw“ → Fahrzeug mit Hinweis „RTW“, Kennzeichen-Anfang, „gruppenf“ → Person)
- [x] 1.5 Navigationszeile „Hilfe“ (`hilfePfad()`, auch ohne Einsatz). Prüfung: `befehle.test.ts` („hilfe“ → „Hilfe“ vor „Unfallhilfsstelle anlegen“, auch außerhalb eines Einsatzes)

## 2. LLH-1804 (y1we3nsc) Neue Schnellaktionen und Zählung (D4, D5)

- [x] 2.1 `meldungenPfad`, `lagemeldungenPfad` und `auftraegePfad` nehmen `neu`; `MeldungenPage` und `LagemeldungenPage` öffnen bei `?neu=1` das Formular (Lagemeldungen mit Art „Lagemeldung“), `AuftraegePage` den Erteilen-Dialog; Parameter danach per `replace` weg, ohne Schreibrecht ohne Formular. Prüfung: `routing/deeplinks.test.ts`, `MeldungenPage.test.tsx`, `LagemeldungenPage.test.tsx`, `AuftraegePage.test.tsx`
- [x] 2.2 `FahrzeugePage` liest `ansicht` als Literal (falls nicht schon); `SchnellaktionParameter` um `ansicht` erweitern, Guard `schnellaktionen.guard.test.ts` prüft `get('ansicht')`. Prüfung: Guard grün, ein bewusst falscher Eintrag macht ihn rot (Mutationsprobe)
- [x] 2.3 Neue Zeilen in `SCHNELLAKTIONEN` mit `kennung`: Meldung erfassen, Lagemeldung erfassen (zusätzlich Freigabe `meldungen`), Auftrag erteilen, Nachforderung stellen, Fahrzeugstatus setzen. Prüfung: `befehle.test.ts` (Zeile, Kontext, Icon, Fehlen bei gesperrtem Träger, „Lagemeldung erfassen“ fehlt ohne Meldungen), `befehle.modulstatus.test.ts`
- [x] 2.4 Backend: Schlüssel `schnellaktionen_zaehler` in `BEKANNTE_SCHLUESSEL` (`src/benutzer_einstellungen/mod.rs`). Prüfung: Unit-Test im Modul (Schlüssel gültig, Wert opak), `cargo test benutzer_einstellungen`
- [x] 2.5 Reiner Kern `command-palette/schnellaktionZaehler.ts` (lesen mit Aufräumen und Deckel, hochzählen, Ordnung mit fester Folge bei Gleichstand) und Hook im Muster von `useZuletztBefehle` (erst Bestand, dann schreiben, Antwort verwerfen, Fehlschlag still). Prüfung: `schnellaktionZaehler.test.ts`, Hook-Test (Kaltstart ohne Cache schreibt nicht aus dem Nichts, zwei rasche Ausführungen zählen beide)
- [x] 2.6 `baueBefehle` ordnet die Schnellaktionen nach Zählung, die Ausführung (auch aus „Zuletzt ausgeführt“, mit Original-Id) zählt. Prüfung: `befehle.test.ts` (ohne Zählung feste Folge, „Anruf erfassen“ 3× → zuerst), Provider-Test (Zählung nach `schliesse()`, Folge steht bei offener Palette)
- [x] 2.7 `command-palette/AGENTS.md`: Regeln „neue Zeilen ans Ende“ und „Reihenfolge = Erfassungshäufigkeit“ durch D5 ersetzen, dritter Auftrag `ansicht`, Abgleich nach D1 statt Fuse. Prüfung: Prettier über `frontend/` grün, Verweise per `grep -rn "neue Zeilen ans Ende\|Erfassungshäufigkeit" frontend/src` nachgezogen

## 3. LLH-1803 (ubspfokf) Kräfteübersicht und Synonyme (D2, D7)

- [x] 3.1 `ModulEintrag.schlagworte`, Modulbefehle führen sie; Erstausstattung nach D2. Prüfung: `befehle.test.ts` („meldebild“, „stärke“ → Kräfteübersicht; „tagebuch“ → ETB; „bhp“ → Unfallhilfsstellen), `modulRegistry.test.ts` (Schlagworte nicht leer, kein Duplikat des Labels)
- [x] 3.2 Label „Kräfteübersicht“; Literale auf `modulName('kraefteuebersicht')` (Verdichtungszeile, MaterialVerdichtung, `App.tsx`, Druckkopf `dokumentart`, Datensicht, SpaltenSchalter), Lagebericht-Texte in `kraeftebild.ts` und `eigeneLageUebernahme.ts`; „Sachverhalt / Meldebild“ in den Einsatzdaten bleibt. Prüfung: zugehörige Vitest-Dateien grün, `grep -rn "'Meldebild\|„Meldebild\|>Meldebild\|Kräftemeldebild" frontend/src --include=*.tsx --include=*.ts` zeigt nur Kommentare, Bezeichner und die Einsatzdaten
- [x] 3.3 e2e-Locatoren auf „Kräfteübersicht“ (Dateinamen bleiben) und `design-system/previews.tsx`. Prüfung: `mise exec -- pnpm exec playwright test e2e/meldebild-*.spec.ts e2e/lageberichte-anlegen.spec.ts e2e/command-palette.spec.ts` grün
- [x] 3.4 Doku: Kapitel `meldebild.md` (Titel „Kräfteübersicht und Kräfte-Zeitachse“, Text), Verweise in den übrigen Kapiteln, README, `docs/architektur/01`, `10`, `12-glossar.md`; Website `module.json`, `index.astro`; Bilder neu (`pnpm doku:bilder --grep meldebild`). Prüfung: `hilfe/anwenderdoku.guard.test.ts`, `websiteModule.guard.test.ts` grün
- [x] 3.5 `frontend/AGENTS.md`: Regel zur Modulstruktur (Kräfteübersicht, früherer Name als Synonym), Abschnitt zu Modul-Schlagworten. Prüfung: Prettier grün, `scripts/adr-fuer.sh frontend/src/einsatz/modulRegistry.ts` nennt keine widersprechende Entscheidung
- [x] 3.6 Folgeaufgabe für die Spec-Prosa (D9) über `zunder-task-anlegen`. Prüfung: Link der Aufgabe im PR

## 4. LLH-1802 (enadu4z2) Chat-Heraufstufung mit Meldung (D8)

- [x] 4.1 Backend: `HeraufstufenBody.in_meldungseingang`, 422 bei anderem Typ, 403 ohne Freigabe der Meldungen vor jedem Schreiben. Prüfung: Integrationstest in `tests/` (422, 403 ohne Eintrag und ohne Rückverweis, Nachricht danach weiter heraufstufbar)
- [x] 4.2 `chat::repo::heraufstufen_zu_etb` legt bei Meldung im selben `write_retry!` die Meldung an (Absender = Anzeigename der Person, die die Nachricht schrieb, Meldeweg `sonstige`, Zeiten der Nachricht, Art nach Typ), danach `live_publikation_sicherstellen`. Prüfung: Integrationstest (Meldung „Sonstige“ bzw. „Lagemeldung“, Rückverweise beidseitig, kein Auto-ETB, Live-Ereignisse ETB, Chat und „meldung“; ohne Feld nur Eintrag; zweite Heraufstufung 409)
- [x] 4.3 Typ-Codegen, falls der Body in den generierten Typen steht: `scripts/check-typ-codegen.sh`, beide generierten Dateien mitcommitten. Prüfung: Skript grün
- [x] 4.4 Frontend `HeraufstufenModal`: Checkbox „Auch in den Meldungseingang“ (vorgewählt, Wortlaut der ETB-Schnellerfassung) bei Meldung/Lage und freigegebenen Meldungen, sonst Hinweis; sendet `in_meldungseingang`. Prüfung: `HeraufstufenModal.test.tsx` und Test der Chat-Seite (Vorgabe sendet `true`, abgewählt sendet `false`, Anordnung ohne Schalter, ohne Meldungen-Freigabe Hinweis und `false`)
- [x] 4.5 `src/AGENTS.md` (Abschnitt Meldungsmodell: „Chat → Meldung“), `docs/anwender/kapitel/chat.md` und `meldungen.md`. Prüfung: `hilfe/anwenderdoku.guard.test.ts` grün

## 5. LLH-1805 (o10xacs8) Eine Gliederung (D10, D11)

- [x] 5.1 ETB nach `fuehrung` hinter „Überblick“, Kategorie `erfassung` heißt „Betroffene & Schäden“, Kurzetikett „Betroff.“ nach Messung; `MODUL_KEYS` in `src/einsatz/modul.rs` gleich geordnet. Prüfung: `modulRegistry.test.ts`, `IconRail.test.tsx`, Rust-Test der Reihenfolge, `e2e/rail-etikett.spec.ts` grün
- [x] 5.2 Gemerktes Modul, das nicht mehr zur Kategorie gehört, wird ignoriert. Prüfung: Test von `kategorieModul.ts` (für `erfassung` gemerktes `etb` → erstes freigegebenes Modul von Betroffene & Schäden)
- [x] 5.3 Marke „Entscheidungen“ steht unter ETB in Führung. Prüfung: `ModulAkkordeon.test.tsx`/`ModulPanel.test.tsx` und `sprungmarken`-Tests nach den Szenarien von `modul-sprungmarken`
- [x] 5.4 `BEREICHE` neu, `reihenfolge` aller Kapitel neu vergeben, README, `website/src/daten/bereiche.ts`. Prüfung: Hilfe-Tests (`hilfe/*.test.ts*`), Website-Wächter grün
- [x] 5.5 Wächter `hilfe/bereiche.guard.test.ts` (Tabelle Modul → Kapitel, jedes Registry-Modul hat eine Zeile, Bereich gleich Kategorie). Prüfung: grün; Mutationsprobe (Modul in andere Kategorie verschoben → rot)
- [x] 5.6 `docs/anwender/AGENTS.md` (Kapitelpakete, Hilfe in der App), Kapitel `einsatz-oberflaeche.md` und Bild der Rail neu, übrige Tests und e2e mit Kategorie „Erfassung“ nachziehen. Prüfung: `grep -rn "Erfassung\b" frontend/src frontend/e2e --include=*.ts*` zeigt nur fachliche Verwendungen, betroffene e2e grün

## 6. Gesamtprüfung

- [x] 6.1 Im Browser gegen die Demo-Lage: „rtw“, „kraefte“, „funk“, „hilfe“ in der Palette; „Meldung erfassen“ öffnet das Formular; Chat-Nachricht als Meldung heraufstufen → steht in Meldungen; Rail mit „Betroffene & Schäden“, ETB unter Führung; Hilfe-Bereiche. Prüfung: Bilder für PR und Meldung
- [ ] 6.2 `./scripts/check-all.sh --geaendert --ohne-e2e` lokal grün. Prüfung: Gesamtstatus aus dem Lauf

## Workflow follow-up

- Review vor dem PR (Skelett „Review-find-verify“), danach `/opsx:archive` im selben Branch, dann PR gegen `alpha`.
