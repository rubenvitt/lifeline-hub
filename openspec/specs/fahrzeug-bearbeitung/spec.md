# fahrzeug-bearbeitung Specification

## Purpose
Legt fest, wie ein disponiertes Fahrzeug im Einsatz bearbeitet wird: Einheit, Abschnitt und
Status-seit in der Fahrzeugliste, die Einheit in der Zeile ändern, die Angaben eines
Ad-hoc-Fahrzeugs korrigieren, die Angaben eines Stamm-Fahrzeugs im Stamm lassen und die
Aktionen einer Zeile ordnen.

## Requirements

### Requirement: Einheit, Abschnitt und Status-seit in der Fahrzeugliste

Die Fahrzeugliste SHALL je Fahrzeug die Einheit, den Abschnitt und den Zeitpunkt des aktuellen
Status („Seit“) zeigen. Der Abschnitt MUST der eigene Abschnitt der Einheit sein, sonst der
Abschnitt der nächsten übergeordneten Einheit, die einen trägt. Das FMS-Tableau derselben Seite
MUST nach demselben Abschnitt gliedern. Ohne Freigabe des Moduls Einheiten MUST die Liste
Einheit und Abschnitt weglassen und darf keine Einheitennamen aus einer anderen Quelle zeigen.

#### Scenario: Gruppe unter einem Zug
- **WHEN** die Gruppe „Staffel A“ ohne eigenen Abschnitt dem Zug „Zug 1“ im Abschnitt „Sanitätsdienst“ unterstellt ist und das Fahrzeug „83-1“ zur Staffel A gehört
- **THEN** zeigt die Liste bei 83-1 Einheit „Staffel A“ und Abschnitt „Sanitätsdienst“
- **AND** steht 83-1 im FMS-Tableau in der Gruppe „Sanitätsdienst“, nicht in „ohne Abschnitt“

#### Scenario: Eigener Abschnitt der Untereinheit
- **WHEN** die Staffel A selbst den Abschnitt „UHS Turnhalle“ trägt, ihr Zug aber „Sanitätsdienst“
- **THEN** zeigen Liste und Tableau bei 83-1 den Abschnitt „UHS Turnhalle“

#### Scenario: Seit
- **WHEN** 83-1 um 14:05 auf „S4 · Am Einsatzort“ gesetzt wurde
- **THEN** steht in der Spalte „Seit“ 14:05 in der Anzeigezone des Einsatzes

#### Scenario: Ohne Freigabe Einheiten
- **WHEN** eine Rolle das Modul Fahrzeuge, aber nicht das Modul Einheiten sieht
- **THEN** hat die Liste keine Spalten Einheit und Abschnitt, und das Tableau steht ungegliedert

### Requirement: Einheit eines Fahrzeugs in der Liste ändern

Wer im Modul Einheiten schreiben darf, SHALL die Einheit eines Fahrzeugs in seiner Zeile wählen
oder leeren können; geschrieben MUST über die Zuordnungswege des Moduls Einheiten werden. Ein
Wechsel von Einheit A zu Einheit B MUST beide Einheiten live melden und im ETB die vorige Einheit
nennen. Die Wahl der schon zugeordneten Einheit MUST nichts schreiben. Eine Ablehnung MUST an der
Zelle stehen.

#### Scenario: Umhängen
- **WHEN** das Fahrzeug „83-1“ von „Zug 1“ zu „Zug 2“ gewählt wird
- **THEN** gehört 83-1 zu Zug 2, das Meldebild von Zug 1 zeigt es ohne Neuladen nicht mehr
- **AND** steht im ETB „Einheit «Zug 2»: Fahrzeug «83-1» zugeordnet, vorher «Zug 1»“

#### Scenario: Gleiche Einheit
- **WHEN** für 83-1 noch einmal „Zug 2“ gesendet wird
- **THEN** antwortet der Server ohne Fehler und schreibt keinen ETB-Eintrag

#### Scenario: Nur Recht an Fahrzeugen
- **WHEN** eine Rolle Fahrzeuge schreiben darf, im Modul Einheiten aber nur lesen
- **THEN** zeigt die Zelle die Einheit ohne Auswahl

### Requirement: Angaben eines Ad-hoc-Fahrzeugs ändern

