## MODIFIED Requirements

### Requirement: Ein Modul heißt überall wie im Menü

Das System SHALL für jedes Modul der Modul-Registry denselben Namen im Modulmenü, in der
Sprungpalette, im h1 seiner Seite, im letzten Eintrag des Ortspfads und im Tab-Titel zeigen, und
zwar das `label` der Registry. Kein Modulname SHALL englisch sein. Seiten, die einen Datensatz
zeigen, SHALL den Datensatz im h1 nennen und das Modul im Ortspfad. Ein Modul mit Reitern SHALL
das Modul im h1 nennen und den Reiter darunter, nicht umgekehrt.

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

#### Scenario: Fernmeldewesen

- **WHEN** eine Person im Modul Fernmeldewesen den Reiter „Kommunikationsplan“ öffnet
- **THEN** lautet das h1 „Fernmeldewesen“ wie der Menüeintrag in der Kategorie Kommunikation, unter
  ihm steht der Reiter „Kommunikationsplan“ als gewählt, und die Zeile unter dem Menüeintrag lautet
  „Funkplan, Skizze, Kommunikationsplan“
