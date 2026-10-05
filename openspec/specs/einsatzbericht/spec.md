# einsatzbericht Specification

## Purpose
Fasst einen Einsatz auf wenigen Seiten als Druckstück zusammen: Stammdaten, Zeiten, Führung,
Kräfte, Lage, Bilanz und ETB-Auszug. Er dient der Einsatznachbereitung und als Bericht an
Auftraggeber oder Behörde, vollständig und ohne personenbezogene Daten Betroffener.

## Requirements

### Requirement: Einstieg und eigene Adresse

Die Seite Einsatzdaten SHALL eine Aktion „Einsatzbericht drucken“ anbieten, die eine eigene
Druckansicht des Berichts öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse je
Einsatz haben und SHALL auch über die Sprungpalette erreichbar sein. Gedruckt wird über den
Druckdialog des Browsers wie bei jedem Druckstück.

#### Scenario: Aus den Einsatzdaten öffnen

- **WHEN** eine Person auf der Seite Einsatzdaten „Einsatzbericht drucken“ wählt
- **THEN** öffnet sich die Druckansicht des Einsatzberichts dieses Einsatzes
- **AND** ein Neuladen der Adresse zeigt wieder den Bericht desselben Einsatzes

#### Scenario: Über die Sprungpalette

- **WHEN** eine Person in einem Einsatz die Sprungpalette öffnet und „Einsatzbericht“ sucht
- **THEN** führt der Eintrag zur Druckansicht des Einsatzberichts

### Requirement: Blöcke in fester Reihenfolge

Der Einsatzbericht SHALL seine Blöcke in dieser Reihenfolge drucken: Stammdaten, Zeiten,
Führung, Kräfte, Lage, Bilanz, ETB-Auszug, Anlage Einheiten mit Einsatzzeiten, Anlage Personal
je Kopf. Die ersten sieben bilden den Standardumfang, die beiden Anlagen sind optional. Jeder
gedruckte Block SHALL eine Überschrift tragen und im Ausdruck mit seinem Inhalt beginnen. Ein
gedruckter, lesbarer Block ohne Daten MUST mit einem Vermerk stehen bleiben („keine Einträge“)
und MUST NOT wegfallen.

#### Scenario: Vollständiger Bericht

- **WHEN** ein Einsatz mit Daten in allen Modulen ohne Auswahl als Bericht geöffnet wird
- **THEN** stehen die sieben Blöcke des Standardumfangs in der genannten Reihenfolge
- **AND** keine der beiden Anlagen steht im Bericht

#### Scenario: Leerer Block bleibt stehen

- **WHEN** im Einsatz kein Schaden erfasst ist und das Modul Schäden lesbar ist
- **THEN** steht im Block Bilanz bei den Schäden „keine Einträge“

#### Scenario: Reihenfolge unabhängig von der Adresse

- **WHEN** die Adresse die Blöcke in der Folge ETB-Auszug, Stammdaten nennt
- **THEN** druckt der Bericht Stammdaten vor dem ETB-Auszug

### Requirement: Inhalt der Blöcke

Stammdaten SHALL Bezeichnung, Einsatznummer, Leitstellennummer, Einsatzart, Stichwort,
Einsatzort, meldende Stelle und Sachverhalt nennen, Zeiten SHALL Beginn, Ende und Dauer nennen.
Führung SHALL die Einsatzleitung, die Stabsbesetzung S1–S6 und die abgehaltenen
Lagebesprechungen mit Zeitpunkt und Entschluss nennen. Lage SHALL ein Verzeichnis aller
freigegebenen Lageberichte und den letzten im Volltext zeigen. Der ETB-Auszug SHALL die Zahl der
Einträge je Typ und alle Entscheidungen zeigen.

#### Scenario: Lage mit drei Berichten

- **WHEN** ein Einsatz drei freigegebene Lageberichte und einen Entwurf hat
- **THEN** nennt das Verzeichnis die drei freigegebenen mit Zeitstand, Titel, Version und
  freigebender Person
- **AND** der zuletzt freigegebene steht im Volltext
- **AND** der Entwurf erscheint nicht

#### Scenario: Fortgeschriebener Lagebericht

- **WHEN** ein Lagebericht in Version 2 fortgeschrieben und freigegeben wurde
- **THEN** nennt das Verzeichnis die Kette einmal, mit ihrer neuesten freigegebenen Version

#### Scenario: Entscheidungen im ETB-Auszug

- **WHEN** das ETB neun Entscheidungen enthält
- **THEN** stehen alle neun mit laufender Nummer, Zeitpunkt und Inhalt im Auszug, geordnet
  nach laufender Nummer
