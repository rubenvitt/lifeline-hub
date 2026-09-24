# Spec Delta

## Purpose

Eine Instanz kann auf Wunsch eine realistisch befüllte Übungslage zeigen. Ein System-Admin
spielt sie im laufenden Betrieb ein, entfernt sie wieder oder importiert sie neu. Der
Import legt nie ein Benutzerkonto an, überschreibt keine vorhandenen Stammdaten und kann
beim Entfernen nichts anfassen, was nicht er selbst angelegt hat.

## ADDED Requirements

### Requirement: Freischaltung per Umgebungsvariable

Das System SHALL den Demo-Import nur anbieten, wenn der Schalter `--demo-daten` bzw. die
Umgebungsvariable `LIFELINE_DEMO_DATEN=true` gesetzt ist. Die Vorgabe ist aus. Ohne
Freischaltung MUST jeder Pfad unter `/api/demo-daten` genau so antworten wie ein nicht
vorhandener `/api/`-Pfad: 404 mit `{"error": …}`, bei jeder Methode und unabhängig davon,
ob die Anfrage angemeldet ist. Ist der Schalter an, MUST beim Start eine Warnung im Log
stehen, dass der harte Löschweg für Demo-Daten erreichbar ist.

#### Scenario: Vorgabe ist aus
- **WHEN** der Server ohne Schalter und ohne `LIFELINE_DEMO_DATEN` startet
- **THEN** ist der Demo-Import nicht freigeschaltet

#### Scenario: Ohne Freischaltung ist der Pfad unbekannt
- **WHEN** ohne Freischaltung `GET`, `POST` oder `DELETE` auf `/api/demo-daten` bzw. `POST` auf `/api/demo-daten/neu` gesendet wird, einmal anonym und einmal als System-Admin
- **THEN** antwortet das System in jedem Fall mit 404 und demselben Fehler-Body wie bei einem unbekannten `/api/`-Pfad
- **AND** nie mit 401, 403 oder 405

#### Scenario: Warnung beim Start
- **WHEN** der Server mit `--demo-daten` startet
- **THEN** steht im Log eine Warnung, die den Schalter nennt

### Requirement: Nur der System-Admin, nur die eigene Organisation

Mit Freischaltung SHALL das System alle Demo-Endpunkte ausschließlich dem System-Admin
öffnen. Eine anonyme Anfrage MUST 401 erhalten, jede andere Rolle 403, auch eine
Führungskraft mit Zugang zur Verwaltung. Import, Status und Entfernen MUST sich immer auf
die Organisation des angemeldeten Admins beziehen (die Organisation seines Kontos), nie
auf eine Organisation, die aus einer Reihenfolge abgeleitet ist.

#### Scenario: Führungskraft
- **WHEN** eine Führungskraft ohne System-Admin-Rolle einen Demo-Endpunkt aufruft
- **THEN** antwortet das System mit 403 und ändert nichts

#### Scenario: Anonym
- **WHEN** eine anonyme Anfrage einen Demo-Endpunkt aufruft
- **THEN** antwortet das System mit 401

#### Scenario: Zwei Organisationen
- **WHEN** der System-Admin der Organisation B importiert, während Organisation A bereits einen aktiven Demo-Import hat
- **THEN** entsteht der Demo-Einsatz in Organisation B
- **AND** der Status von B zeigt nur den Import von B, und Entfernen durch B lässt den Import von A unberührt

### Requirement: Status der Demo-Daten

`GET /api/demo-daten` SHALL für die Organisation des Admins melden, ob ein aktiver Import
besteht. Besteht einer, MUST die Antwort den Importzeitpunkt, den Demo-Einsatz (ID und
Bezeichnung) und den Bericht des Imports tragen. Nach einem Entfernen MUST die Antwort
„nicht importiert“ lauten und den Bericht des Entfernens tragen.

#### Scenario: Nichts importiert
- **WHEN** der Admin den Status abfragt und nie importiert wurde
- **THEN** meldet die Antwort „nicht importiert“ ohne Bericht

