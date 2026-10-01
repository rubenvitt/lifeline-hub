# css-farbquelle Specification

## Purpose
Sichert zu, dass handgeschriebenes CSS des Frontends Farben nur aus der Rollenquelle bezieht und
dass ein neues Farbliteral außerhalb dieser Quelle den Qualitäts-Gate rot macht, statt still zu
divergieren.

## Requirements

### Requirement: Kein Farbliteral in handgeschriebenem CSS

Eine CSS-Datei unter `frontend/src/` außer der Rollenquelle `theme/rollen.css` MUST NOT ein
Farbliteral enthalten: keinen Hex-Wert und keinen `rgb()`-, `rgba()`-, `hsl()`- oder
`hsla()`-Aufruf. Farben MUST über die Rollen-Properties (`var(--lfh-…)`) bezogen werden.
Kommentare zählen nicht.

#### Scenario: Neues Hex in einer CSS-Datei
- **WHEN** eine CSS-Datei außerhalb der Rollenquelle eine Deklaration mit einem Hex-Wert erhält
- **THEN** schlägt der Guard fehl und nennt Datei, Zeile und Literal

#### Scenario: Neues rgba in einer CSS-Datei
- **WHEN** eine CSS-Datei außerhalb der Rollenquelle eine Deklaration mit `rgba(…)` erhält
- **THEN** schlägt der Guard fehl und nennt Datei, Zeile und Literal

#### Scenario: Literal nur im Kommentar
- **WHEN** ein Hex-Wert in einer CSS-Datei ausschließlich in einem Kommentar steht
- **THEN** bleibt der Guard grün

#### Scenario: Rollenquelle selbst
- **WHEN** `theme/rollen.css` Hex- und `rgba()`-Werte enthält
- **THEN** bleibt der Guard grün

### Requirement: Schuldmenge schrumpft nur

Dateien, die beim Einführen des Guards noch Farbliterale tragen, MUST in einer benannten
Schuldmenge stehen. Ein Eintrag der Schuldmenge, dessen Datei kein Farbliteral mehr trägt oder
nicht mehr existiert, MUST den Guard rot machen, damit der Eintrag im selben Commit fällt.

#### Scenario: Schuld getilgt, Eintrag vergessen
- **WHEN** eine Datei der Schuldmenge kein Farbliteral mehr enthält
- **THEN** schlägt der Guard fehl und verlangt, den Eintrag zu entfernen

#### Scenario: Neue Datei mit Literal
- **WHEN** eine Datei außerhalb der Schuldmenge ein Farbliteral erhält
- **THEN** schlägt der Guard fehl, auch wenn die Schuldmenge andere Dateien führt
