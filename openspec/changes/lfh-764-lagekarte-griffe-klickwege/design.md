# Design

## Context

Motivation: siehe `proposal.md`. Der Stand im Code:

- **Griffe** (`pages/lagekarte/bildHandles.ts`): zehn `maplibregl.Marker` mit `draggable: true`,
  gebaut einmal je Bild. `wendeModusAn()` hängt die Griffe der Arten aus `griffeFuerModus(modus)`
  an und zieht die übrigen ab (`bildGriffe.ts`). Ein Moduswechsel mitten im Zug wartet auf
  `dragend` (`ziehend`, `wartenderModus`), weil ein abgezogener, gerade gezogener Griff tot bliebe
  (LFH-711). Container: achsenparalleles Quadrat der Kante `griffKante(controlHeight)` =
  max(controlHeight, 44), zentriert auf den Griffpunkt. Einen Karten-`move`-Hörer gibt es nicht;
  die Marker folgen ihrer `LngLat` von selbst.
- **Hinweis** (`Sidebar.tsx`, `data-lfh="bildgriff-hinweis"`): `griffHinweis(modus)`, kennt nur den
  Modus.
- **Klickwege** (`Kartenflaeche.tsx`): eigene `map.on('click', layer, …)`-Hörer für
  `abschnitte-fill`, `zonen-fill|line|line-gestrichelt`, die Fachebenen (`fachebeneClickLayerIds`),
  Marker und Spider (`MARKER_KLICK_LAYER`, `SPIDER_KLICK_LAYER`, gewählt per `naechstesMerkmal`) sowie
  einen globalen Hörer für Personen-Cluster und Spider-Einklappen. Nur der Personen-Cluster ist
  bereits geschiedsrichtert (`personenClusterAm` → `personenClusterTreffer` in `markerLayer.ts`).
  Die übergebenen Callbacks (`onZoneKlick`, `onFlaecheKlick`, …) sind in `useKartenInteraktion`
  nicht memoisiert, die Effekte binden also jede Render-Runde neu, und die Hörer-Reihenfolge ist
  nicht stabil. Die Marker-Ebenen liegen über allen Daten-Ebenen (`MARKER_LAYER_REIHENFOLGE`,
  `moveLayer` ans Ende), Trefferzonen zuunterst unter den Markerzeichen.

## Goals / Non-Goals

**Goals:**
- Griffwahl als reine, ohne Karte prüfbare Funktion; die Karte liefert nur Pixelpositionen.
- Ein Schiedsrichter als reine Funktion über das Ergebnis von `queryRenderedFeatures`, der den
  Personen-Cluster-Fall mit abdeckt (`personenClusterTreffer` geht darin auf).
- Beide Regeln e2e mit Mutationsprobe belegt.

**Non-Goals:**
- Kräfte-Cluster als DOM-Donut (`clusterDonut`): liegen als DOM über dem Canvas und laufen nicht
  über die Karten-Klickhörer; unverändert.
- `onKarteKlick` (Verorten, Zeichen platzieren): gilt nur in exklusiven Modi und ist dort bereits
  alleiniger Empfänger (die übrigen Handler sind per `exklusiverModusAktiv` gesperrt); unverändert.
- Mauszeiger (`mouseenter`/`mouseleave`) bleibt je Ebene.
- Griffe außerhalb des Platziermodus und die Griff-Geometrie (`bildGeometrie.ts`) bleiben unberührt.

## Decisions

### D1 — Griffwahl: Ecken fest, Kanten nur mit Platz, symmetrisch

`scharfeGriffe(modus, punkte, kante)` in `bildGriffe.ts`, rein. `punkte` sind die Pixelpositionen
aller Griffe (Ecken 0–3, Kanten oben/rechts/unten/links). Zwei Container überlappen, wenn
`|dx| < kante && |dy| < kante` (achsenparallel, auch bei gedrehtem Bild, weil die Container nicht
mitdrehen). Im Modus „Größe": alle Ecken; eine Kante nur, wenn sie **keine Ecke und keine andere
Kante** überlappt.

- *Warum symmetrisch statt gierig* (erste Kante nehmen, dann die nächste gegen die schon genommenen
  prüfen): gierig hinge die Wahl von der Aufzählreihenfolge ab. Bei einem 300 × 60 px-Bild bekäme
  „oben" den Griff und „unten" nicht. Symmetrisch fallen beide weg, die Wahl ist vorhersagbar.
