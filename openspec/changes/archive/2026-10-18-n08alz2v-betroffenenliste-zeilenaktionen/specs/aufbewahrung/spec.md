## MODIFIED Requirements

### Requirement: Pseudonyme Spur im ETB

System-Einträge im ETB, die Personen, Tiere oder Schäden betreffen, SHALL diese über ihre
Registriernummer bezeichnen (`R-042`, `T-007`, `S-003`). Die Identitäts- und Kontaktangaben
der Personenzeile (Name, Vorname, Geburtsdatum, Herkunftsadresse, Fundort, Melderkontakt,
Zustand, Notiz), die Kontakte von Haltern und Geschädigten sowie die Tier-Kennzeichnung MUST
in keinem System-Eintrag stehen. Übernimmt ein System-Eintrag einen anderen Wert, den die
Klassifikation als Scrub führt, in seinen Wortlaut, MUST diese Stelle in einer
abschließenden Ausnahmeliste stehen, die ein Test pinnt. Der Wert bleibt dann als
Führungsdokumentation im ETB erhalten, auch über die Schwärzung hinweg. Eine neue solche
Stelle ohne Eintrag in der Liste ist ein Fehler.

#### Scenario: Person angelegt und gesichtet
- **WHEN** eine Person mit Name und Kontakt erfasst und gesichtet wird
- **THEN** nennen die System-Einträge nur ihre Registriernummer und die Kategorie

#### Scenario: Ausnahmeliste ist gepinnt
- **WHEN** der Ende-zu-Ende-Test die System-Einträge eines geschwärzten Einsatzes nach den gepflanzten Werten durchsucht
- **THEN** findet er einen Scrub-Wert nur an den Stellen, die die Ausnahmeliste führt

#### Scenario: Dokumentierte Ausnahme Schadensort
- **WHEN** ein Einsatz einen System-Eintrag enthält, der vor LFH-752 bei der Anlage eines Schadens dessen Ortskurzform in den Wortlaut geschrieben hat, und der Einsatz geschwärzt wird
- **THEN** ist der Ort in der Schadenszeile geschwärzt
- **AND** bleibt dieser ältere System-Eintrag unverändert, die Ortskurzform eingeschlossen

#### Scenario: Schadensort bleibt im Modul
- **WHEN** ein Schaden mit Ort angelegt und der Einsatz später geschwärzt wird
- **THEN** ist der Ort in der Schadenszeile geschwärzt
- **AND** nennt der System-Eintrag der Anlage nur Registriernummer, Typ und Ausmaß
- **AND** steht der Ort in keinem ETB-Eintrag
