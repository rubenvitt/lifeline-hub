## ADDED Requirements

### Requirement: Löschen bei gestiegenem Schwärzungsstand

Liefert der Server für einen Einsatz einen höheren Wert `teilschwaerzungen`, als ihn der
vorgehaltene Stand dieses Einsatzes trägt, MUST das System jeden vor dieser Antwort abgerufenen
Stand dieses Einsatzes verwerfen, im Speicher der Seite und geräteseitig. Angezeigte Daten MUST
neu abgerufen werden. Daten anderer Einsätze MUST unberührt bleiben. Ohne Netz gilt die
Höchstliegezeit.

#### Scenario: Schwärzung während der Tab offen ist
- **WHEN** der Tab den Kopf von Einsatz 7 mit `teilschwaerzungen: 1` hält und ein neuer Abruf `teilschwaerzungen: 2` liefert
- **THEN** sind alle älteren Stände von Einsatz 7 aus Speicher und geräteseitigem Speicher entfernt, und die angezeigten Daten werden neu abgerufen
- **AND** bleibt der Stand von Einsatz 8 erhalten

#### Scenario: Schwärzung zwischen zwei Sitzungen
- **WHEN** das Gerät beim Start einen Stand von Einsatz 7 mit Kopf ohne `teilschwaerzungen` vorhält und die erste Einsatzliste der neuen Sitzung Einsatz 7 mit `teilschwaerzungen: 1` liefert
- **THEN** schreibt das Gerät den vorgehaltenen Stand von Einsatz 7 bei der nächsten Speicherung nicht mehr auf die Platte

#### Scenario: Personendetail
- **WHEN** die Detailseite einer Person von Einsatz 7 offen ist und der Schwärzungsstand von Einsatz 7 steigt
- **THEN** ruft die Seite die Person neu ab

### Requirement: Löschen bei verschwundenem Einsatz

Fehlt ein Einsatz in einer erfolgreich abgerufenen Einsatzliste, in deren Vorgänger er stand,
MUST das System alle vorgehaltenen Daten dieses Einsatzes löschen wie bei einem 404 auf den
Einsatzkopf. Ein Einsatz, den der Vorgänger der Liste nicht kannte, MUST unberührt bleiben.

#### Scenario: Einsatz gesperrt, Gerät auf der Einsatzauswahl
- **WHEN** das Gerät Daten von Einsatz 7 vorhält, die Einsatzauswahl zeigt und Einsatz 7 in der neu abgerufenen Liste fehlt
- **THEN** enthält der geräteseitige Speicher keine Daten von Einsatz 7 mehr

#### Scenario: Neu angelegter Einsatz
- **WHEN** die Person Einsatz 9 anlegt und öffnet, bevor die Einsatzliste ihn kennt
- **THEN** bleiben die Daten von Einsatz 9 erhalten