#### Scenario: Importiert
- **WHEN** der Admin nach einem Import den Status abfragt
- **THEN** nennt die Antwort Importzeitpunkt, Einsatz-ID, Einsatzbezeichnung und den Bericht mit „angelegt“ und „mitbenutzt“ je Stammdatenart

### Requirement: Herkunftsmarke

Das System SHALL jeden Import als Kopf-Datensatz führen, samt Organisation, importierender
Person, Zeitpunkt, Demo-Einsatz und Bericht. Jede Stammdatenzeile, die der Import neu
anlegt, MUST dem Kopf zugeordnet sein. Mitbenutzte Stammdaten MUST NOT eine Marke
bekommen. Je Organisation MUST höchstens ein aktiver Import bestehen. Nach dem Entfernen
MUST der Kopf als Historie mit Entfernzeitpunkt stehen bleiben.

#### Scenario: Zweiter Import
- **WHEN** der Admin importiert, während für seine Organisation schon ein aktiver Import besteht
- **THEN** antwortet das System mit 409 und legt nichts an

#### Scenario: Mitbenutzter Datensatz bleibt unmarkiert
- **WHEN** ein Fahrzeug mit dem Funkrufnamen eines Demo-Fahrzeugs bereits in Dienst steht
- **THEN** disponiert der Import dieses vorhandene Fahrzeug
- **AND** es erscheint unter „mitbenutzt“ und hat keine Demo-Marke

### Requirement: Stammdaten mit Konfliktregel

Der Import SHALL die Stammdaten anlegen, die das Szenario braucht: Fahrzeuge, Personal und
Material der Organisation. Ein vorhandener Datensatz derselben Organisation mit Dienststatus
`in_dienst` und derselben fachlichen Kennung MUST mitbenutzt statt angelegt werden. Die
Kennung ist beim Fahrzeug der Funkrufname, beim Personal die Personalnummer und beim
Material die Bestandsnummer. Ein Name ist beim Personal nie die Kennung. Ein mitbenutzter
Datensatz MUST unverändert bleiben. Kataloge (Fahrzeug- und Personalstatus, Einheitstypen,
Qualifikationen, Materialkategorien) MUST nur mitbenutzt werden, und zwar nur aktive
Einträge. Fehlt ein benötigter Katalogeintrag, MUST der Import mit 422 abbrechen, den
fehlenden Eintrag nennen und nichts anlegen. Der Import MUST NOT ein Benutzerkonto anlegen
und MUST NOT eine Zuordnung zwischen Personal und Benutzerkonto setzen.

#### Scenario: Leere Organisation
- **WHEN** der Admin in eine Organisation ohne eigene Fahrzeuge, Personal und Material importiert
- **THEN** meldet der Bericht je Art „N angelegt, 0 mitbenutzt“, und alle angelegten Zeilen tragen die Demo-Marke

#### Scenario: Außer Dienst gestelltes Fahrzeug gleichen Namens
- **WHEN** ein Fahrzeug mit dem Funkrufnamen eines Demo-Fahrzeugs nur außer Dienst existiert
- **THEN** legt der Import ein neues Fahrzeug mit Demo-Marke an und lässt das außer Dienst gestellte unverändert

#### Scenario: Fehlender Katalogeintrag
- **WHEN** der Organisation ein Einheitstyp fehlt, den das Szenario braucht
- **THEN** antwortet der Import mit 422, die Meldung nennt den Einheitstyp, und die Datenbank ist unverändert

#### Scenario: Kein Benutzerkonto
- **WHEN** ein Import durchläuft
- **THEN** ist die Zahl der Benutzerkonten vorher und nachher gleich

### Requirement: Demo-Einsatz

