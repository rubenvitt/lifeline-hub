# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
