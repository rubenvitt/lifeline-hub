# Spec Delta

## MODIFIED Requirements

### Requirement: Pseudonyme Spur im ETB

System-Einträge im ETB, die Personen, Tiere oder Schäden betreffen, SHALL diese über ihre
Registriernummer bezeichnen (`R-042`, `T-007`, `S-003`). Die Identitäts- und Kontaktangaben
der Personenzeile (Name, Vorname, Geburtsdatum, Herkunftsadresse, Antreffort, Melderkontakt,
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

## ADDED Requirements

### Requirement: Kein Scrub-Wert von Betroffenen und Dokumenten im ETB

System-Einträge zu Schäden, Personen, UHS-Belegungen und Dokumenten SHALL keinen Wert in ihren
Wortlaut übernehmen, den die Klassifikation in der Quellzeile als Scrub führt. Das betrifft
Schadensort, Übergabe-Adressat, Verbleib-Ziel, Notiz der Belegung und Dokumenttitel. Eine
Kategorie als Enum-Label ist zulässig. Einträge, die schon geschrieben sind, MUST unverändert
bleiben.

#### Scenario: Schaden übergeben
- **WHEN** ein Schaden an „Eigentümer Ruehl“ übergeben wird
- **THEN** nennt der System-Eintrag die Registriernummer des Schadens und die Übergabe
- **AND** steht „Eigentümer Ruehl“ in keinem ETB-Eintrag

#### Scenario: Verbleib mit Ziel
- **WHEN** für eine Person ein Transport nach „Klinikum Nordstadt“ oder eine Notunterkunft „Turnhalle Ost“ erfasst wird
- **THEN** lautet der System-Eintrag „Person R-…: abtransportiert“ bzw. „Person R-…: in Notunterkunft“
- **AND** führen Verbleib und Personenzeile das Ziel weiter bis zur Schwärzung

#### Scenario: Austritt aus der UHS mit Notiz
- **WHEN** eine Person mit der Notiz „an Hausarzt übergeben“ eine UHS verlässt
- **THEN** nennt der System-Eintrag Registriernummer und UHS, aber nicht die Notiz

#### Scenario: Dokument ablegen, ändern und entfernen
- **WHEN** ein Dokument mit dem Titel „Personenliste NU Turnhalle“ abgelegt, umbenannt und entfernt wird
- **THEN** nennen die drei System-Einträge die Kategorie
- **AND** steht weder der alte noch der neue Titel in einem ETB-Eintrag

### Requirement: Ausnahmeliste wird nicht länger

Die Ausnahmeliste der ETB-Spur MUST NOT einen Eintrag für einen Wert von Betroffenen (Schaden,
Person, Tier, Belegung) oder für einen Dokumenttitel erhalten. Ein neuer Eintrag SHALL nur in
den bewusst behaltenen Gruppen entstehen: Name und Funktion von Einsatzkräften, Bezeichnungen
der Lagestruktur, Wortlaut der Führungsmodule und Enum-Labels. Jeder Eintrag MUST seine
Begründung tragen.

#### Scenario: Gesperrte Spalte in der Liste
- **WHEN** jemand der Ausnahmeliste eine Spalte einer Tabelle von Schäden, Personen, Tieren, Belegungen oder den Dokumenttitel hinzufügt
- **THEN** schlägt der Selbsttest der Liste fehl
