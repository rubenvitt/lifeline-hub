# Proposal

Zunder: https://zunder.rubeen.dev/#/aufgabe/iq2gm8wh5aunjgs4gerkg4ou (LLH-1752, Punkt 1; Epic LLH-1717)

## Why

Ist der Einsatzort nicht verortet, zeigt die Seite „Wetter & Pegel“ dreimal „Einsatzort nicht
verortet“: in den Warnungen (mit Knopf), in der Vorhersage und in den aktuellen Bedingungen. Der
Grund ist für alle drei derselbe, eine fehlende Koordinate. Die Wiederholung macht die Seite laut,
erklärt aber nicht mehr.

## What Changes

- Fehlt die Koordinate des Einsatzorts, steht **einmal** über den Paneelen ein Hinweis: „Einsatzort
  nicht verortet — Warnungen, Vorhersage und aktuelle Bedingungen brauchen eine Koordinate“, mit dem
  Knopf „Einsatzort in den Einsatzdaten verorten“.
- Die Paneele Warnungen, Vorhersage und Aktuelle Bedingungen zeigen dann nur noch knapp „ohne
  Einsatzort“, ohne Knopf und ohne den erklärenden Satz.
- Pegel bleiben unberührt; sie hängen an festgelegten Messstellen, nicht am Einsatzort.

Die übrigen Punkte von LLH-1752 (Termin der Lagebesprechung in den Demo-Daten, Etikett „live“ ohne
Netz, Wort für SK IV) laufen ohne Change, weil sie vorhandenes Verhalten wiederherstellen oder nur
Text angleichen. Der Sammelbanner wird Folgeaufgabe.

## Capabilities

### New Capabilities

(keine)

### Modified Capabilities

- `lage-wetter-pegel`: Die Szenarien „Kein Einsatzort“ der Anforderungen „DWD-Warnungen für den
  Einsatzort“ und „Aktuelle Bedingungen am Einsatzort“ legen den Ort der Erklärung fest. Künftig
  erklärt die Seite einmal, die Paneele nennen nur den Zustand.

## Impact

- Frontend: `pages/WetterPegelPage.tsx` (Hinweis über dem Raster), `wetter/WetterPaneele.tsx`
  (`StandHinweis` für `kein_ort` knapp, ohne Knopf).
- Anwenderdoku: `docs/anwender/kapitel/wetter-pegel.md`, falls sie den Zustand ohne Einsatzort
  beschreibt.
- Kein Backend: der Endpunkt liefert `kein_ort` unverändert.
