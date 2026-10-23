# nachforderung-einheit Specification

## Purpose
Was auf eine Nachforderung hin an Kräften eingetroffen ist, steht ohne zweite Erfassung als
Einheit im Einsatz und, wenn die Nachforderung einen Bereitstellungsraum als Ziel hat, in dessen
Belegung: Aus einer eingetroffenen Nachforderung entstehen Einheiten mit den Rufnamen der Zusage,
die auf die Nachforderung verweisen. Die Nachforderung zeigt, welche Einheiten aus ihr stammen,
und die Einheit, woher sie kommt (LLH-1383). Eine Fehlübernahme lässt sich je Einheit
nachvollziehbar stornieren, auch mit Buchung im Raum (LLH-1388).

## Requirements

### Requirement: Eingetroffene Kräfte als Einheit übernehmen

Das System SHALL aus einer eingetroffenen Nachforderung je Eintrag eine Einheit im selben Einsatz
anlegen oder eine aktive Einheit des Einsatzes verknüpfen können; jede so entstandene oder
verknüpfte Einheit MUST auf die Nachforderung verweisen. Eine neue Einheit MUST den Eintrag als
Namen und Funkrufnamen tragen und den gewählten Einheitstyp. Einheiten, Verweise, Buchungen im Raum
und der ETB-Eintrag MUST in einer Transaktion entstehen; scheitert ein Teil, MUST nichts davon
bestehen bleiben. Insgesamt MUST eine Nachforderung höchstens so viele Einheiten tragen, wie ihre
Anzahl nennt. Die Übernahme MUST genau einen ETB-Systemeintrag schreiben, der auf die Nachforderung
verweist und die Einheiten nennt.

#### Scenario: Zwei RTW übernehmen
- **WHEN** die Einsatzleitung aus der eingetroffenen Nachforderung „2× RTW“ mit der Zusage „83-1“, „83-2“ die Einheiten „83-1“ und „83-2“ vom Typ „RTW“ übernimmt
- **THEN** stehen beide Einheiten im Einsatz, jede mit Verweis auf die Nachforderung
- **AND** die Nachforderung nennt beide Einheiten
- **AND** das ETB enthält genau einen neuen Eintrag „Nachforderung 2× RTW: als Einheiten übernommen (83-1, 83-2)“ mit Verweis auf die Nachforderung

#### Scenario: Name schon im Einsatz
- **WHEN** eine neue Einheit „83-1“ entstehen soll und im Einsatz schon eine aktive Einheit oder ein aktives Fahrzeug so heißt
- **THEN** antwortet der Server mit 422 und nennt den Namen, und es entsteht keine Einheit

#### Scenario: Mehr als angefordert
- **WHEN** aus einer Nachforderung über 2 Einheiten, aus der schon eine Einheit übernommen ist, zwei weitere übernommen werden sollen
- **THEN** antwortet der Server mit 422, und es entsteht keine Einheit

### Requirement: Buchung im Bereitstellungsraum des Ziels

Hat die Nachforderung einen Bereitstellungsraum als Ziel und verlangt die Übernahme die Buchung
dort, MUST das System jede übernommene Einheit, die noch in keinem Raum steht, als Eintritt in
diesem Raum buchen und ihr Eintreffen in der Kräfte-Zeitachse mit der Quelle Bereitstellungsraum
festhalten; Zeitpunkt MUST der Zeitpunkt des Eintreffens der Nachforderung sein. Eine verknüpfte
Einheit, die schon in einem Raum steht, MUST dort bleiben. Ohne Buchung MUST die Übernahme kein
Ereignis in die Kräfte-Zeitachse schreiben. Verlangt die Übernahme die Buchung ohne Ziel Raum, MUST
der Server mit 422 antworten.

#### Scenario: Ziel BR Nord
- **WHEN** die Einsatzleitung „Eintreffen melden“ an der Nachforderung „2× RTW“ mit Ziel „BR Nord“ wählt und danach „Als Einheit übernehmen“ mit dem Haken „In BR Nord eintragen“
- **THEN** stehen „83-1“ und „83-2“ in der Belegung von „BR Nord“ mit je einem Eintritt
- **AND** die Kräfte-Zeitachse jeder Einheit nennt das Eintreffen mit der Quelle Bereitstellungsraum zum Zeitpunkt des Eintreffens der Nachforderung
- **AND** der ETB-Eintrag endet auf „, im BR Nord eingetroffen“

#### Scenario: Verknüpfte Einheit steht schon in einem Raum
- **WHEN** eine schon in „BR Süd“ gebuchte Einheit aus einer Nachforderung mit Ziel „BR Nord“ verknüpft wird
- **THEN** bleibt sie in „BR Süd“, und der ETB-Eintrag nennt unter „im BR Nord eingetroffen“ nur die gebuchten Einheiten

