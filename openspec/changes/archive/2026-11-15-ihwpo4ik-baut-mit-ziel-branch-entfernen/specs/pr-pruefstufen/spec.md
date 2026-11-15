## MODIFIED Requirements

### Requirement: Ein PR prüft nur leicht
Ein Push auf einen offenen Pull Request gegen `alpha`, `beta` oder `main` MUST die Schnellprüfungen starten. Ohne das Label `voll` MUST er weder die Rust-, die Frontend- noch die e2e-Suite starten. Pflicht für das Mergen MUST nur sein: `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern`.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne Label `voll` ein Commit gepusht wird, der Backend- und Frontend-Code ändert
- **THEN** laufen die Schnellprüfungen, und kein Job fährt die Rust-, Frontend- oder e2e-Suite

#### Scenario: Mergebar ohne Suiten
- **WHEN** an einem PR mit Auto-Merge `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern` grün sind
- **THEN** ist er mergebar, ohne dass eine schwere Suite auf ihm lief

### Requirement: Ein PR zeigt keine Jobs der Kanal-Branches
Ein Ereignis an einem PR MUST keinen Job anlegen, der nur bei einem Push auf einen Kanal-Branch läuft, auch nicht als übersprungen. An einem PR ohne `voll` MUST aus dem PR-Workflow der Prüfungen höchstens ein übersprungener Eintrag stehen: der Aufruf der Suiten. Ein Pflicht-Check MUST unter seinem Namen ohne Präfix eines aufgerufenen Workflows erscheinen.

#### Scenario: PR ohne Label
- **WHEN** auf einen PR ohne `voll` gepusht wird
- **THEN** stehen am PR weder `Release`, `Testberichte zusammenführen` noch `Offene PRs neu bewerten`, und aus dem PR-Workflow der Prüfungen erscheint als übersprungen höchstens der Aufruf der Suiten

#### Scenario: Pflicht-Checks unverändert
- **WHEN** an einem PR alle Pflicht-Checks grün sind
- **THEN** heißen sie `Schnellprüfungen`, `Migrationsnummern` und `ADR-Nummern`

#### Scenario: Push auf alpha
- **WHEN** ein PR auf `alpha` gemergt wird
- **THEN** laufen auf dem Merge-Commit weiter Schnellprüfungen, alle Suiten, und das Neubewerten der Migrationsnummern

## ADDED Requirements

### Requirement: PR-Code läuft nie auf einer Kanal-Ref
Code aus einem PR MUST nie in einem Lauf ausgeführt werden, dessen Ref ein Kanal-Branch ist (`alpha`, `beta`, `main`). Ein Lauf, der nach einem Push auf einen Kanal-Branch offene PRs bewertet, MUST seine Skripte vom Kanal-Branch nehmen und MUST keinen Code aus dem PR ausführen.

#### Scenario: Offene PRs nach einem Merge bewerten
- **WHEN** nach einem Merge auf `alpha` die Migrations- und ADR-Nummern der offenen PRs neu bewertet werden
- **THEN** stammen die prüfenden Skripte von `alpha`, und kein Code aus einem PR läuft im Bereich von `alpha`

## REMOVED Requirements

### Requirement: Ein fertiger PR muss mit dem aktuellen Ziel-Branch bauen
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: Bewegt sich der Ziel-Branch, entsteht der Check neu
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: Ein überholter Lauf macht keinen PR rot
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: Ein überholter Check ohne Nachfolger wird rot
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: Läufe je PR werden auf den jüngsten Stand gebündelt
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: PR-Code läuft nie im Bereich eines Kanal-Branches
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.

### Requirement: Ein PR ist fertig, wenn Auto-Merge an ist
**Reason**: Der Check `Baut mit Ziel-Branch` ist abgeschafft (LLH-1899, Entscheidung Ruben 15.11.2026); Kompilierbrüche zweier PRs fallen wie Testbrüche auf `alpha` auf.
**Migration**: Keine; Ruleset von Hand angepasst, Workflows und Skript entfernt.
