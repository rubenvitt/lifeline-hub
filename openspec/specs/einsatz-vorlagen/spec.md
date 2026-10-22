# einsatz-vorlagen Specification

## Purpose
Eine Organisation pflegt Einsatz-Vorlagen in den Stammdaten: benannte Modulsätze mit optionaler
Einsatzart. Wer einen Einsatz mit einer Vorlage anlegt, bekommt die Module, die sie ausblendet,
als eigene Einsatzwerte ausgeblendet; ein Stichwort-Vorschlag kann auf eine Vorlage zeigen und
stellt sie im Anlegedialog ein. Eine Startliste von sechs Vorlagen wird mitgeliefert (LLH-1375).

## Requirements

### Requirement: Die Organisation pflegt Einsatz-Vorlagen
Das System MUST je Organisation Einsatz-Vorlagen mit Bezeichnung, optionaler Einsatzart und der
Menge ausgeblendeter Module führen. `GET /api/einsatz-vorlagen` MUST die Vorlagen der eigenen
Organisation jedem angemeldeten Angehörigen liefern. Anlegen, Ändern und Löschen MUST nur der
System-Admin dürfen, andere erhalten HTTP 403. Eine leere Bezeichnung, ein unbekannter
Modulschlüssel, ein nicht ausblendbares Modul oder eine ungültige Einsatzart MUST das System mit
HTTP 400 abweisen, eine in der Organisation doppelte Bezeichnung mit HTTP 409 (wie Stichworte und
Einheiten-Vorlagen), jeweils ohne zu speichern.

#### Scenario: Vorlage anlegen
- **WHEN** ein System-Admin eine Vorlage „Großbrand“ mit ausgeblendetem `tiere` anlegt
- **THEN** antwortet das System mit HTTP 201, und der nächste Abruf liefert „Großbrand“ mit `tiere` als ausgeblendet

#### Scenario: Nicht ausblendbares Modul
- **WHEN** ein System-Admin eine Vorlage mit ausgeblendetem `einsatzdaten` speichern will
- **THEN** antwortet das System mit HTTP 400, und es wird nichts gespeichert

#### Scenario: Bezeichnung doppelt
- **WHEN** ein System-Admin eine zweite Vorlage „MANV“ in derselben Organisation anlegt
- **THEN** antwortet das System mit HTTP 409, und es wird nichts gespeichert

#### Scenario: Führungskraft liest nur
- **WHEN** eine Führungskraft ohne Admin-Rechte eine Vorlage ändern will
- **THEN** antwortet das System mit HTTP 403

#### Scenario: Fremde Organisation
- **WHEN** ein System-Admin eine Vorlage einer anderen Organisation ändern will
- **THEN** antwortet das System mit HTTP 404

### Requirement: Eine Startliste von Vorlagen wird mitgeliefert
Jede Organisation MUST die Vorlagen „Kleinlage“, „Sanitätsdienst“, „MANV“, „Personensuche“,
„Evakuierung und Betreuung“ und „Unwetter“ besitzen: bestehende Organisationen per Migration
`0238`, neue beim Anlegen (`bootstrap_admin`). Die Modulsätze MUST `EINSATZ_VORLAGE_STARTLISTE`
in `src/einsatz_vorlage/mod.rs` entsprechen (sichtbar 14, 22, 27, 25, 30 und 28 von 34 Modulen,
`stab` in keiner; Einsatzart „Sanitätsdienst“ bei „Sanitätsdienst“, sonst „Realeinsatz“).
Stichwort-Kopplungen MUST nicht mitgeliefert werden. Jede Organisation darf die Startliste danach
ändern oder löschen.

#### Scenario: Bestehende Organisation nach dem Update
- **WHEN** eine Organisation vor dieser Änderung bestand
- **THEN** besitzt sie danach die sechs Vorlagen, und „MANV“ blendet `stab` und `tiere` aus

#### Scenario: Neue Installation
- **WHEN** der erste Start eine Organisation anlegt
- **THEN** besitzt sie die sechs Vorlagen, und kein Stichwort-Vorschlag zeigt auf eine Vorlage

