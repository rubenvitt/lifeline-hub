# Spec Delta

## ADDED Requirements

### Requirement: Zeile der Kopfdaten mit Altwert speichern
Das Speichern einer Zeile der Kopfdaten über `PATCH /api/einsaetze/{id}` SHALL neben dem neuen
Wert den Wert beim Öffnen als `erwartet` senden, mit denselben Feldnamen, die die Zeile schreibt.
Die Koordinate MUST als Paar (`einsatzort_lat`, `einsatzort_lon`) erwartet werden; sendet die
Zeile „Adresse“ eine neue Koordinate mit, erwartet sie Adresse und Koordinate.

#### Scenario: Leitstellen-Nr. mit veraltetem Stand
- **WHEN** B die Zeile „Leitstellen-Nr.“ leer öffnet, A inzwischen `ILS-4711` speichert und B `ILS-4712` mit `erwartet: { leitstellen_nr: null }` sendet
- **THEN** antwortet der Server mit 409, die Leitstellen-Nr. bleibt `ILS-4711`, und B sieht die Rückfrage

#### Scenario: Andere Zeile dazwischen
- **WHEN** B die Zeile „Meldende Stelle“ öffnet, A inzwischen die Leitstellen-Nr. speichert und B speichert
- **THEN** wird die Meldende Stelle gespeichert, ohne Rückfrage, und die Leitstellen-Nr. von A bleibt

#### Scenario: Adresse mit Treffer
- **WHEN** B an der Zeile „Adresse“ einen Treffer wählt, nachdem A inzwischen die Koordinate verschoben hat, und speichert
- **THEN** antwortet der Server mit 409, weil die erwartete Koordinate nicht mehr stimmt, und die Koordinate von A bleibt

### Requirement: Altwerte der Kopfdaten gemeinsam geprüft
Der Server SHALL alle Altwerte einer Anfrage an die Kopfdaten zusammen mit dem Schreiben prüfen.
Weicht einer ab, MUST er mit 409 antworten und nichts schreiben. Eine nur halb erwartete
Koordinate MUST mit 400 abgelehnt werden, ebenso ein Altwert für ein Feld, das die Anfrage nicht
ändert.

#### Scenario: Halbe Koordinate erwartet
- **WHEN** eine Anfrage nur `erwartet: { einsatzort_lat: 52.5 }` trägt
- **THEN** antwortet der Server mit 400

#### Scenario: Altwert stimmt
- **WHEN** eine Anfrage die Bezeichnung mit dem gespeicherten Altwert sendet
- **THEN** wird die Bezeichnung gespeichert
