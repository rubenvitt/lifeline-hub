# seiten-orientierung Specification

## Purpose
Legt fest, wie eine Person jederzeit erkennt, in welchem Einsatz und auf welcher Seite sie ist
und wie sie dorthin zurückkommt: Tab-Titel, Ortspfad, Einsatzstatus im Seitenkopf,
Einsatzwechsler und Rückweg von Profil, Benachrichtigungen, Neuigkeiten, Verwaltung und Hilfe.
Herleitung: `openspec/changes/archive/2026-10-07-lfh-954-orientierung/design.md`, für Hilfe und
Neuigkeiten `openspec/changes/archive/2026-11-15-ysjiv1n3-rueckweg-hilfe-profil/design.md`.

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

Die Seiten Einsatzdaten, Meldebild, Lagekarte und Einsatz-Einstellungen SHALL einen Ortspfad
„Einsätze › <Einsatz> ›“ vor ihrem h1 führen, das ETB nur „Einsätze ›“ (Kopf einzeilig bei
1440 px), die Lagekarte erst ab `md` (Kartenhöhe). Einsatzdaten SHALL das h1 „Einsatzdaten“
tragen.
Unter `md` SHALL der Eintrag „Einsätze“ ungekürzt bleiben; nur der Einsatzname SHALL mit
Auslassung kürzen, und jeder Eintrag SHALL seinen vollen Wortlaut im `title` tragen.

#### Scenario: Einsatzdaten

- **WHEN** eine Person die Einsatzdaten öffnet
- **THEN** ist das h1 „Einsatzdaten“, und der Pfad nennt den Einsatz

#### Scenario: ETB bei 1440 px

- **WHEN** eine Person das ETB eines Einsatzes bei 1440 × 900 öffnet
- **THEN** steht der Seitenkopf in einer Zeile, und der Pfad lautet „Einsätze ›“

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

Auf `/profil`, `/benachrichtigungen`, `/neuigkeiten` und `/admin/*` SHALL ein Ortspfad stehen
(„Einsätze › Profil“, „Einsätze › Benachrichtigungen“, „Einsätze › Neuigkeiten“ bzw. „Einsätze ›
Verwaltung ›“). Ist der gemerkte Einsatz aktiv und für die Person sichtbar, SHALL dort ein Knopf
„Zurück zu <Einsatz>“ an den gemerkten Pfad führen. Der Kopflink „Verwaltung“ SHALL im
Verwaltungsbereich `aria-current="page"` tragen und seinen Zustand nicht nur über die Farbe zeigen.

#### Scenario: Passwort geändert, zurück ins ETB

- **WHEN** eine Person aus dem ETB über das Benutzermenü ins Profil wechselt
- **THEN** führt „Zurück zu <Einsatz>“ sie zurück ins ETB desselben Einsatzes

#### Scenario: Einsatz inzwischen abgeschlossen

- **WHEN** der gemerkte Einsatz abgeschlossen ist
- **THEN** steht auf Profil kein Rückweg-Knopf

#### Scenario: Neuigkeiten aus der Lagekarte

- **WHEN** eine Person aus der Lagekarte eines aktiven Einsatzes über das Benutzermenü die Neuigkeiten öffnet
- **THEN** steht über dem Titel „Einsätze › Neuigkeiten“
- **AND** führt „Zurück zu <Einsatz>“ sie zurück in die Lagekarte desselben Einsatzes

#### Scenario: Benachrichtigungen aus den Eingängen

- **WHEN** eine Person in einem aktiven Einsatz in der Klappfläche „Eingänge“ „Benachrichtigungen einstellen“ wählt
- **THEN** führt „Zurück zu <Einsatz>“ auf der Seite „Benachrichtigungen“ an die Stelle zurück, an der sie war

### Requirement: Rückweg aus der Hilfe

Der Kopf der Hilfe SHALL genau einen Rückweg tragen: in der Sitzung eines gekoppelten Geräts
„Zum Gerät“, ohne Anmeldung „Zur Anmeldung“, angemeldet „Zurück zu <Einsatz>“ an den gemerkten
Pfad unter derselben Bedingung wie auf Profil, sonst „Zu den Einsätzen“ zur Einsatzliste. Ein
Wechsel zwischen Kapiteln MUST den Rückweg nicht ändern.

#### Scenario: Hilfe aus dem ETB

- **WHEN** eine Person in einem aktiven Einsatz aus dem ETB die Hilfe öffnet, ein Kapitel liest und „Zurück zu <Einsatz>“ wählt
- **THEN** steht sie wieder im ETB desselben Einsatzes

#### Scenario: Hilfe ohne aktiven Einsatz

- **WHEN** eine angemeldete Person die Hilfe öffnet und ihr gemerkter Einsatz abgeschlossen ist oder es keinen gemerkten Einsatz gibt
- **THEN** trägt der Kopf der Hilfe „Zu den Einsätzen“, und der Knopf führt zur Einsatzliste

#### Scenario: Gekoppeltes Gerät

- **WHEN** die Hilfe in der Sitzung eines gekoppelten Geräts geöffnet ist
- **THEN** trägt ihr Kopf „Zum Gerät“ und keinen Rückweg in einen Einsatz
