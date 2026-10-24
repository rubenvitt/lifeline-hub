# Spec Delta

## MODIFIED Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite im Modul Fernmeldewesen
erreichbar sein, als Reiter „Fernmeldeskizze“ neben „Funkplan“, „Sprechgruppen“ und
„Kommunikationsplan“. Die gewählte Darstellung SHALL als `?ansicht=` in der Adresse
stehen bleiben (`skizze`, `sprechgruppen`; „Funkplan“ ohne Parameter). Ein Reiterwechsel MUST sie
ersetzen, ohne einen eigenen Schritt im Verlauf anzulegen. Ein unbrauchbarer Wert und
`ansicht=tabelle` MUST aus der Adresse entfernt werden. Die Skizze MUST NOT als eigenes
Modul erscheinen. Sie MUST Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben, nicht die des
Stabs.

#### Scenario: Umschalten

- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen den Funkplan öffnet und den Reiter
  „Fernmeldeskizze“ wählt
- **THEN** zeigt die Seite die Fernmeldeskizze statt der Tabelle, und das Lücken-Paneel bleibt
  stehen

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/fernmeldewesen?ansicht=skizze` öffnet
- **THEN** steht die Darstellung auf „Fernmeldeskizze“, und `ansicht=skizze` bleibt in der Adresse

#### Scenario: Reiterwechsel ohne Verlaufsschritt

- **WHEN** eine Person im Funkplan den Reiter „Fernmeldeskizze“ und danach „Funkplan“ wählt und
  dann im Browser zurückgeht
- **THEN** führt der Schritt zurück auf die Seite vor dem Funkplan, und die Adresse trug zuletzt
  kein `ansicht`

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
