# Spec Delta

## MODIFIED Requirements

### Requirement: Darstellung „Sprechgruppen“
Der Funkplan SHALL eine dritte Darstellung „Sprechgruppen“ haben: eine Zeile je Sprechgruppe des
Einsatzes, also jede der eigenen Führungsstelle, einem Abschnitt oder einer Einheit zugeordnete und
jede einsatzlokale. Teilnehmer sind die eigene Führungsstelle (zuerst, mit Rufname, Ziel
Einsatzdaten), die Abschnitte und Einheiten, die externen Stellen des Kommunikationsplans mit ihrem
Status und die Komponenten der Fernmeldeskizze. Spalten:
Sprechgruppe (fixiert, Festbreitenschrift), Bedingung (Betriebsart, Netz und Sicherheit in
Festbreitenschrift, getrennt durch „ · “, leere weggelassen), Hinweis, Herkunft (Katalog oder
einsatzlokal) und Teilnehmer. Zuerst TMO, dann DMO, je in der Sortierung der Sprechgruppen. Sie ist
schreibgeschützt und aus denselben Quellen abgeleitet wie die Tabelle. Fehlt eine dieser Quellen,
auch die Führungsstelle, MUST die Zelle „unvollständig“ bzw. den Grund tragen, nie „keine“.

#### Scenario: Bedingung in der Sprechgruppen-Darstellung
- **WHEN** „TMO 311“ Netz „BOS“ und keine Sicherheit trägt
- **THEN** steht in der Spalte „Bedingung“ „TMO · BOS“

#### Scenario: Teilnehmer einer Sprechgruppe
- **WHEN** „TMO 311“ dem Abschnitt „EA Nord“ (Kurzbezeichnung „EA N“) und der Einheit „1. Zug“
  (Funkrufname „Florian Musterstadt 1“) zugeordnet ist
- **THEN** zeigt die Zeile „311“ beide Stellen mit Rufnamen als Teilnehmer, und jede führt zu ihrem
  Datensatz

#### Scenario: Einsatzlokale Sprechgruppe ohne Zuordnung
- **WHEN** die lokale Sprechgruppe „DMO 999“ nirgends zugeordnet ist
- **THEN** steht sie mit Herkunft „einsatzlokal“ und dem Teilnehmer „keine“ in der Darstellung

#### Scenario: Katalog-Sprechgruppe ohne Zuordnung
- **WHEN** eine Sprechgruppe des Organisationskatalogs weder der eigenen Führungsstelle noch einem
  Abschnitt oder einer Einheit des Einsatzes zugeordnet ist
- **THEN** erscheint sie nicht

#### Scenario: Führungsstelle als Teilnehmer
- **WHEN** der eigenen Führungsstelle (Rufname „Florian Musterstadt 10/1“) die einsatzlokale
  „DMO 999“ zugeordnet ist und sonst niemand
- **THEN** nennt die Zeile „DMO 999“ die Führungsstelle mit Rufname als Teilnehmer statt „keine“,
  und sie führt zu den Einsatzdaten

#### Scenario: Katalog-Sprechgruppe nur an der Führungsstelle
- **WHEN** eine Sprechgruppe des Organisationskatalogs nur der eigenen Führungsstelle zugeordnet ist
- **THEN** erscheint sie mit Herkunft „Katalog“ und der Führungsstelle als Teilnehmer

#### Scenario: Führungsstelle nicht geladen
- **WHEN** die Führungsstelle nicht geladen werden kann und eine einsatzlokale Sprechgruppe
  nirgends sonst zugeordnet ist
- **THEN** steht in ihrer Teilnehmerzelle „Führungsstelle nicht geladen“ statt „keine“

#### Scenario: Einheiten gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt die Darstellung die Sprechgruppen der Abschnitte und die einsatzlokalen, und
  oberhalb steht, dass Einheiten nicht freigegeben sind; keine Zeile behauptet, eine Sprechgruppe
  habe keine Teilnehmer, wenn sie nur an einer gesperrten Quelle hängen könnte

#### Scenario: Sichtvorgabe aus einem Link
- **WHEN** eine Person `/einsaetze/:id/fernmeldewesen?ansicht=sprechgruppen` öffnet
- **THEN** steht die Darstellung auf „Sprechgruppen“, und `ansicht=sprechgruppen` bleibt in der Adresse

#### Scenario: Zurück aus einem Teilnehmer
- **WHEN** eine Person in „Sprechgruppen“ in der Spalte „Bedingung“ auf DMO filtert, in einer Zeile
  einem Teilnehmer folgt und im Browser zurückgeht
- **THEN** steht wieder die Darstellung „Sprechgruppen“ mit dem Filter auf DMO da

#### Scenario: Sichtvorgabe über die alte Adresse
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=sprechgruppen` öffnet
- **THEN** landet sie im Modul Fernmeldewesen in der Darstellung „Sprechgruppen“

#### Scenario: Druck der Darstellung
- **WHEN** eine Person in der Darstellung „Sprechgruppen“ druckt
- **THEN** nennt der Druckkopf die Darstellung „Sprechgruppen“, und jede Zeile steht ohne
  waagerechten Überhang auf A4

#### Scenario: Leitstelle als Teilnehmer
- **WHEN** der Leitstelle „ILS Musterhausen“ „TMO SL AS“ mit Status „geplant“ zugeordnet ist
- **THEN** nennt die Zeile „TMO SL AS“ die Leitstelle als Teilnehmer mit dem Wort „geplant“, und
  sie führt zum Kommunikationsplan
