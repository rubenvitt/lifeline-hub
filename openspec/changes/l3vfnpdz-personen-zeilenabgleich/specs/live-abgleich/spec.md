# Spec Delta

## ADDED Requirements

### Requirement: Ereignisse zu Personen gleichen zeilenweise ab

Trägt ein Ereignis zu einer betroffenen Person ihre Kennung, SHALL ein Tab nur diese Person
abrufen und sie in die geladene Personenliste, die Personenauswahl und die Betroffenen je
Betreuungsstelle einsortieren, statt diese Listen ganz neu zu laden. Für fehlende Kennung,
gescheiterten Abruf, nicht geladene Liste, zu viele Personen je Fenster, verdeckte Tabs und
laufende Abrufe gelten dieselben Ausnahmen wie bei Schäden.

#### Scenario: Person gesichtet
- **WHEN** an einem Sichtungsplatz eine Person gesichtet wird, während ein zweiter Tab die
  Personenliste mit 2 000 Personen offen hat
- **THEN** ruft der zweite Tab nur diese Person ab, und ihre Zeile zeigt die neue Sichtung an
  derselben Stelle der Liste

#### Scenario: Person neu erfasst
- **WHEN** eine Person neu erfasst oder an einer Betreuungsstelle registriert wird
- **THEN** erscheint sie in der Personenliste und der Personenauswahl der anderen Tabs an der
  Stelle, die ihre Registriernummer vorgibt, ohne dass ein Tab die Liste ganz neu lädt

#### Scenario: Person storniert
- **WHEN** eine Person storniert wird
- **THEN** verschwindet sie aus Personenliste, Personenauswahl und den Betroffenen ihrer
  Betreuungsstelle

#### Scenario: Betroffene einer Betreuungsstelle
- **WHEN** der Verbleib einer Person auf „Notunterkunft“ an einer Betreuungsstelle wechselt oder
  von dort weg
- **THEN** erscheint sie in den Betroffenen dieser Stelle bzw. verschwindet daraus, ohne dass die
  Liste der Stelle ganz neu lädt

#### Scenario: Nachforderung für eine Person
- **WHEN** zu einer Person ein Rettungsmittel nachgefordert oder der Stand dieser Nachforderung
  geändert wird
- **THEN** trägt das Ereignis die Kennung der Person, und die anderen Tabs laden nur ihre Zeile

#### Scenario: Viele Personen auf einmal
- **WHEN** nach einem Funkloch Ereignisse zu 40 Personen in einem Sammelfenster eintreffen
- **THEN** ruft der Tab die Personenliste einmal ganz ab statt 40 Personen einzeln

### Requirement: Der Zeilenabruf einer Person ist nicht protokolliert

Der Abruf einer einzelnen Person für den Zeilenabgleich SHALL dieselbe Form, dasselbe Recht und
dieselbe Sichtbarkeit haben wie die Personenliste und MUST wie diese ohne Eintrag im
Zugriffsprotokoll bleiben. Er MUST auch eine stornierte Person liefern, damit der Tab sie aus
seinen Listen nehmen kann. Den medizinischen Verlauf liefert er nicht.

#### Scenario: Live-Abgleich schreibt kein Protokoll
- **WHEN** zehn Tabs eine Änderung an einer Person zeilenweise abgleichen
- **THEN** steht im Zugriffsprotokoll dieser Person kein neuer Eintrag

#### Scenario: Gerät einer anderen Stelle
- **WHEN** ein gekoppeltes Gerät eine Person abruft, die es in seiner Personenliste nicht sähe
- **THEN** antwortet der Server mit 404

#### Scenario: Einheitengerät
- **WHEN** ein Einheitengerät eine von seiner Einheit versorgte Person abruft
- **THEN** fehlen die Personalien wie in seiner Personenliste
