# Renderkosten von Personal und Betroffene beim Öffnen senken — Design

Zunder: https://zunder.rubeen.dev/#/aufgabe/nuokxhqs4uym2tyer8n6oemd (LLH-1974, Folge von
LLH-1838). Route `entwurf` (E2: neue Regel in `frontend/AGENTS.md`). Weg abgestimmt am 19.11.2026.

## Absicht

Seit LLH-1838 stehen Kopf und Gerippe beim Modulwechsel sofort. Danach blockiert aber das
Einhängen der echten Seite den Hauptthread am Stück: am Fükw wirkt die Oberfläche dabei
eingefroren, auf schwachen Einsatzrechnern und in großen Lagen noch länger. Ziel ist, dass das
Öffnen von **Personal** und **Betroffene** den Hauptthread höchstens **~100 ms am Stück**
blockiert (Produktions-Build, Messaufbau unten).

## Befund (Messung 19.11.2026)

Messaufbau: Produktions-Build über `vite preview`, Backend mit `--demo-daten`, Lage Starkregen,
Chromium headless, Cloud-Container mit 4 Kernen, 1440 × 900. Gemessen wurde der client-seitige
Wechsel vom Überblick (`history.pushState` + `popstate`) mit `PerformanceObserver('longtask')`,
je 3–4 Runden. Ein CPU-Profil und ein Trace am Profiling-Build (`react-dom/profiling`,
unminifiziert) ordnen die Kosten zu.

| Stand | Personal, längste Blockade | Betroffene, längste Blockade |
| --- | --- | --- |
| Ausgangslage | 158–238 ms | 111–152 ms |
| Tabelle ausgeblendet (Gegenprobe) | keine > 50 ms | keine > 50 ms |
| Probe: Overlays bei Bedarf + Kopf-Freiraum | 114–174 ms | 74–97 ms |
| Spike: zusätzlich stückweise (4 Zeilen je Schritt) | 82–144 ms | 82–105 ms |

Die Tabelle trägt die ganze Blockade, obwohl sie nur 12 Zeilen hat (~800 Elemente). Die
Zeilenzahl ist nicht das Problem, die Kosten je Zeile sind es:

1. **Overlays je Zeile.** Jede `InlineAngabe` (Einheit, Fahrzeug, Position, Funktion) hängt
   auch geschlossen ein antd-`Popover` ein (`mitPopover`), `StatusWahl` ein `Dropdown`,
   `EinsatzfunktionZelle` einen `Tooltip`. Ihr Trigger (`@rc-component/trigger`) setzt beim
   Einhängen Zustand im Commit (`setTargetEle` aus der Ref, `resetReady` im Layout-Effekt). React
   rendert die Zeilen deshalb ein zweites Mal **synchron im Commit** (`flushSpawnedWork` →
   `performSyncWorkOnRoot`, ~180 ms im Profiling-Build). Bei Personal sind es 452
   Zustandsänderungen im Commit, mit Overlays bei Bedarf noch 272.
2. **Style-Recalc in Serie.** `setzeKopfFreiraum` (`components/KatalogTabelle.tsx`) schreibt drei
   CSS-Variablen an die Tabellenwurzel und misst zwischen den Schreibzugriffen. Jede Messung
   erzwingt eine volle Style-Neuberechnung der Tabelle (3 × 12–25 ms). Dazu kommen rc-tables
   `StickyScrollBar`, das `scrollWidth` im Render liest, und `measureScrollbarSize`.
3. **Ein großer Commit.** Auch ohne 1 und 2 hängt der erste Commit alle Zeilen auf einmal ein.

## Ziele, Nicht-Ziele, Anti-Ziele

- **Ziel:** Personal und Betroffene blockieren beim Öffnen höchstens ~100 ms am Stück. Fahrzeuge
  und alle anderen Listen der `Datensicht` profitieren mit.
- **Ziel:** Eine Regel verhindert, dass neue Zellen wieder je Zeile einen Trigger einhängen.
- **Nicht-Ziel:** rc-table austauschen, die stehende Kopfzeile (LFH-952) umbauen, die
  Virtualisierung ab 201 Zeilen (LFH-949) ändern. Die Lagekarte gehört nicht dazu.
- **Anti-Ziel:** Ein Bedienweg ändert sich. Ein Popover öffnet anders, ein Fokus geht verloren,
  ein Deeplink (`?personal=<id>`) trifft seine Zeile nicht mehr, der Druck zeigt nicht alle Zeilen.

## Ansätze

- **A — Nur die Zellen schlanker** (Overlays bei Bedarf, Kopf-Freiraum). Kleiner Eingriff,
  Betroffene erfüllt damit das Kriterium, Personal nicht (114–174 ms). Mit mehr Zeilen wächst die
  Blockade wieder linear. Allein verworfen.
- **B — A und stückweises Rendern in der `Datensicht` (gewählt, 19.11.2026).** Der erste Commit
  enthält Kopf, Werkzeugzeile und die ersten Zeilen, der Rest folgt in eigenen Aufgaben. Das wirkt
  für jede Liste und jede Lagegröße unter der Virtualisierungsschwelle.
- **C — Virtualisierung schon ab wenigen Zeilen.** Verworfen: Ruben hat die Schwelle am
  07.10.2026 bewusst auf 201 gesetzt (Strg+F, Druck, Zeilennummern), und auch C ließe die Overlay-
  und Style-Kosten je sichtbarer Zeile stehen.

## Entwurf

### 1. Overlays erst bei Bedarf einhängen

Ein kleiner Hook `useErstBeiBedarf(offen: boolean): boolean` (in `components/`) liefert `true`,
sobald `offen` einmal `true` war, und bleibt dann dabei. Gesetzt wird im Render, nicht per Effekt
(wie das bestehende Muster „Zustand beim Rendern angepasst“ in `InlineAngabe`), damit das Overlay
im selben Render mit `open` eingehängt wird.

