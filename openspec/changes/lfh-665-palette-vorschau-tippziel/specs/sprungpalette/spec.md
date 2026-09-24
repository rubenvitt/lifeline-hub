# Spec Delta

## MODIFIED Requirements

### Requirement: Fußzeile und Zeilenmarke kündigen die Wege an
Die Fußzeile der Palette SHALL den Hinweis für den neuen Tab tragen (macOS: `⌘↵`, sonst
`Strg+↵`). Innerhalb eines Einsatzes SHALL sie zusätzlich den Hinweis `→ Vorschau` tragen.
Jede Zeile mit Vorschau MUST das Vorschau-Ziel zeigen, auch wenn sie nicht markiert ist; es
ist die Zeilenmarke für die Vorschau und tritt an die Stelle der `→`-Marke aus LFH-645. Wo
LFH-664 von der →-Marke einer markierten Zeile spricht, ist dieses Ziel gemeint. Neben dem
Ziel MUST keine zweite →-Marke stehen. Die Fußzeile MUST für ⇧↵ keinen Hinweis tragen.
Solange die Vorschau offen ist, MUST die Fußzeile die dort gültigen Wege nennen: öffnen,
neuer Tab und zurück.

#### Scenario: Marke an der Personenzeile
- **WHEN** die Trefferliste eine Person und ein Modul zeigt
- **THEN** trägt die Personenzeile das Vorschau-Ziel, markiert oder nicht, und die Modulzeile trägt keins

#### Scenario: Kein zweiter Pfeil
- **WHEN** eine Zeile mit Vorschau markiert ist
- **THEN** steht in ihr neben dem Vorschau-Ziel keine →-Marke

#### Scenario: Kein Vorschauhinweis außerhalb eines Einsatzes
- **WHEN** die Palette auf der Einsatzauswahl geöffnet wird
- **THEN** nennt die Fußzeile den neuen Tab, aber keine Vorschau

## ADDED Requirements

### Requirement: Ein Tippziel öffnet die Vorschau
Ein Tipp oder Klick auf das Vorschau-Ziel einer Zeile SHALL die Vorschau dieser Zeile öffnen
und MUST weder den Datensatz öffnen noch die Palette schließen, auch nicht mit Strg/⌘. Ein
Tipp auf die übrige Zeile SHALL wie bisher den Datensatz öffnen. Das Ziel MUST in Höhe und
Breite den Boden der aktiven Dichtestufe tragen (30/48/72 px), bündig an der rechten
Zeilenkante enden und die volle Zeilenhöhe füllen. Der Fokus MUST dabei im Suchfeld bleiben.
Das Ziel ist für Hilfstechnik verborgen; deren Weg in die Vorschau bleibt →.

#### Scenario: Tipp aufs Ziel auf dem Tablet
- **WHEN** auf dem Führungs-Tablet in der Stufe Handschuh das Vorschau-Ziel einer Person getippt wird
- **THEN** zeigt die Palette deren Vorschau, die Seite darunter bleibt stehen und der Fokus steht im Suchfeld

#### Scenario: Tipp auf die übrige Zeile
- **WHEN** auf dem Führungs-Tablet das Label derselben Zeile getippt wird
- **THEN** öffnet die App die Detailseite der Person und die Palette schließt sich

#### Scenario: Ziel an einer nicht markierten Zeile
- **WHEN** das Vorschau-Ziel einer Zeile getippt wird, die nicht markiert ist
- **THEN** öffnet sich die Vorschau dieser Zeile, ohne dass vorher gezeigt oder gepfeilt werden muss

#### Scenario: Boden in jeder Stufe
- **WHEN** die Palette in den Stufen kompakt, komfortabel und Handschuh geöffnet wird
- **THEN** misst das Vorschau-Ziel in Höhe und Breite mindestens 30, 48 und 72 px und sitzt bündig an der rechten Kante über die volle Höhe der Zeile