- **AND** eine berichtigte Entscheidung ist als berichtigt gekennzeichnet

#### Scenario: Ohne Stichwort und Leitstellennummer

- **WHEN** ein Einsatz kein Stichwort und keine Leitstellennummer hat
- **THEN** stehen die Felder mit „—“ und nicht leer im Bericht

### Requirement: Kräfte zum Druckzeitpunkt und insgesamt

Der Block Kräfte SHALL die Stärke zum Druckzeitpunkt im Format F/UF/M//Σ samt Zahl der
Einheiten und Fahrzeuge nennen. Er SHALL außerdem „insgesamt eingesetzt“ aus der
Kräfte-Zeitachse nennen: Einheiten und Personen mit mindestens einer Periode sowie die Summe
der Einsatzzeit der Personen als Helferstunden. Er MUST nennen, für wie viele der geführten
Personen die Zeitachse Daten hat. Eine Kraft ohne Ereignis MUST NOT mit 0 in die
Helferstunden eingehen.

#### Scenario: Zeitachse lückenhaft

- **WHEN** 42 Personen im Einsatz geführt sind und 38 davon Zeitachsen-Ereignisse haben
- **THEN** nennt der Bericht die Helferstunden der 38
- **AND** er vermerkt „Zeitachse für 38 von 42 Personen erfasst“

#### Scenario: Nach dem Einsatzende

- **WHEN** das Personal aller Einheiten freigegeben ist und der Bericht gedruckt wird
- **THEN** zeigt die Stärke zum Druckzeitpunkt 0/0/0//0
- **AND** „insgesamt eingesetzt“ nennt weiter die Einheiten und Personen mit Zeitachse

#### Scenario: Keine Zeitachse

- **WHEN** keine Kraft ein Zeitachsen-Ereignis hat
- **THEN** steht bei „insgesamt eingesetzt“ „keine Zeitachse erfasst“ statt einer Zahl

### Requirement: Keine personenbezogenen Daten Betroffener

Der Block Bilanz SHALL Betroffene, Patienten, Schäden, Betreuung, Evakuierung und Verpflegung
ausschließlich als Zählung zeigen. Der Bericht MUST keine Namen, Vornamen, Geburtsdaten oder
Registriernummern betroffener Personen und keine Namen Geschädigter enthalten. Namen der
Führungskräfte (Einsatzleitung, Stab, freigebende Personen) SHALL genannt werden.

#### Scenario: Patienten in der Bilanz

- **WHEN** im Einsatz zwölf Patienten mit Sichtung erfasst sind
- **THEN** zeigt die Bilanz die Verteilung nach Sichtungskategorie, Verbleib und Transporten
- **AND** kein Name und keine Registriernummer einer betroffenen Person steht im Bericht

### Requirement: Vollständig oder gar nicht

Der Bericht SHALL nur druckbar sein, wenn die druckende Person jedes im Einsatz sichtbare Modul
lesen darf, aus dem die gewählten Blöcke schöpfen, und alle Abrufe dieser Blöcke gelungen sind.
Ist ein solches Modul für sie gesperrt, MUST die Ansicht die fehlenden Module nennen und kein
Drucken anbieten. Scheitert ein Abruf, MUST das Drucken gesperrt sein, bis ein neuer Versuch
gelingt. Solange geladen wird, MUST das Drucken gesperrt sein. Für abgewählte Blöcke MUST das
System keine Daten abrufen.

#### Scenario: Modul für die Rolle gesperrt

- **WHEN** das Modul Personen im Einsatz sichtbar, aber für die Rolle der Person gesperrt ist
- **AND** der Block Bilanz gewählt ist
- **THEN** zeigt die Ansicht „Für den Einsatzbericht fehlen Rechte an: Personen“
- **AND** sie bietet kein Drucken an

#### Scenario: Gesperrtes Modul abgewählt

- **WHEN** das Modul Personen für die Rolle der Person gesperrt ist
- **AND** sie den Block Bilanz abwählt und alle übrigen Module lesen darf
- **THEN** ist der Bericht ohne Bilanz druckbar
- **AND** das System ruft keine Personen ab

#### Scenario: Abruf scheitert

- **WHEN** der Abruf der Lageberichte mit einem Serverfehler scheitert
- **THEN** nennt die Ansicht den Fehler und bietet einen neuen Versuch an
- **AND** das Drucken bleibt gesperrt

#### Scenario: Aufbewahrungsfrist abgelaufen

