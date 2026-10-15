# material-modell Specification

## Purpose
Das Material-Modell legt fest, wie Material im Einsatz steht: als Gerät je Stück oder als
Verbrauchsgut mit Menge und Ausgabe, mit Status je Art und genau einem Ort je Posten (Einheit,
Fahrzeug, Unfallhilfsstelle, Bereitstellungsraum oder ohne Ort); dazu Schreibwege, ETB, Live,
das Ende eines Orts und die Übernahme des Bestands. Eingeführt mit LLH-1224.

## Requirements

### Requirement: Art eines Materials

Jedes Material im Stamm SHALL eine Art tragen, Gerät oder Verbrauchsgut, mit der Vorgabe Gerät.
Jeder Posten im Einsatz MUST eine eigene Art tragen, die beim Disponieren aus dem Stamm übernommen
wird; ein Ad-hoc-Posten ohne Angabe MUST bei einer Menge über 1 Verbrauchsgut und sonst Gerät
werden. Eine spätere Änderung der Stamm-Art MUST NOT bestehende Posten ändern. Eine unbekannte Art
MUST mit 400 abgelehnt werden.

#### Scenario: Art aus dem Stamm
- **WHEN** das Stamm-Material „Wolldecke“ mit Art Verbrauchsgut in einen Einsatz disponiert wird
- **THEN** trägt der neue Posten die Art Verbrauchsgut

#### Scenario: Stamm-Art geändert
- **WHEN** die Art eines Stamm-Materials nach dem Disponieren auf Gerät geändert wird
- **THEN** behält der bereits disponierte Posten seine Art

#### Scenario: Ad-hoc ohne Angabe
- **WHEN** Ad-hoc-Material „Sandsäcke“ mit Menge 200 ohne Art disponiert wird
- **THEN** ist der Posten ein Verbrauchsgut

### Requirement: Gerät je Stück

Ein Gerät SHALL mit Menge 1 im Einsatz stehen. Eine Disposition eines Geräts mit größerer Menge,
eine Mengenänderung eines Geräts auf einen anderen Wert als 1 und das Aufteilen eines Geräts MUST
mit 422 abgelehnt werden, ohne etwas zu schreiben.

#### Scenario: Gerät mit Menge 3
- **WHEN** das Gerät „Stromerzeuger 8 kVA“ mit Menge 3 disponiert werden soll
- **THEN** antwortet der Server mit 422, und kein Posten entsteht

#### Scenario: Menge eines Geräts
- **WHEN** die Menge eines Geräts auf 2 geändert werden soll
- **THEN** antwortet der Server mit 422, und die Menge bleibt 1

### Requirement: Status je Art

Ein Gerät SHALL jeden Materialstatus annehmen können. Ein Verbrauchsgut MUST NOT die Status
„verbraucht“ und „Desinfektion nötig“ tragen; ein solcher Wechsel MUST mit 422 abgelehnt werden.
Ein unbekannter Status MUST weiter mit 400 abgelehnt werden.

#### Scenario: Verbrauchsgut verbraucht
- **WHEN** der Status eines Verbrauchsguts auf „verbraucht“ gesetzt werden soll
- **THEN** antwortet der Server mit 422, und der Status bleibt

#### Scenario: Gerät zur Desinfektion
- **WHEN** der Status eines Sanitätsrucksacks (Gerät) auf „Desinfektion nötig“ gesetzt wird
- **THEN** gelingt der Wechsel

### Requirement: Ausgabe bei Verbrauchsgut

Ein Verbrauchsgut SHALL eine ausgegebene Menge zwischen 0 und seiner Menge tragen; der Rest ist die
Menge abzüglich der Ausgabe. Die Ausgabe MUST als neuer Gesamtwert gesetzt werden und darf sinken.
Eine Ausgabe über der Menge, eine Ausgabe an einem Gerät und eine Menge unter der Ausgabe MUST mit
422 abgelehnt werden, eine negative Ausgabe mit 400. Ein ganz ausgegebenes Verbrauchsgut MUST als
aufgebraucht gelten.

#### Scenario: 20 von 50 Decken ausgegeben
- **WHEN** bei 50 Wolldecken die Ausgabe auf 20 gesetzt wird
- **THEN** stehen am Posten Menge 50, Ausgabe 20 und Rest 30

#### Scenario: Ausgabe über der Menge
- **WHEN** bei 50 Wolldecken die Ausgabe auf 60 gesetzt werden soll
- **THEN** antwortet der Server mit 422, und die Ausgabe bleibt

#### Scenario: Menge unter der Ausgabe
- **WHEN** die Menge eines Postens mit Ausgabe 20 auf 10 geändert werden soll
- **THEN** antwortet der Server mit 422

### Requirement: Art eines Postens wechseln

