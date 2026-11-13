# Spec Delta

## Purpose

Fremdsysteme erfahren über die öffentliche API, dass sich an einem für sie freigegebenen Einsatz
etwas geändert hat, und lesen den Einsatzkopf nach. Die Ereignisse sind schmal, gehen bei einer
Unterbrechung nicht verloren und tragen keine Namen und keinen Freitext.

## ADDED Requirements

### Requirement: Ein Ausgangsereignis entsteht in der Transaktion der Änderung

Das System SHALL ein Ausgangsereignis in derselben Transaktion festhalten wie die Änderung, die
es auslöst. Das MUST für jeden Schreibweg gelten, auch für die Übernahme eines Spiegels und den
Demo-Import. Wird die Änderung zurückgerollt, MUST NOT ein Ereignis bleiben.

#### Scenario: Änderung über die Oberfläche
- **WHEN** die Einsatzleitung das Stichwort eines freigegebenen Einsatzes ändert
- **THEN** liefert der nächste Abruf des Zugangs ein `einsatz.updated` für diesen Einsatz

#### Scenario: Änderung über den Spiegel
- **WHEN** der Hub für einen freigegebenen gespiegelten Einsatz einen geänderten Kopf vom führenden ELW übernimmt
- **THEN** liefert der nächste Abruf des Zugangs am Hub ein `einsatz.updated` für diesen Einsatz

#### Scenario: Zurückgerollte Änderung
- **WHEN** eine Transaktion den Kopf eines freigegebenen Einsatzes ändert und danach zurückgerollt wird
- **THEN** liefert kein Abruf ein Ereignis zu dieser Änderung

### Requirement: Ein Ereignis gehört genau einem Zugang

Das System SHALL ein Ereignis je Zugang festhalten, für den der Einsatz im Augenblick der
Änderung freigegeben ist. Ein Abruf MUST nur die Ereignisse des eigenen Zugangs liefern. Ein
Zugang MUST NOT Ereignisse zu Einsätzen einer fremden Org oder zu nicht freigegebenen Einsätzen
sehen.

#### Scenario: Nicht freigegebener Einsatz
- **WHEN** sich der Kopf eines Einsatzes ändert, der für den Zugang nicht freigegeben ist
- **THEN** liefert der Abruf des Zugangs kein Ereignis dazu

#### Scenario: Zwei Zugänge
- **WHEN** ein Einsatz für zwei Zugänge freigegeben ist und sich sein Kopf ändert
- **THEN** liefert der Abruf jedes der beiden Zugänge je ein `einsatz.updated`, und kein Zugang sieht das Ereignis des anderen

#### Scenario: Fremde Org
- **WHEN** ein Zugang der Org A Ereignisse abruft, während sich Einsätze der Org B ändern
- **THEN** enthält die Antwort kein Ereignis zu einem Einsatz der Org B

### Requirement: Ereignisse sind schmal

Ein Ereignis SHALL genau `id`, `type`, `occurred_at` und `einsatz_id` tragen. `occurred_at` MUST
in UTC im Format `JJJJ-MM-TT hh:mm:ss` stehen. Ein Ereignis MUST NOT Namen, Personenkennungen,
Freitext oder Inhalte der Änderung enthalten.

#### Scenario: Geänderte Bezeichnung
- **WHEN** die Bezeichnung eines freigegebenen Einsatzes auf „Brand Hauptstraße, Fam. Muster“ geändert wird
- **THEN** enthält das Ereignis nur `id`, `type` `einsatz.updated`, `occurred_at` und `einsatz_id`, und die Bezeichnung steht an keiner Stelle der Antwort

### Requirement: Eine erteilte Freigabe meldet einsatz.created

Das System SHALL `einsatz.created` für einen Zugang festhalten, sobald ein laufender Einsatz für
ihn freigegeben wird. Das MUST auch gelten, wenn der Einsatz schon länger besteht.

#### Scenario: Freigabe eines bestehenden Einsatzes
- **WHEN** die Einsatzleitung einen seit zwei Stunden laufenden Einsatz für einen Zugang freigibt
- **THEN** liefert der nächste Abruf des Zugangs ein `einsatz.created` mit der ID dieses Einsatzes

#### Scenario: Anbindung auf einen anderen Einsatz umgestellt
- **WHEN** die Einsatzleitung eine Anbindung, die den laufenden Einsatz A liest, auf den laufenden Einsatz B umstellt
- **THEN** liefert der nächste Abruf des Zugangs ein `einsatz.closed` für A und ein `einsatz.created` für B

