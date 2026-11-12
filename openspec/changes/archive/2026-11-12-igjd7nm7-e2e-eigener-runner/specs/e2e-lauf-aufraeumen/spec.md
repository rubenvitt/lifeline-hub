# Spec Delta

## Purpose

Ein Playwright-Lauf des Repos (e2e-Suite oder Bildlauf der Anwenderdoku) hinterlässt auf der
Maschine kein Lauf-Verzeichnis, damit ein dauerhafter Rechner (eigener CI-Runner, Laptop) nicht
mit jedem Lauf voller wird.

## ADDED Requirements

### Requirement: Ein Lauf löscht sein Lauf-Verzeichnis am Ende
Das Temp-Verzeichnis, das ein Lauf für Datenbank und Karten des Backends anlegt, MUST am Ende des
Laufs gelöscht sein, unabhängig davon, ob Tests rot waren oder der Lauf schon vor den Tests
scheiterte. Das gilt für die e2e-Suite und den Bildlauf der Anwenderdoku, lokal wie in der CI,
und für jeden Anteil (`PW_SHARD`).

#### Scenario: Grüner Lauf
- **WHEN** ein e2e-Lauf mit grünen Tests endet
- **THEN** existiert sein `lifeline-e2e-*`-Verzeichnis im Temp-Verzeichnis nicht mehr

#### Scenario: Roter Lauf
- **WHEN** ein e2e-Lauf mit mindestens einem roten Test endet
- **THEN** existiert sein Lauf-Verzeichnis ebenfalls nicht mehr, und der Lauf meldet weiterhin
  Rot

#### Scenario: Backend startet nicht
- **WHEN** ein e2e-Lauf abbricht, weil das Backend nicht startet
- **THEN** existiert sein Lauf-Verzeichnis ebenfalls nicht mehr

#### Scenario: Bildlauf der Anwenderdoku
- **WHEN** ein Lauf mit `playwright.doku.config.ts` endet
- **THEN** existiert sein `lifeline-doku-*`-Verzeichnis nicht mehr

### Requirement: Ein Lauf räumt verwaiste Verzeichnisse früherer Läufe ab
Beim Start MUST ein Lauf Lauf-Verzeichnisse seiner Art löschen, deren letzte Änderung mehr als
24 Stunden zurückliegt; sie stammen von abgebrochenen Läufen. Jüngere Verzeichnisse MUST
unberührt bleiben, weil parallele Läufe (andere Worktrees, andere Shards) sie gerade benutzen
können. Ein Verzeichnis, das sich nicht löschen lässt, MUST den Lauf nicht scheitern lassen.

#### Scenario: Reste eines abgebrochenen Laufs
- **WHEN** im Temp-Verzeichnis ein `lifeline-e2e-*`-Verzeichnis liegt, das seit zwei Tagen
  unverändert ist, und ein neuer e2e-Lauf startet
- **THEN** ist es nach dem Start gelöscht

#### Scenario: Paralleler Lauf
- **WHEN** ein anderer e2e-Lauf vor zehn Minuten sein Verzeichnis angelegt hat und ein zweiter
  Lauf startet
- **THEN** bleibt das Verzeichnis des ersten Laufs bestehen, und der erste Lauf läuft ungestört
  weiter

#### Scenario: Nicht löschbares Verzeichnis
- **WHEN** ein altes Lauf-Verzeichnis einem anderen Nutzer gehört und sich nicht löschen lässt
- **THEN** startet der Lauf trotzdem, mit einem Hinweis im Log
