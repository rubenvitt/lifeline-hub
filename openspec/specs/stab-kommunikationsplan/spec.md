# stab-kommunikationsplan Specification

## Purpose
Der Kommunikationsplan des Sachgebiets S6: wer im Einsatz über welche Verbindung außerhalb des
Funks erreichbar ist (Festnetz, Mobil, Fax, E-Mail, Messenger, Melder). Er führt die Verbindungen
der Führungsfunktionen und externen Stellen und zeigt die vorhandenen Angaben der Abschnitte und
Einheiten, ohne sie doppelt zu pflegen. Er gehört zum Modul Fernmeldewesen (Fähigkeit
`fernmeldewesen`).

## Requirements

### Requirement: Eigene Adresse im Modul Fernmeldewesen
Der Kommunikationsplan SHALL unter `/einsaetze/:id/fernmeldewesen/kommunikationsplan` als
Lesezeichen tauglich erreichbar sein, als Reiter „Kommunikationsplan“ des Moduls Fernmeldewesen und
mit diesem Modul als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls
Fernmeldewesen erben, nicht die des Stabs; den Fall ohne Zugriff fängt der Einsatzrahmen ab
(Capability `modul-freigabe`). Die alte Adresse `/einsaetze/:id/stab/kommunikationsplan` SHALL auf
die neue umleiten. Die S6-Zeile der Stabseite SHALL einen Verweis „Kommunikationsplan“ tragen,
gesperrt, solange das Fernmeldewesen für die Person gesperrt ist. Solange die Freigabe des
Fernmeldewesens nicht ermittelt ist, MUST die Seite keine Daten zeigen.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf Stab und Fernmeldewesen in der Zeile S6 auf
  „Kommunikationsplan“ tippt
- **THEN** öffnet sich der Kommunikationsplan unter seiner Adresse im Modul Fernmeldewesen, und das
  Modul ist in der Navigation als aktiv markiert

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/kommunikationsplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen/kommunikationsplan`

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/kommunikationsplan`
  aufruft
- **THEN** landet sie im Kommunikationsplan des Moduls Fernmeldewesen, nicht beim Hinweis „Stab
  ausgeblendet“

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und keine Verbindungen

#### Scenario: Stab gesperrt
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist und das Fernmeldewesen
  frei
- **THEN** zeigt der Kommunikationsplan alle Stellen und Verbindungen, und eine Person mit
  Schreibrecht kann sie anlegen, ändern und entfernen

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“, und der Server lehnt
  das Lesen unter `…/stab/kommunikationsplan` mit 403 ab, auch wenn der Stab frei ist

### Requirement: Stellen in festen Gruppen
Der Kommunikationsplan SHALL eine Zeile je Stelle zeigen, in dieser Reihenfolge der Gruppen:
Einsatzleitung und Stab, Abschnitte, Einheiten, externe Stellen. In „Einsatzleitung und Stab“ MUST
die Reihenfolge der des Funktionskatalogs folgen, in den übrigen Gruppen der Sortierung der
Quelle. Die Spalte „Stelle“ MUST eine menschenlesbare Kennung tragen und beim waagerechten
Bildlauf stehen bleiben.

#### Scenario: Gruppenfolge
- **WHEN** ein Einsatz eine Verbindung für S2, einen Abschnitt mit einer Verbindung und die Leitstelle
  erfasst hat
- **THEN** steht S2 vor dem Abschnitt und der Abschnitt vor der Leitstelle

#### Scenario: Katalogfolge
- **WHEN** Verbindungen für S4 und für die Einsatzleitung erfasst sind
- **THEN** steht die Einsatzleitung vor S4

### Requirement: Gepflegte Stellen aus Funktionskatalog oder extern
Personen mit Schreibrecht auf das Fernmeldewesen SHALL Stellen anlegen, umbenennen und entfernen können. Eine
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
einen optionalen Hinweis (höchstens 200 Zeichen). Personen mit Schreibrecht auf das Fernmeldewesen SHALL
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
Für jeden Abschnitt und jede Einheit mit mindestens einer Verbindung SHALL der Kommunikationsplan
eine Zeile mit allen ihren Verbindungen in deren Reihenfolge zeigen. Diese Zeilen MUST NOT hier
bearbeitbar sein; ihre Kennung MUST zum Datensatz führen, an dem die Verbindungen gepflegt werden.
Abschnitte und Einheiten ohne Verbindung MUST NOT erscheinen, auch nicht mit Rufname oder
Sprechgruppe. Für Abschnitte und Einheiten MUST NOT eine zweite Datenhaltung entstehen.

