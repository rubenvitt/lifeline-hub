## MODIFIED Requirements

### Requirement: Namentliche Bestätigung am Gerät

Ein Gerät mit UHS-Ansicht SHALL bei Sichtung, Erst-Sichtung, Verbleib, Verletzung, Maßnahme und
Transport optional eine Person aus dem Personal des Einsatzes als Bestätigende angeben können. Der
Server MUST prüfen, dass die Angabe zum Einsatz gehört, und MUST Kennung und Namen am Schritt
speichern. Die Angabe MUST NOT eine Sitzung anlegen, die Gerätesitzung ändern oder die Rechte des
Geräts erweitern. Ein ohne Netz vorgemerkter Eintrag MUST die Angabe mitnehmen.

#### Scenario: Bestätigte Sichtung im ETB

- **WHEN** das Tablet der UHS Nord eine Sichtung mit „bestätigt von Dr. A. Muster“ speichert
- **THEN** nennt der System-Eintrag im ETB „UHS Nord · Tablet 1“ als Erfasser
- **AND** sein Text nennt „bestätigt: Dr. A. Muster“
- **AND** der Sichtungsverlauf der Person nennt die bestätigende Person

#### Scenario: Ohne Bestätigung

- **WHEN** das Tablet eine Sichtung ohne Angabe speichert
- **THEN** speichert der Server sie wie bisher, nur mit dem Gerät als Erfasser

#### Scenario: Personal eines anderen Einsatzes

- **WHEN** das Tablet eine Personal-Kennung eines anderen Einsatzes angibt
- **THEN** antwortet der Server mit 422
- **AND** speichert keine Sichtung

#### Scenario: Rechte wachsen nicht

- **WHEN** das Tablet nach einer bestätigten Sichtung eine Route außerhalb seiner Ansicht aufruft
- **THEN** antwortet der Server mit 403
- **AND** eine fremde UHS bleibt 404
- **AND** das Sitzungscookie des Geräts ist unverändert

#### Scenario: Personensitzung

- **WHEN** eine angemeldete Person eine Sichtung mit Bestätigungsangabe schickt
- **THEN** antwortet der Server mit 422

#### Scenario: Bestätigte Maßnahme ohne Netz

- **WHEN** das Tablet ohne Netz eine Maßnahme mit „bestätigt von Dr. A. Muster“ vormerkt
- **THEN** nennt der Verlauf nach der Übertragung Dr. A. Muster als bestätigende Person
