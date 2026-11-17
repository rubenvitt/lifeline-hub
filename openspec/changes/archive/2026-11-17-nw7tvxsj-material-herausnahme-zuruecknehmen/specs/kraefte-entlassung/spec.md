# Spec Delta

## MODIFIED Requirements

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt; ein schon entlassenes Fahrzeug MUST beim Sammel-Disponieren mit dem Grund „entlassen“
abgelehnt werden, ein storniertes reaktiviert werden. Material MUST beim Reaktivieren Menge und
Status behalten; das Disponieren aus dem Stamm legt bei Material immer eine neue Zeile an.
Gestrichene Ereignisse MUST gestrichen bleiben. „Rückgängig“ führt nicht über diesen Weg: beim
Fahrzeug gilt „Entlassung eines Fahrzeugs zurücknehmen“, bei der Person „Entlassung einer Person
zurücknehmen“, beim Material „Herausnahme von Material zurücknehmen“.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Herausnehmen eines Postens „Rückgängig“ wählt
- **THEN** ist der Posten wieder aktiv, mit seiner Dispositionszeit von vorher statt neu disponiert

#### Scenario: Material kommt zurück
- **WHEN** ein defekter Posten mit Menge 4 aus dem Einsatz genommen und erneut disponiert wird
- **THEN** steht er wieder in der Liste, mit Menge 4 und Status „defekt“, ohne Ort

## ADDED Requirements

### Requirement: Herausnahme von Material zurücknehmen

„Rückgängig“ nach „Aus dem Einsatz nehmen“ SHALL den Posten in einer Transaktion in den Zustand
davor zurücknehmen: aktiv, mit Menge, Status, Dispositionszeit und seinem Ort. Der Storno MUST danach
gesperrt bleiben. Die Rücknahme MUST einen ETB-Eintrag „Herausnahme zurückgenommen“ schreiben, der
den Ort nennt, an den der Posten zurückkam, und MUST dieselben Live-Meldungen senden wie das
Herausnehmen. Sie MUST kein Schreibrecht über das Recht
auf Material hinaus verlangen.

#### Scenario: Herausnehmen und Rückgängig
- **WHEN** der Posten „Wolldecke“ mit Menge 20, Status „im Einsatz“, an der Einheit „Staffel A“ aus dem Einsatz genommen wird und direkt danach „Rückgängig“ gewählt wird
- **THEN** steht er wieder in der Liste, mit Menge 20 und Status „im Einsatz“ an „Staffel A“, mit der Dispositionszeit von vorher, und im ETB steht „Material «Wolldecke» (×20): Herausnahme zurückgenommen, Ort Einheit «Staffel A»“

#### Scenario: Storno nach der Rücknahme
- **WHEN** ein Posten kurz nach dem Disponieren aus dem Einsatz genommen und zurückgenommen wird und danach jemand ihn stornieren will
- **THEN** lehnt der Server den Storno ab

### Requirement: Rücknahme von Material lässt einen veränderten Ort aus

Nimmt der Ort des Postens ihn nicht mehr auf (Einheit aufgelöst, Fahrzeug entlassen oder storniert,
UHS oder Bereitstellungsraum nicht mehr aktiv) oder gibt es ihn nicht mehr, MUST die Rücknahme den
Posten trotzdem aktiv machen, ohne Ort, und den Ort mit Grund in ihrer Antwort nennen. Der Hinweis
MUST ihn in Worten zeigen, das ETB MUST ihn nach „ohne“ nennen. Eine Einheit, die nach dem
Herausnehmen gebildet wurde, MUST NOT den Posten bekommen.

#### Scenario: Fahrzeug inzwischen entlassen
- **WHEN** ein Posten auf dem Fahrzeug „Florian 1-83-1“ aus dem Einsatz genommen, danach das Fahrzeug entlassen und dann „Rückgängig“ gewählt wird
- **THEN** ist der Posten aktiv ohne Ort, und der Hinweis nennt „Fahrzeug «Florian 1-83-1»“ als nicht zurückgekommen

#### Scenario: Einheit inzwischen aufgelöst
- **WHEN** die Einheit eines herausgenommenen Postens aufgelöst wird und danach „Rückgängig“ gewählt wird
- **THEN** ist der Posten aktiv ohne Ort, und das ETB nennt die Einheit nach „ohne“

#### Scenario: Einheit spurlos aufgelöst, eine neue gebildet
- **WHEN** die Einheit eines herausgenommenen Postens spurlos aufgelöst und danach eine neue Einheit gebildet wird und dann „Rückgängig“ gewählt wird
- **THEN** ist der Posten aktiv ohne Ort, nicht in der neuen Einheit, und der Hinweis nennt „Einheit (nicht mehr vorhanden)“

### Requirement: Rücknahme von Material nur direkt nach dem Herausnehmen

Die Rücknahme MUST nur der Person gelingen, die herausgenommen hat, und nur, solange der Posten seit
diesem Herausnehmen unverändert herausgenommen ist und höchstens zehn Minuten vergangen sind. Ein
Gerät mit Bestandsnummer, das inzwischen in einer anderen Zeile wieder im Einsatz steht, MUST NOT
zurückkommen. In diesen Fällen MUST das System mit 409 antworten und nichts ändern; es bleibt
„Erneut disponieren“.

#### Scenario: Schon erneut disponiert
- **WHEN** ein herausgenommener Posten über „Erneut disponieren“ zurückgeholt wurde und danach die Rücknahme ankommt
- **THEN** antwortet das System mit 409, und der Posten bleibt unverändert

#### Scenario: Andere Person
- **WHEN** eine andere Person als die herausnehmende die Rücknahme sendet
- **THEN** antwortet das System mit 409

#### Scenario: Gerät inzwischen neu disponiert
- **WHEN** ein Gerät mit Bestandsnummer aus dem Einsatz genommen, dasselbe Stück aus dem Stamm neu disponiert und danach „Rückgängig“ gewählt wird
- **THEN** antwortet das System mit 409 mit dem Grund, und die herausgenommene Zeile bleibt herausgenommen
