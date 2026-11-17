## MODIFIED Requirements

### Requirement: Handlungsmengen kommen vom Modulzähler
Der Führungsüberblick und die Alarmzeile SHALL diese Zahlen ausschließlich aus
`GET /api/einsaetze/{id}/modul-zaehler` anzeigen: Aufträge offen, Aufträge in Arbeit, Aufträge
überfällig, Meldungen offen, Meldungen neu, Meldungen mit überfälliger Bestätigung, offene
Sofortmeldungen und offene dringende Meldungen. Sie MUST NOT diese Zahlen aus einer Modulliste
zählen. Im Überblick stehen sie in den Abschnitten „Meldungen“ und „Aufträge“ des Paneels „Offene
Vorgänge“.
- „Aufträge überfällig“ MUST die überfälligen unter den offenen Aufträgen meinen.
- „Bestätigung überfällig“ MUST `meldungen.bestaetigung_ueberfaellig` meinen, also auch eskalierte
  unbestätigte Meldungen.
- Fehlt ein Modul in der Antwort (nicht erlaubt), MUST der Abschnitt „nicht freigegeben“ sagen und
  MUST NOT 0 zeigen.
- Solange der Zähler lädt oder gescheitert ist, MUST der Abschnitt keinen Wert zeigen.

#### Scenario: Dashboard und Modulpanel stimmen überein
- **WHEN** der Modulzähler `auftraege: { offen: 5, in_arbeit: 2, ueberfaellig: 1 }` liefert
- **THEN** zeigt der Abschnitt „Aufträge“ im Überblick die Zahl 5 mit der Notiz „1 überfällig ·
  2 in Arbeit“, und das Modulpanel zeigt an „Aufträge“ dieselbe 5

#### Scenario: Überblick und Dashboard stimmen überein
- **WHEN** der Modulzähler `auftraege.ueberfaellig: 2` liefert
- **THEN** nennt die Alarmzeile auf Überblick und Lagebild „2 Aufträge überfällig“, und die
  Notiz des Abschnitts „Aufträge“ im Überblick sagt „2 überfällig“

#### Scenario: Vollzogener Auftrag mit abgelaufener Frist
- **WHEN** ein Auftrag vollzogen ist, seine Frist abgelaufen ist und ein Empfänger nicht quittiert hat
- **THEN** zählt der Überblick ihn nicht als überfällig, und die Alarmzeile nennt ihn nicht

#### Scenario: Eskalierte Meldung
- **WHEN** eine bestätigungspflichtige, unbestätigte Meldung eskaliert ist, ihre Frist aber noch
  nicht abgelaufen ist
- **THEN** zählt der Überblick sie unter „Bestätigung überfällig“

#### Scenario: Meldungen nicht freigegeben
- **WHEN** die Antwort des Modulzählers kein Feld `meldungen` enthält
- **THEN** sagt der Abschnitt „Meldungen“ „nicht freigegeben“ und zeigt keine 0

### Requirement: Überblick führt, Lagebild zeigt die Lage
Der Überblick SHALL zeigen, was zu tun ist: die Startliste eines neuen Einsatzes (Capability
`ueberblick-startliste`), Aufträge, Meldungen, Abschnitte, offene Vorgänge, nächste Marken und
Entscheidungen. Das Lagebild SHALL zeigen, was los ist: Betroffene, Kräfte, Vermisste, Gefahren,
Sichtung, Einsatzdauer, Lagebericht und Unfallhilfsstellen. Eine Kennzahl MUST auf genau einer der
beiden Seiten stehen; ausgenommen ist die Alarmzeile, die auf beiden steht. Die Startliste zeigt
Haken, keine Kennzahl. Der Überblick MUST NOT ein Kennzahlenband tragen: seine Zahlen stehen in den
Paneelen. Die erste Paneelreihe MUST „Nächste Marken“ und „Offene Vorgänge“ tragen, die zweite
„Einsatzabschnitte“ und die Entscheidungen.

#### Scenario: Betroffene nur im Lagebild
- **WHEN** jemand den Überblick öffnet
- **THEN** zeigt er weder Betroffene noch Kräfte noch Einsatzdauer

#### Scenario: Aufträge nur im Überblick
- **WHEN** jemand das Lagebild öffnet
- **THEN** zeigt es keine Kennzahl „Aufträge offen“ und keine Kennzahl „Meldungen offen“

#### Scenario: Startliste ohne Zahl
- **WHEN** die Einsatzleitung den Überblick eines Einsatzes mit zwei Einheiten und offenem Einsatzort öffnet
- **THEN** zeigt die Startliste beim Punkt Kräfte einen Haken und keine Zahl der Einheiten oder Kräfte

#### Scenario: Kein Band im Überblick
- **WHEN** jemand den Überblick eines laufenden Einsatzes öffnet
- **THEN** folgt auf die Alarmzeile (und die Startliste, falls sie steht) direkt die Paneelreihe
  mit „Nächste Marken“ und „Offene Vorgänge“, ohne Kennzahlenband dazwischen

#### Scenario: Fristen über der Falz
- **WHEN** die Einsatzleitung den Überblick des Übungseinsatzes am Fükw (1440 × 900 px) ohne
  Startliste öffnet
- **THEN** beginnt das Paneel „Nächste Marken“ innerhalb der ersten 900 px des Fensters

#### Scenario: Fristen zuerst am Handy
- **WHEN** dieselbe Seite bei 390 px Breite offen ist
- **THEN** steht „Nächste Marken“ als erstes Paneel unter Alarmzeile und Startliste, vor „Offene
  Vorgänge“, „Einsatzabschnitte“ und den Entscheidungen
