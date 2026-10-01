# Spec Delta

## Purpose

Macht die Erfassungslisten Personen (Betroffene mit Sichtung), Tiere und Schäden eines
Einsatzes als vollständiges, zuordenbares Papier- bzw. PDF-Dokument ausgebbar, für die
Übergabe an Behörden und Versicherer. Der Druck personenbezogener Listen bleibt dabei so
nachvollziehbar wie ihr Export.

## ADDED Requirements

### Requirement: Einstieg mit dem aktiven Filter

Jede der Listen Personen, Tiere und Schäden SHALL eine Aktion „Drucken / als PDF“ anbieten, die
eine eigene Druckansicht öffnet. Die Druckansicht SHALL eine eigene, teilbare Adresse haben, die
den Seitenfilter der Liste trägt. Die Aktion SHALL den gerade aktiven Seitenfilter unverändert
mitnehmen: bei Personen den Status und den Schalter „nur offene Felder“, bei Tieren die
Statussicht und die Spezies, bei Schäden die Statussicht. Ein unbekannter Filterwert in der
Adresse MUST verworfen werden und darf nicht als Auswahl im Kopf erscheinen.

#### Scenario: Aus der gefilterten Tierliste drucken

- **WHEN** eine Person in der Tierliste die Sicht „Vermisst“ und die Spezies „Hund“ wählt und
  „Drucken / als PDF“ wählt
- **THEN** öffnet sich die Druckansicht mit genau dieser Auswahl
- **AND** ein Neuladen der Druckansicht behält die Auswahl

#### Scenario: Unbrauchbarer Filter in der Adresse

- **WHEN** die Adresse der Schäden-Druckansicht eine unbekannte Statussicht trägt
- **THEN** wird dieser Wert verworfen, und der Kopf nennt die ungefilterte Auswahl

### Requirement: Zugriff wie die Liste

Die Druckansicht eines Moduls SHALL genau die Personen zulassen, die die Liste dieses Moduls
lesen dürfen. Das schließt Beobachter und abgeschlossene Einsätze ein. Ist das Modul für die
Person gesperrt oder die Aufbewahrungsfrist des Einsatzes abgelaufen, MUST die Druckansicht
keine Datensätze zeigen und nicht druckbar sein.

#### Scenario: Beobachter druckt die Schadensliste

- **WHEN** ein Beobachter des Einsatzes die Schäden-Druckansicht öffnet
- **THEN** sieht er alle Schäden der Auswahl und kann drucken

#### Scenario: Modul Personen gesperrt

- **WHEN** das Modul Personen für die Person gesperrt ist
- **THEN** zeigt die Personen-Druckansicht keine Personen und bietet kein Drucken an
- **AND** es entsteht kein Eintrag im Zugriffsprotokoll

### Requirement: Vollständige Auswahl, Stand als Schnappschuss

Die Druckansicht SHALL alle nicht stornierten Datensätze des Moduls enthalten, auf die der
übernommene Seitenfilter passt. Die Auswahl MUST dieselbe Menge sein, die die Liste mit diesem
Seitenfilter zeigt, bevor eine Freitextsuche oder ein Spaltenfilter greift. Solange nicht
geladen ist, MUST das Drucken gesperrt sein. Scheitert der Abruf, MUST die Ansicht den Fehler
nennen, einen neuen Versuch anbieten und das Drucken gesperrt lassen. Was nach dem Laden erfasst
oder geändert wird, MUST NOT still in die geladene Ansicht übernommen werden; die Ansicht SHALL
„Neu laden“ anbieten.

#### Scenario: Leere Auswahl

- **WHEN** auf die Auswahl kein Datensatz passt
- **THEN** sagt die Ansicht „Keine Einträge in dieser Auswahl“ und bleibt druckbar

#### Scenario: Neue Person während der Vorbereitung

- **WHEN** während die Personen-Druckansicht offen ist eine Person erfasst wird
- **THEN** bleibt die Ansicht unverändert, bis die Person „Neu laden“ wählt

#### Scenario: Abruf scheitert

- **WHEN** der Abruf der Druckansicht mit einem Serverfehler endet
- **THEN** ist „Drucken / als PDF“ gesperrt
- **AND** die Ansicht nennt den Fehler und bietet „Erneut laden“ an

### Requirement: Kopf, Ordnung und Inhalt

Jede Druckansicht SHALL einen Druckkopf mit Organisation, Dokumentart, Einsatz, Auswahl in
Worten, Umfang (Anzahl der Datensätze) und Stand tragen. Die Auswahl in Worten MUST die Labels
der Liste verwenden und darf keine Datenbank-Kennung nennen. Ohne Filter SHALL der Kopf die
vollständige Liste nennen. Die Datensätze SHALL aufsteigend nach Registriernummer geordnet
sein. Kein Datensatz MUST über einen Seitenrand geteilt werden, solange er auf eine Seite passt.
Der Tabellenkopf SHALL sich auf jeder Seite wiederholen. Farbe MUST NOT der einzige Träger
einer Angabe sein; die Sichtung steht als Kategorie in Worten.

#### Scenario: Personenliste im Ausdruck

- **WHEN** die Betroffenenliste mit Status „Betroffen“ gedruckt wird
- **THEN** nennt der Kopf „Status: Betroffen“ und die Anzahl der Personen
- **AND** jede Zeile trägt Registriernummer, Name, Geschlecht und Alter, Sichtung in Worten,
  Status, Fundort und Verbleib

#### Scenario: Reihenfolge

- **WHEN** Schäden mit den Registriernummern 3, 1 und 2 geladen sind
- **THEN** stehen sie im Ausdruck in der Folge 1, 2, 3

### Requirement: Personendruck wird protokolliert

Jeder Abruf der Personen-Druckansicht MUST im Zugriffsprotokoll der Personen genau einen Eintrag
der Art `druck` erzeugen: Einsatz, abrufende Person und Zeitpunkt, ohne Bezug auf eine einzelne
Person. Der Server MUST die Personenliste für den Druck nur ausliefern, wenn dieser Eintrag
geschrieben ist. Die Personen-Druckansicht MUST ihre Daten ausschließlich über diesen
protokollierenden Abruf beziehen und darf keine zwischengespeicherte Liste verwenden. Ein
automatischer Wiederholungsversuch MUST unterbleiben. Die Druckansicht SHALL am Bildschirm
darauf hinweisen, dass ihr Abruf protokolliert wird. Das Lesen der Personenliste am Bildschirm
bleibt unprotokolliert. Der Druck von Tieren und Schäden wird nicht protokolliert.

#### Scenario: Druckansicht öffnen

- **WHEN** eine Einsatzkraft mit Lesezugriff die Personen-Druckansicht öffnet
- **THEN** enthält das Zugriffsprotokoll des Einsatzes genau einen neuen Eintrag der Art
  `druck` mit ihrem Benutzer

#### Scenario: Neu laden

- **WHEN** dieselbe Einsatzkraft in der Druckansicht „Neu laden“ wählt
- **THEN** entsteht ein weiterer Eintrag der Art `druck`

#### Scenario: Protokoll nicht schreibbar

- **WHEN** der Protokolleintrag nicht geschrieben werden kann
- **THEN** liefert der Server keine Personendaten für den Druck, und die Ansicht bleibt
  undruckbar

#### Scenario: Bestehende Protokolleinträge

- **WHEN** die Datenbank aktualisiert wird
- **THEN** bleiben alle bisherigen Einträge der Arten `detail` und `export` unverändert
  erhalten
