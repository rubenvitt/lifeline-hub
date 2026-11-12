# benutzermenue Specification

## Purpose
Legt fest, was das Benutzermenü der Stabsoberfläche trägt und in welcher Reihenfolge, und wo die
Wege liegen, die es bewusst nicht trägt. Das Menü bleibt kurz, ohne dass ein Weg verloren geht.

## Requirements

### Requirement: Aufbau des Benutzermenüs

Das Benutzermenü SHALL genau diese Teile in dieser Reihenfolge tragen: den Kopf (Name,
Benutzername, Einsatzfunktion falls vorhanden, Rollen, Version), „Profil“, „Abmelden“, die
Gruppe „Anzeige“, „Benachrichtigungen“, „Neuigkeiten“ und „Hilfe“. Weitere Einträge MUST NOT
hinzukommen, ohne dass diese Fähigkeit geändert wird.

#### Scenario: Einträge in Reihenfolge
- **WHEN** eine angemeldete Person das Benutzermenü öffnet
- **THEN** folgen auf den Kopf „Profil“, „Abmelden“, die Gruppe „Anzeige“, „Benachrichtigungen“, „Neuigkeiten“ und „Hilfe“
- **AND** es gibt keinen Eintrag „Rückmeldung“ und keinen Eintrag „Lizenzen“

#### Scenario: Neuigkeiten ungelesen
- **WHEN** die laufende Version noch nicht gelesen ist und das Benutzermenü geöffnet wird
- **THEN** trägt „Neuigkeiten“ den Punkt mit dem zugänglichen Namen „ungelesen“

### Requirement: Gruppe Anzeige mit drei Leisten

Die Gruppe „Anzeige“ SHALL Darstellung, Bediendichte und Helligkeit als je eine benannte
Einfachauswahl tragen (Leiste „Darstellung“: Hell, Dunkel, System; „Bediendichte“: Kompakt,
Komfortabel, Handschuh; „Helligkeit“: 100, 80, 60, 40, 20 %). Der gewählte Wert MUST als
ausgewählt erkennbar sein, sichtbar und für Hilfstechnik. Eine Wahl MUST sofort wirken und das
Menü offen lassen.

#### Scenario: Gewählte Werte sichtbar
- **WHEN** Darstellung „Dunkel“, Bediendichte „Komfortabel“ und Helligkeit 100 % gelten und das Benutzermenü geöffnet wird
- **THEN** ist in der Leiste „Darstellung“ „Dunkel“ ausgewählt, in „Bediendichte“ „Komfortabel“ und in „Helligkeit“ 100 %

#### Scenario: Wahl wirkt sofort
- **WHEN** im geöffneten Menü in der Leiste „Darstellung“ „Hell“ gewählt wird
- **THEN** wechselt die Anzeige auf Hell
- **AND** das Menü bleibt offen und zeigt „Hell“ ausgewählt

#### Scenario: Tastatur in der Leiste
- **WHEN** der Fokus auf einem Wert einer Leiste steht und die Pfeiltaste nach rechts gedrückt wird
- **THEN** wird der nächste Wert dieser Leiste gewählt, ohne dass der Fokus die Leiste verlässt

### Requirement: Das Menü passt auf das Handy

Am Handy (390 × 844) SHALL das geöffnete Benutzermenü in `kompakt` und `komfortabel` ganz im
Fenster liegen, ohne Rollen. In `handschuh` MUST mindestens alles bis einschließlich der Gruppe
„Anzeige“ ohne Rollen sichtbar sein, auch unter dem zweizeiligen Kopf außerhalb eines Einsatzes;
dafür stehen dort „Profil“ und „Abmelden“ nebeneinander in einer Zeile. Der Rest ist im Menü
erreichbar.

#### Scenario: Komfortabel am Handy
- **WHEN** das Benutzermenü bei 390 × 844 in `komfortabel` geöffnet wird
- **THEN** liegen alle Einträge bis „Hilfe“ im Fenster

#### Scenario: Helligkeit im Handschuh-Betrieb in einer Zeile
- **WHEN** das Benutzermenü in `handschuh` bei 390 × 844 oder bei 1024 × 768 geöffnet wird
- **THEN** stehen die fünf Stufen der Leiste „Helligkeit“ in einer Zeile, ohne sich zu überlappen und ohne über die Leiste hinauszuragen
- **AND** benachbarte Stufen stehen mindestens 16 px auseinander, jede ist 72 px hoch

#### Scenario: Handschuh am Handy
- **WHEN** das Benutzermenü bei 390 × 844 in `handschuh` geöffnet wird
- **THEN** liegen „Abmelden“ und alle drei Leisten der Gruppe „Anzeige“ ohne Rollen im Fenster
- **AND** „Profil“ und „Abmelden“ stehen nebeneinander, jeder Eintrag bleibt einzeln wählbar

### Requirement: Rückmeldung und Lizenzen auf der Hilfe-Seite

Die Übersicht der Hilfe-Seite SHALL einen Weg „Rückmeldung geben“ zum Rückmeldeformular und einen
Link „Lizenzen“ zum Lizenzhinweis der eingebetteten Bibliotheken tragen. Der Rückmeldeweg MUST
dieselben Felder vorbefüllen wie bisher (Version, Oberfläche, Bereich der App als Muster) und
MUST NOT Kennungen, Namen oder die Adresse der Installation weitergeben. In einer Sitzung eines
gekoppelten Geräts MUST der Rückmeldeweg fehlen.

#### Scenario: Rückmeldung aus der Hilfe
- **WHEN** eine Person die Hilfe aus dem ETB eines Einsatzes öffnet und „Rückmeldung geben“ wählt
- **THEN** öffnet sich das Formular in einem neuen Fenster mit Version, Oberfläche und dem Bereich `/einsatz/:id/etb`

#### Scenario: Hilfe ohne Herkunft
- **WHEN** die Hilfe direkt über ihre Adresse geöffnet wird und „Rückmeldung geben“ gewählt wird
- **THEN** trägt das Formular als Bereich das Muster der Hilfe

#### Scenario: Lizenzen
- **WHEN** in der Übersicht der Hilfe „Lizenzen“ gewählt wird
- **THEN** öffnet sich der Lizenzhinweis in einem neuen Fenster

#### Scenario: Gekoppeltes Gerät
- **WHEN** die Hilfe in der Sitzung eines gekoppelten Geräts geöffnet wird
- **THEN** fehlt „Rückmeldung geben“, der Link „Lizenzen“ steht da

### Requirement: Zweiter Weg zu den Benachrichtigungen im Einsatz

Die Klappfläche „Eingänge“ im Einsatz SHALL unten einen Link „Benachrichtigungen einstellen“
tragen, der auf die Einstellungsseite der Benachrichtigungen führt. Der Eintrag
„Benachrichtigungen“ im Benutzermenü MUST bestehen bleiben.

#### Scenario: Aus den Eingängen einstellen
- **WHEN** die Klappfläche „Eingänge“ offen ist und „Benachrichtigungen einstellen“ gewählt wird
- **THEN** zeigt die App die Seite „Benachrichtigungen“ und die Klappfläche schließt
