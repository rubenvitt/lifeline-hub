## ADDED Requirements

### Requirement: Die Zahlen eines Spiegels liegen in festen Grenzen
Übernimmt eine Instanz den Kopf eines gespiegelten Einsatzes, SHALL sie Jahr und laufende Nummer
der Einsatznummer nur übernehmen, wenn beide ganze Zahlen sind, das Jahr zwischen 2000 und 9999 und
die laufende Nummer zwischen 1 und 999.999 liegt. Sonst MUST sie beide Zahlen leer übernehmen und am
Spiegel einen Hinweis zeigen; der Nummerntext und die übrige Lieferung MUST übernommen werden.

#### Scenario: Laufende Nummer nahe am Höchstwert
- **WHEN** der ELW den Kopf seines Einsatzes `E-2026-0001` mit Jahr 2026 und laufender Nummer 9223372036854775807 liefert
- **THEN** zeigt der Hub den Spiegel mit `E-2026-0001`, ohne Jahr und laufende Nummer, mit einem Hinweis zur Einsatznummer, und die übrigen Zeilen der Lieferung sind übernommen

#### Scenario: Unplausibles Jahr
- **WHEN** der ELW einen Kopf mit Jahr 99999 und laufender Nummer 3 liefert
- **THEN** übernimmt der Hub beide Zahlen leer und zeigt einen Hinweis am Spiegel

#### Scenario: Nur eine der beiden Zahlen
- **WHEN** der ELW einen Kopf mit Jahr 2026 und ohne laufende Nummer liefert
- **THEN** übernimmt der Hub beide Zahlen leer und zeigt einen Hinweis am Spiegel

#### Scenario: Gültige Zahlen
- **WHEN** der ELW einen Kopf mit Jahr 2026 und laufender Nummer 12 liefert
- **THEN** übernimmt der Hub beide Zahlen unverändert und zeigt keinen Hinweis zur Einsatznummer

#### Scenario: Altbestand ohne Nummer
- **WHEN** der ELW einen Kopf ohne Jahr und ohne laufende Nummer liefert
- **THEN** übernimmt der Hub beide Zahlen leer und zeigt keinen Hinweis zur Einsatznummer

#### Scenario: Der Spiegel wird später eigen
- **WHEN** ein Spiegel, dessen Zahlen wegen der Grenze leer übernommen wurden, durch einen Führungswechsel zum eigenen Einsatz wird
- **THEN** gelingt der Wechsel, und die nächste Anlage in der Organisation vergibt die laufende Nummer, die ohne diesen Spiegel folgt

### Requirement: Die Vergabe läuft nicht über
Ist die nächste laufende Nummer beim Anlegen oder beim Übergang vom Spiegel zum eigenen Einsatz
nicht darstellbar, MUST das System den Vorgang mit 422 ablehnen. Es MUST NOT abstürzen und MUST NOT
eine negative oder umgelaufene Nummer vergeben.

#### Scenario: Anlage über einem Höchstwert
- **WHEN** in einer Organisation schon ein eigener Einsatz des laufenden Jahres die laufende Nummer 9223372036854775807 trägt und jemand einen Einsatz anlegt
- **THEN** antwortet `POST /api/einsaetze` mit 422, und es entsteht kein Einsatz

#### Scenario: Freie Nummer über einem Höchstwert
- **WHEN** ein Spiegel des Jahres 2026 die laufende Nummer 9223372036854775807 trägt und ein anderer Spiegel mit belegter Nummer desselben Jahres zum eigenen Einsatz werden soll
- **THEN** scheitert der Übergang mit 422, und kein Einsatz trägt eine negative Nummer
