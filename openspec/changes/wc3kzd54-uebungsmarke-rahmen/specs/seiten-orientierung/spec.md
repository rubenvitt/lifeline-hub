# Spec Delta

## MODIFIED Requirements

### Requirement: Tab-Titel nennt Seite und Einsatz

Das System SHALL `document.title` auf jeder Route des Einsatzrahmens auf „<Modulname> ·
<Einsatzbezeichnung> · lifeline-hub“ setzen, mit dem Modulnamen aus der Modul-Registry. Ist der
Einsatz eine Übung (Einsatzart „Übung“), SHALL der Titel mit „ÜBUNG · “ beginnen, vor einer
Zählung ungelesener Eingänge. Auf Ebene 1 SHALL der Titel „<Seite> · lifeline-hub“ lauten, in der
Verwaltung „<Sektion> · Verwaltung · lifeline-hub“, auf der Anmeldung „Anmelden · lifeline-hub“.
Keine Seite SHALL den Titel an diesem Weg vorbei setzen. Verlässt eine Person den Bereich, SHALL
der vorige Titel zurückkehren.

#### Scenario: ETB im Einsatz

- **WHEN** eine Person `/einsaetze/5/etb` des Einsatzes „Starkregen Nord“ öffnet
- **THEN** lautet der Tab-Titel „ETB · Starkregen Nord · lifeline-hub“

#### Scenario: ETB in einer Übung

- **WHEN** eine Person `/einsaetze/5/etb` des Einsatzes „Starkregen Nord“ mit der Einsatzart
  „Übung“ öffnet
- **THEN** lautet der Tab-Titel „ÜBUNG · ETB · Starkregen Nord · lifeline-hub“

#### Scenario: Übung mit ungelesenen Eingängen

- **WHEN** in derselben Übung drei Eingänge ungelesen sind
- **THEN** lautet der Tab-Titel „ÜBUNG · (3) ETB · Starkregen Nord · lifeline-hub“

#### Scenario: Unterroute ohne eigenen Seitenkopf

- **WHEN** eine Person die Lagekarte oder eine Detailseite eines Moduls öffnet
- **THEN** nennt der Tab-Titel das Modul und den Einsatz

#### Scenario: Einsatz lädt noch

- **WHEN** der Einsatz noch nicht geladen ist
- **THEN** lautet der Tab-Titel „<Modulname> · lifeline-hub“

#### Scenario: Verwaltung

- **WHEN** eine Person `/admin/stammdaten/fahrzeuge` öffnet
- **THEN** lautet der Tab-Titel „Fahrzeuge · Verwaltung · lifeline-hub“
