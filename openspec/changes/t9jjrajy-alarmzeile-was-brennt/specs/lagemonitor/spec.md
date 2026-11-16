## ADDED Requirements

### Requirement: Alarmzeile ohne Personenbezug
Der Lagemonitor SHALL die Alarmzeile über den Kacheln zeigen, mit denselben Arten, Rollen und
derselben Folge wie Überblick und Lagebild, ohne die Art „Ausfall“, Text mindestens 28 px. Er MUST ihre Werte als
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

### Requirement: Sofortmeldungen erreichen den Monitor sofort
Geht eine Sofortmeldung ein, SHALL der Lagemonitor seine Verdichtung neu abrufen, ohne auf den
Abruftakt zu warten. Das Signal an den Monitor MUST keinen Meldungsinhalt tragen.

#### Scenario: Neue Sofortmeldung
- **WHEN** eine Sofortmeldung eingeht
- **THEN** steht sie innerhalb weniger Sekunden in der Alarmzeile des Monitors, nicht erst nach 30 Sekunden
