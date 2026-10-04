# Spec Delta

## MODIFIED Requirements

### Requirement: Jetzt und heute in der Anzeigezone
Ein „Jetzt“ in einer Zeiteingabe SHALL den aktuellen Zeitpunkt setzen und ihn in der Anzeigezone
zeigen. Der aktuelle Zeitpunkt MUST nach der Serveruhr bemessen sein, soweit das Gerät seinen
Versatz zur Serveruhr aus einer Antwort des Servers kennt; ohne bekannten Versatz gilt die
Geräteuhr. Tagesgrenzen der Eingabe und der Fälligkeitsgruppen (keine Zukunftstage, „heute“,
„überfällig“) SHALL nach dem Kalendertag der Anzeigezone bestimmt werden.

#### Scenario: Jetzt bei abweichender Browserzone
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 10:00 UTC, und in einer Zeiteingabe wird „Jetzt“ gewählt
- **THEN** zeigt das Feld 12:00, und gesendet wird `2026-07-14 10:00:00`

#### Scenario: Jetzt auf einem vorgehenden Gerät
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat, es ist 10:00 Serverzeit, und in einer Zeiteingabe wird „Jetzt“ gewählt
- **THEN** zeigt das Feld 10:00, nicht 10:05

#### Scenario: Zukunftstag nach Kalender der Anzeigezone
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 23:30 UTC (15.07. 01:30 in Berlin)
- **THEN** ist der 15.07. in einer Eingabe ohne Zukunftstage wählbar und der 16.07. nicht

#### Scenario: Frist heute
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 23:30 UTC und ein Auftrag ist am 15.07. 08:00 Berliner Zeit fällig
- **THEN** steht der Auftrag in der Gruppe „heute“
