# nachforderung-zusage Specification

## Purpose
Die Zusage einer Nachforderung trägt, was zugesagt ist, wer kommt und wann: Menge, Rufnamen und
voraussichtliches Eintreffen. Eine Teilzusage teilt die Nachforderung in zwei Positionen. Ein
verpasstes Eintreffen fällt am Board auf, ohne Alarm. Die eigene Führung kann eine offene
Nachforderung zurückziehen oder bearbeiten (LLH-1097, Teil a).

## Requirements

### Requirement: Zusage mit Menge, Wer und Eintreffen
„Zusage erfassen“ SHALL an der Karte ein Formular öffnen, kein Modal: „Zugesagt“ mit der
angeforderten Anzahl als Vorgabe, „Wer“ (Rufnamen oder freie Angaben, mehrere) und „Eintreffen
erwartet“ (ohne Platzhalterwert). Enter MUST absenden, auch im Mengenfeld. Gesendet wird
`POST …/nachforderungen/{id}/zusage`. Der Server MUST prüfen: Menge mindestens 1 und höchstens die
angeforderte Anzahl, höchstens so viele Einträge unter „Wer“ wie zugesagt, je Eintrag höchstens
100 Zeichen und höchstens 20 Einträge, ein Eintreffen nicht vor der Anforderung, und dass die
Nachforderung noch angefordert ist (sonst 422). Die Karte MUST danach „Wer: …“ zeigen. Danach MUST
ein Rückgängig die Zusage zurücknehmen; die Rücknahme MUST Wer und Eintreffen leeren. Pro Seite
MUST höchstens ein Formular an einer Karte offen sein.

#### Scenario: Zusage ohne Angaben
- **WHEN** die Person „Zusage erfassen“ wählt und im Mengenfeld Enter drückt
- **THEN** ist die Nachforderung mit ihrer ganzen Anzahl zugesagt, und das ETB nennt
  „Nachforderung 2× RTW: zugesagt“

#### Scenario: Zusage mit Rufnamen und Eintreffen
- **WHEN** für „2× RTW“ „83-1“ und „83-2“ mit Eintreffen 15:30 zugesagt werden
- **THEN** trägt die Karte „Wer: 83-1, 83-2“ und „Eintreffen erwartet: …“

#### Scenario: Mehr Rufnamen als zugesagt
- **WHEN** eine Zusage über 1 drei Rufnamen trägt
- **THEN** antwortet der Server 422 und schreibt nichts

### Requirement: Teilzusage teilt in zwei Positionen
Ist die zugesagte Menge kleiner als die angeforderte, SHALL der Server in einer Transaktion die
Nachforderung mit der zugesagten Menge auf zugesagt setzen und den Rest als neue, angeforderte
Nachforderung mit denselben Angaben anlegen, die auf die zugesagte verweist. Die zugesagte Karte
MUST „1 von 2 zugesagt“ zeigen, die Restkarte „Rest einer Teilzusage“. Eine Rücknahme der
Teilzusage MUST NOT die Positionen zusammenführen.

#### Scenario: Eine von zwei
- **WHEN** von „2× RTW“ eine zugesagt wird
- **THEN** stehen „1× RTW“ in „Zugesagt“ mit „1 von 2 zugesagt“ und „1× RTW“ in „Angefordert“ mit
  „Rest einer Teilzusage“

### Requirement: Verpasstes Eintreffen ohne Alarm
Eine zugesagte oder unterwegs gemeldete Nachforderung, deren erwartetes Eintreffen verstrichen
ist, SHALL an ihrer Karte das Etikett „überfällig“ im Ton „achtung“ tragen; das Wort ist der
zweite Kanal. Die Zeile „Eintreffen erwartet“ MUST dann im Ton „achtung“ stehen, ebenso, wenn sie
nach „benötigt bis“ liegt, dann mit „· nach Bedarfszeit“. Über den Spalten MUST „n überfällig“
stehen, solange eine Karte überfällig ist. Es MUST NOT einen Ton, Toast oder Hinweis geben. Nach
dem Eintreffen MUST die Zeile „Eintreffen erwartet“ fehlen.

#### Scenario: Eintreffen verstrichen
- **WHEN** das erwartete Eintreffen einer zugesagten Nachforderung 15:30 war und es 15:31 ist
- **THEN** trägt ihre Karte „überfällig“, und über den Spalten steht „1 überfällig“

#### Scenario: Nach der Bedarfszeit
- **WHEN** eine Nachforderung bis 15:00 benötigt wird und das Eintreffen für 15:30 zugesagt ist
- **THEN** lautet die Zeile „Eintreffen erwartet: … · nach Bedarfszeit“ im Ton „achtung“

### Requirement: Zurückziehen durch die eigene Führung
Eine angeforderte, zugesagte oder unterwegs gemeldete Nachforderung SHALL sich über „Zurückziehen“
im ⋮-Menü zurückziehen lassen, nach einer Rückfrage im Dialog mit optionalem Grund (höchstens 200
Zeichen). `zurueckgezogen` MUST ein Endzustand sein: nicht offen, nicht im Modulzähler, ohne Weg
hinaus und ohne Rückgängig. Der Wechsel über `…/status` MUST 422 ergeben. Eine eingetroffene oder
abgelehnte Nachforderung MUST NOT zurückgezogen werden (422). Das Zurückziehen MUST NOT eine
Benachrichtigung auslösen.

#### Scenario: Nicht mehr benötigt
- **WHEN** die Einsatzleitung eine zugesagte Nachforderung mit „nicht mehr benötigt“ zurückzieht
- **THEN** steht sie unter „Zurückgezogen“ mit ihrem Grund, und das ETB nennt
  „Nachforderung 2× RTW: zurückgezogen (nicht mehr benötigt)“

### Requirement: Bearbeiten einer offenen Nachforderung
„Bearbeiten“ im ⋮-Menü SHALL an der Karte ein Formular öffnen: Anzahl, Wohin, Priorität und
Details, bei zugesagt oder unterwegs dazu Wer und Eintreffen. Die Art MUST bleiben. Gesendet wird
`PATCH …/nachforderungen/{id}` mit den geänderten Feldern; ohne Änderung MUST nichts gesendet
werden. Ein Zielfeld im Body MUST das ganze Ziel ersetzen, und nur dann MUST der Server das Ziel
prüfen. Eine abgeschlossene Nachforderung MUST NOT bearbeitet werden (422), ebenso Wer und
Eintreffen an einer angeforderten.

#### Scenario: Anzahl erhöhen
- **WHEN** die Person an „2× RTW“ die Anzahl auf 3 ändert und speichert
- **THEN** geht nur `{ anzahl: 3 }` an den Server, und das ETB nennt
  „Nachforderung 2× RTW geändert: Anzahl 3“