### Requirement: Prüfung der Übernahme

Die Übernahme MUST das Schreibrecht und die Freigabe des Moduls Einheiten verlangen, dazu die
Freigabe des Moduls Nachforderungen und bei einer Buchung im Raum die Freigabe des Moduls
Bereitstellungsräume; ohne diese MUST sie mit 403 antworten, bevor sie die Nachforderung liest.
Eine fehlerhafte Eingabe (keine oder zu viele Einträge, ein Eintrag ohne oder mit beidem von Name
und Einheit, ein leerer oder zu langer Name) MUST mit 400 abgelehnt werden. Eine Nachforderung eines
anderen Einsatzes MUST mit 404 abgelehnt werden, eine Nachforderung, die nicht eingetroffen ist, mit
422. Eine zu verknüpfende Einheit eines anderen Einsatzes MUST mit 404 abgelehnt werden, eine
aufgelöste oder schon aus einer Nachforderung übernommene mit 409.

#### Scenario: Noch unterwegs
- **WHEN** eine Übernahme aus einer Nachforderung im Status „Unterwegs“ versucht wird
- **THEN** antwortet der Server mit 422 „Einheiten werden erst nach dem Eintreffen übernommen“, und es entsteht keine Einheit

#### Scenario: Gekoppeltes Gerät des Raums
- **WHEN** das gekoppelte Gerät eines Bereitstellungsraums Nachforderungen liest oder eine Übernahme versucht, auch mit Ziel des eigenen Raums
- **THEN** antwortet der Server mit 403

### Requirement: Rücknahme nach Übernahme als Einheit gesperrt

Ist aus einer Nachforderung mindestens eine Einheit übernommen, MUST die Rücknahme von
„Eingetroffen“ auf „Unterwegs“ mit 422 und dem Grund „Aus der Nachforderung sind Einheiten
übernommen“ abgelehnt werden; auch eine gleichzeitig laufende Übernahme MUST NOT eine
zurückgenommene Nachforderung mit Einheiten hinterlassen. Eine aufgelöste Einheit, die als
aufgelöst stehen bleibt, MUST weiter als übernommen zählen; eine Einheit, deren Übernahme
storniert ist, und eine beim Auflösen gelöschte MUST NOT zählen.

#### Scenario: Rückgängig nach der Übernahme
- **WHEN** nach der Übernahme von „83-1“ die Stufe „Eingetroffen“ zurückgenommen werden soll
- **THEN** antwortet der Server mit 422, und die Nachforderung bleibt eingetroffen

#### Scenario: Nach dem Storno
- **WHEN** die einzige übernommene Einheit storniert ist
- **THEN** kann die Stufe „Eingetroffen“ wieder zurückgenommen werden

### Requirement: Storno einer Fehlübernahme

Das System MUST je Einheit „Übernahme stornieren“ anbieten, auch wenn die Übernahme sie in einen
Bereitstellungsraum gebucht hat. Die Übernahme MUST festhalten, ob sie eine Einheit angelegt oder
verknüpft und welchen Eintritt sie gebucht hat. Der Storno MUST in einer Transaktion den Verweis
auf die Nachforderung lösen und genau einen ETB-Systemeintrag mit Verweis auf die Nachforderung
schreiben, der Einheit, Austritt und Folge nennt. Eine von der Übernahme angelegte Einheit MUST
wie im Normalweg aufgelöst werden (Austritt aus ihrem Raum, mit Spur als aufgelöst stehen
bleibend, ohne Spur gelöscht). Eine verknüpfte Einheit MUST aktiv bleiben und MUST nur dann
austreten, wenn der von der Übernahme gebuchte Eintritt noch ihr jüngstes Belegungsereignis ist.
Der Storno MUST NOT löschen, was im Raumverlauf oder in der Zeitachse steht. Er MUST
Schreibrecht und Freigabe Einheiten verlangen und ohne Freigabe Nachforderungen mit 403
antworten, bevor er liest; eine Einheit eines anderen Einsatzes MUST mit 404, eine aufgelöste oder
schon stornierte mit 409 und eine ohne Herkunft mit 422 abgelehnt werden. Eine Frist gilt nicht.

