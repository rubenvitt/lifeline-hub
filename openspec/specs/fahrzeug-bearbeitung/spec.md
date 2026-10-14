# fahrzeug-bearbeitung Specification

## Purpose
Legt fest, wie ein disponiertes Fahrzeug im Einsatz bearbeitet wird: Einheit, Abschnitt und
Status-seit in der Fahrzeugliste, die Einheit in der Zeile ändern, die Angaben eines
Ad-hoc-Fahrzeugs korrigieren, die Angaben eines Stamm-Fahrzeugs im Stamm lassen, die
Aktionen einer Zeile ordnen, ein Fahrzeug als eigene Einheit führen und die freien Kräfte seiner
Einheit in einem Schritt als Besatzung übernehmen.

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
Stamm-Fahrzeug der Sprung in den Stamm, bei einem Fahrzeug ohne Einheit mit Freigabe des Moduls
Einheiten „Als eigene Einheit führen …“), Stornieren rot hinter einem Trenner. „Entlassen“ MUST
ohne Rückfrage wirken und einen Rückgängig-Hinweis zeigen. Auf der Karte (schmale Fläche) MUST
„Entlassen“ die sichtbare Hauptaktion sein und im Menü fehlen. Das Lösen einer Person von der
Besatzung MUST „Vom Fahrzeug lösen“ heißen und ohne Rückfrage wirken.

#### Scenario: Ad-hoc-Fahrzeug in der Tabelle
- **WHEN** das Menü eines Ad-hoc-Fahrzeugs mit Einheit in der Tabelle geöffnet wird
- **THEN** stehen „Entlassen“, „Angaben ändern …“, ein Trenner und rot „Stornieren“

#### Scenario: Ad-hoc-Fahrzeug ohne Einheit
- **WHEN** das Menü eines Ad-hoc-Fahrzeugs ohne Einheit in der Tabelle geöffnet wird und das Modul Einheiten freigegeben ist
- **THEN** stehen „Entlassen“, „Angaben ändern …“, „Als eigene Einheit führen …“, ein Trenner und rot „Stornieren“

#### Scenario: Entlassen aus dem Menü
- **WHEN** im Menü „Entlassen“ gewählt wird
- **THEN** ist das Fahrzeug ohne Rückfrage entlassen, und „Rückgängig“ steht bereit

#### Scenario: Karte
- **WHEN** die Fahrzeugliste als Karte erscheint
- **THEN** steht „Entlassen“ als Knopf auf der Karte und nicht im Menü

#### Scenario: Person lösen
- **WHEN** bei einer Person der Besatzung „Vom Fahrzeug lösen“ gewählt wird
- **THEN** sitzt sie ohne Rückfrage auf keinem Fahrzeug mehr

### Requirement: Fahrzeug als eigene Einheit führen

Das System SHALL aus einem Fahrzeug ohne Einheit in einem Schritt eine Einheit bilden und das
Fahrzeug ihr zuordnen; die Einheit trägt das Soll des Fahrzeugs. Gehört ein genanntes Fahrzeug
schon einer Einheit an, ist es beendet oder unbekannt, MUST das System mit 422 und einem Grund je
Fahrzeug antworten und nichts anlegen. Die neue Einheit MUST kein Zeitachsen-Ereignis aus dem
aktuellen Status des Fahrzeugs bekommen. Der Dialog MUST den Namen mit dem Funkrufnamen und den
Typ nur dann vorbelegen, wenn genau ein Katalogtyp dasselbe Soll hat; den Abschnitt bietet er nur
mit Freigabe des Moduls Einsatzabschnitte an. Geschrieben wird mit dem Recht im Modul Einheiten.

#### Scenario: Fremdfahrzeug kommt allein
- **WHEN** das Ad-hoc-Fahrzeug „Florian Nachbarstadt 44/1“ als eigene Einheit geführt wird
- **THEN** gibt es die Einheit „Florian Nachbarstadt 44/1“ mit dem Fahrzeug
- **AND** ist die Zeitachse der neuen Einheit leer

#### Scenario: Fahrzeug inzwischen zugeordnet
- **WHEN** das Fahrzeug zwischen Öffnen und Absenden des Dialogs Zug 2 zugeordnet wurde
- **THEN** antwortet das System mit 422, nennt das Fahrzeug mit „gehört zu «Zug 2»“, und keine Einheit ist angelegt

