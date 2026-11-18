# Spec Delta

## RENAMED Requirements

- FROM: `### Requirement: Der Seitenkopf bündelt Nebenwege unter md`
- TO: `### Requirement: Der Seitenkopf bündelt Nebenwege unter md und ab Stufe 48`

## MODIFIED Requirements

### Requirement: Der Seitenkopf bündelt Nebenwege unter md und ab Stufe 48

Seiten, deren Kopf Nebenwege trägt (Drucken, CSV-Export, Listenzugriffe und Vergleichbares, das
öffnet statt zu erfassen), MUST diese unter `md` (schmaler als 768 px) und in den Stufen
`komfortabel` und `handschuh` in jeder Breite hinter einem einzigen Auslöser „Weitere“ im
Seitenkopf bündeln. Sichtbar bleiben dann die Segmentleiste der Seite, genau eine Erfassung und,
auf Betroffenen- und Tiere-Liste, „Vermisst melden“. In `kompakt` ab `md` MUST jeder Nebenweg als
eigener sekundärer Knopf im Kopf stehen. Der Kopf MUST in jeder Breite höchstens eine Primäraktion
tragen. Der Auslöser MUST einen zugänglichen Namen tragen, der die Seite nennt, und MUST fehlen,
wenn die Seite keinen Nebenweg hat.

#### Scenario: Betroffenenliste auf dem Handschirm
- **WHEN** die Betroffenenliste bei 390 × 844 mit Schreibrecht geöffnet ist
- **THEN** stehen im Seitenkopf ein Erfassungsknopf, „Vermisst melden“, der Knopf „Filter“ und der Auslöser „Weitere“, und weder „Drucken / als PDF“ noch „CSV exportieren“ steht als Knopf im Kopf

#### Scenario: Nebenwege im Menü
- **WHEN** auf dem Handschirm der Auslöser „Weitere“ der Betroffenenliste geöffnet wird
- **THEN** enthält das Menü „Drucken / als PDF“ und „CSV exportieren“, und die Wahl löst denselben Weg aus wie der Knopf in `kompakt` ab `md`

#### Scenario: Ab md unverändert erreichbar
- **WHEN** die Betroffenenliste bei 1180 px Breite in `kompakt` geöffnet ist
- **THEN** stehen „Drucken / als PDF“ und „CSV exportieren“ als Knöpfe im Kopf, und es gibt keinen Auslöser „Weitere“

#### Scenario: Stufe 48 und 72 am Tablet
- **WHEN** die Betroffenenliste bei 1180 × 820 in `komfortabel` oder in `handschuh` geöffnet ist
- **THEN** stehen „Drucken / als PDF“, „CSV exportieren“ und „Versorgt und entlassen“ nur im Menü „Weitere“, und der Erfassungsknopf und „Vermisst melden“ stehen als Knöpfe im Kopf

#### Scenario: Meldebild
- **WHEN** das Meldebild bei 1440 × 900 in `kompakt` geöffnet ist
- **THEN** stehen „Drucken“ und „In Lagebericht übernehmen“ als sekundäre Knöpfe im Seitenkopf und nicht in der Werkzeugzeile über der Tabelle

## ADDED Requirements

### Requirement: Die Stärke steht im Seitenkopf der Kräfteseiten

Auf Fahrzeuge, Personal und Einheiten SHALL die Stärke samt Fahrzeugverfügbarkeit und Sprung ins
Meldebild im Seitenkopf neben dem Titel stehen, nicht als eigene Zeile über der Liste. Dieselbe
Aufteilung der Fahrzeuge (verfügbar, gebunden, nicht verfügbar) MUST auf einer Seite höchstens
einmal stehen. Der Kopf MUST beim Laden seine Zeilenzahl halten.

#### Scenario: Fahrzeuge ohne Doppel
- **WHEN** die Fahrzeugliste mit Fahrzeugen in mehreren Status bei 1440 × 900 geöffnet ist
- **THEN** steht „Stärke …“ mit „n verfügbar · n gebunden · n nicht verfügbar“ im Seitenkopf, und über der Tabelle steht keine zweite Zeile mit derselben Aufteilung

