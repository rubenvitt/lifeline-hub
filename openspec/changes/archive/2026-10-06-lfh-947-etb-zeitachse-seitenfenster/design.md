# Design

## Context

`EtbPage` lädt das Tagebuch per `useInfiniteQuery` (Seiten zu 100, `getNextPageParam` über
`before_lfd_nr`, kein `maxPages`, kein `getPreviousPageParam`). TanStack 5.104 lädt bei einer
Invalidierung ab dem ersten Seitenparameter so viele Seiten nach, wie im Cache liegen
(`infiniteQueryBehavior.ts`: `remainingPages = pages ?? oldPages.length`), nacheinander, und setzt
die Daten erst am Ende der Kette. Der Deeplink-Effekt `?eintrag=` ruft `fetchNextPage()`, bis er
das Ziel findet; die Seiten bleiben danach im Cache. Die zentrale Live-Entprellung (Sammler, 300 ms,
`cancelRefetch: false`) bündelt die Ereignisse schon, an der Länge der Kette ändert sie nichts.

Beim Rendern entstehen `eintraege` (`pages.flat()`) und `chronologie` (`baueZeilen`) in `EtbPage`
je Render neu; `teileZufluss` und `gruppiereNachStunde` in `EtbZeitachse` laufen ungemerkt; jede
Zeile rendert `<Markdown>`, das `remarkPlugins={[remarkGfm]}` je Render neu übergibt und nicht
gemerkt ist. Jede Zeile ruft `useViewport()`; das hängt einen eigenen `(pointer: coarse)`-Hörer an
und ruft `Grid.useBreakpoint()`, dessen Beobachter antd 6.6.5 je Instanz anlegt (7 Abfragen).

## Goals / Non-Goals

**Goals**
- Ein Live-Ereignis kostet höchstens `maxPages` Listenabrufe, gleich wie tief geblättert wurde.
- Der Weg zurück zum neuesten Eintrag bleibt lückenlos.
- Ein Rerender ohne geänderte Einträge parst kein Markdown und rendert keine Zeile.
- Die Zahl der Medienabfrage-Hörer hängt nicht von der Zeilenzahl ab.

**Non-Goals**
- `@tanstack/react-virtual`. Erst wenn die Messung nach diesem Schnitt noch Blockaden zeigt.
- Die übrigen Endloslisten (Meldungen, Kräfte); sie übernehmen das Muster in eigenen Tickets.
- Ein Sprung, der das Ziel direkt per Cursor lädt statt Seite für Seite (siehe D4, verworfen).
- Abbruchsignal in `apiGet`.

## Decisions

### D1 Seitenfenster: `maxPages: 5`, Seitenparameter mit Richtung

`useInfiniteQuery` bekommt `maxPages: ETB_MAX_SEITEN` (5, also höchstens 500 Einträge im Fenster)
und einen Seitenparameter mit Richtung:

```ts
type EtbSeitenParam = { aelter: number } | { neuer: number } | undefined; // undefined = Kopf
```

- `getNextPageParam(letzte, _, param)`: `{ aelter: letzte.at(-1).lfd_nr }`, wenn die letzte Seite
  voll ist oder mit `neuer` geholt wurde (eine kurze `neuer`-Seite sagt nichts über Älteres);
  leere `neuer`-Seite: `{ aelter: param.neuer + 1 }`; sonst `undefined`.
- `getPreviousPageParam(erste, _, param)`: am Kopf (`param` undefiniert) `undefined`; eine kurze
  `neuer`-Seite hat den neuesten Eintrag erreicht, also `undefined`; sonst
  `{ neuer: erste[0].lfd_nr }` (bei leerer `aelter`-Seite `{ neuer: param.aelter - 1 }`).

Ein Refetch beginnt bei TanStack mit dem ersten gespeicherten Parameter und folgt dann
`getNextPageParam`. Liegt das Fenster nicht am Kopf, bleibt es dort, wo es ist: neue Einträge
kommen nicht ins Fenster, sondern melden sich über „Neuere laden“ (D3). Am Kopf erscheinen sie wie
bisher oben. Eine erreichte Spitze per kurzer `neuer`-Seite füllt sich beim nächsten Refetch mit
den neuen Einträgen, bis die Seite voll ist; dann erscheint „Neuere laden“ wieder. Lücken entstehen
nie, weil jeder Folgeparameter aus einer gelesenen Nummer stammt.

Startwert 5 aus dem Ticket; die Messung (Aufgabe 7) entscheidet, ob er bleibt. Der persistierte
Lagebild-Stand wird beim Versionswechsel verworfen (`buster = __APP_VERSION__`), alte Zahlen-
Parameter erreichen den neuen Code also nicht.

Verworfen: Fenster ohne Rückweg (nur `maxPages`): nach einem Sprung wäre der neueste Eintrag nur
über Neuladen erreichbar. Verworfen: beim Verlassen des Kopfs auf den Kopf zurücksetzen
(`resetQueries`): offline löschte das die einzigen Daten.

