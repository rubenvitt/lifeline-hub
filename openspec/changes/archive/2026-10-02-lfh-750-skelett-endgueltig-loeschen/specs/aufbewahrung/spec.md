# Spec Delta

## ADDED Requirements

### Requirement: Frist für die endgültige Löschung

Eine Organisation SHALL eine Skelett-Frist in Tagen ab Abschluss festlegen können, von 1 bis
36500 Tagen. Ohne Festlegung MUST das Skelett unbegrenzt erhalten bleiben. Je Einsatz gibt es
keine eigene Skelett-Frist. Nur ein System-Admin MUST sie ändern dürfen. Das erstmalige Setzen
und jede Verkürzung MUST ausdrücklich bestätigt werden, sonst antwortet das System mit 409 und
ändert nichts. Ein Wert außerhalb des Bereichs MUST 400 liefern.

#### Scenario: Ohne Skelett-Frist
- **WHEN** die Organisation keine Skelett-Frist festgelegt hat und ein geschwärzter Einsatz 20 Jahre alt ist
- **THEN** bleibt sein Skelett erhalten

#### Scenario: Erstmals setzen ohne Bestätigung
- **WHEN** ein System-Admin eine Skelett-Frist setzt, wo bisher keine war, ohne Bestätigung
- **THEN** antwortet das System mit 409, und die Einstellung bleibt leer

#### Scenario: Verlängern ohne Bestätigung
- **WHEN** ein System-Admin eine bestehende Skelett-Frist von 3650 auf 4000 Tage verlängert
- **THEN** gilt die neue Frist ohne Bestätigung

#### Scenario: Aufheben
- **WHEN** ein System-Admin die Skelett-Frist leert
- **THEN** gilt sie ohne Bestätigung nicht mehr, und kein weiteres Skelett wird gelöscht

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft die Skelett-Frist ändern will
- **THEN** antwortet das System mit 403

### Requirement: Endgültige Löschung des Skeletts

Das System SHALL einen geschwärzten Einsatz endgültig löschen, sobald seine Skelett-Frist
abgelaufen ist. Fällig ist er am späteren von zwei Zeitpunkten: Abschluss plus Skelett-Frist
der Organisation und Schwärzung. Die Löschung MUST jede Zeile des Einsatzes entfernen, ETB und
Anhänge eingeschlossen, und MUST unumkehrbar sein. Ein nicht geschwärzter oder aktiver Einsatz
MUST nie gelöscht werden. Die entfernten Werte MUST danach weder in der Datenbankdatei noch in
ihrem Write-Ahead-Log stehen.

#### Scenario: Fällig
- **WHEN** eine Organisation eine Skelett-Frist von 3650 Tagen hat und ein geschwärzter Einsatz vor 3650 Tagen abgeschlossen wurde
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf samt ETB, Personen, Tieren, Schäden und Anhängen gelöscht

#### Scenario: Frist abgelaufen, aber noch nicht geschwärzt
- **WHEN** die Skelett-Frist eines vorgemerkten, noch nicht geschwärzten Einsatzes abgelaufen ist
- **THEN** löscht der Purge-Lauf ihn nicht endgültig
- **AND** löscht er ihn frühestens in dem Lauf, der ihn schwärzt

#### Scenario: Noch nicht fällig
- **WHEN** die Skelett-Frist eines geschwärzten Einsatzes in der Zukunft liegt
- **THEN** bleibt sein Skelett erhalten

#### Scenario: Fremde Organisation
- **WHEN** nur Organisation A eine Skelett-Frist hat und beide Organisationen gleich alte geschwärzte Einsätze haben
- **THEN** löscht der Purge-Lauf nur die Einsätze von A

#### Scenario: Keine Altbytes
- **WHEN** ein geschwärzter Einsatz mit einem eindeutigen Text im ETB endgültig gelöscht wird
- **THEN** kommt der Text weder in der Datenbankdatei noch im Write-Ahead-Log als Bytefolge vor

#### Scenario: Keine Wiedervergabe
- **WHEN** der Einsatz mit der höchsten ID und der höchsten laufenden Nummer seines Jahres endgültig gelöscht und danach ein Einsatz in demselben Jahr angelegt wird
- **THEN** erhält der neue Einsatz weder die ID noch die Einsatznummer des gelöschten

#### Scenario: Rückspielen einer älteren Sicherung
- **WHEN** eine Sicherung von vor der endgültigen Löschung zurückgespielt wird und die Skelett-Frist der Organisation unverändert ist
- **THEN** ist der Einsatz nach dem nächsten Purge-Lauf wieder gelöscht

### Requirement: Löschprotokoll

Jede endgültige Löschung SHALL im selben atomaren Vorgang eine Zeile im Löschprotokoll der
Organisation schreiben: Einsatz-ID, Einsatznummer, Abschluss, Schwärzung, Löschzeitpunkt,
angewandte Skelett-Frist in Tagen und Akteur. Bezeichnung, Stichwort, Ort und jeder ETB-Text
MUST fehlen. Der Akteur MUST nach derselben Reihenfolge bestimmt werden wie beim übrigen
Purge-Audit. Ist keiner auffindbar, MUST die Löschung unterbleiben und im nächsten Lauf erneut
versucht werden.

