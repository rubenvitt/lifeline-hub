## ADDED Requirements

### Requirement: Darstellung „Sprechgruppen“
Der Funkplan SHALL eine dritte Darstellung „Sprechgruppen“ haben: eine Zeile je Sprechgruppe des
Einsatzes, also jede einem Abschnitt oder einer Einheit zugeordnete und jede einsatzlokale. Spalten:
Sprechgruppe (fixiert, Festbreitenschrift), Betriebsart, Hinweis, Herkunft (Katalog oder
einsatzlokal) und Teilnehmer. Zuerst TMO, dann DMO, je in der Sortierung der Sprechgruppen. Sie ist
schreibgeschützt und aus denselben Quellen abgeleitet wie die Tabelle.

#### Scenario: Teilnehmer einer Sprechgruppe
- **WHEN** „TMO 311“ dem Abschnitt „EA Nord“ (Kurzbezeichnung „EA N“) und der Einheit „1. Zug“
  (Funkrufname „Florian Musterstadt 1“) zugeordnet ist
- **THEN** zeigt die Zeile „311“ beide Stellen mit Rufnamen als Teilnehmer, und jede führt zu ihrem
  Datensatz

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** die lokale Sprechgruppe „DMO 999“ nirgends zugeordnet ist
- **THEN** steht sie mit Herkunft „einsatzlokal“ und dem Teilnehmer „keine“ in der Darstellung

#### Scenario: Katalog-Sprechgruppe ohne Zuordnung
- **WHEN** eine Sprechgruppe des Organisationskatalogs keinem Abschnitt und keiner Einheit des
  Einsatzes zugeordnet ist
- **THEN** erscheint sie nicht

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt die Darstellung die Sprechgruppen der Abschnitte und die einsatzlokalen, und
  oberhalb steht, dass Einheiten nicht freigegeben sind; keine Zeile behauptet, eine Sprechgruppe
  habe keine Teilnehmer, wenn sie nur an einer gesperrten Quelle hängen könnte

#### Scenario: Sichtvorgabe aus einem Link
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=sprechgruppen` öffnet
- **THEN** steht die Darstellung auf „Sprechgruppen“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Druck der Darstellung
- **WHEN** eine Person in der Darstellung „Sprechgruppen“ druckt
- **THEN** nennt der Druckkopf die Darstellung „Sprechgruppen“, und jede Zeile steht ohne
  waagerechten Überhang auf A4

## MODIFIED Requirements

### Requirement: Lücken oberhalb der Tabelle
Oberhalb der Tabelle SHALL der Funkplan diese Lücken als Anzahl zeigen:
- Abschnitte ohne Sprechgruppe
- Einheiten ohne Sprechgruppe
- Einheiten ohne Erreichbarkeit
- einsatzlokale Sprechgruppen, die weder einem Abschnitt noch einer Einheit zugeordnet sind
- Verbindungen ohne gemeinsame Sprechgruppe: eine Stelle und ihre übergeordnete Stelle haben beide
  Sprechgruppen, aber keine gemeinsame

Jede Zahl MUST aus denselben geladenen Listen gerechnet werden wie die Tabelle. Hängt eine Zahl an
einer gesperrten, nicht geladenen oder noch ladenden Liste, MUST sie „—“ mit Grund zeigen und
MUST NOT „0“ zeigen. Bei einer Zahl größer null MUST der Funkplan die betroffenen Datensätze
nennen: Abschnitte und Einheiten als Verweis auf die Stelle, an der sie gepflegt werden,
einsatzlokale Sprechgruppen mit ihrer Bezeichnung, Verbindungen als Verweis auf die untere Stelle.
Die Lücken MUST im ersten Bild stehen, bei 1366 × 768 px mit offenem Modulpanel. Sie MUST in
jeder Darstellung des Funkplans (Tabelle, Skizze und Sprechgruppen) dieselben sein.

#### Scenario: Abschnitt ohne Sprechgruppe
- **WHEN** einem von drei Abschnitten keine Sprechgruppe zugeordnet ist
- **THEN** zeigt der Funkplan „1“ bei „Abschnitte ohne Sprechgruppe“

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** im Einsatz die lokale Sprechgruppe „DMO 999“ angelegt, aber nirgends zugeordnet ist
- **THEN** zählt sie bei „einsatzlokale Sprechgruppen ohne Zuordnung“ und wird dort mit ihrer
  Bezeichnung genannt

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigen „Einheiten ohne Sprechgruppe“, „Einheiten ohne Erreichbarkeit“,
  „einsatzlokale Sprechgruppen ohne Zuordnung“ und „Verbindungen ohne gemeinsame Sprechgruppe“
  „—“ mit Grund, nicht „0“

#### Scenario: Einheit ohne gemeinsamen Kanal mit ihrem Abschnitt
- **WHEN** der Abschnitt „EA Nord“ die Sprechgruppe „TMO 311“ trägt und die ihm zugeordnete
  Einheit „1. Zug“ nur „DMO 505“
- **THEN** zeigt der Funkplan „1“ bei „Verbindungen ohne gemeinsame Sprechgruppe“ und nennt
  „1. Zug“ als Verweis auf die Einheit

#### Scenario: Stelle ohne Sprechgruppe zählt nicht doppelt
- **WHEN** eine Einheit gar keine Sprechgruppe trägt
- **THEN** zählt sie bei „Einheiten ohne Sprechgruppe“, aber nicht bei „Verbindungen ohne
  gemeinsame Sprechgruppe“
