# Spec Delta

## MODIFIED Requirements

### Requirement: Ortswechsel, Ausgabe und Art im ETB

Jeder Ortswechsel eines Postens SHALL genau einen ETB-Eintrag schreiben, der alten und neuen Ort
nennt, auf jedem Weg und auch bei einer UHS; ein Posten ohne Ort MUST als „ohne Ort“ erscheinen.
Jede Änderung der Ausgabe MUST einen Eintrag mit altem und neuem Wert und dem Rest schreiben, jeder
Wechsel der Art einen Eintrag mit beiden Arten. Ohne Änderung MUST kein Eintrag entstehen. Wechselt
beim Aufteilen der abgeteilte Teil den Ort, MUST der Ortswechsel im einen Eintrag des Aufteilens
stehen, nicht in einem eigenen.

#### Scenario: Ortswechsel
- **WHEN** 20 Wolldecken von der Einheit „Staffel A“ an die UHS „Turnhalle“ wechseln
- **THEN** steht im ETB „Material «Wolldecke» (×20): Einheit «Staffel A» → UHS «Turnhalle»“

#### Scenario: Ausgabe
- **WHEN** bei 50 Wolldecken die Ausgabe von 20 auf 30 steigt
- **THEN** steht im ETB „Material «Wolldecke»: Ausgabe 20 → 30 (Rest 20 von 50)“

#### Scenario: Gleicher Ort
- **WHEN** ein Posten erneut seinem eigenen Ort zugeordnet wird
- **THEN** entsteht kein ETB-Eintrag

#### Scenario: Aufteilen an einen anderen Ort
- **WHEN** von 50 Wolldecken der Einheit „Staffel A“ 20 an die UHS „Turnhalle“ abgeteilt werden
- **THEN** steht im ETB genau ein Eintrag „Material «Wolldecke» aufgeteilt: 50 → 30 + 20, davon 20: Einheit «Staffel A» → UHS «Turnhalle»“

### Requirement: Ortswechsel live

Nach jeder Änderung eines Postens SHALL das Live-Ereignis `material` gesendet werden; bei einem
Ortswechsel MUST zusätzlich das Ereignis des alten und des neuen Orts (Einheit, Fahrzeug, UHS,
Bereitstellungsraum) gesendet werden, damit dessen Leser ohne Materialrecht nachladen. Beim
Aufteilen MUST das Ereignis des Orts der Ausgangszeile und, wenn der abgeteilte Teil woanders hin
geht, das des Ziels gesendet werden.

#### Scenario: Wechsel an einen Bereitstellungsraum
- **WHEN** ein Posten von der UHS „Turnhalle“ an den Bereitstellungsraum „BR Nord“ wechselt
- **THEN** erhalten Leser von „Turnhalle“ und „BR Nord“ je eine Meldung

#### Scenario: Teilmenge an einen Bereitstellungsraum
- **WHEN** von 50 Wolldecken an der UHS „Turnhalle“ 20 an den Bereitstellungsraum „BR Nord“ abgeteilt werden
- **THEN** erhalten Leser von „Turnhalle“ und „BR Nord“ je eine Meldung
