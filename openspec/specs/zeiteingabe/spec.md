# zeiteingabe Specification

## Purpose
Legt fest, wie Zeitpunkte und Zeiträume in der Oberfläche eingegeben werden: in derselben
Zeitzone, in der sie angezeigt werden, ohne stillen Versatz beim Lesen, Speichern und Ändern.

## Requirements

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
zeigen. Der aktuelle Zeitpunkt MUST nach der Serveruhr bemessen sein, soweit das Gerät seinen
Versatz zur Serveruhr aus einer Antwort des Servers kennt; ohne bekannten Versatz gilt die
Geräteuhr. Eine Prüfung der Eingabe auf Zeitpunkte in der Zukunft MUST an derselben Uhr messen,
sodass ein „Jetzt“ sie immer besteht. Tagesgrenzen der Eingabe und der Fälligkeitsgruppen (keine Zukunftstage, „heute“,
„überfällig“) SHALL nach dem Kalendertag der Anzeigezone bestimmt werden.

#### Scenario: Jetzt bei abweichender Browserzone
- **WHEN** Browser UTC, Anzeigezone Europe/Berlin, es ist 2026-07-14 10:00 UTC, und in einer Zeiteingabe wird „Jetzt“ gewählt
- **THEN** zeigt das Feld 12:00, und gesendet wird `2026-07-14 10:00:00`

#### Scenario: Jetzt auf einem vorgehenden Gerät
- **WHEN** die Uhr eines Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat, es ist 10:00 Serverzeit, und in einer Zeiteingabe wird „Jetzt“ gewählt
- **THEN** zeigt das Feld 10:00, nicht 10:05

#### Scenario: Jetzt auf einem nachgehenden Gerät ist keine Zukunft
- **WHEN** die Uhr eines Geräts 10 min nachgeht, das Gerät eine Antwort des Servers erhalten hat und in einer Zeiteingabe ohne Zukunftszeitpunkte „Jetzt“ gewählt wird
- **THEN** meldet die Eingabe keinen Zeitpunkt in der Zukunft

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

### Requirement: Uhrzeit ohne Datum
Eine Uhrzeit ohne Datum (etwa der Beginn einer Mahlzeit im Verpflegungsplan) SHALL als „HHMM“,
„HH:MM“, „HMM“ oder „H:MM“ eingegeben werden können, getrimmt, aus ASCII-Ziffern, von 00:00 bis
23:59; gesendet MUST sie als `HH:MM` werden, alles andere MUST die Eingabe als unlesbar ablehnen.
Angezeigt wird sie taktisch („0630“). Wird sie auf einen Kalendertag gelegt, MUST das in der
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

### Requirement: Eingabe als Text
Jede Zeiteingabe SHALL einen Zeitpunkt als getippten Text annehmen, gelesen als Wanduhrzeit der
Anzeigezone. Enter MUST eine lesbare Eingabe übernehmen; in einem Formular sendet derselbe
Tastendruck danach ab wie bisher. Verlassen des Felds MUST eine lesbare Eingabe ebenfalls
übernehmen. Escape MUST die Eingabe verwerfen und den geltenden Wert wieder zeigen. Ein geleertes
Feld MUST als „kein Zeitpunkt“ gelten, sofern das Feld Leeren erlaubt.

#### Scenario: Tippen und Enter
- **WHEN** die Anzeigezone Europe/Berlin ist, der Browser auf UTC steht, es 2026-10-17 15:00 Berliner Zeit ist und in einem Zeitfeld „1430“ getippt und Enter gedrückt wird
- **THEN** gilt 2026-10-17 14:30 Berliner Zeit, und gesendet wird `2026-10-17 12:30:00`

#### Scenario: Verlassen übernimmt
- **WHEN** in einem Formular „0815“ in ein Zeitfeld getippt und danach direkt „Speichern“ geklickt wird
- **THEN** sendet das Formular 08:15 des Tages, nicht den vorherigen Wert

#### Scenario: Escape verwirft
- **WHEN** ein Zeitfeld 161430okt26 zeigt, „0900“ getippt und Escape gedrückt wird
- **THEN** zeigt das Feld wieder 161430okt26, und der Wert ist unverändert

### Requirement: Taktische und gebräuchliche Schreibweisen
Eine Zeiteingabe SHALL Uhrzeiten als `HHMM`, `HMM`, `HH:MM` und `HH.MM` lesen, den Tag mit
Uhrzeit als `TTHHMM`, die volle Datum-Zeit-Gruppe als `TTHHMMmmm` mit zwei- oder vierstelligem
Jahr oder ohne Jahr, dazu `TT.MM.[JJ|JJJJ] HHMM` und `JJJJ-MM-TT HH:MM[:SS]`. Groß- und
Kleinschreibung MUST egal sein; Monatskürzel MUST mit und ohne Umlaut gelten (`mrz`, `mär`).

