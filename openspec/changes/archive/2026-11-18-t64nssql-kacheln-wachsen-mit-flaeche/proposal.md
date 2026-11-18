# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/t64nssql5sboyz6yh03bdptn (LLH-1940, abgespalten aus
LLH-1793)

## Why

Die Platzkacheln im UHS-Grundriss sind in jeder Lage 140 × 116 px groß, auch wenn die Fläche
daneben leer ist (1124 × 552 px bei zehn Plätzen). Am Tablet und am Großbild bleibt so Platz
ungenutzt, während Titel und Namen in der Kachel umbrechen oder abgeschnitten werden.

## What Changes

- Der Grundriss streckt sein Bild mit einem Einpassfaktor `s` aus der gemessenen Fläche: Positionen,
  Kachelgröße und Plan wachsen gemeinsam, das Raumbild und die Deckung mit dem Plan bleiben.
- `s` liegt zwischen 1 und 2. Passt der Inhalt nicht, bleibt es bei heute (1×, Bildlauf).
- Gespeichert bleibt das Server-Raster: kein Schreibzugriff, keine Migration, keine Umrechnung
  gespeicherter Positionen. Ein Zug im Bearbeiten-Modus rechnet seine Strecke auf das Raster
  zurück.
- Die Streckung gilt auch im Bearbeiten-Modus; während eines Zugs bleibt `s` stehen.
- Die Bedienform der Kachel (Knopfzeile in „kompakt“, Kartenform in „komfortabel“ und
  „Handschuh“) hängt weiter nur an der Dichtestufe, nicht an der Kachelgröße.
- Schrift und Bedienelemente wachsen nicht mit; die Kachel bekommt mehr Raum für ihren Inhalt.

## Capabilities

### New Capabilities

Keine.

### Modified Capabilities

- `uhs-grundriss`: Die Anforderung „Kartengröße und Layout sind dichteunabhängig“ legt die Kachel
  heute auf eine feste Größe fest. Künftig folgt die angezeigte Größe der Fläche (1× bis 2×),
  bleibt aber unabhängig von der Dichtestufe; gespeicherte Positionen gelten unverändert.

## Impact

- Frontend: `frontend/src/pages/uhs/Grundriss.tsx` (Kachel, Plan-Ebene, Fläche, Zugende),
  `frontend/src/pages/uhs/grundrissLayout.ts` (reine Rechnung des Faktors) mit Tests,
  `frontend/e2e/uhs-grundriss-layout.spec.ts`.
- Backend, API, Migrationen: unverändert. `src/uhs/plan.rs` (`KARTE_BREITE`/`_HOEHE`) und
  `src/uhs/platz_repo.rs` (Raster) rechnen weiter in Grundmaßen.
