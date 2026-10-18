# Spec Delta

## ADDED Requirements

### Requirement: Kurzeingabe der Ereigniszeit
Beginnt der Text der ETB-Schnellerfassung (nach einem etwaigen Typbefehl) mit `/zeit` und einer
lesbaren Zeitangabe, SHALL die Erfassung daraus die Ereigniszeit setzen, nach denselben Regeln wie
das Zeitfeld eines Ereignisses (`1420`, `14:20`, `101420`, `-15`). Der Rest der Zeile MUST als
Inhalt stehen bleiben. Ist die Angabe unlesbar, bleibt sie Text, und das Feld nennt den Grund.

#### Scenario: Uhrzeit mit Inhalt
- **WHEN** „/zeit 1420 Pumpe läuft“ getippt wird
- **THEN** zeigt die Erfassung den Chip „Ereigniszeit“ mit 1420, und der Inhalt lautet „Pumpe läuft“

#### Scenario: Relativ
- **WHEN** um 14:31 Serverzeit „/zeit -10 Lage ruhig“ getippt und erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 14:21 und den Hinweis „nachgetragen“

#### Scenario: Unlesbar
- **WHEN** „/zeit 2590 Pumpe“ getippt wird
- **THEN** wird kein Chip gesetzt, der Text bleibt stehen, und das Feld nennt den Grund

### Requirement: Keine Ereigniszeit in der Zukunft
Liegt die Ereigniszeit eines ETB-Entwurfs mehr als 60 Sekunden nach jetzt (Serveruhr, soweit der
Versatz bekannt ist), MUST die Erfassung das Senden verweigern, am Zeit-Chip den Grund „liegt in
der Zukunft“ nennen und Text und Felder stehen lassen. Der Server begrenzt die Ereigniszeit
weiterhin nicht.

#### Scenario: Tippfehler in die Zukunft
- **WHEN** um 14:20 Serverzeit eine Ereigniszeit 18:20 desselben Tages im Chip steht und „Erfassen“ gewählt wird
- **THEN** entsteht kein Eintrag, der Chip nennt „liegt in der Zukunft“, und der Text bleibt

#### Scenario: Vorgemerkter Eintrag
- **WHEN** ein offline vorgemerkter Eintrag mit vergangener Ereigniszeit später gesendet wird
- **THEN** nimmt der Server ihn an

### Requirement: Typwort statt Slash-Präfix
Der Typwähler der ETB-Erfassung SHALL das Typwort des gewählten Typs zeigen (z. B. „Meldung“,
„Berichtigung“) mit einer Kante in der Typfarbe, nicht die Slash-Schreibweise. Sein zugänglicher
Name MUST „Eintragstyp <Typwort> ändern“ lauten. Die Typwahl im Menü SHALL je Typ einen Farbpunkt
tragen. Der Slash-Befehl am Zeilenanfang wechselt den Typ weiterhin.

#### Scenario: Wechsel per Slash-Befehl
- **WHEN** „/anordnung Abschnitt Nord räumen“ getippt wird
- **THEN** zeigt der Typwähler „Anordnung“ mit der Kante der Anordnung, und sein Name lautet „Eintragstyp Anordnung ändern“

### Requirement: Werte behalten nimmt den Typ mit
Ist „Werte behalten“ an, SHALL der Folgeentwurf nach erfolgreichem Erfassen neben Von, An und
Meldeweg auch den Eintragstyp übernehmen. Ist der Schalter aus, MUST der Folgeentwurf als
„Meldung“ beginnen. Die Vorgabe des Schalters bleibt aus; eine Ereigniszeit wird nie übernommen.

#### Scenario: Serie von Anordnungen
- **WHEN** „Werte behalten“ an ist und eine Anordnung erfasst wird
- **THEN** beginnt der nächste Entwurf als Anordnung mit denselben Von, An und Meldeweg

#### Scenario: Schalter aus
- **WHEN** „Werte behalten“ aus ist und eine Anordnung erfasst wird
- **THEN** beginnt der nächste Entwurf als Meldung
