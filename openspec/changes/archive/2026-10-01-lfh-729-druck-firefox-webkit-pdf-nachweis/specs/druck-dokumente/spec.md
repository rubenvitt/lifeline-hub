# Spec Delta

## ADDED Requirements

### Requirement: Druckmechanik in drei Browser-Engines automatisch belegt

Das Qualitäts-Gate SHALL die Druckmechanik der Druckstücke Lagebericht, Befehl,
Pressemitteilung und ETB-Druck unter Druckmedium automatisch in den Engines von Chromium,
Firefox und WebKit prüfen: Druckwurzel im Fluss und oben, Rahmen ohne Platz, letzter Abschnitt
jenseits der ersten Seitenhöhe. Scheitert eine Aussage in einer Engine, MUST das Gate rot sein.

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

### Requirement: Seitenzählung am erzeugten PDF belegt

Das Qualitäts-Gate SHALL für ein mehrseitiges Druckstück in Chromium den Text des erzeugten
PDF auslesen und belegen, dass jede Seite n von m die Zählung „Seite n von m“ trägt, mit
fortlaufendem n und m gleich der Seitenzahl des PDF. Fehlt die Zählung auf einer Seite oder
stimmt eine Zahl nicht, MUST das Gate rot sein.

#### Scenario: Randfeld entfernt

- **WHEN** die Seitenzählung im Randfeld der Druckseite fehlt
- **THEN** scheitert der Druckfall mit der Seite, auf der die Zählung fehlt

#### Scenario: Endmarke auf der letzten Inhaltsseite

- **WHEN** ein Lagebericht mit Endmarke im letzten Abschnitt als PDF erzeugt wird
- **THEN** steht die Endmarke im Text einer Seite nach Seite 1
- **AND** keine Seite nach der Seite mit der Endmarke trägt Inhalt außer der Seitenzählung

### Requirement: Logo im Druckkopf belegt

Hat die Organisation ein Logo hinterlegt, SHALL das Qualitäts-Gate belegen, dass der Druckkopf
unter Druckmedium dieses Logo als geladenes Bild zeigt, in Chromium, Firefox und WebKit. In
Chromium SHALL es zusätzlich belegen, dass das erzeugte PDF auf Seite 1 ein Bild mit den
Abmessungen des hochgeladenen Logos zeichnet.

#### Scenario: Logo hochgeladen

- **WHEN** eine Organisation ein PNG-Logo hochgeladen hat und ein Lagebericht gedruckt wird
- **THEN** steht im Druckkopf ein geladenes Bild mit den Abmessungen des Logos
- **AND** in Chromium zeichnet Seite 1 des PDF dieses Bild

#### Scenario: Logo nur im Kopf

- **WHEN** ein mehrseitiger Lagebericht ohne eigene Bilder mit Logo als PDF erzeugt wird
- **THEN** zeichnet keine Folgeseite ein Bild

#### Scenario: Logo fällt im Druck weg

- **WHEN** das Logo im Druckkopf unter Druckmedium ausgeblendet oder nicht geladen ist
- **THEN** scheitert der Logo-Fall
