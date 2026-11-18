# Design

## Context

Der Grundriss (`frontend/src/pages/uhs/Grundriss.tsx`) setzt jede Platzkarte absolut auf
`pos_x`/`pos_y` aus dem Server und gibt ihr feste 140 × 116 px (`PLATZ_KARTE_BREITE`/`_HOEHE`).
Der Server vergibt neue Plätze im Raster 160 × 120 (`src/uhs/platz_repo.rs`, `raster_position`)
und rechnet beim Einpassen des Plans mit denselben Kartenmaßen (`src/uhs/plan.rs`,
`KARTE_BREITE`/`_HOEHE`). Der Plan liegt mit `x`, `y`, `breite` in denselben Einheiten auf der
Fläche (`PlanEbene`). Die Innenfläche ist `max(700, maxX + 160, Planrand)` breit und
`max(420, maxY + 140, Planrand)` hoch und läuft im Container `grundriss-flaeche-scroll` über.
Ob drei Spalten passen, entscheidet `dreiSpaltenPassen(rahmenBreite, flaecheBreite)`.

Motivation: proposal.md, „Why“. Abgestimmter Weg am 18.11.2026 (Variante A aus dem Scope-Scan,
Obergrenze 2×, auch im Bearbeiten-Modus, Bedienform bleibt an der Dichte, Schrift bleibt).

## Goals / Non-Goals

**Goals:**

- Ein Faktor `s` streckt die Darstellung der ganzen Fläche, gemessen an der sichtbaren Größe
  des Bildlauf-Containers.
- Gespeichertes Raster, Server und Plan-Einpassen bleiben in Grundmaßen.

**Non-Goals:**

- Keine größere Schrift, keine größeren Knöpfe in der Kachel.
- Keine Änderung an `platzBedienform` oder an der Drei-Spalten-Weiche.
- Kein Verkleinern unter 1× (die Fläche läuft dann weiter in sich über).

## Decisions

### D1 Faktor als reine Funktion in `grundrissLayout.ts`

`einpassFaktor({ sichtBreite, sichtHoehe, inhaltBreite, inhaltHoehe })` liefert
`clamp(1, 2, min(sichtBreite / inhaltBreite, sichtHoehe / inhaltHoehe))`, abgerundet auf zwei
Nachkommastellen; unbekannte Maße (0) oder ein leerer Grundriss geben 1. Rein und exportiert,
weil jsdom kein Layout rechnet (Muster `dreiSpaltenPassen`). Der Inhalt ist die Hülle aus
Plätzen und Plan in Grundmaßen: `maxX + 160` bzw. `maxY + 140` (ein Rasterschritt Luft hinter
der letzten Karte, wie heute) und der Planrand. Die Mindestfläche 700 × 420 zählt nicht zum
Inhalt, sonst wüchse ein Grundriss mit zwei Plätzen nie.

Abrunden: Ein gerundeter Faktor verhindert Unterpixel-Zittern, wenn die Messung zwischen zwei
Werten schwankt, und lässt die gestreckte Fläche nie über die Sicht hinauslaufen.

*Verworfen:* Faktor je Dichtestufe (Variante B) füllt die Fläche nicht; Rasterform ohne
Raumbezug (Variante C) verliert das Raumbild und die Deckung mit dem Plan.

### D2 Gemessen wird der Bildlauf-Container, nicht der Rahmen

`flaecheMessen` beobachtet `grundriss-flaeche-scroll` schon per `ResizeObserver`; dort kommen
`clientWidth`/`clientHeight` als Sicht hinzu. Der äußere Rahmen (`rahmenMessen`) wüsste nicht,
was Kopf, Hinweise, Seitenspalten und Reiter abziehen. Weil `s` den Inhalt nur so weit streckt,
wie er ohne Bildlauf passt, gibt es keine Rückkopplung über die Bildlaufleiste: bei `s > 1`
hat die Fläche keine Leiste, bei `s = 1` misst sie wie heute.

### D3 Strecken über Maße, nicht über CSS-Zoom

Positionen (`left`/`top`), Kartenbreite und -höhe, die Planlage (`x`, `y`, `breite`, Höhe) und
die Innenfläche werden mit `s` multipliziert; Rand, Polster und Inhalt der Kachel bleiben. So
bleibt die Schrift scharf, die Trefflächen der Stufen bleiben rechenbar, und dnd-kit misst
echte Pixel.

*Verworfen:* `transform: scale` oder `zoom` auf der Innenfläche. Die Schrift wüchse mit (gegen die
Abstimmung), Kanten würden unscharf, und dnd-kit sowie das Kartenmenü rechneten in transformierten
Koordinaten.

### D4 Zug rechnet zurück, Faktor steht während des Zugs

`onDragEnd` teilt die gemessene Strecke durch `s` und rundet auf ganze Einheiten:
`nx = max(0, pos_x + round(delta.x / s))`. Der optimistische Cache-Eintrag trägt den Grundwert,
die Karte steht danach also dort, wo sie losgelassen wurde (bis auf die Rundung unter 1 px × s).
Während eines Zugs bleibt `s` stehen (Muster `formImZug`): ein Live-Update, das die Hülle
vergrößert, verschöbe sonst die Fläche unter dem Zeiger. Nach dem Zug darf `s` neu einrasten,
etwa wenn ein Platz in eine neue Rasterspalte gezogen wurde.

### D5 Drei-Spalten-Weiche und Überlaufhinweis bleiben

`dreiSpaltenPassen` rechnet weiter mit der ungestreckten Flächenbreite: Die Streckung füllt nur
den Platz, den die Weiche bereits vergeben hat. Der Überlaufhinweis misst den Container wie
bisher.

### D6 Konstanten bleiben Grundmaße

`PLATZ_KARTE_BREITE`/`_HOEHE` bleiben 140/116 und sind die Grundgröße; `AKTIONSZEILE_BREITE` und
`platzBedienform` rechnen damit weiter, denn die Bedienform hängt nur an der Dichtestufe. Die
Kommentare an den Konstanten und am Fehlerhinweis über der Fläche („feste 140 × 116 px“) werden
nachgezogen. `src/uhs/plan.rs` nennt die Konstanten als Grundmaß; dort ändert sich nur der
Kommentarverweis, falls er „fest“ behauptet.

## Risks / Trade-offs

- [Kachel springt nach einem Zug, der die Hülle verändert] → Bewusst so abgestimmt; während des
  Zugs steht `s`, das Nachrücken passiert einmal danach.
- [Rundung der Zugstrecke bei krummem `s`] → Abweichung unter einer Einheit, unter dem Raster
  von 10 des Plans; gespeichert wird ganzzahlig wie heute.
- [Gestreckter Plan wird unscharf] → Der Plan ist ein Bild; bei 2× kann ein kleines Bild weich
  wirken. Hinnehmbar, das Raumbild bleibt erkennbar.
- [Tests, die feste Kachelmaße erwarten] → Unit-Tests rendern ohne Layout (Faktor 1);
  die e2e-Prüfung „keine Platzkarte angeschnitten“ deckt die gestreckte Form mit ab.

## Migration Plan

Keine Datenmigration. Rückweg: Faktor auf 1 setzen bzw. Commit zurücknehmen.