#### Scenario: Protokollzeile nach der Löschung
- **WHEN** ein geschwärzter Einsatz endgültig gelöscht wird
- **THEN** steht im Löschprotokoll seiner Organisation genau eine Zeile mit seiner Einsatznummer, seinen Zeitpunkten und der angewandten Frist
- **AND** enthält die Zeile weder Bezeichnung noch Stichwort

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz erhalten, und keine Protokollzeile entsteht
- **AND** wird er im nächsten Lauf gelöscht, sobald ein Akteur auffindbar ist

#### Scenario: Scheitern der Löschung
- **WHEN** das Schreiben der Protokollzeile scheitert
- **THEN** ist der Einsatz nicht gelöscht

## MODIFIED Requirements

### Requirement: Unwiderrufliche Schwärzung

Nach Ablauf der Karenz SHALL das System die personenbezogenen Daten eines Einsatzes nach der
Klassifikation schwärzen, und zwar in einem einzigen atomaren Vorgang zusammen mit dem
Zeitstempel `geschwaerzt_at` und einem System-Eintrag im ETB. Stornierte Zeilen MUST
eingeschlossen sein. Scheitert ein Teil, MUST nichts geschwärzt sein. Die Schwärzung MUST
idempotent sein. Erhalten bleiben MUST das operative Skelett: Einsatzkopf ohne Meldebild und
Ort, ETB im Wortlaut mit intakten Verweisen, Registriernummern, Triage- und
Statuskategorien. Das Skelett bleibt bis zu seiner endgültigen Löschung erhalten, ohne
Skelett-Frist der Organisation unbegrenzt. Eine Rücknahme MUST es nicht geben.

#### Scenario: Skelett nach der Schwärzung
- **WHEN** ein Einsatz mit Personen, Tieren und Schäden geschwärzt ist
- **THEN** tragen die Personen keine Namen, Kontakte, Adressen oder Notizen mehr
- **AND** tragen sie weiter Registriernummer, Status und Sichtungskategorie
- **AND** sind alle ETB-Einträge mit laufender Nummer und Berichtigungsverweis erhalten
- **AND** meldet die Fremdschlüsselprüfung der Datenbank keinen Verstoß

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf einen bereits geschwärzten Einsatz erneut antrifft, dessen Skelett-Frist nicht abgelaufen ist
- **THEN** ändert er nichts und schreibt keinen Eintrag

### Requirement: Auslöser der Aufbewahrung

Das System SHALL die Aufbewahrung ausschließlich über diese Auslöser bewegen: den Abschluss
(Frist aus der Dauer), die manuelle Frist, einen periodischen Purge-Lauf höchstens alle
10 Minuten (Vormerkung, Schwärzung und endgültige Löschung) und das Wiederherstellen durch den
Org-Admin. Einen manuellen Sofort-Auslöser für die Schwärzung oder die endgültige Löschung MUST
es in dieser Fassung nicht geben.

#### Scenario: Fristablauf ohne Eingriff
- **WHEN** die Frist eines abgeschlossenen Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf vorgemerkt

#### Scenario: Skelett-Frist ohne Eingriff
- **WHEN** die Skelett-Frist eines geschwärzten Einsatzes abläuft und niemand eingreift
- **THEN** ist der Einsatz spätestens nach dem nächsten Purge-Lauf endgültig gelöscht

### Requirement: Lückenloser Audit im ETB

Jede Mutation der Aufbewahrung (Frist aus Dauer, manuelle Frist, Vormerkung, Schwärzung,
Wiederherstellen) SHALL im selben atomaren Vorgang einen System-Eintrag im ETB des Einsatzes
schreiben. Bei einer handelnden Person MUST sie als Erfasser stehen. Beim Purge-Lauf MUST der
Erfasser in dieser Reihenfolge bestimmt werden: die Person, die den Einsatz abgeschlossen hat,
dann eine Einsatzleitung des Einsatzes, dann ein System-Admin der Organisation des Einsatzes.
Ist keiner auffindbar, MUST die Mutation unterbleiben, als Fehler protokolliert und im
nächsten Lauf erneut versucht werden. Eine Aufbewahrungs-Mutation ohne ETB-Eintrag MUST es
nicht geben. Einzige Ausnahme ist die endgültige Löschung: Sie entfernt das ETB mit und
schreibt ihren Audit stattdessen ins Löschprotokoll der Organisation.

#### Scenario: Ersatzakteur
- **WHEN** ein fälliger Einsatz keine abschließende Person und keine Einsatzleitung hat, seine Organisation aber einen System-Admin
- **THEN** wird er vorgemerkt, und der System-Eintrag trägt den System-Admin als Erfasser

#### Scenario: Kein Akteur auffindbar
- **WHEN** ein fälliger Einsatz weder abschließende Person noch Einsatzleitung hat und seine Organisation keinen System-Admin
- **THEN** bleibt der Einsatz unvorgemerkt, und kein ETB-Eintrag entsteht
- **AND** wird der Einsatz im nächsten Lauf vorgemerkt, sobald ein Akteur auffindbar ist

#### Scenario: Endgültige Löschung
- **WHEN** ein geschwärzter Einsatz endgültig gelöscht wird
- **THEN** entsteht kein ETB-Eintrag, aber eine Zeile im Löschprotokoll der Organisation
