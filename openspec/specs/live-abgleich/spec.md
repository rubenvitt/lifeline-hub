# live-abgleich Specification

## Purpose
Legt fest, wie ein Tab auf Live-Ereignisse und auf den Wiederaufbau seiner Live-Verbindung mit
Neuabrufen reagiert, damit das Lagebild aktuell bleibt, ohne Leitung und Server mit
überflüssigen Abrufen zu belasten. (LFH-922)

## Requirements

### Requirement: Live-Ereignisse werden gebündelt abgeglichen

Das Frontend SHALL die Abfragen, die ein Live-Ereignis betrifft, in einem Sammelfenster von
höchstens 500 ms zusammenfassen und jede betroffene Abfrage am Ende des Fensters genau einmal als
veraltet markieren. Das gilt für Einsatz- und Org-Ereignisse in beiden Live-Strömen. Die
Modulzähler des Einsatzes haben ein eigenes Sammelfenster von höchstens 2 s (Spec
`modul-zaehler`).

#### Scenario: Nachlieferung nach einem Funkloch
- **WHEN** ein Tab nach einem Funkloch 50 ETB-Ereignisse innerhalb von 200 ms erhält
- **THEN** ruft er jede betroffene Abfrage höchstens einmal neu ab

#### Scenario: Modulzähler im eigenen Fenster
- **WHEN** ein Tab binnen 500 ms zehn `meldung`-Ereignisse erhält
- **THEN** ruft er die Meldungsliste höchstens zweimal und die Modulzähler genau einmal neu ab

### Requirement: Laufende Abrufe bleiben stehen und verdecken nichts

Läuft am Ende eines Sammelfensters für eine betroffene Abfrage schon ein Abruf, MUST NOT das
Frontend ihn abbrechen und neu starten. Es SHALL die Abfrage stattdessen im nächsten Fenster
markieren, damit der laufende Abruf eine später gemeldete Änderung nicht verdeckt.

#### Scenario: Langsame Leitung
- **WHEN** während eines laufenden Abrufs der ETB-Liste ein weiteres `etb`-Ereignis eintrifft
- **THEN** läuft der begonnene Abruf zu Ende, es wird kein zweiter parallel gestartet, und danach ruft der Tab die Liste genau einmal neu ab

### Requirement: Ein Verbindungsende markiert Vorgemerktes als veraltet

Endet eine Live-Verbindung, bevor ihr Sammelfenster abläuft, SHALL das Frontend die vorgemerkten
Abfragen als veraltet markieren und MUST NOT sie dafür abrufen.

#### Scenario: Einsatz kurz verlassen
- **WHEN** ein `etb`-Ereignis eintrifft, der Disponent den Einsatz binnen 300 ms verlässt und gleich wieder öffnet
- **THEN** gilt die ETB-Liste als veraltet und wird beim Öffnen neu abgerufen

### Requirement: Alarme und Status wirken sofort

Ereignisse mit Seiteneffekt SHALL ohne Sammelfenster wirken: Alarmton und Toast bei einer
Sofortmeldung, Erinnerungs- und Ablösungsalarm sowie die Meldung des Verbindungsstatus.

#### Scenario: Sofortmeldung
- **WHEN** ein `sofortmeldung`-Ereignis eintrifft
- **THEN** ertönt der Alarm und erscheint der Toast sofort; die Meldungslisten laden mit dem Sammelfenster nach

### Requirement: Verdeckte Tabs rufen bei Live-Ereignissen nicht ab

Ist ein Tab verdeckt (Dokument nicht sichtbar), SHALL das Frontend die von Live-Ereignissen
betroffenen Abfragen nur als veraltet markieren und MUST NOT sie abrufen. Wird der Tab wieder
sichtbar, MUST er jede veraltete Abfrage, die er gerade anzeigt, genau einmal neu abrufen.

#### Scenario: Mehrere Einsatz-Tabs
- **WHEN** ein Disponent fünf Tabs desselben Einsatzes offen hat, von denen einer sichtbar ist, und ein `personal`-Ereignis eintrifft
- **THEN** ruft nur der sichtbare Tab ab; die vier verdeckten rufen nichts ab

