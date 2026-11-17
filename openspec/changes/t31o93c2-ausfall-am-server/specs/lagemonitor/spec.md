# Spec Delta

## MODIFIED Requirements

### Requirement: Alarmzeile ohne Personenbezug
Der Lagemonitor SHALL die Alarmzeile über der Kachel „Lagekarte“ zeigen, mit denselben Arten, Rollen und
derselben Folge wie Überblick und Lagebild, Text mindestens 28 px. Er MUST ihre Werte als
verdichtete Zahlen vom Server erhalten. Namen MUST die Antwort nur von Einheiten und
Einsatzabschnitten tragen; Meldungs-, Auftrags- und Erinnerungstexte, Absender, Empfänger und
Namen von Personen MUST sie nicht tragen.

#### Scenario: Kritischer Abschnitt auf dem Monitor
- **WHEN** der Abschnitt „UHS Turnhalle“ den Lagezustand „kritisch“ trägt
- **THEN** zeigt die Alarmzeile des Monitors „kritisch: UHS Turnhalle“ in der Alarmrolle, mindestens 28 px

#### Scenario: Überfälliger Auftrag ohne Text
- **WHEN** ein Auftrag „Herrn Muster abholen“ überfällig ist
- **THEN** zeigt der Monitor „1 Auftrag überfällig“
- **AND** enthält die Antwort des Servers den Auftragstext nicht

#### Scenario: Alle Kacheln bleiben sichtbar
- **WHEN** der Monitor auf 1920 × 1080 läuft und acht Arten vorliegen
- **THEN** sind Alarmzeile und alle Kacheln ohne Bildlauf sichtbar

#### Scenario: Ausfall auf dem Monitor
- **WHEN** das Meldebild beim Logistiktrupp, und nur dort, einen Ausfall nennt, weil die Helferin Anna Muster „nicht verfügbar“ meldet
- **THEN** zeigt die Alarmzeile des Monitors „Ausfall: Logistiktrupp“ in der Alarmrolle
- **AND** enthält die Antwort des Servers den Namen „Anna Muster“ nicht

#### Scenario: Gleiche Einheiten wie im Überblick
- **WHEN** der Überblick zur selben Minute „Ausfall: Sanitätszug, Logistiktrupp +1“ zeigt
- **THEN** zeigt der Monitor „Ausfall: Sanitätszug, Logistiktrupp +1“
