## MODIFIED Requirements

### Requirement: Mandantenlabels und S7
Eine Organisation SHALL das Anzeigelabel jedes Katalogcodes überschreiben können. Ein leeres
Label stellt das Standardlabel wieder her. S7 SHALL je Organisation ein- und ausschaltbar sein,
Vorgabe aus. Ist S7 aus, MUST ein neuer Empfänger oder eine neue Führungsstelle mit `s7` mit 422
abgelehnt werden. Bestehende Datensätze mit `s7` bleiben lesbar. Labels und Schalter pflegt nur ein
Admin der eigenen Organisation. Das wirksame Label MUST in allen neu erzeugten Anzeigen und Texten
gelten: Snapshot des Empfängers, Paneel „Stab“ der Einsatzdaten, Fachzugang und Stabsmonitor,
abgeleitete Funktion im Kopf, System-ETB-Text der Besetzung.

#### Scenario: THW-Label
- **WHEN** ein Admin das Label von `s4` auf „Versorgung (Logistik)“ setzt und danach ein Auftrag an
  `s4` erteilt wird
- **THEN** trägt der Empfänger den Snapshot „S4 Versorgung (Logistik)“, und das Paneel „Stab“ der
  Einsatzdaten zeigt die S4-Zeile mit diesem Label

#### Scenario: Label zurücksetzen
- **WHEN** ein Admin das Label von `s4` leert
- **THEN** gilt wieder „Versorgung“

#### Scenario: S7 ausgeschaltet
- **WHEN** S7 für die Organisation aus ist und eine Erinnerung an `s7` angelegt werden soll
- **THEN** antwortet der Server mit 422, und der Katalog zeigt S7 nicht

#### Scenario: Kein Admin
- **WHEN** ein Benutzer ohne Adminrecht ein Label ändern will
- **THEN** antwortet der Server mit 403

