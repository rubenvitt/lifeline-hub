# aufbewahrung Specification

## Purpose
Personenbezogene Daten abgeschlossener Einsätze werden nach einer festgelegten Frist gesperrt
und nach einer Karenz unwiderruflich geschwärzt. Die rechtsverbindliche Einsatzdokumentation
bleibt dabei als pseudonymes Skelett erhalten, bis eine von der Organisation festgelegte
Skelett-Frist abläuft; dann wird der Einsatz endgültig gelöscht. Jeder Schritt bis zur
Schwärzung steht nachvollziehbar im Einsatztagebuch, die endgültige Löschung im Löschprotokoll
der Organisation.

## Requirements

### Requirement: Datenkategorien über eine zentrale Klassifikation

Das System SHALL für jede Spalte jeder Tabelle, die an einem Einsatz hängt, genau eine
Klassifikation führen: **Scrub** (personenbezogen, wird geschwärzt, mit einer Strategie:
leeren, Platzhalter, Platzhalter nur wenn gesetzt, Platzhalter mit Zeilenkennung, Zeile
löschen) oder **Retain** (bleibt erhalten, mit Begründung). Diese Klassifikation MUST die
einzige Quelle sein, aus der die Schwärzung ihre Anweisungen bildet. Eine einsatzbezogene
Spalte oder Tabelle ohne Klassifikation MUST die Testsuite scheitern lassen. Ein
Klassifikationseintrag ohne zugehörige Spalte MUST die Testsuite ebenfalls scheitern lassen.

#### Scenario: Neue Spalte ohne Klassifikation
- **WHEN** eine Migration einer einsatzbezogenen Tabelle eine Spalte hinzufügt und die Klassifikation sie nicht führt
- **THEN** scheitert die Testsuite und nennt Tabelle und Spalte

#### Scenario: Schwärzung folgt der Klassifikation
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** ist jede als Scrub geführte Spalte nach ihrer Strategie behandelt
- **AND** trägt jede als Retain geführte Spalte ihren vorherigen Wert

### Requirement: Frist aus der Aufbewahrungsdauer beim Abschluss

Beim Abschluss eines Einsatzes SHALL das System die Aufbewahrungsfrist `retention_bis` als
Abschlusszeitpunkt plus wirksamer Aufbewahrungsdauer in Tagen setzen. Die Dauer des Einsatzes
MUST dabei vor der Vorgabe der Organisation stehen. Ist keine Dauer festgelegt, MUST keine
Frist entstehen. Eine bereits gesetzte Frist MUST der Abschluss unverändert lassen. Setzt der
Abschluss eine Frist, MUST im selben Vorgang ein System-Eintrag im ETB entstehen, der Frist
und Dauer nennt.

#### Scenario: Dauer am Einsatz
- **WHEN** ein Einsatz mit Aufbewahrungsdauer 30 Tage abgeschlossen wird
- **THEN** liegt seine Frist 30 Tage nach dem Abschlusszeitpunkt
- **AND** enthält das ETB einen System-Eintrag mit Frist und Dauer

#### Scenario: Keine Dauer
- **WHEN** ein Einsatz ohne Dauer abgeschlossen wird und auch die Organisation keine Vorgabe hat
- **THEN** hat er keine Frist

#### Scenario: Manuelle Frist bleibt
- **WHEN** ein Einsatz mit bereits gesetzter Frist abgeschlossen wird
- **THEN** bleibt die gesetzte Frist unverändert

### Requirement: Manuelle Frist

Einsatzleitung und System-Admin SHALL die Frist eines Einsatzes setzen, ändern und aufheben
können, vor und nach dem Abschluss. Andere Personen MUST 403 erhalten. Eine Verkürzung MUST
ausdrücklich bestätigt werden, sonst antwortet das System mit 409. Als Verkürzung gilt ein
früherer Zeitpunkt oder das erstmalige Setzen einer Frist an einem Einsatz ohne Frist. Eine
unveränderte Frist MUST ohne Schreibvorgang und ohne ETB-Eintrag bleiben. Jede wirksame
Änderung MUST einen System-Eintrag im ETB mit altem und neuem Wert schreiben. An einem zur
Löschung vorgemerkten Einsatz, dessen Karenz noch läuft, MUST die Änderung mit 422 abgewiesen
werden, mit dem Hinweis auf das Wiederherstellen. Ist die Karenz abgelaufen, der Einsatz aber
noch nicht geschwärzt, MUST sie mit 409 abgewiesen werden, ohne Hinweis auf das
Wiederherstellen, denn auch das ist dann ausgeschlossen. An einem geschwärzten Einsatz MUST sie
mit 409 abgewiesen werden.

