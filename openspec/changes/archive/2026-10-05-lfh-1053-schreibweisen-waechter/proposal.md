# Proposal

## Why

alpha.74 bis alpha.78 sind ohne Artefakte, Container-Images und Deployment erschienen (LFH-1050).
`stab/medienlageUebernahme.ts` lag neben `stab/MedienlageUebernahme.tsx`. Auf dem Dateisystem von
macOS, das Groß- und Kleinschreibung nicht unterscheidet, löste `./MedienlageUebernahme` auf die
`.ts`-Datei auf, und `tsc` brach mit TS1149 ab. Das Sammel-Gate läuft in der CI nur auf
`ubuntu-latest` und konnte den Konflikt nicht sehen. Er fiel erst im Artefakte-Lauf auf, also
nach Tag und Release. Ein Wächter unter Linux im Gate fängt diese Fehlerklasse vor dem Release ab.

## What Changes

- Neues Prüfskript `scripts/check-schreibweisen.sh`: meldet Einträge eines Verzeichnisses, die
  sich nur in der Groß-/Kleinschreibung unterscheiden. Verglichen werden ganze Namen (jede
  Dateiart, auch Verzeichnisse) und Modulnamen (Dateiname ohne TS/JS-Endung gegen andere
  Modulnamen und gegen Verzeichnisnamen).
- Selbsttest `scripts/check-schreibweisen.test.sh`, der rote und grüne Bäume trennt, darunter
  genau der Stand vor LFH-1050.
- Neuer Schritt 14 in `scripts/check-all.sh`, Bündel `schnell`; die CI ruft das Skript wie
  bisher unverändert auf.
- `scripts/AGENTS.md` nennt den Schritt in der Gate-Kette.

## Capabilities

### New Capabilities
- `dateinamen-schreibweise`: Das Repo enthält keine Namen, die nur auf einem Dateisystem mit
  Unterscheidung der Groß-/Kleinschreibung auseinanderzuhalten sind; das Sammel-Gate setzt das
  durch.

### Modified Capabilities
- keine

## Impact

- Gate und CI: `scripts/check-all.sh` (Schritt 14, Bündel `schnell`), zwei neue Skripte unter
  `scripts/`. Laufzeit im Bündel `schnell`: unter einer Sekunde bei rund 5 000 Dateien.
- Arbeitsanleitungen: `scripts/AGENTS.md`.
- Kein Produktcode; der heutige Stand von `alpha` ist nach LFH-1050 grün (geprüft am 05.10.2026).
- Nicht abgedeckt: andere reine macOS- oder Windows-Fehler. Dafür ist der Entwurfs-Release
  (LFH-1054) vorgesehen.