- *Verworfen:* „Größe" in „Ecken"/„Kanten" teilen. Das allein reicht nicht: benachbarte
  Kantenmitten eines Quadrats der Seite s liegen s/2 auseinander, in der Handschuh-Stufe (72 px)
  überlappen sie also unter 144 px.
- *Ecken fest:* Ohne Ecke wäre ein winziges Bild gar nicht mehr skalierbar. Der Rest (Bild kleiner
  als eine Griffkante) ist in der Spec benannt.
- Rückgabe zusätzlich `kantenAus: 'keine' | 'einige' | 'alle'` (wie viele Kanten im Modus „Größe"
  fehlen). Dreiwertig nach dem Review: auf einem langen, schmalen Bild bleiben die langen Kanten
  bedienbar, und der Hinweis soll sie weiter nennen.

### D2 — Neuentscheidung an Kartenbewegung und `dragend`, nie im Zug

`bildHandles` meldet einen Hörer auf `map.on('move')` an (deckt Zoom, Drehung, Verschieben) und
entscheidet nach jedem `dragend` neu, ebenso nach `setzeEcken` (Refetch, numerische Eingabe; beim
Umsetzen ergänzt). Läuft ein Zug (`ziehend`), wird nichts an- oder abgehängt.
Abgehängt oder angehängt wird nur, wenn sich die Menge ändert, damit `move` pro Frame nichts am
DOM tut. `zerstoeren()` meldet den Hörer ab. Positionen kommen aus `map.project` der Griff-`LngLat`,
also aus derselben Quelle wie die Marker.

### D3 — Hinweis bekommt den Zustand per Rückruf

`erzeugeBildHandles(…, onGriffStand?)` ruft `onGriffStand({ kantenAus })` bei jeder Änderung.
`Kartenflaeche` reicht das über eine neue Prop `onGriffStand` an `LagekartePage`, die den Wert als
State an `Sidebar` gibt. `griffHinweis(modus, { kantenAus })` nennt bei `alle` nur die Ecken und das
Heranzoomen, bei `einige` Ecken und Kanten und dazu, dass weitere Kanten nach dem Heranzoomen
erscheinen.
Der Rückruf geht wie `onPlatzierGeometrie` über einen Ref, damit ein neuer Callback die Griffe
nicht neu baut.

### D4 — Klick-Schiedsrichter als reine Funktion plus Ereignis-Cache

Neues Modul `pages/lagekarte/klickziel.ts`:

- `ordneKlickebene(layerId)` → `'marker' | 'treffer' | 'personenCluster' | 'fachebene' | 'zone' |
  'abschnitt' | 'fachebeneFlaeche' | null` aus den bekannten Listen (`MARKER_KLICK_LAYER`,
  `SPIDER_KLICK_LAYER`, `PERSONEN_CLUSTER_KLICK_LAYER`, Trefferzonen per `-treffer`-Suffix,
  `fachebene-*-circle|-buendel`, `fachebene-*-fill`, `ZONEN_KLICK_LAYER`, `abschnitte-fill`).
- `entscheideKlickziel(features, punkt, projiziere)` → Gewinner-Union
  `{ art: 'marker', merkmal } | { art: 'personenCluster', clusterId, center, anzahl } |
  { art: 'fachebene', merkmal } | { art: 'zone', merkmal } | { art: 'abschnitt', merkmal } | null`.
  Regel aus der Spec: oberstes Punktziel; ist es ein Marker/Spider, wählt `naechstesMerkmal` unter
  allen Marker-/Spider-Merkmalen (wie heute); sonst Trefferzone (`naechstesMerkmal` unter den
  Trefferzonen); sonst oberste eigene Fläche (Zone, Abschnitt); sonst oberste Fachebenen-Fläche.
- *Eigene Flächen vor Fachebenen-Flächen* (Review-Befund, Entscheidung des Users 29.09.2026):
  Später aktivierte Fachebenen hängt `addLayer` ans Ende, NINA-/DWD-Warnflächen liegen also immer
  über Zonen und Abschnitten und decken oft einen ganzen Kreis ab. „Oberste Fläche" machte jede Zone
  darunter unerreichbar. Die Warnung bleibt außerhalb eigener Flächen antippbar. Ein Auswahlmenü
  für übereinanderliegende Flächen ist LFH-812.
