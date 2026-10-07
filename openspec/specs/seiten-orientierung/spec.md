# seiten-orientierung Specification

## Purpose
Legt fest, wie eine Person jederzeit erkennt, in welchem Einsatz und auf welcher Seite sie ist
und wie sie dorthin zurückkommt: Tab-Titel, Ortspfad, Einsatzstatus im Seitenkopf,
Einsatzwechsler und Rückweg von Profil und Verwaltung. Herleitung:
`openspec/changes/archive/2026-10-07-lfh-954-orientierung/design.md`.

## Requirements

### Requirement: Tab-Titel nennt Seite und Einsatz

Das System SHALL `document.title` auf jeder Route des Einsatzrahmens auf „<Modulname> ·
<Einsatzbezeichnung> · lifeline-hub“ setzen, mit dem Modulnamen aus der Modul-Registry. Auf
Ebene 1 SHALL der Titel „<Seite> · lifeline-hub“ lauten, in der Verwaltung „<Sektion> ·
Verwaltung · lifeline-hub“, auf der Anmeldung „Anmelden · lifeline-hub“. Keine Seite SHALL den
Titel an diesem Weg vorbei setzen. Verlässt eine Person den Bereich, SHALL der vorige Titel
zurückkehren.

#### Scenario: ETB im Einsatz

- **WHEN** eine Person `/einsaetze/5/etb` des Einsatzes „Starkregen Nord“ öffnet
- **THEN** lautet der Tab-Titel „ETB · Starkregen Nord · lifeline-hub“

#### Scenario: Unterroute ohne eigenen Seitenkopf

- **WHEN** eine Person die Lagekarte oder eine Detailseite eines Moduls öffnet
- **THEN** nennt der Tab-Titel das Modul und den Einsatz

#### Scenario: Einsatz lädt noch

- **WHEN** der Einsatz noch nicht geladen ist
- **THEN** lautet der Tab-Titel „<Modulname> · lifeline-hub“

#### Scenario: Verwaltung

- **WHEN** eine Person `/admin/stammdaten/fahrzeuge` öffnet
- **THEN** lautet der Tab-Titel „Fahrzeuge · Verwaltung · lifeline-hub“

### Requirement: Ortspfad nennt den Einsatz und kürzt nur ihn

Die Seiten Einsatzdaten, ETB, Meldebild, Lagekarte und Einsatz-Einstellungen SHALL einen Ortspfad
„Einsätze › <Einsatz> ›“ vor ihrem h1 führen. Einsatzdaten SHALL das h1 „Einsatzdaten“ tragen.
Unter `md` SHALL der Eintrag „Einsätze“ ungekürzt bleiben; nur der Einsatzname SHALL mit
Auslassung kürzen, und jeder Eintrag SHALL seinen vollen Wortlaut im `title` tragen.

#### Scenario: Einsatzdaten

- **WHEN** eine Person die Einsatzdaten öffnet
- **THEN** ist das h1 „Einsatzdaten“, und der Pfad nennt den Einsatz

#### Scenario: Handy mit langem Einsatznamen

- **WHEN** eine Person bei 390 px Breite eine Seite eines Einsatzes mit langem Namen öffnet
- **THEN** ist „Einsätze“ im Pfad ganz lesbar, und der Einsatzname endet mit „…“

### Requirement: Einsatzstatus nur beschriftet und nur, wenn er nicht aktiv ist

Kein h1 einer Fachseite SHALL den Einsatzstatus enthalten. Ist der Einsatz nicht aktiv, SHALL der
Seitenkopf jeder Seite des Einsatzrahmens neben dem Titel „Einsatzstatus <Etikett>“ zeigen. Ist
er aktiv, SHALL der Seitenkopf keinen Einsatzstatus zeigen. Der Reiter der Tierliste für
nicht abgeschlossene Tiere SHALL „Offen“ heißen.

#### Scenario: Aktiver Einsatz

- **WHEN** eine Person die Tierliste eines aktiven Einsatzes öffnet
- **THEN** lautet das h1 „Tiere“, und im Seitenkopf steht kein Einsatzstatus

#### Scenario: Abgeschlossener Einsatz

- **WHEN** eine Person eine Fachseite eines abgeschlossenen Einsatzes öffnet
- **THEN** steht neben dem Titel „Einsatzstatus Abgeschlossen“

### Requirement: Einsatzwechsler zeigt den eigenen Einsatz und keine Verwaltung

Der Einsatzwechsler SHALL den aktuellen Einsatz als gewählt markieren, auch wenn er abgeschlossen
ist. Ein Klick darauf SHALL
das Menü schließen, ohne die Seite zu wechseln. Jeder Einsatz SHALL eine Nebenzeile mit
Einsatznummer und Ort tragen, soweit sie vorliegen. Der Wechsler SHALL keinen Eintrag zur
Verwaltung oder zu den Stammdaten führen.

#### Scenario: Klick auf den eigenen Einsatz

- **WHEN** eine Person im ETB den Wechsler öffnet und ihren eigenen Einsatz wählt
- **THEN** bleibt sie im ETB

### Requirement: Letzter Ort je Person

Das System SHALL je Person den zuletzt offenen Pfad im Einsatzrahmen merken, ohne die Suche der
Adresse, für die Dauer einer Schicht (12 Stunden). Ein gesperrtes Modul SHALL nicht gemerkt
werden.

#### Scenario: Andere Person am selben Gerät

- **WHEN** sich eine andere Person am selben Browser anmeldet
- **THEN** sieht sie keinen Rückweg in den Einsatz der vorigen Person

#### Scenario: Freitextfilter in der Adresse

- **WHEN** eine Person das ETB mit einem Suchbegriff in der Adresse offen hat
- **THEN** steht der Suchbegriff nicht im gemerkten Ort

### Requirement: Rückweg von Profil und Verwaltung

Auf `/profil` und `/admin/*` SHALL ein Ortspfad stehen („Einsätze › Profil“ bzw. „Einsätze ›
Verwaltung ›“). Ist der gemerkte Einsatz aktiv und für die Person sichtbar, SHALL dort ein Knopf
„Zurück zu <Einsatz>“ an den gemerkten Pfad führen. Der Kopflink „Verwaltung“ SHALL im
Verwaltungsbereich `aria-current="page"` tragen und seinen Zustand nicht nur über die Farbe zeigen.

#### Scenario: Passwort geändert, zurück ins ETB

- **WHEN** eine Person aus dem ETB über das Benutzermenü ins Profil wechselt
- **THEN** führt „Zurück zu <Einsatz>“ sie zurück ins ETB desselben Einsatzes

#### Scenario: Einsatz inzwischen abgeschlossen

- **WHEN** der gemerkte Einsatz abgeschlossen ist
- **THEN** steht auf Profil kein Rückweg-Knopf
