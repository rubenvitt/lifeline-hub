# Spec Delta

## Purpose

Die Lagebesprechung ist ein eigenes Einsatzmodul unter Führung: Termin der nächsten Besprechung,
Vorbereitung, Abschluss mit Entschluss und Verlauf an einem Ort, mit eigener Freigabe und
unabhängig vom Modul Stab (FwDV 100, 3.3.3.2).

## ADDED Requirements

### Requirement: Eigenes Modul mit eigener Freigabe
Das System SHALL ein Einsatzmodul mit dem Key `lagebesprechung` in der Kategorie Führung führen, mit
dem Namen „Lagebesprechung“ und der Seite `/einsaetze/<id>/lagebesprechung`. Seine Freigabe MUST
allein nach den Regeln der Fähigkeit `modul-freigabe` für diesen Key entschieden werden. Die
Freigabe des Moduls Stab MUST NOT darauf wirken, weder auf Seite und Einstiege noch auf die
Endpunkte.

#### Scenario: Stab ausgeblendet
- **WHEN** im Einsatz das Modul Stab ausgeblendet ist und die Lagebesprechung nicht
- **THEN** öffnet ein Mitglied die Seite Lagebesprechung, sieht Termin, Vorbereitung und Verlauf, und mit Schreibrecht kann es eine Lagebesprechung abschließen

#### Scenario: Lagebesprechung ausgeblendet
- **WHEN** im Einsatz das Modul Lagebesprechung ausgeblendet ist
- **THEN** beantwortet der Server Lesen und Schreiben der Lagebesprechung mit 403, und Rail, Modulmenü und Palette führen das Modul nicht

### Requirement: Rechte der Lagebesprechung
Lesen SHALL jedes Mitglied mit Freigabe des Moduls dürfen. Termin setzen und Abschließen SHALL nur
mit der Einsatzrolle Einsatzleitung oder Führungspersonal möglich sein; eine System-Rolle allein
MUST NOT genügen. An einem abgeschlossenen Einsatz MUST jeder Schreibweg mit 409 abgelehnt werden.
Ohne Schreibrecht MUST die Seite Schreibaktionen gesperrt mit Grund zeigen.

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Seite öffnet
- **THEN** sieht er Termin, Vorbereitung und Verlauf, die Primäraktion und die Schnellwahl sind gesperrt mit Grund, und ein direkter Schreibaufruf von ihm wird mit 403 abgelehnt

#### Scenario: Abgeschlossener Einsatz
- **WHEN** an einem abgeschlossenen Einsatz der Termin gesetzt oder eine Lagebesprechung abgeschlossen wird
- **THEN** antwortet der Server mit 409, und nichts wird gespeichert

### Requirement: Übernahme der Stab-Rollen bei Einführung
Bei Einführung des Moduls SHALL jede Rollen-Vorgabe, die für das Modul Stab gesetzt ist, für die
Lagebesprechung übernommen werden. Das gilt je Einsatz und je Organisation. Eine Ausblendung von
Stab MUST NOT übernommen werden. Ohne Rollen-Vorgabe für Stab MUST für die Lagebesprechung keine
Vorgabe entstehen. Spätere Änderungen an Stab MUST NOT auf die Lagebesprechung wirken.

#### Scenario: Stab auf Führungskräfte beschränkt
- **WHEN** vor der Einführung Stab in Einsatz 7 auf die Rolle `fuehrungskraft` beschränkt war
- **THEN** ist danach auch die Lagebesprechung in Einsatz 7 auf `fuehrungskraft` beschränkt

#### Scenario: Stab ausgeblendet
- **WHEN** vor der Einführung Stab in Einsatz 8 ausgeblendet war
- **THEN** ist danach die Lagebesprechung in Einsatz 8 sichtbar

