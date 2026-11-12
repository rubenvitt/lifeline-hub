## MODIFIED Requirements

### Requirement: Unveränderlichkeit
Die Einsatznummer MUST nach der Vergabe unverändert bleiben. `PATCH /api/einsaetze/{id}`
SHALL einen Body, der das Feld `einsatznummer_intern` enthält, mit 400 abweisen, egal ob mit
Wert oder `null`. Andere Felder dieses Requests werden dann nicht übernommen. Die
Leitstellen-Nr. (`leitstellen_nr`) bleibt über denselben Endpunkt frei setzbar und leerbar.
Einzige Ausnahme ist die Vergabe einer freien Nummer, wenn ein Spiegel zum eigenen Einsatz wird
(Anforderung „Freie Nummer, wenn ein Spiegel zum eigenen Einsatz wird“); keine Bedienung ändert
die Nummer.

#### Scenario: Überschreiben abgewiesen
- **WHEN** ein PATCH `einsatznummer_intern: "EN-4711"` schickt
- **THEN** antwortet der Server mit 400, und die Einsatznummer bleibt unverändert

#### Scenario: Leeren abgewiesen
- **WHEN** ein PATCH `einsatznummer_intern: null` schickt
- **THEN** antwortet der Server mit 400, und die Einsatznummer bleibt unverändert

#### Scenario: Leitstellen-Nr. bleibt frei
- **WHEN** ein PATCH nur `leitstellen_nr` setzt oder auf `null` leert
- **THEN** wird das übernommen, und die Einsatznummer bleibt unverändert

## ADDED Requirements

### Requirement: Freie Nummer, wenn ein Spiegel zum eigenen Einsatz wird
Ein Spiegel trägt die Nummer der führenden Instanz und ist von der Eindeutigkeit ausgenommen. Wird
er zum eigenen Einsatz (Führungswechsel jeder Art, Verwahrung) und ist seine Nummer in der
Organisation dieser Instanz schon vergeben, SHALL das System ihm eine neue Nummer geben: die
laufende Nummer über allen Einsätzen des Jahres, die die Instanz kennt, auch ihren Spiegeln. Der
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

### Requirement: Eine Umnummerierung ist nachlesbar
Bekommt ein Einsatz beim Übergang vom Spiegel zum eigenen Einsatz eine neue Nummer, MUST sein
Einsatztagebuch einen Systemeintrag tragen, der die neue und die bisherige Nummer nennt. Die bisher
führende Instanz MUST die neue Nummer nach dem nächsten Abgleich an ihrem Spiegel zeigen. Wechselt
die Führung später zurück, kehrt die frühere Nummer nicht von selbst wieder.

#### Scenario: Eintrag nach Notübernahme
- **WHEN** der Hub einen Einsatz bei der Notübernahme von `E-2026-0001` auf `E-2026-0003` umnummeriert hat
- **THEN** nennt ein Systemeintrag im Einsatztagebuch dieses Einsatzes `E-2026-0003` und `E-2026-0001`

#### Scenario: Die abgebende Seite zeigt die neue Nummer
- **WHEN** der Hub den Einsatz bei der Notübernahme auf `E-2026-0003` umnummeriert hat und der ELW sich nach der bestätigten Übernahme meldet
- **THEN** zeigt der ELW den Einsatz als Spiegel mit `E-2026-0003`

#### Scenario: Kein Eintrag ohne Umnummerierung
- **WHEN** ein Spiegel mit freier Nummer zum eigenen Einsatz wird
- **THEN** bekommt sein Einsatztagebuch keinen Eintrag zur Nummer

#### Scenario: Verwahrung bei gleicher Nummer
- **WHEN** der Hub einen abgeschlossenen Einsatz des ELW zur Verwahrung annimmt und schon ein eigener Einsatz dieselbe Nummer trägt
- **THEN** bekommt der verwahrte Einsatz eine freie Nummer, und der Systemeintrag „Zur Verwahrung übernommen von …“ nennt die neue und die bisherige Nummer
