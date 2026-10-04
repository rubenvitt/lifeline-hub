# Spec Delta

## Purpose

Regelt das Bearbeiten der Fernmeldeskizze des S6 am Bild: Layout, Zuordnen von Sprechgruppen,
externe Stellen, Verbindungen, Komponenten, Bereiche und Schriftfeld, mit Tastatur, Touch,
Rückgängig, Rechten und gleichzeitigem Arbeiten mehrerer Arbeitsplätze.

## ADDED Requirements

### Requirement: Auto-Layout aus der Führungsorganisation
Ohne gespeicherte Lage SHALL die Skizze hängend nach der Führungsorganisation angeordnet sein:
Führungsstelle oben, darunter die obersten Abschnitte in Spalten, darunter ihre Einheiten, jede
Schiene waagerecht unter ihrem höchsten Teilnehmer, externe Stellen in einer Spalte am Rand. Jedes
Element des Einsatzes MUST auf der Fläche stehen; keines MUST nur in einer Palette auftauchen.

#### Scenario: Erstes Öffnen
- **WHEN** die Skizze eines Einsatzes zum ersten Mal geöffnet wird, mit Führungsstelle, zwei
  Abschnitten und je zwei Einheiten
- **THEN** steht die Führungsstelle oben, die Abschnitte in zwei Spalten darunter und unter jedem
  Abschnitt seine Einheiten

### Requirement: Verschieben mit Raster und gespeicherter Lage
Personen mit Bearbeitungsrecht SHALL jedes Element und jede Schiene frei verschieben können; die
Lage rastet am Raster ein und wird gespeichert. Ein verschobenes Element MUST nach dem Neuladen und
an jedem anderen Arbeitsplatz an derselben Stelle stehen. Elemente ohne gespeicherte Lage stellt
weiter das Auto-Layout.

#### Scenario: Lage bleibt
- **WHEN** eine Person die Einheit „1. Zug“ verschiebt und die Seite neu lädt
- **THEN** steht „1. Zug“ an der verschobenen Stelle

### Requirement: Neu anordnen
„Neu anordnen“ SHALL nach einer Rückfrage alle gespeicherten Lagen des Einsatzes verwerfen und das
Auto-Layout zeigen. Zuordnungen, Verbindungen, Komponenten, Bereiche und Schriftfeld MUST
unverändert bleiben.

#### Scenario: Neu anordnen
- **WHEN** eine Person nach Verschieben mehrerer Elemente „Neu anordnen“ bestätigt
- **THEN** steht die Skizze im Auto-Layout, und jede Stelle hängt weiter an denselben Schienen

### Requirement: Gleichzeitiges Verschieben überschreibt nicht still
Verschieben zwei Arbeitsplätze dasselbe Element ausgehend vom selben Stand, SHALL nur das zuerst
gespeicherte Verschieben gelten. Der zweite Arbeitsplatz MUST das Element an der gespeicherten
Stelle zeigen und „von einem anderen Arbeitsplatz verschoben“ melden. Der Server MUST ein
Verschieben mit veraltetem Stand mit 409 ablehnen.

#### Scenario: Zwei Personen ziehen dieselbe Einheit
- **WHEN** A und B „1. Zug“ vom selben Stand aus verschieben und A zuerst speichert
- **THEN** steht „1. Zug“ bei beiden an A’s Stelle, und B sieht die Meldung „von einem anderen
  Arbeitsplatz verschoben“

### Requirement: Sprechgruppe zuordnen durch Ziehen
Zieht eine Person mit Bearbeitungsrecht eine Stelle auf eine Schiene oder vom Anschlusspunkt der
Stelle auf die Schiene, SHALL der Stelle diese Sprechgruppe zugeordnet werden, im Datensatz der
Stelle. Funkplan-Tabelle, Datensatz und andere geöffnete Arbeitsplätze MUST das ohne Neuladen
zeigen. Andere Zuordnungen der Stelle MUST unverändert bleiben, auch wenn ein anderer Arbeitsplatz
gleichzeitig zuordnet.

