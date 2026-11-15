# Spec Delta

## ADDED Requirements

### Requirement: Entlassung eines Fahrzeugs zurücknehmen

„Rückgängig“ nach dem Entlassen eines Fahrzeugs SHALL das Fahrzeug in einer Transaktion in den
Zustand davor zurücknehmen: aktiv, mit Status und „Status seit“, Einheit, Besatzung,
Bereitstellungsraum, Führungsstelle und Beladung. Die Rücknahme MUST einen ETB-Eintrag
„Entlassung zurückgenommen“ schreiben, MUST keine Benachrichtigung „wieder verfügbar“ auslösen und
MUST dieselben Live-Meldungen senden wie das Entlassen.

#### Scenario: Entlassen und Rückgängig
- **WHEN** ein Fahrzeug auf Status 2 seit 10:15, in Einheit „Zug 1“, mit zwei Personen Besatzung, im Bereitstellungsraum „BR Nord“ und mit einem geladenen Posten entlassen wird und direkt danach „Rückgängig“ gewählt wird
- **THEN** ist es aktiv, auf Status 2 seit 10:15, in „Zug 1“, mit beiden Personen als Besatzung, im „BR Nord“ eingetreten und mit dem Posten beladen, und das ETB nennt „Entlassung zurückgenommen“

#### Scenario: Führungsstelle
- **WHEN** ein Fahrzeug, das die Führungsstelle trägt, entlassen und zurückgenommen wird
- **THEN** trägt es die Führungsstelle wieder

### Requirement: Rücknahme lässt Verändertes aus

Was seit dem Entlassen anders gebunden ist oder nicht mehr besteht (Einheit aufgelöst, Person auf
einem anderen Fahrzeug oder entlassen, Raum nicht mehr aktiv, Posten an einem anderen Ort), MUST die Rücknahme auslassen und in ihrer Antwort nennen; der Hinweis MUST
es in Worten zeigen. Ebenso MUST sie einen Teil auslassen und nennen, für dessen Modul der
Person das Schreibrecht fehlt.

#### Scenario: Person inzwischen auf anderem Fahrzeug
- **WHEN** nach dem Entlassen eines Fahrzeugs eine seiner Personen auf ein anderes Fahrzeug gesetzt wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne diese Person, die Person bleibt auf dem anderen Fahrzeug, und der Hinweis nennt sie als nicht zurückgekommen

#### Scenario: Einheit inzwischen aufgelöst
- **WHEN** die Einheit des entlassenen Fahrzeugs aufgelöst wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne Einheit, und der Hinweis nennt die Einheit

### Requirement: Rücknahme nur direkt nach dem Entlassen

Die Rücknahme MUST nur der Person gelingen, die entlassen hat, und nur, solange das Fahrzeug seit
diesem Entlassen unverändert entlassen ist und höchstens zehn Minuten vergangen sind. Sonst MUST
das System mit 409 antworten, und es bleibt „Erneut disponieren“.

#### Scenario: Schon erneut disponiert
- **WHEN** ein entlassenes Fahrzeug über „Erneut disponieren“ zurückgeholt wurde und danach die Rücknahme ankommt
- **THEN** antwortet das System mit 409, und das Fahrzeug bleibt unverändert

#### Scenario: Andere Person
- **WHEN** eine andere Person als die entlassende die Rücknahme sendet
- **THEN** antwortet das System mit 409

## MODIFIED Requirements

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt; ein schon entlassenes Fahrzeug MUST beim Sammel-Disponieren mit dem Grund „entlassen“
abgelehnt werden, ein storniertes reaktiviert werden. Material MUST beim Reaktivieren Menge und
Status behalten; das Disponieren aus dem Stamm legt bei Material immer eine neue Zeile an.
Gestrichene Ereignisse MUST gestrichen bleiben. „Rückgängig“ nach dem Entlassen einer Person oder
dem Herausnehmen von Material MUST die Kraft auf diesem Weg wieder aktiv machen; beim Fahrzeug
gilt „Entlassung eines Fahrzeugs zurücknehmen“.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Entlassen einer Einsatzkraft „Rückgängig“ wählt
- **THEN** ist die Einsatzkraft wieder aktiv

#### Scenario: Material kommt zurück
- **WHEN** ein defekter Posten mit Menge 4 aus dem Einsatz genommen und erneut disponiert wird
- **THEN** steht er wieder in der Liste, mit Menge 4 und Status „defekt“, ohne Ort
