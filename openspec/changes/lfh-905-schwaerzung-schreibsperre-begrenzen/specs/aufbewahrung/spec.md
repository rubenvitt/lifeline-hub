# Spec Delta

## MODIFIED Requirements

### Requirement: Unwiderrufliche Schwärzung

Nach Ablauf der Karenz oder beim Vollzug eines Einsatz-Antrags SHALL das System die
personenbezogenen Daten eines Einsatzes nach der Klassifikation schwärzen, und zwar in einem
einzigen atomaren Vorgang zusammen mit dem Zeitstempel `geschwaerzt_at` und einem
System-Eintrag im ETB. Stornierte Zeilen MUST eingeschlossen sein. Scheitert ein Teil, MUST
nichts geschwärzt sein. Datei-Anhänge MUST in diesem Vorgang unerreichbar werden; ihre Inhalte
entfernt das System danach nach „Entfernung der Datei-Inhalte in Einzelschritten“. Die
Schwärzung MUST idempotent sein. Erhalten bleiben MUST das
operative Skelett: Einsatzkopf ohne Meldebild und Ort, ETB im Wortlaut mit intakten Verweisen,
Registriernummern, Triage- und Statuskategorien. Das Skelett bleibt bis zu seiner endgültigen
Löschung erhalten, ohne Skelett-Frist der Organisation unbegrenzt. Eine Rücknahme MUST es nicht
geben.

#### Scenario: Skelett nach der Schwärzung
- **WHEN** ein Einsatz mit Personen, Tieren und Schäden geschwärzt ist
- **THEN** tragen die Personen keine Namen, Kontakte, Adressen oder Notizen mehr
- **AND** tragen sie weiter Registriernummer, Status und Sichtungskategorie
- **AND** sind alle ETB-Einträge mit laufender Nummer und Berichtigungsverweis erhalten
- **AND** meldet die Fremdschlüsselprüfung der Datenbank keinen Verstoß

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf einen bereits geschwärzten Einsatz erneut antrifft, dessen Skelett-Frist nicht abgelaufen ist
- **THEN** ändert er nichts und schreibt keinen Eintrag

#### Scenario: Vollzug eines Einsatz-Antrags
- **WHEN** ein Einsatz-Antrag für einen nicht vorgemerkten Einsatz vollzogen wird
- **THEN** trägt der Einsatz dasselbe Skelett wie nach einer Schwärzung nach Ablauf der Karenz
- **AND** sind Vormerkung und `geschwaerzt_at` gesetzt

#### Scenario: Anhänge zwischen Schwärzung und Entfernung
- **WHEN** die atomare Schwärzung eines Einsatzes oder der Kategorie `anhaenge` festgeschrieben ist und die Datei-Inhalte noch nicht entfernt sind
- **THEN** führt kein Eintrag, keine Nachricht und keine Modulansicht den Anhang mehr auf
- **AND** liefert der Abruf des Anhangs 404

### Requirement: Physische Entfernung geschwärzter Werte

Nach einer erfolgreichen Schwärzung samt Entfernung ihrer Datei-Inhalte MUST kein geschwärzter
Wert mehr als Bytefolge in der Datenbankdatei oder ihrem Write-Ahead-Log stehen. Das gilt für
jede Scrub-Spalte und für jede Zeile, die die Schwärzung löscht, Datei-Anhänge eingeschlossen.
Kann der Rückschrieb des Logs nicht sofort vollständig erfolgen, etwa weil eine andere
Verbindung liest, MUST das System ihn in jedem folgenden Purge-Lauf erneut versuchen, bis er
gelingt, auch über einen Neustart hinweg.

#### Scenario: Gepflanzter Klartext nach der Schwärzung
- **WHEN** ein Einsatz mit einem eindeutigen Klartext in einer Scrub-Spalte und in einem Datei-Anhang geschwärzt wird
- **THEN** kommt der Klartext weder in der Datenbankdatei noch im Write-Ahead-Log als Bytefolge vor

#### Scenario: Rückschrieb blockiert
- **WHEN** der Rückschrieb des Logs nach einer Schwärzung wegen eines aktiven Lesevorgangs unvollständig bleibt und der Lesevorgang danach endet
- **THEN** führt der nächste Purge-Lauf ihn vollständig aus
- **AND** kommt der Klartext danach in keiner der beiden Dateien vor

#### Scenario: Gelöschte Zeilen außerhalb der Schwärzung
- **WHEN** im laufenden Betrieb eine Zeile gelöscht oder ein Wert überschrieben wird
- **THEN** überschreibt die Datenbank den freigewordenen Platz, statt die alten Bytes stehen zu lassen

## ADDED Requirements

### Requirement: Entfernung der Datei-Inhalte in Einzelschritten

Nach der Schwärzung eines Einsatzes oder seiner Kategorie `anhaenge` SHALL der Purge-Lauf jeden
betroffenen Anhang in einem eigenen Schreibvorgang löschen, noch im selben Lauf und vor dem
Rückschrieb des Logs. Kein Schreibvorgang der Schwärzung MUST Platz von mehr als einem Anhang
freigeben, damit andere Schreibende höchstens so lange warten, wie das Nullen eines Anhangs
dauert. Bleibt ein Anhang übrig, MUST jeder folgende Lauf ihn löschen, auch nach einem Neustart.

#### Scenario: Viele Anhänge
- **WHEN** ein Einsatz mit 20 Anhängen zu je 1 MB geschwärzt wird
- **THEN** ist nach dem Purge-Lauf keiner der Anhänge mehr vorhanden
- **AND** wächst das Write-Ahead-Log in keinem Schreibvorgang um mehr als den Umfang eines Anhangs plus Verwaltungsseiten

#### Scenario: Abbruch nach der atomaren Schwärzung
- **WHEN** die atomare Schwärzung festgeschrieben ist, die Anhänge aber noch vorhanden sind, und danach ein Purge-Lauf startet
- **THEN** löscht dieser Lauf die verbliebenen Anhänge einzeln
- **AND** kommt ihr Inhalt danach weder in der Datenbankdatei noch im Write-Ahead-Log vor

#### Scenario: Endgültige Löschung wartet auf den Nachlauf
- **WHEN** die Skelett-Frist eines geschwärzten Einsatzes abgelaufen ist, an dem noch Anhänge zur Entfernung stehen
- **THEN** löscht der Purge-Lauf erst die Anhänge einzeln und danach das Skelett

#### Scenario: Anhänge anderer Einsätze bleiben
- **WHEN** ein Einsatz geschwärzt wird und ein anderer, nicht geschwärzter Einsatz Anhänge trägt
- **THEN** bleiben die Anhänge des anderen Einsatzes unverändert
