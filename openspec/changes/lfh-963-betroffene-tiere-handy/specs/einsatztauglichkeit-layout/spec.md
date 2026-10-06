## ADDED Requirements

### Requirement: Der Seitenkopf bündelt Nebenwege unter md

Seiten, deren Kopf Nebenwege trägt (Drucken, CSV-Export, Listenzugriffe und Vergleichbares, das
öffnet statt zu erfassen), MUST diese unter `md` (schmaler als 768 px) hinter einem einzigen
Auslöser „Weitere“ im Seitenkopf bündeln. Sichtbar bleiben unter `md` die Segmentleiste der
Seite, genau eine Erfassung und, auf Betroffenen- und Tiere-Liste, „Vermisst melden“. Ab `md`
MUST jeder Nebenweg als eigener sekundärer Knopf im Kopf stehen. Der Kopf MUST in jeder Breite
höchstens eine Primäraktion tragen. Der Auslöser MUST einen zugänglichen Namen tragen, der die
Seite nennt, und MUST fehlen, wenn die Seite keinen Nebenweg hat.

#### Scenario: Betroffenenliste auf dem Handschirm
- **WHEN** die Betroffenenliste bei 390 × 844 mit Schreibrecht geöffnet ist
- **THEN** stehen im Seitenkopf die Ansicht-Segmentleiste, ein Erfassungsknopf, „Vermisst melden“ und der Auslöser „Weitere“, und weder „Drucken / als PDF“ noch „CSV exportieren“ steht als Knopf im Kopf

#### Scenario: Nebenwege im Menü
- **WHEN** auf dem Handschirm der Auslöser „Weitere“ der Betroffenenliste geöffnet wird
- **THEN** enthält das Menü „Drucken / als PDF“ und „CSV exportieren“, und die Wahl löst denselben Weg aus wie der Knopf ab `md`

#### Scenario: Ab md unverändert erreichbar
- **WHEN** die Betroffenenliste bei 1180 px Breite geöffnet ist
- **THEN** stehen „Drucken / als PDF“ und „CSV exportieren“ als Knöpfe im Kopf, und es gibt keinen Auslöser „Weitere“

### Requirement: Die Betroffenenliste zeigt am Handschirm Lage und erste Person

Auf dem Handschirm (390 × 844) MUST die Betroffenenliste beim Öffnen ohne Bildlauf mindestens eine
Personenzeile und die Sichtungszusammenfassung (Zahl je Sichtungskategorie) vollständig im Fenster
zeigen. Das MUST für eine Rolle mit Schreibrecht und für einen Beobachter ohne Schreibrecht gelten.
Unterhalb von `xl` MUST die Sichtungszusammenfassung über der Liste stehen; die ausführliche
Seitenleiste darf darunter folgen.

#### Scenario: Erster Bildschirm mit Schreibrecht
- **WHEN** die Betroffenenliste eines Einsatzes mit mindestens einer Person bei 390 × 844 als Admin geöffnet wird
- **THEN** liegen die erste Personenzeile und die Sichtungszusammenfassung vollständig im Fenster

#### Scenario: Erster Bildschirm als Beobachter
- **WHEN** dieselbe Liste als Beobachter geöffnet wird
- **THEN** liegen die erste Personenzeile und die Sichtungszusammenfassung vollständig im Fenster, und der Kopf trägt keinen Erfassungsknopf

### Requirement: Das Personen-Detail stellt die medizinische Spalte vor die Stammdaten

Unterhalb von `lg` (schmaler als 992 px) MUST das Personen-Detail die medizinische Spalte
(Sichtung, Verlaufsnotiz, Verlauf) vor den Stammdaten zeigen; ab `lg` stehen beide Spalten
nebeneinander, die Stammdaten links. Die Stammdaten MUST jedes Etikett über seinem Wert zeigen,
und leere Angaben MUST in einer Zeile „Ohne Angabe: …“ zusammengefasst stehen statt als eigene
Zeilen mit Strich.

#### Scenario: Handschirm und Tablet hoch
- **WHEN** das Detail einer Person bei 390 × 844 und bei 820 × 1180 geöffnet wird, als Admin und als Beobachter
- **THEN** liegt die Oberkante der medizinischen Spalte über der Oberkante der Stammdaten

#### Scenario: Leere Angaben
- **WHEN** eine Person ohne Geburtsdatum, Herkunft und Melder angezeigt wird
- **THEN** stehen diese Etiketten in einer Zeile „Ohne Angabe: …“, und für sie gibt es kein eigenes Feld mit „—“
