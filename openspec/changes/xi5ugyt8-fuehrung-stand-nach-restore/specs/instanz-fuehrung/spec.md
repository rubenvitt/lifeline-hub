## ADDED Requirements

### Requirement: Der Austausch übersteht das Zurückspielen einer Sicherung

Wird eine der beiden gekoppelten Instanzen aus einer Sicherung zurückgespielt, SHALL der Austausch
der Führungsakten ohne Eingriff eines Menschen weiterlaufen. Jede Akte, die sich danach an einer
Seite ändert, MUST das Gegenüber mit der nächsten Meldung erreichen. Akten, die die
zurückgespielte Seite mit der Sicherung verloren hat und die das Gegenüber noch kennt, MUST das
Gegenüber ihr erneut übergeben. Das Protokoll der Meldung MUST dafür unverändert bleiben.

#### Scenario: Hub zurückgespielt, neuer Einsatz am Hub
- **WHEN** der Hub aus einer Sicherung von gestern zurückgespielt wird, danach am Hub ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der ELW unter „Einsätze beim Gegenüber“ diesen Einsatz mit „Führung: Hub · Epoche 1“

#### Scenario: Hub zurückgespielt, Akte des ELW ging verloren
- **WHEN** der ELW nach der Sicherung des Hubs einen Einsatz angelegt und gemeldet hat, der Hub dann aus dieser Sicherung zurückgespielt wird und der ELW sich wieder meldet
- **THEN** zeigt der Hub diesen Einsatz des ELW wieder unter „Einsätze beim Gegenüber“

#### Scenario: ELW zurückgespielt, neuer Einsatz am ELW
- **WHEN** der ELW aus einer Sicherung zurückgespielt wird, danach am ELW ein Einsatz der gekoppelten Org angelegt wird und der ELW sich meldet
- **THEN** zeigt der Hub diesen Einsatz mit „Führung: ELW · Epoche 1“, und ein danach am Hub angelegter Einsatz erreicht den ELW mit der nächsten Meldung

#### Scenario: Zurückgespielte Seite mit nachgehender Uhr
- **WHEN** der Hub zurückgespielt wird, seine Uhr hinter dem Zeitpunkt der verlorenen Stände steht und am Hub ein Einsatz angelegt wird, bevor der ELW sich meldet
- **THEN** erreicht dieser Einsatz den ELW mit der nächsten Meldung
