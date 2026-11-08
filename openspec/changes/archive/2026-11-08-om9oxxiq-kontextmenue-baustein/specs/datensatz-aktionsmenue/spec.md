## ADDED Requirements

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

Am Touchgerät SHALL ein Druck auf einen Datensatz mit Aktionen, der ohne nennenswerte Bewegung
mindestens 550 ms liegt, dessen Kontextmenü an der Druckstelle öffnen. Bewegt sich der Finger
vorher, MUST kein Menü öffnen, damit Wischen und Blättern ungestört bleiben. Das Abheben des
Fingers danach MUST weder das Menü schließen noch als Tipp auf den Datensatz wirken.

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
