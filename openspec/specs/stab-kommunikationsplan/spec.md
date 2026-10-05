# stab-kommunikationsplan Specification

## Purpose
Der Kommunikationsplan des Sachgebiets S6: wer im Einsatz über welche Verbindung außerhalb des
Funks erreichbar ist (Festnetz, Mobil, Fax, E-Mail, Messenger, Melder). Er führt die Verbindungen
der Führungsfunktionen und externen Stellen und zeigt die vorhandenen Angaben der Abschnitte und
Einheiten, ohne sie doppelt zu pflegen.

## Requirements

### Requirement: Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile
Der Kommunikationsplan SHALL unter einer eigenen, als Lesezeichen tauglichen Adresse unter dem
Stab-Modul eines Einsatzes erreichbar sein, mit dem Stab-Modul als aktiv in der Navigation. Die
S6-Zeile der Stabseite SHALL einen Verweis „Kommunikationsplan“ tragen. Er MUST NOT als eigenes
Modul erscheinen und erbt Sichtbarkeit und Sperre des Stabs. Solange die Stab-Freigabe nicht
ermittelt ist, MUST die Seite keine Daten zeigen.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf den Stab in der Zeile S6 auf „Kommunikationsplan“ tippt
- **THEN** öffnet sich der Kommunikationsplan des Einsatzes unter seiner eigenen Adresse, und das
  Stab-Modul ist in der Navigation als aktiv markiert

#### Scenario: Stab gesperrt
- **WHEN** das Stab-Modul für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** ist der Kommunikationsplan nicht erreichbar, und der Server lehnt das Lesen mit 403 ab

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und keine Verbindungen

### Requirement: Stellen in festen Gruppen
Der Kommunikationsplan SHALL eine Zeile je Stelle zeigen, in dieser Reihenfolge der Gruppen:
Einsatzleitung und Stab, Abschnitte, Einheiten, externe Stellen. In „Einsatzleitung und Stab“ MUST
die Reihenfolge der des Funktionskatalogs folgen, in den übrigen Gruppen der Sortierung der
Quelle. Die Spalte „Stelle“ MUST eine menschenlesbare Kennung tragen und beim waagerechten
Bildlauf stehen bleiben.

#### Scenario: Gruppenfolge
- **WHEN** ein Einsatz eine Verbindung für S2, einen Abschnitt mit Erreichbarkeit und die Leitstelle
  erfasst hat
- **THEN** steht S2 vor dem Abschnitt und der Abschnitt vor der Leitstelle

#### Scenario: Katalogfolge
- **WHEN** Verbindungen für S4 und für die Einsatzleitung erfasst sind
- **THEN** steht die Einsatzleitung vor S4

### Requirement: Gepflegte Stellen aus Funktionskatalog oder extern
Personen mit Schreibrecht auf den Stab SHALL Stellen anlegen, umbenennen und entfernen können. Eine
Stelle ist entweder eine Führungsfunktion aus dem Katalog oder eine externe Stelle der Art
Leitstelle, Behörde, Verbindungsperson oder sonstige. Eine Führungsfunktion MUST je Einsatz
höchstens einmal vorkommen; Führungshilfspersonal und Fachberater MUST eine Bezeichnung tragen und
dürfen mit verschiedenen Bezeichnungen mehrfach vorkommen. Eine externe Stelle MUST eine
Bezeichnung tragen.

#### Scenario: Unbekannter Funktionscode
- **WHEN** eine Stelle mit dem Funktionscode `s9` angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

#### Scenario: Fachberater ohne Bezeichnung
- **WHEN** eine Stelle „Fachberater“ ohne Bezeichnung angelegt werden soll
- **THEN** antwortet der Server mit 422

#### Scenario: Doppelte Funktion
- **WHEN** im Einsatz schon eine Stelle S3 besteht und eine zweite angelegt werden soll
- **THEN** antwortet der Server mit 409, und die bestehende Stelle bleibt unverändert

#### Scenario: Externe Stelle ohne Bezeichnung
- **WHEN** eine Stelle der Art Leitstelle mit leerer Bezeichnung angelegt werden soll
- **THEN** antwortet der Server mit 400

