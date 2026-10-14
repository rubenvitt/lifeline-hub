# kraefte-entlassung Specification

## Purpose
Eine Kraft verlässt den Einsatz, ohne aus ihm zu verschwinden: Personal wird entlassen, eine
Einheit aufgelöst. Beide bleiben mit Zeitachse, Tagebuch und Bezügen im Nachweis, zählen aber in
keiner Liste, Stärke und Auswahl mehr. Eine Fehldisposition lässt sich kurz nach dem Disponieren
spurlos stornieren, eine entlassene Kraft erneut disponieren.

## Requirements

### Requirement: Kraft aus dem Einsatz entlassen

Das System SHALL Personal eines Einsatzes entlassen können, ohne die Disposition zu löschen.
Die entlassene Kraft MUST mit Zeitpunkt und entlassender Person erhalten bleiben. Entlassen MUST
ihre Bindungen lösen (Einheit, Besatzung, UHS, Führung einer Einheit, Leitung eines Abschnitts,
Stab, Einsatzleitung) und MUST ihre Historie behalten (Auftragsempfänger, Schadensbezug,
Bestätigungen). Entlassen einer Person MUST das Zeitachsen-Ereignis `entlassung` mit Quelle
`disposition` schreiben, sofern sie eine offene Periode hat. Entlassen MUST einen ETB-Eintrag erzeugen und erfordert keine Rückfrage.

#### Scenario: Zeitachse überlebt Entlassen
- **WHEN** eine Person mit Alarmierung 06:10 und Eintreffen 06:40 um 14:00 entlassen wird
- **THEN** stehen in ihrer Zeitachse Alarmierung, Eintreffen und Entlassung 14:00, und die Person ist weiter im Einsatz geführt

#### Scenario: Bindungen gelöst
- **WHEN** der Führer einer Einheit entlassen wird
- **THEN** hat die Einheit keinen Führer mehr, und die Person gehört keiner Einheit mehr an

#### Scenario: Auftrag bleibt
- **WHEN** eine Person entlassen wird, die Empfänger eines Auftrags ist
- **THEN** nennt der Auftrag sie weiter als Empfänger

#### Scenario: Bereits entlassen
- **WHEN** eine entlassene Kraft erneut entlassen werden soll
- **THEN** antwortet das System mit 409

### Requirement: Einheit auflösen

Das System SHALL eine Einheit auflösen können, ohne ihre Zeile zu löschen. Auflösen MUST zuerst
alle Kräfte von der Einheit lösen und danach das Ereignis `entlassung` an der Einheit schreiben,
das keine Person erreicht. Zeitachse, abgelöste Schichten und ETB-Verknüpfungen der Einheit MUST
erhalten bleiben. Eine Einheit ohne Zeitachse, Schicht, ETB-Verknüpfung, Belegung eines
Bereitstellungsraums, ohne Auftrag, Meldung, Dokument und Verteiler mit Verweis auf sie und ohne
jede (auch beendete) Kraft mit Verweis auf sie MAY stattdessen gelöscht werden.

#### Scenario: Aufgelöste Einheit bleibt im Nachweis
- **WHEN** die Einheit „Florian 1“ mit Eintreffen 06:40 um 15:00 aufgelöst wird
- **THEN** trägt ihre Zeitachse Eintreffen und Entlassung, und ihre ETB-Einträge nennen sie weiter

#### Scenario: Leere Einheit gelöscht
- **WHEN** eine eben angelegte Einheit ohne Kräfte und ohne Spur aufgelöst wird
- **THEN** ist sie gelöscht

### Requirement: Fehldisposition stornieren

Das System SHALL eine Kraft stornieren können, die versehentlich disponiert wurde. Ein Storno
MUST die Kraft als storniert beenden und jedes nicht gestrichene Zeitachsen-Ereignis der Kraft
mit dem Grund „Fehldisposition storniert“ streichen. Ein Storno MUST nur gelingen, solange die
Kraft aktiv ist, nie entlassen war, keine Bindung hat, keine andere Spur als die Ereignisse aus
der Disposition trägt und die Disposition höchstens 15 Minuten zurückliegt. Sonst MUST das System mit 422 und
dem Grund als Satz antworten, bei einer schon beendeten Kraft mit 409. Die Oberfläche MUST vor dem
Storno mit einem Satz zur Folge rückfragen.

#### Scenario: Storno direkt nach dem Disponieren
- **WHEN** eine Person um 10:00 disponiert und um 10:05 storniert wird
- **THEN** ist ihr Alarmierungsereignis gestrichen, und sie erscheint in keiner Liste und keinem Nachweis

#### Scenario: Storno mit Spur
- **WHEN** eine Person storniert werden soll, die schon eingetroffen ist
- **THEN** antwortet das System mit 422, und der Grund steht am Ort der Handlung

#### Scenario: Frist abgelaufen
- **WHEN** eine Person 20 Minuten nach dem Disponieren storniert werden soll
- **THEN** antwortet das System mit 422 „nur in den ersten 15 Minuten nach der Disposition“

### Requirement: Erneut disponieren

Das System SHALL eine entlassene oder stornierte Kraft erneut disponieren, indem es ihre
bestehende Zeile reaktiviert. Das Disponieren einer beendeten Stamm-Kraft MUST gelingen statt
mit 409 abgelehnt zu werden und MUST den Initialstatus neu setzen, sodass eine neue Periode
beginnt. Gestrichene Ereignisse MUST gestrichen bleiben.

#### Scenario: Stamm-Person kommt zurück
- **WHEN** eine um 14:00 entlassene Stamm-Person um 18:00 erneut disponiert wird
- **THEN** ist sie aktiv, und ihre Zeitachse zeigt eine zweite Periode ab 18:00

#### Scenario: Rückgängig nach Entlassen
- **WHEN** die Person direkt nach dem Entlassen „Rückgängig“ wählt
- **THEN** ist die Kraft wieder aktiv

### Requirement: Beendete Kräfte in Listen und Zahlen

Das System SHALL entlassene und stornierte Kräfte sowie aufgelöste Einheiten aus jeder Liste,
Auswahl, Karte, Stärke, Statusverteilung und jedem Zähler herauslassen. Entlassene Kräfte und
aufgelöste Einheiten MUST auf Anfrage getrennt abrufbar sein. Die Personalliste MUST sie als
eingeklappten Block „Entlassen“ mit der Aktion „Erneut disponieren“ zeigen, die Einheitenliste
aufgelöste Einheiten als eingeklappten Block „Aufgelöst“. Jeder Schreibweg an einer
beendeten Kraft außer dem erneuten Disponieren MUST mit 409 antworten. Ein Test MUST fehlschlagen,
wenn eine Abfrage der Tabellen für Personal und Einheiten außerhalb einer Ausnahmeliste den
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

### Requirement: Entlassene im Nachweis

Meldebild-Druck, die Übernahme des Meldebilds in einen Lagebericht und der Einsatzbericht SHALL
entlassene Kräfte als eigenen Block „Entlassen“ führen. Stornierte Kräfte MUST in keinem
Nachweis erscheinen.

#### Scenario: Meldebild nennt Entlassene
- **WHEN** das Meldebild mit zwei entlassenen Personen in einen Lagebericht übernommen wird
- **THEN** enthält der Text einen Block „Entlassen“ mit beiden, und die Stärke zählt sie nicht