Der Import SHALL genau einen Einsatz anlegen: Einsatzart `uebung`, Bezeichnung beginnend
mit „ÜBUNG – “, Stichwort aus dem Bereich Unwetter bzw. Starkregen, ein fiktiver Ort,
erkennbar fiktive Personennamen. Der Einsatz MUST befüllen: Einsatzabschnitte Betreuung,
Sanitätsdienst und Logistik mit unterschiedlichem Lagezustand, Einheiten mit Fahrzeugen im
FMS-Status und Rückmeldungen, von denen mindestens eine überfällig ist, eine UHS mit
gesichteten Betroffenen aller Kategorien SK I–IV nach BBK, einen Bereitstellungsraum, eine
Betreuungsstelle mit Belegung, einen aktiven Evakuierungsbezirk, Gefahrengebiete mit
Warnstufe auf der Lagekarte, Meldungen, Aufträge, einen freigegebenen Befehl, einen
freigegebenen Lagebericht, Erinnerungen und ETB-Einträge der Typen Meldung, Anordnung,
Lage, Entscheidung und System. Der importierende Admin MUST Einsatzleitung sein, weitere
Mitgliedschaften MUST NOT entstehen. Einen maßgeblichen Pegel MUST NOT der Import
festlegen. Nummernkreise (Einsatznummer, ETB, Meldungen, Aufträge, Registriernummern)
MUST über dieselben Funktionen vergeben werden wie im Betrieb.

#### Scenario: Überblick zeigt die Lage
- **WHEN** der Admin nach dem Import den Demo-Einsatz öffnet
- **THEN** zeigt die Einsatzliste ihn mit Einsatzart Übung, und der Einsatz meldet die Lagekennzahl „evakuiert“, aber keine „pegel“

#### Scenario: Sichtung nach BBK
- **WHEN** die Betroffenen des Demo-Einsatzes abgefragt werden
- **THEN** kommt jede der Kategorien SK I, SK II, SK III und SK IV mindestens einmal vor

#### Scenario: Einzige Mitgliedschaft
- **WHEN** die Mitglieder des Demo-Einsatzes abgefragt werden
- **THEN** ist der importierende Admin das einzige Mitglied, mit der Rolle Einsatzleitung

### Requirement: Zeitachse relativ zum Importzeitpunkt

Alle fachlichen Zeitpunkte des Demo-Einsatzes SHALL relativ zum Importzeitpunkt liegen:
Einsatzbeginn einige Stunden davor, der jüngste Eintrag wenige Minuten davor, nichts in
der Zukunft außer höchstens einer Erinnerung. Die ETB-Einträge MUST in aufsteigender
laufender Nummer auch aufsteigende Ereigniszeiten tragen. Jeder ETB-Eintrag des
Demo-Einsatzes MUST als Eingangszeit seine Ereigniszeit tragen, auch Systemeinträge aus
Nebenwirkungen. Diese Regel MUST NOT ETB-Einträge anderer Einsätze berühren. Beim Import
MUST NOT ein Alarm entstehen: Vergangene Fälligkeiten MUST als ausgelöst oder erledigt
gelten, und es MUST keine unbestätigte Meldung mit abgelaufener Bestätigungsfrist geben.

#### Scenario: Keine Nachtrag-Marke
- **WHEN** die ETB-Einträge des Demo-Einsatzes gelesen werden
- **THEN** weicht bei keinem Eintrag die Eingangszeit von der Ereigniszeit ab

#### Scenario: Chronologie
- **WHEN** die ETB-Einträge nach laufender Nummer sortiert werden
- **THEN** sind ihre Ereigniszeiten nicht fallend, und die jüngste liegt vor dem Importzeitpunkt

#### Scenario: Kein Alarm nach dem Import
- **WHEN** der Erinnerungs-Scheduler nach dem Import einen Takt ausführt
- **THEN** löst er keine Erinnerung des Demo-Einsatzes aus und eskaliert keine Meldung

### Requirement: Import ist atomar

Der Import SHALL in einer einzigen Schreibtransaktion laufen. Scheitert ein Schritt, MUST
die Datenbank im Stand vor dem Import bleiben: kein Einsatz, keine Stammdaten, kein
Kopf-Datensatz.

