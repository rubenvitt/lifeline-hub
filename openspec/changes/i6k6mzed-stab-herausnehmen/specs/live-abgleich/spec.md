# Spec Delta

## MODIFIED Requirements

### Requirement: Ereignisse mit Objekt-Kennung gleichen gezielt ab

Trägt ein Live-Ereignis die Kennung des geänderten Objekts, SHALL das Frontend nur die Abfragen
abgleichen, die dieses Objekt betrifft:
- Speichert jemand an einem Lagebericht- oder Befehls-Entwurf nur Abschnittstexte, MUST das
  Ereignis das kennzeichnen. Andere Tabs gleichen dann nur das Detail dieses Dokuments ab, nicht
  die Liste. Ändern sich Titel oder Zeitstand, Status oder Bestand,
  gleichen sie auch die Liste ab.
- Ein Ereignis zu einem Schaden SHALL nur diese Zeile abrufen und in die geladene Liste
  einsortieren, in derselben Reihenfolge, die der Server liefert. Ein stornierter Schaden
  verschwindet aus Schadenliste und Markerliste.

Das Sammelfenster, verdeckte Tabs und laufende Abrufe behandelt der gezielte Abgleich wie den
Listenabgleich. Fehlt die Kennung, scheitert der Zeilenabruf, ist die Liste nicht geladen oder
treffen in einem Fenster mehr Zeilen ein, als sich einzeln lohnen, MUST das Frontend die ganze
Liste abgleichen. `lagged` und ein Wiederaufbau ohne Nachlieferung gleichen weiter alle Listen
ab.

#### Scenario: Autosave in einem zweiten Tab
- **WHEN** an einem Arbeitsplatz der Autosave eines Lagebericht-Entwurfs nur Abschnittstexte
  speichert, während ein zweiter Tab Lageberichtsliste und Lage-Dashboard offen hat
- **THEN** ruft der zweite Tab weder die Lageberichtsliste noch eine andere Liste neu ab

#### Scenario: Titel geändert
- **WHEN** der Titel eines Entwurfs geändert und gespeichert wird
- **THEN** zeigt die Lageberichtsliste im zweiten Tab den neuen Titel

#### Scenario: Schaden erfasst
- **WHEN** im Feld ein Schaden erfasst wird, während ein Tablet die Lagekarte offen hat
- **THEN** ruft das Tablet nur diesen Schaden ab, und sein Marker erscheint

#### Scenario: Viele Ereignisse auf einmal
- **WHEN** nach einem Funkloch 40 Schaden-Ereignisse in einem Sammelfenster eintreffen
- **THEN** ruft der Tab die Schadenliste einmal ganz ab statt 40 Zeilen einzeln

#### Scenario: Zeilenabruf scheitert
- **WHEN** der Abruf der geänderten Zeile mit einem Fehler endet
- **THEN** gleicht der Tab die ganze Liste ab