#### Scenario: Ziel BR Nord, dann Storno
- **WHEN** „83-1“ und „83-2“ aus der Nachforderung „2× RTW“ mit Ziel „BR Nord“ übernommen und in BR Nord gebucht sind und die Einsatzleitung an „83-1“ „Übernahme stornieren“ bestätigt
- **THEN** ist „83-1“ aufgelöst, steht nicht mehr in BR Nord und verweist nicht mehr auf die Nachforderung
- **AND** der Verlauf von BR Nord zeigt den Austritt von „83-1“
- **AND** das ETB enthält genau einen neuen Eintrag „Nachforderung 2× RTW: Übernahme von 83-1 storniert, aus BR Nord ausgetreten, Einheit aufgelöst“ mit Verweis auf die Nachforderung
- **AND** „Eingetroffen“ bleibt gesperrt, bis auch „83-2“ storniert ist

#### Scenario: Verknüpfte Einheit
- **WHEN** die Übernahme einer verknüpften Einheit storniert wird, die schon vorher in „BR Süd“ stand
- **THEN** bleibt sie aktiv in „BR Süd“, und das ETB nennt „Übernahme von … storniert, Verknüpfung gelöst“

#### Scenario: Storno an der Einheit
- **WHEN** die Einsatzleitung in der Ansicht einer übernommenen Einheit „Übernahme stornieren“ bestätigt
- **THEN** zeigt das Board die Nachforderung hervorgehoben
- **AND** ohne Freigabe Nachforderungen oder ohne Herkunft steht der Abschnitt „Übernahme stornieren“ nicht da

### Requirement: Übernahme an der Karte

An einer eingetroffenen Nachforderung MUST die Oberfläche mit Schreibrecht „Als Einheit
übernehmen“ anbieten, sobald eine Einheit verknüpft ist „Weitere Einheit übernehmen“, solange die
Anzahl nicht erreicht ist. Ohne Freigabe Einheiten MUST der Knopf gesperrt mit „Keine
Berechtigung“ daneben stehen. An einer Karte mit übernommenen Einheiten MUST „Als Material
übernehmen“ entfallen und an einer mit übernommenem Material „Als Einheit übernehmen“. Der Dialog
MUST „Einheiten“ mit den Rufnamen der Zusage vorbelegen, die noch keine verknüpfte Einheit tragen,
„Typ“ mit dem Einheitstyp, dessen Bezeichnung der Art gleicht, und bei Ziel Raum den Haken „In BR …
eintragen“ setzen; ein Eintrag, der einer aktiven Einheit im Einsatz gleicht, MUST vor dem Absenden
als „Schon im Einsatz, wird verknüpft“ genannt und verknüpft statt neu angelegt werden.

#### Scenario: Vorbelegter Dialog
- **WHEN** die Einsatzleitung an der eingetroffenen Karte „2× RTW“ mit Zusage „83-1“, „83-2“ und Ziel „BR Nord“ „Als Einheit übernehmen“ wählt
- **THEN** zeigt der Dialog „83-1“ und „83-2“ unter „Einheiten“, „RTW“ unter „Typ“ und den gesetzten Haken „In BR Nord eintragen“

#### Scenario: Gesperrt ohne Freigabe
- **WHEN** das Modul Einheiten für die Person nicht freigegeben ist
- **THEN** steht „Als Einheit übernehmen“ gesperrt mit „Keine Berechtigung“ daneben

### Requirement: Verweis in beide Richtungen

Die Karte einer Nachforderung MUST ihre übernommenen Einheiten nennen: mit Freigabe Einheiten
„Als Einheit übernommen: …“ mit einem Sprung je Einheit in deren Ansicht, sonst nur die Zahl
(„2 Einheiten übernommen“). Die Ansicht einer übernommenen Einheit MUST in den Kopfdaten das Feld
„Herkunft“ mit „aus Nachforderung #n“ zeigen, mit Freigabe Nachforderungen als Sprung ins Board mit
hervorgehobener Karte.

#### Scenario: Von der Einheit zur Nachforderung
- **WHEN** die Einsatzleitung an der Karte „83-1“ wählt und in der Ansicht der Einheit „aus Nachforderung #4“
- **THEN** zeigt das Board die Nachforderung #4 in ihrer Stufe hervorgehoben

### Requirement: Vorschläge für „Wer“

Die Felder „Wer“ beim Erfassen einer Zusage und beim Bearbeiten SHALL mit Freigabe Einheiten die
aktiven Einheiten des Einsatzes vorschlagen, die noch aus keiner Nachforderung stammen (Funkrufname,
sonst Name). Freier Text MUST weiter möglich sein; ohne Freigabe MUST das Feld ohne Liste bleiben.

#### Scenario: Vorschlag aus dem Einsatz
- **WHEN** im Einsatz die Einheit „Florian 2“ geführt wird und die Einsatzleitung eine Zusage erfasst
- **THEN** schlägt „Wer“ „Florian 2“ vor
