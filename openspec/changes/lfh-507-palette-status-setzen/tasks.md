# Tasks

## 1. Entscheidung „Ansicht wechseln“ (vor jedem Code)

- [x] 1.1 In `CLAUDE.md` unter „Die Liste ist die zweite Frage“ die Entscheidung LFH-507 eintragen: kein Nutzerschalter Tabelle ↔ Karte, die Form bleibt die begründete Entscheidung je Seite, und wer einen Schalter will, schreibt zuerst diese Regel fort. Verifikation: Die Zeile steht im Diff und nennt LFH-507 und diese Change.

## 2. Aktion `status-setzen` im Verzeichnis

- [x] 2.1 `TastaturAktionId` um `'status-setzen'` erweitern, in `TASTATUR_AKTIONEN` eintragen (Label „Status setzen“, Schlagworte, `kuerzel: () => null`) und in `TASTATUR_AKTION_REIHENFOLGE` ans Ende stellen. Den Dateikopf in `typen.ts` nachführen. Per TDD in `befehle.test.ts`: `kuerzelFuerTastaturAktion('status-setzen', …)` ist `null` auf beiden Plattformen, der Befehl `tastatur:status-setzen` trägt keinen Schlüssel `kuerzel`, der Reihenfolge-Guard bleibt grün, und `tastaturAktionFuerEreignis` liefert für Escape, Strg/⌘+S, Strg/⌘+↵ und Strg/⌘+Rücktaste weiter nie `status-setzen`.

## 3. Ebenen „nur mit Fokus“ im Provider

- [x] 3.1 `useTastaturEbene` und `registriereTastaturEbene` nehmen `nurMitFokus?: true` an, und `fallbackWurzel` schließt solche Ebenen aus. Per TDD in `CommandPaletteProvider.test.tsx`: Eine einzige registrierte Ebene mit `nurMitFokus` erscheint bei Öffnen ohne Fokus NICHT (rot vor dem Fix, weil sie heute der Fallback wäre), mit Fokus in ihrer Wurzel erscheint sie. Die bestehenden Fallback-Tests bleiben grün.

## 4. `StatusWahl` meldet die Zeilenebene an

- [x] 4.1 `StatusWahl`: Callback-Ref am Auslöser löst die umgebende Zeile (`[data-row-key]` bzw. `[data-lfh="datensicht-karte"]`) in eine `RefObject` auf. Das Menü wird kontrolliert geöffnet (`open`/`onOpenChange`, eine Menüwahl schließt), `useTastaturEbene({ name: 'Statuswahl: <kennung>', wurzel, aktionen: { 'status-setzen': öffnen }, aktiv: darfSchreiben && !gesperrt && !laeuft, nurMitFokus: true })`. Bestehende `StatusWahl`-Tests bleiben grün (Klick öffnet, Wahl ruft `onWaehlen`, Lesezweig ohne Knopf).
- [x] 4.2 Vitest mit `CommandPaletteProvider` und zwei Kartenzeilen A und B in einer `Datensicht` (`karte.statusBedienung`): **Leerfall zuerst.** Ohne Fokus in einer Zeile (Fokus im Suchfeld, und per Trigger ohne Fokus geöffnet) fehlt „Status setzen“. Mit Fokus im Kennungslink von B und Strg+K steht die Aktion ohne Kürzel da, das Ausführen öffnet das Menü von B (sichtbares Overlay per `within`), das Menü von A bleibt zu, und `onWaehlen` wird nicht gerufen. Bei gesperrter Zeile und ohne Schreibrecht fehlt die Aktion. Mutationsprobe: Ohne `nurMitFokus` oder mit `aktiv: true` wird der jeweilige Fall rot.
- [x] 4.3 Dasselbe für den Tabellenzweig (`form="tabelle"`, Statusspalte rendert `StatusWahl`, Zeile per `data-row-key`): Mit Fokus in Zeile B öffnet die Aktion das Menü von B. Verifikation: Der Test ist grün, und die Mutationsprobe (falscher Zeilenselektor) macht ihn rot.
- [x] 4.4 Ein Fall mit Ebenen-Kette: Fokus in einer Zeile unter einer `EinsatzSeite` mit „Neue Zeile“, dann stehen beide Aktionen in der Palette (Vitest).

## 5. Nachweis im Browser und Dokumentation

- [ ] 5.1 e2e in `e2e/command-palette.spec.ts` auf der Fahrzeugseite, analog zu „Spalten öffnet die Spaltenwahl UND legt den Fokus hinein“: Fokus in einer Fahrzeugzeile, Strg+K, „Status setzen“, danach ist das Statusmenü dieser Zeile sichtbar und hat den Fokus (`fokusImOffenenMenue`). Gegenprobe über den „Suchen“-Knopf: Die Aktion fehlt (Anzahl 0). Verifikation: `pnpm e2e -- command-palette` grün.
- [x] 5.2 `CLAUDE.md` im Abschnitt „Sprungpalette“: eine Zeile zur Fokuszeile (Ebene am Primitiv `StatusWahl`, Wurzel ist die Zeile, `nurMitFokus` hält die Aktion aus dem Anzeige-Fallback). Den Dateikopf von `StatusWahl.tsx` um den Palettenweg ergänzen. Verifikation: Beides steht im Diff.

## 6. Gates

- [ ] 6.1 `pnpm lint`, Prettier-Check, `tsc`, Vitest für `command-palette/` und `components/` sowie das e2e aus 5.1 grün, danach `./scripts/check-all.sh` (bzw. die Schritte, die der Container tragen kann, mit Nennung der übersprungenen).
