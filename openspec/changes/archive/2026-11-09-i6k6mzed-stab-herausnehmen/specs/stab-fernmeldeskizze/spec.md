# Spec Delta

## MODIFIED Requirements

### Requirement: Zweite Darstellung des Funkplans

Die Fernmeldeskizze SHALL als zweite Darstellung der Funkplan-Seite im Modul Fernmeldewesen
erreichbar sein, als Reiter „Fernmeldeskizze“ neben „Funkplan“, „Sprechgruppen“ und
„Kommunikationsplan“. Die Sichtvorgabe `?ansicht=skizze` öffnet die Skizze, danach wird der
Parameter aus der Adresse entfernt, ein unbrauchbarer Wert ebenso. Die Skizze MUST NOT als eigenes
Modul erscheinen. Sie MUST Sichtbarkeit und Sperre des Moduls Fernmeldewesen erben.

#### Scenario: Umschalten

- **WHEN** eine Person mit Leserecht auf das Fernmeldewesen den Funkplan öffnet und den Reiter
  „Fernmeldeskizze“ wählt
- **THEN** zeigt die Seite die Fernmeldeskizze statt der Tabelle, und das Lücken-Paneel bleibt
  stehen

#### Scenario: Sichtvorgabe aus einem Link

- **WHEN** eine Person `/einsaetze/:id/fernmeldewesen?ansicht=skizze` öffnet
- **THEN** steht die Darstellung auf „Fernmeldeskizze“, und `ansicht` ist aus der Adresse entfernt

#### Scenario: Sichtvorgabe über die alte Adresse

- **WHEN** eine Person `/einsaetze/:id/stab/funkplan?ansicht=skizze` öffnet
- **THEN** landet sie im Modul Fernmeldewesen in der Darstellung „Fernmeldeskizze“

#### Scenario: Unbrauchbarer Wert

- **WHEN** eine Person `?ansicht=quatsch` öffnet
- **THEN** bleibt die Darstellung „Funkplan“, und der Parameter ist aus der Adresse entfernt

#### Scenario: Stab gesperrt

- **WHEN** das Fernmeldewesen für die Person frei ist
- **THEN** zeigt die Skizze alle Elemente, und eine Person mit Schreibrecht kann sie bearbeiten

#### Scenario: Fernmeldewesen gesperrt

- **WHEN** das Modul Fernmeldewesen für die Person gesperrt ist und sie `?ansicht=skizze` öffnet
- **THEN** sieht sie weder Tabelle noch Skizze, sondern den einheitlichen Hinweis für
  „Fernmeldewesen“

### Requirement: Fehlende Quellen werden benannt

Sind die Abschnitte gesperrt oder nicht geladen, SHALL die Skizze statt der Fläche den Grund nennen
und MUST NOT Einheiten ohne Abschnitt zeigen. Fehlen nur die Einheiten, die Fahrzeuge, die
Mitglieder, die externen Stellen oder die Daten der Skizze, SHALL die Skizze das Übrige zeigen
und je fehlender Quelle den Grund nennen. Eine fehlende Quelle MUST NOT als leerer Bestand
erscheinen. Die Mitglieder SHALL die Skizze ohne eigenes Modulrecht abrufen.

#### Scenario: Abschnitte gesperrt

- **WHEN** die Abschnittsliste mit 403 abgelehnt wird
- **THEN** zeigt die Skizze „Abschnitte: nicht freigegeben“ und keine Fläche

#### Scenario: Einheiten nicht geladen

- **WHEN** der Abruf der Einheiten scheitert
- **THEN** zeigt die Skizze die Abschnitte an ihren Schienen und den Hinweis „Einheiten: nicht
  geladen“

#### Scenario: Externe Stellen nicht geladen

- **WHEN** der Abruf des Kommunikationsplans scheitert
- **THEN** zeigt die Skizze Führungsstelle, Abschnitte und Einheiten und den Hinweis „Externe
  Stellen: nicht geladen“

#### Scenario: Fahrzeuge gesperrt

- **WHEN** das Modul Fahrzeuge für die Person gesperrt ist
- **THEN** zeigt die Skizze alle Kästen ohne Führungsmittel und den Hinweis „Fahrzeuge: nicht
  freigegeben“

#### Scenario: Stab nicht frei

- **WHEN** das Fernmeldewesen frei ist, der Abruf der Mitglieder aber scheitert
- **THEN** zeigt der Kasten „Einsatzleitung“ keine Sachgebietszeichen, die Skizze nennt
  „Mitglieder: nicht geladen“, und alles Übrige steht vollständig

### Requirement: Führungsmittel und Funktionen im Kasten

Jeder Führungsstellen-Kasten SHALL die dort eingesetzten Führungsmittel und Funktionen als kleine
taktische Zeichen zeigen, je mit einem Wort darunter, zuerst die Funktionen, dann die
Führungsmittel.

