## MODIFIED Requirements

### Requirement: Der Rahmen bleibt beim Rollen erreichbar

Die Kopfleiste MUST in jeder Breite beim Rollen am oberen Fensterrand stehen bleiben, ab `lg`
auch die Kategorie-Symbole der Rail und das offene Modulpanel samt Fuß „Einsatzdauer“. Unter `md`
MUST die Kopfleiste im Einsatz einzeilig sein und Menü, Einsatzname, Alarmzentrale, Verbindung
und Uhr tragen; nur in `handschuh` darf eine Störung im Wort der Alarmzentrale sie umbrechen.
Meldet die Betriebszeile unter `md` eine Verbindungsstörung, MUST sie über der Kopfleiste stehen
bleiben. Ab `md` MUST der Seitenkopf einer Einsatz- oder Verwaltungsseite unter der Kopfleiste
stehen bleiben, solange Kopfleiste und Seitenkopf zusammen höchstens ein Drittel der Fensterhöhe
nehmen; sonst rollt er mit. Im ETB kleben Seitenkopf, Filterleiste und Spaltenkopf nur gemeinsam,
solange alle drei mit der Kopfleiste in dieses Drittel passen (Spec `etb-filterleiste`). Jedes
oben klebende Element MUST unter dem klebenden Rahmen stehen, nicht hinter ihm; im Inhalt zählt
ein klebender Seitenkopf zum Rahmen.

#### Scenario: Langes Rollen im ETB ab Tablet
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste mit `position: sticky` bei `top ≥ 0` im Fenster, und ab 1180 px stehen die Kategorie-Symbole der Rail im Fenster

#### Scenario: Langes Rollen im ETB am Handy
- **WHEN** das ETB bei 390 × 844 in `kompakt`, `komfortabel` und `handschuh` bei ruhiger Alarmzentrale auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig am oberen Fensterrand, und Menü, Einsatzname, Alarmzentrale, Verbindung und Uhr liegen ganz im Fenster

#### Scenario: Gestörte Alarmzentrale am Handy
- **WHEN** der Ton am Handy blockiert ist
- **THEN** nennt die Alarmzentrale „Ton blockiert“ im Kopf, in `kompakt` und `komfortabel` bleibt die Kopfleiste einzeilig, und der Einsatzname behält seine Mindest-Trefffläche

#### Scenario: Einsatzliste am Handy
- **WHEN** die Einsatzliste bei 390 × 844 in `kompakt` und `komfortabel` auf 1000 px gerollt ist
- **THEN** steht die Kopfleiste einzeilig mit der Uhr am oberen Fensterrand

#### Scenario: Modulpanel bleibt beim Rollen stehen
- **WHEN** das ETB bei 1440 × 900 mit offenem Modulpanel geöffnet wird und damit ans Ende der Zeitachse gerollt ist
- **THEN** stehen Kopf des Modulpanels, alle Moduleinträge der Kategorie und der Fuß „Einsatzdauer“ im Fenster unter der Kopfleiste, und ein Klick auf einen Moduleintrag wechselt das Modul, ohne vorher zu rollen

#### Scenario: Modulpanel länger als das Fenster
- **WHEN** das Modulpanel bei 1366 × 520 im Handschuh-Betrieb mehr Einträge hat, als unter der Kopfleiste Platz finden, und die Seite gerollt ist
- **THEN** rollt das Panel in sich, sein Kopf steht im Fenster, und jeder Eintrag sowie der Fuß „Einsatzdauer“ sind per Wischen oder Tab erreichbar, ohne dass ein Teil des Panels einen anderen verdeckt

#### Scenario: Seitenkopf bleibt auf langen Seiten stehen
- **WHEN** das ETB, das Modul „Personal“, die Einstellungen des Einsatzes oder eine Verwaltungsseite bei 1180 × 820 oder 1440 × 900 bis ans Ende gerollt ist
- **THEN** steht der Seitenkopf mit Titel und Seitenaktionen direkt unter der Kopfleiste im Fenster, und seine Aktionen lassen sich ohne Rollen bedienen

#### Scenario: Niedriges Fenster
- **WHEN** eine Einsatzseite bei 1366 × 520 im Handschuh-Betrieb gerollt ist und Kopfleiste und Seitenkopf zusammen mehr als ein Drittel der Fensterhöhe nähmen
- **THEN** rollt der Seitenkopf mit dem Inhalt, und die Kopfleiste bleibt stehen wie bisher

#### Scenario: Offline auf dem Handy
- **WHEN** das ETB bei 390 × 844 auf 1500 px gerollt ist und das Gerät das Netz verliert
- **THEN** steht die Betriebszeile mit dem Offline-Hinweis am oberen Fensterrand und die Kopfleiste direkt darunter, keine verdeckt die andere

#### Scenario: Tabellenkopf unter dem Rahmen
- **WHEN** eine Seite mit stehendem Tabellenkopf in irgendeiner Breite so weit gerollt ist, dass der Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante des klebenden Seitenkopfs, oder an der Unterkante der Kopfleiste, wenn der Seitenkopf mitrollt, nicht darüber

#### Scenario: Niedriges Fenster im ETB
- **WHEN** das ETB gerollt ist und Kopfleiste und Seitenkopf zwar ins Drittel der Fensterhöhe passen, mit Filterleiste und Spaltenkopf aber nicht mehr
- **THEN** rollen Seitenkopf, Filterleiste und Spaltenkopf gemeinsam mit, und die Kopfleiste bleibt stehen

#### Scenario: Fokus unter dem klebenden Seitenkopf
- **WHEN** der Fokus auf einer gerollten Seite mit klebendem Seitenkopf bei 1440 × 900 mit Shift+Tab rückwärts durch die Ziele des Inhalts läuft
- **THEN** liegt jedes fokussierte Ziel ganz unter dem Seitenkopf, nicht dahinter, und ein Fokus in den Seitenaktionen rollt die Seite nicht

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
