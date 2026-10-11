# Spec Delta

## MODIFIED Requirements

### Requirement: Aufbewahrungsübersicht

Die Übersicht SHALL alle abgeschlossenen Einsätze der Organisation des Admins zeigen, jeweils
mit Einsatznummer, Bezeichnung, Abschlusszeitpunkt, Frist, Zeitpunkt der Vormerkung,
Karenz-Ende, Fälligkeit eines offenen Einsatz-Antrags, Zeitpunkt der Schwärzung, Zeitpunkt der
endgültigen Löschung („Löschung am“, nur mit Skelett-Frist der Organisation) und einem
Aufbewahrungszustand. Dazu MUST sie jede Zeile des Löschprotokolls der Organisation zeigen, mit
Einsatznummer, Abschluss, Schwärzung und Löschzeitpunkt, aber ohne Bezeichnung. Der Zustand MUST
genau einer dieser Werte sein:
- `ohne_frist`: keine Frist gesetzt
- `frist_laeuft`: Frist in der Zukunft
- `faellig`: Frist abgelaufen, noch nicht vorgemerkt
- `vorgemerkt`: vorgemerkt, Karenz läuft
- `schwaerzung_ausstehend`: Karenz abgelaufen, noch nicht geschwärzt
- `schwaerzung_beantragt`: offener Einsatz-Antrag, noch nicht vollzogen; geht allen
  ungeschwärzten Zuständen vor
- `geschwaerzt`: geschwärzt, Skelett-Frist läuft oder fehlt
- `loeschung_ausstehend`: geschwärzt, Skelett-Frist abgelaufen, noch nicht gelöscht
- `endgueltig_geloescht`: Zeile aus dem Löschprotokoll

Aktive Einsätze MUST fehlen. Die Übersicht MUST ohne Schreibvorgang auskommen und keine
personenbezogenen Spalten enthalten. Ein offener Personen-Antrag ändert den Zustand nicht.

Jede Angabe MUST in der Übersicht erreichbar sein. Unter einer Fensterbreite von 1600 px MAY nur
der Zeitpunkt der Vormerkung, die Fälligkeit eines offenen Einsatz-Antrags und der Zeitpunkt der
Schwärzung aus der Tabelle weichen; eine gewichene Angabe MUST sich über den Spaltenschalter
einblenden lassen, und sein Zähler MUST sie mitzählen. Ab 1600 px SHALL jede Angabe ohne
Handauswahl als Spalte im Bild stehen.

#### Scenario: Zustände
- **WHEN** die Organisation je einen abgeschlossenen Einsatz ohne Frist, mit künftiger Frist, mit abgelaufener Frist, vorgemerkt seit 3 Tagen, vorgemerkt seit 31 Tagen und geschwärzt hat
- **THEN** zeigt die Übersicht sie mit den Zuständen `ohne_frist`, `frist_laeuft`, `faellig`, `vorgemerkt`, `schwaerzung_ausstehend` und `geschwaerzt`
- **AND** trägt der vorgemerkte Einsatz ein Karenz-Ende 30 Tage nach seiner Vormerkung

#### Scenario: Offener Einsatz-Antrag
- **WHEN** ein Einsatz mit künftiger Frist einen vor 2 Stunden gestellten Einsatz-Antrag trägt
- **THEN** zeigt die Übersicht ihn als `schwaerzung_beantragt` mit einer Fälligkeit 24 Stunden nach dem Antrag

#### Scenario: Zurückgenommener Antrag
- **WHEN** der Einsatz-Antrag zurückgenommen ist
- **THEN** zeigt die Übersicht wieder den Zustand aus Frist und Vormerkung

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

#### Scenario: Führungsarbeitsplatz
- **WHEN** der Admin die Übersicht in einem 1440 px breiten Fenster öffnet
- **THEN** stehen Einsatznummer, Zustand, Bezeichnung, Abschlusszeitpunkt, Frist, Karenz-Ende und „Löschung am“ als Spalten im Bild, ohne dass die Tabelle waagerecht überläuft
- **AND** nennt der Spaltenschalter drei ausgeblendete Spalten, und Vormerkung, Antrags-Fälligkeit und Schwärzung lassen sich darüber einblenden

#### Scenario: Breites Fenster
- **WHEN** der Admin die Übersicht in einem mindestens 1600 px breiten Fenster öffnet und im Spaltenschalter nichts abgewählt hat
- **THEN** steht jede Angabe als eigene Spalte im Bild
