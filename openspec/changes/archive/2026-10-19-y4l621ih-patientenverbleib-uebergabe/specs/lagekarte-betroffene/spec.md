# Spec Delta

## MODIFIED Requirements

### Requirement: Ebene „Betroffene“ auf der Lagekarte
Die Lagekarte SHALL eine Ebene „Betroffene“ führen. Ist sie eingeschaltet, MUST jede Person
des Einsatzes als Marker an ihrer Fundort-Koordinate erscheinen, sofern sie nicht storniert
ist, als angetroffen gilt (Status erfasst, betroffen oder verstorben), nicht abgeschlossen ist
(Versorgungszustand) und ein vollständiges Koordinatenpaar trägt. Vermisste und abgemeldete
Personen, abgeschlossene Patienten sowie Personen ohne Koordinate MUST NOT erscheinen. Die
Auswahl MUST dieselbe sein wie in der Kartenansicht der Betroffenen-Seite mit ausgeschaltetem
„Abgeschlossene zeigen“. Die Ebenen-Zeile MUST die Zahl der gezeichneten Personen zeigen.

#### Scenario: Eingeschaltete Ebene zeigt angetroffene Personen
- **WHEN** ein Benutzer mit Zugriff auf „Personen“ die Ebene „Betroffene“ einschaltet und der Einsatz eine betroffene Person mit Koordinate, eine vermisste Person mit Koordinate und eine betroffene Person ohne Koordinate hat
- **THEN** zeigt die Karte genau einen Personen-Marker, und die Ebenen-Zeile nennt die Anzahl 1

#### Scenario: Verstorbene erscheinen
- **WHEN** die Ebene an ist und eine Person mit Status „verstorben“ und Koordinate existiert
- **THEN** erscheint sie als Marker mit dem Sichtungskürzel für „tot“

#### Scenario: Live-Aktualisierung
- **WHEN** die Ebene an ist und an anderer Stelle eine Fundort-Koordinate gesetzt wird
- **THEN** erscheint der Marker ohne Neuladen der Seite

#### Scenario: Abgeschlossener Patient verschwindet
- **WHEN** die Ebene an ist und eine Person mit Koordinate vor Ort entlassen wird
- **THEN** verschwindet ihr Marker, und die Ebenen-Zeile zählt eins weniger