#### Scenario: Abbruch mitten im Import
- **WHEN** ein Schritt des Imports scheitert, etwa an einem fehlenden Katalogeintrag
- **THEN** existieren danach weder Demo-Einsatz noch Demo-Stammdaten noch ein aktiver Kopf-Datensatz

### Requirement: Demo-Daten entfernen

`DELETE /api/demo-daten` SHALL in einer Schreibtransaktion den Demo-Einsatz der eigenen
Organisation samt allem, was an ihm hängt, hart löschen und danach die markierten
Stammdaten. Der Löschweg MUST an die Marke gebunden sein: Er löscht nur den Einsatz, den
der aktive Kopf-Datensatz der eigenen Organisation nennt, und nur Stammdatenzeilen aus der
Marke. Eine markierte Stammdatenzeile, auf die nach dem Löschen des Einsatzes noch
irgendein Datensatz verweist, MUST stehen bleiben und ihre Marke verlieren. Der Bericht
MUST sie als „behalten“ zählen. Besteht kein aktiver Import, MUST das System mit 409
antworten. Nach dem Entfernen MUST die Datenbank in allen Nutzdatentabellen dieselben Zeilen
tragen wie vor dem Import. Ausgenommen sind der Kopf-Datensatz als Historie, die als
„behalten“ gemeldeten Stammdaten, Sitzungen und Anmeldeprotokoll, Benutzereinstellungen,
SQLite-Verwaltungstabellen und die Schattentabellen der Volltextsuche.

#### Scenario: Nachbar-Einsatz bleibt unberührt
- **WHEN** neben dem Demo-Einsatz ein echter Einsatz mit ETB, Personen und disponierten echten Stammdaten besteht und der Admin die Demo-Daten entfernt
- **THEN** ist der echte Einsatz samt ETB, Personen, Dispositionen und Stammdaten zeilengleich erhalten

#### Scenario: Stand vor dem Import
- **WHEN** der Admin importiert und danach entfernt
- **THEN** stimmen die Zeilenmengen aller Nutzdatentabellen außer den Ausnahmen mit dem Stand vor dem Import überein

#### Scenario: Demo-Fahrzeug im echten Einsatz
- **WHEN** ein Demo-Fahrzeug inzwischen in einem echten Einsatz disponiert ist und der Admin entfernt
- **THEN** bleibt das Fahrzeug stehen, verliert die Demo-Marke und erscheint im Bericht unter „behalten“
- **AND** die Disposition im echten Einsatz ist unverändert

#### Scenario: Nichts zu entfernen
- **WHEN** der Admin entfernt, ohne dass ein aktiver Import besteht
- **THEN** antwortet das System mit 409 und ändert nichts

#### Scenario: Soft-gelöschter Demo-Einsatz
- **WHEN** der Demo-Einsatz abgeschlossen und von der Aufbewahrungsfrist bereits als gelöscht markiert oder geschwärzt ist
- **THEN** entfernt der Löschweg ihn trotzdem vollständig

### Requirement: Neu importieren

`POST /api/demo-daten/neu` SHALL Entfernen und Import in einer einzigen Schreibtransaktion
ausführen. Scheitert der Import, MUST der bisherige Demo-Stand erhalten bleiben. Besteht
kein aktiver Import, MUST der Vorgang wie ein erstmaliger Import laufen.

#### Scenario: Import, Entfernen, Import gegen das aktuelle Schema
- **WHEN** gegen die vollständig migrierte Datenbank importiert, entfernt und erneut importiert wird
- **THEN** gelingen alle drei Schritte, und der zweite Import meldet dieselben Zahlen wie der erste

#### Scenario: Neu importieren ersetzt den Stand
- **WHEN** der Admin bei aktivem Import „Neu importieren“ auslöst
- **THEN** besteht danach genau ein aktiver Import mit einem neuen Demo-Einsatz, und der alte Demo-Einsatz existiert nicht mehr

### Requirement: Keine Wiederverwendung der Einsatz-ID

