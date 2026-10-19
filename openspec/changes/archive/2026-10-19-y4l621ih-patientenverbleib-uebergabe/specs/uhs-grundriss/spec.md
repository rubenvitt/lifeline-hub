# Spec Delta

## ADDED Requirements

### Requirement: Personenzeile in „Noch nicht aufgenommen“ und „Wartebereich“
Jede Zeile der Listen „Noch nicht aufgenommen“ und „Wartebereich“ SHALL Sichtung, Kennung und
Namen in einer eigenen Zeile über die volle Spaltenbreite zeigen. Nebenangabe (Wartezeit bzw.
Zeit seit der Erfassung) und die Aktion „Verbleib“ MUST darunter stehen; das Wort „Verbleib“
bleibt sichtbar. Ziehen und „Person öffnen“ MUST auf der Personenmarke bleiben, und jedes
Bedienziel MUST die Steuerhöhe der Stufe halten.

#### Scenario: Name in der schmalen Spalte
- **WHEN** der Wartebereich in der 240 px breiten Seitenspalte „R-011 · Ernst, Hans-Jürgen“ mit SK III zeigt
- **THEN** steht „R-011 · Ernst, Hans-Jürgen“ ungekürzt in der ersten Zeile, und „Verbleib“ steht darunter

#### Scenario: Handschuh
- **WHEN** die Liste in der Stufe „Handschuh“ angezeigt wird
- **THEN** misst „Verbleib“ mindestens 72 px in der kurzen Achse, und die Personenmarke ebenso

### Requirement: Spalte „Unterwegs“ statt „Auf Transport gebracht“
Die rechte Spalte des Grundrisses SHALL „Unterwegs“ heißen und die aus dieser UHS ausgetretenen
Personen im Eigentransport zeigen: Sichtung, Kennung, Fahrzeug, Ziel, Transportpriorität und die
Dauer seit der Abfahrt. Jede Zeile MUST „Übergabe quittieren“ anbieten, solange Schreibrecht
besteht. Abgeschlossene Patienten MUST NOT in der Spalte stehen. Der Abwurf einer Person auf die
Spalte MUST die Verbleib-Maske mit der Art Transport öffnen.

#### Scenario: Übergabe aus der Spalte
- **WHEN** R-008 im Eigentransport mit „1/83-1“ in „Unterwegs“ steht und jemand „Übergabe quittieren“ speichert
- **THEN** verlässt R-008 die Spalte

#### Scenario: Fremdes Rettungsmittel
- **WHEN** R-004 aus dem Wartebereich mit dem fremden Rettungsmittel „RTW 3/83-2“ abtransportiert wird
- **THEN** verlässt R-004 den Wartebereich und erscheint nicht in „Unterwegs“

### Requirement: Lange unterwegs ist sichtbar
Ab 60 Minuten seit der Abfahrt SHALL eine Zeile der Spalte „Unterwegs“ die Marke „Übergabe offen“
in der Rolle `achtung` tragen, ohne Ton, Toast oder Sperre. Die Marke MUST mit der Zeit erscheinen,
ohne dass neue Daten eintreffen.

#### Scenario: Lange unterwegs
- **WHEN** R-008 seit 65 Minuten unterwegs ist
- **THEN** trägt seine Zeile die Marke „Übergabe offen“
