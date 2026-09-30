# Proposal

## Why

LFH-711 hat den Lagekarten-Markern fingergroße Trefferzonen und den Bildgriffen eine Mindestfläche
von 44–72 px gegeben. Beim Review sind zwei Reste aufgefallen (LFH-764):

1. Im Modus „Größe" sind acht Griffe scharf (vier Ecken, vier Kanten). Auf einem kleinen Bild
   überlappen sich ihre Container. Welcher Griff den Tipp bekommt, entscheidet dann die
   DOM-Reihenfolge und nicht die Absicht.
2. Zonen, Abschnittsflächen, Fachebenen und Marker haben je eigene Klick-Hörer, die **parallel**
   feuern. Wer zuletzt die Auswahl setzt, gewinnt. Da die Hörer jede Render-Runde neu gebunden
   werden, ist diese Reihenfolge Zufall. Seit dem Ring der Trefferzone wählt ein Tipp auf einen
   KRITIS-Bündelpunkt zusätzlich den Marker daneben aus, und `easeTo` (Bündel-Zoom) läuft gegen
   `flyTo` (Marker-Auswahl).

Entscheidungen des Users vom 29.09.2026: (1) eine geometrische Griffregel, (2) ein gemeinsamer
Klick-Schiedsrichter für alle Klickziele der Lagekarte.

## What Changes

- **Bildgriffe:** Ecken sind im Modus „Größe" immer scharf. Ein Kantengriff ist nur scharf, wenn
  sein Container weder eine Ecke noch einen anderen Kantengriff überlappt. Neu entschieden wird
  bei jeder Kartenbewegung (Zoom, Drehung) und nach dem Loslassen eines Griffs, nie mitten in
  einer Ziehgeste.
- **Hinweis unter dem Griff-Umschalter:** Er nennt nur die scharfen Griffe. Sind Kanten wegen
  Platzmangel ausgeblendet, sagt er das und nennt den Ausweg (heranzoomen).
- **Klick-Schiedsrichter:** Ein Tipp auf die Lagekarte gehört genau **einem** Ziel. Die
  Rangfolge: oberstes gezeichnetes Punktziel (Marker, aufgefächertes Zeichen, Personen-Cluster,
  Fachebenen-Punkt oder -Bündel) vor Trefferzone (nächstgelegener Marker) vor Fläche (Zone,
  Abschnitt, Fachebenen-Polygon; oberste gewinnt). Jeder Klick-Hörer handelt nur als Gewinner.
- **Verhaltensänderung am Bestand:** Ein Tipp auf ein Markerzeichen über einer Zone oder einem
  Abschnitt wählt künftig nur den Marker aus, nicht mehr zusätzlich die Fläche. Zwei
  übereinanderliegende Flächen wählen nur die oberste.
- **Dokumentierter Rest:** Ist das Bild am Schirm kleiner als eine Griffkante (44/48/72 px),
  überlappen sich auch die Ecken. Dort hilft nur Heranzoomen. Das steht im Hinweis und in der
  Herleitung.

## Capabilities

### New Capabilities
- `lagekarte-bildgriffe`: Welche Ziehgriffe eines Kartenbildes scharf sind, damit sich keine zwei
  scharfen Griffe überlappen, und was der Hinweis dazu sagt.
- `lagekarte-klickziele`: Wem ein Tipp auf der Lagekarte gehört, wenn Marker, Trefferzonen,
  Fachebenen und Flächen übereinanderliegen.

### Modified Capabilities
<!-- keine: `lagekarte-fachebenen` fordert bereits, dass ein Bündelklick hineinzoomt, ohne eine
     Detailansicht zu öffnen; der Schiedsrichter macht das neben einem Marker erst wahr, ändert die
     Anforderung aber nicht. -->

## Impact

- Frontend, nur Lagekarte: `pages/lagekarte/bildGriffe.ts`, `bildHandles.ts`,
  `Kartenflaeche.tsx`, `markerLayer.ts`, `Sidebar.tsx`, `LagekartePage.tsx`, neues reines Modul
  für den Schiedsrichter.
- e2e: Griff-Überlappung per Bounding-Boxen und KRITIS-Bündel im Trefferzonen-Ring, beide mit
  Mutationsprobe.
- Kein Backend, keine API, keine Migration. CLAUDE.md bekommt einen Eintrag unter „Lagekarte".