### Requirement: Termin der nächsten Lagebesprechung
Die Seite SHALL den Termin der nächsten Lagebesprechung als taktische Zeit groß im Kopf zeigen,
dazu seinen Zustand als Wort: „in <Dauer>“ vor dem Termin, „kein Termin“ ohne Termin. Ab
Erreichen gilt die Regel „Ein Ton für den überfälligen Besprechungstermin“
(`lagebesprechung-vorbereitung`). Der Zustand MUST ohne Neuladen weiterlaufen. Der Termin MUST
aus derselben Spalte am Einsatz kommen, die der Einsatzkopf trägt.

#### Scenario: Termin in 25 Minuten
- **WHEN** der Termin 25 Minuten und 20 Sekunden in der Zukunft liegt
- **THEN** zeigt der Kopf die taktische Zeit des Termins und „in 25 min“

#### Scenario: Kein Termin
- **WHEN** kein Termin gesetzt ist
- **THEN** zeigt der Kopf „kein Termin“ und keine Zeit

### Requirement: Termin ohne Abschluss setzen
Personen mit Schreibrecht SHALL den Termin ohne Abschluss setzen, ändern und leeren können, per
Schnellwahl „+30 min“, „+1 h“, „+2 h“ ab jetzt, per „kein Termin“ und per freier Wahl. Der
Schreibweg MUST am Modul Lagebesprechung hängen und MUST NOT einen ETB-Eintrag schreiben. Die
Kopfdaten-Änderung (`PATCH /api/einsaetze/{id}`) MUST den Termin nicht mehr annehmen und ihn mit 400
ablehnen.

#### Scenario: Schnellwahl +1 h
- **WHEN** eine Person mit Schreibrecht um 14:05 „+1 h“ wählt
- **THEN** steht der Termin auf 15:05, im ETB entsteht kein Eintrag, und der Einsatzkopf nennt den neuen Termin

#### Scenario: Termin leeren
- **WHEN** eine Person mit Schreibrecht „kein Termin“ wählt
- **THEN** ist kein Termin mehr gesetzt, und der Kopf zeigt „kein Termin“

#### Scenario: Alter Weg über die Kopfdaten
- **WHEN** ein PATCH der Kopfdaten das Feld `naechste_lagebesprechung_at` enthält
- **THEN** antwortet der Server mit 400, und weder Termin noch andere Kopfdaten ändern sich

### Requirement: Lagebesprechung abschließen
Personen mit Schreibrecht SHALL eine Lagebesprechung abschließen können: Entschluss (Pflicht),
Zeitpunkt der Besprechung (ohne Angabe jetzt) und nächster Termin (unverändert, leeren oder
setzen). In einer Transaktion MUST das System die nächste laufende Nummer vergeben, einen
ETB-Eintrag „Entscheidung“ mit Veranlassung „Lagebesprechung“ schreiben, die Besprechung speichern
und den Termin setzen; scheitert ein Teil, MUST nichts gespeichert sein.

#### Scenario: Abschluss mit neuem Termin
- **WHEN** eine Person mit Schreibrecht den Entschluss „Abschnitt Nord räumen“ und den nächsten Termin 16:00 absendet
- **THEN** entsteht Lagebesprechung Nr. n+1, ein ETB-Eintrag „Entscheidung“ mit dem Entschluss, und der Termin steht auf 16:00

#### Scenario: Termin nicht nach der Besprechung
- **WHEN** der nächste Termin nicht nach dem Zeitpunkt der Besprechung liegt
- **THEN** antwortet der Server mit 422, und nichts wird gespeichert

### Requirement: Entschluss mit Pflicht und Längengrenze
Der Entschluss SHALL Pflicht sein und MUST höchstens 10 000 Zeichen lang sein, damit der
ETB-Eintrag der Besprechung samt Nummer, Zeit und Termin in die Grenze eines ETB-Inhalts passt.
Ein leerer oder zu langer Entschluss MUST mit 400 abgelehnt werden, und die Oberfläche MUST
dieselbe Grenze vor dem Senden zeigen.

