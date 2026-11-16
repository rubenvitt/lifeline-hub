## MODIFIED Requirements

### Requirement: Handlungsmengen kommen vom Modulzähler
Der Führungsüberblick und die Alarmzeile SHALL diese Zahlen ausschließlich aus
`GET /api/einsaetze/{id}/modul-zaehler` anzeigen: Aufträge offen, Aufträge in Arbeit, Aufträge
überfällig, Meldungen offen, Meldungen neu, Meldungen mit überfälliger Bestätigung, offene
Sofortmeldungen und offene dringende Meldungen. Sie MUST NOT diese Zahlen aus einer Modulliste
zählen.
- „Aufträge überfällig“ MUST die überfälligen unter den offenen Aufträgen meinen.
- „Bestätigung überfällig“ MUST `meldungen.bestaetigung_ueberfaellig` meinen, also auch eskalierte
  unbestätigte Meldungen.
- Fehlt ein Modul in der Antwort (nicht erlaubt), MUST die Kennzahl „nicht freigegeben“ sagen und
  MUST NOT 0 zeigen.
- Solange der Zähler lädt oder gescheitert ist, MUST die Kennzahl keinen Wert zeigen.

#### Scenario: Dashboard und Modulpanel stimmen überein
- **WHEN** der Modulzähler `auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 }` liefert
- **THEN** zeigt der Überblick „Offene Aufträge“ 5 mit der Notiz „1 überfällig“, und das
  Modulpanel zeigt an „Aufträge“ dieselbe 5

#### Scenario: Überblick und Dashboard stimmen überein
- **WHEN** der Modulzähler `auftraege.ueberfaellig: 2` liefert
- **THEN** nennt die Alarmzeile auf Überblick und Lagebild „2 Aufträge überfällig“, und die
  Notiz der Kennzahl im Überblick sagt „2 überfällig“

#### Scenario: Vollzogener Auftrag mit abgelaufener Frist
- **WHEN** ein Auftrag vollzogen ist, seine Frist abgelaufen ist und ein Empfänger nicht quittiert hat
- **THEN** zählt der Überblick ihn nicht als überfällig, und die Alarmzeile nennt ihn nicht

#### Scenario: Eskalierte Meldung
- **WHEN** eine bestätigungspflichtige, unbestätigte Meldung eskaliert ist, ihre Frist aber noch
  nicht abgelaufen ist
- **THEN** zählt der Überblick sie unter „Bestätigung überfällig“

#### Scenario: Meldungen nicht freigegeben
- **WHEN** die Antwort des Modulzählers kein Feld `meldungen` enthält
- **THEN** sagt die Kennzahl „Meldungen offen“ „nicht freigegeben“ und zeigt keine 0

## ADDED Requirements

### Requirement: Überblick führt, Lagebild zeigt die Lage
Der Überblick SHALL zeigen, was zu tun ist: Aufträge, Meldungen, Abschnitte, offene Vorgänge,
nächste Marken und Entscheidungen. Das Lagebild SHALL zeigen, was los ist: Betroffene, Kräfte,
Vermisste, Gefahren, Sichtung, Einsatzdauer, Lagebericht und Unfallhilfsstellen. Eine Kennzahl MUST
auf genau einer der beiden Seiten stehen; ausgenommen ist die Alarmzeile, die auf beiden steht.

#### Scenario: Betroffene nur im Lagebild
- **WHEN** jemand den Überblick öffnet
- **THEN** zeigt dessen Kennzahlenband weder Betroffene noch Kräfte noch Einsatzdauer

#### Scenario: Aufträge nur im Überblick
- **WHEN** jemand das Lagebild öffnet
- **THEN** zeigt es keine Kennzahl „Aufträge offen“ und keine Kennzahl „Meldungen offen“

### Requirement: Die Übersichten verweisen aufeinander
Der Überblick SHALL im Seitenkopf einen Sprung zum Lagebild tragen und das Lagebild einen Sprung
zum Überblick, sofern der Betrachter das Ziel öffnen darf.

#### Scenario: Vom Überblick ins Lagebild
- **WHEN** jemand im Überblick auf „Lagebild“ im Seitenkopf klickt
- **THEN** öffnet sich das Lagebild desselben Einsatzes
