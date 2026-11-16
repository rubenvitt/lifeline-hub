# Design

## Context

Motivation: siehe proposal.md, „Why“. Der Lösungsweg ist am Phase-1-Checkpoint am 16.11.2026 mit
Ruben abgestimmt. Ausgangslage im Code:

- **Knopfblock:** `Kartenknopf` in `pages/lagekarte/KartenUeberlagerung.tsx` zeigt nur ein Symbol.
  Der Name steht in `aria-label` und `title`, ist also auf Touch nie sichtbar. Der Knopf ist
  quadratisch mit `kartenKnopfKante(token) = max(32, controlHeight)`. Dieselbe Kante bestimmt, wo
  der Kartenfuß endet (`fussStil(knopfKante)` in `KartenFuss.tsx`) und wie breit die linke
  Überlagerung werden darf (`maxWidth` in `KartenUeberlagerung`). Mitnutzer des Blocks sind
  `personen/BetroffeneKarte.tsx` und `geraet/GeraetAbschnittKarte.tsx`.
- **Leiste:** `leisteSichtbar` (`pages/lagekarte/leistenWahl.ts`) ergibt ohne gemerkte Wahl
  `breit || !istSchmal`, ist ab `md` also offen, unabhängig von der Zeigerart. `useViewport` kennt
  `istBeruehrung` (grober primärer Zeiger, live über `matchMedia`).
- **Kamera:** Marker-Tipp und Listentreffer laufen beide über `waehleObjekt` → `onMarkerWaehlen`
  (`useKartenInteraktion.ts`), und beide setzen `flyToZiel`. `Kartenflaeche` fliegt jedes
  `flyToZiel` mit festem `zoom: ANFLUG_ZOOM` (15) an. Das zoomt heraus, wenn die Karte näher stand.
  `flyToZiel` setzen außerdem Ortssuche, Deeplinks (Zone, Sammelstelle) und das Verorten aus einem
  Auftrag.

## Goals / Non-Goals

**Goals:**

- Ein Wort an den Knöpfen ohne neue feste Breite in der Kartenspalte, die bei 390 px die Karte frisst
  (Zusage in `pages/lagekarte/AGENTS.md`).
- Eine Regel für die Vorgabe der Leiste bei Touch, ohne neuen Speicherschlüssel.
- Eine Regel für jede Kamerabewegung aus `flyToZiel`: heran ja, heraus nie.

**Non-Goals:**

- Leere Zeitachse (`SnapshotLeiste` ohne Stände): Folgeaufgabe.
- Klappzustand des Ebenenbaums (Gruppen) ändert sich nicht. Bei Touch wird die ganze Leiste
  zugeklappt, nicht nur der Baum.
- Bündel-Tipp und „Abschnitt fokussieren“ (`fokusKamera.ts`) bleiben, wie sie sind.

## Decisions

**D1 – Wort unter dem Symbol, Block als Spalte.** Ein Knopf mit Wort bekommt die Form „Symbol,
darunter Wort“ in `fontSizeSM`. Die Knopfbreite wird eine eigene Größe `kartenKnopfBreite(token)`.
Sie ist mindestens die Kante und breit genug für das längste Wort („Position“, „Zeichnen“).
Richtwert ist `max(kante, 56)`; den genauen Wert legt die Umsetzung per Messung im Test fest.
Die Höhe eines Knopfs mit Wort ist `max(kante, 44)`, die Zoomknöpfe behalten die Kante. `fussStil`
und `maxWidth` der linken Überlagerung rechnen mit der Breite statt der Kante. Der `title` entfällt
bei Knöpfen mit Wort. Bei gesperrten Knöpfen bleibt der Sperrgrund wie bisher (Popover und
`aria-describedby`).
Verworfen: Wort neben dem Symbol (Pillen). Der Block würde 120–160 px breit und bräche bei 390 px
die Zusage „keine neue feste Breite“. Ebenfalls verworfen: Wort nur bei Touch, weil es zwei Formen
gäbe und der Befund gerade den Fükw nennt.

**D2 – Zoom bleibt Symbol.** „+“ und „−“ sind eindeutig. Ohne Wort spart der Block im Handschuh bei
390 px zwei Wortzeilen Höhe; er rollt dort schon heute (`maxHeight`, Kommentar im Code).

**D3 – Vorgabe der Leiste aus der Zeigerart.** `leisteSichtbar` bekommt `istBeruehrung` und liefert
`gemerkt ?? (!istBeruehrung && (breit || !istSchmal))`. Vorrang davor bleibt unverändert:
`erzwungen` (Auswahl, ab `lg` die Leistenmodi) und der Kartenmodus unter `lg`. Die Zeigerart wird
live gelesen wie die Breite, weil sie nur greift, solange nichts gemerkt ist. Verworfen: nur beim
Einhängen lesen. Das bräuchte einen eigenen Zustand, bringt aber nichts: Ein 2-in-1, das seine
Tastatur abnimmt, soll die Vorgabe des neuen Zustands bekommen. Wer selbst geklappt hat, ist ohnehin
gemerkt.

**D4 – Marker-Tipp ohne Anflug.** `onMarkerWaehlen` bekommt eine Angabe, ob angeflogen wird.
Der Tipp auf der Karte (`onMarkerKlick` in `LagekartePage`) wählt ohne Anflug, die Objektliste
(`MarkerSuche`, `onWaehlen`) mit. Verworfen: „nur verschieben, wenn der Marker hinter Inspector oder
Leiste läge“. Das braucht eine Verdeckungsrechnung, und der Marker liegt beim Tipp ohnehin dort, wo
die Person hingetippt hat.

**D5 – Anflug zoomt nur heran.** Der Effekt in `Kartenflaeche` fliegt mit
`zoom: Math.max(map.getZoom(), ANFLUG_ZOOM)` und behält `BEDIENUNG`. Das gilt für jedes
`flyToZiel`: Listentreffer, Ortssuche, Deeplinks, Verorten aus einem Auftrag. Eine Regel statt
einer Art je Aufrufer. Für Deeplinks ändert sich praktisch nichts, weil die Karte nach dem Laden in
der Startansicht weiter draußen steht. Die reine Rechnung kommt als exportierte Funktion
`anflugZoom(aktuell)` nach `kamera.ts`, prüfbar ohne Karte.

## Risks / Trade-offs

- [Der Block wird breiter, und der Kartenfuß verliert bei 390 px etwa 24 px Breite (kompakt).] →
  `e2e/fokus-verdeckung.spec.ts` und `e2e/leisten-flaeche.spec.ts` fahren bei 390 und 1024 px in
  `handschuh`; das Szenario „Kartenknöpfe über dem Fuß“ (Spec einsatztauglichkeit-layout) bleibt
  der Maßstab.
- [Der Block wird höher und rollt im Handschuh bei 390 px früher.] → Das ist bestehendes
  Verhalten (rollt, Fokus holt den Knopf herein); die Zoomknöpfe ohne Wort halten es klein.
- [Ein Touch-Fükw, der „fein“ meldet (Stift, angesteckte Maus), behält die offene Leiste.] →
  Gewollt: Dann ist er kein Handschuh-Gerät. Die Person kann die Leiste zuklappen, und die Wahl wird
  gemerkt.
- [Wer den Marker-Anflug gewohnt war, sieht nach dem Tipp keine Bewegung.] → Die Leiste zeigt die
  Auswahl sofort; der Listentreffer fliegt weiterhin an.

## Migration Plan

Keine Datenmigration. Gespeicherte Wahlen (`lfh:lagekarte:leiste-offen:*`) gelten unverändert
weiter. Zurück geht es per Revert des Commits.
