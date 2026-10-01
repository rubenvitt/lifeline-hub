# Spec Delta

## MODIFIED Requirements

### Requirement: Snapshot trägt nur das Funktionslabel
Der Anzeige-Snapshot eines Auftragsempfängers mit Katalogcode SHALL beim Anlegen aus Kürzel und
wirksamem Label entstehen, bei Führungshilfspersonal und Fachberater als „<Label>: <Bezeichnung>“.
Beispiele: „S3 Einsatz“, „Fachberater: THW“. Er MUST NOT den Namen der Person enthalten, die die
Funktion gerade besetzt. Der Snapshot bleibt nach dem Anlegen unverändert, bis der Einsatz
geschwärzt wird; die Schwärzung MUST ihn durch den Platzhalter ersetzen. Das `an` des
ETB-Eintrags zur Anordnung SHALL aus diesen Snapshots entstehen und bleibt über die Schwärzung
hinweg im Wortlaut erhalten.

#### Scenario: Snapshot ohne Person
- **WHEN** S3 mit Müller besetzt ist und ein Auftrag an `s3` erteilt wird
- **THEN** lautet der Snapshot „S3 Einsatz“, und das `an` des ETB-Eintrags enthält „S3 Einsatz“,
  nicht „Müller“

### Requirement: Auflösung zur Lesezeit auf die aktuelle Besetzung
Beim Lesen eines Auftrags oder einer Erinnerung, deren Empfänger ein Sachgebiet `s1`–`s6` ist,
SHALL das System die aktuelle Besetzung dieses Sachgebiets im Einsatz mitliefern: Name der
disponierten oder externen Person, rückwärtige Stelle, „bei der Einsatzleitung“ oder „nicht
vergeben“. Für `el`, `s7`, Führungshilfspersonal, Fachberater und Freitext MUST keine Auflösung
erscheinen. Das Feld fehlt, es gibt keinen Platzhalter. Wer das Stab-Modul im Einsatz nicht lesen
darf, MUST die Auflösung nicht erhalten. Ein Besetzungswechsel SHALL die Anzeige von Aufträgen und
Erinnerungen live aktualisieren.

#### Scenario: Paar-Test Besetzungswechsel
- **WHEN** ein Auftrag an `s3` erteilt wird, während Müller S3 besetzt, und danach S3 auf Schulz
  wechselt
- **THEN** liefert der Auftrag vorher den Snapshot „S3 Einsatz“ mit der Besetzung „Müller“ und
  nachher denselben Snapshot „S3 Einsatz“ mit der Besetzung „Schulz“

#### Scenario: Nicht vergeben
- **WHEN** eine Erinnerung an `s4` gelesen wird und S4 keine Besetzung hat
- **THEN** lautet die Auflösung „nicht vergeben“

#### Scenario: Ohne Stab-Recht
- **WHEN** eine Person mit Leserecht auf Aufträge, aber ohne Freigabe des Stab-Moduls, einen
  Auftrag an `s3` liest
- **THEN** sieht sie den Snapshot „S3 Einsatz“ und keine Besetzung

#### Scenario: Nach der Schwärzung
- **WHEN** ein Einsatz geschwärzt wurde
- **THEN** liefert die Auflösung keinen Personennamen mehr
- **AND** trägt der Snapshot am Auftragsempfänger den Platzhalter, und das `an` des ETB-Eintrags
  zur Anordnung nennt weiter „S3 Einsatz“
