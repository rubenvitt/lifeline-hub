# nachforderung-einheit Specification

## Purpose
Was auf eine Nachforderung hin an Kräften eingetroffen ist, steht ohne zweite Erfassung als
Einheit im Einsatz und, wenn die Nachforderung einen Bereitstellungsraum als Ziel hat, in dessen
Belegung: Aus einer eingetroffenen Nachforderung entstehen Einheiten mit den Rufnamen der Zusage,
die auf die Nachforderung verweisen. Die Nachforderung zeigt, welche Einheiten aus ihr stammen,
und die Einheit, woher sie kommt (LLH-1383). Am Bereitstellungsraum des Ziels steht schon vor dem
Eintreffen, wer erwartet wird, und das Eintreffen am Raum verknüpft die Einheit mit der
Nachforderung (LLH-1387), auch ein Fahrzeug ohne Einheit, das dabei zur Einheit wird (LLH-1444).
Eine Fehlübernahme lässt sich je Einheit nachvollziehbar stornieren,
auch mit Buchung im Raum (LLH-1388). Die Übernahme macht ein gleichnamiges Fahrzeug ohne Einheit zur
Einheit (LLH-1448), und die Karte trennt am Raum verknüpfte von übernommenen Einheiten (LLH-1445).

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
- **WHEN** eine neue Einheit „83-1“ entstehen soll und im Einsatz schon eine aktive Einheit oder ein aktives Fahrzeug einer Einheit so heißt
- **THEN** antwortet der Server mit 422 und nennt den Namen, und es entsteht keine Einheit

#### Scenario: Mehr als angefordert
- **WHEN** aus einer Nachforderung über 2 Einheiten, aus der schon eine Einheit übernommen ist, zwei weitere übernommen werden sollen
- **THEN** antwortet der Server mit 422, und es entsteht keine Einheit

### Requirement: Übernahme überführt ein gleichnamiges Fahrzeug ohne Einheit

Gleicht ein neuer Eintrag der Übernahme dem Funkrufnamen genau eines aktiven Fahrzeugs ohne
Einheit, SHALL das System dieses Fahrzeug in derselben Transaktion zur Einheit machen wie beim
Eintreffen mit Verweis (Name, Funkrufname, Soll, Fahrzeug und Besatzung ohne Einheit), mit dem
gewählten Typ, statt mit 422 abzulehnen. Die Einheit MUST als von der Übernahme angelegt gelten.

#### Scenario: RTW 2 steht als Fahrzeug im Einsatz
- **WHEN** aus der eingetroffenen Nachforderung „2× RTW“ der Eintrag „RTW 2“ übernommen wird und im Einsatz das Fahrzeug „RTW 2“ ohne Einheit mit Besatzung „Anna“ geführt wird
- **THEN** gibt es die Einheit „RTW 2“ vom gewählten Typ mit dem Fahrzeug und „Anna“, sie verweist auf die Nachforderung, und die Nachforderung nennt sie
- **AND** das ETB enthält genau einen neuen Eintrag „Nachforderung 2× RTW: als Einheit übernommen (RTW 2 aus Fahrzeug), Besatzung: Anna“ mit Verweis auf die Nachforderung

#### Scenario: Storno der Überführung
- **WHEN** die Übernahme der aus dem Fahrzeug entstandenen Einheit „RTW 2“ storniert wird
- **THEN** ist die Einheit aufgelöst, das Fahrzeug und „Anna“ gehören keiner Einheit mehr an, und das ETB nennt „Einheit aufgelöst“

#### Scenario: Zwei gleichnamige Fahrzeuge ohne Einheit
- **WHEN** im Einsatz zwei aktive Fahrzeuge ohne Einheit „RTW 2“ heißen und „RTW 2“ übernommen werden soll
- **THEN** antwortet der Server mit 422 und nennt den Namen, und es entsteht keine Einheit

### Requirement: Überführtes Fahrzeug macht der Einheit im Raum Platz

Steht das überführte Fahrzeug in einem Bereitstellungsraum, MUST es dort austreten und die neue
Einheit in denselben Raum eintreten, zu dem Zeitpunkt, zu dem das Fahrzeug eingetreten war; mit
oder ohne Buchung im Raum des Ziels bleibt sie dort. Ist das Fahrzeug im Raum abgerufen, MUST der
Server mit 409 antworten und nichts anlegen.

