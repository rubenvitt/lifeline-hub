# nachforderung-material Specification

## Purpose
Was auf eine Nachforderung hin eingetroffen ist, steht ohne zweite Erfassung im Material des
Einsatzes: Aus einer eingetroffenen Nachforderung entsteht je Übernahme genau ein Materialposten,
der auf sie verweist. Die Nachforderung zeigt, was aus ihr übernommen ist, und der Posten, woher er
kommt; ein weiterer Posten entsteht nur bewusst, damit dieselbe Lieferung nicht zweimal im Bestand
steht (LLH-1226).

## Requirements

### Requirement: Eingetroffenes Material übernehmen

Das System SHALL aus einer eingetroffenen Nachforderung einen Materialposten im selben Einsatz
anlegen können, der auf die Nachforderung verweist. Eine Übernahme MUST genau einen Posten anlegen
und MUST Posten, Verweis und ETB-Eintrag in einer Transaktion schreiben; scheitert ein Teil, MUST
nichts davon bestehen bleiben. Die Nachforderung selbst MUST dabei unverändert bleiben.

#### Scenario: Tauchpumpe übernehmen
- **WHEN** die Einsatzleitung aus der eingetroffenen Nachforderung „3 Tauchpumpen für Keller Hauptstraße“ ein Gerät „Tauchpumpe“ mit Menge 1 an die Einheit „Staffel A“ übernimmt
- **THEN** steht genau ein neuer Posten „Tauchpumpe“ an „Staffel A“ im Einsatz, der auf die Nachforderung verweist
- **AND** das ETB enthält „Material «Tauchpumpe» (×1) disponiert, Ort Einheit «Staffel A», aus Nachforderung «3 Tauchpumpen für Keller Hauptstraße»“

#### Scenario: Ort scheitert
- **WHEN** eine Übernahme an eine aufgelöste Einheit gehen soll
- **THEN** antwortet der Server mit 409, und es gibt weder Posten noch ETB-Eintrag noch Verweis

### Requirement: Prüfung der Übernahme

Die Übernahme MUST das Schreibrecht für Material und die Freigabe des Moduls Nachforderungen
verlangen und MUST ohne diese Freigabe mit 403 antworten, bevor sie die Nachforderung liest. Eine
Nachforderung eines anderen Einsatzes MUST mit 404 abgelehnt werden, eine Nachforderung, die nicht
eingetroffen ist, mit 422; in keinem dieser Fälle entsteht ein Posten.

#### Scenario: Noch unterwegs
- **WHEN** eine Übernahme aus einer Nachforderung im Status „Unterwegs“ versucht wird
- **THEN** antwortet der Server mit 422, und es entsteht kein Posten

#### Scenario: Nachforderung eines anderen Einsatzes
- **WHEN** eine Übernahme auf eine Nachforderung eines anderen Einsatzes verweist
- **THEN** antwortet der Server mit 404, und es entsteht kein Posten

#### Scenario: Nachforderungen gesperrt
- **WHEN** das Modul Nachforderungen für die Person keine Freigabe hat und sie eine Übernahme sendet
- **THEN** antwortet der Server mit 403, gleich ob es die Nachforderung gibt

### Requirement: Weitere Posten nur bewusst

Eine Nachforderung SHALL mehrere Posten tragen können. Trägt sie schon einen nicht stornierten
Posten, MUST eine Übernahme ohne die ausdrückliche Angabe „ergänzen“ mit 409 abgelehnt werden,
ohne etwas zu schreiben; mit der Angabe MUST sie einen weiteren Posten anlegen. Ein stornierter
Posten MUST NOT als Übernahme zählen, ein aus dem Einsatz genommener Posten MUST weiter zählen.
Die Angabe „ergänzen“ ohne Verweis auf eine Nachforderung MUST mit 422 abgelehnt werden.

#### Scenario: Doppelklick
- **WHEN** dieselbe Übernahme ohne „ergänzen“ zweimal hintereinander eintrifft
- **THEN** legt die erste einen Posten an, die zweite antwortet mit 409, und die Nachforderung trägt einen Posten

