# lagekarte-druck Specification

## Purpose
Legt fest, wie der aktuelle Ausschnitt der Lagekarte als Lageplan auf Papier oder in ein PDF kommt
und als Bild-Anlage an einen Lagebericht oder Befehl gehängt wird (LLH-1051): mit Druckkopf,
Maßstab, Nordpfeil und einer Legende dessen, was die Karte zeigt.

## Requirements

### Requirement: Lageplan drucken über den Seitenkopf

Die Lagekarte SHALL „Drucken / als PDF“ als Nebenweg ihres Seitenkopfs anbieten (ab `md` ein
Knopf, darunter ein Eintrag hinter „Weitere“). Der Weg SHALL denselben Druckablauf wie jedes
andere Druckstück nehmen (Druckdialog erst mit geladener Organisation). Ohne geladene Organisation
MUST der Eintrag gesperrt mit Grund im Text stehen.

#### Scenario: Drucken aus dem Seitenkopf

- **WHEN** eine Person auf der Lagekarte „Drucken / als PDF“ wählt
- **THEN** nimmt das System den sichtbaren Ausschnitt auf und öffnet danach den Druckdialog des Browsers

#### Scenario: Ohne Knopf kein Blatt

- **WHEN** eine Person auf der Lagekarte ohne den Nebenweg druckt (Strg+P)
- **THEN** enthält der Ausdruck kein Lageplan-Blatt, auch kein Bild eines früheren Drucks

### Requirement: Ausschnitt als Bild ohne dauerhaften Zeichenpuffer

Das System SHALL den Ausschnitt im nächsten Render der Karte als PNG aufnehmen und MUST NOT dafür
den Zeichenpuffer der Karte dauerhaft erhalten (`preserveDrawingBuffer`). Grundlage,
Bild-Hintergründe, Zonen, Marker, Bündel und Fachebenen SHALL auf dem Bild stehen. Fehlende
Kacheln MUST als leere Fläche erscheinen, nicht als Fehler. Gibt die Leinwand kein Bild her, MUST
das System den Grund über der Karte nennen und nicht drucken.

#### Scenario: Kacheln fehlen

- **WHEN** die Kacheln der Grundlage nicht geladen sind und gedruckt wird
- **THEN** steht das Blatt mit Kopf, Bild und Legende da
- **AND** es erscheint kein Fehler

### Requirement: Blatt A4 quer mit Kopf, Maßstab, Nordpfeil und Legende

Das Lageplan-Blatt SHALL A4 quer stehen und tragen: den Druckkopf („Lageplan“, Einsatz, Stand,
Ansicht, Kartengrundlage), das Bild in fester Breite in mm, eine Maßstabsleiste mit runder Länge
und „Maßstab ca. 1 : N“, einen um die Drehung der Karte gedrehten Nordpfeil und die Legende. Der
Stand MUST der gesicherte Stand sein, wenn ein solcher angezeigt wird, sonst der Datenstand. Ohne
Maßstabsangabe der Karte MUST die Leiste fehlen statt geraten.

#### Scenario: Gedrucktes Blatt

- **WHEN** der Lageplan gedruckt wird
- **THEN** steht er auf einem Blatt A4 quer mit Druckkopf, Bild, Maßstab, Nordpfeil und Legende
- **AND** von der Bedienung der Karte steht nichts auf dem Blatt

### Requirement: Ein Blatt bei hohem Kopf und langer Legende

Kopf, Maßstabszeile, Hinweis und Legende MUST auf demselben Blatt stehen wie das Bild, auch mit
Organisationslogo, langer Einsatzbezeichnung oder langer Legende. Das Bild SHALL dafür kleiner
gedruckt werden, höchstens 95 mm und mindestens 35 mm hoch. Maßstabsleiste und „Maßstab ca. 1 : N“
MUST zur gedruckten Bildbreite passen.

#### Scenario: Hoher Kopf und lange Legende

