## ADDED Requirements

### Requirement: Der Austausch übersteht das Zurückspielen einer Sicherung

Nach dem Zurückspielen einer gekoppelten Instanz aus einer Sicherung SHALL der Austausch der
Führungsakten ohne Eingriff weiterlaufen: Jede danach geänderte Akte MUST das Gegenüber mit den
nächsten Meldungen erreichen, auch bei mehreren Kopplungen. Ausgenommen ist eine zurückgespielte
Seite mit nachgehender Uhr, die vor ihrer ersten Meldung mehr Stände vergibt, als verloren gingen,
oder deren Gegenstellen verschieden weit quittiert hatten.

#### Scenario: Hub zurückgespielt, neuer Einsatz am Hub
- **WHEN** der Hub aus einer Sicherung von gestern zurückgespielt wird, danach am Hub ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der ELW unter „Einsätze beim Gegenüber“ diesen Einsatz mit „Führung: Hub · Epoche 1“

#### Scenario: ELW zurückgespielt, neuer Einsatz am ELW
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, danach am ELW ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der Hub diesen Einsatz mit „Führung: ELW · Epoche 1“, und ein danach am Hub angelegter Einsatz erreicht den ELW mit der nächsten Meldung

#### Scenario: Zurückgespielte Seite mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Stände steht und am Hub ein Einsatz angelegt wird, bevor der ELW sich meldet
- **THEN** erreicht dieser Einsatz den ELW mit der nächsten Meldung, und die Seite „Instanzkopplung“ am Hub zeigt den Hinweis, dass die Akten erneut gehen

#### Scenario: Zwei Kopplungen am zurückgespielten Hub
- **WHEN** ein Hub mit „ELW 1“ und „ELW 2“ mit nachgehender Uhr zurückgespielt wird, beide gleich weit quittiert hatten, am Hub ein Einsatz einer Org angelegt wird, die nur „ELW 2“ zugeordnet ist, und „ELW 1“ sich zuerst meldet
- **THEN** erreicht der Einsatz „ELW 2“ mit dessen nächster Meldung

### Requirement: Verlorene Führungsakten kommen erneut

Akten, die eine zurückgespielte erreichte Seite mit der Sicherung verloren hat und die die meldende
Seite noch kennt, SHALL die meldende Seite ihr mit den nächsten Meldungen erneut übergeben, auch wenn
sie während des Ausfalls weitere Akten geändert hat. Ausgenommen sind eine Sicherung von vor der
ersten Übernahme der erreichten Seite und eine Gegenstelle älteren Stands. Das Protokoll der Meldung
MUST dafür nur additiv wachsen.

#### Scenario: Hub zurückgespielt, Akte des ELW ging verloren
- **WHEN** der ELW nach der Sicherung des Hubs einen Einsatz angelegt und gemeldet hat, der Hub dann aus dieser Sicherung zurückgespielt wird und der ELW sich wieder meldet
- **THEN** zeigt der Hub diesen Einsatz des ELW nach den nächsten Meldungen wieder unter „Einsätze beim Gegenüber“

#### Scenario: ELW hat während des Ausfalls geändert
- **WHEN** der Hub zurückgespielt wird und der ELW in dieser Zeit einen weiteren Einsatz anlegt, sodass schon seine erste Meldung danach eine neue Akte trägt
- **THEN** zeigt der Hub nach den nächsten Meldungen sowohl den neuen Einsatz als auch den verlorenen

#### Scenario: Antwort auf die erste Meldung geht verloren
- **WHEN** der Hub zurückgespielt wird, der ELW in dieser Zeit einen weiteren Einsatz anlegt und die Antwort auf seine erste Meldung danach ihn nicht erreicht
- **THEN** zeigt der Hub nach den nächsten Meldungen trotzdem den verlorenen Einsatz wieder
