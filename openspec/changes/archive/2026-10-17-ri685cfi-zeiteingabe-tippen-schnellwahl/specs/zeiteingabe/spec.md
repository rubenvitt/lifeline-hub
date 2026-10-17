# Spec Delta

## ADDED Requirements

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
