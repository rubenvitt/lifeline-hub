# Spec Delta

## ADDED Requirements

### Requirement: Ohne Stände steht nur ein Knopf „Stand sichern“

Solange kein Stand gesichert ist, SHALL die Zeitachse für eine Person mit Schreibrecht nur aus
einem Knopf „Stand sichern“ bestehen, der Symbol und Wort trägt und unten links in der Karte
steht. Es MUST kein Band und kein Knopf „Zeitachse ausblenden“ erscheinen, und die Zeitachse
MUST nicht mehr Höhe einnehmen als dieser Knopf.

#### Scenario: Neuer Einsatz am Fükw
- **WHEN** eine Person mit Schreibrecht die Lagekarte eines Einsatzes ohne gesicherte Stände bei 1366 × 768 öffnet
- **THEN** steht unten links nur der Knopf „Stand sichern“ mit Wort, und es gibt keinen Knopf „Zeitachse ausblenden“

#### Scenario: Beobachter ohne Stände
- **WHEN** eine Person ohne Schreibrecht die Lagekarte eines Einsatzes ohne gesicherte Stände öffnet
- **THEN** zeigt die Karte keine Zeitachse

### Requirement: Die Klappwahl gilt erst ab dem ersten Stand

Ohne gesicherten Stand MUST die gemerkte Klappwahl der Zeitachse unbeachtet bleiben: Der Knopf
„Stand sichern“ SHALL auch dann stehen, wenn die Zeitachse zuletzt eingeklappt war, und ein Knopf
„Zeitachse einblenden“ MUST fehlen. Ab dem ersten gesicherten Stand SHALL wieder die gemerkte
Wahl beziehungsweise die Vorgabe der Breite gelten.

#### Scenario: Eingeklappte Wahl ohne Stände
- **WHEN** die Zeitachse zuletzt eingeklappt war und eine Person mit Schreibrecht die Lagekarte eines Einsatzes ohne Stände bei 390 × 844 öffnet
- **THEN** steht unten links der Knopf „Stand sichern“ mit Wort statt „Zeitachse einblenden“

#### Scenario: Erster Stand gesichert
- **WHEN** eine Person mit Schreibrecht über den Knopf „Stand sichern“ den ersten Stand sichert
- **THEN** zeigt die Zeitachse das Band mit der Auswahl „Stand“ oder, wenn die gemerkte Wahl oder die Breite es verlangt, den Knopf „Zeitachse einblenden“

## MODIFIED Requirements

### Requirement: Stand sichern über einen kurzen Dialog

Mit Schreibrecht SHALL das Band einen Knopf „Stand sichern“ tragen. Der Knopf MUST neben dem
Symbol das Wort „Stand sichern“ zeigen. Er MUST einen Dialog öffnen,
der eine optionale Bezeichnung annimmt und den Stand mit „Sichern“ oder Enter sichert. Ohne
Schreibrecht MUST der Knopf fehlen. Das Feld für die Bezeichnung MUST NOT dauerhaft im Band stehen.

#### Scenario: Stand mit Bezeichnung sichern
- **WHEN** eine Person mit Schreibrecht „Stand sichern“ tippt, „08:00 Lage“ eingibt und Enter drückt
- **THEN** ist ein Stand mit der Bezeichnung „08:00 Lage“ gesichert, der Dialog geschlossen, und die Auswahl bietet ihn an

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht die Zeitachse ausklappt
- **THEN** fehlt der Knopf „Stand sichern“, und Auswahl und Wiedergabe stehen zur Verfügung

#### Scenario: Wort am Knopf im Band
- **WHEN** eine Person mit Schreibrecht die Zeitachse mit mindestens einem gesicherten Stand ausklappt
- **THEN** zeigt der Knopf „Stand sichern“ neben dem Symbol das Wort „Stand sichern“