- **WHEN** die Aufbewahrungsfrist des Einsatzes abgelaufen ist
- **THEN** zeigt die Ansicht, dass der Bericht nicht mehr erzeugt werden kann
- **AND** sie bietet weder Drucken noch einen neuen Versuch an

#### Scenario: Rollensperre als Vorgabe der Organisation

- **WHEN** ein Modul des Berichts für die Rolle der Person über die Vorgabe der Organisation
  gesperrt ist
- **THEN** nennt die Ansicht das Modul, auf das kein Zugriff besteht
- **AND** sie bietet kein Drucken an

### Requirement: Im Einsatz ausgeblendete Module

Ist ein Modul, aus dem der Bericht schöpft, für den ganzen Einsatz ausgeblendet, SHALL das den
Druck nicht sperren. Der zugehörige Block bzw. Teilblock MUST mit dem Vermerk „In diesem Einsatz
nicht genutzt“ stehen bleiben. Das System MUST für ein ausgeblendetes Modul keine Daten abrufen
und MUST NOT eine Zahl daraus zeigen.

#### Scenario: Sanitätsdienst ohne Betreuung

- **WHEN** das Modul Betreuung im Einsatz ausgeblendet ist und alle übrigen Module lesbar sind
- **THEN** ist der Bericht druckbar
- **AND** bei Betreuung und Evakuierung steht „In diesem Einsatz nicht genutzt“

### Requirement: Laufender Einsatz ist vorläufig

Der Bericht SHALL auch für einen laufenden Einsatz druckbar sein. Läuft der Einsatz, MUST der
Druckkopf „Vorläufig – Einsatz läuft“ nennen, das Ende MUST als „läuft“ stehen und die Dauer
MUST bis zum Stand des Berichts gerechnet sein. Für einen abgeschlossenen Einsatz MUST der
Bericht Ende und Dauer bis zum Abschluss nennen und keinen Vorläufig-Vermerk tragen.

#### Scenario: Zwischenstand bei laufendem Einsatz

- **WHEN** ein laufender Einsatz um 14:32 als Bericht gedruckt wird
- **THEN** nennt der Kopf „Vorläufig – Einsatz läuft“ und den Stand 14:32
- **AND** das Ende steht als „läuft“, die Dauer reicht bis 14:32

#### Scenario: Abgeschlossener Einsatz

- **WHEN** ein abgeschlossener Einsatz als Bericht gedruckt wird
- **THEN** stehen Abschlusszeitpunkt und Dauer bis zum Abschluss
- **AND** der Kopf trägt keinen Vorläufig-Vermerk

### Requirement: Stand und Zeitzone

Der Bericht SHALL ein Schnappschuss sein: Er zeigt die Daten zum Zeitpunkt des Öffnens bzw. des
letzten „Neu laden“ und ändert sich danach nicht von selbst. Der Druckkopf MUST diesen Stand
nennen. Alle Zeitangaben im Bericht MUST in der Zeitzone der Organisation stehen.

#### Scenario: Neue Daten nach dem Öffnen

- **WHEN** nach dem Öffnen der Druckansicht ein ETB-Eintrag hinzukommt
- **THEN** bleibt der angezeigte Bericht unverändert
- **AND** nach „Neu laden“ ist der Eintrag gezählt und der Stand aktualisiert

### Requirement: Blöcke an- und abwählen

Die Druckansicht SHALL am Bildschirm eine Auswahl aller Blöcke anbieten, die im Ausdruck nicht
erscheint. Ein abgewählter Block MUST im Ausdruck ganz fehlen, ohne Überschrift, Vermerk oder
freien Platz. Mindestens ein Block MUST gewählt bleiben.

#### Scenario: Bilanz abwählen

- **WHEN** eine Person im Standardumfang den Block Bilanz abwählt
- **THEN** stehen im Bericht Stammdaten, Zeiten, Führung, Kräfte, Lage und ETB-Auszug
- **AND** vom Block Bilanz steht weder Überschrift noch Vermerk im Bericht

#### Scenario: Letzter Block

- **WHEN** nur noch der Block Stammdaten gewählt ist
- **THEN** lässt er sich nicht abwählen

### Requirement: Auswahl in der Adresse

Die Auswahl der Blöcke SHALL in der Adresse der Druckansicht stehen, sodass sie teilbar ist und
ein Neuladen übersteht. Fehlt sie, MUST der Standardumfang gelten. Unbekannte Blockschlüssel
MUST verworfen werden und MUST NOT als Auswahl gelten oder genannt werden. Bleibt nach dem
Verwerfen kein gültiger Schlüssel, MUST der Standardumfang gelten.

