# Spec Delta

## Purpose

Fasst einen Einsatz auf wenigen Seiten als Druckstück zusammen: Stammdaten, Zeiten, Führung,
Kräfte, Lage, Bilanz und ETB-Auszug. Er dient der Einsatznachbereitung und als Bericht an
Auftraggeber oder Behörde, vollständig und ohne personenbezogene Daten Betroffener.

## ADDED Requirements

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

Der Einsatzbericht SHALL diese Blöcke in dieser Reihenfolge enthalten: Stammdaten, Zeiten,
Führung, Kräfte, Lage, Bilanz, ETB-Auszug. Jeder Block SHALL eine Überschrift tragen und im
Ausdruck mit seinem Inhalt beginnen. Ein lesbarer Block ohne Daten MUST mit einem Vermerk
stehen bleiben („keine Einträge“) und MUST NOT wegfallen.

#### Scenario: Vollständiger Bericht

- **WHEN** ein Einsatz mit Daten in allen Modulen als Bericht geöffnet wird
- **THEN** stehen die sieben Blöcke in der genannten Reihenfolge

#### Scenario: Leerer Block bleibt stehen

- **WHEN** im Einsatz kein Schaden erfasst ist und das Modul Schäden lesbar ist
- **THEN** steht im Block Bilanz bei den Schäden „keine Einträge“

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

- **WHEN** alle Einheiten entlassen sind und der Bericht gedruckt wird
- **THEN** zeigt die Stärke zum Druckzeitpunkt 0/0/0//0
- **AND** „insgesamt eingesetzt“ nennt weiter die entlassenen Einheiten und Personen

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
lesen darf, aus dem er schöpft, und alle Abrufe gelungen sind. Ist ein solches Modul für sie
gesperrt, MUST die Ansicht die fehlenden Module nennen und kein Drucken anbieten. Scheitert ein
Abruf, MUST das Drucken gesperrt sein, bis ein neuer Versuch gelingt. Solange geladen wird, MUST
das Drucken gesperrt sein.

#### Scenario: Modul für die Rolle gesperrt

- **WHEN** das Modul Personen im Einsatz sichtbar, aber für die Rolle der Person gesperrt ist
- **THEN** zeigt die Ansicht „Für den Einsatzbericht fehlen Rechte an: Personen“
- **AND** sie bietet kein Drucken an

#### Scenario: Abruf scheitert

- **WHEN** der Abruf der Lageberichte mit einem Serverfehler scheitert
- **THEN** nennt die Ansicht den Fehler und bietet einen neuen Versuch an
- **AND** das Drucken bleibt gesperrt

#### Scenario: Aufbewahrungsfrist abgelaufen

- **WHEN** die Aufbewahrungsfrist des Einsatzes abgelaufen ist
- **THEN** zeigt die Ansicht, dass der Bericht nicht mehr erzeugt werden kann
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