#### Scenario: Fahrzeug steht im BR Nord
- **WHEN** das Fahrzeug „RTW 2“ ohne Einheit im BR Nord steht und „RTW 2“ aus einer Nachforderung übernommen wird, mit oder ohne Haken „In BR … eintragen“
- **THEN** zeigt der Verlauf von BR Nord den Austritt des Fahrzeugs und den Eintritt der Einheit „RTW 2“ zum Zeitpunkt, zu dem das Fahrzeug eingetreten war, und die Einheit steht im BR Nord

#### Scenario: Fahrzeug ist abgerufen
- **WHEN** das Fahrzeug „RTW 2“ ohne Einheit im BR Nord abgerufen ist und „RTW 2“ übernommen werden soll
- **THEN** antwortet der Server mit 409 und nennt den Abruf, und es entsteht keine Einheit
- **AND** nach „Abruf aufheben“ gelingt die Übernahme, und die Einheit tritt zum Zeitpunkt ein, zu dem das Fahrzeug eingetreten war

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
- **WHEN** das gekoppelte Gerät eines Bereitstellungsraums die Nachforderungsliste liest, eine Stufe schaltet oder eine Übernahme versucht, auch mit Ziel des eigenen Raums
- **THEN** antwortet der Server mit 403

### Requirement: Rücknahme nach Übernahme als Einheit gesperrt

Ist aus einer Nachforderung mindestens eine Einheit übernommen oder am Raum mit ihr verknüpft, MUST
jede Rücknahme einer Stufe (auch „Eingetroffen“ auf „Unterwegs“), das Ablehnen und das Zurückziehen
mit 422 und dem Grund „Aus der Nachforderung sind Einheiten übernommen“ abgelehnt werden, und die
Anzahl MUST NOT unter die Zahl der verknüpften Einheiten sinken (422) (LLH-1387); auch eine
gleichzeitig laufende Übernahme MUST NOT eine zurückgenommene Nachforderung mit Einheiten
hinterlassen. Eine aufgelöste Einheit, die als aufgelöst stehen bleibt, MUST weiter als übernommen
zählen; eine Einheit, deren Übernahme storniert ist, und eine beim Auflösen gelöschte MUST NOT
zählen. Die Oberfläche MUST diese Regel spiegeln, damit kein Bedienelement in die 422 führt
(LLH-1395): „Zurückziehen“ und „Ablehnen“ stehen im Menü der Karte gesperrt mit dem Grund
„(Einheiten verknüpft)“, der Hinweis nach einem Schritt bietet kein „Rückgängig“ und nennt den
Grund, und „Bearbeiten“ sendet keine Anzahl unter der Zahl der verknüpften Einheiten.

#### Scenario: Rückgängig nach der Übernahme
- **WHEN** nach der Übernahme von „83-1“ die Stufe „Eingetroffen“ zurückgenommen werden soll
- **THEN** antwortet der Server mit 422, und die Nachforderung bleibt eingetroffen

#### Scenario: Nach dem Storno
- **WHEN** die einzige übernommene Einheit storniert ist
- **THEN** kann die Stufe „Eingetroffen“ wieder zurückgenommen werden

#### Scenario: Am Raum eingetroffen, noch unterwegs
- **WHEN** an der Nachforderung „2× RTW“ im Status „Unterwegs“ am Raum „83-1“ mit Verweis gebucht ist und die Einsatzleitung sie zurückziehen, ablehnen oder auf „Zugesagt“ zurücksetzen will
- **THEN** antwortet der Server mit 422, und „Eintreffen melden“ bleibt möglich

#### Scenario: Die Karte bietet keinen Weg in die 422
- **WHEN** die Karte „2× RTW“ im Status „Unterwegs“ mit am Raum gebuchter „83-1“ angezeigt wird und die Einsatzleitung „Eintreffen melden“ wählt
- **THEN** stehen „Zurückziehen (Einheiten verknüpft)“ und „Ablehnen (Einheiten verknüpft)“ gesperrt im Menü, und der Hinweis „Status: Eingetroffen · Einheiten verknüpft, kein Rückgängig“ trägt keinen Knopf „Rückgängig“