#### Scenario: Personal und Einheiten
- **WHEN** Personal oder Einheiten bei 1440 × 900 geöffnet sind
- **THEN** steht die Stärke im Seitenkopf, gleich der Summe der Wurzeln im Kräftebaum, und zwischen Seitenkopf und Liste steht keine Stärkezeile

### Requirement: Kennzahlenbänder über Listen lassen sich einklappen

Das Statusband des Meldebilds und die Kennzahlen der Unterbringung auf der Betreuungsseite SHALL
einen Klappkopf tragen. Ohne gemerkte Wahl MUST das Band offen stehen. Eingeklappt MUST eine Zeile
mit den Zahlen in Kurzform stehen bleiben. Die Wahl MUST je Seite auf dem Gerät erhalten bleiben
und ohne Browserspeicher für die Sitzung gelten. Die Sichtungszeile der Betroffenenliste MUST
nicht einklappbar sein.

#### Scenario: Einklappen und neu laden
- **WHEN** das Statusband des Meldebilds eingeklappt und die Seite danach neu geladen wird
- **THEN** steht das Band weiter eingeklappt als eine Zeile mit den Zahlen je Status, und die Tabelle beginnt höher als mit offenem Band

#### Scenario: Erstes Öffnen
- **WHEN** die Betreuungsseite auf einem Gerät ohne gemerkte Wahl geöffnet wird
- **THEN** stehen die Kennzahlen der Unterbringung offen

#### Scenario: Klappkopf im Handschuh-Betrieb
- **WHEN** das Meldebild in `handschuh` geöffnet ist
- **THEN** misst der Klappkopf des Statusbands mindestens 72 px in der Höhe

### Requirement: Filter und Ansichtswahl am Handschirm hinter einem Knopf

Unter `md` SHALL eine Listenseite ihre Ansichtswahl und Filter (Status, Abgeschlossene zeigen und
Vergleichbares) hinter einem Knopf „Filter“ im Seitenkopf tragen, der die Zahl der von der Vorgabe
abweichenden Wahlen nennt („Filter (2)“). Der Knopf MUST die Wahl unter dem Seitenkopf aufklappen
und wieder zuklappen. Ab `md` MUST die Wahl ohne Knopf sichtbar stehen. Betroffen sind
Betroffene und Fahrzeuge.

#### Scenario: Betroffene am Handy
- **WHEN** die Betroffenenliste bei 390 × 844 geöffnet ist und „Abgeschlossene zeigen“ gewählt wurde
- **THEN** steht im Seitenkopf „Filter (1)“, Ansicht-Segmentleiste und Statusfilter stehen erst nach dem Antippen im Bild, und eine Änderung dort wirkt sofort auf die Liste

#### Scenario: Tablet unverändert
- **WHEN** die Fahrzeugliste bei 820 × 1180 geöffnet ist
- **THEN** steht die Ansicht-Segmentleiste im Seitenkopf, und es gibt keinen Knopf „Filter“

### Requirement: Die erste Datenzeile steht oben im Fenster

Beim Öffnen einer Listenseite ohne Bildlauf MUST die erste Datenzeile vollständig im Fenster
stehen, in jeder Dichtestufe, als Admin und als Beobachter. Am Handschirm MUST ihre Oberkante auf
Fahrzeuge, Personal, Einheiten und Betreuung und, ohne Schreibrecht, auf der Betroffenenliste
höchstens bei y = 350 liegen, auf der Betreuung mit eingeklappten Kennzahlen.

#### Scenario: Handschuh am Tablet
- **WHEN** Betroffene, Meldebild, Fahrzeuge, Personal und Einheiten bei 1180 × 820 in `handschuh` als Admin geöffnet werden
- **THEN** liegt die erste Datenzeile jeder Seite vollständig im Fenster

#### Scenario: Handschirm
- **WHEN** Fahrzeuge, die Betreuung mit eingeklappten Kennzahlen und als Beobachter die Betroffenenliste bei 390 × 844 in `kompakt` geöffnet werden
- **THEN** liegt die Oberkante der ersten Datenzeile höchstens bei y = 350
