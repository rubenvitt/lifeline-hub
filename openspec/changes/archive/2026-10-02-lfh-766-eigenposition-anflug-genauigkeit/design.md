# Design

## Context

Stand nach LFH-712 (Herleitung D5 in
`openspec/changes/archive/2026-09-29-lfh-712-lagekarte-zeichnen-korrigierbar/design.md`, dort auch
das Risiko, das hier geschlossen wird):

- `useEigenposition` ruft `onErsterFix` genau einmal je Einschalten. `LagekartePage` setzt darauf
  `setFlyToZiel({ lng, lat })`, und `Kartenflaeche` fliegt jedes `flyToZiel` mit `flyTo(…, zoom: 15)`
  an. Dasselbe `flyToZiel` tragen Auswahl, Zonen-Deeplink und Ortssuche; es verbraucht außerdem die
  Startansicht (`startAufKarteRef`).
- Die Kamera bewegen neben den Gesten auch Bedienelemente, die MapLibre nicht als Bedienung
  erkennt, weil sie programmatisch rufen: Zoom-Knöpfe und Nordung der Überlagerung
  (`KartenHandle.zoomIn/zoomOut`, ohne `NavigationControl`), „Bild einpassen“ (`fitBounds`) und der
  Tipp auf ein Bündel (`easeTo`). Automatisch bewegen sie die Startansicht (`jumpTo`/`fitBounds`)
  und jede Größenänderung der Karte (`resize`, etwa wenn unter `lg` ein Modus die Leiste schließt).
- `sorgeFuerEigenpositionLayer` zieht die vier Ebenen bei jeder Meldung per `moveLayer(id)` ganz
  nach oben. Die Suchnadel legt sich ausdrücklich darunter (`suchnadelLayer.ts`). terra-draw legt
  seine Ebenen beim Start eines Modus an; alle Instanzen tragen einen `prefixId` mit `td-`
  (`td-abschnitt`, `td-zone`, `td-mess`, Vorgabe `td-zeichnen`).

## Goals / Non-Goals

**Goals:**
- Der erste Anflug zeigt den ganzen Genauigkeitskreis und geht nie näher heran als heute.
- Jede Bedienung seit dem Einschalten unterdrückt den Anflug; automatische Kamerabewegungen tun
  es nicht.
- Die Zeichnung liegt über der Eigenposition, auch wenn Standorte während des Zeichnens eintreffen.

**Non-Goals:**
- Kein „Folgen“-Modus und kein Knopf „zur Eigenposition“ (Spec: die Karte folgt nicht).
- Keine kürzere Ortungsfrist; die 15 s bleiben (GPS-Kaltstart am Tablet).
- Die Marker-Ebenen ziehen sich bei neuen Markerdaten ebenfalls ganz nach oben (`markerLayer.ts`)
  und können damit über einer Zeichnung liegen. Das ist ein eigener Befund und bleibt hier
  unberührt.

## Decisions

### D1 — Eigener Anflug für die Eigenposition, eingerahmt per `fitBounds`

`Kartenflaeche` bekommt eine eigene Prop für den Eigenpositions-Anflug (Position samt
Genauigkeit, je Anflug ein neues Objekt). Der Effekt rahmt den Kreis per `fitBounds` ein, mit
festem Rand (Größenordnung 48 px) und `maxZoom: 15`, demselben Wert wie der `flyTo` der übrigen
Ziele; der Wert wird dafür eine benannte Konstante, die beide nutzen. Die Drehung der Karte
wird mitgegeben (`bearing: map.getBearing()`): ohne sie richtete `fitBounds` eine per Pinch
gedrehte Karte nach Norden aus, was der alte `flyTo` nicht tat (Befund aus dem Review). Der Rahmen ist die
Ausdehnung des Rings aus `genauigkeitsKreis` (eine reine Funktion in `eigenpositionLayer.ts`,
unit-getestet). Wie `flyToZiel` verbraucht der Anflug die Startansicht.

Alternativen:
- `flyToZiel` um einen optionalen Rahmen erweitern: mischt den Anflug der Eigenposition mit den
  Zielen, die selbst als Bedienung zählen (D2), und die Seite könnte beide nicht mehr auseinander
  halten. Verworfen.
- Zoom aus der Genauigkeit rechnen (`log2`-Formel je Breite): hängt von Kartengröße und Breitengrad
  ab, die `fitBounds` ohnehin kennt. Verworfen.

### D2 — „Bedient seit dem Einschalten“ als Merker der Seite, positiv gemeldet