### Requirement: Storno einer Fehlübernahme

Das System MUST je Einheit „Übernahme stornieren“ anbieten, auch wenn die Übernahme sie in einen
Bereitstellungsraum gebucht hat. Die Übernahme MUST festhalten, ob sie eine Einheit angelegt oder
verknüpft und welchen Eintritt sie gebucht hat. Der Storno MUST in einer Transaktion den Verweis
auf die Nachforderung lösen und genau einen ETB-Systemeintrag mit Verweis auf die Nachforderung
schreiben, der Einheit, Austritt und Folge nennt. Eine von der Übernahme angelegte Einheit MUST
wie im Normalweg aufgelöst werden (Austritt aus ihrem Raum, mit Spur als aufgelöst stehen
bleibend, ohne Spur gelöscht). Eine verknüpfte Einheit MUST aktiv bleiben und MUST nur dann
austreten, wenn der von der Übernahme gebuchte Eintritt noch ihr jüngstes Belegungsereignis ist.
Eine beim Eintreffen am Raum verknüpfte Einheit, auch eine dabei angelegte, MUST aktiv in ihrem
Raum bleiben: Sie steht dort (Entscheidung 24.10.2026, LLH-1449).
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

#### Scenario: Am Raum verknüpft, dann Storno
- **WHEN** „83-1“ am BR Nord mit Verweis auf die Nachforderung „2× RTW“ eingetroffen ist, ob als bekannte Einheit, unangemeldet angelegt oder als Fahrzeug zur Einheit geworden, und die Einsatzleitung an „83-1“ „Übernahme stornieren“ bestätigt
- **THEN** bleibt „83-1“ aktiv im BR Nord und verweist nicht mehr auf die Nachforderung
- **AND** der Verlauf von BR Nord zeigt keinen Austritt, und das ETB nennt „Übernahme von 83-1 storniert, Verknüpfung gelöst“

#### Scenario: Storno an der Einheit
- **WHEN** die Einsatzleitung in der Ansicht einer übernommenen Einheit „Übernahme stornieren“ bestätigt
- **THEN** zeigt das Board die Nachforderung hervorgehoben
- **AND** ohne Freigabe Nachforderungen oder ohne Herkunft steht der Abschnitt „Übernahme stornieren“ nicht da

### Requirement: Erwartete Kräfte am Bereitstellungsraum

Das System SHALL je Bereitstellungsraum die Nachforderungen mit diesem Raum als Ziel im Status
„Zugesagt“ oder „Unterwegs“ liefern, deren Anzahl die verknüpften Einheiten noch nicht erreichen,
geordnet nach erwartetem Eintreffen (ohne Angabe zuletzt). Jeder Eintrag MUST genau Kennung, Art,
Anzahl, Stufe, die Rufnamen der Zusage ohne verknüpfte Einheit gleichen Namens oder
Funkrufnamens, die noch offene Anzahl und das erwartete Eintreffen tragen; Details, Begründung,
Adressat, Ziel als Ort, Ablehnungs- und Rückzugsgrund, Priorität und Ersteller MUST fehlen. Das
Lesen MUST die Rechte am Raum und die Freigabe Nachforderungen verlangen (403); das gekoppelte
Gerät des Raums MUST nur den eigenen Raum lesen (sonst 404).

#### Scenario: Unterwegs zum BR Nord
- **WHEN** die Nachforderung „2× RTW“ mit Ziel „BR Nord“ und Zusage „83-1“, „83-2“ unterwegs ist und „83-1“ schon mit Verweis gebucht ist
- **THEN** nennt die Liste des BR Nord die Nachforderung mit dem Rufnamen „83-2“ und einer offenen Anzahl von 1

#### Scenario: Eingetroffen oder abgelehnt
- **WHEN** eine Nachforderung mit Ziel „BR Nord“ angefordert, eingetroffen, abgelehnt oder zurückgezogen ist
- **THEN** fehlt sie in der Liste des BR Nord

### Requirement: Eintreffen am Raum mit Verweis auf die Nachforderung

