# Spec Delta

## Purpose

Die Ansicht „Sichtungsraster“ der Betroffenenseite als Board mit einer Spalte je
Sichtungskategorie, damit die Führung auf einen Blick sieht, wie viele Patienten welcher
Dringlichkeit wo stehen.

## ADDED Requirements

### Requirement: Eine Spalte je Sichtungskategorie
Das Sichtungsraster SHALL je Kategorie eine Spalte in fester Folge zeigen: SK I, SK II, SK III,
SK IV, tot, unverletzt, ohne Sichtung. Alle Spalten MUST immer stehen, auch leer. Der Kopf MUST
die Kategorie über Farbe UND Wort zeigen und die Zahl der Personen der Spalte tragen. Es MUST
dieselbe Personenmenge gelten wie in der Ansicht „Zeilen“ (Statusfilter, Lücken, Abgeschlossene).

#### Scenario: Leere Kategorie
- **WHEN** das Raster mit zwei Personen in SK II und keiner in SK I geöffnet wird
- **THEN** steht die Spalte „SK I“ mit der Zahl 0 an erster Stelle, und „SK II“ trägt 2

#### Scenario: Gleiche Menge wie die Zeilen
- **WHEN** in den Zeilen der Statusfilter „Betroffen“ gilt und dann „Sichtungsraster“ gewählt wird
- **THEN** zeigt das Board genau die Personen der Zeilen, nach Sichtung verteilt

### Requirement: Karte je Person
Jede Person SHALL als Karte mit Kennung, PAT-Nummer (falls vorhanden), Name (sonst „unbekannt“),
der Zeit seit der Sichtung, dem Aufenthalt und der Transportpriorität erscheinen. Der Aufenthalt
MUST die UHS, den Verbleib (im Eigentransport mit Fahrzeug) oder den Fundort nennen. Innerhalb der
Spalte MUST die am längsten zurückliegende Sichtung oben stehen.

#### Scenario: Patient im Eigentransport
- **WHEN** R-011 in SK III mit Eigentransport „1/83-1“ unterwegs ist
- **THEN** zeigt seine Karte in der Spalte SK III „Eigentransport 1/83-1 → KH Mitte“

#### Scenario: Folge nach Wartezeit
- **WHEN** R-009 vor 20 min und R-008 vor 5 min mit SK II gesichtet wurden
- **THEN** steht R-009 in der Spalte SK II über R-008

### Requirement: Bedienung der Karte
Ein Tipp auf die Karte SHALL die Detailseite der Person öffnen. Die Sichtungsmarke der Karte MUST
die Nachsichtung am Ort öffnen, mit derselben Wahl und demselben Schreibweg wie in der Zeile;
ohne Schreibrecht ist sie keine Bedienung. Jedes Bedienziel MUST die Steuerhöhe der Dichtestufe
halten.

#### Scenario: Umsichten aus dem Board
- **WHEN** jemand auf der Karte von R-004 die Sichtungsmarke antippt, SK I wählt und übernimmt
- **THEN** wandert die Karte in die Spalte SK I, sobald niemand mehr mit dem Board arbeitet

#### Scenario: Ohne Schreibrecht
- **WHEN** ein Benutzer ohne Schreibrecht das Board öffnet
- **THEN** öffnet ein Tipp auf die Karte die Detailseite, und die Sichtungsmarke ist keine Bedienung

### Requirement: Board hält still, solange jemand damit arbeitet
Solange Zeiger oder Fokus im Board sind oder eine Nachsichtung offen ist, SHALL das Board Menge,
Spalte und Folge der Karten halten. Neue Personen MUST bis dahin hinten in ihrer Spalte warten;
danach MUST es neu verteilen.

#### Scenario: Neue Sichtung unter dem Zeiger
- **WHEN** der Zeiger über dem Board steht und eine Person per Live-Update von SK III nach SK II wechselt
- **THEN** bleibt ihre Karte stehen, bis der Zeiger das Board verlässt

### Requirement: Board auf schmalem Schirm
Ab der Breite `lg` SHALL das Board die Spalten nebeneinander zeigen, jede mit eigenem Bildlauf.
Darunter MUST es die Spalten untereinander stapeln, je Spalte einklappbar, leere eingeklappt. Die
Seite MUST nie seitlich scrollen.

#### Scenario: Handy
- **WHEN** das Board auf einem 390 px breiten Schirm geöffnet wird
- **THEN** stehen die Spalten untereinander, leere sind eingeklappt, und die Seite scrollt nicht seitlich
