# Spec Delta

## ADDED Requirements

### Requirement: Entlassung einer Person zurücknehmen

„Rückgängig“ nach dem Entlassen einer Person SHALL sie in einer Transaktion in den Zustand davor
zurücknehmen: aktiv, mit Status, Dispositionszeit und Stärke-Position wie vorher, mit Einheit,
Fahrzeug, UHS, Führung ihrer Einheiten, Leitung ihrer Abschnitte und Einsatzleitung. Ihre
Zeitachse MUST keine neue Periode bekommen: die Entlassung dieses Entlassens wird gestrichen.
Der Storno MUST gesperrt bleiben. ETB „Entlassung zurückgenommen“, Live-Meldungen wie beim
Entlassen.

#### Scenario: Entlassen und Rückgängig
- **WHEN** eine Person auf Status „im Einsatz“ seit 10:15, Mitglied und Führer der Einheit „Zug 1“, Besatzung von „83-1“, an der UHS „Nord“, Leiterin des Abschnitts „Süd“ und Einsatzleiterin, entlassen wird und direkt danach „Rückgängig“ gewählt wird
- **THEN** ist sie aktiv, auf „im Einsatz“ seit 10:15, Mitglied und Führer von „Zug 1“, Besatzung von „83-1“, an der UHS „Nord“, leitet „Süd“, ist Einsatzleiterin, und das ETB nennt „Entlassung zurückgenommen“

#### Scenario: Zeitachse ohne neue Periode
- **WHEN** eine Person mit Eintreffen um 09:00 um 11:00 entlassen und direkt danach zurückgenommen wird
- **THEN** zeigt ihre Zeitachse eine offene Periode ab 09:00, die Entlassung um 11:00 ist mit Grund „Entlassung zurückgenommen“ gestrichen, und es gibt keine Periode ab 11:00

#### Scenario: Entlassen ohne offene Periode
- **WHEN** eine Person ohne offene Periode entlassen und zurückgenommen wird
- **THEN** ist sie aktiv, und ihre Zeitachse ist unverändert

#### Scenario: Zeitachse inzwischen berichtigt
- **WHEN** nach dem Entlassen einer Person jemand die Entlassungszeit berichtigt und danach „Rückgängig“ gewählt wird
- **THEN** antwortet das System mit 409, und die Person bleibt unverändert entlassen

#### Scenario: Storno nach der Rücknahme
- **WHEN** eine Person kurz nach dem Disponieren entlassen und zurückgenommen wird und danach jemand sie stornieren will
- **THEN** lehnt der Server den Storno ab

## MODIFIED Requirements

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt; ein schon entlassenes Fahrzeug MUST beim Sammel-Disponieren mit dem Grund „entlassen“
abgelehnt werden, ein storniertes reaktiviert werden. Material MUST beim Reaktivieren Menge und
Status behalten; das Disponieren aus dem Stamm legt bei Material immer eine neue Zeile an.
Gestrichene Ereignisse MUST gestrichen bleiben. „Rückgängig“ nach dem Herausnehmen von Material
MUST die Kraft auf diesem Weg wieder aktiv machen; beim Fahrzeug gilt „Entlassung eines
Fahrzeugs zurücknehmen“, bei der Person „Entlassung einer Person zurücknehmen“.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Herausnehmen eines Postens „Rückgängig“ wählt
- **THEN** ist der Posten wieder aktiv

#### Scenario: Material kommt zurück
- **WHEN** ein defekter Posten mit Menge 4 aus dem Einsatz genommen und erneut disponiert wird
- **THEN** steht er wieder in der Liste, mit Menge 4 und Status „defekt“, ohne Ort

### Requirement: Rücknahme lässt Verändertes aus

Was seit dem Entlassen anders gebunden ist oder nicht mehr besteht (Einheit aufgelöst, Person auf
einem anderen Fahrzeug oder entlassen, Raum nicht mehr aktiv, Posten an einem anderen Ort, Führung,
Leitung oder Einsatzleitung inzwischen anders besetzt, UHS aufgelöst), MUST die Rücknahme
auslassen und in ihrer Antwort nennen; der Hinweis MUST es in Worten zeigen. Ebenso MUST sie einen
Teil auslassen und nennen, für dessen Modul der Person das Schreibrecht fehlt. Das gilt für die
Rücknahme bei Fahrzeug und Person.

#### Scenario: Person inzwischen auf anderem Fahrzeug
- **WHEN** nach dem Entlassen eines Fahrzeugs eine seiner Personen auf ein anderes Fahrzeug gesetzt wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne diese Person, die Person bleibt auf dem anderen Fahrzeug, und der Hinweis nennt sie als nicht zurückgekommen

#### Scenario: Einheit inzwischen aufgelöst
- **WHEN** die Einheit des entlassenen Fahrzeugs aufgelöst wird und danach „Rückgängig“ gewählt wird
- **THEN** ist das Fahrzeug aktiv ohne Einheit, und der Hinweis nennt die Einheit

#### Scenario: Einheit hat inzwischen einen anderen Führer
- **WHEN** nach dem Entlassen eines Einheitsführers eine andere Person die Einheit übernimmt und danach „Rückgängig“ gewählt wird
- **THEN** ist die entlassene Person wieder aktiv und Mitglied der Einheit, aber nicht ihr Führer, und der Hinweis nennt die Führung als nicht zurückgekommen

#### Scenario: Inzwischen anderer Einsatzleiter
- **WHEN** nach dem Entlassen der Einsatzleiterin ein externer Einsatzleiter eingetragen wird und danach „Rückgängig“ gewählt wird
- **THEN** bleibt der externe Einsatzleiter, und der Hinweis nennt die Einsatzleitung als nicht zurückgekommen

#### Scenario: Ohne Recht im Modul Einheiten
- **WHEN** eine Person mit Schreibrecht im Personal, aber ohne Schreibrecht im Modul Einheiten, einen Einheitsführer entlässt und zurücknimmt
- **THEN** ist er aktiv ohne Einheit und ohne Führung, und der Hinweis nennt beides mit dem fehlenden Recht

### Requirement: Rücknahme nur direkt nach dem Entlassen

Die Rücknahme MUST nur der Person gelingen, die entlassen hat, und nur, solange die Kraft
(Fahrzeug oder Person) seit diesem Entlassen unverändert entlassen ist und höchstens zehn Minuten
vergangen sind. Sonst MUST das System mit 409 antworten, und es bleibt „Erneut disponieren“.

#### Scenario: Schon erneut disponiert
- **WHEN** ein entlassenes Fahrzeug über „Erneut disponieren“ zurückgeholt wurde und danach die Rücknahme ankommt
- **THEN** antwortet das System mit 409, und das Fahrzeug bleibt unverändert

#### Scenario: Andere Person
- **WHEN** eine andere Person als die entlassende die Rücknahme sendet
- **THEN** antwortet das System mit 409

#### Scenario: Person nach zehn Minuten
- **WHEN** die Rücknahme einer entlassenen Person elf Minuten nach dem Entlassen ankommt
- **THEN** antwortet das System mit 409, und die Person bleibt entlassen
