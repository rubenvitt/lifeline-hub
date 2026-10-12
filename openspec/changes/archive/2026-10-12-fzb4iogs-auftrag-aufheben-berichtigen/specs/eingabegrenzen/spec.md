# Spec Delta

## MODIFIED Requirements

### Requirement: Auftrag begrenzt Text und Empfänger
Ein Auftrag MUST höchstens 50 Empfänger im Request haben, sonst 400. Gleiche Empfänger
(gleicher Typ und gleiches Ziel) MUST zu einem zusammengeführt werden. `auftrag_text` MUST
höchstens 10 000, `extern_bezeichnung` höchstens 200 und jedes Feld des Befehlsschemas
höchstens 2 000 Zeichen lang sein. Das MUST auf jedem Weg gelten, auf dem ein Auftrag entsteht,
und ebenso für die Berichtigung eines Auftrags. Der Grund beim Aufheben eines Auftrags MUST
höchstens 2 000 Zeichen lang sein, sonst 400.

#### Scenario: Doppelte Empfänger
- **WHEN** ein Auftrag mit drei identischen Empfängern derselben Einheit erteilt wird
- **THEN** entsteht der Auftrag mit genau einem Empfänger

#### Scenario: Zu viele Empfänger
- **WHEN** ein Auftrag mit 51 Empfängern erteilt wird, ob aus der Auftragsliste, dem ETB, einer Meldung oder dem Chat
- **THEN** antwortet der Server mit 400, und es entsteht kein Auftrag

#### Scenario: Berichtigung mit zu langem Text
- **WHEN** eine Berichtigung einen Auftragstext mit 10 001 Zeichen sendet
- **THEN** antwortet der Server mit 400, und der Auftrag bleibt unverändert

#### Scenario: Zu langer Aufhebungsgrund
- **WHEN** ein Auftrag mit einem Grund von 2 001 Zeichen aufgehoben werden soll
- **THEN** antwortet der Server mit 400, und der Auftrag bleibt offen
