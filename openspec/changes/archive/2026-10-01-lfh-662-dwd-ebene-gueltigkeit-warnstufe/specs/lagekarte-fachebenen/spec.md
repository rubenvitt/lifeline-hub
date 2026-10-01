# Spec Delta

## MODIFIED Requirements

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
- **WHEN** der gespeicherte Stand einer Ebene ohne Obergrenze (etwa Hochwasser) vor 30 Stunden abgerufen wurde und die Quelle nicht erreichbar ist
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

## ADDED Requirements

### Requirement: Warnebenen liefern keinen Stand jenseits der Obergrenze
Für die Warnebenen DWD und NINA SHALL das System einen zwischengespeicherten Stand, dessen
Abruf mehr als 6 Stunden zurückliegt, nicht mehr ausliefern. Es MUST ihn wie einen fehlenden
Stand behandeln: die Quelle abrufen und, wenn das scheitert, mit HTTP 200, `status: "offline"`
und leerer Collection antworten. Jüngere Stände MUST es weiter nach dem bisherigen
Stale-Serving ausliefern. Die übrigen Fachebenen bleiben davon unberührt.

#### Scenario: Alter Warnstand, Quelle weg
- **WHEN** der gespeicherte DWD-Stand vor 7 Stunden abgerufen wurde und der DWD nicht antwortet
- **THEN** antwortet die Route mit HTTP 200, `status: "offline"`, leerer Collection und ohne `abgerufen`, und das Panel zeigt die Ebene als offline

#### Scenario: Alter Warnstand, Quelle wieder da
- **WHEN** der gespeicherte NINA-Stand vor 7 Stunden abgerufen wurde und die Quelle antwortet
- **THEN** antwortet die Route mit dem frisch abgerufenen Stand und einem `abgerufen` von jetzt

#### Scenario: Warnstand unter der Obergrenze
- **WHEN** der gespeicherte DWD-Stand vor 2 Stunden abgerufen wurde und der DWD nicht antwortet
- **THEN** liefert die Route diesen Stand mit `status: "ok"` aus, und das Panel kennzeichnet ihn als veraltet

#### Scenario: Grenze genau getroffen
- **WHEN** der gespeicherte DWD-Stand genau vor 6 Stunden abgerufen wurde
- **THEN** gilt er noch als auslieferbar

### Requirement: Abgelaufene DWD-Warnungen werden nicht ausgeliefert
Das System SHALL aus jeder Antwort der DWD-Ebene die Warnungen entfernen, deren Ende
(`EXPIRES`) zum Zeitpunkt der Antwort erreicht oder überschritten ist. Das MUST auch für einen
Stand aus dem Zwischenspeicher gelten. Eine Warnung ohne lesbares Ende MUST erhalten bleiben.
Bleibt keine Warnung übrig, MUST die Antwort `status: "leer"` tragen und ihr `abgerufen`
behalten.

#### Scenario: Abgelaufene Warnung im Zwischenspeicher
- **WHEN** der gespeicherte DWD-Stand eine Warnung mit Ende 14:00 und eine mit Ende 18:00 enthält und um 15:00 abgefragt wird
- **THEN** enthält die Antwort nur die Warnung mit Ende 18:00

#### Scenario: Ende genau jetzt
- **WHEN** eine Warnung als Ende genau den Zeitpunkt der Antwort trägt
- **THEN** ist sie nicht in der Antwort enthalten

#### Scenario: Warnung ohne Ende
- **WHEN** eine Warnung kein oder ein unlesbares `EXPIRES` trägt
- **THEN** ist sie in der Antwort enthalten

#### Scenario: Alle Warnungen abgelaufen
- **WHEN** alle Warnungen des gespeicherten Stands abgelaufen sind
- **THEN** antwortet die Route mit `status: "leer"`, leerer Collection und dem `abgerufen` des gespeicherten Stands

### Requirement: Die Lagekarte zeichnet keine abgelaufene DWD-Warnung
Die Lagekarte SHALL eine DWD-Warnung nicht mehr zeichnen, sobald ihr Ende (`EXPIRES`)
erreicht ist, auch wenn kein neuer Abruf stattgefunden hat oder der eigene Server nicht
erreichbar ist. Die Einstufung MUST spätestens eine Minute nach dem Ende greifen, ohne
Neuladen der Seite.