Das System SHALL Funkrufname, Typ, Kennzeichen, Trägerorganisation und OPTA eines
Ad-hoc-Fahrzeugs im Einsatz ändern können, ein leeres optionales Feld als Leeren; ein leerer
Funkrufname MUST mit 400 abgelehnt werden. Eine Änderung MUST genau einen ETB-Eintrag erzeugen,
der jede geänderte Angabe mit altem und neuem Wert nennt; ohne Änderung entsteht keiner. Die
Oberfläche MUST nur geänderte Angaben senden.

#### Scenario: Tippfehler im Funkrufnamen
- **WHEN** beim Ad-hoc-Fahrzeug „Florian Nachbarstdt 44/1“ der Funkrufname zu „Florian Nachbarstadt 44/1“ und der Typ von leer zu „HLF 20“ geändert wird
- **THEN** zeigen Liste, Tableau und Einheit-Ansicht den neuen Namen
- **AND** steht im ETB genau ein neuer Eintrag mit „Funkrufname «Florian Nachbarstdt 44/1» → «Florian Nachbarstadt 44/1»“ und „Typ «—» → «HLF 20»“

#### Scenario: Leerer Funkrufname
- **WHEN** der Funkrufname eines Ad-hoc-Fahrzeugs als leerer Text gesendet wird
- **THEN** antwortet der Server mit 400, und nichts ändert sich

### Requirement: Angaben eines Stamm-Fahrzeugs bleiben im Stamm

Enthält die Änderung eines Stamm-Fahrzeugs eine seiner Stamm-Angaben (Funkrufname, Typ,
Kennzeichen, Trägerorganisation, OPTA), MUST das System mit 422 antworten und nichts schreiben,
auch keinen mitgesendeten Status. Die Oberfläche MUST den Eintrag zum Ändern der Angaben bei
einem Stamm-Fahrzeug gesperrt mit dem Grund „aus dem Stamm“ zeigen und nur einem Admin der
Organisation des Einsatzes den Sprung in den Stamm anbieten.

#### Scenario: Stamm-Fahrzeug
- **WHEN** für ein Stamm-Fahrzeug ein Funkrufname und ein neuer Status gesendet werden
- **THEN** antwortet der Server mit 422 „im Stamm pflegen“, und weder Name noch Status ändern sich

#### Scenario: Stamm-Fahrzeug im Menü
- **WHEN** das Zeilenmenü eines Stamm-Fahrzeugs geöffnet wird
- **THEN** steht „Angaben ändern“ deaktiviert mit „aus dem Stamm“, und nur ein Admin der Organisation sieht „Im Stamm ändern ↗“

### Requirement: Zeilenaktionen eines Fahrzeugs

Die Tabelle der Fahrzeugliste SHALL je Zeile ein Aktionsmenü führen, dessen erster Eintrag
„Entlassen“ ist; danach folgen die weiteren Aktionen eines Fahrzeugs (Angaben ändern, beim
Stamm-Fahrzeug der Sprung in den Stamm), Stornieren rot hinter einem Trenner. „Entlassen“ MUST
ohne Rückfrage wirken und einen Rückgängig-Hinweis zeigen. Auf der Karte (schmale Fläche) MUST
„Entlassen“ die sichtbare Hauptaktion sein und im Menü fehlen. Das Lösen einer Person von der
Besatzung MUST „Vom Fahrzeug lösen“ heißen und ohne Rückfrage wirken.

#### Scenario: Ad-hoc-Fahrzeug in der Tabelle
- **WHEN** das Menü eines Ad-hoc-Fahrzeugs in der Tabelle geöffnet wird
- **THEN** stehen „Entlassen“, „Angaben ändern …“, ein Trenner und rot „Stornieren“

#### Scenario: Entlassen aus dem Menü
- **WHEN** im Menü „Entlassen“ gewählt wird
- **THEN** ist das Fahrzeug ohne Rückfrage entlassen, und „Rückgängig“ steht bereit

#### Scenario: Karte
- **WHEN** die Fahrzeugliste als Karte erscheint
- **THEN** steht „Entlassen“ als Knopf auf der Karte und nicht im Menü

#### Scenario: Person lösen
- **WHEN** bei einer Person der Besatzung „Vom Fahrzeug lösen“ gewählt wird
- **THEN** sitzt sie ohne Rückfrage auf keinem Fahrzeug mehr
