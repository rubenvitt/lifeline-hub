# Spec Delta

## Purpose

Der Org-Admin behält den Überblick über die Aufbewahrung der Einsätze seiner Organisation,
liest das pseudonyme Skelett gesperrter und geschwärzter Einsätze und kann eine
Löschvormerkung während der Karenz zurücknehmen. Einsatzleitung und Admin sehen und ändern
die Frist am Einsatz selbst.

## ADDED Requirements

### Requirement: Zugriff nur für den Org-Admin

Übersicht, Archivakte und Wiederherstellen SHALL nur einem System-Admin (`system_rolle =
admin`) offenstehen, und nur für Einsätze seiner eigenen Organisation. Andere Personen MUST
403 erhalten, auch Einsatzleitung und org-weite Führungskraft. Ein Einsatz einer fremden
Organisation MUST 403 liefern, ein unbekannter Einsatz 404. Für einen aktiven Einsatz gibt es
keine Archivakte, das System MUST mit 409 antworten.

#### Scenario: Admin der eigenen Organisation
- **WHEN** ein System-Admin die Archivakte eines geschwärzten Einsatzes seiner Organisation abruft
- **THEN** antwortet das System mit 200

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft Übersicht oder Archivakte abruft
- **THEN** antwortet das System mit 403

#### Scenario: Einsatzleitung des gesperrten Einsatzes
- **WHEN** die Einsatzleitung eines vorgemerkten Einsatzes dessen Archivakte abruft
- **THEN** antwortet das System mit 403

#### Scenario: Fremde Organisation
- **WHEN** ein System-Admin die Archivakte eines Einsatzes einer anderen Organisation abruft
- **THEN** antwortet das System mit 403

#### Scenario: Aktiver Einsatz
- **WHEN** ein System-Admin die Archivakte eines aktiven Einsatzes abruft
- **THEN** antwortet das System mit 409

### Requirement: Archiv liest nur, bis auf das Wiederherstellen

Der Archiv-Namensraum SHALL ausschließlich lesende Abrufe anbieten, mit einer einzigen
Ausnahme, dem Wiederherstellen. Über ihn MUST sich keine Angabe eines Einsatzes, einer
Person, eines Tiers, eines Schadens oder eines ETB-Eintrags ändern lassen. Die regulären
Einsatz-Routen MUST für einen gesperrten Einsatz weiter 403 liefern, auch dem System-Admin.
Das gilt für Detail, ETB, Personen, Tiere, Schäden, Anhänge, Dokumente, Chat, Lagekarte,
Export und Live-Strom.

#### Scenario: Reguläre Routen bleiben gesperrt
- **WHEN** der System-Admin nach der Schwärzung ETB, Personenliste, Anhänge oder Live-Strom des Einsatzes über die regulären Routen abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Kein Schreibweg im Archiv
- **WHEN** die Routen des Archiv-Namensraums aufgezählt werden
- **THEN** ist jede davon ein lesender Abruf, außer dem Wiederherstellen

### Requirement: Aufbewahrungsübersicht

Die Übersicht SHALL alle abgeschlossenen Einsätze der Organisation des Admins zeigen, jeweils
mit Einsatznummer, Bezeichnung, Abschlusszeitpunkt, Frist, Zeitpunkt der Vormerkung,
Karenz-Ende, Zeitpunkt der Schwärzung und einem Aufbewahrungszustand. Der Zustand MUST genau
einer dieser Werte sein:
- `ohne_frist`: keine Frist gesetzt
- `frist_laeuft`: Frist in der Zukunft
- `faellig`: Frist abgelaufen, noch nicht vorgemerkt
- `vorgemerkt`: vorgemerkt, Karenz läuft
- `schwaerzung_ausstehend`: Karenz abgelaufen, noch nicht geschwärzt
- `geschwaerzt`

Aktive Einsätze MUST fehlen. Die Übersicht MUST ohne Schreibvorgang auskommen und keine
personenbezogenen Spalten enthalten.

