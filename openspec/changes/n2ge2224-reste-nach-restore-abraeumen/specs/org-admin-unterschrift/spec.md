# Spec Delta

## ADDED Requirements

### Requirement: Ein Schlüssel, den die Quelle nicht mehr führt, gilt nicht mehr

Mit jeder Antwort auf eine Meldung SHALL die erreichte Seite je Org die Liste ihrer gültigen
Unterschriftsschlüssel schicken. Ein Schlüssel aus dieser Zuordnung, der an der meldenden Seite
gültig ist oder auf Bestätigung wartet und in der Liste fehlt, MUST dort als widerrufen gelten.
Das MUST in der Admin-Spur und als Hinweis an der Kopplung stehen. Schickt die erreichte Seite
keine Liste, MUST die meldende Seite nichts widerrufen.

#### Scenario: Hub verliert einen Schlüssel mit der Sicherung
- **WHEN** der Hub einen neuen Unterschriftsschlüssel von Admin C an den ELW geliefert hat, danach aus einer Sicherung von vorher zurückgespielt wird und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel von Admin C als widerrufen und nimmt keine Unterschrift damit mehr an
- **AND** die Admin-Spur des ELW nennt den Widerruf mit dem Hub als Auslöser, und die Kopplung zeigt einen Hinweis darauf

#### Scenario: Wartender Schlüssel
- **WHEN** der ELW einen Schlüssel vom Hub noch nicht bestätigt hat und der Hub ihn mit einer Sicherung verliert
- **THEN** gilt der Schlüssel am ELW nach der nächsten Meldung als widerrufen und kann dort nicht mehr bestätigt werden

#### Scenario: Ein abgelehnter Schlüssel bleibt abgelehnt
- **WHEN** ein Admin am ELW einen Schlüssel vom Hub zurückgewiesen hat und der Hub ihn nicht mehr führt
- **THEN** bleibt der Schlüssel am ELW zurückgewiesen

#### Scenario: Gegenstelle älteren Stands
- **WHEN** der Hub die Liste nicht schickt, weil er einen älteren Stand hat
- **THEN** widerruft der ELW keinen Schlüssel aus dieser Zuordnung, und die Nachlieferung läuft wie bisher
