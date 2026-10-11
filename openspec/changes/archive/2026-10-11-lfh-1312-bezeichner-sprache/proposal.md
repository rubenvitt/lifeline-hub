# Proposal

## Why

Der Code ist durchgehend deutsch benannt, auch das rein technische Vokabular (`lade_einsatz`,
`hole_style`, `pruefe_swaps`, `ist_geraetekonto`). Grundlage waren die „Global Constraints“
älterer Pläne unter `docs/superpowers/plans/` („Bezeichner … auf Deutsch“); eine Regel in einer
`AGENTS.md` gab es nie. Gewollt ist (Entscheidung 11.10.2026): Fachbegriffe der Domäne bleiben
deutsch, das technische Vokabular wird englisch. Ohne verbindliche Regel benennen Agenten weiter
nach den alten Plänen, und der Bestand wächst in die falsche Richtung.

## What Changes

- Neue Regel „Bezeichner-Sprache“ in der Wurzel-`AGENTS.md`: Fachbegriffe deutsch, technisches
  Vokabular englisch, Prosa (Kommentare, Commits, UI-Texte, Testbeschreibungen) deutsch.
- Ausnahmen für Grenzwerte, deren Umbenennen eine Schnittstelle bricht: Wire-Felder und
  -Werte, Datenbanktabellen und -spalten, Migrationsdateien, generierte Typen, gespeicherte
  Schlüssel und Routen.
- Bestand wird **nicht** auf einen Schlag umgestellt. Neue Bezeichner folgen der Regel sofort;
  bestehende werden umbenannt, wenn ein Task den Code ohnehin ändert (Pfadfinderregel).
- Die Sprachvorgabe der älteren Pläne gilt als überholt. Die Pläne selbst bleiben unverändert
  (eingefrorenes Archiv).
- Kein Wächter: auf dem heutigen Bestand wäre er rot geboren.

## Capabilities

### New Capabilities
- `bezeichner-sprache`: In welcher Sprache Bezeichner, Kommentare und andere Texte im Repo
  stehen und wie der Bestand an die Regel herangeführt wird.

### Modified Capabilities
- keine

## Impact

- Arbeitsanleitungen: Wurzel-`AGENTS.md` (neuer Abschnitt, bleibt unter 200 Zeilen).
- Kein Produktcode, keine Schnittstelle, keine Migration. Der Bestand ändert sich erst mit
  späteren Tasks, jeweils im Rahmen ihres eigenen Diffs.
- Reviews: Neue deutsche Technikverben (`lade_`, `hole_`, `pruefe_`, `ist_`) gelten ab jetzt als
  Abweichung.
