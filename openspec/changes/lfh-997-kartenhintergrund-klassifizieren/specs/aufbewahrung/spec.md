## ADDED Requirements

### Requirement: Bild-Hintergründe der Lagekarte

Die Klassifikation SHALL jedes Bild, das als Hintergrund der Lagekarte hochgeladen wurde, als
Scrub führen, mit allen Spalten: Bildinhalt, Dateiname, Prüfsumme, Größe, Lage und Darstellung.
Das gilt unabhängig davon, ob das Bild ein Luftbild, ein Drohnenbild oder ein gezeichneter
Plan ist. Mit der Schwärzung des Einsatzes oder seiner Kategorie `anhaenge` MUST das Bild
nicht mehr abrufbar sein, weder in der Liste der Lagekarte noch als Download, und der Nachlauf
MUST es danach vollständig löschen. Bilder eines Einsatzes, der vor dieser Anforderung
geschwärzt wurde, MUST der nächste Purge-Lauf ebenso entfernen.

#### Scenario: Drohnenbild nach der Schwärzung des Einsatzes
- **WHEN** ein Einsatz mit einem hochgeladenen Luftbild als Kartenhintergrund geschwärzt wird und der Purge-Lauf endet
- **THEN** gibt es zu diesem Einsatz kein Bild der Lagekarte mehr
- **AND** kommt der Bildinhalt weder in der Datenbankdatei noch im Write-Ahead-Log vor

#### Scenario: Zwischen Schwärzung und Nachlauf
- **WHEN** die atomare Schwärzung festgeschrieben ist und der Nachlauf das Bild noch nicht gelöscht hat
- **THEN** liefert die Liste der Bilder dieses Einsatzes das Bild nicht
- **AND** antwortet der Download des Bilds mit 404

#### Scenario: Bestand aus der Zeit vor der Änderung
- **WHEN** der erste Purge-Lauf nach dem Update einen bereits geschwärzten Einsatz antrifft, dessen Kartenhintergrund noch gespeichert ist
- **THEN** löscht er das Bild einzeln
- **AND** bleiben Bilder nicht geschwärzter Einsätze unverändert

#### Scenario: Klassifikation ist festgeschrieben
- **WHEN** die Testsuite die Klassifikation prüft
- **THEN** führt sie jede Spalte der Bild-Hintergründe als Scrub mit Zeilenlöschung in Einzelschritten und Zuordnung zur Kategorie `anhaenge`

## MODIFIED Requirements

### Requirement: Physische Entfernung geschwärzter Werte

Nach einer erfolgreichen Schwärzung samt Entfernung ihrer Datei-Inhalte MUST kein geschwärzter
Wert mehr als Bytefolge in der Datenbankdatei oder ihrem Write-Ahead-Log stehen. Das gilt für
jede Scrub-Spalte und für jede Zeile, die die Schwärzung löscht, Datei-Anhänge und Bild-Hintergründe
der Lagekarte eingeschlossen.
Kann der Rückschrieb des Logs nicht sofort vollständig erfolgen, etwa weil eine andere
Verbindung liest, MUST das System ihn in jedem folgenden Purge-Lauf erneut versuchen, bis er
gelingt, auch über einen Neustart hinweg.

#### Scenario: Gepflanzter Klartext nach der Schwärzung
- **WHEN** ein Einsatz mit einem eindeutigen Klartext in einer Scrub-Spalte, in einem Datei-Anhang und in einem Bild der Lagekarte geschwärzt wird
- **THEN** kommt der Klartext weder in der Datenbankdatei noch im Write-Ahead-Log als Bytefolge vor

#### Scenario: Rückschrieb blockiert
- **WHEN** der Rückschrieb des Logs nach einer Schwärzung wegen eines aktiven Lesevorgangs unvollständig bleibt und der Lesevorgang danach endet
- **THEN** führt der nächste Purge-Lauf ihn vollständig aus
- **AND** kommt der Klartext danach in keiner der beiden Dateien vor

#### Scenario: Gelöschte Zeilen außerhalb der Schwärzung
- **WHEN** im laufenden Betrieb eine Zeile gelöscht oder ein Wert überschrieben wird
- **THEN** überschreibt die Datenbank den freigewordenen Platz, statt die alten Bytes stehen zu lassen

### Requirement: Entfernung der Datei-Inhalte in Einzelschritten

Nach der Schwärzung eines Einsatzes oder seiner Kategorie `anhaenge` SHALL der Purge-Lauf jeden
betroffenen Anhang und jedes betroffene Bild der Lagekarte in einem eigenen Schreibvorgang
löschen, noch im selben Lauf und vor dem Rückschrieb des Logs. Kein Schreibvorgang der
Schwärzung MUST Platz von mehr als einem Anhang oder Bild freigeben, damit andere Schreibende
höchstens so lange warten, wie das Nullen eines Anhangs oder Bilds dauert. Bleibt ein Anhang
oder Bild übrig, MUST jeder folgende Lauf es löschen, auch nach einem Neustart.

#### Scenario: Viele Anhänge
- **WHEN** ein Einsatz mit 6 Anhängen zu je 5 MB geschwärzt wird
- **THEN** ist nach dem Purge-Lauf keiner der Anhänge mehr vorhanden
- **AND** schreibt der atomare Vorgang weniger als 1 MB ins Write-Ahead-Log
- **AND** wird das Write-Ahead-Log nie größer als zwei der Anhänge zusammen

#### Scenario: Viele Bilder der Lagekarte
- **WHEN** ein Einsatz mit 4 Bildern der Lagekarte zu je 5 MB geschwärzt wird
- **THEN** ist nach dem Purge-Lauf keines der Bilder mehr vorhanden
- **AND** schreibt der atomare Vorgang weniger als 1 MB ins Write-Ahead-Log

#### Scenario: Abbruch nach der atomaren Schwärzung
- **WHEN** die atomare Schwärzung festgeschrieben ist, die Anhänge oder Bilder aber noch vorhanden sind, und danach ein Purge-Lauf startet
- **THEN** löscht dieser Lauf die verbliebenen Anhänge und Bilder einzeln
- **AND** kommt ihr Inhalt danach weder in der Datenbankdatei noch im Write-Ahead-Log vor

#### Scenario: Endgültige Löschung wartet auf den Nachlauf
- **WHEN** die Skelett-Frist eines geschwärzten Einsatzes abgelaufen ist, an dem noch Anhänge oder Bilder der Lagekarte zur Entfernung stehen
- **THEN** löscht der Purge-Lauf erst die Anhänge und Bilder einzeln und danach das Skelett

#### Scenario: Anhänge anderer Einsätze bleiben
- **WHEN** ein Einsatz geschwärzt wird und ein anderer, nicht geschwärzter Einsatz Anhänge und Bilder der Lagekarte trägt
- **THEN** bleiben die Anhänge und Bilder des anderen Einsatzes unverändert