#### Scenario: Datum-Zeit-Gruppe
- **WHEN** „101430okt26“, „101430OKT2026“ oder „10.10.26 1430“ eingegeben wird
- **THEN** gilt jeweils der 10.10.2026 14:30 in der Anzeigezone

#### Scenario: Tag und Uhrzeit ohne Monat
- **WHEN** am 17.10.2026 in einem Feld ohne Feldart „101430“ eingegeben wird
- **THEN** gilt der 10.10.2026 14:30

#### Scenario: Sommerzeitgrenze
- **WHEN** die Anzeigezone Europe/Berlin ist und „250230okt26“ eingegeben wird
- **THEN** gilt die erste 02:30 dieses Tages, gesendet wird `2026-10-25 00:30:00`

### Requirement: Relative Eingabe
Eine Zeiteingabe SHALL „j“ und „jetzt“ als den aktuellen Zeitpunkt lesen und `-N`, `-Nm`, `-Nh`
bzw. `+N`, `+Nm`, `+Nh` als N Minuten oder Stunden vor bzw. nach jetzt. Jetzt MUST dabei nach
derselben Uhr bemessen sein wie „Jetzt“ (Serveruhr, soweit der Versatz bekannt ist).

#### Scenario: Vor fünf Minuten
- **WHEN** die Uhr des Geräts 5 min vorgeht, das Gerät eine Antwort des Servers erhalten hat, es 10:00 Serverzeit ist und „-5“ eingegeben wird
- **THEN** gilt 09:55, nicht 10:00

#### Scenario: Frist in anderthalb Stunden
- **WHEN** es 10:00 ist und „+90“ eingegeben wird
- **THEN** gilt 11:30 desselben Tages

### Requirement: Richtung nach Feldart
Eine Zeiteingabe SHALL eine Feldart tragen können: Ereignis (Vergangenheit) oder Frist
(Zukunft). Eine Uhrzeit ohne Tag MUST im Ereignisfeld auf den Vortag fallen, wenn sie heute
noch bevorsteht, und im Fristfeld auf den Folgetag, wenn sie heute vorbei ist; ein Tag ohne
Monat entsprechend auf den Vor- bzw. Folgemonat. Ohne Feldart MUST heute bzw. der laufende Monat
gelten. Wechselt der Tag dadurch, MUST das Feld „gestern“ bzw. „morgen“ nennen.

#### Scenario: Ereignis kurz nach Mitternacht
- **WHEN** es 2026-10-17 00:20 ist und in einem Ereignisfeld „2350“ eingegeben wird
- **THEN** gilt 2026-10-16 23:50, und das Feld nennt „gestern“

#### Scenario: Frist am Abend
- **WHEN** es 2026-10-17 22:00 ist und in einem Fristfeld „0800“ eingegeben wird
- **THEN** gilt 2026-10-18 08:00, und das Feld nennt „morgen“

#### Scenario: Monatswechsel
- **WHEN** es 2026-11-01 09:00 ist und in einem Ereignisfeld „311430“ eingegeben wird
- **THEN** gilt 2026-10-31 14:30

#### Scenario: Keine Zukunftstage
- **WHEN** ein Feld keine Zukunftstage erlaubt und keine Feldart nennt
- **THEN** gilt es als Ereignisfeld

### Requirement: Unlesbare Eingabe wird nicht übernommen
Eine Eingabe, die sich nicht eindeutig als Zeitpunkt lesen lässt, SHALL nicht übernommen und
nicht still korrigiert werden. Das Feld MUST den Grund in wenigen Wörtern sichtbar nennen, und
Enter MUST dann nicht absenden. Verlässt die Person das Feld, MUST es wieder den geltenden Wert
zeigen und den Grund weiter nennen, bis erneut getippt wird.

#### Scenario: Uhrzeit gibt es nicht
- **WHEN** „2460“ eingegeben und Enter gedrückt wird
- **THEN** sendet das Formular nicht ab, und das Feld nennt „Uhrzeit gibt es nicht“

#### Scenario: Verlassen mit unlesbarer Eingabe
- **WHEN** ein Feld 161430okt26 zeigt, „14:3x“ getippt und danach „Speichern“ geklickt wird
- **THEN** zeigt das Feld wieder 161430okt26, nennt den Grund, und gesendet wird der unveränderte Wert

#### Scenario: Zukunftstag in einem Feld ohne Zukunftstage
- **WHEN** ein Feld keine Zukunftstage erlaubt und ein Tag nach heute (Kalender der Anzeigezone) eingegeben wird
- **THEN** wird die Eingabe nicht übernommen, und das Feld nennt „liegt in der Zukunft“

