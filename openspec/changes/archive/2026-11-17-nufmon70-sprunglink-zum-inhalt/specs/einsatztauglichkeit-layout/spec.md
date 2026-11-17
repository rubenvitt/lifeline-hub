# Spec Delta

## ADDED Requirements

### Requirement: Ein Sprunglink führt zum Inhalt

Jede Seite im Rahmen (Einsatz, Ebene 1, Verwaltung, Planungen) und die Hilfe MUST als ersten
Tab-Halt einen Link „Zum Inhalt springen“ haben, vor Betriebszeile, Kopf und Navigation. Er MUST
den Fokus an den Anfang des Seiteninhalts setzen, in der Verwaltung neben das Menü. Ohne Fokus
MUST er unsichtbar sein; mit Fokus MUST er sichtbar sein, ohne den Rahmen zu verschieben, und
MUST NOT verdeckt sein. Die Adresse MUST dabei unverändert bleiben.

#### Scenario: Erster Halt im Überblick
- **WHEN** der Überblick eines Einsatzes geladen ist und einmal Tab gedrückt wird
- **THEN** hat der Link „Zum Inhalt springen“ den Fokus und ist sichtbar
- **AND** kein Element des Rahmens hat sich verschoben

#### Scenario: Sprung in den Inhalt
- **WHEN** auf dem Link Enter gedrückt und danach einmal Tab gedrückt wird
- **THEN** liegt der Fokus auf dem ersten Bedienelement im Seiteninhalt, nicht in Kopf, Rail
  oder Modulpanel
- **AND** die Adresse ist unverändert

#### Scenario: Verwaltung
- **WHEN** in der Verwaltung der Link benutzt und danach Tab gedrückt wird
- **THEN** liegt der Fokus im Inhalt neben dem Verwaltungsmenü, nicht im Menü

#### Scenario: Störung der Verbindung
- **WHEN** die Betriebszeile eine Störung mit Knöpfen zeigt und die Seite neu geladen ist
- **THEN** ist der erste Tab-Halt trotzdem der Link „Zum Inhalt springen“

#### Scenario: Ohne Fokus
- **WHEN** der Link keinen Fokus hat
- **THEN** ist er nicht zu sehen und nimmt keinen Platz im Rahmen ein
