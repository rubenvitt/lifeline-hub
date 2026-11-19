# Ortspfad der Detailseite führt zurück auf die Liste (LLH-1997)

Zunder: https://zunder.rubeen.dev/#/aufgabe/z7oww8sfepbi4g4mpa016wnn
Folgeaufgabe von LLH-1826 (`2026-11-19-yht1wcsw-ansicht-filter-rueckweg-design.md` auf
`claude/jolly-carson-hjhsz8`, „Offen zur Freigabe“ Punkt 1).

## Absicht

Wer eine Liste filtert, rollt, einen Eintrag öffnet und dann im Ortspfad auf die Liste klickt,
soll die Liste so wiederfinden, wie er sie verlassen hat: gleiche Ansicht, gleiche Filter, gleiche
Rollposition. Heute ist der Ortspfad ein gewöhnlicher Link auf die nackte Liste: man landet
ungefiltert und oben. Im Einsatz kostet das genau die Sekunden, in denen man wieder suchen muss,
wo man war.

## Ziele

- Ortspfad zur Liste = derselbe Rückweg wie Browser-Zurück, wenn man von genau dieser Liste kam.
- Direkt geöffnete Detailseite (Lesezeichen, neuer Tab, Sprungpalette von woanders, Karte): der
  Ortspfad führt wie bisher auf die Liste mit ihrer Vorgabe.
- Kein Einstieg in eine Detailseite muss dafür etwas tun; neue Einstiege sind automatisch dabei.

## Nicht-Ziele

- Keine Rückkehr über mehrere Schritte (Liste → Detail A → Detail B → Ortspfad): dann gilt die
  nackte Liste wie heute.
- Kein Gedächtnis für Listen, die nicht direkt davor lagen; dafür gibt es `listenGedaechtnis`
  (LLH-1086) und die Adresse (LLH-1826).
- Keine Änderung an den Listen selbst, an `Ortspfad` als Darstellung oder an den Pfad-Helfern in
  `routing/deeplinks.ts`.

## Anti-Ziele

- Der Ortspfad darf nie aus der App hinaus oder auf eine fremde Seite zurückspringen
  (`navigate(-1)` auf einen Eintrag, der nicht die Liste ist).
- Mittelklick / Strg-Klick auf den Ortspfad muss weiter einen neuen Tab mit der Liste öffnen.

## Rahmen

- Router: `createBrowserRouter` (`main.tsx`), also `useLocation().key`, `useNavigationType()`.
- Browserspeicher: `sessionStorage` nur abgesichert (wirft auf gehärteten Rechnern), jeder Ort in
  `GERAETESPEICHER` (`offline/geraetRaeumung.ts`, `frontend/src/offline/AGENTS.md`).
- LLH-1826 ist noch nicht auf `alpha`. Abgestimmt (19.11.2026): Basis `alpha`. Der Rückweg selbst
  braucht 1826 nicht; die Rollposition stellt dessen `RollWiederherstellung` bei einem POP her,
  sobald 1826 gemergt ist. Vor dem PR wird `alpha` nachgemergt.

## Ansätze

1. **Zentrales Verlaufsgedächtnis (gewählt).** Ein unsichtbarer Baustein im `BetriebsLayout`
   merkt sich bei jedem PUSH zur neuen Verlaufsstelle (`location.key`) die vorige Adresse
   (`pathname + search`). Der Ortspfad fragt: „War die vorige Adresse meine Liste?“ Ja →
   `navigate(-1)`, sonst Link auf die Liste. Vorteil: rund 25 Einstiege aus Listen, Palette, Karte
   und künftige Einstiege bleiben unberührt. Nachteil: ein neuer Speicherort.
2. **`state.von` an jedem Einstieg** (Aufgabentext, Muster der Hilfe in `BenutzerMenu.tsx`). Jeder
   `Link`/`navigate` aus einer Liste gibt `{ von }` mit. Verworfen: rund 25 Stellen, und jeder neue
   Einstieg, der es vergisst, fällt still auf die nackte Liste zurück; ein Wächter dafür wäre kaum
   genau zu fassen.

Gewählt vom Menschen am 19.11.2026 (Ansatz 1).

## Entwurf

### Verlaufsgedächtnis (`routing/verlaufGedaechtnis.ts`, `routing/VerlaufMerken.tsx`)

- `VerlaufMerken` (ohne Ausgabe) sitzt einmal im `BetriebsLayout` (`App.tsx`), deckt damit
  Einsatz- und Verwaltungsrouten ab. Es hält die zuletzt gesehene Adresse in einem `useRef`.
- Bei jedem Ortswechsel nach `useNavigationType()`:
  - **PUSH:** `merke(neuerKey, vorige)` mit `vorige = { pathname, search }` der Adresse davor.
  - **REPLACE:** die Herkunft des alten Keys auf den neuen übertragen (eine Detailseite, die ihren
    Reiter per `replace` in die Adresse schreibt, behält ihre Herkunft).
  - **POP:** nichts schreiben (der Eintrag trägt seine Herkunft schon).
  - Key `default` (erster Eintrag eines Tabs) bekommt nie eine Herkunft.
- Speicher: `sessionStorage['lfh:verlauf']`, JSON-Liste `[key, adresse]`, höchstens 50 Einträge
  (älteste fallen raus); jeder Zugriff in `try/catch`, ohne Speicher eine Modul-`Map` (überlebt
  dann kein Neuladen, sonst gleich). Überlebt Neuladen im selben Tab, weil `location.key` im
  `history.state` überlebt.
