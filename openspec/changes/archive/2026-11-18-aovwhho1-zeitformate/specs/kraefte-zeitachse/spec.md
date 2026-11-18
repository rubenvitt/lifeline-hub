## MODIFIED Requirements

### Requirement: Anzeige

Das Meldebild SHALL je Einheit eine Spalte „Im Einsatz“ mit der laufenden Einsatzdauer führen,
in Mono mit Tabellenziffern, mit dem Anker als zugänglicher Beschreibung, und ohne Periode mit
„—“; die Spalte MUST auch im Druck erscheinen. Die Einheit-Detailseite SHALL die Zeitachse als
Folge von Zeitachseneinträgen zeigen, gestrichene Einträge durchgestrichen mit Grund, und
Nachtrag, Berichtigung des Zeitpunkts („Zeit berichtigen“) und Streichung anbieten. Die
Personalliste des Einsatzes SHALL je Person die Einsatzdauer zeigen und die Ruhezeit als Spalte
über den Spaltenschalter anbieten; sie MUST NOT die Zeitachse einer Person aufklappen. Die
Personenansicht SHALL im Kopf die laufende Einsatzdauer bzw. die Ruhezeit zeigen und die
Zeitachse der Person als eigenen Abschnitt nach Einteilung und Person führen, samt Nachtrag,
Berichtigung und Streichung. Die Herkunft eines Ereignisses (Status, über Einheit, Ablösung,
nachgetragen) MUST als Wort erkennbar sein. Keine Angabe darf blinken. Eingefärbt eingestuft
werden MUST nur die Zelle „Im Einsatz“ des Meldebilds und die Zelle „Einsatzdauer“ der
Personalliste, und nur nach der Anforderung „Einstufung gegen die Grenzwerte des Einsatzes“;
jede andere Angabe der Zeitachse, auch die Spalte „Ruhe“, bleibt neutral. Ohne Schreibrecht MUST
die Seite den Grund nennen und Nachtrag, Berichtigung und Streichung gesperrt statt entfernt
zeigen.

#### Scenario: Meldebild ohne Ereignisse
- **WHEN** eine Einheit ohne Ereignisse im Meldebild steht
- **THEN** zeigt ihre Zelle „Im Einsatz“ „—“ und keine Zahl

#### Scenario: Meldebild mit laufender Periode
- **WHEN** eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 13:50 betrachtet wird
- **THEN** zeigt ihre Zelle „7 h 40 min“, und die zugängliche Beschreibung nennt „seit Alarmierung 06:10“

#### Scenario: Herkunft sichtbar
- **WHEN** ein Personen-Ereignis per Fan-out entstanden ist
- **THEN** zeigt der Eintrag in der Zeitachse der Person das Wort „über Einheit“ mit dem Namen der Einheit

#### Scenario: Zeitachse in der Ansicht, nicht in der Liste
- **WHEN** die Personalliste und danach die Personenansicht einer Person mit Alarmierung 06:10 geöffnet werden
- **THEN** trägt die Zeile der Liste die Einsatzdauer und keinen Aufklapper „Zeitachse“, und die Ansicht zeigt die Alarmierung 06:10 im Abschnitt „Zeitachse“ mit „Nachtragen“

#### Scenario: Ruhe im Spaltenschalter
- **WHEN** die Personalliste ohne eigene Spaltenwahl geöffnet wird
- **THEN** ist die Spalte „Ruhe“ ausgeblendet, im Zähler des Spaltenschalters mitgezählt und dort einblendbar

#### Scenario: Zeit berichtigen im Dialog
- **WHEN** an einem Eintreffen 06:40 „Zeit berichtigen“ gewählt wird
- **THEN** öffnet ein Dialog mit dem Zeitpunkt 06:40 vorbelegt und einem Pflichtfeld Grund, und eine Ablehnung des Servers steht im Dialog

#### Scenario: Ruhe bleibt neutral
- **WHEN** eine Person seit 2 h in Ruhe ist und die Mindestruhe 8 h beträgt
- **THEN** zeigt die Spalte „Ruhe“ „2 h“ ohne Einfärbung und ohne Wort

### Requirement: Einstufung gegen die Grenzwerte des Einsatzes

Das System SHALL die laufende Periode einer Kraft gegen die **wirksamen** Grenzwerte des
Einsatzes einstufen, also gegen dieselben Werte, die der Plan-Befund `dienst` liest (Capability
`kraefte-schichtplan`, „Grenzwerte des Einsatzes“): Höchstdienst und Mindestruhe, ohne eigenen
Wert 12 h bzw. 8 h. Es MUST keine zweite Einstellung geben.

