# Spec Delta

## MODIFIED Requirements

### Requirement: Ziel eines Antrags

Ein Antrag SHALL genau ein Ziel haben: den ganzen Einsatz oder genau eine Person dieses
Einsatzes. Personenarten sind Betroffene im Personenregister, ad hoc erfasste externe Kräfte und
Anrufende am Informationstelefon. Eine unbekannte Zielart MUST 400 liefern, eine Person aus einem
anderen Einsatz 404, eine aus den Stammdaten disponierte Kraft 422. Die Zielart `medienkontakt`
MUST für einen neuen Antrag 422 liefern; ein bestehender Antrag mit diesem Ziel MUST in der
Archivakte mit Zielart, Kennung, Aktenzeichen und Stand lesbar bleiben.

#### Scenario: Person aus anderem Einsatz
- **WHEN** der Admin einen Antrag für eine Person stellt, die zu einem anderen Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Stammkraft
- **WHEN** der Admin einen Antrag für eine Personal-Disposition stellt, die auf eine Stammkraft verweist
- **THEN** antwortet das System mit 422

#### Scenario: Unbekannte Zielart
- **WHEN** die Anfrage eine Zielart nennt, die es nicht gibt
- **THEN** antwortet das System mit 400

#### Scenario: Medienkontakt als Ziel
- **WHEN** der Admin einen Antrag mit der Zielart `medienkontakt` stellt
- **THEN** antwortet das System mit 422 und legt keinen Antrag an

#### Scenario: Alter Antrag für einen Medienkontakt
- **WHEN** ein Einsatz vor dem Update einen vollzogenen Antrag für einen Medienkontakt trug und der Admin die Archivakte öffnet
- **THEN** steht der Antrag mit Zielart Medienkontakt, Kennung, Aktenzeichen und Stand in der Liste der Anträge

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
- **WHEN** der Antrag für eine ad hoc erfasste externe Kraft vollzogen wird, die Empfängerin eines Auftrags ist
- **THEN** sind Name, Funktion, Trägerorganisation und Bemerkung der Disposition geschwärzt
- **AND** tragen Auftragsempfänger und Kräfte-Zeitachse für diese Kraft keinen Namen oder Freitext mehr

#### Scenario: Anrufende Person
- **WHEN** ein Antrag für einen Anruf am Informationstelefon vollzogen wird
- **THEN** fehlen Name, Rückrufnummer und Notiz des Anrufs
- **AND** bleiben Anliegen, Status und Zeitpunkte erhalten
