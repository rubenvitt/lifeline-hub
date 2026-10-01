# Spec Delta

## ADDED Requirements

### Requirement: Physische Entfernung geschwärzter Werte

Nach einer erfolgreichen Schwärzung MUST kein geschwärzter Wert mehr als Bytefolge in der
Datenbankdatei oder ihrem Write-Ahead-Log stehen. Das gilt für jede Scrub-Spalte und für jede
Zeile, die die Schwärzung löscht, Datei-Anhänge eingeschlossen. Kann der Rückschrieb des Logs
nicht sofort vollständig erfolgen, etwa weil Lesende aktiv sind, MUST ihn das System spätestens
im nächsten Purge-Lauf nachholen.

#### Scenario: Gepflanzter Klartext nach der Schwärzung
- **WHEN** ein Einsatz mit einem eindeutigen Klartext in einer Scrub-Spalte und in einem Datei-Anhang geschwärzt wird
- **THEN** kommt der Klartext weder in der Datenbankdatei noch im Write-Ahead-Log als Bytefolge vor

#### Scenario: Rückschrieb blockiert
- **WHEN** der Rückschrieb des Logs nach einer Schwärzung wegen eines aktiven Lesevorgangs unvollständig bleibt
- **THEN** führt der nächste Purge-Lauf ihn vollständig aus
- **AND** kommt der Klartext danach in keiner der beiden Dateien vor

#### Scenario: Gelöschte Zeilen außerhalb der Schwärzung
- **WHEN** im laufenden Betrieb eine Zeile gelöscht oder ein Wert überschrieben wird
- **THEN** überschreibt die Datenbank den freigewordenen Platz, statt die alten Bytes stehen zu lassen

### Requirement: Altbestand vor der physischen Entfernung

Eine Datenbank, die vor Einführung der physischen Entfernung betrieben wurde, MUST beim ersten
Serverstart danach genau einmal so neu aufgebaut werden, dass freigewordener Platz keine alten
Bytes mehr trägt. Scheitert der Neuaufbau, MUST der Server trotzdem starten, den Fehler melden
und den Neuaufbau beim nächsten Start erneut versuchen.

#### Scenario: Erster Start nach dem Update
- **WHEN** der Server auf einer Datenbank startet, in der ein früher geschwärzter Wert noch in freigewordenem Platz steht
- **THEN** kommt dieser Wert nach dem Start nicht mehr in der Datenbankdatei vor

#### Scenario: Weitere Starts
- **WHEN** der Server ein zweites Mal startet
- **THEN** baut er die Datenbank nicht erneut neu auf

### Requirement: Rückspielen einer Sicherung von vor der Schwärzung

Wird eine Sicherung zurückgespielt, in der ein inzwischen geschwärzter Einsatz bereits zur
Löschung vorgemerkt, aber noch ungeschwärzt ist, MUST das System ihn ohne Eingriff erneut
schwärzen, spätestens im nächsten Purge-Lauf nach Ablauf seiner Karenz. Die Vormerkung aus der
Sicherung MUST dabei gelten, die Karenz beginnt nicht neu.

#### Scenario: Restore nach Ablauf der Karenz
- **WHEN** eine Sicherung zurückgespielt wird, in der ein vorgemerkter Einsatz mit inzwischen abgelaufener Karenz noch ungeschwärzt ist
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf geschwärzt