#### Scenario: Einheit auf die Schiene
- **WHEN** eine Person die Einheit „1. Zug“ auf die Schiene „DMO 314_F*“ zieht
- **THEN** ist „DMO 314_F*“ der Einheit zugeordnet, und Funkplan-Tabelle und Detailseite der
  Einheit zeigen das ohne Neuladen

#### Scenario: Gleichzeitig zwei Kanäle
- **WHEN** A der Einheit „1. Zug“ „TMO 311“ und B gleichzeitig „DMO 505“ zuordnet
- **THEN** trägt „1. Zug“ danach beide Sprechgruppen

### Requirement: Zuordnung lösen
Zieht eine Person eine Stichleitung von der Schiene weg oder drückt sie Entf an einer gewählten
Stichleitung, SHALL die Zuordnung im Datensatz gelöst werden, ohne Rückfrage, mit Rückgängig.

#### Scenario: Stichleitung lösen
- **WHEN** eine Person die Stichleitung von „1. Zug“ an „DMO 314_F*“ wählt und Entf drückt
- **THEN** ist „DMO 314_F*“ der Einheit nicht mehr zugeordnet, und die Stichleitung ist weg

### Requirement: Schiene aus der Palette
Die Palette SHALL die Sprechgruppen des Einsatzes und des Katalogs als ziehbare Einträge führen.
Zieht eine Person einen Eintrag auf die Fläche, SHALL dort die Schiene stehen, auch bevor eine
Stelle daran hängt. Ein Katalog-Eintrag MUST dabei unverändert bleiben.

#### Scenario: Katalog-Sprechgruppe auf die Fläche
- **WHEN** eine Person „TMO SL AS“ aus dem Katalog auf die Fläche zieht
- **THEN** steht dort die Schiene „TMO SL AS“ ohne Teilnehmer, und das Lücken-Paneel zählt sie bei
  „Sprechgruppen mit nur einem Teilnehmer“ nicht doppelt

### Requirement: Verbinden ohne Ziehen
Jede Zuordnung und jede Verbindung, die durch Ziehen entsteht, SHALL auch über „Verbinden mit …“
entstehen: eine Suche über Schienen und Stellen, erreichbar über Taste und Knopf am gewählten
Element. Elemente MUST mit Tab in der Reihenfolge der Führungsorganisation erreichbar und mit den
Pfeiltasten um ein Rasterfeld verschiebbar sein.

#### Scenario: Zuordnen mit der Tastatur
- **WHEN** eine Person mit Tab „1. Zug“ wählt, „Verbinden mit …“ öffnet, „DMO 314_F*“ sucht und mit
  Enter bestätigt
- **THEN** ist „DMO 314_F*“ der Einheit zugeordnet, ohne dass ein Zeiger benutzt wurde

#### Scenario: Verschieben mit Pfeiltasten
- **WHEN** eine Person „EA 1“ gewählt hat und zweimal Pfeil rechts drückt
- **THEN** steht „EA 1“ zwei Rasterfelder weiter rechts, und die Lage ist gespeichert

### Requirement: Rückgängig und Wiederholen
Strg+Z SHALL die letzte eigene Handlung in der Skizze dieses Tabs zurücknehmen (Zuordnen, Lösen,
Verschieben, Anlegen, Entfernen, Ändern), Strg+Y bzw. Strg+Umschalt+Z sie wiederholen; dazu je ein
Knopf. Handlungen anderer Arbeitsplätze MUST NOT zurückgenommen werden. Kann eine Handlung nicht
mehr zurückgenommen werden, MUST der Grund am Element stehen.

#### Scenario: Zuordnung zurücknehmen
- **WHEN** eine Person „1. Zug“ auf „DMO 314_F*“ gezogen hat und Strg+Z drückt
- **THEN** ist „DMO 314_F*“ der Einheit wieder nicht zugeordnet

#### Scenario: Datensatz inzwischen gelöscht
- **WHEN** „1. Zug“ an einem anderen Arbeitsplatz gelöscht wurde und die Person Strg+Z für ihre
  Zuordnung drückt
- **THEN** meldet die Skizze, dass die Einheit nicht mehr besteht, und nichts sonst ändert sich