#### Scenario: S7 ausgeschaltet
- **WHEN** S7 in der Organisation ausgeschaltet ist und eine Stelle S7 angelegt werden soll
- **THEN** antwortet der Server mit 422

### Requirement: Verbindungen je Stelle
Eine gepflegte Stelle SHALL beliebig viele Verbindungen tragen, in der Reihenfolge ihrer Anlage.
Jede Verbindung hat ein Mittel aus der Liste Festnetz, Mobil, Fax, E-Mail, Messenger, Melder,
sonstiges, einen Wert (Rufnummer, Adresse oder Beschreibung, Pflicht, höchstens 200 Zeichen) und
einen optionalen Hinweis (höchstens 200 Zeichen). Personen mit Schreibrecht auf den Stab SHALL
Verbindungen anlegen, ändern und entfernen können.

#### Scenario: Zwei Verbindungen einer Stelle
- **WHEN** für die Leitstelle „Festnetz 0421 1234“ und danach „Fax 0421 1235“ erfasst werden
- **THEN** zeigt die Zeile der Leitstelle beide Verbindungen in dieser Reihenfolge

#### Scenario: Unbekanntes Mittel
- **WHEN** eine Verbindung mit dem Mittel `brieftaube` angelegt werden soll
- **THEN** antwortet der Server mit 400

#### Scenario: Leerer Wert
- **WHEN** eine Verbindung ohne Wert angelegt werden soll
- **THEN** antwortet der Server mit 400, und nichts wird gespeichert

### Requirement: Entfernen einer Stelle mit Verbindungen braucht eine zweite Handlung
Das Entfernen einer Stelle SHALL ihre Verbindungen, ihre Sprechgruppen-Zuordnungen und ihre
Verbindungen in der Fernmeldeskizze mit entfernen. Trägt die Stelle mindestens eines davon, MUST
die Oberfläche das Entfernen erst nach einer Bestätigung ausführen, die die Zahl der betroffenen
Verbindungen, Sprechgruppen und Skizzen-Verbindungen nennt.

#### Scenario: Stelle mit Verbindungen entfernen
- **WHEN** eine Person die Stelle „Polizei PI Nord“ mit zwei Verbindungen entfernen will
- **THEN** fragt die Oberfläche nach, nennt zwei Verbindungen, und erst nach der Bestätigung sind
  Stelle und Verbindungen weg

#### Scenario: Stelle mit Kanal und Skizzen-Verbindung entfernen
- **WHEN** eine Person die Leitstelle mit einer Sprechgruppe und einer Datenverbindung in der Skizze
  entfernen will
- **THEN** nennt die Rückfrage eine Sprechgruppe und eine Skizzen-Verbindung, und nach der
  Bestätigung sind Stelle, Zuordnung und Skizzen-Verbindung weg

### Requirement: Abschnitte und Einheiten werden abgeleitet, nicht doppelt gepflegt
Für jeden Abschnitt und jede Einheit mit Kommunikationsmittel oder Erreichbarkeit SHALL der
Kommunikationsplan eine Zeile aus diesen vorhandenen Angaben zeigen. Diese Zeilen MUST NOT hier
bearbeitbar sein; ihre Kennung MUST zum Datensatz führen, an dem die Angaben gepflegt werden.
Abschnitte und Einheiten ohne beide Angaben MUST NOT erscheinen. Für Abschnitte und Einheiten
MUST NOT eine zweite Datenhaltung entstehen.

#### Scenario: Einheit mit Erreichbarkeit
- **WHEN** die Einheit „1. Zug“ das Kommunikationsmittel „Mobil“ und die Erreichbarkeit
  „0151 23456“ trägt
- **THEN** zeigt der Kommunikationsplan in der Gruppe Einheiten die Zeile „1. Zug“ mit „Mobil ·
  0151 23456“, und ein Tippen auf „1. Zug“ öffnet die Detailseite der Einheit

#### Scenario: Einheit ohne Angaben
- **WHEN** eine Einheit weder Kommunikationsmittel noch Erreichbarkeit trägt
- **THEN** erscheint sie nicht im Kommunikationsplan

