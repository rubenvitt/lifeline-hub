# Spec Delta

## ADDED Requirements

### Requirement: Anzeigename eines Kontos ist begrenzt
Der Anzeigename eines Kontos MUST beim Anlegen und beim Ändern höchstens 200 Zeichen lang sein,
sonst MUST der Server mit 400 ablehnen, bevor etwas geschrieben wird. Die Maske der
Benutzerverwaltung MUST dieselbe Grenze tragen.

#### Scenario: Zu langer Name beim Anlegen
- **WHEN** ein Konto mit einem Anzeigenamen aus 201 Zeichen angelegt werden soll
- **THEN** antwortet der Server mit 400, die Meldung nennt „Anzeigename“ und 200, und es entsteht kein Konto

#### Scenario: Genau an der Grenze
- **WHEN** ein Konto mit einem Anzeigenamen aus 200 „ä“ angelegt wird
- **THEN** antwortet der Server mit Erfolg und speichert den Namen vollständig

#### Scenario: Zu langer Name beim Ändern
- **WHEN** der Anzeigename eines Kontos auf 201 Zeichen geändert werden soll
- **THEN** antwortet der Server mit 400, und Name und Rollen des Kontos bleiben

#### Scenario: Maske zeigt die Grenze
- **WHEN** ein Admin im Dialog „Neuen Benutzer anlegen“ einen Anzeigenamen aus 201 Zeichen eingibt
- **THEN** zeigt das Feld „201 / 200“ mit „zu lang“, der Text bleibt vollständig stehen, und Anlegen ist gesperrt, bis gekürzt ist

### Requirement: Anzeigename von außen wird gekürzt übernommen
Ein Anzeigename, den nicht ein Mensch an dieser Instanz eingibt (Konto aus den Stammdaten einer
gekoppelten Instanz, erste Anmeldung über SSO, Stellvertreter eines fremden Kontos), MUST auf
seine ersten 200 Zeichen gekürzt übernommen werden. Das Konto MUST trotzdem entstehen oder
aktualisiert werden.

#### Scenario: Konto vom Hub mit zu langem Namen
- **WHEN** der Hub ein Konto mit einem Anzeigenamen aus 300 Zeichen liefert
- **THEN** übernimmt der ELW das Konto mit den ersten 200 Zeichen als Anzeigename, ohne Hinweis an der Kopplung

#### Scenario: Erste Anmeldung über SSO mit zu langem Namen
- **WHEN** sich jemand zum ersten Mal über SSO anmeldet und der Anbieter einen Namen aus 300 Zeichen nennt
- **THEN** entsteht das Konto mit den ersten 200 Zeichen als Anzeigename, und die Anmeldung gelingt
