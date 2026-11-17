## MODIFIED Requirements

### Requirement: Kartenhöhe unabhängig von Uhrzeit und fremder Rhythmusänderung

Die Karte einer Schicht SHALL die Fälligkeit in einer Zeitspalte zeigen, die das breiteste
Zeitformat (Tag und Uhrzeit) fasst, sodass Tageszeit und Tageswechsel weder Spaltenbreite noch
Umbruch ändern. Der Rhythmus MUST in einer eigenen, einzeiligen Zeile stehen, als Dauer mit der
Quelle „eigen“, „Vorgabe“ (des Abschnitts) oder „Vorgabe Einsatz“; reicht der Platz nicht, kürzt
sie nur das Quellenwort mit „…“. Ändert eine andere Person den Rhythmus einer gezeigten
Schicht, MUST die Karte ihre Höhe behalten, solange die Zeile mindestens 226 px Platz für Text
hat.

#### Scenario: Fremde Rhythmusänderung kurz vor Mitternacht, mobil
- **WHEN** um 23:40 (Anzeigezone Europe/Berlin) auf 390 px Breite in der Dichte `komfortabel` drei Schichten mit 6 h gezeigt werden und eine andere Person den Rhythmus der mittleren auf 30 min setzt
- **THEN** behalten alle drei Karten ihre Oberkante (Abweichung höchstens 0,5 px), und die mittlere Karte zeigt ihre neue Einstufung

#### Scenario: Gleiche Lage am Tag und in der Nacht
- **WHEN** dieselbe Liste einmal um 12:00 und einmal um 23:40 gezeigt wird
- **THEN** ist die Zeitspalte der Karten in beiden Fällen gleich breit

#### Scenario: Längster zulässiger Rhythmus bleibt einzeilig
- **WHEN** eine Schicht einen Rhythmus von 167 h 59 min als Vorgabe des Einsatzes trägt und die Karte auf 390 px Breite in der Dichte `komfortabel` oder `handschuh` steht
- **THEN** steht die Zeile „Rhythmus 167 h 59 min (Vorgabe Einsatz)“ einzeilig, der Wert „Rhythmus 167 h 59 min“ ganz sichtbar und der ganze Text im Titel

### Requirement: Dauern und Einsatzvorgabe auf der Seite Ablösung

Dauern SHALL als „8 h“, „7 h 30 min“ oder „45 min“ erscheinen (Spec `zeitdarstellung`, „Eine Form für Dauern“) und so vorbelegt werden, nie mit
Dezimalpunkt; Wechselzeiten taktisch („0600/1800“). Die Seite Ablösung MUST die Vorgabe des
Einsatzes zeigen und sie in „Schicht beginnen“ und „Rhythmus ändern“ als letzte Stufe der
Rangfolge nennen: ohne Vorgabe des Abschnitts als Platzhalter, und das Rhythmusfeld darf leer
bleiben. Die Einstufung im Client MUST mit `vorwarnung_minuten` der Schicht rechnen.

#### Scenario: Einsatzvorgabe als Platzhalter
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit 12 h hat und eine Schicht für eine Einheit ohne Abschnittsvorgabe beginnen soll
- **THEN** zeigt das Rhythmusfeld „12 h (Vorgabe Einsatz)“, ist kein Pflichtfeld und sendet leer keinen Rhythmus

#### Scenario: Dauer statt Dezimalzahl
- **WHEN** eine Schicht einen eigenen Rhythmus von 450 min hat und jemand „Rhythmus ändern“ öffnet
- **THEN** steht im Feld „7 h 30 min“

#### Scenario: Eingabe einer Dauer
- **WHEN** jemand „8“, „7:30“, „7 h 30 min“, „7,5“ oder „90 min“ einträgt
- **THEN** gelten 480, 450, 450, 450 bzw. 90 Minuten, und Unlesbares lehnt das Feld ab, ohne zu senden

#### Scenario: Vorwarnung aus der Schicht
- **WHEN** eine laufende Schicht in 50 min fällig ist und `vorwarnung_minuten: 60` meldet
- **THEN** zählt der Modulzähler sie als fällig, ohne neuen Abruf

