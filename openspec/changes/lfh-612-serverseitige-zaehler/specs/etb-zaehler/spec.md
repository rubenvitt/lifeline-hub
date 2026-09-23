# Spec Delta

## Purpose

Exakte Zählung der Einträge im Einsatztagebuch (ETB) eines Einsatzes, gesamt und je Eintragstyp. Die Zählung folgt demselben Filter wie die ETB-Liste. So stimmen die Zahl im Kopf, die Bilanz-Leiste und die Liste überein, auch wenn nur ein Teil der Einträge geladen ist.

## ADDED Requirements

### Requirement: ETB-Zählung gesamt und je Typ
Das System SHALL unter `GET /api/einsaetze/{id}/etb/zaehler` die Zahl der ETB-Einträge des Einsatzes liefern.
- `gesamt` ist die Gesamtzahl.
- `je_typ` enthält für **jeden** Eintragstyp (`meldung`, `anordnung`, `lage`, `entscheidung`, `system`, `berichtigung`) einen Wert. Ein Typ ohne Einträge MUST als 0 erscheinen; er DARF NICHT fehlen.
- Die Summe über `je_typ` MUST `gesamt` ergeben.
- Berichtigungs- und Systemeinträge zählen mit. Das ETB kennt weder Löschung noch Storno, jeder gespeicherte Eintrag zählt.

#### Scenario: Ungefilterte Zählung
- **WHEN** ein Mitglied des Einsatzes `GET /api/einsaetze/{id}/etb/zaehler` ohne Parameter aufruft und der Einsatz 3 Meldungen, 1 Anordnung und 1 Systemeintrag hat
- **THEN** antwortet das System mit HTTP 200, `gesamt: 5` und `je_typ` mit `meldung: 3`, `anordnung: 1`, `system: 1` sowie 0 für `lage`, `entscheidung` und `berichtigung`

#### Scenario: Mehr Einträge als eine Listenseite
- **WHEN** ein Einsatz mehr Einträge hat als die Standard-Seitengröße der ETB-Liste
- **THEN** ist `gesamt` die volle Anzahl, nicht die Seitengröße

#### Scenario: Andere Einsätze zählen nicht mit
- **WHEN** ein anderer Einsatz ETB-Einträge hat
- **THEN** sind diese in der Zählung dieses Einsatzes nicht enthalten

### Requirement: Die Zählung folgt dem Filter der Liste
Der Zähl-Endpunkt SHALL dieselben Filterparameter annehmen wie `GET /api/einsaetze/{id}/etb`: `q`, `typ`, `von`, `bis` und `erfasser_id`. Er MUST exakt die Einträge zählen, die die Liste mit denselben Parametern über alle Seiten liefern würde.
- Die Seitenparameter `before_lfd_nr` und `limit` gehören nicht zum Filter. Der Endpunkt MUST sie ignorieren.
- Ein unbekannter Eintragstyp in `typ` MUST mit HTTP 400 abgelehnt werden, ebenso ein unlesbarer Zeitwert in `von` oder `bis`. Das ist dieselbe Antwort wie bei der Liste.

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
- **WHEN** für eine beliebige Kombination aus `q`, `typ`, `von`, `bis` und `erfasser_id` die Liste seitenweise vollständig geladen wird
- **THEN** ist die Zahl der geladenen Einträge gleich `gesamt` der Zählung mit denselben Parametern

#### Scenario: Unbekannter Typ
- **WHEN** `typ=unsinn` gesetzt ist
- **THEN** antwortet das System mit HTTP 400

### Requirement: Zugriff auf die ETB-Zählung
Der Zähl-Endpunkt MUST dieselben Zugriffsregeln durchsetzen wie die ETB-Liste: Lesezugriff auf den Einsatz, auch als Beobachter, und Zugriff auf das Modul `etb`.
- Für einen unbekannten Einsatz MUST das System mit HTTP 404 antworten.
- Ohne Lesezugriff oder mit gesperrtem bzw. ausgeblendetem Modul MUST es mit HTTP 403 antworten.

#### Scenario: Beobachter darf zählen
- **WHEN** ein Beobachter des Einsatzes die Zählung abruft
- **THEN** antwortet das System mit HTTP 200

#### Scenario: Ausgeblendetes ETB-Modul
- **WHEN** das Modul `etb` für den Einsatz ausgeblendet ist und kein System-Admin anfragt
- **THEN** antwortet das System mit HTTP 403

### Requirement: ETB-Kopf und Bilanz zeigen die exakte Zahl
Die ETB-Seite SHALL im Kopf und in der Bilanz-Leiste die Zahlen der Zählung anzeigen, nicht die Zahl der geladenen Einträge.
- **Kopf:** Ohne aktiven Filter MUST dort „n Einträge“ mit `gesamt` stehen, mit aktivem Filter „n Treffer“ mit `gesamt` der gefilterten Zählung. Bei n = 1 steht die Einzahl.
- **Bilanz-Leiste:** Sie zeigt je Typ die Zahl aus `je_typ`, und ihre Balken messen gegen `gesamt`. Sie heißt ohne Filter „Bilanz“ und mit Filter „Bilanz im Filter“. Der Systemtyp erscheint nur, wenn sein Wert größer als 0 ist.
- **Keine Zahl:** Solange die Zählung lädt oder fehlgeschlagen ist, MUST die Seite keine Gesamtzahl behaupten. Sie zeigt dann keine Zahl bzw. den Hinweis, dass die Zählung aussteht.

#### Scenario: Kopf ohne Filter
- **WHEN** die Seite 100 von 412 Einträgen geladen hat und kein Filter aktiv ist
- **THEN** steht im Kopf „412 Einträge“

#### Scenario: Kopf mit Filter
- **WHEN** ein Volltextfilter aktiv ist, der auf 7 Einträge passt
- **THEN** steht im Kopf „7 Treffer“, und die Bilanz-Leiste heißt „Bilanz im Filter“ und summiert sich zu 7

#### Scenario: Zählung schlägt fehl
- **WHEN** der Zähl-Endpunkt mit einem Fehler antwortet
- **THEN** zeigen Kopf und Bilanz keine Gesamtzahl; die Liste bleibt bedienbar

### Requirement: Die ETB-Zählung aktualisiert sich live
Die ETB-Zählung SHALL sich über den Live-Feed des Einsatzes aktualisieren, sobald ein ETB-Eintrag entsteht, ohne dass die Seite neu geladen wird.

#### Scenario: Neuer Eintrag
- **WHEN** ein anderer Benutzer einen ETB-Eintrag anlegt, während die ETB-Seite offen ist
- **THEN** steigt die Zahl im Kopf und in der passenden Bilanzzeile, ohne dass die Seite neu geladen wird
