## Purpose

Die Personendaten einer Betroffenen oder Vermissten entstehen im Einsatz stückweise. Jede Angabe
ist deshalb an Ort und Stelle in der Ansicht schreibbar, ohne Sammelformular, mit Schutz gegen
stilles Überschreiben und gegen das Verlieren einer offenen Eingabe.

## ADDED Requirements

### Requirement: Jede Angabe ist einzeln in der Ansicht schreibbar

Mit Schreibrecht SHALL jede Angabe im Abschnitt „Personendaten“ des Personen-Details an Ort und
Stelle schreibbar sein: Name, Vorname, Geschlecht, Geburtsdatum, geschätztes Alter, Herkunft /
Adresse, Fundort, Koordinate, Melder / Kontakt und Notiz, bei Vermissten „vermisst seit“ statt
Koordinate. Ein Tipp MUST das Feld öffnen, „Speichern“ MUST genau dieses Feld senden und sonst
keines. Ein Ändern MUST höchstens zwei Interaktionen vor der Eingabe brauchen. Die
Erfolgsmeldung MUST das Feld nennen („Name gespeichert“). Ein Sammelformular und eine
Kopfaktion „Bearbeiten“ MUST NOT es für die Personendaten geben, auch nicht am Gerät.
„Zustand / Verdacht“, PAT-Nummer und Kontamination MUST nur im Patientenkopf schreibbar sein,
nicht ein zweites Mal in den Personendaten.

#### Scenario: Name ergänzen
- **WHEN** jemand mit Schreibrecht bei einer Person ohne Name auf „+ Name“ tippt, „Müller“ eingibt und „Speichern“ wählt
- **THEN** geht genau ein PATCH mit dem Feld `name` hinaus, die Meldung lautet „Name gespeichert“, und die Personendaten zeigen „Müller“

#### Scenario: Andere Felder bleiben unberührt
- **WHEN** an einer Person mit Herkunft und Melder nur der Vorname geändert wird
- **THEN** bleiben Herkunft und Melder unverändert gespeichert

#### Scenario: Kein Bearbeiten im Kopf
- **WHEN** ein Admin das Detail einer Person öffnet
- **THEN** trägt der Seitenkopf keine Aktion „Bearbeiten“, und die Personendaten zeigen jede Angabe als schreibbares Feld

#### Scenario: Vermisste Person
- **WHEN** das Detail einer vermissten Person geöffnet wird
- **THEN** ist „vermisst seit“ schreibbar, und es gibt weder Koordinate noch „Auf Lagekarte verorten“

### Requirement: Leere Angaben als Knöpfe

Mit Schreibrecht SHALL die Zeile „Ohne Angabe“ jede leere Angabe als kleinen Knopf „+ Etikett“
zeigen. Sein zugänglicher Name MUST „Etikett eintragen“ lauten. Ein Tipp MUST das Feld in dieser
Zeile öffnen. Ohne Schreibrecht MUST die Zeile der Satz „Ohne Angabe: …“ bleiben.

#### Scenario: Geburtsdatum nachtragen
- **WHEN** jemand mit Schreibrecht in der Zeile „Ohne Angabe“ auf „+ Geburtsdatum“ tippt
- **THEN** öffnet sich das Feld Geburtsdatum an dieser Stelle, mit Fokus in der Eingabe

#### Scenario: Beobachter
- **WHEN** ein Beobachter dieselbe Person ansieht
- **THEN** steht „Ohne Angabe: Geburtsdatum, …“ als Satz ohne Knöpfe

### Requirement: Konflikt je Feld fragt nach

Beim Speichern eines Feldes SHALL die Oberfläche den Wert mitsenden, den das Feld beim Öffnen
hatte. Hat jemand anderes genau dieses Feld inzwischen geändert, MUST der Server mit 409
antworten und nichts schreiben. Die Oberfläche MUST dann „Zwischenzeitlich geändert“ fragen,
den aktuellen Wert nennen und „Überschreiben“ sowie „Verwerfen und neu laden“ anbieten. Eine
Änderung an einem anderen Feld, eine Sichtung, ein Statuswechsel oder eine Änderung von PAT-Nummer
oder Kontamination MUST NOT einen Konflikt auslösen. Ein PATCH ohne mitgesendeten Altwert MUST wie
bisher ohne Feldvergleich schreiben.

