## ADDED Requirements

### Requirement: Stammdaten-Änderungen überstehen das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer Instanz aus einer Sicherung SHALL jede danach an der erreichten Seite
geänderte Zeile die meldende Seite ohne Eingriff mit den nächsten Meldungen erreichen. Geht ihre
Uhr nach, MUST sie die Stammdaten der Org einmal ganz neu liefern. Ausgenommen: Bei nachgehender
Uhr oder ohne Neustart geschehen vor der ersten Meldung mindestens so viele Änderungen, wie
verloren gingen.

#### Scenario: Hub zurückgespielt, Fahrzeug geändert
- **WHEN** der Hub aus einer Sicherung zurückgespielt und neu gestartet wird, danach ein Admin am Hub den Funkrufnamen eines verteilten Fahrzeugs ändert und ein Fahrzeug anlegt und der ELW sich meldet
- **THEN** zeigt der ELW den neuen Funkrufnamen und das neue Fahrzeug

#### Scenario: Zurückgespielter Hub mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Änderungen steht, danach ein Fahrzeug geändert wird und der ELW sich meldet
- **THEN** zeigt der ELW nach den nächsten Meldungen das geänderte Fahrzeug, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Stammdaten der Org erneut gehen

#### Scenario: ELW zurückgespielt
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, die ein inzwischen geliefertes Fahrzeug noch nicht kannte, und sich meldet
- **THEN** zeigt der ELW dieses Fahrzeug wieder als vom Hub gepflegt