### D2 Server: `after_lfd_nr`

`EtbAbfrageParams.after_lfd_nr` → `repo::EtbFilter.after_lfd_nr`. `abfrage` schreibt dafür
`AND e.lfd_nr > ? ORDER BY e.lfd_nr ASC LIMIT ?` und dreht das Ergebnis vor dem Nachladen der
Folgeaufträge, Anhänge und Berichtigungen auf absteigend; jede Seite hat damit dieselbe Ordnung.
Beide Cursor zugleich → `AppError::UnprocessableEntity` (422: jedes Feld für sich ist gültig,
erst die Kombination nicht; `src/AGENTS.md`, Statuscode-Konvention). Der Cursor bleibt außerhalb von `filter_merkmale`/
`EtbZaehlFilter`: Zählungen können ihn strukturell nicht tragen (LFH-612). Kein neues
Response-DTO, kein Typ-Codegen.

### D3 „Neuere laden“ über der Zeitachse

Solange `hasPreviousPage` gilt, steht über `EtbZeitachse` (unter dem Lesemarken-Banner, im Rahmen)
ein Knopf „Neuere laden“ (`fetchPreviousPage`, `loading` während des Abrufs), gestaltet wie
„Ältere laden“. Nach dem Nachladen bleibt die Leseposition stehen: der Browser hält die
Bildlaufposition bei Einfügungen über dem Sichtbereich per `overflow-anchor` (Vorgabe `auto`);
die Zeitachse setzt dafür nichts. Der Knopf zeigt keine Zahl (Serverzählung bleibt Kopf und
Bilanz, LFH-612).

### D4 Sprung `?eintrag=`: Richtung aus der Kennung

Im Fenster gefunden → hervorheben wie bisher. Sonst: Die Kennung (`id`) eines Eintrags wächst
innerhalb eines Einsatzes mit seiner laufenden Nummer. Beide vergibt dieselbe `INSERT`-Anweisung
(`etb::repo::einfuegen`, `lfd_nr = MAX + 1`, ein Schreiber in SQLite); die übrigen `INSERT`s stehen
nur in Tests. Ist die Ziel-`id` größer als jede im Fenster und `hasPreviousPage`, lädt der Effekt
`fetchPreviousPage`; ist sie kleiner als jede und `hasNextPage`, `fetchNextPage`. Mit `maxPages`
fällt dabei das jeweils andere Ende weg, das Ziel liegt in der zuletzt geholten Seite und bleibt.
Ist in der Richtung nichts mehr zu holen, räumt der Effekt den Parameter wie bisher ohne
Hervorhebung. Offline arbeitet derselbe Effekt auf den hydrierten Seiten; die Warte-Weiche aus
LFH-723 (`isLoading`) bleibt.

Verworfen: Sprung direkt auf die Seite des Ziels (neuer Endpunkt „Seite um Eintrag x“). Spart
beim tiefen Sprung die Kette, braucht aber einen zweiten Weg in die Liste und eine Lücke zum
Kopf, die „Neuere laden“ ohnehin schließt. Kann später kommen, ohne dieses Muster zu ändern.

### D5 Gemerktes Rendern

- `EtbPage`: `eintraege` per `useMemo` über `etbQuery.data`, `chronologie` über
  `[eintraege, ausstehend, abgelehnt]`. Die Handler der Seite dürfen ihre Identität wechseln;
  die Zeitachse fängt das über eine Ref ab (nächster Punkt).
- `EtbZeitachse`: `teileZufluss` und `gruppiereNachStunde` per `useMemo`; die Zeile wird eine
  eigene Komponente `EtbZeitachsenZeile` mit `memo`. Sie bekommt nur, was sich je Zeile ändert:
  die Zeile, „hervorgehoben“, ihre Dokumente, ihren Berichtigungsindex-Ausschnitt als Werte und
  die Handler über einen Ref-Bündel (`useRef` mit den aktuellen Handlern, stabile Aufrufer),
  damit neue Handler-Identitäten keine Zeile neu rendern.
- `Markdown`: `memo`; `remarkPlugins` als Modulkonstante (`[remarkGfm]`).

- **Gruppenschlüssel:** Stunde plus Vorkommen dieser Stunde (`10:00#0`), nicht die erste Zeile.
  Mit der ersten Zeile im Schlüssel hängte ein neuer Eintrag oben die ganze Gruppe neu ein, und
  jeder Text darin würde neu geparst.
- **Stabile Leerlisten:** `useEtbErfassung` gibt für „keine ausstehenden/abgelehnten“ dieselbe
  Modulkonstante zurück, sonst liefe das Memo der Chronologie bei jedem Render leer.

Nachweis: Vitest mit `vi.mock` auf `react-markdown` (Zähler je Parse, `Markdown` selbst bleibt
echt): ein Rerender über neu gebauten Zeilen derselben Einträge parst nichts, ein neuer Eintrag
nur seinen Text.

