## MODIFIED Requirements

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
- **THEN** stehen im Seitenkopf die Ansicht-Segmentleiste, ein Erfassungsknopf, „Vermisst melden“ und der Auslöser „Weitere“, und weder „Druckansicht“ noch „CSV exportieren“ steht als Knopf im Kopf

#### Scenario: Nebenwege im Menü
- **WHEN** auf dem Handschirm der Auslöser „Weitere“ der Betroffenenliste geöffnet wird
- **THEN** enthält das Menü „Druckansicht“ und „CSV exportieren“, und die Wahl löst denselben Weg aus wie der Knopf ab `md`

#### Scenario: Ab md unverändert erreichbar
- **WHEN** die Betroffenenliste bei 1180 px Breite geöffnet ist
- **THEN** stehen „Druckansicht“ und „CSV exportieren“ als Knöpfe im Kopf, und es gibt keinen Auslöser „Weitere“
