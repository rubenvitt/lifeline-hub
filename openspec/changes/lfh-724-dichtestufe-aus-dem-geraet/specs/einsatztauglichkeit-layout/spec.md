# Spec Delta

## MODIFIED Requirements

### Requirement: Trefffläche folgt der Dichtestufe

Die folgenden Bedienziele SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Menüeinträge in einem aufgeklappten Menü MUST mindestens
`controlHeightSM` erreichen (24 / 48 / 72 px). Ziele ohne Beschriftung (nur Symbol oder ein
Kürzel) MUST diesen Boden auf **beiden** Achsen erreichen. Kartenknöpfe haben den Boden
32 / 48 / 72 px.

- ETB: Zeilen des Slash-Menüs, Auslöser „Aktionen zu Eintrag N“ und die Einträge seines
  Menüs, dazu Textfeld und Senden-Knopf der Schnellerfassung.
- Lagekarte: Einträge der Leistenkarte „Verortet“, die fünf Kartenknöpfe
  (Hineinzoomen, Herauszoomen, Nach Norden ausrichten, Messen, Zeichenwerkzeuge) und die
  Knöpfe der ausgeklappten Zeitachse, einschließlich „Abspielen“.
- Gefahrenmatrix: alle 58 Zell-Auslöser und die Gebietszeilen.
- Kommunikation (Meldungen, Erinnerungen, Nachforderungen, Aufträge und Befehle, Chat): die
  Primäraktion des Seitenkopfs, die Aktionsknöpfe jeder Karte und im Chat Eingabefeld und
  Senden-Knopf.
- Einsatz-Einstellungen und Einsatzdaten: Formularfelder, Speichern-Knopf und Modulzeilen.
  Profil und die Verwaltungsseite „Anzeige“: Formularfelder und Speichern-Knopf.
- Verwaltung: die Zeilenknöpfe der Fahrzeug-Katalogseite, Formularfelder und Speichern-Knopf
  der Fahrzeug-Detailseite, die Modulzeilen der Seite „Einsatz-Vorgaben“.
- Einsatzabschnitte: die Aktionen eines Baumknotens und der Detailkarte. Bereitstellungsraum:
  die Knöpfe „zuweisen“ der Leiste „Kräfte ohne BR“, der Raumwechsler und die Aktionen der
  Belegungsliste.
- Lagebericht: die Abschnittsköpfe des Akkordeons und seine Formularfelder auf der
  Detailseite, die Karten der Berichtsliste und die Aktionen der Seite „Lagemeldungen“.

#### Scenario: Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und die Seite neu geladen wurde
- **THEN** misst jedes genannte Ziel mindestens 72 px in der Höhe und jedes unbeschriftete Ziel zusätzlich mindestens 72 px in der Breite

#### Scenario: Die Stufe schlägt tatsächlich durch
- **WHEN** dieselben Ziele in `kompakt` gemessen werden
- **THEN** ist ihre Höhe kleiner als in `handschuh`, und keine Matrixzelle ist in `kompakt` 48 px oder breiter

#### Scenario: Abspielknopf der Zeitachse
- **WHEN** die Zeitachse der Lagekarte auf dem Handschirm ausgeklappt ist
- **THEN** ist der Knopf „Abspielen“ in jeder Stufe mindestens so breit wie hoch

#### Scenario: Nur-Lese-Zweig im Handschuh-Betrieb
- **WHEN** eine Person ohne Schreibrecht (Beobachter bzw. Führungskraft in der Verwaltung) eine der neu genannten Flächen in `handschuh` öffnet
- **THEN** steht der Rechtehinweis bzw. ist die Aktion gesperrt oder abwesend
- **AND** misst jedes verbleibende genannte Ziel mindestens 72 px in der Höhe
