# Spec Delta

## REMOVED Requirements

### Requirement: Ereignisse mit Objekt-Kennung gleichen gezielt ab
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Mit ihm entfallen das Live-Ereignis `presse`, Medienkontakt und Pressemitteilung; die Szenarien „Neue Anfrage im Presse-Log“, „Status zurückgenommen“ und „Pressemitteilung gespeichert“ haben keinen Gegenstand, und OpenSpec erlaubt nicht, sie in einem MODIFIED-Block wegzulassen.
**Migration**: Der gezielte Abgleich für Lagebericht- und Befehls-Entwürfe und für Schäden gilt unverändert unter „Ereignisse zu Entwürfen und Schäden gleichen gezielt ab“. Die Beschreibung ist gekürzt; die Einzelregeln stehen dort als Szenarien.

## ADDED Requirements

### Requirement: Ereignisse zu Entwürfen und Schäden gleichen gezielt ab

Trägt ein Live-Ereignis die Kennung des geänderten Objekts, SHALL das Frontend nur die Abfragen
abgleichen, die dieses Objekt betrifft; das gilt für Lagebericht- und Befehls-Entwürfe und für
Schäden. Fehlt die Kennung, scheitert der Zeilenabruf, ist die Liste nicht geladen oder treffen
in einem Fenster mehr Zeilen ein, als sich einzeln lohnen, MUST das Frontend die ganze Liste
abgleichen.

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

#### Scenario: Nur Abschnittstexte gespeichert
- **WHEN** jemand an einem Lagebericht- oder Befehls-Entwurf nur Abschnittstexte speichert
- **THEN** kennzeichnet das Ereignis das, und andere Tabs gleichen nur das Detail dieses Dokuments
  ab, nicht die Liste

#### Scenario: Zeitstand, Status oder Bestand geändert
- **WHEN** sich an einem Entwurf Zeitstand oder Status ändert oder sich der Bestand der Dokumente
  ändert
- **THEN** gleichen andere Tabs auch die Liste ab

#### Scenario: Schaden einsortieren
- **WHEN** ein Ereignis zu einem Schaden eintrifft und die Schadenliste geladen ist
- **THEN** ruft der Tab nur diese Zeile ab und sortiert sie in derselben Reihenfolge in die
  geladene Liste ein, die der Server liefert

#### Scenario: Schaden storniert
- **WHEN** ein Schaden storniert wird
- **THEN** verschwindet er aus Schadenliste und Markerliste

#### Scenario: Sammelfenster, verdeckte Tabs und laufende Abrufe
- **WHEN** ein Ereignis mit Kennung in ein Sammelfenster fällt, einen verdeckten Tab erreicht oder
  auf einen laufenden Abruf trifft
- **THEN** behandelt der gezielte Abgleich das wie der Listenabgleich

#### Scenario: Ohne Kennung oder ohne geladene Liste
- **WHEN** einem Ereignis die Kennung fehlt oder die betroffene Liste nicht geladen ist
- **THEN** gleicht der Tab die ganze Liste ab

#### Scenario: lagged und Wiederaufbau
- **WHEN** der Tab `lagged` erhält oder die Verbindung ohne Nachlieferung wieder aufgebaut wird
- **THEN** gleicht er weiter alle Listen ab
