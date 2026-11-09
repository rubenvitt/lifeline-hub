# Spec Delta

## MODIFIED Requirements

### Requirement: Startseite des Moduls Fernmeldewesen
Der Funkplan SHALL die Startseite des Moduls Fernmeldewesen sein, unter dessen Modulroute
`/einsaetze/:id/fernmeldewesen` als Lesezeichen tauglich erreichbar, mit dem Modul Fernmeldewesen
als aktiv in der Navigation. Er SHALL Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben; den
Fall ohne Zugriff fängt der Einsatzrahmen ab (Capability `modul-freigabe`). Die alte Adresse
`/einsaetze/:id/stab/funkplan` SHALL samt `?ansicht=` auf die neue umleiten.

#### Scenario: Einstieg aus der Stabseite
- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen im Modulmenü „Fernmeldewesen“ wählt
- **THEN** öffnet sich der Funkplan unter `/einsaetze/:id/fernmeldewesen`, und das Modul
  Fernmeldewesen ist in der Navigation als aktiv markiert

#### Scenario: Direkter Aufruf als Lesezeichen
- **WHEN** die Adresse des Funkplans direkt aufgerufen wird
- **THEN** erscheint der Funkplan ohne Umweg über eine andere Seite

#### Scenario: Altes Lesezeichen
- **WHEN** eine Person `/einsaetze/:id/stab/funkplan` aufruft
- **THEN** landet sie auf `/einsaetze/:id/fernmeldewesen` und sieht den Funkplan

#### Scenario: Stab gesperrt
- **WHEN** das Fernmeldewesen für die Person frei ist
- **THEN** zeigt der Funkplan Tabelle, Skizze und Sprechgruppen

#### Scenario: Fernmeldewesen gesperrt
- **WHEN** das Modul Fernmeldewesen für die Person ausgeblendet oder für ihre Rolle gesperrt ist
- **THEN** zeigt der Rahmen den einheitlichen Hinweis für „Fernmeldewesen“ statt des Funkplans

Weil die Quellen des Funkplans (Abschnitte, Einheiten, Fahrzeuge, Personal, Sprechgruppen) das
Fernmeldewesen nicht selbst prüfen, MUST die Seite dessen Freigabe ermittelt haben, bevor sie Daten
zeigt, auch wenn der Rahmen bei gescheitertem Freigabeabruf die Seite rendert. Scheitert die
Ermittlung, zeigt sie einen Fehler mit Wiederholen, nicht den Funkplan. Ohne Netz gilt der zuletzt
geladene Stand der Freigaben.

#### Scenario: Freigabe nicht ermittelbar
- **WHEN** der Abruf der Modulfreigaben scheitert
- **THEN** zeigt die Seite einen Fehler mit Wiederholen und weder Tabelle, Skizze noch Übernahme

#### Scenario: Altes Lesezeichen bei ausgeblendetem Stab
- **WHEN** eine Person mit Freigabe des Fernmeldewesens `/einsaetze/:id/stab/funkplan` aufruft
- **THEN** landet sie im Funkplan des Moduls Fernmeldewesen und nicht auf der Seite des Einsatzes

### Requirement: Zahl der Lücken
Das Lücken-Paneel des Funkplans SHALL in seinem Kopf die Zahl der Lücken zeigen („3 Lücken“). Sie
ist die Summe der Zahlen aus „Lücken oberhalb der Tabelle“, die Leitstelle ohne Verbindung zählt
dabei als eine Lücke. Die fehlende eigene Gegenstelle zählt nicht mit, sie ist ein Hinweis auf den
Pflegeort. Ein Datensatz, der unter zwei Lücken fällt, zählt bei jeder. Zeigt auch nur eine der
summierten Zahlen „—“, MUST die Zahl der Lücken entfallen bzw. „—“ mit dem Grund der schlechtesten
Quelle zeigen und MUST NOT eine Teilsumme zeigen. Sie MUST in jeder Darstellung des Funkplans
dieselbe sein.

#### Scenario: Summe
- **WHEN** das Lücken-Paneel „1“ bei „Abschnitte ohne Sprechgruppe“, „1“ bei „Einheiten ohne Sprechgruppe“ und „1“ bei „Einheiten ohne Telefon“ zeigt, für dieselbe Einheit, und sonst keine Lücke
- **THEN** zeigt der Kopf des Lücken-Paneels „3 Lücken“

#### Scenario: Keine Lücke
- **WHEN** keine der Lücken zutrifft und alle Quellen geladen sind
- **THEN** zeigt der Kopf „0 Lücken“

#### Scenario: Quelle gesperrt
- **WHEN** die Einheitenliste mit 403 abgelehnt wird
- **THEN** zeigt der Kopf keine Teilsumme, sondern „—“ mit dem Grund „nicht freigegeben“
