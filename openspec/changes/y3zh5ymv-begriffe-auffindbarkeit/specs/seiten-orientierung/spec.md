## MODIFIED Requirements

### Requirement: Ortspfad nennt den Einsatz und kürzt nur ihn

Die Seiten Einsatzdaten, Kräfteübersicht, Lagekarte und Einsatz-Einstellungen SHALL einen Ortspfad
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
