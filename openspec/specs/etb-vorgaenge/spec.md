# etb-vorgaenge Specification

## Purpose
Das Einsatztagebuch ist der Nachweis der Führung (FwDV 100). Ein Eintrag, den eine Meldung oder
eine Nachforderung auslöst, verweist auf seinen Vorgang, und der Verlauf einer Nachforderung
steht vollständig im ETB: Anforderung, Zusage, Anmarsch, Eintreffen, Ablehnung und jede
Rücknahme. Die Übergabe einer Meldung an die Lage ist eine Handlung der Führung und steht
ebenfalls dort.

## Requirements

### Requirement: Verweis auf Meldung und Nachforderung auf dem Draht
Jede API-Antwort, die einen ETB-Eintrag ausliefert (Liste, Einzelladen, Antwort auf das
Erfassen), SHALL für einen Eintrag, der zu einer Meldung gehört, `meldung_id` und die laufende
Nummer der Meldung als `meldung_lfd_nr` tragen, und für einen Eintrag, der zu einer
Nachforderung gehört, `nachforderung_id`. Ohne Kopplung MUST das jeweilige Feld fehlen, nicht
`null` sein. Die Nummer MUST beim Lesen aus der Meldung kommen, nicht als Kopie am Eintrag.
Liste und Zählung MUST dabei unverändert dieselbe Filterbedingung teilen.

#### Scenario: Auto-Eintrag einer Meldung
- **WHEN** eine Meldung mit der Nummer 12 erfasst wird und dabei ein ETB-Eintrag entsteht
- **THEN** trägt der Eintrag in der ETB-Liste `meldung_id` dieser Meldung und `meldung_lfd_nr` 12

#### Scenario: Eintrag einer Nachforderung
- **WHEN** eine Nachforderung abgesetzt wird
- **THEN** trägt ihr ETB-Eintrag `nachforderung_id` und kein `meldung_id`

#### Scenario: Eintrag ohne Kopplung
- **WHEN** ein Handeintrag ohne Meldung und Nachforderung abgefragt wird
- **THEN** fehlen `meldung_id`, `meldung_lfd_nr` und `nachforderung_id` in seiner Darstellung

#### Scenario: Zählung unverändert
- **WHEN** die ETB-Liste und die Zählung mit demselben Filter abgefragt werden
- **THEN** stimmen Trefferzahl und Liste überein wie ohne die Verweise

### Requirement: Zeitachse verweist auf Meldung und Nachforderung
Die ETB-Zeitachse SHALL in der Hinweiszeile eines Eintrags mit Meldung einen Verweis
„Meldung #<lfd_nr>“ zeigen, ohne Nummer „Meldung“, der in den Meldungseingang mit
`?meldung=<id>` führt, und für einen Eintrag mit Nachforderung einen Verweis „Nachforderung“,
der auf die Nachforderungen mit `?nachforderung=<id>` führt. Die Zielseite MUST die Karte
hervorheben (Spec `deeplink-hervorhebung`). Das Pfeilzeichen ↗ MUST NOT Teil des zugänglichen
Namens sein. Ein Systemeintrag mit einem dieser Verweise MUST einzeln stehen und nicht gebündelt
werden.

#### Scenario: Klick auf die Meldung
- **WHEN** eine Person im ETB am Eintrag einer Meldung „Meldung #12“ anklickt
- **THEN** öffnet der Meldungseingang mit der Karte dieser Meldung hervorgehoben

#### Scenario: Klick auf die Nachforderung
- **WHEN** eine Person im ETB am Eintrag einer Nachforderung „Nachforderung“ anklickt
- **THEN** öffnen die Nachforderungen mit der Karte dieser Nachforderung hervorgehoben

#### Scenario: Stufen werden nicht gebündelt
- **WHEN** drei Systemeinträge einer Nachforderung innerhalb einer Stunde direkt aufeinander folgen
- **THEN** steht jeder mit seinem Verweis einzeln in der Zeitachse

### Requirement: Nachforderung steht immer im ETB
Das Absetzen einer Nachforderung SHALL im selben Commit einen ETB-Eintrag vom Typ „Meldung“
schreiben, unabhängig von „Automatische ETB-Einträge“. Sein Von MUST die eigene Führungsstelle
des Einsatzes sein (Rufname, sonst Bezeichnung); ist keine gepflegt, der ETB-Vorschlag des
Erstellers (seine Führungsstelle aus der Mitgliedschaft, sonst sein erstes Sachgebiet). Erst
ohne jede Angabe gilt die Systemkennung. Sein An MUST der Adressat sein: Kategorie und
Bezeichnung („Leitstelle (ILS Nord)“), nur die Bezeichnung, wenn sie die Kategorie schon nennt,
ohne Bezeichnung nur die Kategorie.

