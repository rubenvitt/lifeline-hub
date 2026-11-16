# Spec Delta

## ADDED Requirements

### Requirement: Ein Tipp auf einen Marker bewegt die Kamera nicht

Ein Tipp auf einen Marker oder seine Trefferzone SHALL das Objekt auswählen. Die Kamera bleibt dabei
stehen: Ausschnitt, Zoom und Drehung MUST unverändert bleiben. Ein Tipp in ein Bündel ist davon
ausgenommen. Er zoomt weiterhin hinein, wie in „Ein Tipp gehört genau einem Ziel“ festgelegt.

#### Scenario: Marker-Tipp bei nahem Ausschnitt
- **WHEN** die Karte bei einem Maßstab von 200 m steht und die Person auf den Marker einer Einheit tippt
- **THEN** zeigt die Leiste den Inspector der Einheit, und Maßstab und Kartenmitte sind unverändert

#### Scenario: Marker-Tipp bei weitem Ausschnitt
- **WHEN** die Karte das ganze Einsatzgebiet zeigt und die Person auf einen Marker tippt
- **THEN** wird der Marker ausgewählt, und die Karte zoomt nicht heran