### D6 Fensterung per `content-visibility`

Jede Stundengruppe (`role="group"`) bekommt `content-visibility: auto` und
`contain-intrinsic-size: auto 600px` (Klasse in `index.css`). Der Browser überspringt Layout und
Malen von Gruppen außerhalb des Bilds; `auto` merkt sich die zuletzt gemessene Höhe, die
Bildlaufleiste springt nicht beim Rückweg. `scrollIntoView` (`scrolleZurZeile`) erzwingt das
Layout des Ziels. Marke `data-lfh="datensicht-karte"`, Zeilenklasse, `h2`-Stundenköpfe und
`scroll-margin` (Fokusabstand) bleiben unberührt. Das Sammelbanner liegt außerhalb der Gruppen.

### D7 Viewport: ein modulweiter Store

`useViewport.ts` hält einen Store mit `useSyncExternalStore`:

- **Abfragen einmal:** Beim ersten Abonnenten legt er je antd-Stufe (`xs` … `xxxl`, 7) und für
  `(pointer: coarse)` eine `MediaQueryList` an und hängt je einen `change`-Hörer an (8). Beim
  letzten Abmelden hängt er alle ab.
- **Schwellen aus antd, nicht gespiegelt:** Die Abfragen baut der Store aus
  `theme.getDesignToken()` (`screenSM` …, `screenXSMax`) in derselben Form wie antds
  `responsiveObserver`. Ein Überschreiben der Schwellen am `ConfigProvider` bleibt verboten
  (Dateikopf), also sind die Werte dieselben.
- **Snapshot:** `getSnapshot` liest `matches` der gehaltenen Listen (kein neuer Hörer) und gibt
  dasselbe Objekt zurück, solange sich kein Wert ändert. `abBreite` hängt am Snapshot und ist
  dadurch ebenso stabil. Die Signatur `ViewportZustand` bleibt.
- **Lebenszeit:** Die `MediaQueryList`s entstehen beim ersten Fragen und werden verworfen, wenn
  der letzte Abonnent geht; die nächste Seite fragt frisch.
- **Erst-Render:** Der Store kennt die Breite schon beim ersten Render. „Unbekannt ⇒ breit“
  (`abBreiteAus`) bleibt für die leere Karte gültig, tritt aber nur noch ohne `matchMedia` auf.
- Der Viewport-Guard bleibt: Medienabfragen stehen weiter nur im Primitiv; `useBreakpoint` fällt
  aus dem Primitiv heraus.

Verworfen: eine einmal eingehängte Quelle, die `Grid.useBreakpoint()` ruft und in einen Store
schreibt: jede Komponente außerhalb des Baums (Tests, Portale vor dem Einhängen) bekäme die leere
Karte, und die Quelle wäre eine zweite Pflichtstelle.

### D8 Kein Neuladen nach leerem Warteschlangen-Abgleich

`useEtbErfassung` gleicht beim Einhängen die Offline-Warteschlange ab und invalidierte danach
immer `['etb', id]`, auch bei leerer Warteschlange. Das lud bei jedem Öffnen das ganze Fenster
neu, und kam der Abgleich nach einem Klick auf „Neuere laden“, brach das Neuladen den Abruf ab
(beobachtet im e2e-Gate als Admin, nicht als Beobachter: nur mit Schreibrecht hängt die
Erfassung). Invalidiert wird jetzt nur, wenn die Warteschlange etwas enthielt.

## Risks / Trade-offs

- **Live-Ereignis während „Neuere laden“/„Ältere laden“** → `invalidateQueries` bricht einen
  laufenden Abruf am Rand ab (`cancelRefetch`), das Fenster lädt sich neu, der Klick ist verloren
  und muss wiederholt werden. Selten (Klick und Ereignis im selben Augenblick) und ohne Datenverlust;
  das Abbruchverhalten der Live-Invalidierung ist Sache der Schwester-Aufgabe zum Live-Stream.

- **Fenster nicht am Kopf, neue Einträge unsichtbar** → „Neuere laden“ steht sichtbar über der
  Zeitachse; Kopfzahl und Lesemarke zählen weiter vom Server. Am Kopf ändert sich nichts.
- **`content-visibility` und Messungen in e2e** → Gates messen Zeilen im Bild; Gruppen im Bild
  werden normal gerendert. Die betroffenen Specs laufen in allen vier Viewports.
- **Kennungsordnung (D4)** gilt nur, solange Einträge allein über `einfuegen` entstehen; ein
  Rust-Test hält die Ordnung `id`/`lfd_nr` in einem Einsatz fest.
- **Store über Testgrenzen** → der Store meldet beim letzten Abonnenten ab und liest `matches` je
  Snapshot neu, Tests, die die Breite vor dem Render setzen, sehen sie also.

## Migration Plan

Keine Datenmigration. API additiv (`after_lfd_nr`); alte Clients schicken ihn nicht.
