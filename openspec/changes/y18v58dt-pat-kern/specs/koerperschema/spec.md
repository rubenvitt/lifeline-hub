## Purpose

Der Baustein „Körperschema“ zeigt die Verletzungen einer Person auf einer Figur und lässt sie per
Tipp markieren. Ein Bild sagt der übernehmenden Stelle schneller als Freitext, wo verletzt ist; die
nummerierte Liste daneben trägt denselben Stand als Text.

## ADDED Requirements

### Requirement: Figur nach Geschlecht, Lage unabhängig davon

Das Körperschema SHALL eine Figur in Ansicht vorn und hinten zeigen: männlich bei Geschlecht
männlich, weiblich bei weiblich, neutral bei divers, unbekannt oder ohne Angabe. Regionen und Lage
der Markierungen MUST über alle Figuren gleich normiert sein. Ein Wechsel des Geschlechts MUST
keine Markierung verschieben. Ab `md` MUST vorn und hinten nebeneinander stehen, darunter MUST
eine Umschaltung zwischen beiden wählen.

#### Scenario: Geschlecht nachgetragen
- **WHEN** eine Person mit markiertem „Unterarm links, vorn“ ohne Geschlecht später als weiblich
  erfasst wird
- **THEN** zeigt das Schema die weibliche Figur, und das Sternchen steht an derselben Stelle des
  Unterarms

### Requirement: Markieren mit höchstens zwei Tipps

Im Modus Markieren SHALL ein Tipp auf eine Region die Wahl der Art als große Flächen öffnen. Ein
Tipp auf eine Fläche MUST speichern und an der Tippstelle ein nummeriertes Sternchen setzen. Die
Schwere MUST optional nachwählbar sein, ohne einen zusätzlichen Pflichttipp. Ein Tipp auf ein
Sternchen MUST „Aufheben“ anbieten, und ein zweiter Tipp hebt auf. Eine Ablehnung des Servers MUST
am Schema stehen bleiben.

#### Scenario: Wunde am Kopf
- **WHEN** jemand im Markieren-Modus auf den Kopf tippt und „Wunde/Blutung“ wählt
- **THEN** steht am Kopf ein Sternchen mit der nächsten Nummer, und die Liste nennt
  „Kopf, vorn · Wunde/Blutung · Uhrzeit“

#### Scenario: Aufheben
- **WHEN** jemand auf das Sternchen 2 tippt und „Aufheben“ wählt
- **THEN** verschwindet Sternchen 2 aus der Figur, die übrigen behalten ihre Nummern

### Requirement: Jede Region ist erreichbar

Jede Region SHALL mit Maus, Touch und Tastatur erreichbar sein. Ihr zugänglicher Name MUST Region,
Seite und Ansicht nennen, etwa „Unterarm links, vorn“. Die Trefferfläche MUST in jeder Dichte
mindestens die Höhe eines Bedienelements haben, in der Handschuh-Stufe mindestens 72 px, auch für
Hand, Fuß und Hals. Die Tastatur MUST die Regionen in fester Folge durchlaufen.

#### Scenario: Hand im Handschuh-Betrieb
- **WHEN** das Schema in der Dichte „Handschuh“ erscheint
- **THEN** ist die Trefferfläche der Hand links mindestens 72 × 72 px groß

### Requirement: Liste als zweiter Kanal

Neben der Figur SHALL eine nummerierte Liste stehen: Nummer, Region mit Seite und Ansicht, Art,
Schwere falls angegeben und Uhrzeit. Die Nummer MUST fest nach Erfassungsfolge vergeben sein und
nach einem Aufheben nicht neu zählen. Sternchen und Liste MUST denselben Stand zeigen. Die Sternchen
MUST in der Textfarbe stehen, mit Nummer, nicht in der Alarmfarbe.

#### Scenario: Nach dem Speichern
- **WHEN** eine Verletzung gespeichert ist
- **THEN** tragen Sternchen und Listeneintrag dieselbe Nummer

### Requirement: Lesen und gesperrt

Im Modus Lesen SHALL das Schema keine Bedienung zeigen. Ohne Schreibrecht und ohne Netz MUST das
Markieren fehlen bzw. mit Grund gesperrt sein. Im Patientenkopf MUST das Schema als Liste mit einer
kleinen Figur ab `md` stehen. Das volle Schema MUST ein Paneel „Verletzung markieren“ öffnen.

#### Scenario: Beobachter
- **WHEN** ein Beobachter das Detail einer Person mit zwei Verletzungen öffnet
- **THEN** sieht er Liste und Figur, aber keinen Knopf „Verletzung markieren“
