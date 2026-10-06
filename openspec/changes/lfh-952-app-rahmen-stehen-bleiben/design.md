## Context

Stand `alpha` fd06e31 (06.10.2026). Die Seite rollt im Dokument; `AppLayout` und
`EinsatzLayout` wachsen mit (Höhenkette, LFH-343). Der Kopf (`Header` mit `KOPF_STIL`) ist
statisch, nur Rail-Fuß und Panel-Fuß kleben unten. Die Betriebszeile steht in `BetriebsLayout`
(`App.tsx`) über beiden Layouts im Fluss. Oben kleben heute: stehende Tabellenköpfe
(`KatalogTabelle`, Gefahrenmatrix; rc-table ohne `offsetHeader`), die Bilanzspalte des ETB
(`top: token.margin`) und drei Sammelbanner-Überlagerungen mit `top: 0` (ETB-Zeitachse,
Erfassungsanhänge, Infotelefon). Sobald der Kopf klebt, lägen sie alle unter ihm.

Entscheidung 6 der Klärungsrunde (06.10.2026, Option A,
`/mnt/project-files/lfh-917/klaerungsrunde-welle4.md`) legt das Verhalten fest; dieser Entwurf
legt fest, wie.

## Goals / Non-Goals

**Goals:** Kopf, Rail-Symbole und Verbindungsstatus beim Rollen erreichbar, gestuft je Gerät;
kein Element verschwindet unter dem klebenden Kopf; Abmelden ohne Rollen; mehr Inhaltsbreite am
Tablet quer.

**Non-Goals:** Ortspfad, Seitentitel, Rückweg von Profil und Verwaltung (Task „Orientierung“).
Helligkeit als Segmentleiste. Ein eigener Scrollcontainer für den Inhalt (bräche die Höhenkette
und jeden `window.scrollTo`-Nachweis).

## Decisions

### D1 Gestuft kleben

- **Ab `md`:** `Header` in `EinsatzLayout` und `AppLayout` mit `position: sticky; top: 0` und
  `zIndex: RAHMEN_EBENE` (über Inhalt und ETB-Leiste, unter antds Overlays ab 1000). Die
  Hauptgruppe der Rail (Kategorien, ab `lg`) klebt mit `top: var(--lfh-rahmen-oben)`; der Fuß
  klebt weiter unten. Das Modulpanel klebt nicht, seine Liste rollt mit der Seite.
- **Unter `md`:** der Kopf rollt (~140 von 844 px wären zu teuer). Die Betriebszeile klebt mit
  `top: 0`, solange sie eine Verbindungsstörung meldet: `navigator.onLine === false` oder
  Live-Status `lost`. Andere Hinweise (Queue, neue Version, Verbindungsaufbau) rollen weiter.
- Ab `md` klebt die Betriebszeile nicht: die SYNC-Zelle im klebenden Kopf trägt jede Störung
  als Wort (`syncZeigtWort`), der Zustand bleibt also sichtbar.

Verworfen: der ganze Kopf auf jeder Breite fest (Option B der Klärungsrunde); ein eigener
Scrollbereich unter dem Kopf (Höhenkette, Sticky-Leisten und e2e-Rollnachweise hängen am
Dokument).

### D2 Eine gemessene Höhe: `--lfh-rahmen-oben`

Neuer Baustein `components/rahmenOben.ts`: ein `ResizeObserver` am jeweils klebenden Element
(ab `md` der Kopf, unter `md` die Betriebszeile im Störungsfall) schreibt dessen Höhe als
`--lfh-rahmen-oben` an `document.documentElement` und hält sie in einem kleinen Store
(`useRahmenOben()` per `useSyncExternalStore`). Ohne klebendes Element ist der Wert `0px`.
Gemessen statt gerechnet, weil der Kopf umbricht (LFH-460) und mit der Staffel wächst.

Jedes oben klebende Element liest diese Höhe:

- rc-table braucht eine Zahl: `KatalogTabelle` und Gefahrenmatrix setzen
  `sticky={{ offsetHeader: useRahmenOben() }}`; der Fokusfreiraum der Tabelle
  (`--lfh-tabellenkopf-hoehe`) addiert sie in `theme/sprache.css` bzw. `gefahrenMatrix.css`.
- ETB-Bilanz `top: calc(var(--lfh-rahmen-oben, 0px) + margin)`, die drei
  Sammelbanner-Überlagerungen `top: var(--lfh-rahmen-oben, 0px)`, die Rail-Gruppe ebenso.
- Ein Guard (`components/rahmenOben.guard.test.ts`) verbietet `top: 0` an einem klebenden
  Element unter `src/` außerhalb des Rahmens, damit ein neues nicht still unter den Kopf rutscht.

### D3 Fokusabstand oben (WCAG 2.4.11)

`scroll-padding-block-start: var(--lfh-rahmen-oben, 0px)` am Scrollport (`:root`, Regel in
`index.css`), ausgesetzt, solange der Fokus im klebenden Rahmen selbst steht:
`:root:has([data-lfh='rahmen-kopf'] :focus, [data-lfh='betriebszeile'] :focus)` setzt ihn auf
`0px`. Gemessen am 06.10.2026 in Chromium mit einem 60-px-Kopf und 30-px-Zielen:

