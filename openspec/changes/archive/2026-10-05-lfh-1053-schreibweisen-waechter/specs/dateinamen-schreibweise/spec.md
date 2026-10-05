# Spec Delta

## Purpose

Stellt sicher, dass jeder Stand des Repos auf Dateisystemen ohne Unterscheidung der
Groß-/Kleinschreibung (macOS, Windows) dieselben Dateien und Module zeigt wie unter Linux, und
dass das Sammel-Gate einen Verstoß unter Linux vor dem Release meldet.

## ADDED Requirements

### Requirement: Keine Namen, die sich nur in der Schreibung unterscheiden
Innerhalb eines Verzeichnisses des Repos MUST kein Eintrag (Datei oder Verzeichnis) einen Namen
tragen, der einem anderen Eintrag desselben Verzeichnisses ohne Rücksicht auf die
Groß-/Kleinschreibung gleicht. Das gilt für jede Dateiart und für versionierte wie für noch
nicht versionierte, nicht ignorierte Dateien.

#### Scenario: Zwei Verzeichnisse gleichen Namens in anderer Schreibung
- **WHEN** das Repo `frontend/src/Stab/a.ts` und `frontend/src/stab/b.ts` enthält
- **THEN** ist der Schritt rot und nennt beide Pfade `frontend/src/Stab` und `frontend/src/stab`

#### Scenario: Zwei Dateien gleichen Namens in anderer Schreibung
- **WHEN** ein Verzeichnis `README.md` und `readme.md` enthält
- **THEN** ist der Schritt rot und nennt beide Dateien

#### Scenario: Neue, noch nicht hinzugefügte Datei
- **WHEN** ein lokaler Checkout eine nicht ignorierte, noch nicht mit `git add` aufgenommene
  Datei enthält, die nur in der Schreibung mit einer versionierten Datei kollidiert
- **THEN** ist der Schritt rot

### Requirement: Keine Modulnamen, die sich nur in der Schreibung unterscheiden
Innerhalb eines Verzeichnisses MUST kein Modulname einem anderen Modulnamen oder einem
Verzeichnisnamen ohne Rücksicht auf die Groß-/Kleinschreibung gleichen, solange sich die beiden
in der Schreibung unterscheiden. Modulname ist der Dateiname ohne eine der Endungen `.ts`,
`.tsx`, `.d.ts`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`, `.cjs`. Dateien mit anderen Endungen
zählen hier nicht.

#### Scenario: Stand vor LFH-1050
- **WHEN** `frontend/src/stab/` die Dateien `medienlageUebernahme.ts` und
  `MedienlageUebernahme.tsx` enthält
- **THEN** ist der Schritt rot und nennt beide Dateien

#### Scenario: Modul neben gleichnamigem Verzeichnis in anderer Schreibung
- **WHEN** ein Verzeichnis `Lagekarte.tsx` und das Unterverzeichnis `lagekarte/` enthält
- **THEN** ist der Schritt rot

#### Scenario: Komponente und Stylesheet in anderer Schreibung
- **WHEN** ein Verzeichnis `GefahrenMatrix.tsx` und `gefahrenMatrix.css` enthält
- **THEN** ist der Schritt grün, weil ein Stylesheet mit Endung importiert wird

#### Scenario: Gleicher Modulname in gleicher Schreibung
- **WHEN** ein Verzeichnis `EinsatzSeite.tsx`, `EinsatzSeite.test.tsx` und `EinsatzSeite.css`
  enthält
- **THEN** ist der Schritt grün

### Requirement: Das Sammel-Gate prüft die Schreibweisen vor dem Release
Das Sammel-Gate MUST beide Regeln als eigenen Schritt im Bündel `schnell` prüfen, auf jedem
Betriebssystem und damit auch in der Linux-CI vor dem Release. Ein Verstoß MUST den Schritt rot
enden lassen; die Meldung MUST jede kollidierende Gruppe mit ihren Pfaden nennen und die Abhilfe
(Umbenennen, Importe anpassen) angeben. Vor der Prüfung MUST ein Selbsttest belegen, dass der
Wächter rote und grüne Bäume trennt.

#### Scenario: Heutiger Stand
- **WHEN** `./scripts/check-all.sh --nur schnell` auf dem Stand von `alpha` nach LFH-1050 läuft
- **THEN** ist der Schritt grün

#### Scenario: Verstoß in einem Pull Request
- **WHEN** ein Pull Request eine Datei hinzufügt, die nur in der Schreibung mit einer
  bestehenden kollidiert
- **THEN** ist das Bündel `schnell` der CI rot, und es entsteht kein Release
