## MODIFIED Requirements

### Requirement: Bearbeiten nur mit Recht am Datensatz
Bearbeiten SHALL je Element das Schreibrecht seines Datensatzes verlangen: Abschnitte das Recht auf
Abschnitte, Einheiten das auf Einheiten, die Führungsstelle das der Einsatzverwaltung, alles
Skizzeneigene und externe Stellen das auf das Fernmeldewesen. Ein Recht auf den Stab MUST dafür
weder nötig noch hinreichend sein. Ohne Recht MUST das Element keinen Griff anbieten und im Paneel
den Grund nennen. Ohne Schreibrecht im Einsatz MUST die Fläche schreibgeschützt sein; Hervorheben,
Filtern und Zoomen MUST weiter gehen. Der Server MUST jede Änderung ohne Recht mit 403 ablehnen.

#### Scenario: Nur Leserecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz die Skizze öffnet
- **THEN** kann sie nichts verschieben, zuordnen oder anlegen, aber Schienen hervorheben und zoomen

#### Scenario: Recht auf Fernmeldewesen, nicht auf Einheiten
- **WHEN** eine Person mit Schreibrecht auf das Fernmeldewesen, aber ohne Schreibrecht auf Einheiten
  „1. Zug“ auf eine Schiene ziehen will
- **THEN** bietet „1. Zug“ keinen Griff an, das Paneel nennt „Einheiten: kein Schreibrecht“, und
  ein direkter Aufruf wird mit 403 abgelehnt

#### Scenario: Stab ausgeblendet
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person mit Schreibrecht auf das
  Fernmeldewesen eine externe Stelle anlegt
- **THEN** wird sie gespeichert und erscheint in der Skizze

#### Scenario: Recht auf Stab, nicht auf Einheiten
- **WHEN** eine Person mit Schreibrecht auf den Stab, aber ohne Freigabe des Fernmeldewesens die
  Lage eines Elements der Skizze direkt per API speichern will
- **THEN** lehnt der Server mit 403 ab, und nichts wird gespeichert

### Requirement: Externe Stelle anlegen und anbinden
Personen mit Schreibrecht auf das Fernmeldewesen SHALL in der Skizze eine externe Stelle (Leitstelle,
Behörde, Verbindungsperson, sonstige) mit frei wählbarer Bezeichnung anlegen und sie wie jede
Stelle an Schienen binden können, mit Status bestehend oder geplant. Die Stelle MUST dieselbe sein
wie im Kommunikationsplan. Sie MUST NOT einen Abschnitt oder eine Einheit anlegen.

#### Scenario: Leitstelle im rückwärtigen Bereich
- **WHEN** eine Person die Leitstelle „ILS Musterhausen“ anlegt, in den rückwärtigen Bereich zieht
  und über „TMO SL AS“ mit der Führungsstelle verbindet
- **THEN** stehen beide an der Schiene „TMO SL AS“, die Leitstelle steht im Kommunikationsplan, und
  im Einsatz ist weder ein Abschnitt noch eine Einheit hinzugekommen

### Requirement: Punkt-zu-Punkt-Verbindung anlegen und ändern
Personen mit Schreibrecht auf das Fernmeldewesen SHALL zwischen zwei Stellen oder Komponenten eine Verbindung
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
Personen mit Schreibrecht auf das Fernmeldewesen SHALL Komponenten (Repeater, Gateway, Basisstation, mobile
Basisstation, Antenne, Vermittlung) mit Bezeichnung anlegen, an Schienen binden, durch
Verbindungen anschließen und entfernen können.

#### Scenario: Repeater zwischen zwei DMO-Gruppen
- **WHEN** eine Person einen Repeater anlegt und an „DMO 314_F*“ und „DMO 315_F*“ bindet
- **THEN** hängt der Repeater an beiden Schienen

### Requirement: Bereich anlegen
Personen mit Schreibrecht auf das Fernmeldewesen SHALL einen Bereich mit Bezeichnung (Vorgabe
„Rückwärtiger Bereich“) anlegen, in Lage und Größe ändern und entfernen können.

#### Scenario: Bereich aufziehen
- **WHEN** eine Person einen Bereich anlegt und seine Ecke zieht
- **THEN** wächst der Bereich mit, und seine Größe ist gespeichert

### Requirement: Schriftfeld pflegen
Personen mit Schreibrecht auf das Fernmeldewesen SHALL Herausgeber, VS-Vermerk, „Gültig ab“ und „gez.“ (Name
und DTG) des Schriftfelds ändern können. „Stand“ MUST sich selbst aus der letzten Änderung ergeben.
Der Name bei „gez.“ MUST bei der Aufbewahrung geschwärzt werden.

#### Scenario: Gültig ab setzen
- **WHEN** eine Person „Gültig ab“ auf 041800Okt26 setzt
- **THEN** zeigt das Schriftfeld am Bildschirm und im Druck „041800Okt26“
