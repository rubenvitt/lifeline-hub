# Spec Delta

## MODIFIED Requirements

### Requirement: Aufbewahrungsübersicht

Die Übersicht SHALL alle abgeschlossenen Einsätze der Organisation des Admins zeigen, jeweils
mit Einsatznummer, Bezeichnung, Abschlusszeitpunkt, Frist, Zeitpunkt der Vormerkung,
Karenz-Ende, Zeitpunkt der Schwärzung, Zeitpunkt der endgültigen Löschung („Löschung am“,
nur mit Skelett-Frist der Organisation) und einem Aufbewahrungszustand. Dazu MUST sie jede
Zeile des Löschprotokolls der Organisation zeigen, mit Einsatznummer, Abschluss, Schwärzung
und Löschzeitpunkt, aber ohne Bezeichnung. Der Zustand MUST genau einer dieser Werte sein:
- `ohne_frist`: keine Frist gesetzt
- `frist_laeuft`: Frist in der Zukunft
- `faellig`: Frist abgelaufen, noch nicht vorgemerkt
- `vorgemerkt`: vorgemerkt, Karenz läuft
- `schwaerzung_ausstehend`: Karenz abgelaufen, noch nicht geschwärzt
- `geschwaerzt`: geschwärzt, Skelett-Frist läuft oder fehlt
- `loeschung_ausstehend`: geschwärzt, Skelett-Frist abgelaufen, noch nicht gelöscht
- `endgueltig_geloescht`: Zeile aus dem Löschprotokoll

Aktive Einsätze MUST fehlen. Die Übersicht MUST ohne Schreibvorgang auskommen und keine
personenbezogenen Spalten enthalten.

#### Scenario: Zustände
- **WHEN** die Organisation je einen abgeschlossenen Einsatz ohne Frist, mit künftiger Frist, mit abgelaufener Frist, vorgemerkt seit 3 Tagen, vorgemerkt seit 31 Tagen und geschwärzt hat
- **THEN** zeigt die Übersicht sie mit den Zuständen `ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`, `schwaerzung_ausstehend` und `geschwaerzt`
- **AND** trägt der vorgemerkte Einsatz ein Karenz-Ende 30 Tage nach seiner Vormerkung

#### Scenario: Fremde Organisation und aktive Einsätze
- **WHEN** es aktive Einsätze der eigenen und abgeschlossene Einsätze einer fremden Organisation gibt
- **THEN** fehlen beide in der Übersicht

#### Scenario: Löschung am
- **WHEN** die Organisation eine Skelett-Frist von 3650 Tagen hat
- **THEN** trägt jeder abgeschlossene Einsatz als „Löschung am“ den späteren Zeitpunkt aus Abschluss plus 3650 Tage und seiner Schwärzung, sofern er geschwärzt ist, sonst Abschluss plus 3650 Tage
- **AND** fehlt „Löschung am“, solange die Organisation keine Skelett-Frist hat

#### Scenario: Löschung ausstehend
- **WHEN** ein geschwärzter Einsatz eine abgelaufene Skelett-Frist hat, aber noch nicht gelöscht ist
- **THEN** zeigt die Übersicht ihn mit dem Zustand `loeschung_ausstehend`

#### Scenario: Endgültig gelöscht
- **WHEN** ein Einsatz der Organisation endgültig gelöscht ist
- **THEN** zeigt die Übersicht eine Zeile mit seiner Einsatznummer und dem Zustand `endgueltig_geloescht`
- **AND** trägt die Zeile keine Bezeichnung

#### Scenario: Löschprotokoll einer fremden Organisation
- **WHEN** nur eine fremde Organisation eine Zeile im Löschprotokoll hat
- **THEN** fehlt sie in der Übersicht

### Requirement: Übersicht in der Verwaltung

Die Verwaltung SHALL einen Eintrag „Aufbewahrung“ führen, der nur einem System-Admin
angezeigt wird. Die Übersicht MUST als Tabelle erscheinen, mit fixierter Einsatznummer,
Zustand als Statusetikett mit Wort und einer Auswahl nach Zustand. Eine Zeile MUST in die
Archivakte führen, außer eine Zeile im Zustand `endgueltig_geloescht`: Sie MUST in keine Akte
führen. Die Archivakte MUST eine eigene Adresse haben, die einen Neuladen übersteht.

#### Scenario: Führungskraft
- **WHEN** eine org-weite Führungskraft die Verwaltung öffnet
- **THEN** fehlt der Eintrag „Aufbewahrung“

#### Scenario: Sprung in die Akte
- **WHEN** der Admin in der Übersicht die Zeile eines geschwärzten Einsatzes wählt
- **THEN** öffnet sich dessen Archivakte unter einer eigenen Adresse

#### Scenario: Gelöschter Einsatz
- **WHEN** der Admin in der Übersicht die Zeile eines endgültig gelöschten Einsatzes ansieht
- **THEN** bietet sie keinen Sprung in eine Akte an
- **AND** steht anstelle der Bezeichnung ein Hinweis, dass der Einsatz endgültig gelöscht ist