#### Scenario: Zustände
- **WHEN** die Organisation je einen abgeschlossenen Einsatz ohne Frist, mit künftiger Frist, mit abgelaufener Frist, vorgemerkt seit 3 Tagen, vorgemerkt seit 31 Tagen und geschwärzt hat
- **THEN** zeigt die Übersicht sie mit den Zuständen `ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`, `schwaerzung_ausstehend` und `geschwaerzt`
- **AND** trägt der vorgemerkte Einsatz ein Karenz-Ende 30 Tage nach seiner Vormerkung

#### Scenario: Fremde Organisation und aktive Einsätze
- **WHEN** es aktive Einsätze der eigenen und abgeschlossene Einsätze einer fremden Organisation gibt
- **THEN** fehlen beide in der Übersicht

### Requirement: Pseudonyme Archivakte

Die Archivakte SHALL den Einsatzkopf, den Aufbewahrungszustand und ein Register der
Personen, Tiere und Schäden zeigen. Jede Angabe MUST aus einer Spalte stammen, die die
Klassifikation der Capability `aufbewahrung` als Retain führt. Die Akte MUST deshalb vor und
nach der Schwärzung dieselben Felder tragen. Einsatzort, Koordinate des Einsatzorts,
meldende Stelle und Sachverhalt MUST fehlen. Das Register MUST je Eintrag die
Registriernummer in Anzeigeform, Status, Zeitstempel und bei Personen die Sichtungs- und
Verbleibkategorie tragen, bei Tieren die Tierart, bei Schäden Typ und Ausmaß. Namen,
Kontakte, Adressen, Orte, Beschreibungen und Notizen MUST fehlen, auch während der Karenz,
in der sie in der Datenbank noch stehen.

#### Scenario: Während der Karenz
- **WHEN** der Admin die Akte eines vorgemerkten, noch nicht geschwärzten Einsatzes abruft, dessen Person „Erika Mustermann“ heißt
- **THEN** enthält die Antwort weder „Erika“ noch „Mustermann“
- **AND** führt das Register die Person als `R-001` mit Status und Sichtungskategorie

#### Scenario: Nach der Schwärzung
- **WHEN** der Admin dieselbe Akte nach der Schwärzung abruft
- **THEN** trägt sie dieselben Felder wie während der Karenz

### Requirement: ETB in der Archivakte

Die Archivakte SHALL das ETB des Einsatzes im Wortlaut zeigen, neueste Einträge zuerst,
seitenweise über die laufende Nummer, filterbar nach Eintragstyp. Jeder Eintrag MUST
laufende Nummer, Typ, Inhalt, Von, An, Meldeweg, Veranlassung, Ereigniszeit, Eingangszeit,
Erfasser und den Verweis auf einen berichtigten Eintrag tragen. Anhänge und Verweise auf
Aufträge, Befehle, Lageberichte, Meldungen und Nachforderungen MUST fehlen, weil ihre Ziele
im Archiv nicht lesbar sind.

#### Scenario: Aufbewahrungs-Audits lesen
- **WHEN** der Admin das Archiv-ETB eines geschwärzten Einsatzes mit Typfilter System abruft
- **THEN** enthält es die Einträge zur Frist, zur Vormerkung und zur Schwärzung

#### Scenario: Berichtigung
- **WHEN** ein Eintrag einen anderen berichtigt hat
- **THEN** trägt er im Archiv-ETB den Verweis auf den berichtigten Eintrag

### Requirement: Wiederherstellen während der Karenz

Der Org-Admin SHALL einen vorgemerkten, noch nicht geschwärzten Einsatz innerhalb der Karenz
wiederherstellen können. Die Anfrage MUST eine neue Frist enthalten, einen Zeitpunkt in der
Zukunft oder ausdrücklich `null` für unbegrenzt. Fehlt das Feld, MUST das System mit 400
antworten. Liegt die Frist nicht in der Zukunft, antwortet es mit 422. Wiederherstellen hebt
die Vormerkung auf und setzt die neue Frist im selben atomaren Vorgang, zusammen mit einem
System-Eintrag im ETB, der den Admin als Erfasser trägt und die Vormerkung sowie die neue
Frist nennt. Ist der Einsatz nicht vorgemerkt, MUST das System mit 422 antworten. Ist die
Karenz abgelaufen oder der Einsatz geschwärzt, MUST es mit 409 antworten und nichts ändern.