- **`InlineAngabe`** (`components/InlineAngabe.tsx`): Schwebend steht bis zum ersten Öffnen nur
  der Anker-`span` (`data-lfh="angabe-anker"`, `anchorRef`) ohne `Popover`. Ab dem ersten Öffnen
  rendert `mitPopover` wie heute.
- **`StatusWahl`** (`components/StatusWahl.tsx`): Bis zum ersten Öffnen steht nur der
  `StatusKnopf` mit `onClick`, der `setzeOffen(true)` ruft. Palette und Tastaturebene öffnen über
  `oeffne`, wie heute. Ab dem ersten Öffnen steht der `Dropdown` wie heute.
- **`EinsatzfunktionZelle`** (`kraefte/EinsatzfunktionZelle.tsx`): Der `Tooltip` „Funktion
  eintragen“ hängt sich beim ersten `pointerenter` oder `focus` des Knopfs ein und öffnet dann
  sofort.

**Folge, die getestet wird:** Beim ersten Öffnen wechselt der Elternknoten des Auslösers, React
hängt den Knopf neu ein. Danach liegt der Fokus wie heute im Formular bzw. im Menü (`autoFocus`),
und beim Schließen kehrt er zum **neuen** Knopf zurück (`useFokusRueckgabe` hält die Ref,
`Dropdown` den Trigger). Beim Tooltip geht der Fokus durch das Neueinhängen nicht verloren: hat
der alte Knopf ihn gehalten, bekommt ihn der neue.

### 2. Kopf-Freiraum: erst messen, dann schreiben

`setzeKopfFreiraum` liest die drei Maße (Kopfhöhe, Breite der fixierten Kennung, Breite der
Aktionsspalte) zuerst und schreibt danach nur, was sich geändert hat
(`style.getPropertyValue(name) !== wert`). Aus drei Style-Neuberechnungen wird höchstens eine, und
ein `ResizeObserver`-Lauf ohne Änderung schreibt gar nichts.

### 3. Stückweises Rendern in der `Datensicht`

- **Wann:** nur beim **ersten Anzeigen** der Liste und nur, wenn sie nicht virtualisiert ist, nicht
  druckt und mehr als `STUECK_ZEILEN` Zeilen hat. Spätere Änderungen (Filter, Sortierung, Live-Daten)
  rendern sofort vollständig: der Effekt trifft das Öffnen, nicht die Bedienung.
- **Wie:** Der erste Commit enthält die ersten `STUECK_ZEILEN` Zeilen (Vorschlag 4, im Spike
  gemessen), danach folgen je `STUECK_ZEILEN` weitere in einer eigenen Aufgabe (`setTimeout(…, 0)`),
  bis alle stehen. Jede Aufgabe ist ein eigener Commit, also eine eigene, kürzere Blockade.
- **Wo:** im Tabellenzweig (`tabellenZeilen`) und in der ungruppierten Kartenliste. Der gruppierte
  Kartenzweig und der Baum bleiben vollständig (kleine Mengen, eigene Folge-Logik).
- **Deeplink:** Trägt eine Zeile `HERVORGEHOBEN`, rendert die Liste sofort vollständig, damit
  `scrolleZurZeile` (`PersonalPage`, `PersonenPage`, …) sie findet.
- **Zähler und Banner** rechnen weiter mit `sichtbareZeilen`: nur das Rendern wird gestückelt, nie
  die Folge (wie bei der Virtualisierung, D2 von LFH-949).
- **Tests:** In der Vitest-Umgebung ist das Stückeln aus (Schalter im Modul, gesetzt in
  `src/test/setup.ts`), damit bestehende Tests weiter synchron alle Zeilen sehen. Eigene Tests
  schalten es ein und prüfen Reihenfolge, Abschluss, Deeplink und Druck.

### 4. Regel in `frontend/AGENTS.md`

Unter „Bedien-Leitlinie“ (Abschnitt zu Listen und Zellen) eine Zeile:

> **Overlays in Zeilen erst bei Bedarf** (LLH-1974): Ein Baustein, der je Zeile einer Liste steht,
> hängt `Popover`, `Dropdown` oder `Tooltip` erst beim ersten Öffnen ein (`useErstBeiBedarf`). Ein
> geschlossener Trigger je Zeile kostet beim Öffnen der Seite einen zweiten, synchronen Render aller
> Zeilen. Die `Datensicht` rendert beim ersten Anzeigen stückweise (`STUECK_ZEILEN`).

Die Bausteine nennen die Regel im Dateikopf.

## Nachweis

- Vitest: je Baustein der Weg „erstes Öffnen → Fokus im Overlay → Schließen → Fokus am Knopf“
  sowie für die `Datensicht` das Stückeln (an, aus, Deeplink, Druck, spätere Änderung).
- Messung am Produktions-Build mit dem Aufbau oben, vorher und nachher, im PR unter „Geprüft“ und
  als Kommentar an LLH-1974. Ziel: Personal und Betroffene ≤ ~100 ms längste Blockade.
- Kein e2e-Lauf nur für die Messung: Zeiten im Container schwanken um ±40 ms, als Gate wäre das
  wacklig.

## Dem Bauenden überlassen

- Name und Ort des Schalters für das Stückeln in Tests; ob `STUECK_ZEILEN` 4 oder 5 ist, wenn die
  Messung es nahelegt.
- Ob `useErstBeiBedarf` auch `Segmentleiste` (Tooltip nur bei gesperrten Segmenten) betrifft: nur,
  wenn es dort je Zeile steht (heute nicht).
