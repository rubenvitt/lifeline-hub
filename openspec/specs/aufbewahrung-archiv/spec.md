# aufbewahrung-archiv Specification

## Purpose
Der Org-Admin behält den Überblick über die Aufbewahrung der Einsätze seiner Organisation,
liest das pseudonyme Skelett gesperrter und geschwärzter Einsätze und kann eine
Löschvormerkung während der Karenz zurücknehmen. Einsatzleitung und Admin sehen und ändern
die Frist am Einsatz selbst.

## Requirements

### Requirement: Zugriff nur für den Org-Admin

Übersicht, Archivakte, Wiederherstellen, Schwärzungsanträge und Personensuche SHALL nur einem
System-Admin (`system_rolle = admin`) offenstehen, und nur für Einsätze seiner eigenen
Organisation. Andere Personen MUST 403 erhalten, auch Einsatzleitung und org-weite
Führungskraft. Ein Einsatz einer fremden Organisation MUST 403 liefern, ein unbekannter Einsatz
404. Für einen aktiven Einsatz gibt es keine Archivakte, das System MUST mit 409 antworten.

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

#### Scenario: Personensuche durch die Einsatzleitung
- **WHEN** die Einsatzleitung eines abgeschlossenen Einsatzes die Personensuche des Archivs aufruft
- **THEN** antwortet das System mit 403

### Requirement: Archiv liest nur, bis auf Wiederherstellen und Schwärzungsantrag

Der Archiv-Namensraum SHALL ausschließlich lesende Abrufe anbieten, mit drei Ausnahmen: dem
Wiederherstellen, dem Stellen eines Schwärzungsantrags und seiner Rücknahme. Die Personensuche
ist ein lesender Abruf, auch wenn sie ihren Suchtext im Anfrage-Body trägt. Über den Namensraum
MUST sich keine Angabe eines Einsatzes, einer Person, eines Tiers, eines Schadens oder eines
ETB-Eintrags unmittelbar ändern lassen; geschwärzt wird nur durch den Vollzug im Purge-Lauf,
eine Person in den Blöcken eines Archivs nur durch den Befehl mit dem Archiv-Schlüssel. Die
regulären Einsatz-Routen MUST für einen gesperrten Einsatz weiter 403 liefern, auch dem
System-Admin. Das gilt für Detail, ETB, Personen, Tiere, Schäden, Anhänge, Dokumente, Chat,
Lagekarte, Export und Live-Strom.

#### Scenario: Reguläre Routen bleiben gesperrt
- **WHEN** der System-Admin nach der Schwärzung ETB, Personenliste, Anhänge oder Live-Strom des Einsatzes über die regulären Routen abruft
- **THEN** antwortet das System jeweils mit 403

#### Scenario: Kein Schreibweg im Archiv
- **WHEN** die Routen des Archiv-Namensraums aufgezählt werden
- **THEN** ist jede davon ein lesender Abruf, außer Wiederherstellen, Antrag und Rücknahme
- **AND** ist die Personensuche als einzige lesende Route kein GET

#### Scenario: Antrag ändert keine Angabe
- **WHEN** der Admin einen Schwärzungsantrag für eine Person stellt
- **THEN** trägt die Person unmittelbar danach unveränderte Angaben

### Requirement: Aufbewahrungsübersicht

Die Übersicht SHALL alle abgeschlossenen Einsätze der Organisation des Admins zeigen, jeweils
mit Einsatznummer, Bezeichnung, Abschlusszeitpunkt, Frist, Zeitpunkt der Vormerkung,
Karenz-Ende, Fälligkeit eines offenen Einsatz-Antrags, Zeitpunkt der Schwärzung, Zeitpunkt der
endgültigen Löschung („Löschung am“, nur mit Skelett-Frist der Organisation) und einem
Aufbewahrungszustand. Dazu MUST sie jede Zeile des Löschprotokolls der Organisation zeigen, mit
Einsatznummer, Abschluss, Schwärzung und Löschzeitpunkt, aber ohne Bezeichnung. Der Zustand MUST
genau einer dieser Werte sein:
- `ohne_frist`: keine Frist gesetzt
- `frist_laeuft`: Frist in der Zukunft
- `faellig`: Frist abgelaufen, noch nicht vorgemerkt
- `vorgemerkt`: vorgemerkt, Karenz läuft
- `schwaerzung_ausstehend`: Karenz abgelaufen, noch nicht geschwärzt
- `schwaerzung_beantragt`: offener Einsatz-Antrag, noch nicht vollzogen; geht allen
  ungeschwärzten Zuständen vor