- **Dienststrecke:** Die Perioden einer Kraft bilden in zeitlicher Folge Strecken. Eine Lücke
  zwischen dem Ende einer Periode und dem Beginn der nächsten trennt zwei Strecken nur, wenn sie
  größer als null und mindestens die Mindestruhe ist. Die laufende Strecke ist die Strecke mit der
  offenen Periode; ihre Länge zählt vom Beginn ihrer ersten Periode bis jetzt.
- **„zu lang“:** Ist die laufende Strecke echt länger als der Höchstdienst, MUST die Kraft „zu
  lang“ heißen.
- **„Ruhe zu kurz“:** Liegt vor der offenen Periode eine Periode und ist die Lücke dazwischen
  größer als null und kleiner als die Mindestruhe, MUST die Kraft „Ruhe zu kurz“ heißen, sofern
  sie nicht schon „zu lang“ heißt.

Ohne offene Periode MUST es keine Einstufung geben. Ohne Ereignis MUST es keine Einstufung geben,
und eine fehlende Zahl MUST NOT als 0 gelten. Das System MUST die Einstufung nicht speichern. Sie
MUST NOT einen Hinweis in der AlarmZentrale, einen Modulzähler oder eine Benachrichtigung
auslösen.

Die Einstufung SHALL in der Rolle `achtung` mit dem Wort als zweitem Kanal erscheinen: in der
Zelle „Im Einsatz“ des Meldebilds und in der Zelle „Einsatzdauer“ der Personalliste, neben der
unveränderten Zahl. Die zugängliche Beschreibung MUST Beginn und Länge der Strecke bzw. die Länge
der Ruhe und den Grenzwert nennen. Sind die Grenzwerte nicht geladen, MUST die Zelle die Zahl
ohne Einstufung zeigen.

#### Scenario: Zu lang in einer Periode
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 18:30 betrachtet wird
- **THEN** zeigt ihre Zelle „Im Einsatz“ „12 h 20 min“ mit dem Wort „zu lang“ in der Rolle `achtung`

#### Scenario: Genau am Höchstwert
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 18:10 betrachtet wird
- **THEN** zeigt ihre Zelle „12 h“ ohne Einstufung

#### Scenario: Kurze Pause trennt die Strecke nicht
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 08:00–14:00 im Einsatz war und seit 16:00 wieder im Einsatz ist und um 22:30 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „6 h 30 min“ mit dem Wort „zu lang“, und die Beschreibung nennt die Strecke seit 08:00 mit 14 h 30 min

#### Scenario: Ruhe zu kurz
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 08:00–14:00 im Einsatz war und seit 16:00 wieder im Einsatz ist und um 17:00 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „1 h“ mit dem Wort „Ruhe zu kurz“, und die Beschreibung nennt 2 h Ruhe bei 8 h Mindestruhe

#### Scenario: Genug Ruhe
- **WHEN** die Vorgaben 12 h / 8 h gelten und eine Person 06:00–12:00 im Einsatz war und seit 20:00 wieder im Einsatz ist und um 23:00 betrachtet wird
- **THEN** zeigt ihre Zelle „3 h“ ohne Einstufung

#### Scenario: Eigener Wert des Einsatzes
- **WHEN** der Einsatz den Höchstdienst auf 6 h setzt und eine Einheit seit Alarmierung 06:10 im Einsatz ist und um 12:30 betrachtet wird
- **THEN** zeigt ihre Zelle „6 h 20 min“ mit dem Wort „zu lang“, und der Plan prüft mit demselben Wert

#### Scenario: Ohne offene Periode
- **WHEN** eine Person, deren Periode nach 13 h um 19:00 endete, um 20:00 betrachtet wird
- **THEN** zeigt ihre Zelle „Einsatzdauer“ „—“ ohne Einstufung, und die Spalte „Ruhe“ zeigt „1 h“ neutral

#### Scenario: Ohne Ereignis
- **WHEN** eine Einheit ohne Ereignisse im Meldebild steht
- **THEN** zeigt ihre Zelle „—“ ohne Einstufung

#### Scenario: Grenzwerte nicht geladen
- **WHEN** der Abruf der Grenzwerte scheitert und eine Einheit seit 14 h im Einsatz ist
- **THEN** zeigt ihre Zelle die Einsatzdauer ohne Einstufung

#### Scenario: Kein Alarm
- **WHEN** eine Einheit „zu lang“ heißt
- **THEN** entsteht kein Eintrag in der AlarmZentrale, kein Modulzähler und keine Benachrichtigung

