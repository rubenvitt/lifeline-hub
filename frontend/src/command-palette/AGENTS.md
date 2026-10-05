# Sprungpalette — Regeln

Gilt für `frontend/src/command-palette/`, ergänzt `frontend/AGENTS.md`. Pfade relativ zu
`frontend/src/`.

- ↵ öffnet, **Strg/⌘+↵** oder Strg/⌘+Klick im neuen Tab, **→** am Textende zeigt die
  Lese-Vorschau in der Palette (Esc/← zurück; Esc **muss** `preventDefault` rufen). Tippziel
  (Chevron) an jeder Zeile mit Vorschau: kein `Button`, `aria-hidden`, `mousedown` abgefangen,
  Maße aus `vorschauZielStil` (`zeilenStil.ts`).
- `Befehl.ziel` ist die Marke, `ausfuehren(oeffnung?)` reicht `'neuerTab'` durch;
  Navigationszeilen nur über `sprungZu` (`command-palette/typen.ts`; Guards `befehle.test.ts`, `datensaetze.test.ts`). Ohne
  Ziel kein Rückfall auf ↵.
- Neue Vorschausorte: `VorschauZiel` + Zweig in `command-palette/Vorschau.tsx` (exhaustiv), Ziel
  in der Quellentabelle von `datensaetze.ts` (nicht in `befehlFuer`), Inhalt als wiederverwendbares Lese-Bauteil
  (`personen/PersonVorschau.tsx`). Vorschau liest das Listenfach per `select` über
  `command-palette/datensatzAbfrage.ts` (gleicher Schlüssel, `queryFn`, `FRISCH_MS`), kein
  Detailfach; ETB über `lfdNr` nur bei gleicher `id`; fehlt der Satz, sagt `VorschauZustand` es.
  Verweise in der Vorschau schließen die Palette.
- **Zeiger** (LFH-1055): eine Zeile markiert sich nur bei **bewegtem** Zeiger (`onMouseMove`
  mit Positionsvergleich, nie `onMouseEnter`); sonst stiehlt ein ruhender Zeiger beim Öffnen und
  Tippen die Markierung, und ↵ öffnet nicht den besten Treffer. Bei offener Palette gehören
  Bearbeitungstasten dem Suchfeld: der Provider ruft für `filter-zuruecksetzen`
  (Strg/⌘+Rücktaste) kein `preventDefault`.
- **Startansicht** (LFH-1055): jeder Befehl steht einmal, in der obersten Gruppe, die ihn führt
  (Kernschlüssel `kernId` in `CommandPalette.tsx`: `ausgefuehrt:<id>` → `<id>`,
  `zuletzt:<modul>` → `modul:<modul>`). Bei aktiver Suche gilt `ohneOrdnungsdubletten`.
- **Fußzeile** einzeilig in jeder Dichte: feste Maße (`tasteStil`), keine Dichte-Polsterung;
  Präfixe mit Kurzwort aus `PALETTE_MODI.kurz`, Langtext als `title`.
- **Fokuszeile** (LFH-507): „Status setzen“ öffnet das `StatusWahl`-Menü der Zeile, die den Fokus
  hat. Die Ebene hängt am Primitiv, ihre Wurzel ist die Zeile (`[data-row-key]` bzw.
  `datensicht-karte`), kein eigener Auswahlzustand. `nurMitFokus` hält zeilengebundene Aktionen aus
  dem Anzeige-Fallback; der Leerfall ist die tragende Aussage (`StatusWahl.palette.test.tsx`).
- **Adresszeile** (LFH-638, `adressSprung.ts`): „Adresse auf Lagekarte suchen“ steht im
  Vorgabemodus immer zuletzt und nie vorausgewählt, auch allein nicht (Stufe 3, Score hinter
  jedem Treffer, Gruppe `ortssuche` zuletzt; Vorgabe -1 in `CommandPalette.tsx`). Sie **springt nur** (`lagekartePfad(id, { ort })`); die Palette fragt den
  Geocoder nie. Rechte wie der Koordinatensprung über `useLagekarteZugang`.
- **Schnellaktionen** (`SCHNELLAKTIONEN` in `befehle.ts`, Guard `schnellaktionen.guard.test.ts`):
  das Ziel liegt unter dem Modulpfad des **eigenen** Trägers, und eine Seite dieses Moduls liest
  den deklarierten `parameter` als Literal (`X.get('neu')` bzw. `X.get('zeichnen')`). `neu` ist die
  Erfassung (`?neu=1`), `zeichnen` der Zeichenmodus der Lagekarte (LFH-825, Träger `lagekarte`,
  `?zeichnen=<zonentyp>`). Eine Zeile ohne Leser gibt es nicht; neue Zeilen ans Ende (Pins in
  `befehle.test.ts`, `befehle.modulstatus.test.ts`), Bestandszeilen ohne `kennung`. Die Zeile
  trägt Icon und Namen des Trägermoduls (`kontext`), die Beschriftung heißt Objekt + Verb
  („Person erfassen“); wer eine Beschriftung ändert, legt die alte als Schlagwort ab (LFH-1055).
