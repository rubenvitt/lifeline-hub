# koerperschema Specification

## Purpose
Der Baustein „Körperschema“ zeigt die Verletzungen einer Person auf einer Figur und lässt sie per
Tipp markieren. Ein Bild sagt der übernehmenden Stelle schneller als Freitext, wo verletzt ist; die
nummerierte Liste daneben trägt denselben Stand als Text.

## Requirements

### Requirement: Figur nach Geschlecht, Lage unabhängig davon

Das Körperschema SHALL eine Figur in Ansicht vorn und hinten zeigen: männlich bei Geschlecht
männlich, weiblich bei weiblich, neutral bei divers, unbekannt oder ohne Angabe. Regionen und Lage
der Markierungen MUST über alle Figuren gleich normiert sein. Ein Wechsel des Geschlechts MUST
keine Markierung verschieben. Vorn und hinten MUST nebeneinander stehen, wenn die Breite beide
Ansichten samt der Spalte daneben (Wahl der Art bzw. Liste) trägt; sonst MUST eine Umschaltung
zwischen beiden wählen. Beim Markieren MUST die Figur nie unter ihren Maßstab schrumpfen: reicht
die Breite nicht für eine Ansicht, rollt die Figur, und die Trefferzonen behalten ihre Größe.

#### Scenario: Handschuh am Tablet
- **WHEN** das Schema in der Dichte „Handschuh“ bei 1280 × 800 mit Rail und Modulpanel erscheint
- **THEN** steht eine Ansicht mit der Umschaltung vorn / hinten, und die Spalte mit der Wahl der
  Art steht daneben

#### Scenario: Geschlecht nachgetragen
- **WHEN** eine Person mit markiertem „Unterarm links, vorn“ ohne Geschlecht später als weiblich
  erfasst wird
- **THEN** zeigt das Schema die weibliche Figur, und das Sternchen steht an derselben Stelle des
  Unterarms

### Requirement: Markieren mit höchstens zwei Tipps

Im Modus Markieren SHALL ein Tipp auf eine Region die Wahl der Art als große Flächen öffnen. Die
Wahl MUST danach in jeder Dichte ohne Bildlauf im Bild stehen. Ein Tipp auf eine Fläche MUST
speichern und an der Tippstelle ein nummeriertes Sternchen setzen. Die Schwere MUST optional vor
der Wahl der Art wählbar sein, ohne einen zusätzlichen Pflichttipp, sichtbar beschriftet und nur
für die gerade gewählte Region. Ein Tipp auf ein Sternchen MUST „Aufheben“ anbieten, und ein zweiter Tipp hebt auf. Eine Ablehnung des
Servers MUST am Schema stehen bleiben.

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
Hand, Fuß und Hals; ebenso die Trefferfläche eines Sternchens beim Markieren. Die Tastatur MUST
die Regionen in fester Folge durchlaufen, der Fokus MUST an Region und Sternchen sichtbar sein.

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

Im Modus Lesen SHALL das Schema keine Bedienung zeigen. Ohne Schreibrecht MUST das Markieren
fehlen. Ohne Netz MUST das Markieren vorgemerkt werden (Spec `personen-verlauf`), das Aufheben MUST
mit Grund gesperrt sein, weil ein Aufheben keine Erfassungszeit trägt. Im Patientenkopf MUST das
Schema als Liste mit einer kleinen Figur ab `md` stehen. Das volle Schema MUST ein Paneel
„Verletzung markieren“ öffnen.

#### Scenario: Beobachter
- **WHEN** ein Beobachter das Detail einer Person mit zwei Verletzungen öffnet
- **THEN** sieht er Liste und Figur, aber keinen Knopf „Verletzung markieren“

#### Scenario: Ohne Netz am Tablet
- **WHEN** am UHS-Tablet ohne Netz „Unterarm links, vorn“ mit „Fraktur-Verdacht“ markiert wird
- **THEN** steht „Offline vorgemerkt“ am Kopf, und „Aufheben“ ist mit Grund gesperrt
