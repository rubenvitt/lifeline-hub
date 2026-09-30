# Spec Delta

## Purpose

Legt fest, wie sich die Lagekarte beim Wechsel der Kartengrundlage und bei einer nicht ladbaren
Grundlage verhält: das Lagebild bleibt vollständig, und eine gescheiterte Grundlage stuft nur die
Anzeige ab, nicht die Wahl der Nutzerin oder des Nutzers.

## ADDED Requirements

### Requirement: Wechsel der Kartengrundlage erhält das Lagebild

Wechselt der Nutzer die Kartengrundlage, MUST die Lagekarte nach dem Laden der neuen Grundlage
dieselben Lagedaten wieder zeigen wie davor: Einsatzabschnitte, Zonen, sichtbare Fachebenen,
Marker einschließlich freier taktischer Zeichen und den Einsatzort. Das MUST auch gelten, wenn
die neue Grundlage eine Online-Vektorkarte ist, deren Style erst nach dem Wechsel geladen wird.
Die neue Grundlage MUST ihre Kacheln tatsächlich lesen; die alte MUST danach nicht mehr im Style
stehen.

#### Scenario: Wechsel zwischen zwei Online-Vektorkarten

- **WHEN** zwei Online-Vektorkarten konfiguriert sind, auf der Karte ein Abschnitt, eine Zone,
  eine sichtbare Fachebene, ein freies taktisches Zeichen und der Einsatzort liegen und der Nutzer
  in der Grundlage-Wahl von der ersten auf die zweite Karte wechselt
- **THEN** liest die Karte die Kacheln der zweiten Karte, die erste steht nicht mehr im Style, und
  Abschnitt, Zone, Fachebene, Zeichen und Einsatzort stehen wieder auf der Karte

#### Scenario: Freies taktisches Zeichen ist gezeichnet, nicht nur registriert

- **WHEN** ein freies taktisches Zeichen verortet ist, vor und nach einem Wechsel der
  Kartengrundlage
- **THEN** steht das Zeichen als Bild in der gezeichneten Markerebene der Karte

### Requirement: Nicht ladbare Online-Grundlage stuft die Anzeige einmal ab

Scheitert das Laden des Styles einer Online-Grundlage, bevor er angewandt ist, MUST die Lagekarte
auf die Offline-Grundlage ausweichen, sofern eine Offline-Karte bereitsteht. Die Abstufung MUST
nur die Anzeige betreffen: die Grundlage-Wahl MUST weiter die gewählte Online-Karte zeigen, und
die Kartenansicht MUST dadurch nicht als geändert gelten. Ein Ladefehler einzelner Kacheln MUST
NOT abstufen.

#### Scenario: Style-JSON der Online-Karte liefert 404

- **WHEN** die einzige Online-Karte gewählt ist, ihr Style-JSON mit 404 antwortet und eine
  Offline-Region bereitsteht
- **THEN** zeigt die Karte die Offline-Grundlage und liest deren Kacheln, die Grundlage-Wahl
  zeigt weiter die Online-Karte als gewählt, und es erscheint kein Seitenfehler

#### Scenario: Einzelne Kachel scheitert

- **WHEN** der Style einer Online-Karte lädt, aber einzelne Kacheln mit Fehler antworten
- **THEN** bleibt die Online-Grundlage angezeigt