#### Scenario: Neuer Einsatz ohne Freigabe
- **WHEN** ein Einsatz angelegt wird und für keinen Zugang freigegeben ist
- **THEN** entsteht kein Ereignis

### Requirement: Ein geänderter Einsatzkopf meldet einsatz.updated

Das System SHALL `einsatz.updated` festhalten, wenn sich an einem freigegebenen laufenden Einsatz
ein Feld ändert, das die Leseroute für Einsätze liefert. Eine Änderung an einem anderen Feld oder
ein Schreiben ohne geänderten Wert MUST NOT `einsatz.updated` auslösen.

#### Scenario: Feld des Kopfs
- **WHEN** die Leitstellen-Nummer eines freigegebenen Einsatzes geändert wird
- **THEN** entsteht ein `einsatz.updated`

#### Scenario: Feld außerhalb des Kopfs
- **WHEN** nur der Sachverhalt eines freigegebenen Einsatzes geändert wird
- **THEN** entsteht kein `einsatz.updated`

#### Scenario: Gleicher Wert
- **WHEN** der Kopf eines freigegebenen Einsatzes mit unveränderten Werten gespeichert wird
- **THEN** entsteht kein `einsatz.updated`

### Requirement: Das Ende der Lesbarkeit meldet einsatz.closed

Das System SHALL `einsatz.closed` für einen Zugang festhalten, wenn ein freigegebener Einsatz für
ihn nicht mehr lesbar ist: Der Einsatz wird abgeschlossen, die Freigabe wird zurückgenommen oder
auf einen anderen Einsatz umgestellt, oder der laufende Einsatz wird gelöscht. Je Zugang und Ende
MUST genau ein `einsatz.closed` entstehen.

#### Scenario: Abschluss
- **WHEN** die Einsatzleitung einen freigegebenen Einsatz abschließt
- **THEN** liefert der nächste Abruf des Zugangs genau ein `einsatz.closed` für diesen Einsatz

#### Scenario: Freigabe zurückgenommen
- **WHEN** die Einsatzleitung die Freigabe eines laufenden Einsatzes für einen Zugang zurücknimmt
- **THEN** liefert der nächste Abruf dieses Zugangs ein `einsatz.closed`, und andere Zugänge mit Freigabe bekommen keines

#### Scenario: Abgeschlossen und gelöscht, bevor der Zugang abruft
- **WHEN** ein freigegebener Einsatz abgeschlossen und gelöscht wird, während der Zugang nicht abruft
- **THEN** liefert der nächste Abruf des Zugangs das `einsatz.closed` aus dem Abschluss

#### Scenario: Laufender Einsatz wird gelöscht
- **WHEN** ein freigegebener laufender Einsatz gelöscht wird, etwa beim Entfernen der Demo-Daten
- **THEN** liefert der nächste Abruf des Zugangs ein `einsatz.closed` für diesen Einsatz und kein früheres Ereignis über seinen Inhalt (`einsatz.created`, `einsatz.updated`)

### Requirement: Eine geänderte Lage meldet lage.changed verdichtet

Das System SHALL `lage.changed` festhalten, wenn sich an einem freigegebenen Einsatz Daten
ändern, aus denen die Lage für Fremdsysteme entsteht, und wenn die Freigabe beginnt oder endet.
Je Zugang und Einsatz MUST höchstens ein `lage.changed` vorliegen; ein neues ersetzt das
vorherige und trägt eine höhere `id`.

#### Scenario: Viele Änderungen hintereinander
- **WHEN** an einem freigegebenen Einsatz nacheinander zwanzig Personen erfasst werden und der Zugang erst danach abruft
- **THEN** enthält die Antwort genau ein `lage.changed` für diesen Einsatz

#### Scenario: Änderung nach dem Abruf
- **WHEN** der Zugang ein `lage.changed` abgerufen hat und danach eine Einheit dem Einsatz zugeordnet wird
- **THEN** liefert der nächste Abruf ab dem zuletzt erhaltenen Cursor wieder ein `lage.changed` mit höherer `id`

#### Scenario: Änderung ohne Lagebezug
- **WHEN** an einem freigegebenen Einsatz nur ein Eintrag im Einsatztagebuch entsteht
- **THEN** entsteht kein `lage.changed`

### Requirement: Die Scopes des Zugangs bestimmen die sichtbaren Arten

Der Abruf SHALL den Scope `events:read` verlangen. Er MUST `einsatz.created`, `einsatz.updated`
und `einsatz.closed` nur liefern, wenn der Zugang `einsaetze:read` trägt, und `lage.changed` nur,
wenn er `lage:read` trägt.

#### Scenario: Ohne events:read
- **WHEN** ein Zugang nur mit `einsaetze:read` Ereignisse abruft
- **THEN** antwortet der Server mit 403 und dem Code `missing_scope`

