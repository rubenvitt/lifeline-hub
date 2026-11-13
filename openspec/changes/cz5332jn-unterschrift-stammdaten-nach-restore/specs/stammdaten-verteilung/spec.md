## ADDED Requirements

### Requirement: Stammdaten-Änderungen überstehen das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer gekoppelten Instanz aus einer Sicherung SHALL die Nachlieferung der
Stammdaten ohne Eingriff weiterlaufen. Jede danach an der erreichten Seite geänderte Zeile MUST die
meldende Seite mit den nächsten Meldungen erreichen. Geht die Uhr der zurückgespielten erreichten
Seite nach, MUST sie die Stammdaten der Org einmal ganz neu liefern. Ausgenommen ist eine
nachgehende Uhr, bei der vor der ersten Meldung mehr Änderungen geschehen, als verloren gingen.

#### Scenario: Hub zurückgespielt, Fahrzeug geändert
- **WHEN** der Hub aus einer Sicherung zurückgespielt und neu gestartet wird, danach ein Admin am Hub den Funkrufnamen eines verteilten Fahrzeugs ändert und ein Fahrzeug anlegt und der ELW sich meldet
- **THEN** zeigt der ELW den neuen Funkrufnamen und das neue Fahrzeug

#### Scenario: Zurückgespielter Hub mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Änderungen steht, danach ein Fahrzeug geändert wird und der ELW sich meldet
- **THEN** zeigt der ELW nach den nächsten Meldungen das geänderte Fahrzeug, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Stammdaten der Org erneut gehen

#### Scenario: ELW zurückgespielt
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, die ein inzwischen geliefertes Fahrzeug noch nicht kannte, und sich meldet
- **THEN** zeigt der ELW dieses Fahrzeug wieder als vom Hub gepflegt