| Form | Shift+Tab auf ein Ziel ganz hinter dem Kopf | Fokus auf ein Ziel im Kopf |
| --- | --- | --- |
| ohne Abstand | bleibt bei `top = 28`, verdeckt | rollt nicht |
| `scroll-margin-block-start` an den Zielen (Muster LFH-373) | bleibt bei `top = 28`, verdeckt | rollt nicht |
| `scroll-padding-block-start` am Dokument | rollt, Ziel frei | rollt die Seite (1000 → 787 px) |
| `scroll-padding` mit `:has(… :focus)`-Ausnahme | rollt, Ziel frei | rollt nicht |

`scroll-margin` versagt also wie bei LFH-475: ein Ziel, das schon im Fenster liegt, rollt
Chromium nicht. `scroll-padding` allein rollte bei jedem Tab in den Kopf die Seite (dieselbe
Falle wie die ETB-Leiste unten, LFH-373). Die Ausnahme per `:has` greift, weil der Browser den
Stil mit dem neuen Fokus rechnet, bevor er das Ziel ins Bild rollt.

### D4 Benutzermenü

Reihenfolge: Kopf · Profil · Abmelden · Trenner · Darstellung · Bediendichte · Helligkeit. Die
Gruppen bleiben auf jeder Breite (LFH-392), die Helligkeit bleibt fünf Einträge
(`bedien-helligkeit`, „Stufen im Benutzermenü“). Der Menükopf zeigt die Einsatzfunktion
(`meine_funktion`) unter dem Namen, wenn es eine gibt, auf jeder Breite; der Auslöser behält
seine `xl`-Schwelle. „Abmelden“ bleibt rot und steht durch den Trenner abgesetzt neben
Neutralem.

### D5 Modulpanel: Griff und Vorgabe je Breite

- `navPersistenz` merkt drei Werte: zu (`'1'`), offen (`'0'`), keine Wahl (kein Eintrag). Bisher
  hieß „kein Eintrag“ offen; ab jetzt heißt es „Vorgabe der Breite“.
- Ohne Wahl: zwischen `lg` und `xl` zu, ab `xl` offen. Mit Wahl gilt sie auf jeder Breite.
- Griff in der Rail, im klebenden Fuß über „Einstellungen“: Icon `IconSeitenleisteZu`/`Auf`
  und sichtbares Etikett „Menü“, `aria-expanded`, `aria-controls` auf das Panel
  (`id="modul-panel"`, solange es steht), Name „Menü einklappen“ bzw. „Menü ausklappen“ (beginnt mit dem sichtbaren Etikett, WCAG 2.5.3). Er schreibt die
  Wahl. Der Selbstklick auf die offene Kategorie bleibt als zweiter Weg und trägt ebenfalls
  `aria-expanded`.
- Ein Kategorie-Sprung öffnet das Panel wie heute, schreibt aber keine Wahl mehr: sonst wäre
  nach dem ersten Sprung am Tablet die Vorgabe „zu“ für immer weg.

### D6 Abschnittszeile im Überblick

Die Zeile wird ein Raster über eine Containerabfrage am Paneel (`ueberblick.css`):
breit `Kante | Name | Auftrag | Stärke`, unter 560 px Listenbreite `Kante | Name | Stärke`, darunter
`Auftrag` über Name und Stärke. Die Reihenfolge im DOM bleibt (Linkname unverändert).

## Risks / Trade-offs

- **Ein übersehenes klebendes Element** rutscht unter den Kopf → Guard aus D2 und die e2e-Messung
  „Tabellenkopf unter dem Rahmen“.
- **Höhensprung beim Einhängen des Beobachters:** der Wert steht nach dem ersten Bild; bis dahin
  gilt der Vorgabewert `0px` und ein Tabellenkopf säße ein Bild lang unter dem Kopf. Der erste
  Wert wird deshalb synchron in `useLayoutEffect` gemessen.
- **Vorgabe zu am Tablet quer** ändert, was Nutzer ohne Wahl heute sehen → gewollt
  (Entscheidung 6); die Wahl bleibt einen Griff entfernt.

## Nachweis

- Vitest: Menüreihenfolge (Abmelden direkt nach dem Kopf), Funktion im Menükopf unter `xl`,
  `navPersistenz` dreiwertig, Vorgabe je Breite, Griff mit `aria-expanded`, Rahmen-Store.
- e2e `rahmen-stehen-bleiben.spec.ts` auf 390/820/1180/1440: nach `scrollTo(0, 1500)` im ETB ab
  `md` Kopf `top ≥ 0` mit `position: sticky` und Rail-Kategorien im Fenster; offline auf jeder
  Breite der Zustand sichtbar (Kopf bzw. Betriebszeile); Abmelden ohne Rollen sichtbar und
  geklickt auf 390 und 1180 in `handschuh`; bei 1180 mit offenem Panel Stärke auf Höhe des
  Namens; Tabellenkopf unter dem Rahmen. Als Admin und nicht-privilegiert (`rollen-kern.ts`).
- `fokus-verdeckung.spec.ts`: „Kopf verdeckt keinen Fokus“ mit Shift+Tab; Mutationsprobe ohne
  Abstand rot.