- `geschwaerzt`: geschwärzt, Skelett-Frist läuft oder fehlt
- `loeschung_ausstehend`: geschwärzt, Skelett-Frist abgelaufen, noch nicht gelöscht
- `endgueltig_geloescht`: Zeile aus dem Löschprotokoll

Aktive Einsätze MUST fehlen. Die Übersicht MUST ohne Schreibvorgang auskommen und keine
personenbezogenen Spalten enthalten. Ein offener Personen-Antrag ändert den Zustand nicht.

Jede Angabe MUST in der Übersicht erreichbar sein. Unter einer Fensterbreite von 1600 px MAY nur
der Zeitpunkt der Vormerkung, die Fälligkeit eines offenen Einsatz-Antrags und der Zeitpunkt der
Schwärzung aus der Tabelle weichen; eine gewichene Angabe MUST sich über den Spaltenschalter
einblenden lassen, und sein Zähler MUST sie mitzählen. Ab 1600 px SHALL jede Angabe ohne
Handauswahl als Spalte im Bild stehen.

#### Scenario: Zustände
- **WHEN** die Organisation je einen abgeschlossenen Einsatz ohne Frist, mit künftiger Frist, mit abgelaufener Frist, vorgemerkt seit 3 Tagen, vorgemerkt seit 31 Tagen und geschwärzt hat
- **THEN** zeigt die Übersicht sie mit den Zuständen `ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`, `schwaerzung_ausstehend` und `geschwaerzt`
- **AND** trägt der vorgemerkte Einsatz ein Karenz-Ende 30 Tage nach seiner Vormerkung

#### Scenario: Offener Einsatz-Antrag
- **WHEN** ein Einsatz mit künftiger Frist einen vor 2 Stunden gestellten Einsatz-Antrag trägt
- **THEN** zeigt die Übersicht ihn als `schwaerzung_beantragt` mit einer Fälligkeit 24 Stunden nach dem Antrag

#### Scenario: Zurückgenommener Antrag
- **WHEN** der Einsatz-Antrag zurückgenommen ist
- **THEN** zeigt die Übersicht wieder den Zustand aus Frist und Vormerkung

#### Scenario: Fremde Organisation und aktive Einsätze
- **WHEN** es aktive Einsätze der eigenen und abgeschlossene Einsätze einer fremden Organisation gibt
- **THEN** fehlen beide in der Übersicht

#### Scenario: Löschung am
- **WHEN** die Organisation eine Skelett-Frist von 3650 Tagen hat
- **THEN** trägt jeder abgeschlossene Einsatz als „Löschung am“ den späteren Zeitpunkt aus Abschluss plus 3650 Tage und seiner Schwärzung, sofern er geschwärzt ist, sonst Abschluss plus 3650 Tage
- **AND** fehlt „Löschung am“, solange die Organisation keine Skelett-Frist hat

#### Scenario: Löschung ausstehend
- **WHEN** ein geschwärzter Einsatz eine abgelaufene Skelett-Frist hat, aber noch nicht gelöscht ist
- **THEN** zeigt die Übersicht ihn mit dem Zustand `loeschung_ausstehend`

#### Scenario: Endgültig gelöscht
- **WHEN** ein Einsatz der Organisation endgültig gelöscht ist
- **THEN** zeigt die Übersicht eine Zeile mit seiner Einsatznummer und dem Zustand `endgueltig_geloescht`
- **AND** trägt die Zeile keine Bezeichnung

#### Scenario: Löschprotokoll einer fremden Organisation
- **WHEN** nur eine fremde Organisation eine Zeile im Löschprotokoll hat
- **THEN** fehlt sie in der Übersicht

#### Scenario: Führungsarbeitsplatz
- **WHEN** der Admin die Übersicht in einem 1440 px breiten Fenster öffnet
- **THEN** stehen Einsatznummer, Zustand, Bezeichnung, Abschlusszeitpunkt, Frist, Karenz-Ende und „Löschung am“ als Spalten im Bild, ohne dass die Tabelle waagerecht überläuft
- **AND** nennt der Spaltenschalter drei ausgeblendete Spalten, und Vormerkung, Antrags-Fälligkeit und Schwärzung lassen sich darüber einblenden

#### Scenario: Breites Fenster
- **WHEN** der Admin die Übersicht in einem mindestens 1600 px breiten Fenster öffnet und im Spaltenschalter nichts abgewählt hat
- **THEN** steht jede Angabe als eigene Spalte im Bild

### Requirement: Pseudonyme Archivakte

