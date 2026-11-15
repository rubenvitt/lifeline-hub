# Spec Delta

## MODIFIED Requirements

### Requirement: Der Rahmen bleibt beim Rollen erreichbar

Ab `md` MUST die Kopfleiste beim Rollen am oberen Fensterrand stehen bleiben, ab `lg` auch die
Kategorie-Symbole der Rail und das offene Modulpanel samt Fuß „Einsatzdauer“. Ab `md` MUST der
Seitenkopf einer Einsatz- oder Verwaltungsseite unter der Kopfleiste stehen bleiben, solange
Kopfleiste und Seitenkopf zusammen höchstens ein Drittel der Fensterhöhe nehmen; sonst rollt er
mit. Unter `md` MUST die Kopfleiste mitrollen und die Betriebszeile oben stehen bleiben, solange
sie eine Verbindungsstörung meldet. Jedes oben klebende Element MUST unter dem klebenden Rahmen
stehen, nicht hinter ihm; im Inhalt zählt ein klebender Seitenkopf zum Rahmen.

#### Scenario: Langes Rollen im ETB ab Tablet
- **WHEN** das ETB bei 820, 1180 und 1440 px Breite auf 1500 px gerollt ist
- **THEN** steht die Kopfleiste mit `position: sticky` bei `top ≥ 0` im Fenster, und ab 1180 px stehen die Kategorie-Symbole der Rail im Fenster

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
- **THEN** steht die Betriebszeile mit dem Offline-Hinweis am oberen Fensterrand

#### Scenario: Tabellenkopf unter dem Rahmen
- **WHEN** eine Seite mit stehendem Tabellenkopf ab `md` so weit gerollt ist, dass der Tabellenkopf klebt
- **THEN** liegt seine Oberkante an der Unterkante des klebenden Seitenkopfs, oder an der Unterkante der Kopfleiste, wenn der Seitenkopf mitrollt, nicht darüber

#### Scenario: Fokus unter dem klebenden Seitenkopf
- **WHEN** der Fokus auf einer gerollten Seite mit klebendem Seitenkopf bei 1440 × 900 mit Shift+Tab rückwärts durch die Ziele des Inhalts läuft
- **THEN** liegt jedes fokussierte Ziel ganz unter dem Seitenkopf, nicht dahinter, und ein Fokus in den Seitenaktionen rollt die Seite nicht
