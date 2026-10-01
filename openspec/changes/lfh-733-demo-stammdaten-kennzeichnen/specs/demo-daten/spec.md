# Spec Delta

## ADDED Requirements

### Requirement: Demo-Marke im Lese-Vertrag der Stammdaten

Jede Antwort, die ein Fahrzeug, eine Person des Personals oder ein Material darstellt,
SHALL ein Feld `demo` tragen. Das Feld MUST genau dann `true` sein, wenn die Zeile eine
Herkunftsmarke eines Demo-Imports trägt. Das gilt für die Liste und für die Antworten auf
Anlegen, Ändern und Dienststatuswechsel. Das Feld MUST unabhängig von Rolle und Freischaltung des Imports
geliefert werden.

#### Scenario: Angelegte Demo-Zeile
- **WHEN** der Import ein Fahrzeug neu angelegt hat und irgendein Mitglied der Organisation die Fahrzeugliste abruft
- **THEN** trägt dieses Fahrzeug `demo: true`, und jedes Fahrzeug ohne Marke trägt `demo: false`

#### Scenario: Mitbenutzte Zeile
- **WHEN** der Import ein vorhandenes Fahrzeug mitbenutzt hat
- **THEN** trägt dieses Fahrzeug `demo: false`

#### Scenario: Behaltene Zeile nach dem Entfernen
- **WHEN** ein Demo-Fahrzeug in einem echten Einsatz disponiert ist und der Admin die Demo-Daten entfernt
- **THEN** trägt das behaltene Fahrzeug danach `demo: false`

#### Scenario: Änderung und Dienststatuswechsel
- **WHEN** ein markiertes Material geändert oder außer Dienst gestellt wird
- **THEN** trägt die Antwort `demo: true`

#### Scenario: Ohne Freischaltung
- **WHEN** der Server ohne `--demo-daten` läuft und eine Zeile aus einem früheren Import noch markiert ist
- **THEN** trägt die Zeile weiterhin `demo: true`

### Requirement: Demo-Marke in Katalogen und Detailseiten

Die Stammdaten-Kataloge Fahrzeuge, Personal und Material der Verwaltung SHALL an jeder
Zeile mit `demo: true` neben der Kennung (Funkrufname, Name, Bezeichnung) eine Marke mit
dem Wortlaut „Demo“ zeigen. Die Bedeutung MUST im Wortlaut liegen, nicht in der Farbe
(WCAG 1.4.1). Die Detailseiten von Fahrzeug und Personal MUST dieselbe Marke im Kopf
zeigen. Zeilen mit `demo: false` MUST ohne Marke bleiben.

#### Scenario: Katalog mit Demo-Fahrzeug
- **WHEN** der Fahrzeugkatalog ein Fahrzeug mit `demo: true` und eines mit `demo: false` zeigt
- **THEN** steht „Demo“ nur in der Zeile des ersten, neben dessen Funkrufnamen

#### Scenario: Marke ohne Farbe lesbar
- **WHEN** die Marke in Graustufen dargestellt wird
- **THEN** bleibt sie über das Wort „Demo“ erkennbar

#### Scenario: Detailseite
- **WHEN** jemand die Detailseite einer Person mit `demo: true` öffnet
- **THEN** steht „Demo“ im Kopf der Seite

### Requirement: Demo-Stammdaten in den Dispositions-Auswahllisten

Die Auswahllisten, mit denen ein Einsatz Fahrzeuge, Personal oder Material aus den
Stammdaten disponiert, SHALL Demo-Stammdaten anbieten und kennzeichnen, nicht ausblenden.
Eine Option mit `demo: true` MUST das Wort „Demo“ im Wortlaut tragen, über die Suche nach
„Demo“ auffindbar sein und hinter allen Optionen ohne Marke stehen. Innerhalb beider Gruppen MUST
die bisherige Reihenfolge erhalten bleiben. Das gilt in jedem Einsatz.

#### Scenario: Echter Einsatz
- **WHEN** jemand in einem echten Einsatz die Auswahl „Stamm-Fahrzeug disponieren“ öffnet und die Organisation ein Demo-Fahrzeug in Dienst hat
- **THEN** steht das Demo-Fahrzeug mit „Demo“ im Wortlaut hinter allen Fahrzeugen ohne Marke

#### Scenario: Suche nach dem Wort
- **WHEN** jemand in der Personal-Auswahl „Demo“ tippt
- **THEN** bleibt jede Person mit `demo: true` in der Auswahl
- **AND** eine Person ohne Marke bleibt nur, wenn ihr eigener Wortlaut „Demo“ enthält

#### Scenario: Gewählte Option
- **WHEN** jemand ein Demo-Material auswählt
- **THEN** zeigt das geschlossene Auswahlfeld den Wortlaut samt „Demo“

#### Scenario: Ohne Demo-Stammdaten
- **WHEN** keine Stammdatenzeile eine Marke trägt
- **THEN** sind Wortlaut und Reihenfolge der Optionen dieselben wie vor dieser Änderung
