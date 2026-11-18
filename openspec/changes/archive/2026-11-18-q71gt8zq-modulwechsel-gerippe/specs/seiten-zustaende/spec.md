## ADDED Requirements

### Requirement: Modulwechsel zeigt sofort Kopf und Gerippe

Wechselt die Person im Einsatz in ein anderes Modul, MUST das erste Bild danach die alte Seite
durch den Seitenkopf mit dem Namen des Zielmoduls und das Gerippe der Seite ersetzen. Die echte
Seite MUST dieses Bild ablösen, sobald sie gezeichnet ist. Das Gerippe MUST erst nach einer
kurzen Verzögerung sichtbar werden; der Seitenkopf steht sofort.

#### Scenario: Wechsel in ein langsames Modul
- **WHEN** die Person im Überblick in der Modulleiste „Personal“ wählt
- **THEN** steht im nächsten Bild die Überschrift „Personal“ im Seitenkopf
- **AND** die Inhalte des Überblicks sind nicht mehr zu sehen
- **AND** sobald die Seite gezeichnet ist, steht dort die Personal-Liste und kein Gerippe mehr

#### Scenario: Schnelles Modul flackert nicht
- **WHEN** das Zielmodul schneller gezeichnet ist als die Verzögerung des Gerippes
- **THEN** wird das Gerippe nie sichtbar, nur der Kopf wechselt

#### Scenario: Modul lädt seinen Code nach
- **WHEN** die Person die Lagekarte oder die Kräfteübersicht öffnet und deren Code noch nicht
  geladen ist
- **THEN** stehen der Seitenkopf mit dem Modulnamen und das Gerippe da, kein Ladetext

### Requirement: Gerippe nur beim Wechsel des Moduls

Ein Wechsel innerhalb desselben Moduls (Unterroute, Detailseite, Suchparameter) MUST NOT das
Gerippe des Rahmens zeigen. Die Seite, mit der der Einsatz geöffnet oder neu geladen wird, MUST
NOT vorher das Gerippe zeigen.

#### Scenario: Wechsel im selben Modul
- **WHEN** die Person in Betroffene von der Liste in die Detailseite einer Person wechselt
- **THEN** erscheint kein Gerippe des Rahmens

#### Scenario: Einsatz direkt öffnen
- **WHEN** die Person die Adresse eines Moduls direkt aufruft oder die Seite neu lädt
- **THEN** zeichnet der Rahmen die Seite ohne vorgeschaltetes Gerippe
