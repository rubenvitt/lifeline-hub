# Proposal

## Why

Die Eigenposition (LFH-712) fliegt beim ersten Standort nach dem Einschalten immer an, mit festem
Zoom 15. Beides passt nicht zum Einsatz (LFH-766, Befund aus dem Review zu LFH-712):

- Der erste Standort kann bis zu 15 s nach dem Einschalten kommen. Hat die Einsatzkraft in der
  Zeit die Karte verschoben oder angefangen zu zeichnen, springt die Karte trotzdem — ein Sprung
  unter dem Finger (Kriterium 12 der Prüfliste LFH-712).
- Bei grober Ortung (WLAN am Fükw: einige hundert Meter bis Kilometer) ist Zoom 15 zu eng; der
  Genauigkeitskreis passt nicht ins Bild, und die Unschärfe ist nicht zu sehen.

Dazu ein Nebenbefund: Punkt und Kreis werden bei jeder Standortmeldung ganz nach oben gezogen,
also auch über die Entwurfsebenen des Zeichnens. Wer am eigenen Standort zeichnet, sieht seine
Stützpunkte unter dem Punkt nicht.

## What Changes

- **Anflug an die Genauigkeit gekoppelt:** Die Karte rahmt den Genauigkeitskreis ein, statt mit
  festem Zoom auf den Punkt zu fliegen. Bei genauer Ortung bleibt der bisherige Anflugzoom die
  Obergrenze, die Karte geht also nie näher heran als heute.
- **Kein Anflug nach Bedienung:** Hat die Einsatzkraft seit dem Einschalten die Karte selbst
  verschoben oder gezoomt, einen Ort angesteuert (Auswahl, Ortssuche) oder einen Zeichen-,
  Platzier- oder Messmodus benutzt, bleibt der Ausschnitt beim ersten Standort stehen. Punkt und
  Kreis erscheinen trotzdem.
- **Eigenposition unter den Zeichenebenen:** Punkt und Kreis liegen weiter über Markern,
  Fachebenen und Suchnadel, aber unter den Entwurfsebenen des Zeichnens und Messens.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lagekarte-eigenposition`: Die Anforderung „Eigenposition ein- und ausschalten“ ändert den
  Anflug (Kreis im Bild, kein Anflug nach Bedienung). Neu kommt die Anforderung, dass die
  Eigenposition eine laufende Zeichnung nicht verdeckt.

## Impact

- **Frontend, nur Lagekarte:** `pages/lagekarte/Kartenflaeche.tsx` (Anflug per Einrahmen,
  Meldung einer Bedienung), `pages/lagekarte/eigenpositionLayer.ts` (Ebenenfolge, Rahmen des
  Kreises), `pages/LagekartePage.tsx` (Merker „seit dem Einschalten bedient“).
  `useEigenposition.ts` bleibt in seiner Schnittstelle gleich.
- **Regeln:** `frontend/src/pages/lagekarte/AGENTS.md` (Zeichnen und Messen) nennt die
  Ebenenfolge und dass jeder terra-draw-`prefixId` mit `td-` beginnt.
- **Nachweise:** Vitest an Seite, Ebene und Karte; `e2e/lagekarte-zeichnen-korrigierbar.spec.ts`
  (Kreis bei 2 km im Bild, Ebenenfolge beim Zeichnen).
- **Keine** Änderung an Backend, API, Datenschutz-Zusagen oder an der Suchnadel.
