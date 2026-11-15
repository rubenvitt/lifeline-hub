## MODIFIED Requirements

### Requirement: Der Rahmen bleibt beim Rollen erreichbar

Die Kopfleiste MUST in jeder Breite beim Rollen am oberen Fensterrand stehen bleiben, ab `lg`
auch die Kategorie-Symbole der Rail. Unter `md` MUST die Kopfleiste im Einsatz einzeilig sein
und Menü, Einsatzname, Alarmzentrale, Verbindung und Uhr tragen; nur in `handschuh` darf eine
Störung im Wort der Alarmzentrale sie umbrechen. Meldet die Betriebszeile unter
`md` eine Verbindungsstörung, MUST sie über der Kopfleiste stehen bleiben. Jedes oben klebende
Element MUST unter dem klebenden Rahmen stehen, nicht hinter ihm.

#### Scenario: Langes Rollen im ETB ab Tablet
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste mit `position: sticky` bei `top ≥ 0` im Fenster, und ab 1180 px stehen die Kategorie-Symbole der Rail im Fenster

#### Scenario: Langes Rollen im ETB am Handy
- **WHEN** das ETB bei 390 × 844 in `kompakt`, `komfortabel` und `handschuh` bei ruhiger Alarmzentrale auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig am oberen Fensterrand, und Menü, Einsatzname, Alarmzentrale, Verbindung und Uhr liegen ganz im Fenster

#### Scenario: Gestörte Alarmzentrale am Handy
- **WHEN** der Ton am Handy blockiert ist
- **THEN** nennt die Alarmzentrale „Ton blockiert“ im Kopf, in `kompakt` und `komfortabel` bleibt die Kopfleiste einzeilig, und der Einsatzname behält seine Mindest-Trefffläche

#### Scenario: Offline auf dem Handy
- **WHEN** das ETB bei 390 × 844 auf 1500 px gerollt ist und das Gerät das Netz verliert
- **THEN** steht die Betriebszeile mit dem Offline-Hinweis am oberen Fensterrand und die Kopfleiste direkt darunter, keine verdeckt die andere

#### Scenario: Einsatzliste am Handy
- **WHEN** die Einsatzliste bei 390 × 844 in `kompakt` und `komfortabel` auf 1000 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig mit der Uhr am oberen Fensterrand

#### Scenario: Tabellenkopf unter dem Rahmen
- **WHEN** eine Seite mit stehendem Tabellenkopf in irgendeiner Breite so weit gerollt ist, dass der Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante der Kopfleiste, nicht darüber

## ADDED Requirements

### Requirement: Suche und Benutzermenü am Handy in der Navigation

Unter `md` SHALL der Kopf im Einsatz weder das Suchfeld der Sprungpalette noch den Auslöser des
Benutzermenüs tragen. Beide MUST in der Navigation stehen, die der Knopf „Menü“ öffnet: „Suchen“
oben, es öffnet die Sprungpalette; der Auslöser des Benutzermenüs unten, mit unverändertem Menü.
Ab `md` SHALL beides im Kopf bleiben.

#### Scenario: Suchen am Handy
- **WHEN** eine Person im Einsatz bei 390 × 844 die Navigation öffnet und „Suchen“ antippt
- **THEN** schließt die Navigation, und die Sprungpalette ist offen

#### Scenario: Benutzermenü am Handy
- **WHEN** eine Person im Einsatz bei 390 × 844 die Navigation öffnet und den Auslöser des Benutzermenüs antippt
- **THEN** öffnet das Benutzermenü mit denselben Einträgen wie ab `md`, bis einschließlich „Abmelden“

#### Scenario: Ab Tablet unverändert
- **WHEN** ein Einsatz bei 820 px Breite geöffnet ist
- **THEN** stehen Suche und Benutzermenü im Kopf
