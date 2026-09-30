# Spec Delta

## Purpose

Die Checkliste zur Arbeitsaufnahme der Führungseinheit: sieben feste Punkte für die ersten Minuten
eines Einsatzes (LFS-BW F5-I Kap. 5; HLFS „Aufgaben S3“ Kap. 5; FwDV 100 Anlage 5). Sie ist ein
Arbeitsmittel am Fahrzeug und kein Führungsnachweis. Allein die Meldung der Einsatzbereitschaft an
die Leitstelle wird im ETB belegt.

## ADDED Requirements

### Requirement: Sieben feste Punkte mit Quelle
Die Checkliste SHALL genau sieben Punkte in fester Reihenfolge führen: Aufstellort des ELW
festgelegt, Einweisung durch die Einsatzleitung erhalten, Lageskizze begonnen,
Funkarbeitsplätze eingerichtet, Sprechgruppen zugeteilt, ETB eröffnet, Einsatzbereitschaft an die
Leitstelle gemeldet. Jeder Punkt MUST seine Quelle sichtbar tragen. Die Punkte MUST NOT je
Organisation oder Einsatz konfigurierbar sein, und ein Punkt MUST NOT aus dem Zustand eines anderen
Moduls abgeleitet werden.

#### Scenario: Neuer Einsatz
- **WHEN** eine Person mit Leserecht auf den Stab die Stabseite eines neuen Einsatzes öffnet
- **THEN** zeigt das Paneel „Arbeitsaufnahme“ sieben offene Punkte in dieser Reihenfolge, jeder
  mit Quelle, und den Zähler „0/7 erledigt“

#### Scenario: ETB hat schon Einträge
- **WHEN** im ETB des Einsatzes bereits Einträge stehen, der Punkt „ETB eröffnet“ aber nicht
  abgehakt ist
- **THEN** bleibt der Punkt offen

### Requirement: Speicherung lazy, idempotent, umkehrbar
Ein Punkt SHALL erst beim ersten Speichern eines Hakens oder einer Bemerkung gespeichert werden.
Das Lesen MUST nur gespeicherte Punkte liefern, ein fehlender Punkt gilt als offen und ohne
Bemerkung. Das Setzen eines Punkts SHALL idempotent sein: Derselbe Aufruf zweimal ergibt denselben
Zustand und keine zweite Wirkung. Ein Haken SHALL ohne Rückfrage setzbar und entfernbar sein. Wer
den Haken entfernt, MUST die Bemerkung des Punkts erhalten. Ein Aufruf, der nur den Haken oder nur
die Bemerkung trägt, MUST die jeweils andere Angabe unverändert lassen.

#### Scenario: Erster Haken
- **WHEN** eine Person mit Schreibrecht „Lageskizze begonnen“ abhakt
- **THEN** ist der Punkt erledigt, trägt den Zeitpunkt des Hakens, und der Zähler steht auf „1/7
  erledigt“

#### Scenario: Doppelter Aufruf
- **WHEN** derselbe Haken zweimal gesendet wird
- **THEN** bleibt der Zeitpunkt des ersten Hakens stehen, und es entsteht keine zweite Wirkung

#### Scenario: Haken entfernen
- **WHEN** eine Person den Haken eines erledigten Punkts mit Bemerkung entfernt
- **THEN** ist der Punkt offen, die Bemerkung bleibt, und es erschien keine Rückfrage

#### Scenario: Bemerkung auf zweitem Schirm
- **WHEN** Schirm A einen Punkt abhakt und Schirm B danach eine Bemerkung zum selben Punkt speichert
- **THEN** ist der Punkt erledigt und trägt die Bemerkung

#### Scenario: Ungültige Eingaben
- **WHEN** ein unbekannter Punkt, ein Aufruf ohne Haken und ohne Bemerkung oder eine Bemerkung
  über 500 Zeichen gesendet wird
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

### Requirement: ETB-Beleg nur für die Meldung an die Leitstelle
Das Setzen oder Entfernen eines Hakens MUST NOT einen ETB-Eintrag erzeugen, mit einer Ausnahme:
Wird der Punkt „Einsatzbereitschaft an die Leitstelle gemeldet“ von offen auf erledigt gesetzt,
SHALL in derselben Transaktion genau ein System-ETB-Eintrag entstehen, der diese Meldung belegt.
Wird der Haken dieses Punkts entfernt, SHALL in derselben Transaktion genau ein System-ETB-Eintrag
die Rücknahme belegen (Entscheidung E1, Option A). Ein Aufruf ohne
Zustandswechsel MUST NOT ins ETB schreiben. Die Bemerkung MUST NOT in den ETB-Text eingehen.

