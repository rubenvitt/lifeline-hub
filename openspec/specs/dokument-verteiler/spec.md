# dokument-verteiler Specification

## Purpose
Legt fest, wie ein Befehl oder Lagebericht einen Verteiler trägt, also die Stellen, an die das
Dokument geht. Geregelt sind die Pflege im Entwurf, das Einfrieren mit der Freigabe, der Weg ins
ETB, die Übernahme beim Fortschreiben und die Anzeige am Bildschirm und im Druck.

## Requirements

### Requirement: Befehl und Lagebericht tragen einen optionalen Verteiler
Befehl und Lagebericht SHALL einen geordneten, anfangs leeren Verteiler tragen. Ein Eintrag ist
ein Einsatzabschnitt, eine Einheit, eine Führungsfunktion (Katalogcode mit Bezeichnung, wo
Pflicht, oder Freitext) oder eine externe Stelle (Kategorie `leitstelle`, `nachbar_ea`,
`uebergeordnet` oder `andere_bos` und Bezeichnung). Eine Pressemitteilung MUST keinen
Verteiler tragen.

#### Scenario: Neuer Befehl
- **WHEN** jemand einen Befehl anlegt
- **THEN** liefert die Anzeige des Befehls einen leeren Verteiler

#### Scenario: Verschiedene Empfängerarten
- **WHEN** jemand den Verteiler eines Lageberichts auf „EA Süd“, „S3 Einsatz“ und die Leitstelle „ILS Musterstadt“ setzt
- **THEN** liefert die Anzeige diese drei Einträge in dieser Reihenfolge, jeden mit Art, Ziel und Anzeigenamen

#### Scenario: Pressemitteilung ohne Verteiler
- **WHEN** jemand eine Pressemitteilung lädt
- **THEN** enthält ihre Anzeige kein Feld für einen Verteiler

### Requirement: Der Verteiler wird im Entwurf als Ganzes ersetzt
Das Ändern eines Entwurfs SHALL einen Verteiler annehmen, der den bisherigen ganz ersetzt. Fehlt
das Feld, bleibt der Verteiler unverändert, und eine leere Liste leert ihn. Das Ändern von Titel,
Zeitstand, Abschnitten und Verteiler MUST ganz oder gar nicht gelingen. Es MUST nur an einem
Entwurf gelingen, sonst 422, und der Verteiler bleibt dann unverändert.

#### Scenario: Verteiler ersetzen
- **WHEN** der Verteiler eines Befehlsentwurfs „EA Süd, S3 Einsatz“ lautet und jemand ihn auf „Einheit 1. Zug“ setzt
- **THEN** lautet der Verteiler nur noch „Einheit 1. Zug“

#### Scenario: Ändern ohne Verteiler-Feld
- **WHEN** jemand nur den Titel eines Entwurfs mit gefülltem Verteiler ändert
- **THEN** bleibt der Verteiler unverändert

#### Scenario: Ungültiger Eintrag
- **WHEN** jemand Titel und Verteiler eines Entwurfs ändert und ein Eintrag auf eine Einheit eines anderen Einsatzes zeigt
- **THEN** antwortet der Server mit 400
- **AND** Titel und Verteiler bleiben unverändert

#### Scenario: Freigegebenes Dokument
- **WHEN** jemand den Verteiler eines freigegebenen Befehls ändern will
- **THEN** antwortet der Server mit 422, und der Verteiler bleibt unverändert

### Requirement: Grenzen und Prüfung der Verteiler-Einträge
Ein Verteiler MUST höchstens 50 Einträge im Request haben, gezählt vor dem Zusammenführen, sonst
400. Gleiche Einträge (gleiche Art, gleiches Ziel) MUST zu einem zusammengeführt werden, und die
erste Nennung behält ihren Platz. Eine Bezeichnung MUST höchstens 200 Zeichen haben. Eine
unbekannte Art, Person oder Fahrzeug als Art, ein Eintrag mit mehr als einem Ziel und ein Ziel
außerhalb des Einsatzes MUST 400 ergeben. Die Grenzen MUST vor jeder Datenbankabfrage geprüft
werden.