#### Scenario: Verlängern ohne Bestätigung
- **WHEN** die Einsatzleitung die Frist eines abgeschlossenen Einsatzes auf einen späteren Zeitpunkt setzt
- **THEN** gilt die neue Frist, und das ETB nennt alten und neuen Wert

#### Scenario: Verkürzen ohne Bestätigung
- **WHEN** eine Frist auf einen früheren Zeitpunkt gesetzt wird, ohne Bestätigung
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Vorgemerkter Einsatz
- **WHEN** an einem zur Löschung vorgemerkten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 422, und Frist und Vormerkung bleiben unverändert

#### Scenario: Karenz abgelaufen, noch nicht geschwärzt
- **WHEN** an einem vorgemerkten Einsatz, dessen Karenz abgelaufen ist, die Frist geändert werden soll
- **THEN** antwortet das System mit 409, und Frist und Vormerkung bleiben unverändert

#### Scenario: Geschwärzter Einsatz
- **WHEN** an einem geschwärzten Einsatz die Frist geändert werden soll
- **THEN** antwortet das System mit 409

### Requirement: Lesesperre nach Fristablauf

Ein abgeschlossener Einsatz, dessen Frist abgelaufen ist oder der zur Löschung vorgemerkt
ist, SHALL über die regulären Einsatz-Routen für niemanden lesbar sein, auch nicht für den
System-Admin. Die Antwort MUST 403 sein. Ein aktiver Einsatz MUST durch eine Frist nie
gesperrt werden. Einzige Leseausnahme ist die Archivakte der Capability
`aufbewahrung-archiv`.

#### Scenario: Frist abgelaufen, noch nicht vorgemerkt
- **WHEN** der System-Admin einen abgeschlossenen Einsatz mit abgelaufener Frist über die Einsatz-Detailroute abruft
- **THEN** antwortet das System mit 403

#### Scenario: Vorgemerkt
- **WHEN** der System-Admin Detail, Personen-Export oder Live-Strom eines vorgemerkten Einsatzes abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Aktiver Einsatz mit Frist in der Vergangenheit
- **WHEN** ein aktiver Einsatz eine Frist in der Vergangenheit trägt
- **THEN** bleibt er für seine Mitglieder lesbar

### Requirement: Löschvormerkung nach Fristablauf

Das System SHALL einen abgeschlossenen Einsatz, dessen Frist abgelaufen ist, zur Löschung
vormerken (`geloescht_at`). Die Vormerkung beginnt die Karenz. Ein aktiver Einsatz MUST nie
vorgemerkt werden. Die Vormerkung MUST idempotent sein: Ein bereits vorgemerkter Einsatz
bleibt bei seinem ersten Zeitpunkt und erhält keinen zweiten ETB-Eintrag. Die Vormerkung MUST
bis zum Ende der Karenz umkehrbar sein (siehe `aufbewahrung-archiv`, Wiederherstellen).

#### Scenario: Fällig
- **WHEN** der Purge-Lauf nach Ablauf der Frist eines abgeschlossenen Einsatzes läuft
- **THEN** ist der Einsatz vorgemerkt, und das ETB enthält einen System-Eintrag zur Vormerkung

#### Scenario: Zweiter Lauf
- **WHEN** der Purge-Lauf ein zweites Mal läuft
- **THEN** bleibt der Zeitpunkt der Vormerkung unverändert, und es entsteht kein weiterer Eintrag

### Requirement: Karenz von 30 Tagen vor der Schwärzung

Das System SHALL einen vorgemerkten Einsatz frühestens 30 Tage nach dem Zeitpunkt seiner
Vormerkung schwärzen. Die Karenz ist systemweit fest und nicht je Einsatz einstellbar.
Maßgeblich MUST allein der Zeitpunkt der Vormerkung sein, nicht die Frist: Eine spätere
Änderung von `retention_bis` verschiebt die Schwärzung nicht.

#### Scenario: Innerhalb der Karenz
- **WHEN** der Purge-Lauf 29 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz nicht geschwärzt

#### Scenario: Karenz abgelaufen
- **WHEN** der Purge-Lauf genau 30 Tage nach der Vormerkung läuft
- **THEN** ist der Einsatz geschwärzt

#### Scenario: Frist ändert die Karenz nicht
- **WHEN** an einem vorgemerkten Einsatz `retention_bis` in der Datenbank auf einen späteren Zeitpunkt steht und die Karenz abgelaufen ist
- **THEN** schwärzt der Purge-Lauf den Einsatz trotzdem

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

### Requirement: Physische Entfernung geschwärzter Werte

Nach einer erfolgreichen Schwärzung MUST kein geschwärzter Wert mehr als Bytefolge in der
Datenbankdatei oder ihrem Write-Ahead-Log stehen. Das gilt für jede Scrub-Spalte und für jede
Zeile, die die Schwärzung löscht, Datei-Anhänge eingeschlossen. Kann der Rückschrieb des Logs
nicht sofort vollständig erfolgen, etwa weil eine andere Verbindung liest, MUST das System ihn
in jedem folgenden Purge-Lauf erneut versuchen, bis er gelingt, auch über einen Neustart
hinweg.

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

