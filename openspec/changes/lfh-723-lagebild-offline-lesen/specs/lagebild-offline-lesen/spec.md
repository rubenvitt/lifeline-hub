# Spec Delta

## Purpose

Hält ausgewählte Einsatzdaten auf dem Gerät vor, damit Führungskräfte den zuletzt bekannten
Stand ihres Einsatzes auch ohne Netz lesen können. Der Stand ist dabei als veraltet erkennbar
und wird nach festen Regeln wieder vom Gerät gelöscht.

## ADDED Requirements

### Requirement: Ausgewählte Einsatzdaten bleiben ohne Netz lesbar

Das System SHALL die zuletzt erfolgreich geladenen Daten folgender Ansichten eines Einsatzes
geräteseitig vorhalten und nach einem Neuladen ohne Netz anzeigen:

- **ETB** mit Einträgen und Anzahl
- **Meldebild** mit Einheiten, Personal, Fahrzeugen, Material, Abschnitten, Aufträgen und
  Rückmeldungen
- **Betroffene** mit Personen und Unfallhilfsstellen
- **Aufträge** mit Aufträgen und Befehlen
- **Lagekarte** mit den Datenebenen des Einsatzes

Dazu SHALL das System die Rahmendaten vorhalten, ohne die diese Ansichten nicht darstellbar
sind: Einsatzkopf, Modulfreigaben, Einsatzeinstellungen, Modulzähler, Einsatzliste,
Kartenkonfiguration, Organisation und Fahrzeugstatus-Katalog. Vorgehalten wird nur, was die
Person zuvor mit Netz tatsächlich geladen hat.

#### Scenario: Neuladen ohne Netz zeigt den letzten Stand

- **WHEN** eine angemeldete Person die ETB-Seite eines Einsatzes mit Netz geöffnet hat, das
  Netz wegfällt und sie die Seite neu lädt
- **THEN** zeigt die ETB-Seite die zuvor geladenen Einträge und landet nicht auf der Anmeldung

#### Scenario: Jede ausgewählte Ansicht übersteht den Offline-Neuladen

- **WHEN** eine Person Meldebild, Betroffene, Aufträge und Lagekarte mit Netz besucht hat und
  sie ohne Netz neu lädt
- **THEN** zeigt jede dieser Ansichten ihren zuletzt geladenen Stand, und die Lagekarte
  zeichnet ihre Datenebenen

#### Scenario: Nie geladene Ansicht bleibt ohne Netz leer

- **WHEN** eine Person eine Ansicht ohne Netz öffnet, die sie mit Netz nie geladen hat
- **THEN** zeigt das System keine Daten dieser Ansicht an und erfindet keinen Stand

### Requirement: Nur die Allowlist wird geräteseitig gespeichert

Das System MUST ausschließlich die Daten der Ansichten aus der Anforderung „Ausgewählte
Einsatzdaten bleiben ohne Netz lesbar“ geräteseitig speichern. Alle übrigen Daten MUST NOT
dauerhaft auf dem Gerät landen, auch dann nicht, wenn sie im laufenden Tab geladen waren.
Das gilt etwa für Chat, Dokumente, Einstellungsseiten, Personen-Audit, Druckansichten,
Fremdquellen der Lagekarte sowie Wetter und Pegel. Gespeichert werden nur erfolgreich
geladene Stände, keine Fehler- oder Ladezustände.

#### Scenario: Nicht gelistete Daten erreichen die Platte nicht

- **WHEN** im Tab neben ETB-Daten auch Chat-Nachrichten und das Personen-Audit geladen sind
  und der Stand gespeichert wird
- **THEN** enthält der geräteseitige Speicher die ETB-Daten, aber weder Chat-Nachrichten noch
  Personen-Audit

### Requirement: Offline-Identität aus der letzten Serverbestätigung

Das System SHALL zusammen mit dem Stand den zuletzt vom Server bestätigten Benutzer speichern.
Scheitert die Sitzungsprüfung beim Start an einem **Netzfehler** und liegt ein gültiger Stand
für diesen Benutzer vor, SHALL das System die Person als diesen Benutzer ohne Verbindung
fortfahren lassen. Liefert der Server eine Antwort, gilt allein diese Antwort. Ohne Netz MUST
das System nur lesen: Schreibwege bleiben die bestehende Offline-Queue, und es entsteht kein
neuer Schreibweg.

#### Scenario: Netzfehler beim Start mit gültigem Stand

- **WHEN** die App ohne Netz startet und für den zuletzt bestätigten Benutzer ein Stand
  innerhalb der Höchstliegezeit vorliegt
- **THEN** ist die Person als dieser Benutzer angemeldet und sieht ihren vorgehaltenen Stand

#### Scenario: Sitzung abgelaufen

- **WHEN** die App mit Netz startet und die Sitzungsprüfung mit 401 antwortet
- **THEN** leitet das System zur Anmeldung und löscht den vorgehaltenen Stand samt Identität

#### Scenario: Netzfehler ohne vorgehaltenen Stand

