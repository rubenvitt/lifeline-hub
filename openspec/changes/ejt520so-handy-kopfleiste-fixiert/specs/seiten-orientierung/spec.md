## MODIFIED Requirements

### Requirement: Ortspfad nennt den Einsatz und kürzt nur ihn

Die Seiten Einsatzdaten, Meldebild, Lagekarte und Einsatz-Einstellungen SHALL einen Ortspfad
„Einsätze › <Einsatz> ›“ vor ihrem h1 führen, das ETB nur „Einsätze ›“ (Kopf einzeilig bei
1440 px). Einsatzdaten SHALL das h1 „Einsatzdaten“ tragen.
Im Einsatzrahmen SHALL der Ortspfad erst ab `md` stehen; darunter nennt die Kopfleiste den
Einsatz, und an seiner Stelle SHALL höchstens ein Rückweg „‹ <Eintrag>“ zum nächsten verlinkten
Eintrag unterhalb des Einsatzes stehen (etwa von einer Person zur Personenliste). Außerhalb des Einsatzrahmens SHALL unter `md` der Eintrag „Einsätze“ ungekürzt bleiben,
nur ein Einsatzname SHALL mit Auslassung kürzen; jeder Eintrag SHALL seinen vollen Wortlaut im
`title` tragen.

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

- **WHEN** eine Person bei 390 px Breite eine Person aus der Personenliste eines Einsatzes öffnet
- **THEN** steht über dem h1 nur der Rückweg „‹ Personen“, und er führt zur Personenliste

#### Scenario: Ab Tablet im Einsatz

- **WHEN** eine Person bei 820 px Breite die Einsatzdaten öffnet
- **THEN** steht der Ortspfad „Einsätze › <Einsatz> ›“ vor dem h1
