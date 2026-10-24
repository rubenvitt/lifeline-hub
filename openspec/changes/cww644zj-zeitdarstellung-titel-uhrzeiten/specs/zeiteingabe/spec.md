# Spec Delta

## MODIFIED Requirements

### Requirement: Uhrzeit ohne Datum
Eine Uhrzeit ohne Datum (etwa der Beginn einer Mahlzeit im Verpflegungsplan) SHALL als „HHMM“,
„HH:MM“, „HMM“ oder „H:MM“ eingegeben werden können, getrimmt, aus ASCII-Ziffern, von 00:00 bis
23:59; gesendet MUST sie als `HH:MM` werden, alles andere MUST die Eingabe als unlesbar ablehnen.
Angezeigt wird sie in der Rolle „Uhrzeit“ der Zeitdarstellung, taktisch „0630“, bei „Datum und
Uhrzeit“ „06:30“; das Eingabefeld zeigt sie weiter taktisch. Wird sie auf einen Kalendertag gelegt, MUST das in der
Anzeigezone geschehen, nie in der Browserzone. Eine Uhrzeit, die es an dem Tag zweimal gibt
(Rückstellung), MUST beim ersten Mal gelten; eine, die es nicht gibt (Vorstellung), MUST um die
Länge der Lücke später gelten. Die Grenzen eines Kalendertags sind 00:00 des Tages und 00:00 des
Folgetags in der Anzeigezone; am Tag einer Umstellung liegen sie 23 bzw. 25 Stunden auseinander.

#### Scenario: Stab-Schreibweise
- **WHEN** „630“ oder „0630“ eingegeben wird
- **THEN** gilt 06:30, und „24:00“, „6.30“ sowie „12:60“ werden abgelehnt

#### Scenario: Sommerzeit
- **WHEN** die Anzeigezone Europe/Berlin ist, der Browser auf UTC steht und 06:30 auf den 11.10.2026 gelegt wird
- **THEN** ist der Zeitpunkt `2026-10-11 04:30:00` UTC

#### Scenario: Doppelte Stunde im Oktober
- **WHEN** die Anzeigezone Europe/Berlin ist und 02:30 auf den 25.10.2026 gelegt wird
- **THEN** ist der Zeitpunkt `2026-10-25 00:30:00` UTC (die erste 02:30), und der Tag hat 25 Stunden

#### Scenario: Ausfallende Stunde im März
- **WHEN** die Anzeigezone Europe/Berlin ist und 02:30 auf den 29.03.2026 gelegt wird
- **THEN** ist der Zeitpunkt `2026-03-29 01:30:00` UTC (03:30 Sommerzeit), und der Tag hat 23 Stunden

#### Scenario: Anzeige folgt der Zeitdarstellung
- **WHEN** die wirksame Darstellung „Datum und Uhrzeit“ ist und ein Verpflegungsplan eine Mahlzeit von 06:30 bis 08:00 oder ein Schichtmodell die Wechselzeiten 06:00 und 18:00 trägt
- **THEN** stehen in der Anzeige „06:30–08:00“ bzw. „Wechsel 06:00/18:00“, und das Feld „Wechselzeiten“ zeigt beim Bearbeiten „0600 1800“
