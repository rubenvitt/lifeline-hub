## MODIFIED Requirements

### Requirement: Langer Druck öffnet das Kontextmenü am Touchgerät

Am Touchgerät SHALL ein Druck auf einen Datensatz mit Aktionen, der ohne nennenswerte Bewegung
mindestens 550 ms liegt, dessen Kontextmenü an der Druckstelle öffnen. Bewegt sich der Finger
vorher, MUST kein Menü öffnen, damit Wischen und Blättern ungestört bleiben. Das Abheben des
Fingers danach MUST weder das Menü schließen noch als Tipp auf den Datensatz wirken. Im
Einsatztagebuch (Einträge der Zeitachse und Chips der Erfassung) MUST ein langer Druck kein
Kontextmenü öffnen, damit Text am Touchgerät markierbar bleibt; dort führt das ⋮-Menü zu den
Aktionen.

#### Scenario: Langer Druck auf eine Karte
- **WHEN** eine Person am Tablet unter 768 px Breite 600 ms auf die Karte eines Fahrzeugs drückt, ohne den Finger zu bewegen, und dann abhebt
- **THEN** steht das Kontextmenü der Karte offen, und die Detailansicht des Fahrzeugs hat sich nicht geöffnet

#### Scenario: Wischen über die Liste
- **WHEN** eine Person den Finger auf eine Karte legt und die Liste innerhalb von 550 ms um mehr als 8 px verschiebt
- **THEN** öffnet kein Kontextmenü

#### Scenario: Langer Druck im Einsatztagebuch
- **WHEN** eine Person mit Schreibrecht am Tablet 600 ms auf den Text eines ETB-Eintrags drückt, ohne den Finger zu bewegen
- **THEN** öffnet kein Kontextmenü, und das Gerät darf den Text wie gewohnt markieren

## ADDED Requirements

### Requirement: ETB-Einträge tragen das Kontextmenü

Ein gesendeter Eintrag der ETB-Zeitachse mit mindestens einer Aktion SHALL auf Rechtsklick und
Tasten ein Kontextmenü mit genau den Einträgen seines ⋮-Menüs öffnen, in derselben Reihenfolge und
mit demselben Sperrzustand. Ein vorgemerkter Eintrag, eine Bündelzeile von Systemeinträgen und ein
Eintrag ohne Aktion MUST das Browsermenü behalten.

#### Scenario: Rechtsklick auf einen Eintrag
- **WHEN** eine Person mit Schreibrecht und Freigabe für Aufträge auf den Text des Eintrags Nr. 12 rechtsklickt
- **THEN** öffnet am Zeiger ein Menü mit „Berichtigen“, „Wiedervorlage“ und „Auftrag erteilen“, und das Browsermenü erscheint nicht

#### Scenario: Berichtigen gesperrt
- **WHEN** ein Entwurf gerade sendet und jemand das Kontextmenü eines Eintrags öffnet
- **THEN** steht „Berichtigen“ gesperrt mit demselben Grund wie im ⋮-Menü

#### Scenario: Vorgemerkter Eintrag
- **WHEN** jemand ohne Netz einen Eintrag erfasst hat und auf die vorgemerkte Zeile rechtsklickt
- **THEN** erscheint das Browsermenü und kein eigenes Menü

#### Scenario: Taste im Eintrag
- **WHEN** der Fokus auf dem ⋮-Knopf des Eintrags Nr. 12 steht und jemand Umschalt+F10 drückt
- **THEN** öffnet das Kontextmenü dieses Eintrags am Eintrag, und der Fokus liegt im Menü

### Requirement: Abgelehnte ETB-Einträge zeigen ihre Entscheidung im Kontextmenü

Ein vom Server abgelehnter Eintrag SHALL auf Rechtsklick und Tasten ein Kontextmenü mit denselben
Wegen öffnen wie seine Knöpfe: „Erneut senden“, „Nur protokollieren“ (nur wenn der Knopf steht)
und „Verwerfen“ rot hinter einem Trenner. Die Wahl MUST dieselbe Wirkung haben wie der Knopf, auch
ohne Rückfrage beim Verwerfen.

#### Scenario: Abgelehnte Meldung
- **WHEN** der Server eine gepufferte Meldung mit Kopplung an den Meldungseingang abgelehnt hat und jemand auf ihre Zeile rechtsklickt
- **THEN** stehen im Menü „Erneut senden“, „Nur protokollieren“, ein Trenner und rot „Verwerfen“

#### Scenario: Verwerfen aus dem Kontextmenü
- **WHEN** jemand im Kontextmenü einer abgelehnten Zeile „Verwerfen“ wählt
- **THEN** verschwindet die Zeile wie nach dem Knopf „Verwerfen“

### Requirement: Ein offenes Kontextmenü hält die ETB-Zeitachse

Solange das Kontextmenü eines ETB-Eintrags offen ist, SHALL die Zeitachse neue Einträge zurückhalten
wie bei Fokus in der Achse, sodass die Zeile unter dem Menü stehen bleibt. Verschwindet der Eintrag
trotzdem oder verliert er alle Aktionen, MUST das Menü schließen.

#### Scenario: Neuer Eintrag während das Menü offen ist
- **WHEN** das Kontextmenü eines Eintrags offen ist und ein anderer Platz einen Eintrag erfasst
- **THEN** bleibt die Zeile an ihrer Stelle, und das Sammelbanner nennt den neuen Eintrag

### Requirement: Chips der ETB-Erfassung tragen das Kontextmenü

Ein Chip der ETB-Erfassung (Von, An, Zeit, Meldeweg) SHALL auf Rechtsklick und Tasten ein
Kontextmenü mit den Einträgen seines ⋮-Menüs öffnen. Während der Eintrag sendet, MUST es die
Einträge gesperrt zeigen. Ein Chip, der gerade bearbeitet wird, MUST das Browsermenü behalten.

#### Scenario: Rechtsklick auf den Chip „An“
- **WHEN** jemand auf den Chip „An: S2“ rechtsklickt
- **THEN** öffnet ein Menü mit „Bearbeiten“, einem Trenner und rot „Entfernen“

#### Scenario: Chip aus dem Standard-Rufnamen
- **WHEN** der Chip „Von“ aus dem Standard-Rufnamen kommt und jemand auf ihn rechtsklickt
- **THEN** stehen im Menü „Nur für diesen Eintrag ändern“ und „Standard-Rufname ändern“, kein „Entfernen“

#### Scenario: Während des Sendens
- **WHEN** der Eintrag gerade sendet und jemand auf einen Chip rechtsklickt
- **THEN** stehen die Einträge des Chips gesperrt im Menü
