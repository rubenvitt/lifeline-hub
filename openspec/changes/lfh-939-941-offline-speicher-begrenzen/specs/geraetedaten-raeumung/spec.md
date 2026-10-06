## ADDED Requirements

### Requirement: Erfassungsquittungen tragen nur Kennungen

Die Quittung einer offline erfassten und danach übertragenen Person MUST nur die Kennung und
die Registriernummer der Person tragen, keinen Namen, keine Sichtung und keinen Status. Die
Personenseite SHALL mit der Quittung weiter „Erfasst als …“ anzeigen und die Person
hervorheben.

#### Scenario: Quittung nach dem Abgleich

- **WHEN** eine offline erfasste Person nach Netzrückkehr übertragen wird
- **THEN** enthält die geräteseitige Quittung Kennung und Registriernummer, aber weder Namen
  noch Sichtung

#### Scenario: Bestandsquittung aus einer früheren Version

- **WHEN** das Gerät eine Quittung aus einer früheren Version mit vollständiger Person trägt
  und die neue Version startet
- **THEN** ist die Quittung auf Kennung und Registriernummer gekürzt und wird weiter
  angezeigt

### Requirement: Ortscache mit Frist und Obergrenze

Der geräteseitige Ortscache MUST Einträge, die älter als 30 Tage sind, beim Öffnen löschen
und SHALL höchstens 5 000 Einträge halten; darüber fallen die ältesten heraus.

#### Scenario: Alter Ortsname

- **WHEN** der Ortscache einen Eintrag trägt, der vor 31 Tagen geschrieben wurde, und die App
  ihn öffnet
- **THEN** ist der Eintrag gelöscht

#### Scenario: Obergrenze überschritten

- **WHEN** der Ortscache beim Öffnen mehr als 5 000 Einträge enthält
- **THEN** bleiben die 5 000 jüngsten erhalten

### Requirement: Leere Entwürfe und verwaiste Merker werden geräumt

Beim Laden der ETB-Entwürfe SHALL das System die eigenen Entwürfe ohne Inhalt löschen, die
länger als 24 Stunden unverändert sind, über alle Einsätze. Merker des aktiven Entwurfs eines
Einsatzes ohne eigenen Entwurf MUST ebenfalls gehen. Entwürfe mit Inhalt MUST unabhängig von
ihrem Alter erhalten bleiben.

#### Scenario: Leerer Altentwurf in einem anderen Einsatz

- **WHEN** eine Person in Einsatz 3 einen leeren Entwurf hat, der seit zwei Tagen unverändert
  ist, und das ETB von Einsatz 7 öffnet
- **THEN** ist der leere Entwurf in Einsatz 3 samt seinem Aktiv-Merker gelöscht

#### Scenario: Entwurf mit Text bleibt

- **WHEN** eine Person in Einsatz 3 einen Entwurf mit Text hat, der seit 20 Tagen unverändert
  ist, und das ETB von Einsatz 7 öffnet
- **THEN** bleibt der Entwurf in Einsatz 3 erhalten