#### Scenario: Zurück in einen verdeckten Tab
- **WHEN** in einem verdeckten Tab drei `etb`-Ereignisse eintrafen und der Disponent danach in diesen Tab wechselt
- **THEN** ruft der Tab die ETB-Liste genau einmal neu ab

### Requirement: Der Einsatz-Strom nennt beim Aufbau seine Position

Der Live-Strom eines Einsatzes SHALL dem Browser beim Aufbau die aktuelle Position des
Einsatz-Kanals als eigenes Kontroll-Ereignis `position` mitteilen, das keinen Abgleich auslöst. Ein
Neuaufbau durch den Browser MUST damit auch dann eine `Last-Event-ID` mitschicken, wenn der Tab seit
dem Aufbau kein Fach-Ereignis erhalten hat, in jeder Browser-Engine.

#### Scenario: Neuverbinden ohne zwischenzeitliches Ereignis
- **WHEN** ein Tab den Strom öffnet, kein Ereignis erhält und der Browser mit der mitgeteilten Position neu verbindet
- **THEN** liefert der Server nichts nach und sendet kein `lagged`

### Requirement: Wiederaufbau gleicht nur ab, was der Server nicht nachliefert

Verbindet der Browser die Verbindung von sich aus neu, nachdem sie ihre Position erhalten hat, SHALL
das Frontend die Einsatz-Abfragen nicht voll abgleichen, sondern sich auf die Nachlieferung des
Servers oder dessen `lagged` verlassen. Hat die Verbindung ihre Position noch nicht erhalten oder baut
das Frontend die Verbindung selbst neu auf, MUST es voll abgleichen. Die live geführten globalen
Abfragen MUST nach jedem Wiederaufbau abgeglichen werden.

#### Scenario: Planmäßiges Ende der Lebensdauer
- **WHEN** der Server den Live-Strom eines Tabs nach seiner Lebensdauer beendet, während dazwischen kein Ereignis anfiel, und der Browser neu verbindet
- **THEN** ruft der Tab keine Einsatz-Abfrage neu ab

#### Scenario: Kurzer Abriss mit verpassten Ereignissen
- **WHEN** die Verbindung kurz abreißt, in der Zeit zwei `etb`-Ereignisse anfallen und der Browser neu verbindet
- **THEN** liefert der Server die zwei Ereignisse nach, und der Tab ruft nur die von ihnen betroffenen Abfragen neu ab

#### Scenario: Server-Neustart
- **WHEN** der Server neu startet und der Browser neu verbindet
- **THEN** meldet der Server `lagged`, und der Tab gleicht alle Abfragen genau einmal ab

#### Scenario: Abriss vor der Position
- **WHEN** die Verbindung abreißt, bevor der Server ihre Position gemeldet hat, und der Browser neu verbindet
- **THEN** gleicht der Tab alle Abfragen ab

#### Scenario: Neue Verbindung nach Fehler
- **WHEN** der Browser aufgibt und das Frontend eine neue Verbindung aufbaut
- **THEN** gleicht der Tab alle Abfragen ab

### Requirement: Hinweis zum Verbindungszustand erst nach einer Schonfrist

Verbindet der Browser die Live-Verbindung von sich aus neu, SHALL das Frontend den Hinweis „Live-
Verbindung wird wiederhergestellt“ erst zeigen, wenn die Verbindung nach 8 s nicht wieder steht.
Gibt der Browser auf, MUST der Hinweis auf eine unterbrochene Verbindung sofort erscheinen.

#### Scenario: Planmäßiges Neuverbinden
- **WHEN** der Server einen Live-Strom nach seiner Lebensdauer beendet und der Browser nach 3 s wieder verbunden ist
- **THEN** erscheint kein Hinweis zum Verbindungszustand

#### Scenario: Server länger weg
- **WHEN** der Browser nach einem Abriss 8 s lang nicht wieder verbunden ist
- **THEN** erscheint der Hinweis „Live-Verbindung wird wiederhergestellt“

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
