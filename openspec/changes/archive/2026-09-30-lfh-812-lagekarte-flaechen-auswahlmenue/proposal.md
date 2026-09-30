# Proposal

## Why

Seit LFH-764 gehört ein Tipp auf die Lagekarte genau einem Ziel. Liegen mehrere Flächen übereinander,
gewinnt die oberste. Zone, Abschnitt und NINA- oder DWD-Warnfläche decken sich im Einsatz aber oft,
und keine Rangfolge trifft immer, was der Mensch meint. Ein Abschnitt unter einer Zone lässt sich auf
der Karte gar nicht antippen, eine Warnfläche unter einer Zone nur über die Fachebenen-Liste. Der
User hat am 29.09.2026 entschieden: Für Flächen gibt es ein Auswahlmenü. Punktziele und
Trefferzonen behalten die feste Rangfolge.

## What Changes

- Liegen am Tipppunkt **zwei oder mehr verschiedene Flächen** und gewinnt weder ein gezeichnetes
  Punktziel noch eine Trefferzone, öffnet sich am Tipppunkt ein Menü mit allen Flächen: eigene
  (Zone, Abschnitt) zuerst, dann Fachebenen, je Gruppe in der Zeichenreihenfolge (oben zuerst).
- Jeder Eintrag trägt eine menschenlesbare Kennung: Art und Bezeichnung der Fläche, ohne
  Bezeichnung ihr Typ; bei Fachebenen der Name der Ebene und, falls vorhanden, der Titel der Meldung.
- Die Wahl eines Eintrags wirkt wie heute der direkte Tipp auf diese Fläche (Inspector bzw.
  Fachebenen-Detail).
- Liegt nur **eine** Fläche am Punkt (auch wenn sie über Füllung und Umriss doppelt gemeldet wird),
  wird sie wie bisher direkt gewählt.
- Das Menü ist mit Tastatur bedienbar (Pfeile, Enter, Esc), hält die Trefferhöhe der Dichte-Staffel,
  gibt den Fokus beim Schließen an die Karte zurück und schließt bei jeder Kartenbewegung. Esc bei
  offenem Menü verwirft keine laufende Zeichnung.
- In einem exklusiven Kartenmodus (Zeichnen, Messen, Platzieren, Bild) öffnet sich kein Menü.
- **Verhaltensänderung gegenüber LFH-764:** Das Szenario „Zwei Flächen übereinander → nur die obere"
  entfällt zugunsten des Menüs.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `lagekarte-klickziele` (eingeführt von LFH-764, noch nicht archiviert): Die Rangfolge endet nicht
  mehr bei „oberste Fläche", sondern bei „eine Fläche direkt, mehrere per Auswahlmenü". Neue
  Anforderung an das Menü selbst.

## Impact

- Frontend, Lagekarte: `pages/lagekarte/klickziel.ts` (Schiedsrichter), `Kartenflaeche.tsx`
  (Hörer, Menü am Tipppunkt), `kartenLayer.ts` (Zonentyp als Eigenschaft), `LagekartePage.tsx`
  (Sperre im exklusiven Modus), Titelableitung aus `FachebenenInspector.tsx` als reine Funktion.
- Tests: `klickziel.test.ts`, neue Vitests für Menü und Beschriftung, e2e `lagekarte-touch.spec.ts`.
- Prüfliste Einsatztauglichkeit der Lagekarte (Nachtrag).
- Keine Backend-, API- oder Datenmodelländerung.
- **Abhängigkeit:** gestapelt auf LFH-764 (`feat/lfh-764-lagekarte-griffe-klickwege`, noch nicht
  gemergt). Merge und Archivierung von LFH-764 gehen voraus.