- In `Kartenflaeche.tsx`: `klickzielAm(map, e)` fragt `queryRenderedFeatures(e.point, { layers })`
  über **alle** vorhandenen Klickebenen (`map.getLayersOrder()`, gefiltert per `ordneKlickebene`)
  und cacht das Ergebnis in einer `WeakMap` am `e.originalEvent`. Die fünf Hörer
  eines Tipps teilen so eine Abfrage und dasselbe Urteil.
- Jeder bestehende Hörer bleibt an seiner Stelle und prüft zuerst, ob er der Gewinner ist
  (Zonen-Hörer: `art === 'zone'`, jetzt EIN Hörer über alle drei Zonen-Ebenen; Fachebenen-Hörer:
  `art === 'fachebene'` und dieselbe Ebene). `personenClusterAm` wird durch `klickzielAm(...).art === 'personenCluster'`
  ersetzt, `personenClusterTreffer` geht in `entscheideKlickziel` auf; seine Tests wandern mit.
- *Warum nicht ein zentraler Hörer, der alles verteilt:* größerer Umbau von `Kartenflaeche.tsx`
  (Fachebenen-Bündellogik, Spider), ohne dass die Regel dadurch anders würde. Der Cache am
  Originalereignis gibt dieselbe Eindeutigkeit, der User hat „alle Handler fragen denselben
  Schiedsrichter" gewählt.
- *Warum nicht „Trefferzone weicht allem Gezeichneten":* Zonen und Abschnitte liegen fast immer
  unter Markern; die Trefferzone aus LFH-711 wäre dann in jeder Fläche wirkungslos.

### D5 — Nachweise

- Vitest: `scharfeGriffe` (Quadrat 120 px in 44/48/72, gedreht 45°, 300 × 60, 30 × 30,
  Verschieben/Drehen je ein Griff) und `entscheideKlickziel` (jede Rangstufe, Nächstes-Merkmal
  unter Markern, Personen-Cluster-Fälle aus den bisherigen `personenClusterTreffer`-Tests).
  `bildHandles.test.ts`: kein An-/Abhängen während `ziehend`, Neuentscheidung bei `dragend` und `move`.
- e2e `lagekarte-touch.spec.ts` (hat `hasTouch` und die Trefferwache):
  - Griffe: Kartenbild per API anlegen und platzieren, Bildgröße über `jumpTo`-Zoom auf rund
    120 px stellen, Dichte per Einstellung; Bounding-Boxen aller angehängten
    `[data-lfh^="bildgriff-"]` paarweise überlappungsfrei, je Dichte und gedreht. Mutationsprobe:
    Kantenregel aus → rot.
  - KRITIS: Fachebenen-Endpunkt per `page.route` mit einer Traube eng liegender Objekte neben
    einem Marker stubben, Ebene sichtbar schalten, Tipp auf den Bündelpunkt im Ring (per
    `elementFromPoint`-Wache auf dem Canvas): `getZoom` steigt, kein Marker-Inspector.
    Mutationsprobe: Schiedsrichter im Fachebenen-Zweig aus → rot.

## Risks / Trade-offs

- [Verhaltensänderung: Zeichen über Fläche wählt nur noch den Marker] → gewollt und in der Spec;
  die Fläche bleibt daneben antippbar. In der Abschlussmeldung benennen.
- [Zwei eigene Flächen übereinander: die untere ist per Tipp nicht wählbar] → bewusst hingenommen,
  bis LFH-812 ein Auswahlmenü bringt.
- [`move` feuert pro Frame] → Rechnung ist zehn `project`-Aufrufe; DOM nur bei Mengenwechsel.
- [Rendering-Reihenfolge der Flächen ändert sich später] → der Schiedsrichter liest die Reihenfolge
  aus `queryRenderedFeatures` (oben zuerst), nicht aus einer eigenen Liste.
- [Kanten verschwinden während eines Eck-Zugs nicht, obwohl sie überlappen] → bewusst (D2); nach
  `dragend` stimmt der Zustand.
- [Unbekannte neue Klickebene] → `ordneKlickebene` liefert `null`; der Hörer dieser Ebene gilt dann
  nie als Gewinner. Ein Vitest pinnt, dass jede Ebene aus den Klicklisten und aus
  `fachebeneClickLayerIds` eingeordnet ist.
