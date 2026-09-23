# Tasks

## 1. Befehlsmodell: Ziel und Öffnungsart

- [x] 1.1 In `typen.ts` `Oeffnung`, `VorschauZiel`, `Befehl.ziel`, `Befehl.vorschau` und die Signatur `ausfuehren(oeffnung?)` ergänzen, außerdem `BefehlKontext.navigate(pfad, oeffnung?)`. Mit `tsc` prüfen, dass bestehende Befehle ohne Argument weiter typgerecht sind.
- [x] 1.2 In `befehle.ts` jeden Navigationsbefehl mit `ziel` versehen und `oeffnung` durchreichen: Zuletzt, Module, Schnellaktionen, Einsätze und die Navigation außer Abmelden. `mitGedaechtnis` reicht das Argument ebenfalls weiter. Test zuerst (TDD): ein Guard in `befehle.test.ts` baut alle Befehle mit vollem Kontext. Für jede Zeile mit `ziel` muss `ausfuehren('neuerTab')` genau `navigate(ziel, 'neuerTab')` rufen. Zeilen ohne `ziel` sind ausschließlich Aktionen, Einstellungen und Abmelden. Gedächtniszeilen tragen das `ziel` ihres Originals, und `merkeBefehl` und `merkeModulBesuch` feuern auch bei `'neuerTab'`. Mutationsprobe: ein ausgelassenes `oeffnung` färbt den Test rot.
- [x] 1.3 In `datensaetze.ts` (`befehlFuer`, `etbSammeltreffer`) und `koordinatenSprung.ts` `ziel` setzen und `oeffnung` durchreichen. `befehlFuer` setzt für `modulKey === 'personen'` `vorschau: { art: 'person', einsatzId, id }`. Die Hooks `useDatensaetze.ts` und `useKoordinatenSprung.ts` erhalten die erweiterte `navigate`-Signatur. Belegen mit Tests in `datensaetze.test.ts` und `koordinatenSprung.test.ts`: die Person trägt eine Vorschau, andere Sorten nicht, und der Durchreiche-Guard gilt wie in 1.2.

## 2. Personenvorschau als gemeinsames Bauteil

- [x] 2.1 Neue Datei `personen/PersonVorschau.tsx` mit Query, Lade- und Fehlerzustand und Inhalt aus `PersonDetailDrawer`. Der Drawer behält Rahmen, Titel und „Vollständig öffnen“ und bettet die neue Komponente ein. Belegen mit einem Test `PersonVorschau.test.tsx` (Inhalt einer Person, Fehlerzustand) und mit unverändert grünen Tests `Grundriss.test.tsx`/`GrundrissTabs.test.tsx`.
- [x] 2.2 Neue Datei `command-palette/Vorschau.tsx`, die `VorschauZiel` über einen exhaustiven `switch` mit `never`-Zweig auf die Komponente abbildet. Belegen mit `tsc` und einem Render-Test für `art: 'person'`.

## 3. Palette: Tasten, Vorschau-Modus, Fußzeile

- [x] 3.1 `CommandPalette.aufTaste` soll Strg/⌘+↵ und Strg/⌘+Klick behandeln: mit `ziel` wird `schliesse()` gerufen, dann `ausfuehren('neuerTab')`. Ohne `ziel` passiert nichts. In beiden Fällen läuft `preventDefault`. Tests zuerst, als Paar: Strg+↵ auf einer Person ruft `navigate(ziel, 'neuerTab')` und schließt die Palette. Strg+↵ auf „Speichern“ führt nichts aus und lässt die Palette offen. Blankes ↵ übergibt kein `'neuerTab'`. Bei `isComposing` passiert nichts.
- [x] 3.2 Vorschau-Modus bauen: → greift nur am Textende, nur ohne Auswahl und nur, wenn die Zeile eine `vorschau` hat. Die Region ersetzt die Listbox und trägt „Zurück“. Esc und ← führen zurück, dabei bleiben `suche` und `aktivId` erhalten. ↵ und Strg/⌘+↵ wirken auf den gezeigten Befehl. `onChange` verlässt die Vorschau. `aria-expanded` und `aria-activedescendant` werden angepasst. Tests zuerst, je Szenario aus `specs/sprungpalette/spec.md` ein Fall. Die Paare dabei: Textende gegenüber Cursor mitten im Wort, Zeile mit Vorschau gegenüber Zeile ohne.
- [x] 3.3 In `CommandPaletteProvider.tsx` soll `gehZu(pfad, oeffnung)` für `'neuerTab'` `window.open(pfad, '_blank', 'noopener')` rufen. Test in `CommandPaletteProvider.test.tsx` mit `window.open` als Spy: Die Route bleibt unverändert. Esc aus der Vorschau lässt die Palette über den echten Provider offen, ein zweites Esc schließt sie. Strg+↵ bei offener Palette löst die `speichern`-Aktion einer registrierten Ebene nicht aus.
- [x] 3.4 Fußzeile und Zeilenmarke: `⌘↵`/`Strg+↵ neuer Tab` immer, `→ Vorschau` nur mit Einsatz (Muster Koordinate). An der aktiven Zeile mit Vorschau steht eine `→`-Marke. In der Vorschau stehen öffnen, neuer Tab und zurück. Den Kommentar an der Fußzeile mit der Entscheidung aus LFH-645 fortschreiben und den Satz „⇧↵ im Panel fehlt weiter“ ersetzen. Belegen mit Tests für die Plattformweiche und die Gegenaussage (kein Vorschauhinweis ohne Einsatz, keine →-Marke an einer Modulzeile, kein ⇧↵-Hinweis).

## 4. Browser-Nachweis

- [x] 4.1 In einer eigenen Spec `e2e/palette-oeffnung.spec.ts` (Bauform der übrigen `palette-*`-Specs) folgende Fälle ergänzen: Strg/⌘+↵ auf einem Personentreffer öffnet einen neuen Tab (`context.waitForEvent('page')`), der dort kalt die Personendetailseite angemeldet zeigt, und der Ursprungstab behält seine URL. Der Koordinatensprung im neuen Tab zeigt die Lagekarte. → öffnet die Personenvorschau, Esc führt zurück zur Trefferliste mit Begriff und Markierung, ein weiteres Esc schließt. Belegen mit `pnpm e2e` für die Spec.

## 5. Gates, Doku, Folgetickets

- [x] 5.1 In CLAUDE.md, Abschnitt Bedien-Leitlinie, die Palettenregel eintragen: Öffnungsart als Argument, `ziel` als Marke, Vorschau in der Palette statt Drawer, ⇧↵ frei. Belegen mit einem Diff-Review.
- [x] 5.2 Folgetickets per `clickup-task-anlegen` anlegen: (a) Vorschauen für die übrigen Datensatzsorten, (b) Tippziel für die Vorschau auf Touch/Tablet, (c) gegebenenfalls kalt scheiternde Deeplinks aus 4.1 (entfallen: beide Kaltstarts grün). Angelegt: LFH-664, LFH-665. Belegen mit den angelegten `custom_id`s im Abschlusskommentar von LFH-645.
- [ ] 5.3 `./scripts/check-all.sh` grün. Die Einsatztauglichkeits-Prüfliste (15 Kriterien) für die umgebaute Palette als ClickUp-Kommentar an LFH-645 anhängen. Belegen mit der Ausgabe des Gates und dem Kommentar.
