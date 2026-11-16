# Spec Delta

## ADDED Requirements

### Requirement: Ein Tipp auf einen Marker fliegt nicht an

Ein Tipp auf einen Marker oder seine Trefferzone SHALL das Objekt auswählen, ohne dass die Kamera
anfliegt: Zoom und Drehung MUST unverändert bleiben. Den Ausschnitt verschiebt die Karte nur, wenn die
Auswahl die Leiste öffnet und der Marker danach außerhalb des sichtbaren Bildes läge, und dann nur so
weit, dass er am Rand sichtbar ist. Ein Tipp in ein Bündel zoomt weiterhin hinein.

#### Scenario: Marker-Tipp bei nahem Ausschnitt
- **WHEN** die Karte bei einem Maßstab von 200 m steht und die Person auf den Marker einer Einheit tippt
- **THEN** zeigt die Leiste den Inspector der Einheit, und Maßstab und Kartenmitte sind unverändert

#### Scenario: Marker-Tipp bei weitem Ausschnitt
- **WHEN** die Karte das ganze Einsatzgebiet zeigt und die Person auf einen Marker tippt
- **THEN** wird der Marker ausgewählt, und die Karte zoomt nicht heran

#### Scenario: Marker am Rand bleibt nach dem Öffnen der Leiste sichtbar
- **WHEN** am Touch-Tablet die Leiste zu ist und die Person auf einen Marker nahe dem rechten Kartenrand tippt
- **THEN** öffnet sich die Leiste, die Karte schiebt den Marker gerade so weit herein, dass er sichtbar ist, und der Zoom bleibt
