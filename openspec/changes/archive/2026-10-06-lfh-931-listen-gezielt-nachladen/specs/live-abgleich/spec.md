# Spec Delta

## ADDED Requirements

### Requirement: Ereignisse mit Objekt-Kennung gleichen gezielt ab

Trägt ein Live-Ereignis die Kennung des geänderten Objekts, SHALL das Frontend nur die Abfragen
abgleichen, die dieses Objekt betrifft:
- Speichert jemand an einem Lagebericht-, Befehls- oder Pressemitteilungs-Entwurf nur
  Abschnittstexte, MUST das Ereignis das kennzeichnen. Andere Tabs gleichen dann nur das Detail
  dieses Dokuments ab, nicht die Liste. Ändern sich Titel oder Zeitstand, Status oder Bestand,
  gleichen sie auch die Liste ab.
- Ein Ereignis zu einem Medienkontakt oder einem Schaden SHALL nur diese Zeile abrufen und in die
  geladene Liste einsortieren, in derselben Reihenfolge, die der Server liefert. Ein stornierter
  Schaden verschwindet aus Schadenliste und Markerliste.
- Ein Ereignis zu einer Pressemitteilung MUST NOT das Presse-Log abgleichen.

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

#### Scenario: Neue Anfrage im Presse-Log
- **WHEN** an einem Arbeitsplatz eine Anfrage erfasst wird, während ein zweiter das Presse-Log
  mit 300 Kontakten offen hat
- **THEN** ruft der zweite Tab nur diesen einen Kontakt ab, und die Anfrage steht bei den
  offenen Kontakten an ihrem Platz

#### Scenario: Status zurückgenommen
- **WHEN** eine beantwortete Anfrage nach `offen` zurückgenommen wird
- **THEN** wandert sie in der Liste des zweiten Tabs zu den offenen Kontakten, ohne dass die
  ganze Liste geladen wird

#### Scenario: Pressemitteilung gespeichert
- **WHEN** eine Pressemitteilung freigegeben wird
- **THEN** ruft der zweite Tab die Liste der Pressemitteilungen ab, aber nicht das Presse-Log

#### Scenario: Schaden erfasst
- **WHEN** im Feld ein Schaden erfasst wird, während ein Tablet die Lagekarte offen hat
- **THEN** ruft das Tablet nur diesen Schaden ab, und sein Marker erscheint

#### Scenario: Viele Ereignisse auf einmal
- **WHEN** nach einem Funkloch 40 Schaden-Ereignisse in einem Sammelfenster eintreffen
- **THEN** ruft der Tab die Schadenliste einmal ganz ab statt 40 Zeilen einzeln

#### Scenario: Zeilenabruf scheitert
- **WHEN** der Abruf der geänderten Zeile mit einem Fehler endet
- **THEN** gleicht der Tab die ganze Liste ab