Die Art eines Postens SHALL im Einsatz änderbar sein. Der Wechsel zu Gerät MUST nur bei Menge 1 und
ohne Ausgabe gelingen, der Wechsel zu Verbrauchsgut nur ohne die Status „verbraucht“ und
„Desinfektion nötig“; sonst MUST der Server mit 422 und dem Grund antworten.

#### Scenario: Ad-hoc-Wolldecke als Gerät angelegt
- **WHEN** ein Ad-hoc-Posten „Wolldecke“ mit Menge 1 von Gerät auf Verbrauchsgut gesetzt wird
- **THEN** ist er ein Verbrauchsgut, und das ETB nennt „Art Gerät → Verbrauchsgut“

#### Scenario: Verbrauchsgut mit Menge 50 zum Gerät
- **WHEN** ein Verbrauchsgut mit Menge 50 auf Gerät gesetzt werden soll
- **THEN** antwortet der Server mit 422

### Requirement: Ein Standort je Posten

Jeder Posten SHALL höchstens einen Ort haben: eine Einheit, ein Fahrzeug, eine UHS, einen
Bereitstellungsraum oder keinen („ohne Ort“). Die Datenbank MUST einen zweiten Ort zurückweisen.
Nennt eine Anfrage mehr als einen Ort mit Wert, MUST der Server mit 422 antworten, ohne etwas zu
schreiben.

#### Scenario: Zwei Orte in einer Anfrage
- **WHEN** eine Änderung zugleich eine Einheit und eine UHS als Ort setzt
- **THEN** antwortet der Server mit 422, und der Posten bleibt, wo er war

#### Scenario: Auf ein Fahrzeug geladen
- **WHEN** ein Stromerzeuger dem Fahrzeug „Florian 1/83-1“ zugeordnet wird
- **THEN** ist das Fahrzeug sein Ort

### Requirement: Ort setzen und lösen

Setzt eine Anfrage einen Ort, SHALL der bisherige in derselben Anfrage gelöst werden. Das Lösen des
aktuellen Orts MUST den Posten ohne Ort lassen; das Lösen eines Orts, an dem der Posten nicht ist,
MUST nichts ändern.

#### Scenario: Von der Einheit an die UHS
- **WHEN** ein Posten der Einheit „Staffel A“ der UHS „Turnhalle“ zugeordnet wird
- **THEN** ist er an der UHS „Turnhalle“ und an keiner Einheit mehr

#### Scenario: Lösen eines fremden Orts
- **WHEN** ein Posten an der UHS „Turnhalle“ von einer Einheit gelöst werden soll
- **THEN** bleibt er an der UHS „Turnhalle“, und kein ETB-Eintrag entsteht

### Requirement: Prüfung des Orts

Setzt eine Anfrage einen anderen Ort als den gespeicherten, SHALL der Server das Ziel prüfen: ein
Ort aus einem anderen Einsatz, ein unbekannter und eine stornierte UHS oder ein stornierter
Bereitstellungsraum MUST mit 404 abgelehnt werden, eine aufgelöste Einheit und ein entlassenes oder
storniertes Fahrzeug mit 409, eine aufgelöste UHS und ein aufgelöster Bereitstellungsraum mit 422.
Ein unveränderter Ort und das Lösen MUST ohne diese Prüfung gelingen.

#### Scenario: Aufgelöster Bereitstellungsraum
- **WHEN** ein Posten einem aufgelösten Bereitstellungsraum zugeordnet werden soll
- **THEN** antwortet der Server mit 422

#### Scenario: Entlassenes Fahrzeug
- **WHEN** ein Posten einem entlassenen Fahrzeug zugeordnet werden soll
- **THEN** antwortet der Server mit 409

#### Scenario: Geplanter Bereitstellungsraum
- **WHEN** ein Posten einem geplanten Bereitstellungsraum zugeordnet wird
- **THEN** gelingt die Zuordnung

### Requirement: Ortswechsel, Ausgabe und Art im ETB

Jeder Ortswechsel eines Postens SHALL genau einen ETB-Eintrag schreiben, der alten und neuen Ort
nennt, auf jedem Weg und auch bei einer UHS; ein Posten ohne Ort MUST als „ohne Ort“ erscheinen.
Jede Änderung der Ausgabe MUST einen Eintrag mit altem und neuem Wert und dem Rest schreiben, jeder
Wechsel der Art einen Eintrag mit beiden Arten. Ohne Änderung MUST kein Eintrag entstehen.

#### Scenario: Ortswechsel
- **WHEN** 20 Wolldecken von der Einheit „Staffel A“ an die UHS „Turnhalle“ wechseln
- **THEN** steht im ETB „Material «Wolldecke» (×20): Einheit «Staffel A» → UHS «Turnhalle»“

#### Scenario: Ausgabe
- **WHEN** bei 50 Wolldecken die Ausgabe von 20 auf 30 steigt
- **THEN** steht im ETB „Material «Wolldecke»: Ausgabe 20 → 30 (Rest 20 von 50)“

