## ADDED Requirements

### Requirement: Ein Modul heißt überall wie im Menü

Das System SHALL für jedes Modul der Modul-Registry denselben Namen im Modulmenü, in der
Sprungpalette, im h1 seiner Seite, im letzten Eintrag des Ortspfads und im Tab-Titel zeigen, und
zwar das `label` der Registry. Kein Modulname SHALL englisch sein. Seiten, die einen Datensatz
zeigen, SHALL den Datensatz im h1 nennen und das Modul im Ortspfad.

#### Scenario: ETB

- **WHEN** eine Person das Modul ETB öffnet
- **THEN** lautet das h1 „ETB“, wie der Menüeintrag

#### Scenario: Lagebild

- **WHEN** eine Person das Lagebild öffnet
- **THEN** heißen Menüeintrag und h1 „Lagebild“, und die Uhrzeit des Lagebilds steht neben dem
  Titel, nicht in ihm

#### Scenario: Betroffene

- **WHEN** eine Person in der Sprungpalette „Betroffene“ sucht
- **THEN** findet sie das Modul unter diesem Namen, und die Seite trägt das h1 „Betroffene“

### Requirement: Modulbeschreibung als zweite Zeile

Jedes Modul der Registry SHALL eine Beschreibung aus wenigen Fachwörtern tragen, ohne Satz, ohne
Bedienung und ohne Technik. Das Modulmenü (Panel und Drawer) und die Sprungpalette SHALL sie als
zweite Zeile unter dem Modulnamen zeigen, bei Platzmangel mit Auslassung und vollem Wortlaut im
`title`. Der zugängliche Name des Eintrags SHALL der Modulname bleiben.

#### Scenario: ETB im Menü

- **WHEN** eine Person die Kategorie Erfassung öffnet
- **THEN** steht unter „ETB“ „Einsatztagebuch“

#### Scenario: Handy

- **WHEN** eine Person bei 390 px Breite das Modulmenü öffnet
- **THEN** stehen die Beschreibungen ohne waagrechten Überlauf

### Requirement: Leere Lagemeldungen führen zu den Meldungen

Ist noch keine Meldung an die Lage übergeben, SHALL die Seite Lagemeldungen einen Knopf „Zu den
Meldungen“ zeigen, der zur Meldungsliste führt, und keinen Erklärsatz.

#### Scenario: Neuer Einsatz

- **WHEN** eine Person in einem neuen Einsatz die Lagemeldungen öffnet
- **THEN** führt „Zu den Meldungen“ sie zu „Meldungen (eingehend)“

### Requirement: Lagemeldungen und eingehende Meldungen unterscheiden sich im Symbol

Die Module Lagemeldungen und „Meldungen (eingehend)“ SHALL verschiedene Symbole tragen.

#### Scenario: Sprungpalette

- **WHEN** eine Person in der Sprungpalette „Meldungen“ sucht
- **THEN** tragen die beiden Treffer verschiedene Symbole
