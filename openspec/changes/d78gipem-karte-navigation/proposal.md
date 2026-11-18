# Proposal

## Why

Das Design System zeigt seit LLH-1807 die Grundbausteine als Karten, aber nicht die Navigation im
Einsatz (Rail und Modulpanel). Die Karte entfiel nach der Bedingung aus
`v127ps65-design-system-nachschlagewerk`, design.md D4: Beide Spalten kleben unter dem Kopf und
nehmen ihre Höhe aus dem Fenster (`calc(100dvh - …)`), in einer Karte wären sie so hoch wie das
Fenster des Betrachters. Ein `/design`-Agent, der ein Modul entwirft, findet den Rahmen deshalb
nirgends als echten Baustein und zeichnet ihn nach.

## What Changes

- `IconRail` und `ModulPanel` bekommen einen Schalter `kleben` (Vorgabe: an), nach dem Vorbild von
  `EinsatzSeite kopfKlebt`. Aus: die Spalte klebt nicht, füllt die Höhe ihres Trägers und misst
  nichts am Fenster. Der Einsatzrahmen setzt den Schalter nicht; sein Verhalten bleibt gleich.
- Neue Karte `Navigation` in `PREVIEWS` (Gruppe „Rahmen“): Rail mit aktiver Kategorie und Griff
  „Menü“, daneben das offene Modulpanel mit aktivem Modul, Zähler, gesperrtem Modul, Sprungmarke
  und Fuß „Einsatzdauer“ aus einem abgeschlossenen Einsatz (feste Dauer). Nacht und Tag.
- Neue Zeile in der Bausteinwahl (`frontend/AGENTS.md`) mit Karte `Navigation`.
- Das Design System wird neu erzeugt (`pnpm -C frontend design-system`) und nach dem Merge
  veröffentlicht.

## Capabilities

### New Capabilities

### Modified Capabilities
- `design-system-artifact`: Die Grundbausteine umfassen die Navigation im Einsatz (Rail und
  Modulpanel) als Karte.

## Impact

- Frontend: `src/einsatz/IconRail.tsx`, `src/einsatz/ModulPanel.tsx` (neuer optionaler Schalter,
  Vorgabe unverändert), `scripts/design-system/previews.tsx`, erzeugte Dateien unter
  `docs/design/design-system/project/`.
- Anleitungen: `frontend/AGENTS.md`, Bausteinwahl.
- Keine Schnittstelle zum Backend, keine Migration.
