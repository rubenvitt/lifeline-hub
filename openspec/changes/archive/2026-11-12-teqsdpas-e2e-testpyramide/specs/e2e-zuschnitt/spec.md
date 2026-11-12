# Spec Delta

## Purpose

Legt fest, was die e2e-Suite prüft und wie sie es ohne verschenkte Laufzeit tut: e2e nur für
Abläufe über mehrere Seiten und für das, was nur ein echter Browser zeigt, Layout-Gates in jedem
Lauf vollständig, Anmeldung und Saat ohne wiederholte Seitenladungen.

## ADDED Requirements

### Requirement: e2e prüft nur, was nur der Browser oder ein Ablauf zeigt

Ein e2e-Fall MUST einen Ablauf über mehrere Seiten belegen oder eine Eigenschaft, die nur ein
echter Browser zeigt: Geometrie, Überlauf, Trefffläche, Kontrast, Fokus, Gesten, Druck,
Kartengrafik, Service Worker, Verhalten über mehrere Tabs. Logik einer einzelnen Seite MUST in
einem Komponententest (Vitest) belegt sein, Serververhalten in einem Integrationstest des
Backends.

#### Scenario: Reiner API-Fall in e2e
- **WHEN** ein e2e-Fall nur Anfragen an die API stellt und deren Antwort prüft, ohne eine Seite zu laden
- **THEN** steht derselbe Nachweis in einem Integrationstest des Backends, und der e2e-Fall entfällt

#### Scenario: Filter einer Seite
- **WHEN** ein e2e-Fall nur prüft, dass eine einzelne Seite eine Liste richtig filtert oder sortiert, und dafür die Antwort der API vorgibt
- **THEN** steht der Nachweis in einem Komponententest dieser Seite, und der e2e-Fall entfällt

### Requirement: Layout-Gates laufen in jedem Lauf vollständig

Läuft die e2e-Suite, MUST sie jeden Fall jedes Layout-Gates fahren, unabhängig davon, welche
Dateien die Änderung berührt. Ein PR-Lauf und der Lauf auf dem Integrations-Branch MUST dieselbe
Menge Gate-Fälle fahren.

#### Scenario: PR ändert nur einen Fachordner
- **WHEN** ein PR nur Dateien eines einzelnen Moduls im Frontend ändert und die e2e-Suite läuft
- **THEN** misst jedes Layout-Gate alle seine Seiten, Breiten, Stufen und Rollen, nicht nur die Seiten dieses Moduls

### Requirement: Anmeldung über die API

Ein e2e-Fall, der nicht die Anmeldung selbst prüft, MUST sich über die Anmelde-API anmelden und
MUST NOT das Anmeldeformular dafür bedienen. Nach der Anmeldung MUST die erste geladene Seite
den angemeldeten Benutzer zeigen.

#### Scenario: Gate meldet sich an
- **WHEN** ein Layout-Gate als Administrator anmeldet und danach eine Einsatzseite lädt
- **THEN** wurde die Anmeldeseite in diesem Fall nicht geladen, und die Seite zeigt den Administrator als angemeldet

#### Scenario: Formular außerhalb der Anmelde-Specs
- **WHEN** eine Spec, die nicht die Anmeldung prüft, das Anmeldeformular ausfüllt
- **THEN** schlägt die statische Prüfung des Frontends fehl

### Requirement: Eine Ladung je Dichtestufe

Ein Gate, das eine Seite in mehreren Bediendichten misst, MUST die Stufe setzen, bevor es die
gemessene Seite lädt, und MUST vor der Messung zusichern, dass die Seite in dieser Stufe steht.
Für jede Stufe MUST die gemessene Seite genau einmal geladen werden.

#### Scenario: Stufe kommt nicht an
- **WHEN** die gesetzte Stufe beim Laden nicht übernommen wird
- **THEN** schlägt der Fall an der Zusicherung der Stufe fehl, bevor er eine Fläche misst

### Requirement: Kürzung ohne Messverlust

Wer einen e2e-Fall streicht, zusammenlegt oder verschiebt, MUST jede bisherige Messung (Seite,
Breite, Stufe, Rolle) und jede Vorbedingung erhalten oder einem gleichwertigen Test zuordnen. Für
jeden verschobenen oder gestrichenen Nachweis MUST eine Mutationsprobe festgehalten sein, unter
der der übernehmende Test rot wird.

#### Scenario: Fall nach Vitest verschoben
- **WHEN** ein Nachweis aus einer e2e-Spec in einen Komponententest wandert
- **THEN** ist festgehalten, welche Änderung am Produktcode den Komponententest rot macht, und unter dieser Änderung wird er rot

#### Scenario: Admin- und Beobachter-Durchgang zusammengelegt
- **WHEN** ein Admin- und ein Beobachter-Durchgang mit derselben Saat zu einem Fall zusammengelegt werden
- **THEN** misst der Fall beide Rollen, der Beobachter-Teil sichert seinen Rollenzweig vor der Messung zu, und der Bericht zeigt, welcher der beiden Teile fehlschlug
