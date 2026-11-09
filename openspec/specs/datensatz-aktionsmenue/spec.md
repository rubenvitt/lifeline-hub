# datensatz-aktionsmenue Specification

## Purpose
Legt fest, wie die gebündelten Aktionen eines Datensatzes (Zeile, Karte, Chip, Detailkopf)
erreichbar sind: ein Auslöser je Datensatz, eindeutig benannt, mit vorhersehbarem Menü, das
nur die gewählte Aktion auslöst, und ein Kontextmenü (Rechtsklick, langer Druck, Tastatur) mit
denselben Aktionen (LLH-1596).

## Requirements

### Requirement: Ein Auslöser je Datensatz mit Zeilenkennung

Gebündelte Aktionen eines Datensatzes SHALL über genau einen Knopf mit Dreipunkt-Zeichen und
ohne sichtbare Beschriftung erreichbar sein. Sein zugänglicher Name MUST eine Kennung des
Datensatzes enthalten (Nummer, Name, Bezeichnung oder Autor mit Uhrzeit), damit mehrere
Auslöser auf einer Seite per Name unterscheidbar sind. Das Zeichen selbst MUST für
Hilfstechnik verborgen sein.

#### Scenario: Zwei Nachrichten im Chat
- **WHEN** der Chat heute zwei Nachrichten mit Aktionen zeigt, eine von „Meier“ um 14:02 und eine von „Schulz“ um 14:05
- **THEN** heißen ihre Auslöser „Aktionen zu Nachricht von Meier, 1402“ und „Aktionen zu Nachricht von Schulz, 1405“ (Uhrzeit taktisch wie in der Kopfzeile)

#### Scenario: Dieselbe Minute
- **WHEN** „Meier“ heute um 14:02 zwei Nachrichten schreibt
- **THEN** heißen ihre Auslöser „Aktionen zu Nachricht von Meier, 1402 (1)“ und „… (2)“ in Listenreihenfolge

#### Scenario: Zeile einer Tabelle
- **WHEN** die Tabelle der Betreuungsstellen eine Stelle „Turnhalle Nord“ mit Aktionen zeigt
- **THEN** heißt ihr Auslöser „Aktionen zu Stelle Turnhalle Nord“

### Requirement: Kein Auslöser ohne Aktion

Bleibt nach Rechte- und Zustandsprüfung keine Aktion für das Menü übrig, SHALL kein Auslöser
erscheinen, auch kein deaktivierter.

#### Scenario: Gelöschte Nachricht
- **WHEN** der Chat eine gelöschte Nachricht zeigt
- **THEN** trägt sie keinen Aktionen-Auslöser

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht die ETB-Zeitachse öffnet und kein Eintrag eine Aktion für sie hat
- **THEN** zeigt kein Eintrag einen Aktionen-Auslöser

### Requirement: Unumkehrbares steht rot hinter einem Trenner

Das Menü SHALL zuerst die umkehrbaren Aktionen in Lieferreihenfolge zeigen. Unumkehrbare oder
entfernende Aktionen MUST rot und, wenn davor umkehrbare stehen, hinter genau einem Trenner
folgen. Eine Aktion, die gerade nicht möglich ist, SHALL im Menü deaktiviert stehen, wenn ihr
Fehlen die Bedienung verwirren würde.

#### Scenario: Pegel mit Prognose
- **WHEN** das Menü eines Pegels mit Prognose geöffnet wird
- **THEN** stehen „Nach oben“, „Nach unten“, „Prognose ändern …“, dann ein Trenner, dann rot „Prognose löschen“ und „Entfernen“

#### Scenario: Erster Pegel
- **WHEN** das Menü des obersten Pegels geöffnet wird
- **THEN** steht „Nach oben“ deaktiviert im Menü

### Requirement: Der Fokus springt beim Öffnen ins Menü

Öffnet jemand das Menü, SHALL der Tastaturfokus ins Menü wandern, sodass die Pfeiltasten sofort
einen Eintrag hervorheben und Escape das Menü schließt.

#### Scenario: Menü per Tastatur
- **WHEN** jemand den Auslöser eines ETB-Eintrags per Tastatur fokussiert und mit Enter öffnet
- **THEN** liegt der Fokus im Menü, die Pfeiltaste nach unten hebt einen Eintrag hervor, und Escape schließt das Menü

### Requirement: Ein Griff ins Menü löst nur die gewählte Aktion aus

Ein Klick in das geöffnete Menü, auf einen Eintrag oder auf seinen Rand, SHALL keine Wirkung des
umgebenden Datensatzes auslösen (Zeile öffnen, Chip bearbeiten, Karte wählen). Ein Klick auf
einen Eintrag MUST genau dessen Aktion auslösen.

#### Scenario: Menü in einer klickbaren Zeile
- **WHEN** eine Zeile auf Klick ihre Detailansicht öffnet und jemand im Aktionsmenü dieser Zeile einen Eintrag wählt
- **THEN** löst nur die gewählte Aktion aus, und die Detailansicht öffnet sich nicht

