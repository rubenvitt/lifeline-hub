# kraefte-entlassung Specification

## Purpose
Eine Kraft verlässt den Einsatz, ohne aus ihm zu verschwinden: Personal und Fahrzeuge werden
entlassen, Material aus dem Einsatz genommen, eine Einheit aufgelöst. Sie bleiben mit Zeitachse,
Tagebuch und Bezügen im Nachweis, zählen aber in keiner Liste, Stärke und Auswahl mehr. Eine Fehldisposition lässt sich kurz nach dem Disponieren
spurlos stornieren, eine entlassene Kraft erneut disponieren.

## Requirements

### Requirement: Kraft aus dem Einsatz entlassen

Das System SHALL Personal, Fahrzeuge und Material eines Einsatzes entlassen können, ohne die
Disposition zu löschen; Material heißt in Oberfläche, Tagebuch und Doku „aus dem Einsatz
genommen“, auf dem Draht `entlassen`. Die entlassene Kraft MUST mit Zeitpunkt und entlassender
Person erhalten bleiben. Entlassen MUST ihre Bindungen lösen (Einheit, Fahrzeug, Besatzung, UHS,
Führung einer Einheit, Leitung eines Abschnitts, Stab, Einsatzleitung, Führungsstelle,
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

### Requirement: Einheit auflösen

Das System SHALL eine Einheit auflösen können, ohne ihre Zeile zu löschen. Auflösen MUST zuerst
alle Kräfte von der Einheit lösen und danach das Ereignis `entlassung` an der Einheit schreiben,
das keine Person erreicht. Zeitachse, abgelöste Schichten, ETB-Verknüpfungen und
Verpflegungsausgaben an die Einheit MUST erhalten bleiben. Eine Einheit ohne Zeitachse, Schicht,
ETB-Verknüpfung, Belegung eines Bereitstellungsraums, ohne Auftrag, Meldung, Dokument, Verteiler
und Verpflegungsausgabe (auch eine zurückgenommene) mit Verweis auf sie und ohne jede (auch
beendete) Kraft mit Verweis auf sie MAY stattdessen gelöscht werden.

#### Scenario: Aufgelöste Einheit bleibt im Nachweis
- **WHEN** die Einheit „Florian 1“ mit Eintreffen 06:40 um 15:00 aufgelöst wird
- **THEN** trägt ihre Zeitachse Eintreffen und Entlassung, und ihre ETB-Einträge nennen sie weiter

#### Scenario: Leere Einheit gelöscht
- **WHEN** eine eben angelegte Einheit ohne Kräfte und ohne Spur aufgelöst wird
- **THEN** ist sie gelöscht

#### Scenario: Verpflegte Einheit bleibt
- **WHEN** eine Einheit ohne Kräfte und ohne andere Spur, an die eine Verpflegungsausgabe ging, aufgelöst wird
- **THEN** bleibt sie als aufgelöst stehen, und die Ausgabe nennt sie weiter als Empfänger

#### Scenario: Verpflegte Einheit stornieren
- **WHEN** eine Einheit ohne andere Spur, an die eine Verpflegungsausgabe ging, als Fehldisposition storniert werden soll
- **THEN** antwortet das System mit 422 und dem Grund, dass eine Verpflegungsausgabe die Einheit nennt

### Requirement: Fehldisposition stornieren

Das System SHALL eine Kraft stornieren können, die versehentlich disponiert wurde. Ein Storno
MUST die Kraft als storniert beenden und jedes nicht gestrichene Zeitachsen-Ereignis der Kraft
mit dem Grund „Fehldisposition storniert“ streichen. Ein Storno MUST nur gelingen, solange die
Kraft aktiv ist, nie entlassen war, keine Bindung hat, keine andere Spur als die Ereignisse aus
der Disposition trägt und die Disposition höchstens 15 Minuten zurückliegt. Bei einem Fahrzeug
MUST auch ein Statuswechsel, eine Belegung eines Bereitstellungsraums, die Führungsstelle und ein
Auftrag als Spur gelten, ebenso eine Beladung mit Material. Ein Materialposten MUST für einen
Storno ohne Ort sein (LLH-1224). Sonst MUST das System mit 422 und
dem Grund als Satz antworten, bei einer schon beendeten Kraft mit 409. Die Oberfläche MUST vor dem
Storno mit einem Satz zur Folge rückfragen.

#### Scenario: Storno direkt nach dem Disponieren
- **WHEN** eine Person um 10:00 disponiert und um 10:05 storniert wird
- **THEN** ist ihr Alarmierungsereignis gestrichen, und sie erscheint in keiner Liste und keinem Nachweis

#### Scenario: Storno mit Spur
- **WHEN** eine Person storniert werden soll, die schon eingetroffen ist
- **THEN** antwortet das System mit 422, und der Grund steht am Ort der Handlung

#### Scenario: Fahrzeug mit Statuswechsel
- **WHEN** ein Fahrzeug fünf Minuten nach dem Disponieren auf „Auf Anfahrt“ steht und storniert werden soll
- **THEN** antwortet das System mit 422, und das Fahrzeug lässt sich entlassen

#### Scenario: Fahrzeug mit Beladung
- **WHEN** ein Fahrzeug, auf dem ein Materialposten liegt, storniert werden soll
- **THEN** antwortet das System mit 422 „Das Fahrzeug hat Material geladen; erst lösen oder das Fahrzeug entlassen“

#### Scenario: Material an einem Ort
- **WHEN** ein Materialposten an einer Einheit storniert werden soll
- **THEN** antwortet das System mit 422, und der Posten bleibt an der Einheit

#### Scenario: Frist abgelaufen
- **WHEN** eine Person 20 Minuten nach dem Disponieren storniert werden soll
- **THEN** antwortet das System mit 422 „nur in den ersten 15 Minuten nach der Disposition“

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt; ein schon entlassenes Fahrzeug MUST beim Sammel-Disponieren mit dem Grund „entlassen“
abgelehnt werden, ein storniertes reaktiviert werden. Material MUST beim Reaktivieren Menge und
Status behalten; das Disponieren aus dem Stamm legt bei Material immer eine neue Zeile an.
Gestrichene Ereignisse MUST gestrichen bleiben.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Entlassen „Rückgängig“ wählt
- **THEN** ist die Kraft wieder aktiv

#### Scenario: Material kommt zurück
- **WHEN** ein defekter Posten mit Menge 4 aus dem Einsatz genommen und erneut disponiert wird
- **THEN** steht er wieder in der Liste, mit Menge 4 und Status „defekt“, ohne Ort

### Requirement: Beendete Kräfte in Listen und Zahlen

Das System SHALL entlassene und stornierte Kräfte sowie aufgelöste Einheiten aus jeder Liste,
Auswahl, Karte, Stärke, Statusverteilung und jedem Zähler herauslassen. Entlassene Kräfte und
aufgelöste Einheiten MUST auf Anfrage getrennt abrufbar sein. Personal- und Fahrzeugliste MUST
sie als eingeklappten Block „Entlassen“ mit der Aktion „Erneut disponieren“ zeigen, die
Materialliste als Block „Aus dem Einsatz genommen“, die Einheitenliste aufgelöste Einheiten als
eingeklappten Block „Aufgelöst“. Jeder Schreibweg an einer beendeten Kraft außer dem erneuten
Disponieren MUST mit 409 antworten. Ein Test MUST fehlschlagen, wenn eine Abfrage der vier
Kräftetabellen (Personal, Einheiten, Fahrzeuge, Material) außerhalb einer Ausnahmeliste den
Zustand nicht prüft.

#### Scenario: Stärke ohne Entlassene
- **WHEN** von zwölf Personen einer Einheit zwei entlassen sind
- **THEN** zählen Meldebild, Statusband und Lagemonitor zehn

#### Scenario: Block Entlassen
- **WHEN** die Personalliste zwei Entlassene hat
- **THEN** zeigt sie unter den aktiven einen eingeklappten Block „Entlassen (2)“

#### Scenario: Status an Entlassener
- **WHEN** der Status einer entlassenen Person gesetzt werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Besatzung an entlassenem Fahrzeug
- **WHEN** einem entlassenen Fahrzeug eine Person als Besatzung zugeordnet werden soll
- **THEN** antwortet das System mit 409

### Requirement: Entlassene im Nachweis

Meldebild-Druck, die Übernahme des Meldebilds in einen Lagebericht und der Einsatzbericht SHALL
entlassene Personen als eigenen Block „Entlassen“ führen. Meldebild-Druck und die Übernahme des
Meldebilds SHALL dort auch entlassene Fahrzeuge führen und aus dem Einsatz genommenes Material als
eigenen Block „Aus dem Einsatz genommen“, jeden Eintrag mit dem Zeitpunkt seines Endes. Scheitert
eine dieser Listen, MUST der Block das sagen („nicht geladen“), statt sie wegzulassen. Stornierte
Kräfte MUST in keinem Nachweis erscheinen.

#### Scenario: Meldebild nennt Entlassene
- **WHEN** das Meldebild mit zwei entlassenen Personen in einen Lagebericht übernommen wird
- **THEN** enthält der Text einen Block „Entlassen“ mit beiden, und die Stärke zählt sie nicht

#### Scenario: Fahrzeug und Material im Nachweis
- **WHEN** das Meldebild übernommen wird, nachdem ein Fahrzeug entlassen, ein zweites storniert
  und ein Materialposten aus dem Einsatz genommen wurde
- **THEN** steht das entlassene Fahrzeug mit Zeitpunkt im Block „Entlassen“, der Materialposten mit
  Zeitpunkt im Block „Aus dem Einsatz genommen“, und das stornierte Fahrzeug fehlt