### Requirement: Rechteweiche je Quelle
Der Kommunikationsplan SHALL Abschnitte, Einheiten, Besetzung des Stabs und die gepflegten Stellen
einzeln laden. Ist eine Quelle gesperrt (403) oder nicht geladen, MUST die Seite das an ihrer
Gruppe mit Grund sagen („nicht freigegeben“, „nicht geladen“) und die übrigen Gruppen weiter
zeigen. Eine fehlende Quelle MUST NOT als leere Gruppe erscheinen.

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** steht bei der Gruppe Einheiten „nicht freigegeben“, und die Gruppen Einsatzleitung und
  Stab, Abschnitte und externe Stellen bleiben vollständig

### Requirement: Verbindung an der Stelle, Besetzung nur als Nebentext
Eine Verbindung SHALL der Stelle gehören, nicht einer Person. Die Zeile einer Führungsfunktion
SHALL die aktuelle Besetzung aus dem Stab als Nebentext zeigen. Der Kommunikationsplan MUST NOT
Kontaktangaben aus dem Einsatzpersonal übernehmen oder vorschlagen. Eine Zeile für die eigene
Führungsstelle MUST NOT aus anderen Daten vermutet werden.

#### Scenario: Besetzung wechselt
- **WHEN** S2 eine Verbindung „Mobil 0170 111“ trägt und die Besetzung von S2 auf eine andere
  Person wechselt
- **THEN** bleibt die Verbindung an S2 stehen, und der Nebentext nennt die neue Besetzung

#### Scenario: Telefon am Personal
- **WHEN** die Person, die S2 besetzt, im Einsatzpersonal eine Telefonnummer trägt
- **THEN** erscheint diese Nummer nicht im Kommunikationsplan

### Requirement: Antippbare Verbindungen
Am Bildschirm SHALL eine Verbindung mit dem Mittel Festnetz oder Mobil als Telefonverweis und eine
mit dem Mittel E-Mail als E-Mail-Verweis antippbar sein. Andere Mittel MUST als Text erscheinen.
Rufnummern MUST in Festbreitenschrift mit gleich breiten Ziffern stehen.

#### Scenario: Rufnummer antippen
- **WHEN** eine Person am Tablet auf „0421 1234“ der Leitstelle tippt
- **THEN** öffnet das Gerät den Anruf an diese Nummer

### Requirement: Lücke „Leitstelle“
Trägt keine Stelle der Art Leitstelle eine Verbindung im Kommunikationsplan, eine Sprechgruppe oder
eine Verbindung in der Fernmeldeskizze, SHALL der Kommunikationsplan im ersten Bild den Hinweis
„Leitstelle: keine Verbindung erfasst“ zeigen, bei 1366 × 768 px mit offenem Modulpanel. Ist die
Liste der gepflegten Stellen nicht geladen, MUST statt des Hinweises „—“ mit Grund stehen. Fehlen
nur die Daten der Fernmeldeskizze, MUST der Hinweis aus den übrigen Angaben entstehen, wenn diese
schon eine Verbindung belegen, sonst „—“ mit Grund.

#### Scenario: Keine Leitstelle
- **WHEN** ein Einsatz nur Verbindungen für S2 und eine Behörde trägt
- **THEN** zeigt die Seite oberhalb der Tabelle „Leitstelle: keine Verbindung erfasst“

#### Scenario: Leitstelle erfasst
- **WHEN** die Leitstelle eine Verbindung trägt
- **THEN** fehlt der Hinweis

#### Scenario: Leitstelle nur über Funk
- **WHEN** die Leitstelle keine Verbindung im Kommunikationsplan, aber die Sprechgruppe
  „TMO SL AS“ trägt
- **THEN** fehlt der Hinweis

### Requirement: Live und ohne Schreibrecht nur lesend
Änderungen an Stellen und Verbindungen SHALL bei anderen geöffneten Kommunikationsplänen desselben
Einsatzes ohne Neuladen erscheinen. Ohne Schreibrecht auf den Stab MUST die Seite keine
Bearbeitungsmöglichkeit zeigen, und der Server MUST jede Änderung mit 403 ablehnen. Ein Ändern
erzeugt keinen ETB-Eintrag.

#### Scenario: Beobachter
- **WHEN** eine Person mit Leserecht, aber ohne Schreibrecht auf den Stab den Kommunikationsplan
  öffnet