### Requirement: Externe Stelle anlegen und anbinden
Personen mit Schreibrecht auf den Stab SHALL in der Skizze eine externe Stelle (Leitstelle,
Behörde, Verbindungsperson, sonstige) mit frei wählbarer Bezeichnung anlegen und sie wie jede
Stelle an Schienen binden können, mit Status bestehend oder geplant. Die Stelle MUST dieselbe sein
wie im Kommunikationsplan. Sie MUST NOT einen Abschnitt oder eine Einheit anlegen.

#### Scenario: Leitstelle im rückwärtigen Bereich
- **WHEN** eine Person die Leitstelle „ILS Musterhausen“ anlegt, in den rückwärtigen Bereich zieht
  und über „TMO SL AS“ mit der Führungsstelle verbindet
- **THEN** stehen beide an der Schiene „TMO SL AS“, die Leitstelle steht im Kommunikationsplan, und
  im Einsatz ist weder ein Abschnitt noch eine Einheit hinzugekommen

### Requirement: Punkt-zu-Punkt-Verbindung anlegen und ändern
Personen mit Schreibrecht auf den Stab SHALL zwischen zwei Stellen oder Komponenten eine Verbindung
anlegen, ändern und entfernen können: Art (Telefon, Fax, Daten, Melder, Bild, Livestream,
Richtfunk, Satellit, sonstige), Medium (Funk, leitergebunden), Status (bestehend, geplant),
Betriebsart (Wechsel- oder Gegenverkehr, optional) und Hinweis (höchstens 200 Zeichen). Eine
Verbindung MUST NOT eine Rufnummer tragen.

#### Scenario: Melder als Übergang
- **WHEN** eine Person vom Abschnitt „EA 2“ zur Stelle „Einheit auf dem Marsch“ zieht und „Melder“
  wählt
- **THEN** besteht zwischen beiden eine Verbindung der Art Melder

#### Scenario: Unbekannte Art
- **WHEN** eine Verbindung der Art `brieftaube` angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

### Requirement: Komponenten anlegen und anbinden
Personen mit Schreibrecht auf den Stab SHALL Komponenten (Repeater, Gateway, Basisstation, mobile
Basisstation, Antenne, Vermittlung) mit Bezeichnung anlegen, an Schienen binden, durch
Verbindungen anschließen und entfernen können.

#### Scenario: Repeater zwischen zwei DMO-Gruppen
- **WHEN** eine Person einen Repeater anlegt und an „DMO 314_F*“ und „DMO 315_F*“ bindet
- **THEN** hängt der Repeater an beiden Schienen

### Requirement: Bereich anlegen
Personen mit Schreibrecht auf den Stab SHALL einen Bereich mit Bezeichnung (Vorgabe
„Rückwärtiger Bereich“) anlegen, in Lage und Größe ändern und entfernen können.

#### Scenario: Bereich aufziehen
- **WHEN** eine Person einen Bereich anlegt und seine Ecke zieht
- **THEN** wächst der Bereich mit, und seine Größe ist gespeichert

### Requirement: Schriftfeld pflegen
Personen mit Schreibrecht auf den Stab SHALL Herausgeber, VS-Vermerk, „Gültig ab“ und „gez.“ (Name
und DTG) des Schriftfelds ändern können. „Stand“ MUST sich selbst aus der letzten Änderung ergeben.
Der Name bei „gez.“ MUST bei der Aufbewahrung geschwärzt werden.

#### Scenario: Gültig ab setzen
- **WHEN** eine Person „Gültig ab“ auf 041800Okt26 setzt
- **THEN** zeigt das Schriftfeld am Bildschirm und im Druck „041800Okt26“

### Requirement: Eigenschaftspaneel des gewählten Elements
Das gewählte Element SHALL seine Angaben in einem Paneel neben der Fläche zeigen, inline
bearbeitbar nach den Bearbeitungsprimitiven des Projekts: Stelle mit Rufname und
Kommunikationsmittel und dem Verweis „zum Datensatz“; Schiene mit Betriebsart, Bezeichnung,
Hinweis, Herkunft und Teilnehmern (nur lesend, mit Verweis auf die Sprechgruppe); Verbindung mit
Art, Medium, Status, Betriebsart und Hinweis. Rufname und Kommunikationsmittel MUST im Datensatz
der Stelle gespeichert werden.

