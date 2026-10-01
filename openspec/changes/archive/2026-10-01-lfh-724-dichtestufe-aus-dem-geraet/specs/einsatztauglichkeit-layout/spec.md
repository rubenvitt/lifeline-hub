# Spec Delta

## MODIFIED Requirements

### Requirement: Trefffläche folgt der Dichtestufe

Die folgenden Bedienziele SHALL in jeder Dichtestufe mindestens die Steuerhöhe der Stufe
erreichen (30 / 48 / 72 px). Menüeinträge in einem aufgeklappten Menü MUST mindestens
`controlHeightSM` erreichen (24 / 48 / 72 px). Ziele ohne Beschriftung (nur Symbol oder ein
Kürzel) MUST diesen Boden auf **beiden** Achsen erreichen. Kartenknöpfe haben den Boden
32 / 48 / 72 px. Für die Ziele der Modul-Prüflisten (ab „Kommunikation“) gilt in `kompakt` der
Boden aus A1 Gate 3 (24 px), in `komfortabel` und `handschuh` die Steuerhöhe; unbeschriftete
Ziele dort tragen die kleine Steuerhöhe (24 / 48 / 72) auf beiden Achsen.

- ETB: Zeilen des Slash-Menüs, Auslöser „Aktionen zu Eintrag N“ und die Einträge seines
  Menüs, dazu Textfeld und Knopf „Erfassen“ der Schnellerfassung, der Entwurfstab und sein
  Schließen-Kreuz.
- Lagekarte: Einträge der Leistenkarte „Verortet“, die fünf Kartenknöpfe
  (Hineinzoomen, Herauszoomen, Nach Norden ausrichten, Messen, Zeichenwerkzeuge) und die
  Knöpfe der ausgeklappten Zeitachse, einschließlich „Abspielen“.
- Gefahrenmatrix: alle 58 Zell-Auslöser und die Gebietszeilen.
- Kommunikation (Meldungen, Erinnerungen, Nachforderungen, Aufträge und Befehle, Chat): die
  Primäraktion des Seitenkopfs, die Aktionsknöpfe und Auswahlfelder jeder Karte, auf der Seite
  Aufträge die Tabs „Aufträge“ und „Befehle“ und der Kopf „Befehlsdetails“, der Link einer
  Befehlskarte, im Chat Eingabefeld und Senden-Knopf.
- Einsatz-Einstellungen: die Sektionswahl, Auswahl- und Zahlfelder, der Speichern-Knopf und die
  Modulzeilen (Schalter, Rollenauswahl). Einsatzdaten: die Bearbeiten-Knöpfe und der
  Akkordeon-Kopf „Technische Angaben“. Profil: „Passwort ändern“ und „2FA einrichten“. Die
  Verwaltungsseite „Anzeige“: Auswahlfelder und Speichern-Knopf.
- Verwaltung: die Zeilenknöpfe der Fahrzeug-Katalogseite; Text-, Auswahl- und Zahlfelder und der
  Speichern-Knopf der Fahrzeug-Detailseite; die Rollenauswahl der Modulzeilen und der
  Speichern-Knopf der Seite „Einsatz-Vorgaben“.
- Einsatzabschnitte: die Baumknoten, ihre Aufklapper und die Aktionen der Detailkarte.
  Bereitstellungsraum: der Raumwechsler und die Knöpfe „zuweisen“ der Leiste „Kräfte ohne BR“.
- Lagebericht: die Abschnittsköpfe des Akkordeons und die Kopfaktionen der Detailseite, „Neuer
  Bericht“ und der Link einer Berichtskarte, die Filtersegmente und das Suchfeld der Seite
  „Lagemeldungen“.

Nicht Teil dieser Zusicherung sind die Brotkrume im Seitenkopf, Kennungs-Links in
Tabellenzellen, beschriftete Checkboxen und das Löschkreuz eines Auswahlfelds (das Feld selbst
ist das gleichwertige Ziel).

#### Scenario: Handschuh-Betrieb
- **WHEN** die Dichtestufe `handschuh` gewählt ist und die Seite neu geladen wurde
- **THEN** misst jedes genannte Ziel mindestens 72 px in der Höhe und jedes unbeschriftete Ziel zusätzlich mindestens 72 px in der Breite

#### Scenario: Die Stufe schlägt tatsächlich durch
- **WHEN** dieselben Ziele in `kompakt` gemessen werden
- **THEN** ist ihre Höhe kleiner als in `handschuh` (ausgenommen das mehrzeilige Textfeld der Schnellerfassung, dessen Höhe der Inhalt bestimmt), und keine Matrixzelle ist in `kompakt` 48 px oder breiter

#### Scenario: Abspielknopf der Zeitachse
- **WHEN** die Zeitachse der Lagekarte auf dem Handschirm ausgeklappt ist
- **THEN** ist der Knopf „Abspielen“ in jeder Stufe mindestens so breit wie hoch

#### Scenario: Nur-Lese-Zweig im Handschuh-Betrieb
- **WHEN** eine Person ohne Schreibrecht (Beobachter bzw. Führungskraft in der Verwaltung) eine der neu genannten Flächen in `handschuh` öffnet
- **THEN** steht der Rechtehinweis, wo die Seite einen trägt, und die Aktion ist gesperrt oder abwesend
- **AND** misst jedes verbleibende genannte Ziel mindestens 72 px in der Höhe