Das System SHALL einem neu angelegten Einsatz nie eine ID geben, die ein entfernter
Demo-Einsatz getragen hat. Die ID eines Demo-Einsatzes MUST im Kopf-Datensatz erhalten
bleiben, und jede Einsatzanlage MUST eine ID oberhalb aller bestehenden und aller so
gesperrten IDs vergeben.

#### Scenario: Echter Einsatz nach dem Entfernen
- **WHEN** der Demo-Einsatz der jüngste Einsatz war, entfernt wird und danach ein echter Einsatz angelegt wird
- **THEN** trägt der echte Einsatz eine größere ID als der entfernte Demo-Einsatz

### Requirement: Invalidierung nach Import und Entfernen

Nach einem erfolgreichen Entfernen SHALL das System offenen Live-Verbindungen des
Demo-Einsatzes ein Resynchronisations-Signal senden. Die Oberfläche MUST nach Import,
Neu-Import und Entfernen die Einsatzliste, die Stammdaten-Kataloge, den Demo-Status und
die Abfragen des betroffenen Demo-Einsatzes neu laden.

#### Scenario: Offener Tab beim Entfernen
- **WHEN** ein Client den Live-Strom des Demo-Einsatzes abonniert hat und der Admin entfernt
- **THEN** erhält der Client ein Resynchronisations-Signal

### Requirement: Verwaltungssektion Demo-Daten

Die Verwaltung SHALL eine Sektion „Demo-Daten“ zeigen, und zwar nur dem System-Admin und
nur, wenn der Import freigeschaltet ist. Die Sektion MUST den Status zeigen (nicht
importiert, oder importiert am … mit Einsatz) sowie den Bericht des letzten Vorgangs. Sie
MUST die Aktionen „Importieren“ (ohne aktiven Import), „Neu importieren“ und „Entfernen“
(mit aktivem Import) anbieten. „Neu importieren“ und „Entfernen“ MUST eine Rückfrage mit
`danger`-Knopf verlangen. Ein Fehler MUST an der Seite stehen und nicht nur im Toast. Eine
zweite Auslösung während eines laufenden Vorgangs MUST wirkungslos sein.

#### Scenario: Ohne Freischaltung kein Einstieg
- **WHEN** der Status-Endpunkt mit 404 antwortet
- **THEN** zeigt die Verwaltung keine Sektion „Demo-Daten“, und die Route leitet weg

#### Scenario: Führungskraft
- **WHEN** eine Führungskraft ohne System-Admin-Rolle die Verwaltung öffnet
- **THEN** sieht sie keine Sektion „Demo-Daten“, und die Route leitet sie weg

#### Scenario: Entfernen mit Rückfrage
- **WHEN** der Admin „Entfernen“ wählt
- **THEN** erscheint eine Rückfrage mit `danger`-Knopf, und erst die Bestätigung sendet `DELETE`

### Requirement: Hinweis in der Einsatzliste

Die Einsatzliste SHALL dem System-Admin einen Hinweis mit Verweis auf die Sektion
„Demo-Daten“ zeigen, solange der Import freigeschaltet ist und für seine Organisation kein
aktiver Import besteht. Anderen Rollen MUST der Hinweis fehlen, und für sie MUST die
Einsatzliste den Demo-Status gar nicht abfragen. Nach dem Import MUST der Hinweis
verschwinden.

#### Scenario: Freigeschaltet und nicht importiert
- **WHEN** der System-Admin die Einsatzliste öffnet, der Import freigeschaltet ist und nichts importiert wurde
- **THEN** steht ein Hinweis mit Verweis auf die Sektion „Demo-Daten“

#### Scenario: Nicht freigeschaltet
- **WHEN** der Status-Endpunkt mit 404 antwortet
- **THEN** steht kein Hinweis, und es gibt keine Fehlermeldung

#### Scenario: Andere Rolle
- **WHEN** eine Person ohne System-Admin-Rolle die Einsatzliste öffnet
- **THEN** steht kein Hinweis, und es geht keine Anfrage an `/api/demo-daten`
