# Spec Delta

## MODIFIED Requirements

### Requirement: Unumkehrbares für den ganzen Einsatz steht nicht auf einer Arbeitsseite

Eine Aktion, die den ganzen Einsatz beendet, MUST NOT im Kopf oder in einem Menü einer
Arbeitsseite stehen. Der Einsatzabschluss SHALL auf den Einsatzdaten in einem eigenen Abschnitt
stehen, nur für die Einsatzleitung eines aktiven Einsatzes. Er SHALL in einem Dialog bestätigt
werden, dessen roter Knopf „Einsatz abschließen“ heißt und erst nach dem Eintippen von
Einsatznummer oder Bezeichnung aktiv ist (Capability `einsatz-abschluss`).

#### Scenario: Einsatzleitung im Einsatztagebuch

- **WHEN** die Einsatzleitung das Einsatztagebuch bei 390, 820, 1180 oder 1440 px öffnet
- **THEN** stehen weder im Kopf noch im Menü „Weitere“ ein „Einsatz abschließen“

#### Scenario: Einsatzleitung auf den Einsatzdaten

- **WHEN** die Einsatzleitung eines aktiven Einsatzes die Einsatzdaten öffnet und „Einsatz
  abschließen“ wählt
- **THEN** öffnet sich ein Dialog mit den offenen Punkten und einem Eingabefeld, dessen roter
  Knopf „Einsatz abschließen“ erst nach dem Eintippen von Einsatznummer oder Bezeichnung aktiv
  ist, und erst dieser Knopf schließt den Einsatz ab

#### Scenario: Ohne Leitungsrecht

- **WHEN** Führungspersonal oder ein Beobachter die Einsatzdaten eines aktiven Einsatzes öffnet
- **THEN** fehlt der Abschnitt „Einsatzabschluss“
