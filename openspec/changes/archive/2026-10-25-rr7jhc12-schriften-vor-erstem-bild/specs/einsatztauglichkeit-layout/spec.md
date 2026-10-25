## ADDED Requirements

### Requirement: Der App-Rahmen springt beim Laden nicht

Beim Laden einer Einsatzseite MUST die Kopfleiste im ersten Bild so viele Zeilen haben wie im
fertig geladenen Zustand, in jeder Stufe der Dichte-Staffel und an jeder Breite ab `xl`. Ein
Inhalt der Kopfleiste, der erst nach einem Abruf feststeht, MUST NOT ihre Breite ändern. Die
Summe der Verschiebungen ohne vorherige Eingabe MUST bei 1280 × 800 in `kompakt` und
`komfortabel` unter 0,1 liegen, an der Umbruchkante der Kopfleiste höchstens 0,01.

#### Scenario: Arbeitsplatzmaß
- **WHEN** Überblick, Meldebild und ETB eines Einsatzes bei 1280 × 800 in `kompakt` und in `komfortabel` geladen werden
- **THEN** liegt die Summe der Verschiebungen ohne vorherige Eingabe je Seite unter 0,1

#### Scenario: An der Umbruchkante
- **WHEN** der Überblick in `komfortabel` oder `handschuh` als Admin oder Beobachter an der größten zweizeiligen und an der kleinsten einzeiligen Breite der fertig geladenen Kopfleiste geladen wird
- **THEN** hat die Kopfleiste nach dem Laden so viele Zeilen wie bei der Suche der Kante, und die Summe der Verschiebungen ist höchstens 0,01

#### Scenario: Funktion kommt nach dem Namen
- **WHEN** der Einsatz nach dem ersten Bild lädt und das Benutzermenü statt des Anzeigenamens die Funktion zeigt
- **THEN** behält das Etikett des Benutzermenüs seine Breite

### Requirement: Das erste Bild steht in den Bildschirm-Schriften

Die Bildschirm-Schriften (Archivo 400/500/600, Archivo Narrow 600, JetBrains Mono 400/500) MUST
im ersten Bild der App stehen, wenn sie innerhalb von 300 ms nach dem Start laden. Laden sie nicht
in dieser Frist oder scheitern sie, MUST die App trotzdem rendern, in der Ersatzschrift.

#### Scenario: Schriften kommen verzögert
- **WHEN** jeder Schriftabruf um 150 ms verzögert wird und eine Einsatzseite neu lädt
- **THEN** sind die Bildschirm-Schriften geladen, bevor der Inhalt der App zum ersten Mal im Dokument steht

#### Scenario: Schriften kommen nicht
- **WHEN** die Schriftabrufe nicht innerhalb von 300 ms antworten oder scheitern
- **THEN** rendert die App trotzdem, und der Text steht in der Ersatzschrift
