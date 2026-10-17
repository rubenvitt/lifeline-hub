# Spec Delta

## MODIFIED Requirements

### Requirement: Neuere laden bis zum neuesten Eintrag
Liegt der neueste Eintrag nicht im Fenster, SHALL die Zeitachse unter den Zeilen, über der
Erfassung, den Knopf „Neuere laden“ zeigen; „Ältere laden“ steht über den Zeilen. „Neuere laden“
lädt die Seite direkt über dem jüngsten Eintrag des Fensters, ohne Lücke. Liegt der neueste Eintrag
im Fenster, MUST der Knopf fehlen. Nachladen über den Zeilen MUST die gelesene Zeile an ihrem Platz
halten.

#### Scenario: Zurück nach oben
- **WHEN** das Fenster 20 Seiten unter dem neuesten Eintrag liegt und „Neuere laden“ wiederholt gewählt wird
- **THEN** erscheinen die Einträge lückenlos in laufender Nummer unten, bis der neueste Eintrag da ist und der Knopf verschwindet

#### Scenario: Am Kopf kein Knopf
- **WHEN** die Seite frisch geöffnet ist
- **THEN** steht kein „Neuere laden“ da

#### Scenario: Ältere laden ohne Sprung
- **WHEN** über den Zeilen „Ältere laden“ gewählt wird
- **THEN** erscheinen die älteren Einträge darüber, und die zuvor oberste Zeile bleibt an ihrer Stelle im Bild

#### Scenario: Eigener Eintrag aus tiefem Fenster
- **WHEN** jemand im tiefen Fenster einen Eintrag erfasst und der Server ihn annimmt
- **THEN** ersetzt die Seite das Fenster durch die neueste Seite, der neue Eintrag steht unten über der Erfassung; scheitert dieser Abruf, bleibt das Fenster

#### Scenario: Blättern scheitert am Server
- **WHEN** beim Sprung auf einen Eintrag eine Seite mit einem Serverfehler antwortet
- **THEN** gibt der Sprung auf und räumt den Parameter, statt sofort erneut abzurufen