#### Scenario: Zwei ändern denselben Namen
- **WHEN** A das Feld Name öffnet, B inzwischen „Meier“ speichert und A „Müller“ speichert
- **THEN** antwortet der Server mit 409, der Name bleibt „Meier“, und A sieht die Rückfrage mit „Meier“

#### Scenario: Sichtung dazwischen
- **WHEN** A das Feld Name öffnet, die UHS inzwischen nachsichtet und A speichert
- **THEN** wird der Name gespeichert, ohne Rückfrage

### Requirement: Prüfungen am Feld

Eine Prüfung ohne Server SHALL am Feld stehen und das Senden verhindern: ein ungültiges
Geburtsdatum, ein geschätztes Alter über 120 oder unter 0, eine ungültige Koordinate, ein Text
über seiner Grenze. Eine Ablehnung des Servers MUST am Feld stehen. Ein Wert MUST NOT still
gekürzt, gekappt oder korrigiert werden.

#### Scenario: Alter über 120
- **WHEN** jemand im Feld „Geschätztes Alter“ 130 eingibt und speichert
- **THEN** steht am Feld „höchstens 120“, und es geht kein Request hinaus

### Requirement: Eine offene Bearbeitung zur Zeit

Hat ein offenes Feld einen geänderten, ungespeicherten Entwurf, SHALL jeder Wechsel auf einen
anderen Pfad die Rückfrage „Bleiben“/„Verwerfen“ zeigen, und das Schließen oder Neuladen des
Browsers MUST warnen. Solange dieser Entwurf besteht, MUST jedes andere Feld der Personendaten
mit Grund gesperrt sein. Ein offenes Feld ohne Änderung MUST keine Rückfrage auslösen.

#### Scenario: Wegnavigieren mit offenem Namen
- **WHEN** jemand im Feld Name „Mül“ eintippt und ohne Speichern in die Betroffenenliste wechselt
- **THEN** erscheint die Rückfrage, und nach „Bleiben“ steht „Mül“ weiter im Feld

### Requirement: Ohne Netz gesperrt

Ohne Verbindung zum Server SHALL jede Angabe der Personendaten und „Zustand / Verdacht“ im
Patientenkopf gesperrt sein, mit einem sichtbaren Grund am Feld. Eine Änderung der Personendaten
MUST NOT vorgemerkt werden.

#### Scenario: Tablet ohne Netz
- **WHEN** am UHS-Tablet ohne Netz das Detail einer Person offen ist
- **THEN** lassen sich weder „+ Name“ noch ein vorhandener Wert öffnen, und am Abschnitt steht der Grund

### Requirement: Geburtsdatum als Kalenderdatum

Das Geburtsdatum SHALL als Kalenderdatum ohne Uhrzeit und Zone eingegeben und als „TT.MM.JJJJ“
angezeigt werden; gespeichert wird `YYYY-MM-DD`. Die Eingabe MUST „TT.MM.JJJJ“, „T.M.JJJJ“,
„TT.MM.JJ“ und `YYYY-MM-DD` lesen; ein zweistelliges Jahr MUST als das jüngste Jahr gelesen werden,
das nicht in der Zukunft liegt. Ein Datum in der Zukunft oder ein ungültiges Datum MUST am Feld
abgelehnt werden. Der Server MUST ein Geburtsdatum, das nicht `YYYY-MM-DD` ist oder in der Zukunft
liegt, mit 400 abweisen. Ein schon gespeicherter Wert in anderer Form MUST unverändert angezeigt
werden.

#### Scenario: Zweistelliges Jahr
- **WHEN** im Jahr 2026 „01.02.80“ eingegeben wird
- **THEN** speichert die Oberfläche `1980-02-01` und zeigt „01.02.1980“

#### Scenario: Zukunft
- **WHEN** ein Geburtsdatum nach heute eingegeben wird
- **THEN** steht am Feld ein Prüffehler, und es geht kein Request hinaus