#### Scenario: Einheit mit Verbindung
- **WHEN** die Einheit „1. Zug“ die Verbindung „Mobil · 0151 23456“ trägt
- **THEN** zeigt der Kommunikationsplan in der Gruppe Einheiten die Zeile „1. Zug“ mit „Mobil ·
  0151 23456“, und ein Tippen auf „1. Zug“ öffnet die Detailseite der Einheit

#### Scenario: Abschnitt mit mehreren Verbindungen
- **WHEN** der Abschnitt „EA Nord“ die Verbindungen „Festnetz · 0421 77“ und „E-Mail ·
  ea-nord@example.org“ trägt
- **THEN** zeigt seine Zeile beide Verbindungen in dieser Reihenfolge, die erste als
  Telefonverweis, die zweite als E-Mail-Verweis

#### Scenario: Einheit ohne Verbindung
- **WHEN** eine Einheit einen Funkrufnamen, aber keine Verbindung trägt
- **THEN** erscheint sie nicht im Kommunikationsplan

### Requirement: Verbindungen an Abschnitt, Einheit und Führungsstelle
Abschnitt, Einheit und die eigene Führungsstelle SHALL Verbindungen außerhalb des Funks tragen,
typisiert wie die Verbindungen einer gepflegten Stelle: Mittel (Festnetz, Mobil, Fax, E-Mail,
Messenger, Melder, Sonstiges), Wert (Nummer oder Adresse) und optional ein Hinweis. Funk und
Telefon stehen getrennt: Funk zeigt sich an Rufname und Sprechgruppen, die Verbindungen stehen
unter „Telefon und weitere Verbindungen“. Ein Datensatz SHALL höchstens 10 Verbindungen tragen,
Wert und Hinweis je höchstens 200 Zeichen; ein leerer Wert, ein unbekanntes Mittel oder eine
Überschreitung MUST mit 400 abgelehnt werden. Die Verbindungen SHALL als ganze Liste mit dem
Datensatz gespeichert werden; das Entfernen eines Abschnitts oder einer Einheit MUST ihre
Verbindungen mit entfernen. Ein Schreiben mit den Altfeldern `kommunikationsmittel` oder
`erreichbarkeit` MUST mit 400 abgelehnt werden statt still verworfen. Ein Abschnitt SHALL einen
Rufnamen (Funkrufname der Abschnittsleitung, höchstens 200 Zeichen) tragen.

Bei der Einführung SHALL eine vorhandene Erreichbarkeit verlustfrei zu einer Verbindung werden:
mit dem Mittel Mobil bzw. Festnetz, wenn das Kommunikationsmittel so lautete, sonst (Digitalfunk,
leer) mit dem Mittel Sonstiges. Ein Kommunikationsmittel ohne Erreichbarkeit MUST NOT eine
Verbindung ergeben. Wert und Hinweis sind personenbezogen und SHALL bei der Schwärzung eines
Einsatzes und beim Löschersuchen für die führende Person eines Abschnitts oder einer Einheit
geschwärzt werden; Mittel und Reihenfolge bleiben. Ein gesicherter Lagestand MUST die
Verbindungen nicht einfrieren.

#### Scenario: Überführung einer Erreichbarkeit
- **WHEN** eine Einheit vor der Einführung das Kommunikationsmittel „Digitalfunk“ und die
  Erreichbarkeit „ISSI 4711“ trug
- **THEN** trägt sie danach die Verbindung „Sonstiges · ISSI 4711“, und eine Einheit mit
  Kommunikationsmittel „Digitalfunk“ ohne Erreichbarkeit trägt keine Verbindung

#### Scenario: Veralteter Client
- **WHEN** ein Client beim Ändern einer Einheit noch `erreichbarkeit` sendet
- **THEN** antwortet der Server mit 400, und an der Einheit ändert sich nichts

#### Scenario: Abschnitt entfernen
- **WHEN** ein Abschnitt mit zwei Verbindungen entfernt wird
- **THEN** sind auch seine beiden Verbindungen entfernt

