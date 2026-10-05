## Purpose

Bedienung des Zeitachsen-Bands der Lagekarte: einen gesicherten Lagestand wählen, abspielen und
sichern, und zurück in den Live-Modus, in einem Band, das auch im Handschuh-Betrieb flach bleibt.

## ADDED Requirements

### Requirement: Eine Auswahl wählt den angezeigten Stand

Das ausgeklappte Zeitachsen-Band SHALL den angezeigten Stand in genau einer Auswahl „Stand“ zeigen
und wählen lassen, sobald mindestens ein Stand gesichert ist. Die Auswahl MUST „Live“ und jeden
gesicherten Stand anbieten, die neuesten oben und „Live“ an erster Stelle. Ein Stand erscheint
unter seiner Bezeichnung, ohne Bezeichnung unter seiner Uhrzeit. Eine Wahl MUST eine laufende
Wiedergabe anhalten. Das Band MUST keine eigene Knopfreihe der Stände und keinen eigenen Knopf
„Aktuell“ tragen; der Rückweg in den Live-Modus steht in der Auswahl und im Historien-Banner.

#### Scenario: Stand wählen
- **WHEN** auf der Lagekarte mit den Ständen „Stand A“ und „Stand B“ in der Auswahl „Stand B“ gewählt wird
- **THEN** zeigt die Karte den historischen Stand B, und die Auswahl zeigt „Stand B“

#### Scenario: Zurück in den Live-Modus
- **WHEN** in einem historischen Stand in der Auswahl „Live“ gewählt wird
- **THEN** zeigt die Karte wieder den aktuellen Stand, und das Historien-Banner verschwindet

#### Scenario: Wahl hält die Wiedergabe an
- **WHEN** während einer laufenden Wiedergabe in der Auswahl ein Stand gewählt wird
- **THEN** endet die Wiedergabe, und die Karte bleibt auf dem gewählten Stand

### Requirement: Stand sichern über einen kurzen Dialog

Mit Schreibrecht SHALL das Band einen Knopf „Stand sichern“ tragen. Er MUST einen Dialog öffnen,
der eine optionale Bezeichnung annimmt und den Stand mit „Sichern“ oder Enter sichert. Ohne
Schreibrecht MUST der Knopf fehlen. Das Feld für die Bezeichnung MUST NOT dauerhaft im Band stehen.

#### Scenario: Stand mit Bezeichnung sichern
- **WHEN** eine Person mit Schreibrecht „Stand sichern“ tippt, „08:00 Lage“ eingibt und Enter drückt
- **THEN** ist ein Stand mit der Bezeichnung „08:00 Lage“ gesichert, der Dialog geschlossen, und die Auswahl bietet ihn an

#### Scenario: Beobachter
- **WHEN** eine Person ohne Schreibrecht die Zeitachse ausklappt
- **THEN** fehlt der Knopf „Stand sichern“, und Auswahl und Wiedergabe stehen zur Verfügung

### Requirement: Das Band hat höchstens zwei Reihen

Das ausgeklappte Band SHALL aus zwei Gruppen bestehen: Wiedergabe (Ausblenden, Abspielen,
Schieber) und Stand (Auswahl, Sichern). Jede Gruppe MUST in einer Zeile bleiben; reicht die Breite
nicht für beide, steht die Stand-Gruppe in einer zweiten Zeile. Das gilt in jeder Dichtestufe auf
Handschirm, Führungs-Tablet und Fükw.

#### Scenario: Handschirm im Handschuh-Betrieb
- **WHEN** die Lagekarte bei 390 × 844 in `handschuh` mit ausgeklappter Zeitachse und zwei gesicherten Ständen offen ist
- **THEN** stehen die Bedienziele des Bands in höchstens zwei Reihen

#### Scenario: Fükw
- **WHEN** die Lagekarte bei 1366 × 768 in `kompakt` mit ausgeklappter Zeitachse offen ist
- **THEN** stehen alle Bedienziele des Bands in einer Reihe