Die Archivakte SHALL den Einsatzkopf, den Aufbewahrungszustand, den Zustand je Datenkategorie
(Frist, Vormerkung, Karenz-Ende, Schwärzung, Rechtsgrundlage, Zustand nach der Capability
`aufbewahrung-kategorien`) und ein Register der Personen, Tiere und Schäden zeigen. Jede
Angabe MUST aus einer Spalte stammen, die die Klassifikation der Capability `aufbewahrung`
als Retain führt. Die Akte MUST deshalb vor und nach der Schwärzung dieselben Felder tragen.
Einsatzort, Koordinate des Einsatzorts, meldende Stelle und Sachverhalt MUST fehlen. Das
Register MUST je Eintrag die Registriernummer in Anzeigeform, Status, Zeitstempel und bei
Personen die Sichtungs- und Verbleibkategorie tragen, bei Tieren die Tierart, bei Schäden Typ
und Ausmaß. Namen, Kontakte, Adressen, Orte, Beschreibungen und Notizen MUST fehlen, auch
während der Karenz, in der sie in der Datenbank noch stehen.

#### Scenario: Während der Karenz
- **WHEN** der Admin die Akte eines vorgemerkten, noch nicht geschwärzten Einsatzes abruft, dessen Person „Erika Mustermann“ heißt
- **THEN** enthält die Antwort weder „Erika“ noch „Mustermann“
- **AND** führt das Register die Person als `R-001` mit Status und Sichtungskategorie

#### Scenario: Nach der Schwärzung
- **WHEN** der Admin dieselbe Akte nach der Schwärzung abruft
- **THEN** trägt sie dieselben Felder wie während der Karenz

#### Scenario: Kategorien in der Akte
- **WHEN** der Admin die Akte eines Einsatzes abruft, dessen Kategorie `personenauskunft` geschwärzt ist
- **THEN** führt die Akte `personenauskunft` mit Zustand `geschwaerzt`, Zeitpunkt der Schwärzung und Rechtsgrundlage
- **AND** führt sie die übrigen Kategorien mit ihrem jeweiligen Zustand

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
die Frist beim Abschluss aus der Dauer entsteht. Darunter MUST je Datenkategorie ihre Frist,
ihr Zustand und ihre Rechtsgrundlage stehen, bei einem aktiven Einsatz die Dauer, aus der die
Kategorie-Frist beim Abschluss entsteht, oder der Hinweis, dass sie der Einsatz-Frist folgt.
Einsatzleitung und System-Admin der Einsatz-Org MUST die Frist des Einsatzes dort setzen,
verlängern und aufheben können, auch wenn der Einsatz abgeschlossen ist und die übrigen
Einstellungen eingefroren sind; die Frist jeder Kategorie ebenso, sobald der Einsatz
abgeschlossen ist. Vor einer Verkürzung MUST eine Rückfrage stehen, die den neuen und den alten
Zeitpunkt nennt. Ohne Recht MUST die Aktion gesperrt dastehen und ein Hinweis den Grund nennen;
das gilt auch für den System-Admin einer fremden Organisation. Die Archivakte MUST dieselbe
Frist-Aktion für nicht vorgemerkte Einsätze
anbieten und für vorgemerkte, noch in der Karenz liegende das Wiederherstellen. Die Übersicht
führt in die Archivakte und trägt selbst keine Aktion.

#### Scenario: Abgeschlossener Einsatz
- **WHEN** die Einsatzleitung die Aufbewahrung eines abgeschlossenen Einsatzes öffnet
- **THEN** sieht sie die Frist und kann sie verlängern, obwohl die übrigen Einstellungen eingefroren sind

#### Scenario: Verkürzung
- **WHEN** die Einsatzleitung eine frühere Frist wählt
- **THEN** erscheint eine Rückfrage, und erst nach Bestätigung wird die Frist gesetzt

#### Scenario: Ohne Recht
- **WHEN** ein Beobachter die Aufbewahrung öffnet
- **THEN** sieht er die Frist, die Aktion ist gesperrt, und ein Hinweis nennt den Grund

#### Scenario: Admin einer fremden Organisation
- **WHEN** der System-Admin einer anderen Organisation die Aufbewahrung eines Einsatzes öffnet, in dem er kein Mitglied ist
- **THEN** sieht er die Frist, die Aktion ist gesperrt, und ein Hinweis nennt den Grund

#### Scenario: Kategorie verlängern
- **WHEN** die Einsatzleitung die Frist der vorgemerkten Kategorie `anhaenge` auf einen künftigen Zeitpunkt setzt
- **THEN** zeigt die Kategorie danach `frist_laeuft` mit der neuen Frist