- Führungsmittel eines Abschnitts SHALL jedes disponierte Fahrzeug mit der Fachaufgabe Führung
  sein (dieselbe Regel wie die Lagekarte, ein manuell gesetztes Zeichen gewinnt), dessen Einheit in
  der Führungsorganisation unter diesem Abschnitt hängt und unter keinem tieferen. Das Wort ist der
  Fahrzeugtyp, sonst der Funkrufname. Jedes Fahrzeug MUST höchstens einmal im Bild stehen.
- Führungsmittel des Kastens „Einsatzleitung“ SHALL jedes der eigenen Führungsstelle zugeordnete
  Fahrzeug sein, unabhängig von seiner Fachaufgabe, mit Zeichen, Wort und Titel nach denselben
  Regeln wie im Abschnittskasten (LFH-1106). Ein solches Fahrzeug MUST NOT zugleich in einem
  Abschnittskasten stehen. Ohne Zuordnung MUST der Kasten „Einsatzleitung“ bleiben wie ohne diese
  Angabe.
- Ein Abschnitt mit eingetragener Leitung SHALL das Zeichen „EAL“ tragen, ein Unterabschnitt
  „UEAL“.
- Der Kasten „Einsatzleitung“ SHALL je Sachgebiet S1 bis S6 genau ein Zeichen mit dem Kürzel
  tragen, wenn mindestens ein Mitglied des Einsatzes dieses Sachgebiet in seiner Mitgliedschaft
  führt; ein Sachgebiet ohne Mitglied MUST NOT im Kasten stehen.
- Personennamen MUST NOT erscheinen. Die Zeichen sind keine Elemente: sie tragen keine
  Stichleitung, keine Lücke und keinen eigenen Fokus.
- Der Kasten SHALL um die Zeilen dieser Zeichen wachsen, auf dem Bildschirm, im Auto-Layout und im
  Druck gleich; ein langes Wort MUST umbrechen und MUST NOT gekürzt werden. Ohne Führungsmittel und
  Funktionen MUST der Kasten so hoch bleiben wie ohne diese Anforderung.

#### Scenario: Abschnitt mit ELW 1 und Leitung

- **WHEN** der Abschnitt „EA 1“ mit eingetragener Leitung die Einheit „FüGr EA 1“ führt, der das
  Fahrzeug „Florian Musterstadt 11/1“ vom Typ „ELW 1“ disponiert ist
- **THEN** zeigt der Kasten „EA 1“ das Zeichen „EAL“ und ein Fahrzeugzeichen mit „ELW 1“, und
  „FüGr EA 1“ steht wie bisher als Einheit darunter

#### Scenario: Fahrzeug im Unterabschnitt

- **WHEN** ein Kommandowagen einer Einheit des Unterabschnitts „EA 1.1“ disponiert ist
- **THEN** steht er im Kasten „EA 1.1“ und nicht im Kasten „EA 1“

#### Scenario: Fahrzeug ohne Abschnitt

- **WHEN** ein ELW 2 keiner Einheit oder einer Einheit ohne Abschnitt disponiert ist und der
  eigenen Führungsstelle nicht zugeordnet ist
- **THEN** erscheint er in keinem Kasten

#### Scenario: ELW 2 der Einsatzleitung

- **WHEN** der ELW 2 „Florian Musterstadt 10/1“ der eigenen Führungsstelle zugeordnet ist und der
  Einheit „FüGr EL“ im Abschnitt „EA 1“ angehört
- **THEN** zeigt der Kasten „Einsatzleitung“ nach den Sachgebieten ein Fahrzeugzeichen mit „ELW 2“,
  und der Kasten „EA 1“ zeigt ihn nicht

#### Scenario: ELW 2 ohne Einheit an der Führungsstelle

- **WHEN** ein der Führungsstelle zugeordneter ELW 2 keiner Einheit angehört
- **THEN** steht er im Kasten „Einsatzleitung“

#### Scenario: Fahrzeuge nicht freigegeben

- **WHEN** der Führungsstelle ein Fahrzeug zugeordnet ist, die Fahrzeuge aber nicht freigegeben sind
- **THEN** steht im Kasten „Einsatzleitung“ kein Fahrzeugzeichen

#### Scenario: Stab der Einsatzleitung

- **WHEN** ein Mitglied S3 und zwei Mitglieder S2 in ihrer Mitgliedschaft führen und kein Mitglied S6
- **THEN** zeigt der Kasten „Einsatzleitung“ die Zeichen „S2“ und „S3“ je einmal in dieser Folge,
  kein „S6“ und keinen Namen

#### Scenario: Druck in Graustufen

- **WHEN** die Skizze mit einem Abschnitt mit „EAL“ und „ELW 1“ auf A4 quer gedruckt wird
- **THEN** stehen beide Zeichen mit ihrem Wort im Kasten, und der Kasten ist im Druck so hoch wie
  am Bildschirm
