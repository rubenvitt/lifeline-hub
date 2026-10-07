## ADDED Requirements

### Requirement: Unumkehrbares für den ganzen Einsatz steht nicht auf einer Arbeitsseite

Eine unumkehrbare Aktion, die den ganzen Einsatz betrifft, MUST NOT im Kopf oder in einem Menü
einer Arbeitsseite stehen. Der Einsatzabschluss SHALL auf den Einsatzdaten in einem eigenen
Abschnitt stehen, nur für die Einsatzleitung eines aktiven Einsatzes, und seine Rückfrage SHALL
mit „Einsatz endgültig abschließen“ bestätigen.

#### Scenario: Einsatzleitung im Einsatztagebuch

- **WHEN** die Einsatzleitung das Einsatztagebuch bei 390, 820, 1180 oder 1440 px öffnet
- **THEN** stehen weder im Kopf noch im Menü „Weitere“ ein „Einsatz abschließen“

#### Scenario: Einsatzleitung auf den Einsatzdaten

- **WHEN** die Einsatzleitung eines aktiven Einsatzes die Einsatzdaten öffnet und „Einsatz
  abschließen“ wählt
- **THEN** fragt eine Rückfrage nach, deren roter Bestätigungsknopf „Einsatz endgültig
  abschließen“ heißt, und erst diese schließt den Einsatz ab

#### Scenario: Ohne Leitungsrecht

- **WHEN** Führungspersonal oder ein Beobachter die Einsatzdaten öffnet
- **THEN** fehlt der Abschnitt „Einsatzabschluss“

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

- **WHEN** ein geplanter Bereitstellungsraum storniert werden soll
- **THEN** heißt der rote Bestätigungsknopf „BR stornieren“, und „Stornieren“ steht mit
  `size="middle"` neben „In Betrieb nehmen“