- **WHEN** die App ohne Netz startet und kein gültiger Stand vorliegt
- **THEN** verhält sich das System wie bisher und zeigt die Anmeldung

### Requirement: Höchstliegezeit von 24 Stunden

Das System MUST einen vorgehaltenen Stand verwerfen, wenn die letzte erfolgreiche
Server-Antwort für diesen Benutzer mehr als 24 Stunden zurückliegt. Die Frist MUST ab der
letzten erfolgreichen Server-Antwort zählen. Lokale Änderungen am Stand ohne Server-Antwort
MUST NOT die Frist verlängern, auch nicht vorgemerkte Einträge der Offline-Queue, die im
Stand sichtbar werden.

#### Scenario: Stand älter als 24 Stunden

- **WHEN** die App ohne Netz startet und die letzte erfolgreiche Server-Antwort 25 Stunden
  zurückliegt
- **THEN** verwirft das System den Stand samt Identität und zeigt die Anmeldung

#### Scenario: Offline-Erfassung verlängert die Frist nicht

- **WHEN** eine Person ohne Netz ETB-Einträge vormerkt, während die letzte Server-Antwort 23
  Stunden zurückliegt, und die App zwei Stunden später ohne Netz neu startet
- **THEN** verwirft das System den Stand, während die vorgemerkten Einträge in der
  Offline-Queue erhalten bleiben

### Requirement: Löschen beim Abmelden, bei Sitzungsende und Benutzerwechsel

Das System MUST den vorgehaltenen Stand samt Identität vollständig vom Gerät löschen, sowohl
im Speicher der Seite als auch geräteseitig, wenn die Person sich abmeldet, wenn die Sitzung
mit 401 endet oder wenn sich ein anderer Benutzer anmeldet. Die Offline-Queue MUST dabei
unverändert bleiben.

#### Scenario: Abmelden löscht den Stand

- **WHEN** eine Person mit vorgehaltenem Stand sich abmeldet
- **THEN** enthält der geräteseitige Speicher danach keinen Stand und keine Identität mehr

#### Scenario: Abmelden lässt die Offline-Queue stehen

- **WHEN** eine Person mit vorgemerkten, noch nicht gesendeten Einträgen sich abmeldet
- **THEN** bleiben diese Einträge in der Offline-Queue erhalten

#### Scenario: Anderer Benutzer meldet sich an

- **WHEN** nach einem Sitzungsablauf ein anderer Benutzer sich am selben Gerät anmeldet
- **THEN** sieht er keinen Stand des vorherigen Benutzers, weder im Tab noch nach einem
  Neuladen

### Requirement: Löschen bei Rechteentzug

Antwortet der Server beim Abruf des Einsatzes mit 403 oder 404, MUST das System alle
vorgehaltenen Daten dieses Einsatzes löschen, im Speicher der Seite und geräteseitig.
Antwortet er beim Abruf der Daten eines Moduls mit 403, MUST das System die vorgehaltenen
Daten dieses Moduls in diesem Einsatz löschen. Die Daten anderer Einsätze und Module MUST
unberührt bleiben. Ohne Netz ist ein Rechteentzug nicht erkennbar, dafür gilt die
Höchstliegezeit.

#### Scenario: Zugriff auf den Einsatz entzogen

- **WHEN** der Abruf von Einsatz 7 mit 403 scheitert
- **THEN** enthält der geräteseitige Speicher keine Daten von Einsatz 7 mehr, während Daten
  von Einsatz 8 erhalten bleiben

#### Scenario: Modul gesperrt

- **WHEN** der Abruf der Personen von Einsatz 7 mit 403 scheitert
- **THEN** sind die Personendaten von Einsatz 7 gelöscht, sein ETB-Stand bleibt erhalten

#### Scenario: Kein Endlos-Abruf nach dem Löschen

- **WHEN** das Löschen nach einem 403 ausgelöst wurde
- **THEN** stößt das Löschen keinen erneuten Abruf an, der wiederum mit 403 scheitert

### Requirement: Offline-Kennzeichnung des Datenstands

Solange das Gerät ohne Verbindung ist, SHALL jede Ansicht aus der Allowlist ihren Datenstand
als „Stand HH:MM · offline“ ausweisen. HH:MM ist dabei die Zeit der letzten erfolgreichen
Server-Antwort für diese Daten und nicht die Zeit des Neuladens. Mit Verbindung bleibt die
Anzeige „Stand HH:MM“. Die Kennzeichnung MUST neben der Farbe einen Textkanal haben, und die
Kopfzeile MUST bei 390 px Breite ohne Layoutsprung bleiben.

#### Scenario: Offline-Neuladen zeigt die alte Uhrzeit mit Kennzeichnung

- **WHEN** die ETB-Seite um 14:32 geladen wurde und um 15:10 ohne Netz neu geladen wird
- **THEN** steht im Seitenkopf „Stand 14:32 · offline“

#### Scenario: Verbindung kehrt zurück

- **WHEN** das Gerät wieder Verbindung hat und die Daten neu geladen sind
- **THEN** steht im Seitenkopf „Stand HH:MM“ mit der neuen Uhrzeit und ohne „offline“