#### Scenario: Wiederherstellen mit neuer Frist
- **WHEN** der Admin einen seit 5 Tagen vorgemerkten Einsatz mit einer Frist in 90 Tagen wiederherstellt
- **THEN** ist der Einsatz nicht mehr vorgemerkt und trägt die neue Frist
- **AND** enthält das ETB einen System-Eintrag des Admins zur Wiederherstellung
- **AND** kann die Einsatzleitung den Einsatz über die regulären Routen wieder lesen

#### Scenario: Nächster Purge-Lauf
- **WHEN** nach dem Wiederherstellen der Purge-Lauf läuft
- **THEN** bleibt der Einsatz unvorgemerkt

#### Scenario: Frist fehlt
- **WHEN** die Anfrage kein Feld `retention_bis` enthält
- **THEN** antwortet das System mit 400

#### Scenario: Frist in der Vergangenheit
- **WHEN** die Anfrage eine Frist in der Vergangenheit enthält
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Nicht vorgemerkt
- **WHEN** der Admin einen Einsatz wiederherstellen will, der nicht vorgemerkt ist
- **THEN** antwortet das System mit 422

#### Scenario: Karenz abgelaufen
- **WHEN** der Admin einen Einsatz wiederherstellen will, dessen Karenz abgelaufen ist, der aber noch nicht geschwärzt ist
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Geschwärzt
- **WHEN** der Admin einen geschwärzten Einsatz wiederherstellen will
- **THEN** antwortet das System mit 409

### Requirement: Frist am Einsatz anzeigen und ändern

Die Einstellungen eines Einsatzes SHALL im Bereich Aufbewahrung die Frist anzeigen: den
Zeitpunkt in der Anzeigezone, „keine Frist“ oder bei einem aktiven Einsatz den Hinweis, dass
die Frist beim Abschluss aus der Dauer entsteht. Einsatzleitung und System-Admin MUST die
Frist dort setzen, verlängern und aufheben können, auch wenn der Einsatz abgeschlossen ist und
die übrigen Einstellungen eingefroren sind. Vor einer Verkürzung MUST eine Rückfrage stehen,
die den neuen und den alten Zeitpunkt nennt. Ohne Recht MUST die Aktion gesperrt dastehen und
ein Hinweis den Grund nennen. Die Archivakte MUST dieselbe Frist-Aktion für nicht
vorgemerkte Einsätze anbieten und für vorgemerkte, noch in der Karenz liegende das
Wiederherstellen. Die Übersicht führt in die Archivakte und trägt selbst keine Aktion.

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Einsatzleitung die Aufbewahrung eines abgeschlossenen Einsatzes öffnet
- **THEN** sieht sie die Frist und kann sie verlängern, obwohl die übrigen Einstellungen eingefroren sind

#### Scenario: Verkürzung
- **WHEN** die Einsatzleitung eine frühere Frist wählt
- **THEN** erscheint eine Rückfrage, und erst nach Bestätigung wird die Frist gesetzt

#### Scenario: Ohne Recht
- **WHEN** ein Beobachter die Aufbewahrung öffnet
- **THEN** sieht er die Frist, die Aktion ist gesperrt, und ein Hinweis nennt den Grund

### Requirement: Übersicht in der Verwaltung

Die Verwaltung SHALL einen Eintrag „Aufbewahrung“ führen, der nur einem System-Admin
angezeigt wird. Die Übersicht MUST als Tabelle erscheinen, mit fixierter Einsatznummer,
Zustand als Statusetikett mit Wort und einer Auswahl nach Zustand. Eine Zeile MUST in die
Archivakte führen. Die Archivakte MUST eine eigene Adresse haben, die einen Neuladen
übersteht.

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft die Verwaltung öffnet
- **THEN** fehlt der Eintrag „Aufbewahrung“

#### Scenario: Sprung in die Akte
- **WHEN** der Admin in der Übersicht die Zeile eines geschwärzten Einsatzes wählt
- **THEN** öffnet sich dessen Archivakte unter einer eigenen Adresse
