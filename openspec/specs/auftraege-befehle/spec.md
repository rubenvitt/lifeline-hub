# auftraege-befehle Specification

## Purpose
Legt fest, wie das Modul „Aufträge/Befehle“ seine zwei Führungsmittel zeigt und bedient: beide
Reiter im selben Muster „Liste + Detailpaneel“, mit dem fachlichen Unterschied zwischen
quittiertem Einzelauftrag und freigegebenem Einsatzbefehl.

## Requirements

### Requirement: Beide Reiter gleich gebaut

Die Reiter „Einzelaufträge“ und „Einsatzbefehle“ SHALL dasselbe Muster „Liste + Detailpaneel“
nutzen, mit gleich gebautem Bereichskopf (Titel, Mengen in der Form „n offen · m abgeschlossen“
bzw. „n Entwürfe · m freigegeben“, Datenstand, Erfassen-Aktion) und gleicher Filterleiste
(Status-Segmente mit Zahl, Suchfeld). Nur die Aufträge MUST zusätzlich Richtung und Empfänger
filtern.

#### Scenario: Gleiche Leiste
- **WHEN** beide Reiter nacheinander geöffnet werden
- **THEN** steht in beiden zuerst eine Segmentleiste mit zwei Status-Segmenten samt Zahl und daneben ein Suchfeld

#### Scenario: Empfängerfilter nur bei Aufträgen
- **WHEN** der Reiter „Einsatzbefehle“ geöffnet ist
- **THEN** gibt es weder Richtungs- noch Empfängerfilter

### Requirement: Karte eines Auftrags

Die Karte eines Einzelauftrags SHALL links Erteilungszeit und Kennung `#n` in Mono zeigen, daneben
Priorität, Phase, bei extern „Extern“, bei Überfälligkeit das Wort „Überfällig“ mit Alarmkante, die
Frist, den Auftragstext (höchstens drei Zeilen), die Empfänger und den Quittungsstand „q/n
quittiert“.

#### Scenario: Überfälliger Auftrag
- **WHEN** ein Auftrag überfällig ist
- **THEN** trägt seine Karte die Alarmkante links und das Wort „Überfällig“

#### Scenario: Langer Auftragstext
- **WHEN** der Auftragstext länger als drei Zeilen ist
- **THEN** zeigt die Karte drei Zeilen, und das Detail zeigt den ganzen Text

### Requirement: Karte eines Befehls

Die Karte eines Einsatzbefehls SHALL links den Zeitstand in Mono und die Fassung `v<n>` zeigen,
daneben den Status (Entwurf bzw. Freigegeben), das Befehlsschema, den Titel und den Ersteller,
bei freigegebenen Befehlen dazu, wer wann freigegeben hat. Sie MUST denselben Kartenrahmen und
dieselbe Zeitspalte wie die Auftragskarte nutzen.

#### Scenario: Fortgeschriebener Befehl
- **WHEN** ein Befehl in Fassung 2 vorliegt und Fassung 1 freigegeben bleibt
- **THEN** stehen zwei Karten mit gleichem Titel, unterscheidbar an `v1` und `v2`

### Requirement: Handlungen eines Auftrags im Detail

Das Detail eines Auftrags SHALL die Handlungen „Quittieren“ je offenem Empfänger, „Bearbeitung
beginnen“, „Vollzug melden“ und „Abnehmen“ tragen, je nach Phase und nur mit Schreibrecht. Es MUST
dieselben Rückfragen und Rückwege wie bisher haben: Quittieren und Abnehmen mit Rückfrage,
„Bearbeitung beginnen“ mit Rückgängig, „Vollzug melden“ im Dialog mit Text. Der Grund einer
Ablehnung MUST am Ort der Handlung stehen.

#### Scenario: Quittieren im Detail
- **WHEN** im Detail eines Auftrags mit offenem Empfänger „Quittieren“ gewählt und die Rückfrage bestätigt wird
- **THEN** zeigt das Detail den Empfänger als quittiert, und die Karte zählt eine Quittung mehr

#### Scenario: Rückgängig nach Bearbeitung beginnen
- **WHEN** „Bearbeitung beginnen“ gewählt und im Hinweis „Rückgängig“ bedient wird
- **THEN** steht der Auftrag wieder auf „Offen“

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht das Detail eines offenen Auftrags öffnet
- **THEN** stehen Empfänger, Quittungsstand und Verlauf da, aber keine Handlung

#### Scenario: Abgelehnte Abnahme
- **WHEN** der Server eine Abnahme ablehnt
- **THEN** steht der Grund im Detail über den Handlungen, nicht als Toast

### Requirement: Lesefassung eines Auftrags im Detail

Das Detail eines Auftrags SHALL den ganzen Auftragstext, alle Empfänger mit Quittungsstand, die
gefüllten Felder des Befehlsschemas offen (nicht eingeklappt), den Vollzugsvermerk und einen Verlauf
mit den Zeitpunkten erteilt, quittiert (je Empfänger), in Bearbeitung, vollzogen und abgenommen
zeigen, dazu den Sprung zum Quell-ETB-Eintrag, wenn es einen gibt.

