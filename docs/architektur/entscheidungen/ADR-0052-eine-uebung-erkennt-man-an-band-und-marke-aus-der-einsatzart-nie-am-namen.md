---
id: ADR-0052
titel: Eine Übung erkennt man an Band und Marke aus der Einsatzart, nie am Namen
status: akzeptiert
datum: 2026-11-15
gilt_fuer:
  - frontend/src/einsatz/einsatzart.ts
  - frontend/src/components/instrument/Uebung.tsx
  - frontend/src/components/druck/Druckkopf.tsx
  - frontend/src/theme/tokens.ts
herleitung:
  - openspec/changes/wc3kzd54-uebungsmarke-rahmen/design.md
  - Zunder LLH-1725 (Farbe, Platz, Gerät und Druck abgestimmt mit Ruben am 15.11.2026)
---

# ADR-0052: Eine Übung erkennt man an Band und Marke aus der Einsatzart, nie am Namen

## Regeln

- MUST: Ob ein Einsatz eine Übung ist, entscheidet nur `isUebung` (`frontend/src/einsatz/einsatzart.ts`)
  aus der Einsatzart; Regel und Liste der Flächen: `frontend/AGENTS.md`, Rahmen, „Übung“.
- MUST: Gezeigt wird eine Übung nur über `UebungsMarke`/`UebungsBand`
  (`frontend/src/components/instrument/Uebung.tsx`), im Druck über den `Druckkopf`; immer mit dem
  Wort „ÜBUNG“, nie über die Farbe allein.
- MUST NOT: Eine Fläche leitet die Übung aus Name, Stichwort oder Vorlage ab.
- SHOULD: Neue Flächen, die einen Einsatz zeigen oder zur Wahl stellen, kennzeichnen eine Übung
  vom ersten Tag an.

## Prüfung

```sh
verlange 'export function isUebung' frontend/src/einsatz/einsatzart.ts
verlange 'export function UebungsBand' frontend/src/components/instrument/Uebung.tsx
verlange 'export function UebungsMarke' frontend/src/components/instrument/Uebung.tsx
verlange 'isUebung\(einsatz\)' frontend/src/components/druck/Druckkopf.tsx
verbiete "einsatzart === 'uebung'" 'frontend/src/**/*.tsx'
```

## Kontext

Ein Einsatz mit der Art „Übung“ sah überall aus wie ein Realeinsatz; erkennbar war er nur, wenn
jemand „ÜBUNG“ in den Namen getippt hatte (UI/UX-Analyse vom 12.11.2026). Zur Wahl standen
Gelb-Schwarz-Schraffur, Hinweis-Blau und eine eigene violette Rolle, im Rahmen ein Band, nur eine
Kopfmarke oder ein farbiger Rand, im Druck Druckkopf, Randfeld oder Wasserzeichen. Gewählt sind
die violette Rolle `uebung`, Band plus Kopfmarke und Druckkopf plus Randfeld (design.md D2–D8).

## Konsequenzen

Jede Fläche fragt dieselbe Funktion und zeigt denselben Baustein, eine neue Einsatzart „Planspiel“
fände so alle Stellen auf einmal. Das Band kostet am Handy eine Zeile Dauerhöhe und klebt als
eigene Rahmenquelle (`useRahmenObenStapel`). Violett gibt es daneben weiter als Kennfarbe und als
Fläche der Lagekarte (Abschnitte, Führungscluster); die Übung unterscheidet sich durch Form und Wort.
