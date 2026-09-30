# Spec Delta

## ADDED Requirements

### Requirement: Der Umschlag nennt den Abrufzeitpunkt
Jede Antwort von `GET /api/karte/fachebenen/{quelle}` mit `status: "ok"` oder `status: "leer"`
SHALL das Feld `abgerufen` tragen: den Zeitpunkt als RFC 3339 in UTC, zu dem das System den
ausgelieferten Stand bei der Quelle geholt hat. Bei KRITIS MUST das der Zeitpunkt des letzten
gelungenen Abgleichs mit dem Extrakt sein (auch eines Laufs, der den Extrakt unverändert
vorfand). Bei einer aus mehreren Quellen zusammengesetzten Ebene MUST es der Abrufzeitpunkt
des ältesten Teils sein, für den ein Stand vorliegt. Wird ein Stand aus dem Zwischenspeicher
ausgeliefert, frisch oder veraltet, MUST `abgerufen` den Zeitpunkt des damaligen Abrufs
nennen, nicht den der Anfrage. Bei `status: "offline"` MUST das Feld fehlen, statt als `null`
zu erscheinen. Das Feld `stand` MUST davon unberührt bleiben und weiter den Datenstand der
Quelle nennen, wo eine Quelle einen liefert.

#### Scenario: Frischer Abruf
- **WHEN** ein Benutzer eine Fachebene abruft, deren Zwischenspeicher leer ist, und die Quelle antwortet
- **THEN** antwortet die Route mit HTTP 200 und einem `abgerufen`, das höchstens wenige Sekunden vor der Antwort liegt

#### Scenario: Veralteter Stand aus dem Zwischenspeicher
- **WHEN** der gespeicherte Stand einer Ebene vor 30 Stunden abgerufen wurde und die Quelle nicht erreichbar ist
- **THEN** antwortet die Route mit HTTP 200, `status: "ok"`, den gespeicherten Features und einem `abgerufen`, das 30 Stunden zurückliegt

#### Scenario: Quelle weg, nichts gespeichert
- **WHEN** die Quelle nicht erreichbar ist und kein Stand gespeichert ist
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"` und ohne das Feld `abgerufen`

#### Scenario: KRITIS mit unverändertem Extrakt
- **WHEN** der letzte KRITIS-Lauf den Extrakt unverändert vorfand und deshalb nichts neu einlas
- **THEN** nennt `abgerufen` den Zeitpunkt dieses Laufs, und `stand` nennt weiter den Datenstand des Extrakts

#### Scenario: Energie mit einem älteren Teil
- **WHEN** der OSM-Teil der Energie-Ebene vor zwei Stunden und der MaStR-Teil vor 20 Stunden abgerufen wurde
- **THEN** nennt `abgerufen` den Zeitpunkt vor 20 Stunden

### Requirement: Jede sichtbare Fachebene zeigt ihr Alter ohne Detailansicht
Das Fachebenen-Panel der Lagekarte SHALL in der Zeile jeder zugeschalteten Fachebene mit
`abgerufen` den Abrufzeitpunkt als taktische Zeitangabe in Monospace mit Tabellenziffern
zeigen: nur die Uhrzeit, wenn der Abruf am selben Tag liegt, sonst Tag und Uhrzeit. Die
Angabe MUST ohne Klick, Hovern oder Aufklappen lesbar sein. Die Einstufung MUST mit der Zeit
fortschreiten, auch wenn kein neuer Abruf stattfindet. Die Zeitangabe MUST stehen, solange
die Karte Objekte aus diesem Stand zeigt — auch wenn der eigene Server zwischenzeitlich nicht
erreichbar ist und die Zeile deshalb „offline“ meldet. Eine ausgeschaltete Ebene und eine
Ebene, die der Server als `offline` ohne Stand meldet, MUST keine Zeitangabe zeigen.

#### Scenario: Stand von heute
- **WHEN** die Hochwasser-Ebene zugeschaltet ist und ihr Stand heute um 14:30 abgerufen wurde
- **THEN** zeigt ihre Zeile im Panel „Stand 1430“

#### Scenario: Stand von einem Vortag
- **WHEN** der Stand einer zugeschalteten Ebene am 29. um 14:30 abgerufen wurde und heute der 30. ist
- **THEN** zeigt ihre Zeile „Stand 291430“

#### Scenario: Quelle offline ohne Stand
- **WHEN** der Server für eine zugeschaltete Ebene `status: "offline"` ohne `abgerufen` meldet
- **THEN** zeigt ihre Zeile „offline“ und keine Zeitangabe

#### Scenario: Eigener Server nicht erreichbar
- **WHEN** eine zugeschaltete Ebene zuletzt einen Stand von 14:30 geladen hat, danach jeder Abruf am eigenen Server scheitert und die Karte die Objekte weiter zeigt
- **THEN** zeigt ihre Zeile „offline“ und „Stand 1430“, und jenseits der Schwelle zusätzlich „veraltet“

### Requirement: Ein Stand jenseits der Schwelle ist als veraltet erkennbar
Jede Fachebene SHALL eine feste Veraltungsschwelle haben, die aus dem Erneuerungstakt ihrer
Quelle abgeleitet und in der Quellendokumentation je Ebene genannt ist. Liegt `abgerufen`
einer zugeschalteten Ebene länger als diese Schwelle zurück, MUST ihre Zeile im Panel
zusätzlich das Wort „veraltet“ zeigen. Die Kennzeichnung MUST einen zweiten Kanal neben der
Farbe haben (das Wort) und MUST für Vorleser als Teil der Zeile lesbar sein. Die Ebene MUST
dabei weiter angezeigt werden und ihren Status `ok` bzw. `leer` behalten; die Kennzeichnung
ist kein neuer Fachebenen-Status. Ein Stand genau auf der Schwelle gilt noch nicht als
veraltet.

#### Scenario: Hochwasser seit zwei Tagen nicht erneuert
- **WHEN** die Hochwasser-Ebene zugeschaltet ist und ihr Stand vor 40 Stunden abgerufen wurde
- **THEN** zeigt ihre Zeile den Abrufzeitpunkt und das Wort „veraltet“, und die Pegel bleiben auf der Karte

#### Scenario: Stand innerhalb der Schwelle
- **WHEN** der Stand einer zugeschalteten Ebene jünger als ihre Schwelle ist
- **THEN** zeigt ihre Zeile nur den Abrufzeitpunkt, ohne „veraltet“

#### Scenario: Schwelle wird während der Betrachtung überschritten
- **WHEN** die Lagekarte offen ist, kein neuer Abruf gelingt und der Stand einer Ebene dabei über ihre Schwelle altert
- **THEN** erscheint „veraltet“ in ihrer Zeile spätestens eine Minute nach dem Überschreiten, ohne Neuladen der Seite

### Requirement: Der Inspector nennt den Abrufzeitpunkt der Ebene
Wählt ein Benutzer ein Objekt einer Fachebene an, SHALL der Inspector den Abrufzeitpunkt der
Ebene als volle taktische Datum-Zeit-Gruppe nennen und, jenseits der Schwelle, als veraltet
kennzeichnen. Zeitangaben der Quelle am Objekt selbst (etwa Messende oder Gültigkeit einer
Warnung) MUST daneben unverändert erhalten bleiben.

#### Scenario: Pegel mit altem Stand anwählen
- **WHEN** ein Benutzer einen Hochwasser-Pegel anwählt, dessen Ebene vor 40 Stunden abgerufen wurde
- **THEN** zeigt der Inspector die Meldeklasse, den Abrufzeitpunkt als volle DTG und den Hinweis „veraltet“