#### Scenario: Leerer Entschluss
- **WHEN** ein Abschluss mit leerem Entschluss gesendet wird
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

#### Scenario: Zu langer Entschluss
- **WHEN** ein Abschluss mit einem Entschluss von 10 001 Zeichen gesendet wird
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

### Requirement: Verlauf der Lagebesprechungen
Die Seite SHALL alle abgeschlossenen Lagebesprechungen des Einsatzes im Paneel „Verlauf“ zeigen,
die neueste zuerst. Jede Zeile nennt Nummer, Zeitpunkt, Entschluss (gekürzt, ganz abrufbar), den
beim Abschluss gesetzten nächsten Termin und den Sprung zum ETB-Eintrag. Ohne Besprechung MUST das
Paneel sagen, dass noch keine abgeschlossen ist.

#### Scenario: Drei Besprechungen
- **WHEN** drei Lagebesprechungen abgeschlossen sind
- **THEN** zeigt der Verlauf Nr. 3, Nr. 2, Nr. 1 in dieser Folge, und der ETB-Sprung von Nr. 2 öffnet deren ETB-Eintrag

#### Scenario: Noch keine Besprechung
- **WHEN** im Einsatz noch keine Lagebesprechung abgeschlossen ist
- **THEN** sagt der Verlauf „Noch keine Lagebesprechung abgeschlossen“

### Requirement: Live-Verteilung der Lagebesprechung
Nach Abschluss oder Terminänderung SHALL das System nach dem Commit das Ereignis `lagebesprechung`
verteilen, nur an Abonnenten mit Freigabe des Moduls. Ein Abschluss SHALL daneben `etb`
verteilen. Das Ereignis `stab` MUST dabei nicht verteilt werden. Andere offene Schirme MUST Termin,
Zustand und Verlauf ohne Neuladen zeigen.

#### Scenario: Zweiter Schirm
- **WHEN** Schirm B die Seite Lagebesprechung offen hat und auf Schirm A eine Lagebesprechung abgeschlossen wird
- **THEN** zeigt Schirm B die neue Besprechung im Verlauf und den neuen Termin ohne Neuladen

#### Scenario: Leser nur mit Stab-Recht
- **WHEN** ein Mitglied mit Stab-Recht, aber ohne Freigabe der Lagebesprechung, den Strom geöffnet hat und eine Lagebesprechung ohne Terminänderung abgeschlossen wird
- **THEN** erhält es weder `lagebesprechung` noch `stab` noch `einsatz`

### Requirement: Einstiege in die Lagebesprechung
Stab-Seite, Fristenliste des Führungsüberblicks und die Schnellaktion „Lagebesprechung
abschließen“ SHALL in die Seite Lagebesprechung führen und deren Freigabe prüfen. Die Stab-Seite
MUST Termin und Zustand als kompakte Zeile mit Sprung zeigen und MUST NOT Abschluss, Verlauf oder
Vorbereitung selbst tragen. Ist das Modul gesperrt, MUST ein Einstieg gesperrt mit Grund stehen
oder fehlen.

#### Scenario: Schnellaktion
- **WHEN** eine Person mit Schreibrecht und Freigabe der Lagebesprechung in der Palette „Lagebesprechung abschließen“ wählt
- **THEN** öffnet sich die Seite Lagebesprechung mit dem Abschlussdialog, auch wenn Stab ausgeblendet ist

#### Scenario: Stab-Seite
- **WHEN** eine Person die Stab-Seite öffnet
- **THEN** zeigt sie eine Zeile mit Termin und Zustand der nächsten Lagebesprechung, die auf die Seite Lagebesprechung springt, und kein Paneel „Vorbereitung“ und keinen Verlauf

#### Scenario: Marke im Überblick ohne Freigabe
- **WHEN** eine Person ohne Freigabe der Lagebesprechung den Führungsüberblick mit einem gesetzten Termin öffnet
- **THEN** zeigt die Marke „Lagebesprechung“ den Termin, aber keinen Sprung in das Modul
