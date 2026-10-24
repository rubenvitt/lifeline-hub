## ADDED Requirements

### Requirement: Funkplan als Startseite des Moduls Fernmeldewesen
Der Funkplan SHALL die Startseite des Moduls Fernmeldewesen sein, unter dessen Modulroute
`/einsaetze/:id/fernmeldewesen` als Lesezeichen tauglich erreichbar, mit dem Modul Fernmeldewesen
als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben, nicht
die des Stabs; den Fall ohne Zugriff fängt der Einsatzrahmen ab (Capability `modul-freigabe`). Die
alte Adresse `/einsaetze/:id/stab/funkplan` SHALL samt `?ansicht=` auf die neue umleiten. Der
Stab-Fachzugang S6 SHALL ihn als Werkzeug „Funkplan“ führen (Fähigkeit `stab-fachzugang`).

#### Scenario: Einstieg aus dem Modulmenü
- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen im Modulmenü „Fernmeldewesen“ wählt
- **THEN** öffnet sich der Funkplan unter `/einsaetze/:id/fernmeldewesen`, und das Modul
  Fernmeldewesen ist in der Navigation als aktiv markiert

#### Scenario: Werkzeug im Fachzugang S6
- **WHEN** an einem Fachzugang S6 das Werkzeug „Funkplan“ getippt wird
- **THEN** zeigt die Hülle des Fachzugangs den Funkplan

#### Scenario: Direkter Aufruf als Lesezeichen
- **WHEN** die Adresse des Funkplans direkt aufgerufen wird
- **THEN** erscheint der Funkplan ohne Umweg

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


## REMOVED Requirements

### Requirement: Startseite des Moduls Fernmeldewesen
**Reason**: Die Anforderung nannte den Einstieg aus der Zeile S6 der Stabseite, die entfällt
(LLH-1452).
**Migration**: „Funkplan als Startseite des Moduls Fernmeldewesen“ in dieser Fähigkeit, mit gleichem
Verhalten. Den Einstieg trägt das Werkzeug „Funkplan“ des Fachzugangs S6.
