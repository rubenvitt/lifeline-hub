# Spec Delta

## ADDED Requirements

### Requirement: Registrierliste drucken

Die Oberfläche SHALL im Paneel „Registrierung“ einer Betreuungsstelle „Registrierliste drucken“
anbieten, mit Zugriff auf Betreuung und Personen auch ohne Schreibrecht. Das Blatt MUST die
Summen je Kostform samt „ohne Angabe“ zeigen und je Haushalt Nummer, Bezugsperson und die hier
registrierten Personen mit Registriernummer, Name, Geburtsdatum oder Alter, Kostform und einer
leeren Spalte zum Abhaken. Es MUST ein Schnappschuss sein, der sich erst mit „Neu laden“ ändert.

#### Scenario: Blatt einer Stelle
- **WHEN** an „Turnhalle Ost“ der Haushalt „H-1“ mit drei Personen registriert ist und jemand „Registrierliste drucken“ wählt
- **THEN** zeigt das Blatt „H-1“ mit drei Personen, die Summen 1 Normalkost, 1 vegetarisch, 1 Säugling/Kleinkind und je Person ein leeres Abhakfeld

#### Scenario: Personen ohne Haushalt
- **WHEN** an der Stelle eine Person ohne Haushalt registriert ist (über einen Verbleib aufgenommen)
- **THEN** steht sie in einem eigenen Block „ohne Haushalt“ und zählt in den Summen

#### Scenario: Ohne Personenrecht
- **WHEN** ein Benutzer mit Zugriff auf Betreuung, aber ohne Zugriff auf Personen die Detailseite öffnet
- **THEN** fehlt „Registrierliste drucken“, und der Druckabruf antwortet mit 403

#### Scenario: Live-Änderung nach dem Öffnen
- **WHEN** nach dem Öffnen der Druckansicht ein weiterer Haushalt registriert wird
- **THEN** bleibt das Blatt unverändert, bis jemand „Neu laden“ wählt

### Requirement: Druck der Registrierliste wird je Person protokolliert

Jeder Druckabruf der Registrierliste MUST für jede Person auf dem Blatt genau einen Eintrag der
Art `druck` mit Bezug auf diese Person ins Zugriffsprotokoll schreiben. Der Server MUST die
Daten nur ausliefern, wenn alle Einträge geschrieben sind. Die Druckansicht MUST ihre Daten nur
über diesen Abruf beziehen, ohne zwischengespeicherte Liste und ohne automatische Wiederholung,
und am Bildschirm sagen, dass der Abruf protokolliert wird.

#### Scenario: Druckansicht öffnen
- **WHEN** eine Einsatzkraft die Registrierliste einer Stelle mit drei registrierten Personen öffnet
- **THEN** steht im Zugriffsprotokoll jeder dieser drei Personen ein neuer Eintrag `druck` mit ihrem Benutzer, und bei Personen anderer Stellen keiner

#### Scenario: Neu laden
- **WHEN** dieselbe Einsatzkraft „Neu laden“ wählt
- **THEN** entsteht je Person ein weiterer Eintrag `druck`

#### Scenario: Protokoll nicht schreibbar
- **WHEN** ein Protokolleintrag nicht geschrieben werden kann
- **THEN** liefert der Server keine Personendaten, und kein Eintrag dieses Abrufs bleibt stehen

#### Scenario: Leere Stelle
- **WHEN** an der Stelle niemand registriert ist
- **THEN** zeigt die Druckansicht das als leere Liste ohne Druckknopf, und es entsteht kein Eintrag

### Requirement: Gesundheitsangaben nur auf Wunsch

Unverträglichkeiten MUST nur auf der gedruckten Registrierliste stehen, wenn jemand sie in der
Druckansicht ausdrücklich wählt; die Vorgabe ist ohne. Ohne diese Wahl MUST der Server sie im
Druckabruf nicht ausliefern. Mit der Wahl MUST der Druckkopf „mit Gesundheitsangaben“ tragen.

#### Scenario: Vorgabe ohne Gesundheitsangaben
- **WHEN** „Weber, Lea“ die Unverträglichkeit „Erdnüsse“ trägt und jemand die Registrierliste druckt, ohne „Unverträglichkeiten mitdrucken“ zu wählen
- **THEN** steht „Erdnüsse“ weder auf dem Blatt noch in der Antwort des Servers

#### Scenario: Bewusst gewählt
- **WHEN** jemand „Unverträglichkeiten mitdrucken“ wählt
- **THEN** steht „Erdnüsse“ in der Zeile von „Weber, Lea“, und der Druckkopf nennt „mit Gesundheitsangaben“

### Requirement: Registrierliste drucken am Gerät

Das Gerät „Betreuungsstelle“ SHALL die Registrierliste seiner eigenen Stelle drucken können,
mit demselben Blatt und demselben Protokoll. Eine andere Stelle MUST mit 403 abgelehnt werden,
bevor etwas gelesen oder protokolliert wird. Andere Gerätearten MUST den Druckabruf nicht
erreichen.

#### Scenario: Eigene Stelle
- **WHEN** das Gerät von „Turnhalle Ost“ im Bereich „Registrierung“ „Registrierliste drucken“ wählt
- **THEN** öffnet sich die Druckansicht der Registrierliste von „Turnhalle Ost“, und das Protokoll nennt das Gerätekonto

#### Scenario: Fremde Stelle
- **WHEN** das Gerät von „Turnhalle Ost“ den Druckabruf für „Weserstadion“ sendet
- **THEN** antwortet das System mit 403 und schreibt keinen Protokolleintrag

#### Scenario: Andere Geräteart
- **WHEN** ein UHS-Gerät den Druckabruf sendet
- **THEN** antwortet das System mit 403