#### Scenario: Klick auf den Rand des Menüs
- **WHEN** jemand auf den Innenrand des geöffneten Menüs neben die Einträge klickt
- **THEN** löst weder eine Aktion noch die Wirkung des umgebenden Datensatzes aus

### Requirement: Rückfrage im Dialog, nicht im Menü

Braucht eine Aktion aus dem Menü eine Rückfrage, SHALL sie in einem Dialog erscheinen, der nach
dem Schließen des Menüs öffnet, nicht in einer Blase am Menüeintrag.

#### Scenario: Nachricht wird währenddessen gelöscht
- **WHEN** der Dialog „Nachricht wirklich löschen?“ offen ist und dieselbe Nachricht anderswo gelöscht wird
- **THEN** schließt der Dialog, und es wird kein zweites Löschen gesendet

#### Scenario: Eigene Nachricht löschen
- **WHEN** jemand im Menü einer eigenen Nachricht „Löschen“ wählt
- **THEN** schließt das Menü, ein Dialog fragt „Nachricht wirklich löschen?“, und erst „Ja, löschen“ löscht die Nachricht

#### Scenario: Rückfrage abbrechen
- **WHEN** jemand im Dialog „Nachricht wirklich löschen?“ abbricht
- **THEN** bleibt die Nachricht unverändert

### Requirement: Rechtsklick öffnet das Kontextmenü des Datensatzes

Hat ein Datensatz nach Rechte- und Zustandsprüfung mindestens eine Aktion, SHALL ein Rechtsklick
auf ihn ein eigenes Kontextmenü am Zeigerpunkt öffnen statt des Browsermenüs. Ohne Aktion MUST das
Browsermenü erscheinen. Das Kontextmenü MUST dieselben Regeln einhalten wie das ⋮-Menü: Fokus ins
Menü, Unumkehrbares rot hinter einem Trenner, ein Griff löst nur die gewählte Aktion aus,
Rückfrage im Dialog.

#### Scenario: Rechtsklick auf eine Materialzeile
- **WHEN** eine Person mit Schreibrecht in der Materialliste mit der rechten Maustaste auf die Zeile „Stromerzeuger 8 kVA“ neben ihre Bezeichnung klickt
- **THEN** öffnet am Zeiger ein Menü mit den Aktionen dieser Zeile, der Fokus liegt im Menü, und das Browsermenü erscheint nicht

#### Scenario: Zeile ohne Aktion
- **WHEN** eine Person ohne Schreibrecht in der Materialliste mit der rechten Maustaste auf eine Zeile klickt
- **THEN** erscheint das Browsermenü und kein eigenes Menü

#### Scenario: Wahl im Kontextmenü einer klickbaren Zeile
- **WHEN** eine Zeile auf Klick ihre Detailansicht öffnet und jemand im Kontextmenü dieser Zeile einen Eintrag wählt
- **THEN** löst nur die gewählte Aktion aus, und die Detailansicht öffnet sich nicht

### Requirement: Kontextmenü und ⋮-Menü zeigen dieselben Aktionen

Das Kontextmenü SHALL zuerst die sichtbare Primäraktion des Datensatzes zeigen, danach die
Einträge seines ⋮-Menüs in derselben Reihenfolge, mit demselben Sperrzustand und derselben
Wirkung. Unumkehrbares MUST auch hier rot hinter genau einem Trenner stehen. Fragt die
Primäraktion als Knopf vor dem Auslösen nach, MUST sie es aus dem Kontextmenü im Dialog mit
demselben Titel und derselben Knopfbeschriftung tun.

#### Scenario: Primäraktion und gebündelte Aktionen
- **WHEN** eine Person mit Schreibrecht das Kontextmenü eines Dokuments öffnet, dessen Zeile die Primäraktion „Bearbeiten“ und im ⋮-Menü rot „Entfernen“ trägt
- **THEN** stehen darin „Bearbeiten“, ein Trenner und rot „Entfernen“

#### Scenario: Nur Primäraktion
- **WHEN** eine Zeile nur eine Primäraktion und kein ⋮-Menü trägt und jemand ihr Kontextmenü öffnet
- **THEN** steht darin genau dieser eine Eintrag

#### Scenario: Primäraktion mit Rückfrage
- **WHEN** die Primäraktion einer Zeile als Knopf vor dem Auslösen nachfragt und jemand sie im Kontextmenü wählt
- **THEN** schließt das Menü, und ein Dialog stellt dieselbe Rückfrage mit derselben Knopfbeschriftung; erst die Bestätigung löst die Aktion aus

#### Scenario: Aktion läuft
- **WHEN** für eine Zeile eine Aktion aus dem ⋮-Menü noch läuft und jemand ihr Kontextmenü öffnet
- **THEN** stehen die Einträge des ⋮-Menüs gesperrt im Menü, und die Primäraktion bleibt wählbar wie ihr Knopf