#### Scenario: Kein Typ geraten
- **WHEN** zwei Einheitentypen dasselbe Soll wie das Fahrzeug haben
- **THEN** steht im Dialog kein Typ vorbelegt

### Requirement: Besatzung kommt in die neue Einheit mit

Wird ein Fahrzeug als eigene Einheit geführt, SHALL jede aktive Person seiner Besatzung ohne
Einheit der neuen Einheit zugeordnet werden. Personen der Besatzung, die einer anderen Einheit
angehören, MUST dort bleiben. Das ETB MUST die Bildung, das Fahrzeug und die mitgekommenen Kräfte
nennen, diese in einem Eintrag.

#### Scenario: Gemischte Besatzung
- **WHEN** ein Fahrzeug mit zwei Personen ohne Einheit und einer Person aus „Zug 1“ als eigene Einheit geführt wird
- **THEN** gehören die zwei Personen der neuen Einheit an
- **AND** bleibt die dritte Person in Zug 1 und auf dem Fahrzeug
- **AND** steht im ETB „Einheit «…»: 2 Kräfte zugeordnet“ mit beiden Namen

### Requirement: Einheit bilden schreibt alles oder nichts

Das Bilden einer Einheit SHALL Einheit, Sprechgruppen, Zuordnungen und ETB-Einträge in einer
Transaktion schreiben; scheitert ein Teil, MUST nichts davon bestehen bleiben.

#### Scenario: ETB scheitert
- **WHEN** beim Bilden einer Einheit das Schreiben des ETB-Eintrags scheitert
- **THEN** gibt es die Einheit nicht, und weder Fahrzeug noch Besatzung sind zugeordnet

### Requirement: Besatzungsvorschlag aus der Einheit

Hat ein Fahrzeug eine Einheit, SHALL die Fahrzeugliste aus den aktiven Personen dieser Einheit
ohne Fahrzeug eine Besatzung vorschlagen: je Position bis zum Soll des Fahrzeugs, abzüglich der
schon sitzenden Besatzung, eine Person ohne Position als Mannschaft, den Führer der Einheit
zuerst; ohne Soll alle. Der Vorschlag MUST vor dem Übernehmen abwählbar sein. Ohne Einheit des
Fahrzeugs MUST der Knopf „Personal der Einheit übernehmen“ fehlen.

#### Scenario: Vorschlag bis zum Soll
- **WHEN** ein RTW mit Soll 0/1/1//2 der Rettungsstaffel gehört, deren freie Kräfte eine Unterführerin und drei Personen ohne Position sind
- **THEN** sind die Unterführerin und eine Person ohne Position vorgewählt

#### Scenario: Ohne freie Kräfte
- **WHEN** alle Personen der Einheit schon auf Fahrzeugen sitzen
- **THEN** steht „Personal der Einheit übernehmen“ gesperrt mit „keine freien Kräfte der Einheit“

### Requirement: Besatzung in einem Schritt übernehmen

Das System SHALL mehrere Personen in einer Anfrage einem Fahrzeug als Besatzung zuordnen, genau
einen ETB-Eintrag schreiben und jedes Fahrzeug live melden, das eine Person dabei verlässt. Ist
eine genannte Person unbekannt, aus einem anderen Einsatz oder beendet, MUST das System mit 422,
einem Grund je Person und ohne jede Zuordnung antworten; ist das Fahrzeug beendet, mit 409. Wer
schon auf dem Fahrzeug sitzt, MUST weder einen ETB-Eintrag noch eine Meldung auslösen. Geschrieben
wird mit dem Recht im Modul Fahrzeuge, wie beim Zuordnen einer einzelnen Person.

#### Scenario: Übernehmen
- **WHEN** drei vorgewählte Personen übernommen werden
- **THEN** sitzen alle drei auf dem Fahrzeug, die Besatzung zeigt Ist und Soll statt „nicht erfasst“
- **AND** steht im ETB genau ein Eintrag mit „3 Kräfte als Besatzung zugeordnet“ und den drei Namen

#### Scenario: Eine Person entlassen
- **WHEN** unter drei gewählten Personen eine inzwischen entlassen wurde
- **THEN** antwortet das System mit 422, nennt diese Person, und keine der drei sitzt auf dem Fahrzeug