#### Scenario: Warnung läuft während der Betrachtung ab
- **WHEN** die DWD-Ebene sichtbar ist, eine Warnung um 14:00 endet und bis dahin kein neuer Abruf stattfindet
- **THEN** ist ihre Fläche spätestens um 14:01 nicht mehr auf der Karte

### Requirement: Angekündigte DWD-Warnungen sind auf der Karte unterscheidbar
Die Lagekarte SHALL eine DWD-Warnung, deren Beginn (`ONSET`) in der Zukunft liegt, als
angekündigt zeichnen: mit gestrichelter Kontur und einer schwächeren Fläche als eine geltende
Warnung. Die Kontur MUST der zweite Kanal neben der Deckkraft sein. Beginnt die Warnung
während der Betrachtung, MUST sie spätestens eine Minute danach wie eine geltende Warnung
gezeichnet werden. Eine Warnung ohne lesbaren Beginn MUST als geltend gelten.

#### Scenario: Warnung für heute Abend
- **WHEN** die DWD-Ebene sichtbar ist und eine Warnung um 18:00 beginnt, während es 15:00 ist
- **THEN** zeigt die Karte ihre Fläche mit gestrichelter Kontur und schwächerer Füllung

#### Scenario: Angekündigte Warnung beginnt
- **WHEN** die Karte offen bleibt und die Uhr den Beginn einer angekündigten Warnung erreicht
- **THEN** zeigt die Karte sie spätestens eine Minute danach mit durchgezogener Kontur und voller Füllung

#### Scenario: Warnung ohne Beginn
- **WHEN** eine DWD-Warnung kein lesbares `ONSET` trägt
- **THEN** zeichnet die Karte sie wie eine geltende Warnung

### Requirement: Der Inspector kennzeichnet eine angekündigte Warnung
Wählt ein Benutzer eine angekündigte DWD-Warnung an, SHALL der Inspector das Wort
„angekündigt“ und ihren Beginn als volle taktische Datum-Zeit-Gruppe zeigen. Die
Kennzeichnung MUST als Text lesbar sein und nicht allein über Farbe erkennbar.

#### Scenario: Angekündigte Warnung anwählen
- **WHEN** ein Benutzer um 15:00 eine DWD-Warnung anwählt, die um 18:00 beginnt
- **THEN** zeigt der Inspector „angekündigt“ und den Beginn als volle DTG

#### Scenario: Geltende Warnung anwählen
- **WHEN** ein Benutzer eine DWD-Warnung anwählt, deren Beginn verstrichen ist
- **THEN** zeigt der Inspector kein „angekündigt“

### Requirement: Die Schwere einer Warnung folgt dem Statusfarb-Vertrag
Der Inspector SHALL die Schwere einer DWD-Warnung mit der amtlichen DWD-Bezeichnung und der
Rolle aus dem Statusfarb-Vertrag zeigen und die Schwere einer NINA-Warnung mit den Wörtern
„Extrem“, „Schwer“, „Mäßig“ oder „Gering“ und ihrer Rolle aus dem Vertrag. „Extrem“ und
„Schwer“ MUST die Rolle `alarm` tragen, „Mäßig“ und „Gering“ die Rolle `achtung`. Keine Schwere
MUST in der Bedienfarbe (Blau) erscheinen.

#### Scenario: Geringe DWD-Warnung
- **WHEN** ein Benutzer eine DWD-Warnung mit `SEVERITY: "Minor"` anwählt
- **THEN** zeigt der Inspector „Wetterwarnung“ in der Achtung-Rolle und nichts davon in Blau

#### Scenario: Schwere NINA-Warnung
- **WHEN** ein Benutzer eine NINA-Warnung mit Schwere `Severe` anwählt
- **THEN** zeigt der Inspector „Schwer“ in der Alarm-Rolle

#### Scenario: Unbekannte Schwere
- **WHEN** eine Warnung eine Schwere trägt, die keiner der vier Stufen entspricht
- **THEN** zeigt der Inspector den Rohwert ohne Rollenfarbe, statt eine Stufe zu erfinden