#### Scenario: Rufname im Paneel
- **WHEN** eine Person „1. Zug“ wählt und im Paneel den Rufnamen „Florian Musterstadt 1/1“ setzt
- **THEN** trägt die Einheit diesen Funkrufnamen in Tabelle, Detailseite und Skizze

#### Scenario: Zum Datensatz
- **WHEN** eine Person „EA 1“ wählt und im Paneel „zum Datensatz“ wählt
- **THEN** öffnet sich die Abschnittsseite mit „EA 1“ ausgewählt

### Requirement: Bearbeiten nur mit Recht am Datensatz
Bearbeiten SHALL je Element das Schreibrecht seines Datensatzes verlangen: Abschnitte das Recht auf
Abschnitte, Einheiten das auf Einheiten, die Führungsstelle das der Einsatzverwaltung, alles
Skizzeneigene und externe Stellen das auf den Stab. Ohne Recht MUST das Element keinen Griff
anbieten und im Paneel den Grund nennen. Ohne Schreibrecht im Einsatz MUST die Fläche
schreibgeschützt sein; Hervorheben, Filtern und Zoomen MUST weiter gehen. Der Server MUST jede
Änderung ohne Recht mit 403 ablehnen.

#### Scenario: Nur Leserecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz die Skizze öffnet
- **THEN** kann sie nichts verschieben, zuordnen oder anlegen, aber Schienen hervorheben und zoomen

#### Scenario: Recht auf Stab, nicht auf Einheiten
- **WHEN** eine Person mit Schreibrecht auf den Stab, aber ohne Schreibrecht auf Einheiten „1. Zug“
  auf eine Schiene ziehen will
- **THEN** bietet „1. Zug“ keinen Griff an, das Paneel nennt „Einheiten: kein Schreibrecht“, und
  ein direkter Aufruf wird mit 403 abgelehnt

### Requirement: Touch und mobil
Am Führungs-Tablet SHALL jede Handlung mit dem Finger gehen: Ziehen, Zoomen mit zwei Fingern,
Langdruck für das Kontextmenü, Trefferflächen nach der Dichte-Staffel. Mobil (unter 768 px) MUST
die Fläche nur lesen, zoomen und hervorheben lassen.

#### Scenario: Kontextmenü am Tablet
- **WHEN** eine Person am Tablet lange auf „1. Zug“ drückt
- **THEN** öffnet sich das Kontextmenü mit „Verbinden mit …“ und „zum Datensatz“

#### Scenario: Mobil
- **WHEN** eine Person mit Schreibrecht die Skizze bei 390 px öffnet
- **THEN** bietet die Fläche keinen Griff, aber Zoom und Hervorheben

### Requirement: Bezüge verwaisen nicht
Wird ein Abschnitt, eine Einheit, eine externe Stelle oder eine Komponente gelöscht, SHALL die
Skizze ihre Lage und ihre Verbindungen im selben Schritt verlieren. Eine Verbindung MUST NOT auf
ein gelöschtes Element zeigen.

#### Scenario: Einheit gelöscht
- **WHEN** die Einheit „1. Zug“ mit gespeicherter Lage und einer Melder-Verbindung gelöscht wird
- **THEN** zeigt die Skizze weder „1. Zug“ noch die Melder-Verbindung, und der Abruf der
  Skizzendaten enthält keinen Bezug auf sie

### Requirement: Kein ETB je Skizzenänderung
Änderungen an Lage, Komponenten, Verbindungen, Bereichen und Schriftfeld SHALL keinen ETB-Eintrag
erzeugen. Eine Zuordnung aus der Skizze MUST im ETB dieselbe Wirkung haben wie dieselbe Zuordnung
über den Datensatz.

#### Scenario: Verschieben
- **WHEN** eine Person zehn Elemente verschiebt
- **THEN** entsteht kein ETB-Eintrag
