# datensatz-aktionsmenue Specification

## Purpose
Legt fest, wie die gebündelten Aktionen eines Datensatzes (Zeile, Karte, Chip, Detailkopf)
erreichbar sind: ein Auslöser je Datensatz, eindeutig benannt, mit vorhersehbarem Menü, das
nur die gewählte Aktion auslöst, und ein Kontextmenü (Rechtsklick, langer Druck, Tastatur) mit
denselben Aktionen (LLH-1596), auch an Karten mit eigenen Knöpfen und im Chat (LLH-1598).

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

#### Scenario: Betreuungsstelle in der Tabelle
- **WHEN** eine Person mit Schreibrecht in der Tabelle der Betreuungsstellen auf die Zeile einer geöffneten, unverorteten Stelle mit gezählter Belegung rechtsklickt
- **THEN** stehen darin „Belegung melden“, „Auf Karte verorten“, ein Trenner und rot „Stornieren“

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

### Requirement: Eine Karte mit mehreren Knöpfen zeigt alle ihre Handlungen

Trägt die Aktionszeile einer Karte mehrere Knöpfe, SHALL ihr Kontextmenü alle Knöpfe dieser Zeile
zeigen, die etwas tun, in ihrer Reihenfolge, danach die Einträge des ⋮-Menüs. Das MUST auch gelten,
wenn die Karte unter drei Aktionen kein ⋮-Menü zeigt. Ein gesperrter Knopf MUST gesperrt mit Grund
im Menü stehen. Sprünge, Auswahlfelder und Knöpfe einzelner Unterzeilen (Empfänger, Ausgabe) MUST
NOT im Menü stehen.

#### Scenario: Neue Sofortmeldung
- **WHEN** eine Person mit Schreibrecht auf eine neue, unbestätigte Sofortmeldung rechtsklickt, deren Karte „Bestätigen“, „Sichten“ und das ⋮-Menü trägt
- **THEN** stehen im Menü zuerst „Bestätigen“ und „Sichten“, danach die Einträge des ⋮-Menüs in dessen Reihenfolge

#### Scenario: Karte unter drei Aktionen
- **WHEN** eine Verpflegungsstelle im Status „aktiv“ die Knöpfe „Bearbeiten …“ und rot „Auflösen …“ ohne ⋮-Menü trägt und jemand auf sie rechtsklickt
- **THEN** stehen im Menü „Bearbeiten …“, ein Trenner und rot „Auflösen …“

#### Scenario: Knopf mit Rückfrage
- **WHEN** jemand im Kontextmenü eines vollzogenen Auftrags „Abnehmen“ wählt
- **THEN** schließt das Menü, ein Dialog fragt „Auftrag abnehmen?“ mit dem Knopf „Auftrag abnehmen“, und erst die Bestätigung nimmt den Auftrag ab

#### Scenario: Gesperrte Übernahme
- **WHEN** eine eingetroffene Nachforderung „Als Material übernehmen“ gesperrt trägt, weil das Materialmodul für die Person gesperrt ist, und jemand ihr Kontextmenü öffnet
- **THEN** steht „Als Material übernehmen“ gesperrt im Menü und nennt den Grund

#### Scenario: Sprung bleibt draußen
- **WHEN** jemand auf ein laufendes Zeitfenster rechtsklickt, dessen Karte „Ausgabe öffnen“ und „Ausgabe nachtragen“ trägt
- **THEN** steht „Ausgabe nachtragen“ im Menü und „Ausgabe öffnen“ nicht

#### Scenario: Knopf einer Unterzeile bleibt an der Zeile
- **WHEN** jemand auf ein Zeitfenster rechtsklickt, in dessen Ausgabenliste eine Ausgabe den Knopf „Zurücknehmen“ trägt
- **THEN** enthält das Menü die Aktionen des Zeitfensters und kein „Zurücknehmen“

#### Scenario: Zuweisung bleibt an der Karte
- **WHEN** jemand das Kontextmenü einer Meldung öffnet, an der die Auswahl „Bearbeiter zuweisen“ steht
- **THEN** enthält das Menü keinen Eintrag zur Zuweisung

### Requirement: Eine Chat-Nachricht öffnet ihr Kontextmenü

Eine Nachricht im Chat mit Aktionen SHALL per Rechtsklick, langem Druck und Tastatur dasselbe Menü
öffnen wie ihr ⋮-Auslöser. Auf einem Anhang, dem Link wie dem Vorschaubild, MUST das Browsermenü
bleiben. Auf einem Bild in einem Datensatz bleibt es überall, damit „Bild speichern unter“ erreichbar
ist.

#### Scenario: Rechtsklick auf eine eigene Nachricht
- **WHEN** eine Person mit Schreibrecht neben den Text ihrer eigenen Nachricht rechtsklickt
- **THEN** öffnet am Zeiger ein Menü mit „Zu ETB“, „Zu Auftrag“, „Bearbeiten“, einem Trenner und rot „Löschen“, soweit diese Einträge auch im ⋮-Menü stehen

#### Scenario: Rechtsklick auf einen Anhang
- **WHEN** jemand auf den Anhang einer Nachricht rechtsklickt
- **THEN** erscheint das Browsermenü mit „Link speichern unter“

#### Scenario: Rechtsklick auf das Vorschaubild eines Anhangs
- **WHEN** jemand auf das Vorschaubild eines Bildanhangs einer Nachricht rechtsklickt
- **THEN** erscheint das Browsermenü mit „Bild speichern unter“ und kein eigenes Menü

#### Scenario: Gelöschte Nachricht
- **WHEN** jemand auf eine gelöschte Nachricht rechtsklickt
- **THEN** erscheint das Browsermenü

### Requirement: Ein Zählschirm hat kein Kontextmenü

Ein Schirm, auf dem in schneller Folge Tasten gezählt werden, SHALL kein eigenes Kontextmenü
öffnen. Ein langer Druck auf eine Zähltaste MUST wie bisher wirken und kein Menü öffnen. Eine
Auswahl hinter einem ⋮-Knopf auf diesem Schirm ist kein Menü eines Datensatzes.

#### Scenario: Langer Druck im Ausgabe-Zählschirm
- **WHEN** eine Person am Tablet im Zählschirm einer Verpflegungsausgabe 600 ms auf eine Zähltaste drückt
- **THEN** öffnet kein Kontextmenü
