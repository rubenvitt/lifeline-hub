# Spec Delta

## MODIFIED Requirements

### Requirement: Druckmechanik in drei Browser-Engines automatisch belegt

Das Qualitäts-Gate SHALL die Druckmechanik der Druckstücke Lagebericht, Befehl, ETB-Druck und
Auftrag unter Druckmedium automatisch in den Engines von
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
