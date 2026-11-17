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

### Requirement: Tab-Titel einer Übung beginnt mit „ÜBUNG“

Ist der Einsatz eine Übung (Einsatzart „Übung“), SHALL der Tab-Titel jeder Route des
Einsatzrahmens mit „ÜBUNG · “ beginnen, vor einer Zählung ungelesener Eingänge.

#### Scenario: ETB in einer Übung

- **WHEN** eine Person `/einsaetze/5/etb` des Einsatzes „Starkregen Nord“ mit der Einsatzart
  „Übung“ öffnet
- **THEN** lautet der Tab-Titel „ÜBUNG · ETB · Starkregen Nord · lifeline-hub“

#### Scenario: Übung mit ungelesenen Eingängen

- **WHEN** in derselben Übung drei Eingänge ungelesen sind
- **THEN** lautet der Tab-Titel „ÜBUNG · (3) ETB · Starkregen Nord · lifeline-hub“

### Requirement: Ortspfad nennt den Einsatz und kürzt nur ihn

Die Seiten Einsatzdaten, Kräfteübersicht, Lagekarte und Einsatz-Einstellungen SHALL einen Ortspfad
„Einsätze › <Einsatz> ›“ vor ihrem h1 führen, das ETB nur „Einsätze ›“ (Kopf einzeilig bei
1440 px). Einsatzdaten SHALL das h1 „Einsatzdaten“ tragen.
Im Einsatzrahmen SHALL der Ortspfad erst ab `md` stehen; darunter nennt die Kopfleiste den
Einsatz, und an seiner Stelle SHALL höchstens ein Rückweg „‹ <Eintrag>“ zum nächsten verlinkten
Eintrag unterhalb des Einsatzes stehen (etwa von einer Person zur Liste „Betroffene“).
Außerhalb des Einsatzrahmens SHALL unter `md` der Eintrag „Einsätze“ ungekürzt bleiben, nur ein
Einsatzname SHALL mit Auslassung kürzen; jeder Eintrag SHALL seinen vollen Wortlaut im `title`
tragen.

#### Scenario: Einsatzdaten

- **WHEN** eine Person die Einsatzdaten öffnet
- **THEN** ist das h1 „Einsatzdaten“, und der Pfad nennt den Einsatz

#### Scenario: ETB bei 1440 px

- **WHEN** eine Person das ETB eines Einsatzes bei 1440 × 900 öffnet
- **THEN** steht der Seitenkopf in einer Zeile, und der Pfad lautet „Einsätze ›“

#### Scenario: Handy mit langem Einsatznamen

- **WHEN** eine Person bei 390 px Breite die Einsatzdaten eines Einsatzes mit langem Namen öffnet
- **THEN** steht über dem h1 kein Ortspfad, und der Einsatzname steht in der Kopfleiste

#### Scenario: Detailseite am Handy

- **WHEN** eine Person bei 390 px Breite eine Person aus der Liste „Betroffene“ eines Einsatzes öffnet
- **THEN** steht über dem h1 nur der Rückweg „‹ Betroffene“, und er führt zur Liste

#### Scenario: Ab Tablet im Einsatz

- **WHEN** eine Person bei 820 px Breite die Einsatzdaten öffnet
- **THEN** steht der Ortspfad „Einsätze › <Einsatz> ›“ vor dem h1

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
Einsatzart, Einsatznummer und Ort tragen, soweit sie vorliegen; bei einer Übung entfällt die
Einsatzart, weil die Übungsmarke sie schon nennt, und fehlt jede Nummer, steht an ihrer Stelle
„seit“ mit dem Beginndatum in der Zeitdarstellung der App. Der Wechsler SHALL keinen Eintrag zur Verwaltung oder zu den Stammdaten führen.

#### Scenario: Klick auf den eigenen Einsatz

- **WHEN** eine Person im ETB den Wechsler öffnet und ihren eigenen Einsatz wählt
- **THEN** bleibt sie im ETB

#### Scenario: Gleich benannte Einsätze

- **WHEN** zwei aktive Einsätze „Stadtfest“ heißen, einer als Sanitätsdienst mit Nummer
  E-2026-0431 am Ort „Markt“, einer als Übung ohne Nummer, begonnen am 14.11.
