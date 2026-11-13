## ADDED Requirements

### Requirement: Schlüssel und Widerrufe überstehen das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer gekoppelten Instanz aus einer Sicherung SHALL die Nachlieferung der
Unterschriftsschlüssel ohne Eingriff weiterlaufen. Jeder danach gegengezeichnete oder widerrufene
Schlüssel MUST das Gegenüber mit den nächsten Meldungen erreichen, auch wenn die Uhr der
zurückgespielten Seite nachgeht. Ausgenommen ist eine nachgehende Uhr, bei der vor der ersten
Meldung mehr Stände vergeben werden, als verloren gingen.

#### Scenario: Hub zurückgespielt, neuer Schlüssel
- **WHEN** der Hub aus einer Sicherung zurückgespielt wird, danach Admin C einen Unterschriftsschlüssel registriert, Admin A ihn gegenzeichnet und der ELW sich meldet
- **THEN** führt der ELW den Schlüssel von C als „wartet auf Bestätigung“

#### Scenario: Hub zurückgespielt, Widerruf
- **WHEN** der Hub aus einer Sicherung zurückgespielt wird, danach den Schlüssel von Admin B widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel von B als widerrufen und nimmt keine Unterschrift damit mehr an

#### Scenario: Zurückgespielter Hub mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Stände steht, er danach einen Schlüssel widerruft und der ELW sich meldet
- **THEN** zeigt der ELW den Schlüssel nach den nächsten Meldungen als widerrufen, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Schlüssel der Org erneut gehen

#### Scenario: ELW zurückgespielt
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, die einen inzwischen nachgelieferten Schlüssel noch nicht kannte, und sich meldet
- **THEN** führt der ELW diesen Schlüssel wieder, als „wartet auf Bestätigung“

### Requirement: Ein anderer Schlüssel unter bekannter Kennung ersetzt den alten

Liefert das Gegenüber unter einer Kennung, die die empfangende Instanz schon einem Schlüssel
zugeordnet hat, einen anderen Schlüssel, SHALL die empfangende Instanz den bisherigen als
widerrufen führen. Den gelieferten MUST sie wie jeden neuen Schlüssel prüfen und übernehmen.
Ein zurückgewiesener bisheriger Schlüssel MUST zurückgewiesen bleiben.

#### Scenario: Zurückgespielter Hub vergibt eine Kennung neu
- **WHEN** der Hub zurückgespielt wird, der ELW den danach verlorenen Schlüssel von B schon kannte und der Hub dem neuen, von A gegengezeichneten Schlüssel von C dieselbe Kennung gibt
- **THEN** zeigt der ELW nach seiner nächsten Meldung den Schlüssel von B als widerrufen und den von C als „wartet auf Bestätigung“

#### Scenario: Ersatz ohne gültige Gegenzeichnung
- **WHEN** das Gegenüber unter der Kennung eines bekannten Schlüssels einen anderen Schlüssel ohne gültige Gegenzeichnung liefert
- **THEN** führt der ELW den bisherigen als widerrufen und verwirft den gelieferten wie die Unterschrift eines unbekannten Schlüssels