#### Scenario: Nur Lage
- **WHEN** ein Zugang mit `events:read` und `lage:read` abruft, nachdem sich Kopf und Lage eines freigegebenen Einsatzes geändert haben
- **THEN** enthält die Antwort das `lage.changed` und kein `einsatz.updated`

### Requirement: Der Abruf liefert Ereignisse in Reihenfolge ab dem Cursor

`GET /api/v1/events?after=<cursor>` SHALL alle Ereignisse des Zugangs mit `id` größer als der
Cursor liefern, aufsteigend nach `id`, höchstens 500 je Antwort, dazu einen neuen `cursor`. `id`
MUST fortlaufend in der Reihenfolge der Änderungen steigen. Ein `after`, das keine ganze Zahl ab
0 ist, MUST mit 400 und dem Code `invalid_field` abgewiesen werden.

#### Scenario: Zehn Minuten ohne Verbindung
- **WHEN** ein Zugang zehn Minuten nicht abruft, in denen ein Einsatz freigegeben, sein Kopf zweimal geändert und er abgeschlossen wird, und danach mit seinem letzten Cursor abruft
- **THEN** enthält die Antwort `einsatz.created`, zwei `einsatz.updated` und `einsatz.closed` in dieser Reihenfolge mit steigender `id`

#### Scenario: Mehr als eine Seite
- **WHEN** für einen Zugang 600 Ereignisse nach seinem Cursor vorliegen
- **THEN** liefert der erste Abruf die 500 ältesten mit dem Cursor des letzten gelieferten, und der Abruf mit diesem Cursor liefert die übrigen 100

#### Scenario: Ungültiger Cursor
- **WHEN** ein Zugang mit `after=abc` abruft
- **THEN** antwortet der Server mit 400 und dem Code `invalid_field`

### Requirement: Der Cursor rückt auch ohne Ereignisse vor

Der Abruf SHALL als `cursor` den Stand liefern, bis zu dem er geprüft hat, auch wenn die Antwort
keine Ereignisse enthält. Ein Abruf ohne `after` MUST den aktuellen Stand ohne Ereignisse liefern
und MUST NOT warten.

#### Scenario: Erster Abruf
- **WHEN** ein Zugang zum ersten Mal ohne `after` abruft
- **THEN** antwortet der Server sofort mit einem `cursor` und einer leeren Liste

#### Scenario: Ruhiger Zugang
- **WHEN** ein Zugang acht Tage lang täglich abruft, ohne dass ein Ereignis für ihn entsteht, während für andere Zugänge Ereignisse entstehen und gelöscht werden
- **THEN** gelingt jeder seiner Abrufe mit dem zuletzt gelieferten Cursor, und keiner ergibt 410

### Requirement: Der Abruf wartet auf Wunsch höchstens 25 Sekunden

Mit `wait=<Sekunden>` SHALL der Abruf offen bleiben, bis ein Ereignis für den Zugang vorliegt
oder die Zeit abläuft, und dann antworten. Ein Ereignis MUST einen wartenden Abruf binnen zwei
Sekunden beenden. `wait` MUST eine ganze Zahl von 0 bis 25 sein; ein anderer Wert MUST mit 400 und
dem Code `invalid_field` abgewiesen werden. Ohne `wait` wartet der Abruf nicht.

#### Scenario: Ereignis während des Wartens
- **WHEN** ein Zugang mit `wait=25` abruft und nach fünf Sekunden der Kopf eines freigegebenen Einsatzes geändert wird
- **THEN** antwortet der Server binnen zwei Sekunden nach der Änderung mit dem `einsatz.updated`

#### Scenario: Nichts geschieht
- **WHEN** ein Zugang mit `wait=3` abruft und kein Ereignis entsteht
- **THEN** antwortet der Server nach etwa drei Sekunden mit einer leeren Liste und dem Cursor

#### Scenario: Zu langes Warten
- **WHEN** ein Zugang mit `wait=60` abruft
- **THEN** antwortet der Server mit 400 und dem Code `invalid_field`

### Requirement: Wartende Abrufe sind begrenzt

Das System SHALL höchstens 32 wartende Abrufe zugleich zulassen und je Zugang höchstens einen.
Ein Abruf darüber MUST sofort mit dem antworten, was vorliegt, und bei leerer Liste den Kopf
`Retry-After: 10` setzen. Er MUST NOT mit einem Fehler antworten.

