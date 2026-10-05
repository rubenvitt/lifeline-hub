## ADDED Requirements

### Requirement: Schwärzungsstand im Einsatzkopf

Einsatzkopf und Einsatzliste SHALL je Einsatz die Zahl `teilschwaerzungen` tragen: die Zahl der
vollzogenen Personen-Anträge plus die Zahl der geschwärzten Datenkategorien dieses Einsatzes. Ist
die Zahl 0, MUST das Feld fehlen. Die Zahl MUST nie sinken. Sie MUST keine Kennung, keinen
Zeitpunkt und keine Personenart nennen.

#### Scenario: Person geschwärzt
- **WHEN** an Einsatz 7 ein Personen-Antrag vollzogen wurde
- **THEN** trägt der Kopf von Einsatz 7 `teilschwaerzungen: 1`, und der Eintrag von Einsatz 7 in der Einsatzliste ebenso

#### Scenario: Nichts geschwärzt
- **WHEN** an Einsatz 8 weder ein Personen-Antrag vollzogen noch eine Kategorie geschwärzt wurde
- **THEN** fehlt `teilschwaerzungen` im Kopf von Einsatz 8

### Requirement: Ereignis aus dem Purge-Lauf

Neben den Nutzeraktionen SHALL der Purge-Lauf das Ereignis `einsatz` verteilen, nach dem Commit
- eines Vollzugs eines Personen- oder Einsatz-Antrags, der etwas geschwärzt hat,
- einer Kategorie-Schwärzung,
- einer Vormerkung des Einsatzes nach Ablauf seiner Aufbewahrungsfrist.

Die Nutzlast MUST wie bei jeder anderen Quelle nur die Einsatzkennung tragen. Ein Lauf ohne
Wirkung MUST kein Ereignis verteilen.

#### Scenario: Vormerkung sperrt einen offenen Einsatz
- **WHEN** ein Tab Einsatz 7 zeigt und der Purge-Lauf Einsatz 7 nach Ablauf seiner Frist vormerkt
- **THEN** erhält der Tab ein Ereignis `einsatz`, ruft den Kopf ab, erhält 404 und löscht alle vorgehaltenen Daten von Einsatz 7

#### Scenario: Schwärzung nach der Karenz
- **WHEN** der Purge-Lauf einen seit 30 Tagen vorgemerkten Einsatz schwärzt
- **THEN** verteilt er kein Ereignis `einsatz`
