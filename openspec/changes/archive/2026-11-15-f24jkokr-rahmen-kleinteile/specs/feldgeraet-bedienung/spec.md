## MODIFIED Requirements

### Requirement: Kopplungs- und Verbindungsstatus immer sichtbar

Die Kopfzeile eines Feldgeräts SHALL immer Stelle, Gerätebezeichnung, Verbindungsstatus und
das Ende der Kopplung zeigen. Das Ende der Kopplung SHALL als Restzeit mit dem Wort „Kopplung“
stehen, ab einer Stunde in ganzen Stunden, darunter in Minuten; die Endzeit in der
Zeitdarstellung des Einsatzes SHALL im Hinweistext und im zugänglichen Namen stehen. Endet die
Kopplung in weniger als einer Stunde, MUST die Anzeige das hervorheben.

#### Scenario: Kopplung läuft

- **WHEN** die Kopplung in 5 Stunden und 40 Minuten endet
- **THEN** zeigt die Kopfzeile „Kopplung noch 5 h“, und ihr Hinweistext nennt die Endzeit

#### Scenario: Kopplung endet bald

- **WHEN** die Kopplung in 40 Minuten endet
- **THEN** zeigt die Kopfzeile „Kopplung noch 40 min“ hervorgehoben

#### Scenario: Verbindung weg

- **WHEN** das Tablet keine Verbindung zum Server hat
- **THEN** zeigt die Kopfzeile „offline“ und den Stand der angezeigten Daten
