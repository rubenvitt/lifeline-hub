# Spec Delta

## MODIFIED Requirements

### Requirement: Gemeinsamer Druckkopf

Jedes Druckstück SHALL auf der ersten Seite einen Druckkopf tragen, der das Dokument ohne
Bildschirm zuordenbar macht: Name der Organisation, Logo der Organisation (falls hinterlegt),
Dokumentart und -titel, Einsatzbezeichnung mit Einsatznummer (falls vergeben), Stand der Daten
bzw. die gedruckte Auswahl, Name der druckenden Person und Druckzeitpunkt. Zeitangaben im
Druckkopf MUST in der Zeitzone der Organisation stehen. Lagebericht, Befehl, Meldebild,
ETB-Druck, Einsatzbericht und Auftrag MUST denselben Druckkopf verwenden. Am Bildschirm SHALL der
Druckkopf nur auf den Druckansichten (ETB-Druck, Druck der Modul-Listen, Einsatzbericht, Auftrag)
sichtbar sein.

#### Scenario: Meldebild mit Auswahl

- **WHEN** ein gefiltertes Meldebild gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Meldebild“, Einsatz, Stand, Auswahl, die
  druckende Person („Gedruckt von“) und den Druckzeitpunkt („Gedruckt am“)

#### Scenario: Organisation ohne Logo

- **WHEN** die Organisation kein Logo hinterlegt hat
- **THEN** zeigt der Druckkopf nur den Namen, ohne Platzhalter und ohne leeren Bildrahmen

#### Scenario: Druck erst mit geladenem Kopf

- **WHEN** eine Person „Drucken / als PDF“ wählt, bevor Organisationsdaten oder Logo geladen
  sind
- **THEN** öffnet sich der Druckdialog erst, wenn Name und (falls vorhanden) Logo bereitstehen
- **AND** scheitert das Laden des Logos, wird ohne Logo gedruckt statt gar nicht

#### Scenario: Einsatzbericht trägt den gemeinsamen Kopf

- **WHEN** ein Einsatzbericht gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Einsatzbericht“, Einsatz mit Einsatznummer,
  Stand, die druckende Person und den Druckzeitpunkt
- **AND** am Bildschirm steht derselbe Kopf über dem Bericht

#### Scenario: Auftrag trägt den gemeinsamen Kopf

- **WHEN** der Auftrag #4 gedruckt wird
- **THEN** nennt der Druckkopf Organisation, „Auftrag“ mit „#4“, Einsatz mit Einsatznummer,
  Stand, die druckende Person und den Druckzeitpunkt
- **AND** am Bildschirm steht derselbe Kopf über dem Auftragsblatt

### Requirement: Druckmechanik in drei Browser-Engines automatisch belegt

Das Qualitäts-Gate SHALL die Druckmechanik der Druckstücke Lagebericht, Befehl,
Pressemitteilung, ETB-Druck und Auftrag unter Druckmedium automatisch in den Engines von
Chromium, Firefox und WebKit prüfen: Druckwurzel im Fluss und oben, Rahmen ohne Platz, letzter
Abschnitt jenseits der ersten Seitenhöhe. Scheitert eine Aussage in einer Engine, MUST das Gate
rot sein.

#### Scenario: Engine ohne Unterstützung für die Ausblende-Regel

- **WHEN** eine Engine die Ausblende-Regel des Drucks nicht anwendet und die Kopfleiste unter
  Druckmedium Platz belegt
- **THEN** scheitert der Druckfall in genau dieser Engine
- **AND** das Gate meldet den Browser und das Druckstück

#### Scenario: Druckwurzel absolut positioniert

- **WHEN** die Druckwurzel unter Druckmedium nicht im Fluss steht
- **THEN** scheitert der Druckfall in Chromium, Firefox und WebKit

#### Scenario: PDF-Schritte nur, wo es ein PDF gibt

- **WHEN** ein Druckfall in Firefox oder WebKit läuft
- **THEN** prüft er die Mechanik unter Druckmedium ohne PDF-Erzeugung
- **AND** der Bericht nennt den PDF-Schritt als nur in Chromium geprüft, nicht als bestanden

#### Scenario: Langer Auftrag über mehrere Seiten

- **WHEN** ein Auftrag gedruckt wird, dessen Schemafelder zusammen länger als eine Seite sind
- **THEN** steht die Druckwurzel im Fluss und oben, der Rahmen belegt keinen Platz
- **AND** die letzte Angabe des Blatts liegt jenseits der ersten Seitenhöhe und wird gedruckt

