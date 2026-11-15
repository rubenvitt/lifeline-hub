# Spec Delta

## MODIFIED Requirements

### Requirement: Rote Rückfragen werden geprüft

Jede `<Popconfirm>`-Rückfrage mit rotem Bestätigungsknopf MUST einen eigenen Bestätigungstext
tragen, der nicht „Ja“ oder „OK“ lautet. Ein Guard MUST das für alle Quelldateien des Frontends
prüfen; bekannte Altstellen MAY in einer Schuldliste stehen, die nur schrumpfen darf.

#### Scenario: Neue Rückfrage ohne Handlungstext

- **WHEN** eine Datei eine `<Popconfirm>` mit `okButtonProps={{ danger: true }}` ohne `okText`
  oder mit `okText="Ja"` erhält
- **THEN** ist der Guard rot

#### Scenario: Altstelle umgestellt

- **WHEN** eine Datei der Schuldliste keine solche Rückfrage mehr trägt
- **THEN** ist der Guard rot, bis die Schuld aus der Liste gestrichen ist

#### Scenario: Bereitstellungsraum stornieren

- **WHEN** ein geplanter Bereitstellungsraum über das ⋮ seines Kopfs storniert werden soll
- **THEN** fragt ein Dialog nach, dessen roter Bestätigungsknopf „BR stornieren“ heißt