- `GERAETESPEICHER`-Eintrag: `sessionStorage lfh:verlauf`, **geht bei jedem Ausgang** (die
  Adressen tragen Filter- und Suchtexte, auch Namen).
- Lesen: `useVorigeAdresse(): { pathname: string; search: string } | null` für den aktuellen Key.

### Rückweg-Link (`components/ListenRueckweg.tsx`)

`<ListenRueckweg to={listenPfad}>Betroffene</ListenRueckweg>` ersetzt im Ortspfad den `<Link>`
zur Liste.

- Vergleich nur über den **Pfad** (`new URL(to, origin).pathname === vorige.pathname`), nicht über
  die Query: Einsatzkraft (`personalPfad(…, { personal })`) und Befehl
  (`auftraegePfad(…, { befehl })`) zielen auf ihre Liste mit Zeilenmarke; kam man von der Liste,
  ist der Weg zurück trotzdem richtig.
- Passt die vorige Adresse:
  - `href` = vorige Adresse samt Query (Mittelklick/Strg-Klick öffnet die gefilterte Liste im
    neuen Tab),
  - einfacher Linksklick ohne Zusatztaste → `preventDefault`, `navigate(-1)` (POP: Filter aus
    der Adresse, Rollposition durch LLH-1826).
- Passt sie nicht oder fehlt sie: gewöhnlicher `<Link to={to}>` wie heute.
- Darstellung unverändert (es bleibt ein `<a>` im antd-Breadcrumb, auch der „‹ Eintrag“-Rückweg
  unter `md` aus `EinsatzSeite.css`).

### Umstellung (abgestimmter Umfang: Einsatz + Verwaltung)

Ortspfad-Link zur Liste auf `ListenRueckweg` umstellen:

- Einsatz-Detailseiten: `PersonenDetailPage`, `TiereDetailPage`, `SchaedenDetailPage`,
  `BetreuungsstelleDetailPage`, `uhs/UhsDetailPage`, `bereitstellungsraum/BrDetailPage`,
  `EvakuierungsbezirkPage`, `EinsatzkraftPage`, `BefehlDetailPage`, `EinheitDetailPage` und
  `einheit/EinheitAufgeloestAnsicht`, `LageberichtDetailPage`, `verpflegung/AusgabeAnsicht`.
- Unterseiten mit Ortspfad zur Liste: `UnterkunftPlanenPage` (Betreuung), `PersonDruckPage`,
  `AuftragDruckPage`, `personen/AufnahmePage`, `verpflegung/TagAusVorlage`,
  `EinheitAusVorlagePage`. Dort liegt die Liste selten direkt davor; der Baustein fällt dann von
  selbst auf den Link zurück. Ein Ortspfad-Glied auf eine Detailseite (etwa Unterkunft → Stelle)
  bekommt den Baustein ebenfalls: kam man von dort, ist es dasselbe Zurück.
- Verwaltung über den `pfad` von `AdminPage`: `stammdaten/FahrzeugDetailPage`,
  `stammdaten/PersonalDetailPage`, `stammdaten/EinheitVorlageDetailPage`,
  `planung/PlanungPage`, `einstellungen/AnbindungAnsicht`.
- Andere Rückwege auf derselben Seite (Knopf nach Storno, „Zur Liste“ in `SeitenNichtGefunden`,
  `navigate` nach dem Löschen) bleiben, wie sie sind: nach einer Aktion ist ein Zurück in den
  Verlauf nicht gemeint.

### Regel

Neuer Absatz in `frontend/AGENTS.md`, Abschnitt „Deeplink-Muster“: **„Ortspfad zur Liste über
`ListenRueckweg`“**: Ein Ortspfad-Glied, das auf eine Liste (oder eine übergeordnete Seite)
führt, ist `ListenRueckweg`, nie ein nackter `Link`; Herkunft aus dem Verlaufsgedächtnis,
`navigate(-1)` nur bei passendem Pfad. Verweis auf dieses Doc.

### Tests

- Vitest `verlaufGedaechtnis`: PUSH merkt, REPLACE überträgt, POP lässt, `default` ohne Herkunft,
  Obergrenze 50, Speicher wirft → Map.
- Vitest `ListenRueckweg` (MemoryRouter): von der Liste gekommen → Klick geht zurück (Liste mit
  Query steht wieder), `href` trägt die Query; direkt geöffnet → Link auf nackte Liste;
  von anderer Seite → Link; Strg-Klick wird nicht abgefangen.
- Seitentest an einer Detailseite (Person): Liste mit Query → Detail → Ortspfad → Liste mit
  derselben Query.
- e2e (`frontend/e2e`): Betroffene filtern, rollen, Person öffnen, Ortspfad → Filter steht; die
  Rollposition in derselben Spec nur, wenn LLH-1826 vor dem PR auf `alpha` ist, sonst als
  Nachweis nachgeliefert (abgestimmt 19.11.2026).
- `GERAETESPEICHER`-Wächter wird mit dem neuen Eintrag grün.

## Dem Bauenden überlassen

- Genaue Namen der Hilfsfunktionen und die Form der Speicherzeilen.
- Ob der Abgleich „Ortspfad-Ziel ↔ vorige Adresse“ auch `basename` beachten muss (aktuell keiner).
- Ob ein Wächter-Test (`*.guard.test.ts`) nackte `<Link>`s in Breadcrumb-`items` aufspüren kann,
  ohne falsch rot zu werden; sonst trägt die Regel allein.