### Requirement: Ein Stichwort-Vorschlag kann auf eine Vorlage zeigen
Ein Stichwort-Vorschlag MUST optional auf eine Vorlage derselben Organisation zeigen
(`vorlage_id`). Setzen MUST nur der System-Admin über
`PUT /api/stichwort-vorschlaege/{id}/vorlage`; eine Vorlage einer anderen Organisation MUST mit
HTTP 400 abgewiesen werden. Wird die Vorlage gelöscht, MUST die Kopplung entfallen, der Vorschlag
bleibt.

#### Scenario: Koppeln
- **WHEN** ein System-Admin den Stichwort-Vorschlag „MANV15“ mit der Vorlage „MANV“ koppelt
- **THEN** liefert `GET /api/stichwort-vorschlaege` für „MANV15“ die Vorlage „MANV“

#### Scenario: Vorlage gelöscht
- **WHEN** die gekoppelte Vorlage gelöscht wird
- **THEN** bleibt „MANV15“ als Vorschlag erhalten, ohne Vorlage

### Requirement: Eine Vorlage blendet beim Anlegen Module aus
`POST /api/einsaetze` MUST ein optionales Feld `vorlage_id` annehmen. Für jedes ausgeblendete
Modul der Vorlage MUST das System in derselben Transaktion einen Einsatzwert `sichtbar: false`
speichern. Andere Module MUST ohne eigenen Wert bleiben. Ohne `vorlage_id` MUST das System keine
Modulwerte speichern. Eine unbekannte oder fremde Vorlage MUST mit HTTP 400 abgewiesen werden,
ohne dass ein Einsatz entsteht. Der Einsatz merkt sich die Vorlage nicht; eine spätere Änderung
der Vorlage wirkt nur auf neue Einsätze.

#### Scenario: MANV anlegen
- **WHEN** eine Führungskraft einen Einsatz mit der Vorlage „MANV“ anlegt
- **THEN** ist `stab` in diesem Einsatz ausgeblendet, `unfallhilfsstellen` sichtbar, und der Editor „Module“ bietet bei „Stab“ „Vorgabe übernehmen“ an

#### Scenario: Org-Ausblendung bleibt
- **WHEN** die Organisation `fernmeldewesen` ausblendet und jemand einen Einsatz mit der Vorlage „MANV“ anlegt
- **THEN** ist `fernmeldewesen` in diesem Einsatz ausgeblendet

#### Scenario: Ohne Vorlage
- **WHEN** jemand einen Einsatz ohne `vorlage_id` anlegt
- **THEN** speichert das System keine Modulwerte

#### Scenario: Fremde Vorlage
- **WHEN** jemand einen Einsatz mit der Vorlage einer anderen Organisation anlegen will
- **THEN** antwortet das System mit HTTP 400, und es entsteht kein Einsatz

### Requirement: Der Anlegedialog bietet die Vorlage an
Der Dialog „Neuen Einsatz anlegen“ MUST unter den Feldern die Vorlage zur Wahl stellen, Standard
„Alle Module“. Ein gekoppeltes Stichwort MUST die Vorlage einstellen, solange sie nicht von Hand
gewählt wurde. Eine Vorlage mit Einsatzart MUST die Einsatzart vorbelegen, solange diese nicht von
Hand geändert wurde.

#### Scenario: Stichwort stellt Vorlage ein
- **WHEN** „MANV15“ mit „MANV“ gekoppelt ist und jemand im Dialog „MANV15“ wählt
- **THEN** steht die Vorlage auf „MANV“

#### Scenario: Handwahl hat Vorrang
- **WHEN** jemand zuerst „Kleinlage“ wählt und danach das Stichwort „MANV15“
- **THEN** bleibt die Vorlage „Kleinlage“

#### Scenario: Einsatzart vorbelegen
- **WHEN** jemand die Vorlage „Sanitätsdienst“ wählt
- **THEN** steht die Einsatzart auf „Sanitätsdienst“
