## Purpose

Legt fest, wie ein Tab auf Live-Ereignisse und auf den Wiederaufbau seiner Live-Verbindung mit
Neuabrufen reagiert, damit das Lagebild aktuell bleibt, ohne Leitung und Server mit
überflüssigen Abrufen zu belasten.

## ADDED Requirements

### Requirement: Live-Ereignisse werden gebündelt abgeglichen

Das Frontend SHALL die Abfragen, die ein Live-Ereignis betrifft, in einem Sammelfenster von
höchstens 500 ms zusammenfassen und jede betroffene Abfrage am Ende des Fensters genau einmal als
veraltet markieren. Ein Abruf, der zu dieser Zeit schon läuft, MUST NOT abgebrochen und neu
gestartet werden. Das gilt für Einsatz- und Org-Ereignisse in beiden Live-Strömen.

#### Scenario: Nachlieferung nach einem Funkloch
- **WHEN** ein Tab nach einem Funkloch 50 ETB-Ereignisse innerhalb von 200 ms erhält
- **THEN** ruft er jede betroffene Abfrage höchstens einmal neu ab

#### Scenario: Langsame Leitung
- **WHEN** während eines laufenden Abrufs der ETB-Liste ein weiteres `etb`-Ereignis eintrifft
- **THEN** läuft der begonnene Abruf zu Ende, und es wird kein zweiter parallel gestartet

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
Einsatz-Kanals mitteilen, ohne ein Ereignis auszulösen. Ein Neuaufbau durch den Browser MUST damit
auch dann eine `Last-Event-ID` mitschicken, wenn der Tab seit dem Aufbau kein Ereignis erhalten hat.

#### Scenario: Neuverbinden ohne zwischenzeitliches Ereignis
- **WHEN** ein Tab den Strom öffnet, kein Ereignis erhält und der Browser mit der mitgeteilten Position neu verbindet
- **THEN** liefert der Server nichts nach und sendet kein `lagged`

### Requirement: Wiederaufbau gleicht nur ab, was der Server nicht nachliefert

Verbindet der Browser die Verbindung von sich aus neu, SHALL das Frontend die Einsatz-Abfragen nicht
voll abgleichen, sondern sich auf die Nachlieferung des Servers oder dessen `lagged` verlassen. Baut
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
