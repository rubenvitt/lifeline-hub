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

#### Scenario: Der Hinweis bleibt bis zum nächsten Kopf
- **WHEN** der Hub die Zahlen eines Kopfs wegen der Grenze leer übernommen hat und danach Lieferungen ohne Kopf übernimmt
- **THEN** steht der Hinweis zur Einsatznummer weiter am Spiegel, bis der Hub den Kopf das nächste Mal übernimmt; sind dessen Zahlen gültig, verschwindet er

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
- **WHEN** ein eigener Einsatz des Jahres 2026 die laufende Nummer 9223372036854775806 trägt, der Text `E-2026-9223372036854775807` schon vergeben ist und ein Spiegel mit belegter Nummer desselben Jahres zum eigenen Einsatz werden soll
- **THEN** scheitert der Übergang mit 422, und kein Einsatz trägt eine negative Nummer

### Requirement: Die freie Nummer bleibt in der Grenze
Läge die laufende Nummer über allen Einsätzen des Jahres, Spiegel eingeschlossen, an oder über der
Grenze für die Zahlen eines Spiegels, SHALL das System die freie Nummer beim Übergang vom Spiegel
zum eigenen Einsatz nur über den eigenen Einsätzen und dem Löschprotokoll zählen.

#### Scenario: Ein fremder Spiegel an der Grenze
- **WHEN** der Hub den eigenen Einsatz `E-2026-0001` hat, einen Spiegel mit der laufenden Nummer 999999 hält und ein Spiegel mit der Nummer `E-2026-0001` zum eigenen Einsatz wird
- **THEN** trägt der übernommene Einsatz am Hub `E-2026-0002`

## MODIFIED Requirements

### Requirement: Freie Nummer, wenn ein Spiegel zum eigenen Einsatz wird
Ein Spiegel trägt die Nummer der führenden Instanz und ist von der Eindeutigkeit ausgenommen. Wird
er zum eigenen Einsatz (Führungswechsel jeder Art, Verwahrung) und ist seine Nummer in der
Organisation dieser Instanz schon vergeben, SHALL das System ihm eine neue Nummer geben: die
laufende Nummer über allen Einsätzen des Jahres, die die Instanz kennt, auch ihren Spiegeln, außer
nach „Die freie Nummer bleibt in der Grenze“. Der
Übergang MUST NOT an der Eindeutigkeit scheitern. Ist die Nummer frei, MUST sie bleiben.

#### Scenario: Notübernahme bei gleicher Nummer
- **WHEN** der Hub die eigenen Einsätze `E-2026-0001` und `E-2026-0002` hat, den Einsatz `E-2026-0001` des ELW spiegelt und ein Admin am Hub die Notübernahme vollzieht
- **THEN** gelingt die Notübernahme, und der übernommene Einsatz trägt am Hub `E-2026-0003`

#### Scenario: Neue Nummer über den Spiegeln
- **WHEN** der Hub die eigenen Einsätze `E-2026-0001` und `E-2026-0002` hat, die Einsätze `E-2026-0001` bis `E-2026-0005` des ELW spiegelt und die Führung des gespiegelten `E-2026-0001` übernimmt
- **THEN** trägt der übernommene Einsatz am Hub `E-2026-0006`

#### Scenario: Übergabe bei gleicher Nummer
- **WHEN** der ELW seinen Einsatz `E-2026-0001` an den Hub übergibt und der Hub schon einen eigenen Einsatz `E-2026-0001` hat
- **THEN** nimmt der Hub die Führung beim nächsten Abgleich an, der übernommene Einsatz bekommt dort eine freie Nummer, und der Abgleich läuft ohne Fehler weiter

#### Scenario: Zurückgeholter Einsatz nach neuer Anlage
- **WHEN** der ELW seinen Einsatz `E-2026-0001` an den Hub abgegeben, danach einen neuen Einsatz angelegt hat, der wieder `E-2026-0001` trägt, und den ersten per Anfrage zurückbekommt
- **THEN** führt der ELW den ersten Einsatz mit einer freien Nummer, und der neue behält `E-2026-0001`

#### Scenario: Nummer im Löschprotokoll
- **WHEN** die Nummer des Spiegels an dieser Instanz keinem eigenen Einsatz gehört, aber im Löschprotokoll der Organisation steht, und der Spiegel zum eigenen Einsatz wird
- **THEN** bekommt er eine freie Nummer

#### Scenario: Freie Nummer bleibt
- **WHEN** der Hub keinen eigenen Einsatz mit der Nummer `E-2026-0007` hat, den Einsatz `E-2026-0007` des ELW spiegelt und die Führung übernimmt
- **THEN** trägt der Einsatz am Hub weiter `E-2026-0007`
