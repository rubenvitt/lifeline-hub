## ADDED Requirements

### Requirement: Ein Rail-Sprung achtet die gemerkte Panel-Wahl

Hat eine Person das Modulpanel zugeklappt, MUST es nach einem Klick auf eine andere Kategorie der
Rail zugeklappt bleiben. Ohne gemerkte Wahl SHALL ein solcher Klick das Panel für die laufende
Sitzung öffnen.

#### Scenario: Zugeklappt bleibt zu

- **WHEN** eine Person bei 1440 px das Modulpanel mit „Menü“ zuklappt und dann in der Rail auf
  eine andere Kategorie klickt
- **THEN** wechselt die Seite in ein Modul dieser Kategorie, und das Modulpanel bleibt zugeklappt

#### Scenario: Tablet quer ohne Wahl

- **WHEN** eine Person bei 1180 px ohne gemerkte Wahl in der Rail auf eine andere Kategorie klickt
- **THEN** steht das Modulpanel dieser Kategorie offen

### Requirement: Der Rail-Fuß bleibt im Fenster

Ab `lg` MUST der Fuß der Rail („Menü“, „Einst.“) im Fenster stehen, auch wenn über der Kopfleiste
oder zwischen Kopfleiste und Rail eine Zeile im Fluss steht, etwa die Betriebszeile mit dem
Offline-Hinweis.

#### Scenario: Offline am Fükw

- **WHEN** ein Einsatz bei 1366 × 768 oben steht und das Gerät das Netz verliert
- **THEN** liegt die Unterkante von „Einst.“ am oder über dem unteren Fensterrand

### Requirement: Der Navigations-Drawer nutzt die Breite des Handys

Unter `lg` MUST der Navigations-Drawer 360 px breit sein, höchstens aber die Fensterbreite minus
48 px, damit rechts ein Streifen zum Schließen bleibt.

#### Scenario: Handy

- **WHEN** eine Person bei 390 × 844 die Navigation öffnet
- **THEN** ist der Drawer 342 px breit
