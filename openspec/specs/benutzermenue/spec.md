# benutzermenue Specification

## Purpose
Legt fest, was das Benutzermenü der Stabsoberfläche trägt und in welcher Reihenfolge, und wo die
Wege liegen, die es bewusst nicht trägt. Das Menü bleibt kurz, ohne dass ein Weg verloren geht.

## Requirements

### Requirement: Aufbau des Benutzermenüs

Das Benutzermenü SHALL genau diese Teile in dieser Reihenfolge tragen: den Kopf (Name,
Benutzername, Einsatzfunktion falls vorhanden, Rollen, Version), „Profil“, die Gruppe „Anzeige“,
„Benachrichtigungen“, „Neuigkeiten“, „Hilfe“ und als letzten Eintrag „Abmelden“. „Abmelden“
MUST als einziger Eintrag rot stehen und durch einen Trenner von „Hilfe“ abgesetzt sein. Weitere
Einträge MUST NOT hinzukommen, ohne dass diese Fähigkeit geändert wird.

#### Scenario: Einträge in Reihenfolge
- **WHEN** eine angemeldete Person das Benutzermenü öffnet
- **THEN** folgen auf den Kopf „Profil“, die Gruppe „Anzeige“, „Benachrichtigungen“, „Neuigkeiten“, „Hilfe“ und zuletzt „Abmelden“
- **AND** es gibt keinen Eintrag „Rückmeldung“ und keinen Eintrag „Lizenzen“

#### Scenario: Abmelden steht nicht neben Profil
- **WHEN** das Benutzermenü in einer beliebigen Bediendichte geöffnet wird
- **THEN** folgt auf „Profil“ nicht „Abmelden“, und beide stehen nicht in derselben Zeile

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
Fenster liegen, ohne Rollen, bis einschließlich „Abmelden“. In `handschuh` MUST mindestens alles
bis einschließlich der Gruppe „Anzeige“ ohne Rollen sichtbar sein, auch unter dem zweizeiligen
Kopf außerhalb eines Einsatzes. Der Rest bis „Abmelden“ MUST im Menü durch Rollen erreichbar
sein.

#### Scenario: Komfortabel am Handy
- **WHEN** das Benutzermenü bei 390 × 844 in `komfortabel` geöffnet wird
- **THEN** liegen alle Einträge bis „Abmelden“ im Fenster

#### Scenario: Helligkeit im Handschuh-Betrieb in einer Zeile
- **WHEN** das Benutzermenü in `handschuh` bei 390 × 844 oder bei 1024 × 768 geöffnet wird
- **THEN** stehen die fünf Stufen der Leiste „Helligkeit“ in einer Zeile, ohne sich zu überlappen und ohne über die Leiste hinauszuragen
- **AND** benachbarte Stufen stehen mindestens 16 px auseinander, jede ist 72 px hoch

#### Scenario: Handschuh am Handy
- **WHEN** das Benutzermenü bei 390 × 844 in `handschuh` geöffnet wird
- **THEN** liegen „Profil“ und alle drei Leisten der Gruppe „Anzeige“ ohne Rollen im Fenster
- **AND** „Abmelden“ ist durch Rollen im Menü erreichbar und meldet nach der Rückfrage ab

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

### Requirement: Abmelden fragt zurück

Die Wahl von „Abmelden“ SHALL die Sitzung nicht sofort beenden, sondern eine Rückfrage öffnen.
Ihr Bestätigungsknopf MUST „Abmelden“ heißen und rot stehen, der andere „Abbrechen“. Erst die
Bestätigung beendet die Sitzung und führt zur Anmeldung. „Abbrechen“, Escape und der
Schließknopf MUST die Sitzung und die aktuelle Seite unverändert lassen.

#### Scenario: Abmelden bestätigt
- **WHEN** im Benutzermenü „Abmelden“ gewählt und in der Rückfrage „Abmelden“ bestätigt wird
- **THEN** endet die Sitzung, und die App zeigt die Anmeldung

#### Scenario: Abmelden abgebrochen
- **WHEN** im Benutzermenü „Abmelden“ gewählt und in der Rückfrage „Abbrechen“ gewählt wird
- **THEN** bleibt die Person angemeldet und auf derselben Seite

#### Scenario: Sitzung gehört inzwischen jemand anderem
- **WHEN** die Rückfrage bestätigt wird, die Sitzung des Tabs aber inzwischen einem anderen Benutzer gehört
- **THEN** bleibt der Tab stehen und zeigt den Benutzerkonflikt, wie beim Abmelden ohne Rückfrage bisher

### Requirement: Anzeige auch in den Einsatz-Einstellungen und im Profil

Darstellung, Bediendichte und Helligkeit SHALL außer im Benutzermenü an zwei weiteren Orten mit
denselben drei Leisten wählbar sein: im Reiter „Anzeige“ der Einsatz-Einstellungen und im Profil,
Paneel „Darstellung auf diesem Gerät“. Beide Orte MUST sagen, dass die Wahl nur für dieses Gerät
gilt. Eine Wahl MUST sofort wirken und an allen drei Orten denselben Wert zeigen.

#### Scenario: Reiter Anzeige in den Einsatz-Einstellungen
- **WHEN** eine Person die Einsatz-Einstellungen öffnet
- **THEN** steht ein Reiter „Anzeige“ als letzter Reiter, und die erste Sektion bleibt „Allgemein“

#### Scenario: Wahl in den Einsatz-Einstellungen wirkt überall
- **WHEN** im Reiter „Anzeige“ die Bediendichte „Handschuh“ gewählt und danach das Benutzermenü geöffnet wird
- **THEN** gilt die Dichte `handschuh` sofort, und im Menü ist in „Bediendichte“ „Handschuh“ ausgewählt

#### Scenario: Ohne Recht und im abgeschlossenen Einsatz
- **WHEN** ein Beobachter den Reiter „Anzeige“ eines abgeschlossenen Einsatzes öffnet
- **THEN** sind alle drei Leisten bedienbar, und der Reiter zeigt keinen Rechte- oder Abschlusshinweis

#### Scenario: Im Profil
- **WHEN** eine Person außerhalb eines Einsatzes ihr Profil öffnet
- **THEN** trägt das Paneel „Darstellung auf diesem Gerät“ die Leisten „Darstellung“, „Bediendichte“ und „Helligkeit“ mit dem aktiven Wert ausgewählt