- **THEN** zeigt der Wechsler beim ersten „Sanitätsdienst · E-2026-0431 · Markt“ und beim zweiten
  die Marke „ÜBUNG“ mit der Nebenzeile „seit 14nov26“ (bei der Darstellung „Datum und Uhrzeit“
  „seit 14.11.26“)

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

### Requirement: Die Rail führt zurück ins zuletzt besuchte Modul der Kategorie

Ein Klick auf eine andere Kategorie der Rail SHALL in das Modul dieser Kategorie führen, in dem
die Person im selben Einsatz zuletzt war, jede Ankunft gezählt. Gemerkt wird je Person und Einsatz
für zwölf Stunden. Ohne gültigen Eintrag, wenn das gemerkte Modul gesperrt oder ausgeblendet ist
oder nicht mehr zur Kategorie gehört, MUST der Klick ins erste freigegebene Modul der Kategorie
führen.

#### Scenario: Zurück in die Kräfte

- **WHEN** eine Person in Kräfte das Modul Ablösung öffnet, dann in Betroffene & Schäden wechselt und wieder
  auf Kräfte klickt
- **THEN** steht sie in Ablösung, nicht im ersten Modul der Kategorie

#### Scenario: Ankunft über die Sprungpalette

- **WHEN** eine Person über die Sprungpalette Ablösung öffnet, in Betroffene & Schäden wechselt und dann auf
  Kräfte klickt
- **THEN** steht sie in Ablösung

#### Scenario: Erster Besuch der Kategorie

- **WHEN** eine Person in diesem Einsatz noch in keinem Modul der Kategorie Kräfte war und auf
  Kräfte klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie

#### Scenario: Gemerktes Modul inzwischen gesperrt

- **WHEN** das zuletzt besuchte Modul einer Kategorie für die Person gesperrt worden ist und sie
  auf die Kategorie klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie

#### Scenario: Gemerktes Modul in eine andere Kategorie gewandert

- **WHEN** für die Kategorie Betroffene & Schäden noch das ETB gemerkt ist, das jetzt zu Führung gehört, und
  die Person auf Betroffene & Schäden klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie Betroffene & Schäden

#### Scenario: Anderer Einsatz, andere Person

- **WHEN** eine Person in Einsatz A in Ablösung war und in Einsatz B auf Kräfte klickt, oder eine
  andere Person am selben Gerät in Einsatz A auf Kräfte klickt
- **THEN** führt der Klick ins erste freigegebene Modul der Kategorie

#### Scenario: Eintrag älter als zwölf Stunden

- **WHEN** der letzte Besuch in Ablösung mehr als zwölf Stunden zurückliegt und die Person auf
  Kräfte klickt
- **THEN** steht sie im ersten freigegebenen Modul der Kategorie

### Requirement: Einsatzwechsel bleibt im Modul

Wählt eine Person im Einsatzwechsler oder im Einsatzwechsel der Sprungpalette einen anderen
Einsatz, SHALL sie auf der Startseite desselben Moduls im Ziel-Einsatz ankommen, sofern das Modul
dort für sie freigegeben ist. Ist es das nicht, MUST sie ohne Hinweis im Standardmodul des Ziels
ankommen. Detail, Auswahl und Filter des vorigen Einsatzes MUST NOT mitgenommen werden.

#### Scenario: Fahrzeuge bleibt Fahrzeuge

- **WHEN** eine Person in Einsatz 7 die Fahrzeuge mit geöffnetem Fahrzeug 3 ansieht und im
  Wechsler Einsatz 8 wählt
- **THEN** öffnet sich die Fahrzeugliste von Einsatz 8 ohne geöffnetes Fahrzeug

#### Scenario: Modul im Ziel ausgeblendet

- **WHEN** eine Person aus den Fahrzeugen in einen Einsatz wechselt, dessen Vorlage die Fahrzeuge
  ausblendet
- **THEN** öffnet sich dessen Standardmodul, ohne Sperrseite

#### Scenario: Palette im neuen Tab

- **WHEN** eine Person in den Fahrzeugen die Sprungpalette öffnet, den Einsatzwechsel zu Einsatz 8
  markiert und Strg+↵ drückt
- **THEN** öffnet sich im neuen Tab die Fahrzeugliste von Einsatz 8