Das Eintreffen am Bereitstellungsraum SHALL optional eine Nachforderung nennen; die gebuchte oder
dabei angelegte Einheit MUST dann in derselben Transaktion auf sie verweisen, und die Nachforderung
MUST sie unter ihren Einheiten nennen. Die Nachforderung MUST zum Einsatz gehören und den Raum als
Ziel haben (sonst 404) und zugesagt, unterwegs oder eingetroffen sein (sonst 422); mehr verknüpfte
Einheiten als ihre Anzahl MUST mit 422 abgelehnt werden, eine Einheit mit Verweis auf eine andere
Nachforderung mit 409. Die Stufe der Nachforderung MUST
unverändert bleiben („Eintreffen melden“ bleibt der Führung). Genau ein ETB-Eintrag MUST entstehen
und auf die Nachforderung verweisen: bei einer bekannten Einheit „Nachforderung 2× RTW: 83-1 im BR
Nord eingetroffen“, bei einer neu angelegten der Eintrag ihrer Meldung an die Einsatzleitung, die
statt „unangemeldet“ „aus Nachforderung 2× RTW“ nennt; die neu angelegte Einheit MUST wie jede am
Raum angelegte das Kennzeichen „nicht übernommen“ tragen. Mit Verweis MUST das Eintreffen
zusätzlich die Freigaben Nachforderungen und Einheiten verlangen (403 vor jedem Lesen).

#### Scenario: Bekannte Einheit aus der Nachforderung
- **WHEN** am BR Nord die Einheit „83-1“ mit Verweis auf die unterwegs befindliche Nachforderung „2× RTW“ eintrifft
- **THEN** verweist „83-1“ auf die Nachforderung, die Nachforderung nennt „83-1“ und bleibt unterwegs
- **AND** das ETB enthält genau einen neuen Eintrag „Nachforderung 2× RTW: 83-1 im BR Nord eingetroffen“ mit Verweis auf die Nachforderung

#### Scenario: Ziel ist ein anderer Raum
- **WHEN** am BR Süd eine Kraft mit Verweis auf eine Nachforderung mit Ziel „BR Nord“ eintrifft
- **THEN** antwortet der Server mit 404, und nichts wird gebucht

### Requirement: Fahrzeug ohne Einheit wird beim Eintreffen mit Verweis zur Einheit

Trifft am Bereitstellungsraum ein Fahrzeug ohne Einheit mit Verweis auf eine Nachforderung ein,
SHALL das System es in derselben Transaktion zur Einheit machen wie „Als eigene Einheit führen“:
Name und Funkrufname der Einheit MUST der Funkrufname des Fahrzeugs sein, die Einheit MUST das
Soll des Fahrzeugs tragen, das Fahrzeug MUST ihr angehören und jede aktive Person seiner Besatzung
ohne Einheit MUST mitkommen. Die Einheit MUST statt des Fahrzeugs in den Raum eintreten, ihr
Eintreffen in der Zeitachse tragen, auf die Nachforderung verweisen und unter deren Einheiten
stehen; das Kennzeichen „nicht übernommen“ MUST sie nicht tragen. Ein Fahrzeug, das fremd,
beendet, einer Einheit zugehörig oder schon in einem Raum ist, MUST wie beim Eintritt mit 404 bzw.
409 abgelehnt werden, ohne dass eine Einheit entsteht; ist die Anzahl der Nachforderung erreicht,
MUST das System mit 422 antworten und nichts anlegen. Genau ein ETB-Eintrag MUST entstehen und auf
die Nachforderung verweisen: „Nachforderung 2× RTW: Fahrzeug RTW 2 als Einheit übernommen, im BR
Nord eingetroffen“, mit mitgekommener Besatzung „…, Besatzung: Anna“. Ohne Verweis MUST das
Fahrzeug wie bisher selbst eintreten. Das gekoppelte Gerät des Raums MUST das ebenso dürfen; es
schickt keinen Freitext dafür. Die Oberfläche MUST nach der Doppelbuchungs-Warnung „Diese buchen“
auch bei einem Fahrzeug den Verweis mitschicken.

#### Scenario: RTW 2 kommt als Fahrzeug
- **WHEN** am BR Nord das Fahrzeug „RTW 2“ ohne Einheit mit Besatzung „Anna“ mit Verweis auf die unterwegs befindliche Nachforderung „2× RTW“ eintrifft
- **THEN** gibt es die Einheit „RTW 2“ mit dem Fahrzeug und „Anna“, sie steht im BR Nord und verweist auf die Nachforderung, die Nachforderung nennt sie und bleibt unterwegs
- **AND** das ETB enthält genau einen neuen Eintrag „Nachforderung 2× RTW: Fahrzeug RTW 2 als Einheit übernommen, im BR Nord eingetroffen, Besatzung: Anna“ mit Verweis auf die Nachforderung