#### Scenario: Abgeschlossener Auftrag
- **WHEN** ein abgenommener Auftrag gewählt wird
- **THEN** zeigt der Verlauf die Zeitpunkte erteilt, vollzogen und abgenommen in zeitlicher Folge

### Requirement: Einsatzbefehl im Detail

Das Detail eines Befehls SHALL die Abschnitte des Befehlsschemas als Lesefassung zeigen, dazu
Fassung, Zeitstand, Ersteller, Freigabe und den Sprung zur Vollseite. Mit Schreibrecht MUST ein
Entwurf „Entwurf bearbeiten“ (öffnet die Vollseite) und „Freigeben“ tragen, ein freigegebener Befehl
„Fortschreiben“. Freigeben MUST die Rückfrage mit der Folge „Endgültig: geht ins ETB“ zeigen.

#### Scenario: Entwurf freigeben im Detail
- **WHEN** im Detail eines Entwurfs „Freigeben“ gewählt und die Rückfrage bestätigt wird
- **THEN** steht der Befehl als freigegeben, und das Detail trägt „Fortschreiben“

#### Scenario: Fortschreiben
- **WHEN** im Detail eines freigegebenen Befehls „Fortschreiben“ gewählt wird
- **THEN** öffnet die Vollseite des neuen Entwurfs in der nächsten Fassung

#### Scenario: Leerer Abschnitt
- **WHEN** ein Abschnitt des Befehls keinen Text hat
- **THEN** steht unter seiner Überschrift „—“

### Requirement: Vollseite des Befehls bleibt

Die Vollseite eines Befehls SHALL für das Schreiben eines Entwurfs, den Druck und als Deeplink-Ziel
erhalten bleiben. Ihr Ortspfad MUST auf den Reiter „Einsatzbefehle“ mit diesem Befehl gewählt
zurückführen.

#### Scenario: Zurück aus der Vollseite
- **WHEN** auf der Vollseite eines Befehls der Ortspfad „Aufträge/Befehle“ gewählt wird
- **THEN** steht der Reiter „Einsatzbefehle“, der Befehl ist gewählt und seine Karte markiert

### Requirement: Erfassen per Dialog

„Auftrag erteilen“ SHALL einen Dialog öffnen, statt ein Formular über der Liste einzublenden. Der
Dialog MUST die Serienerfassung („Speichern und nächste“) behalten. „Befehl entwerfen“ SHALL wie
bisher einen Dialog öffnen und nach dem Anlegen die Vollseite des Entwurfs zeigen.

#### Scenario: Serie
- **WHEN** im Dialog „Speichern und nächste“ gewählt wird
- **THEN** ist der Auftrag erteilt, der Dialog bleibt offen und das Formular ist leer

#### Scenario: Abgelehnt
- **WHEN** der Server das Erteilen ablehnt
- **THEN** bleibt der Dialog offen, die Felder stehen, und der Grund steht im Dialog

### Requirement: Server-Suche der Aufträge

Die Liste und die Kennzahlen der Aufträge SHALL einen Suchbegriff annehmen, der Kennung (`#n`),
Auftragstext und Empfänger durchsucht, bei lateinischen Grundbuchstaben ohne Rücksicht auf Groß-
und Kleinschreibung (wie die Schadenliste). `%`, `_` und
`\` MUST wörtlich gelten. Ein Begriff aus Leerzeichen MUST wie kein Begriff wirken, einer über 200
Zeichen MUST abgelehnt werden. Die Suche MUST in beiden Phasen wirken, auch über noch nicht geladene
Seiten.

#### Scenario: Älterer abgeschlossener Auftrag
- **WHEN** 150 abgeschlossene Aufträge bestehen, eine Seite 100 lädt und nach dem Text des ältesten gesucht wird
- **THEN** liefert die erste Seite der Ansicht „Abgeschlossen“ genau diesen Auftrag, und die Kennzahl „abgeschlossen“ ist 1

#### Scenario: Kennung
- **WHEN** nach „#12“ gesucht wird
- **THEN** steht der Auftrag mit der laufenden Nummer 12 in der Liste

#### Scenario: Prozentzeichen wörtlich
- **WHEN** nach „50%“ gesucht wird
- **THEN** finden sich nur Aufträge, deren Text „50%“ enthält

#### Scenario: Zu lang
- **WHEN** der Suchbegriff 201 Zeichen hat
- **THEN** lehnt der Server ab und nennt das Feld

### Requirement: Suche der Befehle

Die Suche im Reiter „Einsatzbefehle“ SHALL Titel und Befehlsschema durchsuchen. Die Mengen im
Bereichskopf MUST den Bestand zählen, die Zahlen der Status-Segmente das Gefundene.

#### Scenario: Suche nach Schema
- **WHEN** nach „LADEF“ gesucht wird
- **THEN** stehen nur Befehle nach diesem Schema in der Liste, und der Bereichskopf zählt weiter alle