#### Scenario: Aktiver Einsatz
- **WHEN** die Einsatzleitung die Aufbewahrung eines aktiven Einsatzes öffnet, dessen Organisation für `personenauskunft` 0 Tage vorgibt
- **THEN** steht bei `personenauskunft` der Hinweis, dass die Frist beim Abschluss nach 0 Tagen entsteht
- **AND** steht bei den übrigen Kategorien, dass sie der Einsatz-Frist folgen

### Requirement: Übersicht in der Verwaltung

Die Verwaltung SHALL einen Eintrag „Aufbewahrung“ führen, der nur einem System-Admin
angezeigt wird. Die Übersicht MUST als Tabelle erscheinen, mit fixierter Einsatznummer,
Zustand als Statusetikett mit Wort und einer Auswahl nach Zustand. Eine Zeile MUST in die
Archivakte führen, außer eine Zeile im Zustand `endgueltig_geloescht`: Sie MUST in keine Akte
führen. Die Archivakte MUST eine eigene Adresse haben, die einen Neuladen übersteht.

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft die Verwaltung öffnet
- **THEN** fehlt der Eintrag „Aufbewahrung“

#### Scenario: Sprung in die Akte
- **WHEN** der Admin in der Übersicht die Zeile eines geschwärzten Einsatzes wählt
- **THEN** öffnet sich dessen Archivakte unter einer eigenen Adresse

#### Scenario: Gelöschter Einsatz
- **WHEN** der Admin in der Übersicht die Zeile eines endgültig gelöschten Einsatzes ansieht
- **THEN** bietet sie keinen Sprung in eine Akte an
- **AND** steht anstelle der Bezeichnung ein Hinweis, dass der Einsatz endgültig gelöscht ist

### Requirement: Archivblock in der Verwaltung einspielen

Ein System-Admin SHALL einen Archivblock samt privatem Archiv-Schlüssel hochladen und damit in
seine eigene Organisation einspielen können. Das Ergebnis MUST dasselbe sein wie beim Befehl
`archiv einspielen` ohne `--org`: ein schreibgeschützter Einsatz „Aus dem Archiv · bis …“.
Dieselben Ablehnungen MUST gelten. Andere Personen MUST 403 erhalten.

#### Scenario: Admin spielt ein
- **WHEN** ein System-Admin einen gültigen Block seiner Organisation mit passendem Schlüssel hochlädt
- **THEN** antwortet das System mit Einsatz, Organisation, Frist („bis“) und Hinweisen
- **AND** steht der Einsatz in der Einsatzliste mit dem Band „Aus dem Archiv · bis …“

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft einen Block hochlädt
- **THEN** antwortet das System mit 403

#### Scenario: Falscher Schlüssel
- **WHEN** der Schlüssel nicht zum Block passt
- **THEN** antwortet das System mit 400 und der Meldung, dass der Schlüssel nicht passt
- **AND** entsteht kein Einsatz

#### Scenario: Aufbewahrung abgelaufen
- **WHEN** die Aufbewahrung im Block abgelaufen ist
- **THEN** antwortet das System mit 400 und nennt das Ende der Aufbewahrung

#### Scenario: Fremde Organisation
- **WHEN** die Organisation im Block anders heißt als die Organisation des Admins
- **THEN** antwortet das System mit 400 und nennt beide Namen
- **AND** entsteht kein Einsatz

#### Scenario: Veralteter Block
- **WHEN** eine Datenkategorie des Blocks inzwischen abgelaufen ist
- **THEN** wird sie vor dem Einspielen geschwärzt
- **AND** nennt die Antwort das als Hinweis

### Requirement: Kein Einspielen an einer erreichten Instanz

Das Einspielen über die Verwaltung SHALL nur an einer Instanz bestehen, bei der sich keine andere
meldet. Hat die Instanz eine angebahnte oder aktive Kopplung, in der sie die erreichte Seite ist,
egal für welche Organisation, MUST der Server mit 422 ablehnen. Er MUST das tun, bevor er
Block oder Schlüssel liest, und die Oberfläche MUST die Aktion dann nicht anbieten. Eine
widerrufene Kopplung sperrt nicht.

#### Scenario: Hub
- **WHEN** eine andere Instanz an dieser Instanz gekoppelt ist und sich hier meldet
- **THEN** antwortet das Hochladen mit 422
- **AND** fehlt die Aktion „Archiv einspielen“ in der Verwaltung

