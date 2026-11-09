# Spec Delta

## MODIFIED Requirements

### Requirement: Eine Startliste von Vorlagen wird mitgeliefert
Jede Organisation MUST die Vorlagen „Kleinlage“, „Sanitätsdienst“, „MANV“, „Personensuche“,
„Evakuierung und Betreuung“ und „Unwetter“ besitzen: bestehende Organisationen per Migration
`0238`, neue beim Anlegen (`bootstrap_admin`). Die Modulsätze MUST `EINSATZ_VORLAGE_STARTLISTE`
in `src/einsatz_vorlage/mod.rs` entsprechen (sichtbar 14, 24, 27, 25, 30 und 28 von 34 Modulen,
`infotelefon` in keiner; Einsatzart „Sanitätsdienst“ bei „Sanitätsdienst“, sonst „Realeinsatz“).
Stichwort-Kopplungen MUST nicht mitgeliefert werden. Jede Organisation darf die Startliste danach
ändern oder löschen. „Sanitätsdienst“ MUST Funk (`fernmeldewesen`) und Wetter (`wetter-pegel`)
zeigen (LLH-1569); Organisationen, die vorher bestanden, behalten ihre Vorlage im Stand von `0238`
(ohne Funk und Wetter), kein Update ändert bestehende Vorlagen oder Einsätze. Ausgenommen ist die
einmalige Übernahme der Ausblendung von `stab` auf `infotelefon` (Requirement „Vorlagen tragen die
Ausblendung des Stabs zum Informationstelefon“).

#### Scenario: Bestehende Organisation nach dem Update
- **WHEN** eine Organisation vor dieser Änderung bestand
- **THEN** besitzt sie danach die sechs Vorlagen, und „MANV“ blendet `infotelefon` und `tiere` aus

#### Scenario: Neue Installation
- **WHEN** der erste Start eine Organisation anlegt
- **THEN** besitzt sie die sechs Vorlagen, und kein Stichwort-Vorschlag zeigt auf eine Vorlage

#### Scenario: Sanitätsdienst mit Funk und Wetter
- **WHEN** eine neue Organisation einen Einsatz mit der Vorlage „Sanitätsdienst“ anlegt
- **THEN** sind Funk und Wetter sichtbar und Lagemeldungen ausgeblendet

### Requirement: Eine Vorlage blendet beim Anlegen Module aus
`POST /api/einsaetze` MUST ein optionales Feld `vorlage_id` annehmen. Für jedes ausgeblendete
Modul der Vorlage MUST das System in derselben Transaktion einen Einsatzwert `sichtbar: false`
speichern. Andere Module MUST ohne eigenen Wert bleiben. Ohne `vorlage_id` MUST das System keine
Modulwerte speichern. Eine unbekannte oder fremde Vorlage MUST mit HTTP 400 abgewiesen werden,
ohne dass ein Einsatz entsteht. Der Einsatz merkt sich die Vorlage nicht; eine spätere Änderung
der Vorlage wirkt nur auf neue Einsätze.

#### Scenario: MANV anlegen
- **WHEN** eine Führungskraft einen Einsatz mit der Vorlage „MANV“ anlegt
- **THEN** ist `infotelefon` in diesem Einsatz ausgeblendet, `unfallhilfsstellen` sichtbar, und der Editor „Module“ bietet bei „Informationstelefon“ „Vorgabe übernehmen“ an

#### Scenario: Org-Ausblendung bleibt
- **WHEN** die Organisation `fernmeldewesen` ausblendet und jemand einen Einsatz mit der Vorlage „MANV“ anlegt
- **THEN** ist `fernmeldewesen` in diesem Einsatz ausgeblendet

#### Scenario: Ohne Vorlage
- **WHEN** jemand einen Einsatz ohne `vorlage_id` anlegt
- **THEN** speichert das System keine Modulwerte

#### Scenario: Fremde Vorlage
- **WHEN** jemand einen Einsatz mit der Vorlage einer anderen Organisation anlegen will
- **THEN** antwortet das System mit HTTP 400, und es entsteht kein Einsatz

## ADDED Requirements

### Requirement: Vorlagen tragen die Ausblendung des Stabs zum Informationstelefon
Beim Update MUST jede Einsatz-Vorlage, die `stab` ausblendet, stattdessen `infotelefon`
ausblenden, und `stab` MUST aus jeder Vorlage verschwinden. Eine Vorlage, die `stab` nicht
ausblendet, MUST `infotelefon` danach zeigen. Danach MUST das System `stab` wie jeden unbekannten
Modulschlüssel mit HTTP 400 abweisen.

#### Scenario: Bestehende Vorlage nach dem Update
- **WHEN** die Vorlage „MANV“ vor dem Update `stab` und `tiere` ausblendete
- **THEN** liefert `GET /api/einsatz-vorlagen` für „MANV“ danach `infotelefon` und `tiere` als ausgeblendet und kein `stab`

#### Scenario: Stab nicht mehr wählbar
- **WHEN** ein System-Admin eine Vorlage mit ausgeblendetem `stab` speichern will
- **THEN** antwortet das System mit HTTP 400, und es wird nichts gespeichert
