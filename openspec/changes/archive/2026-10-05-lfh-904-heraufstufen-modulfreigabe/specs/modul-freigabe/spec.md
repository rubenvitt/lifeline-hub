# Spec Delta

## ADDED Requirements

### Requirement: Das Heraufstufen aus dem Chat verlangt die Freigabe des Zielmoduls
Das Heraufstufen einer Chat-Nachricht MUST außer dem Schreibrecht im Chat die Freigabe des
Zielmoduls verlangen: ins ETB die des Moduls `etb`, zum Auftrag die des Moduls `auftraege`, nach
derselben Regel wie der Listen-Endpunkt des Zielmoduls. Fehlt sie, MUST das System mit HTTP 403
antworten, ohne dass Eintrag, Auftrag, Dateikopie oder Rückverweis entstehen. Der Weg zum Auftrag
MUST die Freigabe des ETB nicht zusätzlich verlangen.

#### Scenario: ETB für die Rolle gesperrt
- **WHEN** das Modul `etb` im Einsatz auf System-Admins beschränkt ist und eine Führungsperson ohne Admin-Rechte eine Chat-Nachricht ins ETB heraufstuft
- **THEN** antwortet das System mit HTTP 403
- **AND** es entsteht kein ETB-Eintrag, und die Nachricht trägt keinen Verweis auf einen Eintrag

#### Scenario: ETB frei
- **WHEN** das Modul `etb` für die Führungsperson frei ist und sie dieselbe Nachricht heraufstuft
- **THEN** entsteht der Eintrag wie bisher

#### Scenario: Aufträge für die Rolle gesperrt
- **WHEN** das Modul `auftraege` im Einsatz auf System-Admins beschränkt ist und eine Führungsperson ohne Admin-Rechte eine Chat-Nachricht zum Auftrag heraufstuft
- **THEN** antwortet das System mit HTTP 403
- **AND** es entstehen weder Auftrag noch ETB-Anordnung, und die Nachricht trägt keinen Verweis auf einen Auftrag

#### Scenario: Auftrag bei gesperrtem ETB
- **WHEN** das Modul `etb` für die Führungsperson gesperrt, `auftraege` aber frei ist und sie eine Nachricht zum Auftrag heraufstuft
- **THEN** entsteht der Auftrag wie über die Auftragsliste

### Requirement: Das Chat-Menü sperrt das Heraufstufen in ein gesperrtes Modul
Im Chat MUST der Menüeintrag „Zu ETB“ bzw. „Zu Auftrag“ einer Nachricht gesperrt erscheinen, wenn
die Freigaben des Servers für das Zielmodul `zugriff: false` melden, mit dem Grund „Keine
Berechtigung“ im Eintrag. Ein gesperrter Eintrag MUST NOT den Dialog öffnen. Solange die Freigaben
unbekannt sind, MUST der Eintrag wie bisher erscheinen.

#### Scenario: Menüeintrag ohne Freigabe
- **WHEN** die Freigaben des Servers für `etb` `zugriff: false` melden und eine schreibberechtigte Person das Menü einer Nachricht öffnet
- **THEN** steht „Zu ETB (Keine Berechtigung)“ gesperrt im Menü, und ein Klick öffnet keinen Dialog

#### Scenario: Auftrag frei, ETB gesperrt
- **WHEN** dieselbe Person für `auftraege` `zugriff: true` hat
- **THEN** steht „Zu Auftrag“ im selben Menü bedienbar da

#### Scenario: Freigaben unbekannt
- **WHEN** die Freigaben noch laden
- **THEN** stehen „Zu ETB“ und „Zu Auftrag“ wie bisher bedienbar im Menü
