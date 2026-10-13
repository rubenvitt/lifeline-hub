## MODIFIED Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite im Modul Fernmeldewesen
erreichbar sein, als Reiter „Fernmeldeskizze“ neben „Funkplan“, „Sprechgruppen“ und
„Kommunikationsplan“. Die Sichtvorgabe `?ansicht=skizze` öffnet die Skizze, danach wird der
Parameter aus der Adresse entfernt, ein unbrauchbarer Wert ebenso. Die Skizze MUST NOT als eigenes
Modul erscheinen. Sie MUST Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben, nicht die des
Stabs.

#### Scenario: Umschalten

- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen den Funkplan öffnet und den Reiter
  „Fernmeldeskizze“ wählt
- **THEN** zeigt die Seite die Fernmeldeskizze statt der Tabelle, und das Lücken-Paneel bleibt
  stehen

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/fernmeldewesen?ansicht=skizze` öffnet
- **THEN** steht die Darstellung auf „Fernmeldeskizze“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Sichtvorgabe über die alte Adresse

- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` öffnet
- **THEN** landet sie im Modul Fernmeldewesen in der Darstellung „Fernmeldeskizze“

#### Scenario: Unbrauchbarer Wert

- **WHEN** eine Person `?ansicht=quatsch` öffnet
- **THEN** bleibt die Darstellung „Funkplan“, und der Parameter ist aus der Adresse entfernt

#### Scenario: Stab gesperrt

- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist und das
  Fernmeldewesen frei
- **THEN** zeigt die Skizze alle Elemente, und eine Person mit Schreibrecht kann sie bearbeiten

#### Scenario: Fernmeldewesen gesperrt

- **WHEN** das Modul Fernmeldewesen für die Person gesperrt ist und sie `?ansicht=skizze` öffnet
- **THEN** sieht sie weder Tabelle noch Skizze, sondern den einheitlichen Hinweis für
  „Fernmeldewesen“

### Requirement: Fehlende Quellen werden benannt

Sind die Abschnitte gesperrt oder nicht geladen, SHALL die Skizze statt der Fläche den Grund nennen
und MUST NOT Einheiten ohne Abschnitt zeigen. Fehlen nur die Einheiten, die Fahrzeuge, die
Stab-Besetzung, die externen Stellen oder die Daten der Skizze, SHALL die Skizze das Übrige zeigen
und je fehlender Quelle den Grund nennen. Eine fehlende Quelle MUST NOT als leerer Bestand
erscheinen. Die Stab-Besetzung SHALL die Skizze nur abrufen, wenn der Stab für die Person frei ist.

#### Scenario: Abschnitte gesperrt

- **WHEN** die Abschnittsliste mit 403 abgelehnt wird
- **THEN** zeigt die Skizze „Abschnitte: nicht freigegeben“ und keine Fläche

#### Scenario: Einheiten nicht geladen

- **WHEN** der Abruf der Einheiten scheitert
- **THEN** zeigt die Skizze die Abschnitte an ihren Schienen und den Hinweis „Einheiten: nicht
  geladen“

#### Scenario: Externe Stellen nicht geladen

- **WHEN** der Abruf des Kommunikationsplans scheitert
- **THEN** zeigt die Skizze Führungsstelle, Abschnitte und Einheiten und den Hinweis „Externe
  Stellen: nicht geladen“

#### Scenario: Fahrzeuge gesperrt

- **WHEN** das Modul Fahrzeuge für die Person gesperrt ist
- **THEN** zeigt die Skizze alle Kästen ohne Führungsmittel und den Hinweis „Fahrzeuge: nicht
  freigegeben“

#### Scenario: Stab nicht frei

- **WHEN** das Fernmeldewesen frei ist, der Stab aber ausgeblendet oder gesperrt
- **THEN** zeigt der Kasten „Einsatzleitung“ keine Sachgebietszeichen, die Skizze nennt
  „Stab-Besetzung: nicht freigegeben“, alles Übrige steht vollständig, und es geht keine Anfrage
  an den Stab