#### Scenario: Einundfünfzig Einträge
- **WHEN** ein Request 51 Verteiler-Einträge enthält
- **THEN** antwortet der Server mit 400, und am Dokument ändert sich nichts

#### Scenario: Doppelte Nennung
- **WHEN** ein Request „EA Süd, S3 Einsatz, EA Süd“ enthält
- **THEN** lautet der Verteiler „EA Süd, S3 Einsatz“

#### Scenario: Person als Empfänger
- **WHEN** ein Verteiler-Eintrag die Art „person“ trägt
- **THEN** antwortet der Server mit 400

### Requirement: Jeder Verteiler-Eintrag trägt einen Anzeigenamen aus dem Zeitpunkt des Speicherns
Jeder Eintrag SHALL beim Speichern einen Anzeigenamen bekommen, der unverändert bleibt.
Abschnitt und Einheit bekommen ihren Namen, eine Funktion „Kürzel Label“ oder „Label:
Bezeichnung“ mit dem wirksamen Label der Organisation, ein Freitext und eine externe Stelle ihren
Text. Der Name MUST NOT den Namen einer Person tragen, die eine Funktion besetzt. Ein später
gelöschter oder umbenannter Abschnitt oder eine solche Einheit MUST unter dem gespeicherten Namen
im Verteiler bleiben.

#### Scenario: Abschnitt gelöscht
- **WHEN** der Verteiler eines Befehls „EA Süd“ nennt und der Abschnitt danach gelöscht wird
- **THEN** nennt die Anzeige des Befehls weiter „EA Süd“

#### Scenario: Besetzte Funktion
- **WHEN** S3 von Schulz besetzt ist und jemand S3 in den Verteiler eines Lageberichts aufnimmt
- **THEN** lautet der Anzeigename „S3 Einsatz“ ohne „Schulz“

### Requirement: Die Freigabe schreibt den Verteiler ins ETB
Bei der Freigabe eines Dokuments mit Verteiler SHALL das `an` des ETB-Eintrags die
Anzeigenamen in Verteiler-Reihenfolge nennen, kommagetrennt. Passen sie nicht in 500 Zeichen,
endet die Angabe mit „… und N weitere“. Der Wortlaut SHALL nach Abschnitten und Anlagen einen
Abschnitt „Verteiler“ mit je einem Listenpunkt pro Eintrag tragen. Ohne Verteiler MUST `an` wie
bisher „System“ lauten und der Wortlaut unverändert bleiben.

#### Scenario: Befehl mit Verteiler
- **WHEN** ein Befehl mit dem Verteiler „EA Süd, S3 Einsatz“ freigegeben wird
- **THEN** lautet das `an` des ETB-Eintrags „EA Süd, S3 Einsatz“
- **AND** der Wortlaut endet mit „## Verteiler“ und den Punkten „- EA Süd“ und „- S3 Einsatz“

#### Scenario: Befehl ohne Verteiler
- **WHEN** ein Befehl ohne Verteiler freigegeben wird
- **THEN** lautet das `an` „System“, und der Wortlaut ist byte-gleich mit dem Wortlaut vor dieser Änderung

#### Scenario: Langer Verteiler
- **WHEN** die Anzeigenamen eines Verteilers zusammen länger als 500 Zeichen sind
- **THEN** ist das `an` höchstens 500 Zeichen lang und endet mit „… und N weitere“
- **AND** der Abschnitt „Verteiler“ im Wortlaut nennt alle Einträge

### Requirement: Fortschreiben übernimmt den Verteiler
Das Fortschreiben eines freigegebenen Dokuments SHALL den Verteiler mit Reihenfolge, Zielen und
Anzeigenamen in die neue Entwurfsfassung übernehmen, im selben Schreibvorgang. Der Verteiler der
freigegebenen Fassung MUST unverändert bleiben, wenn der neue Entwurf geändert wird.