### Requirement: Pseudonyme Spur im ETB

System-Einträge im ETB, die Personen, Tiere oder Schäden betreffen, SHALL diese über ihre
Registriernummer bezeichnen (`R-042`, `T-007`, `S-003`). Die Identitäts- und Kontaktangaben
der Personenzeile (Name, Vorname, Geburtsdatum, Herkunftsadresse, Antreffort, Melderkontakt,
Zustand, Notiz), die Kontakte von Haltern und Geschädigten sowie die Tier-Kennzeichnung MUST
in keinem System-Eintrag stehen. Übernimmt ein System-Eintrag einen anderen Wert, den die
Klassifikation als Scrub führt, in seinen Wortlaut, MUST diese Stelle in einer
abschließenden Ausnahmeliste stehen, die ein Test pinnt. Der Wert bleibt dann als
Führungsdokumentation im ETB erhalten, auch über die Schwärzung hinweg. Eine neue solche
Stelle ohne Eintrag in der Liste ist ein Fehler.

#### Scenario: Person angelegt und gesichtet
- **WHEN** eine Person mit Name und Kontakt erfasst und gesichtet wird
- **THEN** nennen die System-Einträge nur ihre Registriernummer und die Kategorie

#### Scenario: Ausnahmeliste ist gepinnt
- **WHEN** der Ende-zu-Ende-Test die System-Einträge eines geschwärzten Einsatzes nach den gepflanzten Werten durchsucht
- **THEN** findet er einen Scrub-Wert nur an den Stellen, die die Ausnahmeliste führt

#### Scenario: Dokumentierte Ausnahme Schadensort
- **WHEN** ein Schaden mit Ort angelegt und der Einsatz später geschwärzt wird
- **THEN** ist der Ort in der Schadenszeile geschwärzt
- **AND** steht die Ortskurzform weiter im System-Eintrag der Anlage

### Requirement: Führungsdokumentation steht allein im ETB

Die rechtsverbindliche Führungsdokumentation eines Einsatzes SHALL das ETB sein. Die
Datensätze der Führungsmodule (Meldungen, Aufträge samt Empfängern, Nachforderungen,
Lageberichte, Befehle, Pressemitteilungen, Lagebesprechungen) MUST bei der Schwärzung ihre
Freitexte verlieren: Absender und Empfänger, Inhalt, Auftragstext und Befehlsgliederung,
Vollzugsmeldung, Bedarfsart und Bezeichnungen, Begründungen, Ablehnungsgründe, Titel, Abschnitte
und Entschluss. Erhalten bleiben MUST laufende Nummer, Meldungsart, Meldeweg, Priorität, Status,
Zeitpunkte und Verweise dieser Datensätze. Ein Freitext, der im Wortlaut eines ETB-Eintrags
steht, MUST dort erhalten bleiben. Ein Freitext, der nie ins ETB gelangt ist, MUST nach der
Schwärzung nirgends mehr stehen.

#### Scenario: Meldung und Auftrag nach der Schwärzung
- **WHEN** ein Einsatz mit einer Meldung „Fam. Yilmaz, Hauptstr. 5“ und einem Auftrag an eine
  externe Stelle mit Lage- und Absichtstext geschwärzt wird
- **THEN** tragen Meldung, Auftrag und Auftragsempfänger keinen dieser Freitexte mehr
- **AND** tragen sie weiter laufende Nummer, Meldeweg, Status und Zeitpunkte
- **AND** steht der Meldungsinhalt weiter im Wortlaut des zugehörigen ETB-Eintrags

#### Scenario: Freitext ohne ETB-Kopie
- **WHEN** eine Nachforderung abgelehnt wurde und der Einsatz später geschwärzt wird
- **THEN** steht der Ablehnungsgrund weder in der Nachforderung noch im ETB

#### Scenario: Lagebericht nach der Schwärzung
- **WHEN** ein Einsatz mit einem freigegebenen Lagebericht und einem Entwurf geschwärzt wird
- **THEN** tragen beide Versionen weder Titel noch Abschnittstext
- **AND** bleiben Version, Status und Zeitstand erhalten
- **AND** steht der freigegebene Bericht weiter im Wortlaut des ETB

#### Scenario: Audit nennt, was bleibt
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** nennt der System-Eintrag der Schwärzung die Freitexte der Führungsmodule als entfernt
- **AND** nennt er das ETB im Wortlaut als erhaltene Führungsdokumentation
- **AND** behauptet er nicht, Meldungen, Aufträge oder Berichte blieben als Text erhalten

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