#### Scenario: Führungsstelle mit Rufname
- **WHEN** die Führungsstelle den Rufnamen „Florian Musterstadt 10/1“ trägt und eine Nachforderung an die Leitstelle „ILS Nord“ abgesetzt wird
- **THEN** trägt der ETB-Eintrag Von „Florian Musterstadt 10/1“ und An „Leitstelle (ILS Nord)“

#### Scenario: Ohne gepflegte Führungsstelle
- **WHEN** keine Führungsstelle gepflegt ist und der Ersteller in der Mitgliedschaft die Führungsstelle „TEL Rathaus“ hat
- **THEN** trägt der ETB-Eintrag Von „TEL Rathaus“

#### Scenario: Automatische Einträge abgeschaltet
- **WHEN** „Automatische ETB-Einträge“ aus ist und eine Nachforderung abgesetzt wird
- **THEN** entsteht ihr ETB-Eintrag trotzdem

### Requirement: Jede Stufe einer Nachforderung steht im ETB
Jeder Wechsel des Bedarfs-Status, den der Server vollzieht (zugesagt, unterwegs, eingetroffen,
abgelehnt, Rücknahme um eine Stufe), SHALL in derselben Transaktion genau einen Systemeintrag
mit Verweis auf die Nachforderung schreiben, unabhängig von „Automatische ETB-Einträge“. Der
Inhalt MUST Anzahl, Art und Stufe nennen („Nachforderung 2× RTW: zugesagt“), eine Ablehnung
MUST ihren Grund in Klammern tragen, eine Rücknahme MUST „zurückgesetzt auf <Stufe>“ lauten. Eine
Rücknahme MUST NOT einen Eintrag löschen oder ändern. Ein Wechsel, der wegen eines
zwischenzeitlich geänderten Status nicht greift, MUST NOT einen Eintrag schreiben. Der Eintrag
MUST NOT eine weitere Benachrichtigung auslösen; es bleibt bei der aus „Status einer
Nachforderung“ (Spec `benachrichtigungen`).

#### Scenario: Zusage
- **WHEN** eine Nachforderung „2× RTW“ auf zugesagt wechselt
- **THEN** steht genau ein neuer Systemeintrag „Nachforderung 2× RTW: zugesagt“ mit Verweis auf sie im ETB

#### Scenario: Rückgängig
- **WHEN** eine zugesagte Nachforderung per Rückgängig auf angefordert zurückgeht
- **THEN** kommt ein weiterer Eintrag „Nachforderung 2× RTW: zurückgesetzt auf angefordert“ hinzu, und der Eintrag der Zusage bleibt stehen

#### Scenario: Ablehnung mit Grund
- **WHEN** eine Nachforderung mit dem Grund „keine Reserven“ abgelehnt wird
- **THEN** steht „Nachforderung 2× RTW: abgelehnt (keine Reserven)“ im ETB

#### Scenario: Veralteter Stand
- **WHEN** zwei Personen dieselbe Nachforderung gleichzeitig auf zugesagt schalten
- **THEN** steht die Zusage genau einmal im ETB, und die zweite Anfrage erhält 422

#### Scenario: Keine Doppelbenachrichtigung
- **WHEN** eine Nachforderung auf zugesagt wechselt
- **THEN** erhalten Ersteller und S4 je genau einen Hinweis „Nachforderung zugesagt“

### Requirement: Übergabe an die Lage steht im ETB
Die erste Übergabe einer Meldung an die Lage SHALL im selben Commit einen Systemeintrag
„Meldung #<lfd_nr> an die Lage übergeben“ mit Verweis auf die Meldung schreiben. Eine erneute
Übergabe derselben Meldung MUST NOT einen weiteren Eintrag schreiben. Eine Meldung der Art
„Lagemeldung“ MUST NOT einen solchen Eintrag erzeugen, weil sie ihren Lage-Eintrag schon trägt.

#### Scenario: Erste Übergabe
- **WHEN** die Meldung 12 der Art „Sonstige“ an die Lage übergeben wird
- **THEN** steht „Meldung #12 an die Lage übergeben“ als Systemeintrag mit Verweis „Meldung #12“ im ETB

#### Scenario: Erneute Übergabe
- **WHEN** dieselbe Meldung mit geändertem Lage-Text erneut übergeben wird
- **THEN** entsteht kein weiterer ETB-Eintrag

#### Scenario: Lagemeldung
- **WHEN** eine Meldung der Art „Lagemeldung“ an die Lage übergeben wird
- **THEN** entsteht kein Systemeintrag zur Übergabe
