## RENAMED Requirements

- FROM: `### Requirement: Vorschlag im Zeit-Chip nach der Serveruhr`
- TO: `### Requirement: Feld Zeit nach der Serveruhr`

## MODIFIED Requirements

### Requirement: Vorbelegte Ereigniszeit nach der Serveruhr
Trägt die Person beim Erfassen eines ETB-Eintrags oder einer Meldung keine Ereigniszeit ein,
SHALL die Oberfläche als Ereigniszeit den Zeitpunkt des Absendens nach der Serveruhr senden,
soweit das Gerät seinen Versatz zur Serveruhr aus einer Antwort des Servers kennt; ohne
bekannten Versatz MUST die Geräteuhr gelten. Das gilt online wie beim Vormerken ohne Netz. Die
lokale Erfassungszeit eines ETB-Eintrags MUST derselbe Zeitpunkt sein.

#### Scenario: ETB-Eintrag eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und dort um 10:00 Serverzeit ein ETB-Eintrag mit leerem Feld Zeit erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 10:00 und die lokale Erfassungszeit 10:00
- **AND** die Zeitachse markiert ihn nicht als nachgetragen

#### Scenario: Meldung eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und dort um 10:00 Serverzeit eine Meldung mit leerem Feld „Ereigniszeit“ angelegt wird
- **THEN** trägt die Meldung die Ereigniszeit 10:00

#### Scenario: ETB-Eintrag offline vorgemerkt
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät vor dem Ausfall eine Antwort des Servers erhalten hat und ohne Netz um 10:00 Serverzeit ein ETB-Eintrag mit leerem Feld Zeit vorgemerkt wird
- **THEN** trägt der vorgemerkte Eintrag die Ereigniszeit 10:00, auch wenn er erst später gesendet wird

#### Scenario: Ohne bekannten Versatz gilt die Geräteuhr
- **WHEN** ein Gerät seit dem Start keine Antwort des Servers erhalten hat und ein ETB-Eintrag mit leerem Feld Zeit erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit nach der Geräteuhr

### Requirement: Eingetragene Ereigniszeit bleibt unverändert
Trägt die Person eine Ereigniszeit ein, SHALL die Oberfläche genau diesen Zeitpunkt senden,
ohne ihn um den Versatz zur Serveruhr zu korrigieren.

#### Scenario: Von Hand eingetragene Zeit im ETB
- **WHEN** die Uhr eines Geräts 5 min vorgeht und eine Person im Feld Zeit eines ETB-Eintrags 09:30 einträgt
- **THEN** trägt der Eintrag die Ereigniszeit 09:30

#### Scenario: Von Hand eingetragene Zeit bei einer Meldung
- **WHEN** die Uhr eines Geräts 5 min vorgeht und eine Person im Feld „Ereigniszeit“ einer Meldung 09:30 einträgt
- **THEN** trägt die Meldung die Ereigniszeit 09:30

### Requirement: Feld Zeit nach der Serveruhr
Steht in der ETB-Erfassung keine Ereigniszeit, SHALL das Feld Zeit „jetzt“ mit der Uhrzeit nach der
Serveruhr zeigen, soweit der Versatz bekannt ist; der Kalender des Felds SHALL denselben Zeitpunkt
vorschlagen. Übernimmt die Person den Vorschlag unverändert, MUST der Eintrag diesen Zeitpunkt
tragen.

#### Scenario: Vorschlag eines vorgehenden Geräts
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat und um 10:00 Serverzeit die ETB-Erfassung ohne Ereigniszeit steht
- **THEN** zeigt das Feld Zeit „jetzt · 1000“, nicht 1005