#### Scenario: Kopplung einer anderen Organisation
- **WHEN** nur eine andere Organisation dieser Instanz eine solche Kopplung hat
- **THEN** antwortet das Hochladen ebenfalls mit 422

#### Scenario: Früher eingespielter Block
- **WHEN** an der Instanz schon ein Block eingespielt wurde und keine Kopplung angebahnt oder aktiv ist
- **THEN** bietet die Verwaltung die Aktion weiter an

#### Scenario: Meldende Seite
- **WHEN** diese Instanz sich nur selbst bei einer anderen meldet
- **THEN** steht das Einspielen zur Verfügung

### Requirement: Der Schlüssel bleibt nur für den Aufruf

Der private Schlüssel und eine Passphrase SHALL nur für die Dauer des Aufrufs im Speicher des
Servers liegen. Sie MUST weder in der Datenbank noch auf der Platte noch im Log noch in der
Admin-Spur stehen. Der Schlüssel MUST als Datei oder als eingefügter Text angenommen werden.
Eine mit Passphrase geschützte Schlüsseldatei MUST mit der mitgeschickten Passphrase gehen.

#### Scenario: Nach dem Aufruf
- **WHEN** ein Einspielen erfolgreich oder mit Fehler endet
- **THEN** enthält keine Tabelle und keine Datei im Datenverzeichnis den Schlüssel oder die Passphrase

#### Scenario: Eingefügter Schlüssel
- **WHEN** der Admin den Text `AGE-SECRET-KEY-1…` statt einer Datei schickt
- **THEN** spielt das System den Block ein wie mit der Datei

#### Scenario: Geschützte Schlüsseldatei ohne Passphrase
- **WHEN** die Schlüsseldatei mit einer Passphrase geschützt ist und keine mitkommt
- **THEN** antwortet das System mit 400 und verlangt die Passphrase

#### Scenario: Schlüssel fehlt oder doppelt
- **WHEN** weder Datei noch Text oder beides zugleich kommt
- **THEN** antwortet das System mit 400

### Requirement: Grenzen des Hochladens

Ein Block SHALL höchstens 256 MiB groß sein; darüber MUST das System mit 413 ablehnen. Der
Hinweis MUST auf den Befehl verweisen. Gleichzeitige Einspielvorgänge MUST zur Grenze
gleichzeitiger Uploads zählen. Bricht die Verbindung ab, MUST das Einspielen abbrechen, ohne eine
entschlüsselte Zwischendatei zurückzulassen.

#### Scenario: Zu großer Block
- **WHEN** ein Block über 256 MiB hochgeladen wird
- **THEN** antwortet das System mit 413

#### Scenario: Abbruch
- **WHEN** der Browser die Verbindung während des Einspielens schließt
- **THEN** liegt danach keine entschlüsselte Zwischendatei neben der Datenbank

### Requirement: Spur nennt die Person

Ein Einspielen über die Verwaltung SHALL in der Admin-Spur als „Archiv eingespielt“ mit der
handelnden Person als Akteur und ihrer Adresse stehen. Der Eintrag MUST mit dem Einsatz entstehen
und MUST bei einem abgelehnten Einspielen fehlen. Beim Befehl MUST der Akteur weiter „Befehl
archiv einspielen“ heißen.

#### Scenario: Zugangsprotokoll
- **WHEN** ein Admin einen Block einspielt
- **THEN** zeigt das Zugangsprotokoll „Archiv eingespielt“ mit seinem Namen und der Einsatzkennung

#### Scenario: Abgelehnt
- **WHEN** das Einspielen mit falschem Schlüssel scheitert
- **THEN** steht kein Eintrag „Archiv eingespielt“ in der Spur

### Requirement: Einspielen in der Oberfläche

Die Seite „Aufbewahrung“ SHALL einem System-Admin die Aktion „Archiv einspielen“ anbieten, wenn
das Einspielen zur Verfügung steht. Ein Dialog MUST Block, Schlüssel als Datei oder Text und eine
optionale Passphrase nehmen. Nach dem Einspielen MUST die Seite Einsatz, Frist und Hinweise zeigen
und in den Einsatz führen. Eine Ablehnung MUST im Dialog stehen und die Eingaben behalten.

#### Scenario: Ergebnis
- **WHEN** der Admin im Dialog einen Block einspielt
- **THEN** zeigt die Seite den Einsatz mit „bis …“ und den Hinweisen
- **AND** führt ein Sprung in den eingespielten Einsatz

#### Scenario: Fehler im Dialog
- **WHEN** das System das Einspielen ablehnt
- **THEN** zeigt der Dialog die Meldung und behält die gewählten Dateien