#### Scenario: Zweite Fuhr Sandsäcke
- **WHEN** aus der Nachforderung „2 000 Sandsäcke“ schon 1 200 übernommen sind und weitere 800 mit „ergänzen“ übernommen werden
- **THEN** trägt die Nachforderung zwei Posten mit zusammen 2 000 Sandsäcken

#### Scenario: Fehlbuchung storniert
- **WHEN** der einzige übernommene Posten storniert wurde und erneut ohne „ergänzen“ übernommen wird
- **THEN** gelingt die Übernahme

### Requirement: Vorbelegte Übernahme

Der Übernahme-Dialog MUST als Bezeichnung die Art der Nachforderung übernehmen, als Menge ihre
Anzahl abzüglich der schon übernommenen Menge (mindestens 1, ohne Anzahl 1), als Art des Materials
Verbrauchsgut bei einer Menge über 1 und sonst Gerät, und als Ort „ohne Ort“. Art, Menge und Ort
MUST vor dem Absenden änderbar sein; bei Gerät steht die Menge fest auf 1.

#### Scenario: Vorbelegung
- **WHEN** die Einsatzleitung an der eingetroffenen Nachforderung mit Art „Sandsäcke“ und Anzahl 2 000 „Als Material übernehmen“ wählt
- **THEN** zeigt der Dialog „Sandsäcke“, Art Verbrauchsgut, Menge 2 000 und „ohne Ort“

#### Scenario: Rest nach Teillieferung
- **WHEN** aus derselben Nachforderung schon 1 200 übernommen sind und „Weiteren Posten übernehmen“ gewählt wird
- **THEN** steht im Dialog Menge 800

### Requirement: Handlung an der eingetroffenen Nachforderung

Die Oberfläche SHALL an jeder eingetroffenen Nachforderung „Als Material übernehmen“ anbieten, bei
schon übernommenen Posten „Weiteren Posten übernehmen“, nur mit Schreibrecht im Einsatz. Ist das
Modul Material für die Person nicht freigegeben, MUST die Handlung gesperrt mit „Keine
Berechtigung“ erscheinen. Antwortet der Server mit 409, MUST der Dialog offen bleiben und auf
„Weiteren Posten übernehmen“ wechseln.

#### Scenario: Material gesperrt
- **WHEN** die Freigaben des Servers für `material` `zugriff: false` melden
- **THEN** steht „Als Material übernehmen“ gesperrt mit „Keine Berechtigung“ an der Karte, und ein Klick öffnet keinen Dialog

#### Scenario: Ein anderer Platz war schneller
- **WHEN** der Server auf „Übernehmen“ mit 409 antwortet
- **THEN** bleibt der Dialog offen, nennt den Grund und bietet „Weiteren Posten übernehmen“ an

### Requirement: Herkunft an der Materialzeile

Ein übernommener Posten SHALL in der Materialliste auf seine Nachforderung verweisen. Ist das Modul
Nachforderungen freigegeben und die Nachforderung lesbar, MUST der Verweis „aus Nachforderung:“
mit ihrer Bezeichnung lauten und die Nachforderung in ihrer Liste ansteuern und hervorheben; sonst
MUST er „aus Nachforderung #n“ ohne Link lauten. Die Materialdaten des Servers MUST von der
Nachforderung nur die Kennung tragen.

#### Scenario: Verweis folgen
- **WHEN** die Einsatzleitung an einem übernommenen Posten „aus Nachforderung: 3 Tauchpumpen für Keller Hauptstraße“ wählt
- **THEN** öffnet die Nachforderungsliste in der Ansicht „Abgeschlossen“, und die Karte dieser Nachforderung ist hervorgehoben

#### Scenario: Ohne Zugang zu Nachforderungen
- **WHEN** eine Person ohne Freigabe für Nachforderungen die Materialliste öffnet
- **THEN** steht am Posten „aus Nachforderung #4“ ohne Link, und keine Nachforderungsliste wird abgerufen

