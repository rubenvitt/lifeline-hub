# browserspeicher Specification

## Purpose
Legt fest, wie das Frontend den Browserspeicher (`localStorage`) nutzt, damit ein gesperrter
oder voller Speicher die App nicht ausfallen lässt und das Schreiben andere Tabs nicht unnötig
belastet.

## Requirements

### Requirement: Die App läuft ohne Browserspeicher

Ist der Browserspeicher gesperrt (`localStorage` ist `null` oder wirft bei jedem Zugriff),
SHALL das Frontend starten und die Anmeldemaske zeigen. Gespeicherte Geräte-Einstellungen MUST
dann auf ihre Vorgabe zurückfallen, das Farbschema auf den Nachtbetrieb. Eine Einstellung, die
die Person ändert, MUST bis zum Neuladen wirken, auch wenn sie sich nicht speichern lässt.

#### Scenario: Gehärteter Behördenrechner
- **WHEN** die App in einem Firefox mit `dom.storage.enabled=false` geöffnet wird
- **THEN** erscheint die Anmeldemaske im Nachtbetrieb, ohne unbehandelten Fehler

#### Scenario: Farbschema ohne Speicher umstellen
- **WHEN** bei gesperrtem Speicher eine Person das Farbschema auf hell stellt
- **THEN** wird die Oberfläche hell, und es entsteht kein unbehandelter Fehler

### Requirement: Eine Wahl wirkt, auch wenn sie sich nicht speichern lässt

Scheitert das Speichern der Wahl des Koordinatensystems, SHALL die Wahl trotzdem sofort in jeder
Anzeige und Eingabe gelten, die das Koordinatensystem nutzt, und bis zum Neuladen bestehen
bleiben.

#### Scenario: Speicher voll
- **WHEN** der Speicher voll ist und eine Person in der Koordinateneingabe auf UTM umstellt
- **THEN** zeigen alle Koordinaten sofort UTM, und es entsteht kein unbehandelter Fehler

### Requirement: Zugriff auf den Browserspeicher nur über den Helfer

Code im Frontend MUST auf `localStorage` nur über den gemeinsamen Helfer zugreifen, der jeden
Fehler abfängt. Ein direkter Zugriff außerhalb des Helfers MUST die Prüfung rot machen; Tests
sind ausgenommen.

#### Scenario: Neuer Speicher mit direktem Zugriff
- **WHEN** eine Änderung in einer Komponente `localStorage.getItem` direkt aufruft
- **THEN** schlägt die Prüfung fehl und nennt Datei und Zeile

### Requirement: Die Serveruhr schreibt nur bei Bedarf in den Browserspeicher

Das Frontend SHALL die aus einer Antwort gemessene Abweichung der Serveruhr in jedem Tab sofort
übernehmen. In den Browserspeicher MUST es sie nur schreiben, wenn dort keine gültige Messung
liegt, die neue um mehr als 1 s von der gespeicherten abweicht oder die gespeicherte älter als
10 min ist.

#### Scenario: Stabile Abweichung im Dauerbetrieb
- **WHEN** ein Tab innerhalb von 10 min 50 Antworten mit gleicher Abweichung erhält
- **THEN** schreibt er höchstens einmal in den Browserspeicher

#### Scenario: Uhr des Geräts springt
- **WHEN** die Geräteuhr um 2 min vorgestellt wird und danach eine Antwort eintrifft
- **THEN** schreibt der Tab die neue Abweichung sofort in den Browserspeicher