### Requirement: Anzeige im Feld als Datum-Zeit-Gruppe
Ein Zeitfeld SHALL seinen Wert als volle Datum-Zeit-Gruppe in der Anzeigezone zeigen: Tag,
Stunde und Minute zweistellig, Monatskürzel klein und ohne Umlaut, Jahr zweistellig
(`161430okt26`), in Mono mit Ziffern fester Breite. Während getippt wird, SHALL das Feld die
Deutung der Eingabe in derselben Schreibweise daneben zeigen.

#### Scenario: Wert zeigen
- **WHEN** ein Feld den Zeitpunkt 2026-03-16 13:30 UTC hält und die Anzeigezone Europe/Berlin ist
- **THEN** zeigt das Feld „161430mrz26“

#### Scenario: Deutung beim Tippen
- **WHEN** am 17.10.2026 „1430“ getippt, aber noch nicht übernommen ist
- **THEN** steht am Feld „= 171430okt26“

### Requirement: Kalender als Nebenweg
Ein Zeitfeld SHALL einen Kalender als Nebenweg anbieten. Seine Woche MUST am Montag beginnen.
Die Uhrzeit MUST dort als Text eingegeben werden, nicht über Scrollspalten. Übernommen MUST
erst werden, wenn die Person es ausdrücklich bestätigt. Passt der Kalender nicht sicher neben
das Feld, MUST er als Blatt am unteren Rand stehen, vollständig im Bildschirm.

#### Scenario: Wochenbeginn
- **WHEN** der Kalender eines Zeitfelds geöffnet wird
- **THEN** steht in der ersten Spalte der Montag

#### Scenario: Anderer Tag, andere Uhrzeit
- **WHEN** im Kalender der 20.10.2026 gewählt, „0800“ als Uhrzeit eingegeben und übernommen wird
- **THEN** zeigt das Feld 200800okt26, und der Kalender ist geschlossen

#### Scenario: Handy
- **WHEN** auf einem Bildschirm von 390 px Breite der Kalender eines Zeitfelds geöffnet wird
- **THEN** liegen alle Tage, das Uhrzeitfeld und der Knopf zum Übernehmen im Bildschirm

### Requirement: Schnellwahl nach Feldart
Ein Zeitfeld SHALL eine Schnellwahl aus einer gemeinsamen Tabelle anbieten: im Ereignisfeld
„jetzt“, „−5 min“ und „−15 min“, im Fristfeld „+15 min“, „+30 min“, „+1 h“ und „+2 h“, jeweils
ab jetzt nach Serveruhr. Ein Knopf der Schnellwahl MUST die Steuerhöhe der Dichtestufe halten.

#### Scenario: Minus fünf Minuten
- **WHEN** es 10:00 Serverzeit ist und in einem Ereignisfeld „−5 min“ gewählt wird
- **THEN** gilt 09:55

#### Scenario: Handschuh
- **WHEN** die Dichtestufe `handschuh` gilt
- **THEN** ist jeder Knopf der Schnellwahl mindestens 72 px hoch

### Requirement: Ende eines Zeitraums ohne Tag
In einer Zeitraum-Eingabe SHALL ein Ende, das nur als Uhrzeit eingegeben wird, auf dem Tag des
Beginns liegen; läge es dort nicht nach dem Beginn, MUST es auf dem Folgetag liegen.

#### Scenario: Mittag
- **WHEN** der Beginn 171200okt26 ist und als Ende „1330“ eingegeben wird
- **THEN** ist das Ende 171330okt26

#### Scenario: Über Mitternacht
- **WHEN** der Beginn 172200okt26 ist und als Ende „0600“ eingegeben wird
- **THEN** ist das Ende 180600okt26

### Requirement: Kalenderdatum ohne Uhrzeit und Zone

Ein Kalenderdatum ohne Uhrzeit, etwa das Geburtsdatum einer Person, SHALL nicht als Zeitpunkt
behandelt werden. Es MUST ohne Anzeigezone gelesen, gespeichert (`YYYY-MM-DD`) und angezeigt
(„TT.MM.JJJJ“) werden, ohne Kalender-Schnellwahl und ohne relative Eingabe. Die Regel „Eingabe in
der Anzeigezone“ MUST für ein solches Feld nicht gelten.

#### Scenario: Zone verschiebt den Tag nicht
- **WHEN** die Anzeigezone Pacific/Auckland ist, der Browser auf UTC steht und „14.07.1980“ eingegeben wird
- **THEN** wird `1980-07-14` gespeichert und „14.07.1980“ angezeigt