#### Scenario: Ohne Verweis bleibt es ein Fahrzeug
- **WHEN** am BR Nord das Fahrzeug „RTW 3“ ohne Einheit ohne Verweis eintrifft
- **THEN** tritt das Fahrzeug selbst ein, und keine Einheit entsteht

#### Scenario: Schon in einem Raum
- **WHEN** das Fahrzeug „RTW 3“ schon im BR Nord steht und mit Verweis noch einmal eintreffen soll
- **THEN** antwortet der Server mit 409, keine Einheit entsteht, und die Nachforderung nennt keine weitere

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
(„2 Einheiten übernommen“). Eine Einheit, deren Verweis die Buchung am Raum gesetzt hat, MUST die
Karte unter „Am Raum eingetroffen: …“ bzw. „2 Einheiten am Raum eingetroffen“ nennen statt unter
„übernommen“, auch nach dem Eintreffen der Nachforderung (LLH-1445). Tragen beide Wege Einheiten,
MUST die Karte beide Gruppen getrennt zeigen. Vor dem Eintreffen der Nachforderung (zugesagt,
unterwegs) MUST jede verknüpfte Einheit als am Raum eingetroffen gelten (LLH-1395). Die Antwort
der Nachforderung MUST dafür die Kennungen der am Raum verknüpften Einheiten tragen. Die Ansicht
einer übernommenen Einheit MUST in den Kopfdaten das Feld „Herkunft“ mit „aus Nachforderung #n“
zeigen, mit Freigabe Nachforderungen als Sprung ins Board mit hervorgehobener Karte.

#### Scenario: Von der Einheit zur Nachforderung
- **WHEN** die Einsatzleitung an der Karte „83-1“ wählt und in der Ansicht der Einheit „aus Nachforderung #4“
- **THEN** zeigt das Board die Nachforderung #4 in ihrer Stufe hervorgehoben

#### Scenario: Am Raum eingetroffen, Nachforderung noch unterwegs
- **WHEN** „83-1“ am Raum mit Verweis auf die Nachforderung „2× RTW“ im Status „Unterwegs“ gebucht ist
- **THEN** nennt die Karte „Am Raum eingetroffen: 83-1 ↗“, nicht „Als Einheit übernommen“

#### Scenario: Eingetroffen mit beiden Wegen
- **WHEN** an der Nachforderung „2× RTW“ „83-1“ am Raum mit Verweis gebucht ist, die Nachforderung dann eingetroffen gemeldet und „83-2“ als Einheit übernommen wird
- **THEN** nennt die Karte „Am Raum eingetroffen: 83-1 ↗“ und getrennt davon „Als Einheit übernommen: 83-2 ↗“

#### Scenario: Ohne Freigabe Einheiten
- **WHEN** dieselbe Karte ohne Freigabe Einheiten angezeigt wird
- **THEN** nennt sie „1 Einheit am Raum eingetroffen“ und „1 Einheit übernommen“

#### Scenario: Verknüpfung vor dieser Änderung
- **WHEN** eine Einheit vor dieser Änderung am Raum verknüpft wurde und die Nachforderung eingetroffen ist
- **THEN** nennt die Karte sie wie bisher unter „Als Einheit übernommen“

### Requirement: Vorschläge für „Wer“

Die Felder „Wer“ beim Erfassen einer Zusage und beim Bearbeiten SHALL mit Freigabe Einheiten die
aktiven Einheiten des Einsatzes vorschlagen, die noch aus keiner Nachforderung stammen (Funkrufname,
sonst Name). Freier Text MUST weiter möglich sein; ohne Freigabe MUST das Feld ohne Liste bleiben.

#### Scenario: Vorschlag aus dem Einsatz
- **WHEN** im Einsatz die Einheit „Florian 2“ geführt wird und die Einsatzleitung eine Zusage erfasst
- **THEN** schlägt „Wer“ „Florian 2“ vor