### Requirement: Auf Link, Eingabefeld und markiertem Text bleibt das Browsermenü

Ein Rechtsklick oder langer Druck auf einen Link, in einem Eingabefeld oder auf markierten Text
innerhalb eines Datensatzes SHALL das Browsermenü zeigen und kein eigenes Menü öffnen, damit
„In neuem Tab öffnen“, Kopieren und Einfügen erreichbar bleiben.

#### Scenario: Rechtsklick auf den Titel-Link
- **WHEN** jemand mit der rechten Maustaste auf den Titel-Link einer Personenzeile klickt
- **THEN** erscheint das Browsermenü mit „Link in neuem Tab öffnen“

#### Scenario: Markierter Text
- **WHEN** jemand in einer Fahrzeugzeile den Funkrufnamen markiert und auf die Markierung rechtsklickt
- **THEN** erscheint das Browsermenü mit „Kopieren“

### Requirement: Langer Druck öffnet das Kontextmenü am Touchgerät

Am Touchgerät SHALL außerhalb des Einsatztagebuchs ein Druck auf einen Datensatz mit Aktionen, der
ohne nennenswerte Bewegung mindestens 550 ms liegt, dessen Kontextmenü an der Druckstelle öffnen.
Bewegt sich der Finger vorher, MUST kein Menü öffnen, damit Wischen und Blättern ungestört bleiben.
Das Abheben des Fingers danach MUST weder das Menü schließen noch als Tipp auf den Datensatz
wirken.

#### Scenario: Langer Druck auf eine Karte
- **WHEN** eine Person am Tablet unter 768 px Breite 600 ms auf die Karte eines Fahrzeugs drückt, ohne den Finger zu bewegen, und dann abhebt
- **THEN** steht das Kontextmenü der Karte offen, und die Detailansicht des Fahrzeugs hat sich nicht geöffnet

#### Scenario: Wischen über die Liste
- **WHEN** eine Person den Finger auf eine Karte legt und die Liste innerhalb von 550 ms um mehr als 8 px verschiebt
- **THEN** öffnet kein Kontextmenü

### Requirement: Kontextmenü-Taste und Umschalt+F10 öffnen das Kontextmenü

Steht der Tastaturfokus in einem Datensatz mit Aktionen, SHALL die Kontextmenü-Taste oder
Umschalt+F10 dessen Kontextmenü am Datensatz öffnen, auch wenn der Fokus auf seinem Titel-Link
steht. In einem Eingabefeld MUST das Browsermenü bleiben. Schließt das Menü ohne Wahl, MUST der
Fokus an das Element zurückkehren, von dem es geöffnet wurde.

#### Scenario: Menü per Tastatur
- **WHEN** jemand per Tab auf den Titel-Link einer Materialzeile springt und Umschalt+F10 drückt
- **THEN** öffnet das Kontextmenü der Zeile am Datensatz, der Fokus liegt im Menü, und das Browsermenü erscheint nicht

#### Scenario: Escape gibt den Fokus zurück
- **WHEN** das per Tastatur geöffnete Kontextmenü offen ist und jemand Escape drückt
- **THEN** schließt das Menü, und der Fokus steht wieder auf dem Titel-Link der Zeile

### Requirement: Ein offenes Kontextmenü hält die Liste

Solange das Kontextmenü eines Datensatzes in einer Liste offen ist, SHALL die Liste Menge und
Folge ihrer Zeilen halten wie bei einem offenen ⋮-Menü. Verschwindet der Datensatz trotzdem oder
verliert er alle Aktionen, MUST das Menü schließen.

#### Scenario: Neue Zeile während das Menü offen ist
- **WHEN** das Kontextmenü einer Fahrzeugzeile offen ist und ein anderer Platz ein neues Fahrzeug anlegt
- **THEN** bleibt die Zeile an ihrer Stelle, und der Sammelhinweis nennt das neue Fahrzeug

#### Scenario: Datensatz verliert seine Aktionen
- **WHEN** das Kontextmenü einer Zeile offen ist und der Person das Schreibrecht entzogen wird
- **THEN** schließt das Menü

### Requirement: Im Einsatztagebuch öffnet ein langer Druck kein Kontextmenü

Im Einsatztagebuch (Einträge der Zeitachse und Chips der Erfassung) SHALL ein langer Druck am
Touchgerät kein Kontextmenü öffnen, damit Text markierbar bleibt; das ⋮-Menü führt dort zu den
Aktionen. Rechtsklick und Tasten MUST das Kontextmenü weiter öffnen.

#### Scenario: Langer Druck im Einsatztagebuch
- **WHEN** eine Person mit Schreibrecht am Tablet 600 ms auf den Text eines ETB-Eintrags drückt, ohne den Finger zu bewegen
- **THEN** öffnet kein Kontextmenü, und das Gerät darf den Text wie gewohnt markieren

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