#### Scenario: Zweiter wartender Abruf desselben Zugangs
- **WHEN** ein Zugang mit `wait=25` wartet und derselbe Zugang einen zweiten Abruf mit `wait=25` schickt
- **THEN** antwortet der zweite sofort mit 200, leerer Liste und `Retry-After: 10`, und der erste wartet weiter

#### Scenario: Alle Warteplätze belegt
- **WHEN** 32 Zugänge warten und ein weiterer Zugang mit `wait=25` abruft
- **THEN** antwortet dessen Abruf sofort mit 200 und `Retry-After: 10`

### Requirement: Ereignisse werden sieben Tage aufbewahrt

Das System SHALL Ereignisse nach sieben Tagen löschen. Ein Abruf mit einem Cursor, hinter dem
schon gelöscht wurde, MUST mit 410 und dem Code `cursor_expired` antworten. Dasselbe MUST für
einen Cursor gelten, der über dem höchsten vergebenen Stand liegt.

#### Scenario: Alter Cursor
- **WHEN** ein Zugang nach neun Tagen Pause mit seinem alten Cursor abruft und in der Zwischenzeit Ereignisse gelöscht wurden
- **THEN** antwortet der Server mit 410 und dem Code `cursor_expired`

#### Scenario: Cursor aus einer anderen Zukunft
- **WHEN** ein Zugang mit einem Cursor abruft, der höher ist als der höchste vergebene Stand, etwa nach dem Zurückspielen einer Sicherung
- **THEN** antwortet der Server mit 410 und dem Code `cursor_expired`

#### Scenario: Sechs Tage altes Ereignis
- **WHEN** ein Zugang nach sechs Tagen Pause mit seinem alten Cursor abruft
- **THEN** liefert der Server alle Ereignisse der sechs Tage

### Requirement: Die Einsatzliste dient dem Neuaufbau

`GET /api/v1/einsaetze` SHALL mit dem Scope `einsaetze:read` die laufenden Einsätze liefern, die
für den Zugang freigegeben sind, dazu einen `cursor` für den Abruf. Ereignisse, die nach dem
Lesen der Liste entstehen, MUST der Abruf ab diesem Cursor liefern.

#### Scenario: Neuaufbau nach 410
- **WHEN** ein Zugang nach `410 cursor_expired` die Einsatzliste liest und danach mit dem gelieferten Cursor Ereignisse abruft
- **THEN** kennt er alle für ihn freigegebenen laufenden Einsätze und verpasst keine spätere Änderung

#### Scenario: Keine Freigabe
- **WHEN** für den Zugang kein Einsatz freigegeben ist
- **THEN** liefert die Route eine leere Liste und einen Cursor

#### Scenario: Abgeschlossener Einsatz
- **WHEN** ein freigegebener Einsatz abgeschlossen wurde
- **THEN** steht er nicht mehr in der Liste

### Requirement: Ein einzelner Einsatz ist nur mit Freigabe lesbar

`GET /api/v1/einsaetze/{id}` SHALL einen laufenden Einsatz liefern, der für den Zugang
freigegeben ist. In jedem anderen Fall MUST der Server mit 404 und dem Code `not_found`
antworten, ohne zu verraten, ob der Einsatz besteht.

#### Scenario: Freigegeben
- **WHEN** ein Zugang einen für ihn freigegebenen laufenden Einsatz liest
- **THEN** antwortet der Server mit 200 und dem Einsatz

#### Scenario: Nicht freigegeben, fremd oder beendet
- **WHEN** ein Zugang einen Einsatz liest, der nicht für ihn freigegeben ist, einer anderen Org gehört, abgeschlossen ist oder nicht besteht
- **THEN** antwortet der Server in jedem dieser Fälle mit derselben 404 und dem Code `not_found`

### Requirement: Der Einsatz trägt nur den Kopf ohne Freitext zur Lage

Ein Einsatz SHALL in der öffentlichen API genau diese Felder tragen: `id`, `einsatznummer`,
`bezeichnung`, `stichwort`, `einsatzart`, `leitstellen_nr`, `einsatzort`, `koordinate` (`lat`,
`lon` in WGS 84) und `begonnen_at`. Sachverhalt, meldende Stelle, Zahl der Betroffenen, Personen
und Mitglieder MUST NOT in der Antwort stehen.

#### Scenario: Einsatz mit Sachverhalt
- **WHEN** ein freigegebener Einsatz einen Sachverhalt und eine meldende Stelle trägt
- **THEN** enthält die Antwort der Leserouten weder das eine noch das andere

#### Scenario: Einsatz ohne Koordinate
- **WHEN** ein freigegebener Einsatz keinen Ort auf der Karte hat
- **THEN** fehlt `koordinate` in der Antwort, und die übrigen Felder sind da
