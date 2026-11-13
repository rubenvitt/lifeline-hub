## MODIFIED Requirements

### Requirement: Die meldende Seite prüft jede Übernahme gegen sie

Erhält die meldende Seite eine Akte, die ihr die Führung nimmt, MUST sie diese nur annehmen, wenn
sie eine reguläre Übergabe von ihr selbst bestätigt oder eine Erklärung trägt, deren Unterschrift
von einem gültigen Unterschriftsschlüssel der zugeordneten Org über genau diese Erklärung stammt
oder deren Code zu ihrem Abgabecode passt. Sonst MUST sie die Akte verwerfen und weiter führen.
Ausgenommen ist eine Akte, an der eine dritte Instanz beteiligt ist (sie führt, oder sie hat die
Epoche vergeben, mit der die erreichte Seite selbst führt), und eine Akte, deren Erklärung nicht
die meldende Seite, sondern eine andere Instanz als bisherigen Führer eines anderen Stands nennt
als dessen, mit dem die meldende Seite führt: Die MUST die meldende Seite ohne Alarm offen halten,
bis die Einsatzleitung entscheidet. Eine Akte ohne Erklärung, mit unlesbarer Erklärung oder mit
einer Erklärung, die den Stand der meldenden Seite mit einem anderen bisherigen Führer nennt, fällt
nicht unter die Ausnahme.

#### Scenario: Gültige Unterschrift
- **WHEN** der ELW eine Erklärung des Hubs erhält, die Admin A mit einem am ELW gültigen Schlüssel unterschrieben hat
- **THEN** zeigt der ELW unter der Kopfleiste über die volle Breite „Führung übernommen von Hub Nord“ mit Zeit, „unterzeichnet von Admin A“ und dem Grund „ELW ohne Verbindung seit 40 min“, dazu „Übernahme bestätigen“ und „Widersprechen“, und schreibt weiter

#### Scenario: Schlüssel wartet auf Bestätigung
- **WHEN** die Unterschrift von einem Schlüssel stammt, der am ELW noch auf Bestätigung wartet
- **THEN** verwirft der ELW die Übernahme als ungültig

#### Scenario: Ungültige Übernahme
- **WHEN** der ELW eine Übernahme ohne gültige Unterschrift und ohne passenden Code erhält
- **THEN** führt der ELW weiter, löst die Benachrichtigung „Ungültige Übernahme der Führung“ an die Einsatzleitung aus und schreibt einen Eintrag in die Admin-Spur

#### Scenario: Übernahme ohne Erklärung
- **WHEN** der ELW führt und der Hub sich mit eigener, größerer Epoche als Führer meldet, ohne Erklärung
- **THEN** verwirft der ELW die Übernahme mit der Benachrichtigung „Ungültige Übernahme der Führung“ und führt mit der nächsten Epoche weiter

#### Scenario: Erklärung über den eigenen Stand mit anderem Führer
- **WHEN** der ELW mit Epoche (1, ELW) führt und der Hub eine unterschriebene Erklärung schickt, die (1, ELW) als bisherigen Stand und eine andere Instanz als bisherigen Führer nennt
- **THEN** verwirft der ELW die Übernahme mit der Benachrichtigung „Ungültige Übernahme der Führung“

#### Scenario: Hub holt sich die Führung per Notübernahme von ELW 1 zurück
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) gegen den Hub erklärt, am Hub „ELW 1“ mit (2, ELW 1) führt, der Hub per unterschriebener Notübernahme gegen „ELW 1“ mit (3, Hub) zurückholt und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Grund und Unterzeichner der Erklärung gegen „ELW 1“, ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in der Admin-Spur, und schreibt weiter

#### Scenario: Hub holt sich die Führung per Widerruf von ELW 1 zurück
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) gegen den Hub erklärt, am Hub „ELW 1“ mit (2, ELW 1) führt, der Admin am Hub die Org-Zuordnung von „ELW 1“ widerruft und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in der Admin-Spur, und schreibt weiter

### Requirement: Widerruf holt die Führung zurück

Endet bei eingeschaltetem Schalter die Org-Zuordnung einer Kopplung, hier oder beim Gegenüber,
SHALL diese Instanz jeden Einsatz der Org, den sie als Spiegel hält und dessen Akte das Gegenüber
als Führer nennt, mit der nächsten Epoche selbst und schreibbar führen; Bruchstelle ist der
Zeitpunkt, zu dem sie vom Widerruf erfährt. Die Akte MUST danach eine Erklärung ohne Beweis
tragen, die das Gegenüber als bisherigen Führer und „Kopplung widerrufen“ als Grund nennt, damit
andere meldende Seiten die Übernahme als gegen eine dritte Instanz gerichtet erkennen. Offene
Übernahmen dieses Gegenübers MUST verfallen.

#### Scenario: Widerruf am ELW
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, und der Admin am ELW die Org-Zuordnung widerruft
- **THEN** führt der ELW ihn mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist am ELW wieder schreibbar, und der Verlauf zeigt eine Notübernahme mit dem Grund „Kopplung widerrufen“ und dem Widerruf als Bruchstelle

#### Scenario: Offene Übernahme verfällt
- **WHEN** am ELW eine gültige Notübernahme des Hubs auf Bestätigung wartet und die Org-Zuordnung zum Hub widerrufen wird
- **THEN** verschwindet „Führung übernommen von …“, und der ELW führt weiter

#### Scenario: Ein dritter ELW sieht den Widerruf im Verlauf
- **WHEN** „ELW 1“ einen Einsatz führt, „ELW 2“ dessen Akte über den Hub kennt, ohne zu führen, und der Admin am Hub die Org-Zuordnung von „ELW 1“ widerruft
- **THEN** zeigt der Verlauf dieser Akte an „ELW 2“ nach der nächsten Meldung den Wechsel zum Hub mit dem Grund „Kopplung widerrufen“, ohne Unterzeichner