#### Scenario: Neue Fassung
- **WHEN** ein freigegebener Lagebericht mit dem Verteiler „Leitstelle, EA Nord“ fortgeschrieben wird
- **THEN** trägt Fassung 2 den Verteiler „Leitstelle, EA Nord“

#### Scenario: Änderung an der neuen Fassung
- **WHEN** jemand den Verteiler von Fassung 2 leert
- **THEN** behält Fassung 1 ihren Verteiler

### Requirement: Der Verteiler ist im Entwurf auswählbar
Die Vollseite eines Befehls- oder Lageberichtsentwurfs SHALL ein Feld „Verteiler“ tragen. Es bietet
Einsatzabschnitte, Einheiten und Führungsfunktionen (Katalog, Besetzung als Hinweis) als
Mehrfachauswahl an, Freitext ist erlaubt. Externe Stellen SHALL als eigene Zeilen aus Kategorie
und Bezeichnung zu pflegen sein, mit den aktiven Stellen des Katalogs „Externe Stellen“ als
Vorschlag. Das Feld MUST mit dem Entwurf gespeichert werden.

#### Scenario: Verteiler wählen und speichern
- **WHEN** jemand im Befehlsentwurf „EA Süd“ und „S3 Einsatz“ wählt und den Entwurf speichert
- **THEN** zeigt der neu geladene Entwurf diese beiden Einträge im Feld „Verteiler“

#### Scenario: Externe Stelle hinzufügen
- **WHEN** jemand eine externe Zeile mit Kategorie „Leitstelle“ und der vorgeschlagenen Bezeichnung „ILS Musterstadt“ anlegt und speichert
- **THEN** trägt der Verteiler den Eintrag „ILS Musterstadt“

#### Scenario: Besetzung nicht gespeichert
- **WHEN** der Vorschlag für S2 „S2 – Lage (Müller)“ lautet und jemand ihn wählt
- **THEN** speichert der Verteiler die Funktion S2 ohne „Müller“

### Requirement: Der Verteiler steht in Lesefassung und Druckkopf
Ein freigegebenes Dokument SHALL seinen Verteiler am Bildschirm als Liste der Anzeigenamen zeigen,
auf der Vollseite und im Detail des Befehls. Der Druckkopf von Befehl und Lagebericht SHALL
eine Zeile „Verteiler“ mit den Anzeigenamen tragen. Im Entwurf MUST sie den aktuellen, auch
ungespeicherten Stand zeigen. Ein leerer Verteiler MUST im Druckkopf entfallen. Das
Eingabefeld MUST NOT mitgedruckt werden.

#### Scenario: Druck eines Entwurfs
- **WHEN** jemand im Befehlsentwurf „EA Süd“ in den Verteiler aufnimmt und vor dem Speichern druckt
- **THEN** nennt der Druckkopf „Verteiler: EA Süd“
- **AND** das Auswahlfeld erscheint nicht im Ausdruck

#### Scenario: Leerer Verteiler
- **WHEN** jemand einen Lagebericht ohne Verteiler druckt
- **THEN** trägt der Druckkopf keine Zeile „Verteiler“

#### Scenario: Freigegebener Befehl im Detail
- **WHEN** jemand im Reiter „Einsatzbefehle“ einen freigegebenen Befehl mit Verteiler öffnet
- **THEN** nennt das Detail den Verteiler

### Requirement: Der Verteiler fällt mit der Schwärzung
Die Freitexte eines Verteiler-Eintrags (Anzeigename, Bezeichnung, Funktionstext) SHALL bei der
Schwärzung des Einsatzes entfernt oder durch einen Platzhalter ersetzt werden, wie die
entsprechenden Felder eines Auftragsempfängers. Der Wortlaut des ETB-Eintrags folgt den Regeln
des ETB.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit einem Befehl, dessen Verteiler „ILS Musterstadt“ nennt, geschwärzt wird
- **THEN** steht „ILS Musterstadt“ in keinem Feld der Verteiler-Einträge mehr