#### Scenario: Gleicher Ort
- **WHEN** ein Posten erneut seinem eigenen Ort zugeordnet wird
- **THEN** entsteht kein ETB-Eintrag

### Requirement: Ortswechsel live

Nach jeder Änderung eines Postens SHALL das Live-Ereignis `material` gesendet werden; bei einem
Ortswechsel MUST zusätzlich das Ereignis des alten und des neuen Orts (Einheit, Fahrzeug, UHS,
Bereitstellungsraum) gesendet werden, damit dessen Leser ohne Materialrecht nachladen.

#### Scenario: Wechsel an einen Bereitstellungsraum
- **WHEN** ein Posten von der UHS „Turnhalle“ an den Bereitstellungsraum „BR Nord“ wechselt
- **THEN** erhalten Leser von „Turnhalle“ und „BR Nord“ je eine Meldung

### Requirement: Ende eines Orts

Wird eine Einheit aufgelöst oder ein Fahrzeug entlassen, SHALL ihr Material ohne Ort weiter im
Einsatz stehen. Ein Fahrzeug mit Beladung MUST NOT storniert werden (422). An einer aufgelösten UHS
und einem aufgelösten Bereitstellungsraum MUST das Material bleiben. Wird ein Posten aus dem Einsatz
genommen, MUST er ohne Ort sein; stornieren MUST nur ein Posten ohne Ort.

#### Scenario: Fahrzeug entlassen
- **WHEN** das Fahrzeug „Florian 1/83-1“ mit einem geladenen Stromerzeuger entlassen wird
- **THEN** steht der Stromerzeuger ohne Ort in der Materialliste, und der ETB-Eintrag des Entlassens nennt „Beladung ohne Ort: 1 Posten“

#### Scenario: Fahrzeug mit Beladung stornieren
- **WHEN** ein Fahrzeug mit Beladung storniert werden soll
- **THEN** antwortet der Server mit 422 „Fahrzeug hat Material geladen“

### Requirement: Übernahme der Art

Die Umstellung SHALL jedem bestehenden Stamm-Material und Posten eine Art geben. Ein Stamm-Material
mit Bestandsnummer MUST Gerät werden; ohne Bestandsnummer MUST es Verbrauchsgut werden, wenn es je
mit Menge über 1 disponiert war, sonst Gerät. Ein Posten MUST Verbrauchsgut werden, wenn seine Menge
über 1 liegt oder sein Stamm Verbrauchsgut ist, sonst Gerät.

#### Scenario: Gerät mit Bestandsnummer
- **WHEN** ein Stamm-Material mit Bestandsnummer übernommen wird
- **THEN** ist es ein Gerät

#### Scenario: Decken mit Menge 50
- **WHEN** ein Posten mit Menge 50 übernommen wird
- **THEN** ist er ein Verbrauchsgut

### Requirement: Übernahme von Status und Ort

Die Umstellung SHALL jeden bestehenden Posten erhalten. Ein verbrauchtes Verbrauchsgut MUST danach
ganz ausgegeben sein, ein Verbrauchsgut zur Desinfektion defekt mit dem alten Status in der
Bemerkung. Ein Posten an Einheit und UHS zugleich MUST an der UHS bleiben und die Einheit in der
Bemerkung nennen. Bestehende Bemerkungen MUST erhalten bleiben.

#### Scenario: Einheit und UHS zugleich
- **WHEN** vor der Umstellung ein Posten der Einheit „Rettungsstaffel“ und der UHS „Turnhalle“ zugeordnet war
- **THEN** ist danach die UHS „Turnhalle“ sein Ort, und seine Bemerkung endet mit „Umstellung Material-Modell: vorher zugleich Einheit «Rettungsstaffel»“

#### Scenario: Verbrauchte Decken
- **WHEN** vor der Umstellung 50 Wolldecken den Status „verbraucht“ trugen
- **THEN** sind sie danach ein Verbrauchsgut mit Ausgabe 50, also aufgebraucht

### Requirement: Darstellung je Posten

Die Oberfläche SHALL einen aufgebrauchten Posten als „aufgebraucht“ in der Farbe von „verbraucht“
zeigen, nie als „einsatzbereit“. Die Statuswahl MUST je Art nur die erlaubten Status anbieten. Die
Menge eines Geräts MUST ohne Bearbeitung stehen, die eines teilweise ausgegebenen Verbrauchsguts als
„30 von 50 übrig“. Im Stamm MUST die Art beim Anlegen und Bearbeiten wählbar sein.

#### Scenario: Aufgebrauchte Decken in der Liste
- **WHEN** 50 Wolldecken ganz ausgegeben sind
- **THEN** zeigt ihre Zeile „0 von 50 übrig“, und die Verdichtung zählt sie als Ausfall

#### Scenario: Statuswahl eines Verbrauchsguts
- **WHEN** die Person die Statuswahl eines Verbrauchsguts öffnet
- **THEN** stehen darin weder „verbraucht“ noch „Desinfektion nötig“
