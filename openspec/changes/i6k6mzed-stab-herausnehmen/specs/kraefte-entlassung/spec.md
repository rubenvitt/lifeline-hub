# Spec Delta

## MODIFIED Requirements

### Requirement: Kraft aus dem Einsatz entlassen

Das System SHALL Personal, Fahrzeuge und Material eines Einsatzes entlassen können, ohne die
Disposition zu löschen; Material heißt in Oberfläche, Tagebuch und Doku „aus dem Einsatz
genommen“, auf dem Draht `entlassen`. Die entlassene Kraft MUST mit Zeitpunkt und entlassender
Person erhalten bleiben. Entlassen MUST ihre Bindungen lösen (Einheit, Fahrzeug, Besatzung, UHS,
Führung einer Einheit, Leitung eines Abschnitts, Einsatzleitung, Führungsstelle,
Bereitstellungsraum) und MUST ihre Historie behalten (Auftragsempfänger, Schadensbezug,
Bestätigungen). Entlassen einer Person MUST das Zeitachsen-Ereignis `entlassung` mit Quelle
`disposition` schreiben, sofern sie eine offene Periode hat. Entlassen MUST einen ETB-Eintrag erzeugen und erfordert keine Rückfrage.
Material aus dem Einsatz zu nehmen MUST seinen Ort lösen; danach liegt es ohne Ort (LLH-1224).
Entlassen eines Fahrzeugs MUST seine Beladung (Material auf dem Fahrzeug) im Einsatz lassen und
ohne Ort stellen; der ETB-Eintrag des Fahrzeugs MUST dann „Beladung ohne Ort: n Posten“ nennen,
und jeder freigegebene Posten MUST live aktualisiert werden.

#### Scenario: Zeitachse überlebt Entlassen
- **WHEN** eine Person mit Alarmierung 06:10 und Eintreffen 06:40 um 14:00 entlassen wird
- **THEN** stehen in ihrer Zeitachse Alarmierung, Eintreffen und Entlassung 14:00, und die Person ist weiter im Einsatz geführt

#### Scenario: Bindungen gelöst
- **WHEN** der Führer einer Einheit entlassen wird
- **THEN** hat die Einheit keinen Führer mehr, und die Person gehört keiner Einheit mehr an

#### Scenario: Auftrag bleibt
- **WHEN** eine Person entlassen wird, die Empfänger eines Auftrags ist
- **THEN** nennt der Auftrag sie weiter als Empfänger

#### Scenario: Fahrzeug entlassen
- **WHEN** ein Fahrzeug mit zwei Personen Besatzung, in einer Einheit und in einem Bereitstellungsraum entlassen wird
- **THEN** sind beide Personen weiter im Einsatz, nur ohne Fahrzeug, das Fahrzeug gehört keiner Einheit mehr an, und der Bereitstellungsraum verzeichnet seinen Austritt

#### Scenario: Material aus dem Einsatz genommen
- **WHEN** ein Materialposten an einer UHS aus dem Einsatz genommen wird
- **THEN** liegt er ohne Ort, und das Tagebuch nennt ihn „aus dem Einsatz genommen“

#### Scenario: Fahrzeug mit Beladung entlassen
- **WHEN** ein Fahrzeug mit zwei geladenen Materialposten entlassen wird
- **THEN** bleiben beide Posten im Einsatz, ohne Ort, und das Tagebuch nennt „Beladung ohne Ort: 2 Posten“

#### Scenario: Bereits entlassen
- **WHEN** eine entlassene Kraft erneut entlassen werden soll
- **THEN** antwortet das System mit 409
