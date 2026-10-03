## MODIFIED Requirements

### Requirement: Vollzug für eine Person

Der Vollzug eines Personen-Antrags SHALL genau die Werte entfernen, die die Klassifikation für
die Personenart dieser Person als personengebunden führt, und nur in den Zeilen, die über ihren
Bezug zu dieser Person gehören. Die Werte anderer Personen MUST unverändert bleiben. Erhalten
bleiben MUST Registriernummer, Status, Kategorien, Zeitpunkte und Verweise. Die physische
Entfernung MUST wie bei der Einsatz-Schwärzung erfolgen. Fotos und Dateien, die an der Person
abgelegt sind, MUST samt gespeicherter Datei gelöscht werden, auch bereits entfernte.

#### Scenario: Betroffene Person
- **WHEN** der Antrag für die Betroffene `R-042` mit Sichtung, Verlaufsnotiz, Verbleib, einem Tier als Halterin und einem Schaden als Geschädigte vollzogen wird
- **THEN** tragen ihre Personenzeile, ihre Sichtungs-, Verlaufs- und Verbleibzeilen keine Namen, Kontakte, Adressen, Ziele oder Notizen mehr
- **AND** sind Halterkontakt und Kennzeichnung des Tiers sowie Kontakt, Ort und Beschreibung des Schadens geschwärzt
- **AND** trägt sie weiter Registriernummer, Status und Sichtungskategorie

#### Scenario: Fotos und Dateien der Person
- **WHEN** an `R-042` zwei Dateien abgelegt sind, eine davon schon entfernt, und an `R-043` eine, und der Antrag für `R-042` vollzogen wird
- **THEN** gibt es für `R-042` keine gespeicherte Datei und keine Verknüpfung mehr
- **AND** liegt die Datei von `R-043` unverändert vor
- **AND** stehen die Einträge „Person R-042: Foto abgelegt/entfernt“ weiter im Einsatztagebuch

#### Scenario: Andere Personen bleiben
- **WHEN** derselbe Einsatz die Person `R-043` mit Name und Kontakt führt
- **THEN** trägt `R-043` nach dem Vollzug für `R-042` weiter Name und Kontakt

#### Scenario: Externe Kraft
- **WHEN** der Antrag für eine ad hoc erfasste externe Kraft vollzogen wird, die Empfängerin eines Auftrags und in einer Stabsfunktion eingetragen ist
- **THEN** sind Name, Funktion, Trägerorganisation und Bemerkung der Disposition geschwärzt
- **AND** tragen Auftragsempfänger, Stabsfunktion und Kräfte-Zeitachse für diese Kraft keinen Namen oder Freitext mehr

#### Scenario: Anrufende Person und Ansprechperson
- **WHEN** je ein Antrag für einen Anruf am Informationstelefon und für einen Medienkontakt vollzogen wird
- **THEN** fehlen Name, Rückrufnummer und Notiz des Anrufs sowie Name und Erreichbarkeit der Ansprechperson
- **AND** bleiben Anliegen, Status, Medium, Thema und Zeitpunkte erhalten

### Requirement: Personengebundene Werte vollständig klassifiziert

Für jede Personenart SHALL die Klassifikation jede Tabelle führen, die per Fremdschlüssel auf
die Zeile dieser Personenart verweist. Jede Scrub-Spalte einer solchen Tabelle MUST entweder als
personengebunden oder mit Begründung als nicht personengebunden markiert sein. Eine Retain-Spalte
MUST nie personengebunden sein. Eine Verknüpfung zu Dateien, die beim Einsatz ganz gelöscht wird,
MUST stattdessen als Dateien der Person geführt sein, mit `ON DELETE CASCADE` auf die Datei. Eine
neue Tabelle oder Spalte ohne diese Markierung MUST einen Test rot machen.

#### Scenario: Neuer Verweis auf eine Person
- **WHEN** eine Migration eine Tabelle mit einem Fremdschlüssel auf das Personenregister und einer Scrub-Spalte anlegt und die Klassifikation sie nicht als personengebunden oder nicht personengebunden führt
- **THEN** schlägt der Test der Klassifikation fehl

#### Scenario: Neue Datei-Verknüpfung an einer Person
- **WHEN** eine Migration eine Verknüpfung zwischen Personenregister und Dateien anlegt und die Klassifikation sie weder als Dateien der Person noch als Bezug führt
- **THEN** schlägt der Test der Klassifikation fehl