- **WHEN** der Druckkopf ein Organisationslogo und eine zweizeilige Einsatzbezeichnung trägt und die Legende viele Zonen nennt
- **THEN** steht der Lageplan weiter auf einem Blatt, das Bild ist kleiner
- **AND** die Maßstabsleiste und „Maßstab ca. 1 : N“ gelten für das kleinere Bild

### Requirement: Legende nur aus dem Gezeichneten

Die Legende SHALL nur nennen, was auf dem Bild gezeichnet ist: Ebenen mit Anzahl in der Folge der
Leiste, jede Zone mit ihrer Beschriftung, aktive Fachebenen mit Stand und sichtbare
Bild-Hintergründe. Die Warnstufe einer Gefahrenzone MUST als Text in ihrer Zeile stehen. Eine
Ebene, deren Modul gesperrt ist, MUST weder auf dem Bild noch in der Legende erscheinen. Ist eine
Fachebene veraltet, SHALL über der Legende ein Hinweis mit Name und Stand stehen.

#### Scenario: Gesperrte Ebene

- **WHEN** das Modul Einsatzabschnitte im Einsatz ausgeblendet ist und eine Abschnittsfläche besteht
- **THEN** nennt die Legende keine Abschnitte

#### Scenario: Zone mit Warnstufe

- **WHEN** eine Gefahrenzone mit Warnstufe auf der Karte liegt
- **THEN** steht ihre Zeile mit Name und Warnstufe als Text in der Legende

#### Scenario: Veraltete Fachebene

- **WHEN** eine aktive Fachebene älter ist als ihre Schwelle
- **THEN** steht über der Legende „Veraltete Fachebene: <Name> (Stand <Zeit>)“

### Requirement: Lageplan als Anlage an Lagebericht oder Befehl

Die Lagekarte SHALL „Als Anlage an …“ als Nebenweg anbieten. Der Weg SHALL einen Dialog öffnen,
der die offenen Entwürfe (Lageberichte und Befehle im Entwurf, nach Freigabe ihres Moduls) und
„Neuer Lagevortrag“ anbietet. „Anfügen“ SHALL den Ausschnitt aufnehmen, ein PNG-Blatt mit Kopf,
Karte, Maßstab, Nordpfeil und Legende setzen und es über den Anlagen-Weg mit der Art `lageplan`
und dem Titel „Lageplan“ ablegen.

#### Scenario: An einen offenen Entwurf

- **WHEN** eine Person „Als Anlage an …“ wählt, einen Lagebericht im Entwurf wählt und anfügt
- **THEN** trägt der Lagebericht eine Anlage „Lageplan“ der Art `lageplan`
- **AND** die Person bleibt auf der Lagekarte

#### Scenario: An einen neuen Lagevortrag

- **WHEN** eine Person „Neuer Lagevortrag“ wählt und anfügt
- **THEN** entsteht ein Lagebericht der Vorlage `lagebericht` mit dem Lageplan als Anlage 1
- **AND** der neue Lagebericht öffnet sich

### Requirement: Rückmeldung und Ablehnung beim Anfügen

Nach dem Anfügen an einen bestehenden Entwurf SHALL der Erfolg als Rückmeldung erscheinen, der
Entwurf bleibt geschlossen. Eine Ablehnung MUST im Dialog stehen, der offen bleibt. Während des
Ablegens MUST Abbrechen gesperrt sein.

#### Scenario: Höchstzahl erreicht

- **WHEN** der gewählte Entwurf schon die Höchstzahl an Anlagen trägt und angefügt wird
- **THEN** steht der Grund im Dialog, und der Dialog bleibt offen

### Requirement: Gesperrter Weg nennt den Grund

Ohne Schreibrecht, ohne Verbindung oder ohne Freigabe beider Module MUST „Als Anlage an …“ gesperrt
mit Grund im Text stehen, nicht versteckt und nicht nur als Tooltip.

#### Scenario: Ohne Schreibrecht

- **WHEN** eine Person ohne Schreibrecht im Einsatz die Lagekarte öffnet
- **THEN** steht „Als Anlage an … (nur Einsatzleitung und Führungspersonal)“ gesperrt im Kopf