### Requirement: Übernommene Posten an der Nachforderung

Die Nachforderung SHALL die Kennungen ihrer übernommenen, nicht stornierten Posten tragen, aber
keine weiteren Angaben aus dem Material. Mit Freigabe des Moduls Material MUST die Karte je Posten
Bezeichnung, Menge und Ort zeigen und, wenn die Nachforderung eine Anzahl trägt, die übernommene
Menge im Verhältnis zur Anzahl; ohne Freigabe MUST sie nur die Zahl der Posten zeigen.

#### Scenario: Teilweise übernommen
- **WHEN** aus der Nachforderung „2 000 Sandsäcke“ 1 200 ohne Ort übernommen sind
- **THEN** zeigt ihre Karte den Posten „Sandsäcke · 1200 · ohne Ort“ und „übernommen 1200 von 2000“

#### Scenario: Ohne Zugang zu Material
- **WHEN** eine Person ohne Freigabe für Material dieselbe Nachforderung öffnet
- **THEN** zeigt die Karte „1 Posten übernommen“ und keine Angaben des Postens

### Requirement: Rücknahme nach Übernahme gesperrt

Ist aus einer Nachforderung mindestens ein nicht stornierter Posten übernommen, MUST die Rücknahme
von „Eingetroffen“ auf „Unterwegs“ mit 422 und dem Grund abgelehnt werden; auch eine gleichzeitig
laufende Übernahme MUST NOT eine zurückgenommene Nachforderung mit Posten hinterlassen.

#### Scenario: Rückgängig nach Übernahme
- **WHEN** nach „Eintreffen melden“ ein Posten übernommen und danach „Rückgängig“ gewählt wird
- **THEN** antwortet der Server mit 422, die Nachforderung bleibt eingetroffen, und die Seite nennt den Grund

#### Scenario: Ohne Übernahme
- **WHEN** an einer eingetroffenen Nachforderung ohne Posten „Rückgängig“ gewählt wird
- **THEN** steht sie wieder auf „Unterwegs“

### Requirement: Bezug über den Lebenszyklus des Postens

Ein beim Aufteilen entstehender Posten MUST den Verweis auf die Nachforderung übernehmen. Ein
Posten MUST seinen Verweis behalten, wenn er storniert oder aus dem Einsatz genommen wird. Wird der
Einsatz gelöscht, MUST der Verweis das Löschen nicht aufhalten.

#### Scenario: Aufteilen
- **WHEN** ein übernommener Posten mit 50 Wolldecken in 30 und 20 aufgeteilt wird
- **THEN** verweisen beide Posten auf die Nachforderung, und ihre Karte zeigt beide

#### Scenario: Einsatz endgültig gelöscht
- **WHEN** die Aufbewahrung einen Einsatz mit übernommenen Posten endgültig löscht
- **THEN** sind Posten und Nachforderungen entfernt, ohne Fehler am Verweis

### Requirement: ETB und Live bei der Übernahme

Jede Übernahme MUST genau einen ETB-Eintrag schreiben, der den Posten wie beim Disponieren nennt
und die Nachforderung mit ihrer Bezeichnung anhängt. Nach dem Schreiben MUST das System die
Live-Ereignisse `material` (mit dem Ort des Postens) und `nachforderung` senden; `nachforderung`
MUST außerdem beim Stornieren, Reaktivieren und Aufteilen eines verknüpften Postens folgen.

#### Scenario: Zweiter Platz sieht die Übernahme
- **WHEN** ein Platz eine Übernahme abschließt, während ein zweiter die Nachforderungsliste offen hat
- **THEN** zeigt die Karte am zweiten Platz den neuen Posten ohne Neuladen

#### Scenario: Ein Eintrag
- **WHEN** eine Übernahme mit Ort gelingt
- **THEN** entsteht für sie genau ein ETB-Eintrag, und die Nachforderung schreibt keinen eigenen
