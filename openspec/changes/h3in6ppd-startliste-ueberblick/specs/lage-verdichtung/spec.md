# Spec Delta

## MODIFIED Requirements

### Requirement: Überblick führt, Lagebild zeigt die Lage
Der Überblick SHALL zeigen, was zu tun ist: die Startliste eines neuen Einsatzes (Capability
`ueberblick-startliste`), Aufträge, Meldungen, Abschnitte, offene Vorgänge, nächste Marken und
Entscheidungen. Das Lagebild SHALL zeigen, was los ist: Betroffene, Kräfte, Vermisste, Gefahren,
Sichtung, Einsatzdauer, Lagebericht und Unfallhilfsstellen. Eine Kennzahl MUST auf genau einer der
beiden Seiten stehen; ausgenommen ist die Alarmzeile, die auf beiden steht. Die Startliste zeigt
Haken, keine Kennzahl.

#### Scenario: Betroffene nur im Lagebild
- **WHEN** jemand den Überblick öffnet
- **THEN** zeigt dessen Kennzahlenband weder Betroffene noch Kräfte noch Einsatzdauer

#### Scenario: Aufträge nur im Überblick
- **WHEN** jemand das Lagebild öffnet
- **THEN** zeigt es keine Kennzahl „Aufträge offen“ und keine Kennzahl „Meldungen offen“

#### Scenario: Startliste ohne Zahl
- **WHEN** die Einsatzleitung den Überblick eines Einsatzes mit zwei Einheiten und offenem Einsatzort öffnet
- **THEN** zeigt die Startliste beim Punkt Kräfte einen Haken und keine Zahl der Einheiten oder Kräfte