- **THEN** sieht sie alle Verbindungen, aber keinen Knopf zum Anlegen, Ändern oder Entfernen

#### Scenario: Zweite Person sieht die Änderung
- **WHEN** zwei Personen den Kommunikationsplan geöffnet haben und eine eine Verbindung anlegt
- **THEN** erscheint die Verbindung bei der anderen ohne Neuladen

### Requirement: Druck als eigenes Druckstück
Der Kommunikationsplan SHALL über „Drucken / als PDF“ als eigenes Druckstück mit der Dokumentart
„Kommunikationsplan“ gedruckt werden, auf A4 hochkant, mit allen Gruppen und Verbindungen samt
Rufnummern. Bedienelemente MUST im Druck fehlen. Die Anforderungen der Capability
`druck-dokumente` gelten unverändert.

#### Scenario: Druck
- **WHEN** eine Person den Kommunikationsplan druckt
- **THEN** enthält der Ausdruck den Druckkopf mit Einsatz und Stand, jede Stelle mit ihren
  Verbindungen und keinen Knopf, und kein Teil ist rechts abgeschnitten

### Requirement: Keine Übernahme in den Lagebericht
Der Kommunikationsplan MUST NOT eine Aktion „In Lagebericht übernehmen“ anbieten.

#### Scenario: Werkzeugzeile
- **WHEN** eine Person mit Schreibrecht im Einsatz den Kommunikationsplan öffnet
- **THEN** bietet die Werkzeugzeile Drucken, aber keine Übernahme in einen Lagebericht

### Requirement: Personenbezug wird bei der Aufbewahrung geschwärzt
Bei der Schwärzung eines Einsatzes SHALL das System Wert und Hinweis jeder Verbindung und die
Bezeichnung jeder Stelle schwärzen. Art der Stelle, Funktionscode und Mittel MUST erhalten bleiben.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit der Verbindungsperson „Herr Beispiel, Stadtverwaltung“ und der
  Verbindung „Mobil 0170 999“ geschwärzt wird
- **THEN** stehen weder der Name noch die Nummer mehr in der Datenbank, und die Stelle ist weiter
  als Verbindungsperson mit einer Verbindung „Mobil“ erkennbar

### Requirement: Bearbeiten ohne Netz gesperrt
Ohne Verbindung zum Server SHALL der Kommunikationsplan seinen zuletzt geladenen Stand lesbar zeigen
(Capability `lagebild-offline-lesen`). Anlegen, Ändern und Entfernen MUST ohne Verbindung gesperrt
sein und MUST NOT in eine Warteschlange gehen.

#### Scenario: Offline öffnen
- **WHEN** eine Person den Kommunikationsplan mit Netz geöffnet hat, das Netz wegfällt und sie neu
  lädt
- **THEN** sieht sie die zuletzt geladenen Verbindungen, gekennzeichnet als offline, und die Knöpfe
  zum Bearbeiten sind gesperrt

### Requirement: Externe Stellen tragen Sprechgruppen
Eine externe Stelle (Leitstelle, Behörde, Verbindungsperson, sonstige) SHALL Sprechgruppen des
Katalogs oder des Einsatzes tragen können, je mit Status bestehend oder geplant. Eine
Führungsfunktion MUST keine Sprechgruppe tragen. Der Kommunikationsplan SHALL die Sprechgruppen
einer externen Stelle als Nebentext ihrer Zeile zeigen; bearbeitet werden sie in der
Fernmeldeskizze.

#### Scenario: Leitstelle mit Kanal
- **WHEN** der Leitstelle „ILS Musterhausen“ die Sprechgruppe „TMO SL AS“ zugeordnet ist
- **THEN** zeigt ihre Zeile im Kommunikationsplan „TMO SL AS“ als Nebentext

#### Scenario: Funktion mit Sprechgruppe
- **WHEN** der Stelle S2 eine Sprechgruppe zugeordnet werden soll
- **THEN** antwortet der Server mit 422, und nichts wird gespeichert

#### Scenario: Fremde Sprechgruppe
- **WHEN** einer Stelle die einsatzlokale Sprechgruppe eines anderen Einsatzes zugeordnet werden
  soll
- **THEN** antwortet der Server mit 404 oder 422, und nichts wird gespeichert