## ADDED Requirements

### Requirement: Druckansicht eines Einzelauftrags

Jeder Einzelauftrag SHALL eine eigene Druckansicht haben, die mit Leserecht auf die Aufträge
erreichbar ist, auch ohne Schreibrecht. Sie MUST den Auftrag einmal beim Öffnen laden und danach
nicht von selbst ändern, bis jemand „Neu laden“ wählt. „Drucken / als PDF“ MUST gesperrt sein,
solange der Auftrag lädt. Ein unbekannter oder nicht lesbarer Auftrag MUST als solcher erscheinen
statt als leeres Blatt.

#### Scenario: Auftrag ändert sich bei offener Druckansicht

- **WHEN** die Druckansicht eines offenen Auftrags offen ist und ein Empfänger an einem anderen
  Gerät quittiert
- **THEN** zeigt das Blatt weiter „nicht quittiert“ für diesen Empfänger
- **AND** nach „Neu laden“ steht dort der Zeitpunkt der Quittung

#### Scenario: Unbekannter Auftrag

- **WHEN** jemand die Druckansicht eines Auftrags öffnet, den es im Einsatz nicht gibt
- **THEN** sagt die Seite, dass der Auftrag nicht gefunden wurde, und führt zurück zu
  „Aufträge/Befehle“
- **AND** „Drucken / als PDF“ steht nicht zur Wahl

### Requirement: Das Auftragsblatt liest in der Reihenfolge der FwDV 100

Der Teil „Auftrag“ des Blatts SHALL die Angaben in dieser Reihenfolge tragen: Empfänger,
Auftrag, Priorität, Frist, dann die Schemafelder in der Lesefolge der Auftragskarte (Mittel bis
Sicherheit / Besonderes), dann Richtung und Erteilt am. Leere Angaben MUST wegfallen.
Zeitangaben MUST in der Zeitzone der Organisation stehen.

#### Scenario: Teilweise gefüllter Auftrag

- **WHEN** ein interner Auftrag an zwei Empfänger mit Priorität „Dringend“, ohne Frist, mit
  Mittel, Weg und Absicht gedruckt wird
- **THEN** trägt der Teil „Auftrag“ genau die Etiketten „Empfänger“, „Auftrag“, „Priorität“,
  „Mittel“, „Weg“, „Absicht“, „Richtung“ und „Erteilt am“, in dieser Reihenfolge
- **AND** unter „Empfänger“ stehen beide Empfänger

#### Scenario: Externer Auftrag

- **WHEN** ein Auftrag mit Richtung „Extern“ an die Stelle „Polizei“ gedruckt wird
- **THEN** nennt die Angabe „Richtung“ „Extern“ und die externe Stelle

### Requirement: Quittung und Bearbeitung stehen auf dem Auftragsblatt

Das Blatt SHALL einen Teil „Quittung“ tragen, der jeden Empfänger mit dem Zeitpunkt seiner
Quittung nennt oder mit „nicht quittiert“. Es SHALL einen Teil „Bearbeitung“ tragen, der die
Phase des Auftrags nennt und, soweit gesetzt, „In Bearbeitung seit“, „Vollzogen am“, den
Vollzugsvermerk, „Abgenommen am“ sowie bei einem aufgehobenen Auftrag Zeitpunkt, Person und Grund
der Aufhebung. Leere Angaben MUST wegfallen.

#### Scenario: Abgenommener Auftrag

- **WHEN** ein vollzogener und abgenommener Auftrag mit Vollzugsvermerk „Leitung steht“ gedruckt
  wird, dessen beide Empfänger quittiert haben
- **THEN** nennt der Teil „Quittung“ beide Empfänger mit dem Zeitpunkt ihrer Quittung
- **AND** der Teil „Bearbeitung“ nennt die Phase, „Vollzogen am“, „Vollzugsvermerk: Leitung
  steht“ und „Abgenommen am“

#### Scenario: Offener Auftrag ohne Quittung

- **WHEN** ein eben erteilter Auftrag an einen Empfänger gedruckt wird
- **THEN** nennt der Teil „Quittung“ den Empfänger mit „nicht quittiert“
- **AND** der Teil „Bearbeitung“ nennt nur die Phase „Offen“

#### Scenario: Aufgehobener Auftrag

- **WHEN** ein aufgehobener Auftrag gedruckt wird
- **THEN** nennt der Teil „Bearbeitung“ die Phase, den Zeitpunkt der Aufhebung, die aufhebende
  Person und den Grund