Die Seite hält einen Merker, der beim Einschalten zurückgesetzt wird. `onErsterFix` löst den
Anflug nur aus, solange er nicht gesetzt ist. Gesetzt wird er durch:

1. **Bedienung der Karte:** `Kartenflaeche` meldet sie über eine neue Prop (`onBedienung`) aus
   einem `movestart`-Hörer. Als Bedienung gilt ein `movestart` mit `originalEvent` (Ziehen, Rad,
   Geste, Doppeltipp, Tastatur) **oder** mit der Markierung `bedienung: true` in den `eventData`.
   Diese Markierung geben die programmatischen Bedienwege von `Kartenflaeche` mit: Zoom-Knöpfe,
   Nordung, Bild einpassen und Bündel-Tipp.
2. **Ein Anflug der Seite:** jedes neue `flyToZiel` (Auswahl, Deeplink, Ortssuche) nach dem
   Einschalten. Die Einsatzkraft hat sich dann einen Ausschnitt ausgesucht.
3. **Ein Kartenmodus:** `exklusiverModusAktiv` (Zeichnen, Platzieren, Messen, Bild) war seit dem
   Einschalten wahr, auch wenn er beim ersten Standort schon wieder beendet ist.

`useEigenposition` bleibt unverändert: der Hook meldet den ersten Standort, die Seite entscheidet.

Alternativen:
- Jedes `movestart` ohne die automatische Bewegungen zählt: `resize` feuert `movestart` ohne
  Merkmal, und den Aufruf aus MapLibres `ResizeObserver` können wir nicht markieren. Ein Modus,
  der unter `lg` die Leiste schließt, oder das Drehen des Tablets würde den Anflug unterdrücken.
  Verworfen.
- Kamera vor und nach vergleichen (Mittelpunkt, Zoom): `resize` verschiebt bei gleichem Mittelpunkt
  die Grenzen, und Rundung macht kleine Unterschiede. Verworfen.
- Zeitfenster (Anflug nur in den ersten n Sekunden): beliebig und unabhängig davon, ob jemand
  bedient hat. Verworfen.
- Nur `originalEvent`: übersieht die Zoom-Knöpfe der Überlagerung, also genau den Weg am Tablet.
  Verworfen.

### D3 — Ebenenfolge: oben, aber unter der ersten `td-*`-Ebene

`sorgeFuerEigenpositionLayer` zieht die Ebenen weiterhin bei jeder Meldung, aber vor die erste
Ebene der Style-Reihenfolge, deren Id mit `td-` beginnt (`moveLayer(id, vor)`). Gibt es keine,
nach ganz oben wie bisher. Dasselbe Einordnen (`ordneEigenpositionEin`) läuft am Ende von
`pinneMarkerLayerNachOben`, das nach jeder neuen Datenebene die Marker nach oben zieht; sonst lägen
Marker und Fachebenen bis zur nächsten Standortmeldung über dem Punkt (Befund aus dem Review). Die
Suchnadel bleibt unverändert unter `eigenposition-kreis`. Startet
ein Zeichenmodus erst nach der Eigenposition, legt terra-draw seine Ebenen ohnehin darüber; die
nächste Meldung hält die Folge.

Damit hängt die Folge am Präfix `td-`. Die Regel in `frontend/src/pages/lagekarte/AGENTS.md`
(„jede terra-draw-Instanz eigener `prefixId`“) wird um „beginnt mit `td-`, die Eigenposition liegt
darunter“ ergänzt.

Alternativen:
- Nur beim Anlegen nach oben ziehen: neue Marker- oder Flächenebenen lägen danach über dem Punkt.
  Verworfen.
- terra-draws `renderBelowLayerId`: legt die Zeichnung unter eine Ebene, also genau die falsche
  Richtung. Verworfen.

## Risks / Trade-offs

- [Ein künftiger programmatischer Bedienweg in `Kartenflaeche` vergisst die Markierung
  `bedienung: true`] → Folge ist nur ein Anflug nach Bedienung, wie heute. Die vorhandenen Wege
  belegt je ein Test; der Kommentar am Hörer nennt die Pflicht.
- [Ein terra-draw-Präfix ohne `td-`] → der Punkt läge wieder über der Zeichnung. Regel in der
  Bereichsdatei und ein Test, der die Präfixe der vorhandenen Instanzen prüft.
- [`fitBounds` bei sehr großer Ungenauigkeit (mehrere km)] → die Karte zoomt weit heraus; das ist
  die ehrliche Darstellung der Unschärfe (LFH-712, Risiken). `minZoom` der Karte begrenzt.