#### Scenario: Andere Punkte
- **WHEN** eine Person die ersten sechs Punkte abhakt und wieder entfernt
- **THEN** hat das ETB keinen neuen Eintrag

#### Scenario: Meldung an die Leitstelle
- **WHEN** eine Person „Einsatzbereitschaft an die Leitstelle gemeldet“ abhakt
- **THEN** steht genau ein neuer System-Eintrag im ETB, der die Meldung belegt, und die
  ETB-Chronologie anderer Betrachter aktualisiert sich live

#### Scenario: Wiederholter Haken an der Meldung
- **WHEN** der erledigte Punkt „Einsatzbereitschaft an die Leitstelle gemeldet“ erneut als erledigt
  gesendet wird
- **THEN** entsteht kein weiterer ETB-Eintrag

#### Scenario: Rücknahme der Meldung
- **WHEN** eine Person den Haken an „Einsatzbereitschaft an die Leitstelle gemeldet“ entfernt
- **THEN** steht genau ein System-Eintrag im ETB, der die Rücknahme belegt

### Requirement: Rechte und Lebenszyklus wie der Stab
Lesen SHALL jedem Mitglied mit Leserecht auf das Stab-Modul möglich sein, auch Beobachtern.
Schreiben SHALL dasselbe Recht verlangen wie die Besetzung. In einem nicht aktiven Einsatz MUST
jeder Schreibversuch mit 409 scheitern. Ohne Schreibrecht MUST die Fläche die Haken gesperrt zeigen
und den Grund nennen.

#### Scenario: Beobachter
- **WHEN** ein Beobachter die Stabseite öffnet
- **THEN** sieht er den Stand der Checkliste, die Haken sind gesperrt, und der Hinweis im
  Seitenkopf nennt den Grund

#### Scenario: Abgeschlossener Einsatz
- **WHEN** ein Haken an einem abgeschlossenen Einsatz gesendet wird
- **THEN** antwortet der Server mit 409, und nichts wird gespeichert

### Requirement: Fläche auf der Stabseite
Die Stabseite SHALL die Checkliste als eigenes Paneel „Arbeitsaufnahme“ unter den bestehenden
Paneelen zeigen, mit dem Zähler der erledigten Punkte, sobald Daten vorliegen. Jede Zeile SHALL den
Haken samt Punkttext als eine Trefffläche anbieten, die auf jeder Dichtestufe mindestens die
Steuerhöhe erreicht. Ein erledigter Punkt SHALL die Uhrzeit des Hakens zeigen. Die Bemerkung SHALL
inline bearbeitbar sein und im leeren Zustand sagen, dass man sie schreiben kann. Scheitert das
Speichern, MUST der Fehler an der Zeile stehen, nicht als Toast, und der Haken MUST den
Serverstand zeigen. Scheitert das Laden, MUST ein Fehler mit Wiederholen statt offener Punkte
stehen. Besetzung und Lagebesprechung MUST unverändert bleiben.

#### Scenario: Tipp auf den Text
- **WHEN** eine Person mit Schreibrecht auf den Text einer Zeile tippt
- **THEN** wechselt der Haken der Zeile

#### Scenario: Speichern scheitert
- **WHEN** der Server einen Haken ablehnt
- **THEN** steht der Fehler an dieser Zeile, der Haken zeigt den vorigen Stand, und es erscheint
  kein Toast

#### Scenario: Laden scheitert
- **WHEN** die Checkliste nicht geladen werden kann
- **THEN** zeigt das Paneel einen Fehler mit Wiederholen und keine offenen Punkte

#### Scenario: Live auf zweitem Schirm
- **WHEN** Schirm A einen Punkt abhakt
- **THEN** zeigt Schirm B den Punkt ohne Neuladen als erledigt

### Requirement: Schwärzung
Die Bemerkung eines Punkts MUST bei der Schwärzung eines Einsatzes entfernt werden. Punkt, Haken,
Zeitpunkte und Verweise bleiben als Skelett erhalten.

#### Scenario: Einsatz geschwärzt
- **WHEN** ein Einsatz mit Bemerkungen in der Checkliste geschwärzt wird
- **THEN** sind alle Bemerkungen leer, und die Haken samt Zeitpunkten bleiben
