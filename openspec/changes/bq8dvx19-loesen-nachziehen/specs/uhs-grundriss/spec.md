## ADDED Requirements

### Requirement: Zurückweisen rückgängig
Nach „zurückweisen“ an einem Platz SHALL ein Hinweis „<Kennung> zurückgewiesen“ mit „Rückgängig“
stehen. „Rückgängig“ MUST den eben gebuchten Austritt zurücknehmen, mit denselben Regeln wie
beim Austragen im Patientenkopf (Platz, Wartezeit, zehn Minuten). Eine Ablehnung MUST im
Hinweis der Seite stehen, ohne Fehler-Toast. „zurückweisen“ bleibt Gefahreintrag bzw. -knopf.

#### Scenario: Zurückweisen rückgängig
- **WHEN** jemand im Grundriss bei R-009 auf Platz 3 „zurückweisen“ und im Hinweis „Rückgängig“ wählt
- **THEN** liegt R-009 wieder auf Platz 3, und Platz 3 steht nicht in Aufbereitung

#### Scenario: Am UHS-Laptop
- **WHEN** am gekoppelten Gerät der UHS „zurückweisen“ und danach „Rückgängig“ gewählt wird
- **THEN** liegt die Person wieder auf ihrem Platz