#### Scenario: Neuladen

- **WHEN** eine Person Lage und ETB-Auszug abwählt und die Adresse neu lädt
- **THEN** zeigt der Bericht dieselbe Auswahl

#### Scenario: Unbekannter Schlüssel

- **WHEN** die Adresse die Blöcke Stammdaten und „kosten“ nennt
- **THEN** druckt der Bericht nur Stammdaten
- **AND** „kosten“ erscheint weder im Bericht noch im Druckkopf

#### Scenario: Nur unbekannte Schlüssel

- **WHEN** die Adresse nur den Block „kosten“ nennt
- **THEN** druckt der Bericht den Standardumfang

### Requirement: Druckkopf nennt den Umfang

Der Druckkopf SHALL den Umfang nennen: „Standardumfang“, wenn genau die sieben Blöcke des
Standardumfangs gedruckt werden, sonst „Auswahl“ mit den gedruckten Blöcken in
Druckreihenfolge. Die genannte Menge MUST der gedruckten entsprechen.

#### Scenario: Ohne Auswahl

- **WHEN** der Bericht ohne Auswahl gedruckt wird
- **THEN** nennt der Druckkopf „Standardumfang“

#### Scenario: Mit Auswahl

- **WHEN** nur Stammdaten, Kräfte und die Anlage Personal je Kopf gewählt sind
- **THEN** nennt der Druckkopf „Auswahl: Stammdaten, Kräfte, Anlage Personal je Kopf“

### Requirement: Anlage Einheiten mit Einsatzzeiten

Die optionale Anlage Einheiten mit Einsatzzeiten SHALL je Einheit mit Zeitachse den Namen,
den Beginn der ersten Periode, das Ende der letzten Periode und die Einsatzzeit als Summe
ihrer Perioden nennen. Eine offene Periode MUST im laufenden Einsatz als Ende „läuft“ stehen
und bis zum Stand zählen; nach dem Abschluss MUST sie als Ende „nicht erfasst“ stehen und bis
zum Abschluss zählen. Einheiten ohne Zeitachse MUST NOT mit einer Einsatzzeit von 0 erscheinen.

#### Scenario: Einheit noch im Einsatz

- **WHEN** eine Einheit seit 08:00 im laufenden Einsatz ist und der Bericht um 14:32 gedruckt wird
- **THEN** steht sie mit Beginn 08:00, Ende „läuft“ und Einsatzzeit 6 h 32

#### Scenario: Offene Periode nach dem Abschluss

- **WHEN** eine Einheit seit 08:00 im Einsatz steht, ohne entlassen zu sein, und der Einsatz um
  12:00 abgeschlossen wurde
- **THEN** steht sie mit Ende „nicht erfasst“ und Einsatzzeit 4 h 00

#### Scenario: Einheit ohne Zeitachse

- **WHEN** eine Einheit im Einsatz geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** nennt die Anlage, für wie viele Einheiten keine Zeitachse erfasst ist
- **AND** die Einheit steht nicht mit einer Einsatzzeit von 0 in der Tabelle

### Requirement: Anlage Personal je Kopf

Die optionale Anlage Personal je Kopf SHALL je im Einsatz geführter Einsatzkraft Name,
Funktion, Einheit, Beginn, Ende und Einsatzzeit nennen, als Helfernachweis. Sie MUST nur Daten
von Einsatzkräften enthalten, keine Kontaktdaten und nie Daten Betroffener. Ist sie gedruckt,
MUST der Druckkopf „enthält Namen von Einsatzkräften“ vermerken. Eine Kraft ohne Zeitachse
MUST ohne Zeiten stehen statt mit 0.

#### Scenario: Helfernachweis

- **WHEN** die Anlage Personal je Kopf gewählt ist und zwölf Einsatzkräfte geführt sind
- **THEN** stehen alle zwölf mit Name, Funktion, Einheit und ihren Einsatzzeiten im Bericht
- **AND** der Druckkopf vermerkt „enthält Namen von Einsatzkräften“

#### Scenario: Kraft ohne Zeitachse

- **WHEN** eine Einsatzkraft geführt ist, aber kein Zeitachsen-Ereignis hat
- **THEN** steht sie mit Name, Funktion und Einheit und bei der Einsatzzeit „keine Zeitachse“

#### Scenario: Standardumfang ohne Namen

- **WHEN** der Bericht ohne Auswahl gedruckt wird
- **THEN** enthält er keine Namen von Einsatzkräften außer denen der Führung (Einsatzleitung,
  Stab, freigebende Personen)
