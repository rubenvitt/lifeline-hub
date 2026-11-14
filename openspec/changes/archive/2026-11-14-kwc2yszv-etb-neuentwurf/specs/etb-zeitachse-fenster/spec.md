## MODIFIED Requirements

### Requirement: Keine Zahl des geladenen Fensters
Kopfzahl und Zahlen der Typ-Segmente der ETB-Seite MUST weiterhin aus der Serverzählung stammen. Die
Zahl der geladenen Einträge oder Seiten SHALL nirgends als Menge des Tagebuchs erscheinen.

#### Scenario: Tiefes Fenster
- **WHEN** das Fenster 500 Einträge eines Tagebuchs mit 3 000 Handeinträgen hält und Systemeinträge ausgeblendet sind
- **THEN** nennt der Kopf „3000 Einträge“
