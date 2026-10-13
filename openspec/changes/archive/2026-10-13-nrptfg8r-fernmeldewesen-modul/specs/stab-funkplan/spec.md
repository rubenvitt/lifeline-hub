## RENAMED Requirements

- FROM: `### Requirement: Eigene Adresse unter dem Stab mit Einstieg aus der S6-Zeile`
- TO: `### Requirement: Startseite des Moduls Fernmeldewesen`

## MODIFIED Requirements

### Requirement: Startseite des Moduls Fernmeldewesen
Der Funkplan SHALL die Startseite des Moduls Fernmeldewesen sein, unter dessen Modulroute
`/einsaetze/:id/fernmeldewesen` als Lesezeichen tauglich erreichbar, mit dem Modul Fernmeldewesen
als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben, nicht
die des Stabs; den Fall ohne Zugriff fängt der Einsatzrahmen ab (Capability `modul-freigabe`). Die
alte Adresse `/einsaetze/:id/stab/funkplan` SHALL samt `?ansicht=` auf die neue umleiten. Die
Sachgebietszeile S6 der Stabseite SHALL einen Verweis „Funkplan“ auf diese Adresse tragen, gesperrt,
solange das Fernmeldewesen für die Person gesperrt ist.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf Stab und Fernmeldewesen in der Zeile S6 auf „Funkplan“ tippt
- **THEN** öffnet sich der Funkplan unter `/einsaetze/:id/fernmeldewesen`, und das Modul
  Fernmeldewesen ist in der Navigation als aktiv markiert

#### Scenario: Direkter Aufruf als Lesezeichen
- **WHEN** die Adresse des Funkplans direkt aufgerufen wird
- **THEN** erscheint der Funkplan ohne Umweg über die Stabseite

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen` und sieht den Funkplan

#### Scenario: Stab gesperrt
- **WHEN** der Stab für die Person gesperrt oder im Einsatz ausgeblendet ist und das Fernmeldewesen
  frei
- **THEN** zeigt der Funkplan Tabelle, Skizze und Sprechgruppen wie mit Stab

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“ statt des Funkplans,
  auch wenn der Stab frei ist

Weil die Quellen des Funkplans (Abschnitte, Einheiten, Fahrzeuge, Personal, Sprechgruppen) das
Fernmeldewesen nicht selbst prüfen, MUST die Seite dessen Freigabe ermittelt haben, bevor sie Daten
zeigt, auch wenn der Rahmen bei gescheitertem Freigabeabruf die Seite rendert. Scheitert die
Ermittlung, zeigt sie einen Fehler mit Wiederholen, nicht den Funkplan. Ohne Netz gilt der zuletzt
geladene Stand der Freigaben.

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und weder Tabelle, Skizze noch Übernahme

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und eine Person `/einsaetze/:id/stab/funkplan`
  aufruft
- **THEN** landet sie im Funkplan des Moduls Fernmeldewesen, nicht beim Hinweis „Stab ausgeblendet“

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
- **THEN** steht die Darstellung auf „Sprechgruppen“, und `ansicht` ist aus der Adresse entfernt

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
