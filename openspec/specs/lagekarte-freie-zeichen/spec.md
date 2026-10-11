# lagekarte-freie-zeichen Specification

## Purpose
Legt fest, in welcher Form ein freies Lagekarten-Zeichen gespeichert wird, wie der Server ein
neues oder geändertes Zeichen prüft und wie gespeicherte Zeichen aus der Zeit vor der Umstellung
lesbar bleiben.

## Requirements

### Requirement: Freies Zeichen wird als Zeichenbeschreibung gespeichert
Das System SHALL ein neu angelegtes oder geändertes freies Zeichen als kanonische
Zeichenbeschreibung der Bibliothek `@einsatzzeichen` speichern. Die Beschreibung trägt entweder
ein Zeichen mit Grundzeichen oder ein freistehendes Zeichen (Zustand, Piktogramm, Pfeil, Linie,
Wetter, Tierzustand). Bezeichnung, Ansicht und Koordinate bleiben eigene Felder und MUST NOT in
der Beschreibung stehen.

#### Scenario: Zeichen mit Grundzeichen anlegen
- **WHEN** eine Person eine Stelle mit Fachaufgabe Sanität platziert
- **THEN** speichert das System die Zeichenbeschreibung dieser Stelle und gibt sie beim Lesen unverändert zurück

#### Scenario: Freistehendes Piktogramm anlegen
- **WHEN** eine Person das Piktogramm „Drehleiter“ ohne Grundzeichen platziert
- **THEN** speichert das System eine freistehende Zeichenbeschreibung, und die Karte zeigt das Piktogramm

### Requirement: Server lehnt ungültige Zeichenbeschreibungen mit 400 ab
Der Server SHALL eine Zeichenbeschreibung beim Anlegen und Ändern auf Form und
Wertezugehörigkeit prüfen. Er MUST mit 400 antworten, wenn sie nicht lesbar ist, eine unbekannte
Formatversion, Art, ein unbekanntes Feld oder einen unbekannten Wert trägt, Bezeichnung oder
Beschriftungen enthält oder zu lang ist. Die Prüfung, ob eine gültige Beschreibung sich zeichnen
lässt, MUST NOT den Server zu einer anderen Antwort als 2xx oder 400 bringen.

#### Scenario: Unbekannter Wert
- **WHEN** ein Client ein Zeichen mit der Organisation `gibt-es-nicht` anlegt
- **THEN** antwortet der Server mit 400, und es entsteht kein Zeichen

#### Scenario: Beschriftung in der Beschreibung
- **WHEN** ein Client eine Zeichenbeschreibung mit einer Bezeichnung im Zeichen sendet
- **THEN** antwortet der Server mit 400 und verweist auf das Feld für die Bezeichnung

### Requirement: Übergang für Clients mit altem Format
In der Übergangszeit SHALL der Server beim Anlegen und Ändern zusätzlich das bisherige Format
mit Grundzeichen und Overlay-Kennungen annehmen. Ein Schreibvorgang MUST genau eines der beiden
Formate tragen, sonst antwortet der Server mit 400. Ein Zeichen im bisherigen Format MUST danach
genauso angezeigt werden wie ein Altbestand.

#### Scenario: Veralteter Client legt an
- **WHEN** ein Client mit dem Stand vor der Umstellung ein Zeichen mit Grundzeichen „Person“ anlegt
- **THEN** legt der Server das Zeichen an, und alle Clients zeigen es als Person

#### Scenario: Beide Formate zugleich
- **WHEN** ein Client eine Zeichenbeschreibung und zugleich ein Grundzeichen sendet
- **THEN** antwortet der Server mit 400

### Requirement: Altbestand bleibt ohne Umschreiben lesbar
Das System SHALL freie Zeichen im bisherigen Format beim Lesen in eine Zeichenbeschreibung
übersetzen und MUST sie dafür nicht umschreiben. Das gilt für gespeicherte Zeichen, Lage-Snapshots
und den Offline-Stand des Geräts gleichermaßen. Ändert ein aktueller Client ein solches Zeichen,
MUST er es als Zeichenbeschreibung speichern.

#### Scenario: Rückblick auf einen alten Lage-Snapshot
- **WHEN** eine Person einen Lage-Snapshot öffnet, der vor der Umstellung eingefroren wurde
- **THEN** zeigen die freien Zeichen darin ihr Zeichen nach der neuen Darstellung

#### Scenario: Altzeichen wird geändert
- **WHEN** eine Person an einem Altzeichen im Inspector das Grundzeichen wechselt
- **THEN** speichert das System danach eine Zeichenbeschreibung für dieses Zeichen

### Requirement: Gespeicherte freie Farbe wird auf die Palette abgebildet
Trägt ein Altzeichen eine freie Farbe, SHALL das System beim Lesen das nächstliegende Farbtoken
der festen Palette verwenden, wo das Zeichen eine Füllung trägt. Dieselbe gespeicherte Farbe
MUST immer dasselbe Token ergeben. Trägt das Zeichen keine Füllung, MUST die Farbe entfallen.

#### Scenario: Rote Gefahr aus dem Altbestand
- **WHEN** ein Altzeichen „Gefahr“ mit der Farbe `#cc0000` geladen wird
- **THEN** zeigt die Karte die Gefahr in der roten Füllung der Palette
