## MODIFIED Requirements

### Requirement: Einstiege in die Lagebesprechung
Die Fristenliste des Führungsüberblicks und die Schnellaktion „Lagebesprechung abschließen“ SHALL
in die Seite Lagebesprechung führen und deren Freigabe prüfen. Ist das Modul gesperrt, MUST ein
Einstieg gesperrt mit Grund stehen oder fehlen. Den Termin zeigen außerdem der Stabsmonitor und die
Startseite eines Stab-Fachzugangs, beide ohne Sprung, weil ihr Gerät die Lagebesprechung nicht
öffnet. Abschluss, Verlauf und Vorbereitung MUST nur die Seite Lagebesprechung tragen.

#### Scenario: Schnellaktion
- **WHEN** eine Person mit Schreibrecht und Freigabe der Lagebesprechung in der Palette „Lagebesprechung abschließen“ wählt
- **THEN** öffnet sich die Seite Lagebesprechung mit dem Abschlussdialog, auch wenn Stab ausgeblendet ist

#### Scenario: Stab-Seite
- **WHEN** eine Person die alte Adresse `/einsaetze/:id/stab` aufruft
- **THEN** landet sie in den Einsatzdaten, und dort stehen weder eine Termin-Zeile noch ein Paneel „Vorbereitung“ noch ein Verlauf der Lagebesprechung

#### Scenario: Fachzugang
- **WHEN** ein Stab-Fachzugang seine Startseite zeigt und ein Termin gesetzt ist
- **THEN** zeigt sie Termin und Zustand der nächsten Lagebesprechung ohne Sprung

#### Scenario: Marke im Überblick ohne Freigabe
- **WHEN** eine Person ohne Freigabe der Lagebesprechung den Führungsüberblick mit einem gesetzten Termin öffnet
- **THEN** zeigt die Marke „Lagebesprechung“ den Termin, aber keinen Sprung in das Modul