### Requirement: Rechteweiche je Quelle
Der Kommunikationsplan SHALL Abschnitte, Einheiten, Besetzung des Stabs und die gepflegten Stellen
einzeln laden. Die Besetzung des Stabs SHALL er nur abrufen, wenn der Stab für die Person frei ist.
Ist eine Quelle gesperrt (403 oder Modul nicht frei) oder nicht geladen, MUST die Seite das an ihrer
Gruppe bzw. Zeile mit Grund sagen („nicht freigegeben“, „nicht geladen“) und die übrigen Gruppen
weiter zeigen. Eine fehlende Quelle MUST NOT als leere Gruppe erscheinen.

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** steht bei der Gruppe Einheiten „nicht freigegeben“, und die Gruppen Einsatzleitung und
  Stab, Abschnitte und externe Stellen bleiben vollständig

#### Scenario: Stab nicht frei
- **WHEN** das Fernmeldewesen frei ist, der Stab aber ausgeblendet oder gesperrt
- **THEN** zeigen die Zeilen der Führungsfunktionen ihre Verbindungen, ihr Nebentext zur Besetzung
  lautet „—“ mit dem Grund „Stab nicht freigegeben“, und es geht keine Anfrage an den Stab

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
Einsatzes ohne Neuladen erscheinen. Ohne Schreibrecht auf das Fernmeldewesen MUST die Seite keine
Bearbeitungsmöglichkeit zeigen, und der Server MUST jede Änderung mit 403 ablehnen. Ein Ändern
erzeugt keinen ETB-Eintrag.

#### Scenario: Beobachter
- **WHEN** eine Person mit Leserecht, aber ohne Schreibrecht auf das Fernmeldewesen den
  Kommunikationsplan öffnet
- **THEN** sieht sie alle Verbindungen, aber keinen Knopf zum Anlegen, Ändern oder Entfernen

#### Scenario: Zweite Person sieht die Änderung
- **WHEN** zwei Personen den Kommunikationsplan geöffnet haben und eine eine Verbindung anlegt
- **THEN** erscheint die Verbindung bei der anderen ohne Neuladen

#### Scenario: Stab-Leser ohne Fernmeldewesen
- **WHEN** eine Person den Stab lesen darf, das Fernmeldewesen aber nicht, und eine andere eine
  Verbindung anlegt
- **THEN** erhält die erste Person dazu kein Live-Ereignis

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

### Requirement: Einsatzleiter an der Zeile der Führungsstelle
Die Zeile der eigenen Führungsstelle SHALL im Nebentext nach dem Rufnamen „Einsatzleiter“ und den
Einsatzleiter nennen, in derselben Darstellung wie Kopfleiste und Funkplan, am Schirm wie im Druck.
Ist keiner erfasst, SHALL dort „Einsatzleiter nicht erfasst“ stehen. Fehlt die Quelle der
Führungsstelle, MUST der Nebentext nur ihren Grund nennen. Der Kommunikationsplan MUST NOT die
App-Rolle als Einsatzleiter zeigen und MUST NOT eine Kontaktangabe des Einsatzleiters zeigen.

#### Scenario: Rufname und Einsatzleiter
- **WHEN** die Führungsstelle den Rufnamen „Florian Kreis 10-1“ trägt und „Anna Schulz“ als Einsatzleiter erfasst ist
- **THEN** lautet der Nebentext der Zeile „Führungsstelle“ „Florian Kreis 10-1 · Einsatzleiter Anna Schulz“

#### Scenario: Ohne Rufname
- **WHEN** die Führungsstelle keinen Rufnamen trägt und „KBM Weber“ als externer Einsatzleiter erfasst ist
- **THEN** lautet der Nebentext „Einsatzleiter KBM Weber (extern)“

#### Scenario: Ohne Einsatzleiter
- **WHEN** die Führungsstelle erfasst ist, aber kein Einsatzleiter, und ein Mitglied die App-Rolle Einsatzleitung trägt
- **THEN** nennt der Nebentext „Einsatzleiter nicht erfasst“, und der Name des Mitglieds steht dort nicht

#### Scenario: Name geschwärzt
- **WHEN** der Name des Einsatzleiters geschwärzt ist
- **THEN** nennt der Nebentext „Einsatzleiter Name geschwärzt“

#### Scenario: Ohne Netz
- **WHEN** der Kommunikationsplan ohne Netz gelesen wird und die Führungsstelle nicht auf dem Gerät liegt
- **THEN** steht die Zeile „Führungsstelle“ mit dem Grund im Nebentext und ohne Einsatzleiter
