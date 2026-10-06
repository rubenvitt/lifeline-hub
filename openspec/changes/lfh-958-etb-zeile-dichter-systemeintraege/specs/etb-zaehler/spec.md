# Spec Delta

## MODIFIED Requirements

### Requirement: Die Zählung folgt dem Filter der Liste
Der Zähl-Endpunkt SHALL dieselben Filterparameter annehmen wie `GET /api/einsaetze/{id}/etb`: `q`, `typ`, `von`, `bis`, `erfasser_id` und `ohne_system`. Er MUST exakt die Einträge zählen, die die Liste mit denselben Parametern über alle Seiten liefern würde.
- Die Seitenparameter `before_lfd_nr` und `limit` gehören nicht zum Filter. Der Endpunkt MUST sie ignorieren.
- Ein unbekannter Eintragstyp in `typ` MUST mit HTTP 400 abgelehnt werden, ebenso ein unlesbarer Zeitwert in `von` oder `bis`. Das ist dieselbe Antwort wie bei der Liste.
- `ohne_system=true` schließt Einträge vom Typ `system` aus. Zusammen mit `typ=system` MUST die Anfrage mit HTTP 422 abgelehnt werden, bei Liste und Zählung gleich.

#### Scenario: Volltextfilter
- **WHEN** `q=Deich` gesetzt ist und 2 von 5 Einträgen „Deich“ enthalten
- **THEN** ist `gesamt: 2`, und `je_typ` verteilt genau diese 2 Einträge

#### Scenario: Zeitraumfilter
- **WHEN** `von` und `bis` einen Zeitraum eingrenzen
- **THEN** zählen nur Einträge, deren Ereigniszeit im Zeitraum liegt, einschließlich der Grenzen

#### Scenario: Typfilter
- **WHEN** `typ=meldung` gesetzt ist
- **THEN** ist `gesamt` die Zahl der Meldungen, und alle anderen Typen stehen in `je_typ` auf 0

#### Scenario: Liste und Zählung stimmen überein
- **WHEN** für eine beliebige Kombination aus `q`, `typ`, `von`, `bis`, `erfasser_id` und `ohne_system` die Liste seitenweise vollständig geladen wird
- **THEN** ist die Zahl der geladenen Einträge gleich `gesamt` der Zählung mit denselben Parametern

#### Scenario: Unbekannter Typ
- **WHEN** `typ=unsinn` gesetzt ist
- **THEN** antwortet das System mit HTTP 400

#### Scenario: Systemeinträge ausgeschlossen
- **WHEN** `ohne_system=true` gesetzt ist und der Einsatz 3 Meldungen und 9 Systemeinträge hat
- **THEN** ist `gesamt: 3` und `je_typ.system: 0`

#### Scenario: Ausschluss und Systemtyp zugleich
- **WHEN** `typ=system` und `ohne_system=true` zusammen gesetzt sind
- **THEN** antworten Liste und Zählung mit HTTP 422
