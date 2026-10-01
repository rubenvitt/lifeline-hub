# Spec Delta

## Purpose

Legt fest, wie Zeitpunkte und Zeiträume in der Oberfläche eingegeben werden: in derselben
Zeitzone, in der sie angezeigt werden, ohne stillen Versatz beim Lesen, Speichern und Ändern.

## ADDED Requirements

### Requirement: Eingabe in der Anzeigezone
Jede Zeiteingabe SHALL einen vorhandenen Zeitpunkt mit der Wanduhrzeit der Anzeigezone zeigen,
in der dieselbe Seite ihn anzeigt. Anzeigezone ist die effektive Zeitzone der Anzeige-Konventionen
(Einsatz vor Organisation); fehlt sie oder ist sie keine gültige IANA-Zone, gilt die Zone des
Browsers. Die Browserzone MUST für die Eingabe sonst keine Rolle spielen.

#### Scenario: Bearbeiten-Dialog zeigt die Uhrzeit der Karte
- **WHEN** die Organisation Europe/Berlin führt, der Browser auf UTC steht und ein Verpflegungs-Zeitfenster von 2026-07-14 10:00 bis 11:30 UTC gespeichert ist
- **THEN** zeigt die Karte 12:00–13:30 und der Dialog „Bearbeiten“ ebenfalls 12:00 bis 13:30

#### Scenario: Ungültige Zone
- **WHEN** die Anzeigezone ein Wert ist, der keine IANA-Zone ist
- **THEN** zeigen Anzeige und Eingabe die Wanduhrzeit der Browserzone, und keine Eingabe bricht ab

### Requirement: Gewählte Uhrzeit gilt in der Anzeigezone
Eine eingegebene oder geänderte Uhrzeit SHALL als Wanduhrzeit der Anzeigezone gelesen und als der
entsprechende absolute Zeitpunkt (UTC) gesendet werden, auch beidseits einer Sommerzeit-Umstellung
der Anzeigezone.

#### Scenario: Korrektur im Dialog
- **WHEN** die Organisation Europe/Berlin führt, der Browser auf UTC steht und im Dialog der Beginn eines Zeitfensters am 14.07.2026 auf 13:00 gesetzt wird
- **THEN** sendet der Dialog `2026-07-14 11:00:00` als Beginn

#### Scenario: Umstellung im Oktober
- **WHEN** die Anzeigezone Europe/Berlin ist, der Browser auf UTC steht und 25.10.2026 01:30 eingegeben wird
- **THEN** wird `2026-10-24 23:30:00` gesendet

### Requirement: Unverändertes Speichern verschiebt nichts
Wird ein Dialog mit vorhandenen Zeitpunkten geöffnet und ohne Änderung an den Zeitfeldern
gespeichert, SHALL jeder gesendete Zeitpunkt derselbe absolute Zeitpunkt sein wie der gelesene;
ein Dialog, der nur Änderungen sendet, MUST die Zeitfelder dann nicht als geändert senden.

#### Scenario: Speichern ohne Änderung
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, und der Dialog „Bearbeiten“ eines Zeitfensters wird geöffnet und nur der Bedarf geändert
- **THEN** enthält die Anfrage keinen geänderten Beginn und kein geändertes Ende

### Requirement: Zone wird benannt, wenn sie abweicht
Weicht die Anzeigezone von der Browserzone ab, SHALL jede Zeiteingabe die Anzeigezone sichtbar
nennen. Stimmen beide überein, MUST kein Zonenhinweis erscheinen.

#### Scenario: Abweichende Browserzone
- **WHEN** die Anzeigezone Europe/Berlin ist und der Browser auf UTC steht
- **THEN** nennt die Zeiteingabe „Europe/Berlin“

#### Scenario: Gleiche Zone
- **WHEN** Anzeigezone und Browserzone beide Europe/Berlin sind
- **THEN** zeigt die Zeiteingabe keinen Zonenhinweis

### Requirement: Jetzt und heute in der Anzeigezone
Ein „Jetzt“ in einer Zeiteingabe SHALL den aktuellen Zeitpunkt setzen und ihn in der Anzeigezone
zeigen. Tagesgrenzen der Eingabe und der Fälligkeitsgruppen (keine Zukunftstage, „heute“,
„überfällig“) SHALL nach dem Kalendertag der Anzeigezone bestimmt werden.

#### Scenario: Jetzt bei abweichender Browserzone
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 10:00 UTC, und in einer Zeiteingabe wird „Jetzt“ gewählt
- **THEN** zeigt das Feld 12:00, und gesendet wird `2026-07-14 10:00:00`

#### Scenario: Zukunftstag nach Kalender der Anzeigezone
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 23:30 UTC (15.07. 01:30 in Berlin)
- **THEN** ist der 15.07. in einer Eingabe ohne Zukunftstage wählbar und der 16.07. nicht

#### Scenario: Frist heute
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 23:30 UTC und ein Auftrag ist am 15.07. 08:00 Berliner Zeit fällig
- **THEN** steht der Auftrag in der Gruppe „heute“

### Requirement: Zeit in Texten in der Anzeigezone
Uhrzeiten, die die Oberfläche in Texte setzt (Titelvorschlag eines Lageberichts, Stand-Zeit eines
Vorschlags, Uhrzeit eines Alarm-Hinweises, Ereigniszeit im Erfassungs-Chip), SHALL in der
Anzeigezone stehen.

#### Scenario: Titelvorschlag
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 10:00 UTC, und ein neuer Lagebericht wird angelegt
- **THEN** nennt der Titelvorschlag 1200

#### Scenario: Wiederhergestellter Entwurf
- **WHEN** ein ETB-Entwurf mit der Ereigniszeit 2026-07-14 10:00 UTC wiederhergestellt wird und die Anzeigezone Europe/Berlin ist
- **THEN** zeigt der Erfassungs-Chip 1200, nicht 1000

### Requirement: Zone außerhalb eines Einsatzes
Zeiteingaben außerhalb eines Einsatzes SHALL die Zeitzone der Organisation nutzen, sofern die
Person sie lesen darf, sonst die Browserzone. Die Archivakte eines Einsatzes SHALL Anzeige und
Eingabe in der Anzeigezone dieses Einsatzes führen.

#### Scenario: Einsatz anlegen
- **WHEN** die Organisation Europe/Berlin führt, der Browser auf UTC steht und eine Führungskraft „Einsatz anlegen“ öffnet
- **THEN** zeigt die Alarmzeit die aktuelle Berliner Uhrzeit, und der Zonenhinweis nennt Europe/Berlin

#### Scenario: Archivakte
- **WHEN** ein Admin die Archivakte eines Einsatzes mit Zeitzone Europe/Berlin öffnet und der Browser auf UTC steht
- **THEN** zeigen Frist-Anzeige und Frist-Eingabe dieselbe Berliner Uhrzeit
