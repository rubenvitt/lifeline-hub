# Spec Delta

## Purpose

Legt fest, welche Ereigniszeit ein ETB-Eintrag und eine Meldung tragen, wenn die Person keine
einträgt, und dass eine eingetragene Ereigniszeit unverändert gesendet wird.

## ADDED Requirements

### Requirement: Vorbelegte Ereigniszeit nach der Serveruhr
Trägt die Person beim Erfassen eines ETB-Eintrags oder einer Meldung keine Ereigniszeit ein,
SHALL die Oberfläche als Ereigniszeit den Zeitpunkt des Absendens nach der Serveruhr senden,
soweit das Gerät seinen Versatz zur Serveruhr aus einer Antwort des Servers kennt; ohne
bekannten Versatz MUST die Geräteuhr gelten. Das gilt online wie beim Vormerken ohne Netz. Die
lokale Erfassungszeit eines ETB-Eintrags MUST derselbe Zeitpunkt sein.

#### Scenario: ETB-Eintrag eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und dort um 10:00 Serverzeit ein ETB-Eintrag ohne Zeit-Chip erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 10:00 und die lokale Erfassungszeit 10:00
- **AND** die Zeitachse markiert ihn nicht als nachgetragen

#### Scenario: Meldung eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und dort um 10:00 Serverzeit eine Meldung der Einheit „RTW 2“ mit leerem Feld „Ereigniszeit“ angelegt wird und die Rückmeldefrist 30 min beträgt
- **THEN** trägt die Meldung die Ereigniszeit 10:00
- **AND** die nächste Rückmeldung von „RTW 2“ ist um 10:30 fällig, nicht um 10:35

#### Scenario: ETB-Eintrag offline vorgemerkt
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät vor dem Ausfall eine Antwort des Servers erhalten hat und ohne Netz um 10:00 Serverzeit ein ETB-Eintrag ohne Zeit-Chip vorgemerkt wird
- **THEN** trägt der vorgemerkte Eintrag die Ereigniszeit 10:00, auch wenn er erst später gesendet wird

#### Scenario: Ohne bekannten Versatz gilt die Geräteuhr
- **WHEN** ein Gerät seit dem Start keine Antwort des Servers erhalten hat und ein ETB-Eintrag ohne Zeit-Chip erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit nach der Geräteuhr

### Requirement: Eingetragene Ereigniszeit bleibt unverändert
Trägt die Person eine Ereigniszeit ein, SHALL die Oberfläche genau diesen Zeitpunkt senden,
ohne ihn um den Versatz zur Serveruhr zu korrigieren.

#### Scenario: Von Hand eingetragene Zeit im ETB
- **WHEN** die Uhr eines Geräts 5 min vorgeht und eine Person im Zeit-Chip eines ETB-Eintrags 09:30 einträgt
- **THEN** trägt der Eintrag die Ereigniszeit 09:30

#### Scenario: Von Hand eingetragene Zeit bei einer Meldung
- **WHEN** die Uhr eines Geräts 5 min vorgeht und eine Person im Feld „Ereigniszeit“ einer Meldung 09:30 einträgt
- **THEN** trägt die Meldung die Ereigniszeit 09:30

### Requirement: Vorschlag im Zeit-Chip nach der Serveruhr
Öffnet die Person in der ETB-Erfassung den Zeit-Chip ohne gesetzte Ereigniszeit, SHALL die
Eingabe den aktuellen Zeitpunkt nach der Serveruhr vorschlagen, soweit der Versatz bekannt ist.
Bestätigt sie den Vorschlag unverändert, MUST der Eintrag diesen Zeitpunkt tragen.

#### Scenario: Vorschlag eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und eine Person um 10:00 Serverzeit den Zeit-Chip öffnet
- **THEN** schlägt die Eingabe 10:00 vor, nicht 10:05
