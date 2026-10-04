# Proposal

## Why

Der Fachebenen-Inspector färbt den Zustand eines PEGELONLINE-Pegels (`stateMnwMhw`) mit eigenen
antd-Tag-Farben (`red`/`green`/`gold`, Konstante `ZUSTAND` in
`frontend/src/pages/lagekarte/FachebenenInspector.tsx`). Das bricht die Regel „Ein Status gehört
in den Vertrag“ (`frontend/AGENTS.md`): die Farbe kommt nicht aus einer Rolle, sieht den
Hell-/Nachtmodus nicht und läuft am Wächter `statusVertrag.guard.test.ts` vorbei, weil `ZUSTAND`
keine Vertragskarte ist. Dazu zeigt „Hoch“ heute Rot, obwohl eine Überschreitung des mittleren
Hochwassers keine Meldestufe ist; Rot (`alarm`) gehört auf der Lagekarte dem großen Hochwasser
der Meldeklassen.

## What Changes

- Neue Vertragskarte `pegelZustand` in `frontend/src/theme/statusFarben.ts` für die drei
  aussagekräftigen Werte von `stateMnwMhw`: `high` → `achtung` „Hoch“, `normal` → `normal`
  „Normal“, `low` → `achtung` „Niedrig“; dazu ein Nachschlag `pegelZustandVon()`, der für jeden
  anderen Wert (`unknown`, `commented`, `out-dated`, fehlend) `null` liefert.
- Der Pegel-Inspector zeigt den Zustand über `StatusTag` mit dieser Karte; die Konstante
  `ZUSTAND` und ihr `<Tag color=…>` entfallen.
- Sichtbar: „Hoch“ wechselt von Rot auf die Achtung-Rolle, „Niedrig“ von Gold auf die
  Achtung-Rolle, „Normal“ von antd-Grün auf die Normal-Rolle. Die Wörter bleiben.
- `ALLE_MAPS` in `statusFarben.test.ts` (31 → 32) und die Zahl in `frontend/AGENTS.md` ziehen
  nach.

## Capabilities

### New Capabilities

_keine_

### Modified Capabilities

- `lagekarte-fachebenen`: neue Anforderung, dass der Zustand eines Pegels im Inspector dem
  Statusfarb-Vertrag folgt (Wort plus Rolle, keine Bedienfarbe, unbekannter Zustand ohne Tag).

## Impact

- Frontend: `theme/statusFarben.ts`, `theme/statusFarben.test.ts`,
  `pages/lagekarte/FachebenenInspector.tsx` und `.test.tsx`.
- Regeln: Zahl der Vertragskarten in `frontend/AGENTS.md`.
- Kein Backend, keine API, kein Typ-Codegen: `zustand` bleibt der durchgereichte Rohwert aus
  `src/karte/normalisierung.rs`.
