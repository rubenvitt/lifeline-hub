# Spec Delta

## ADDED Requirements

### Requirement: Einzelangabe prüft auf zwischenzeitliche Änderung
Eine Ansicht, deren Angaben einzeln an ihrem Wert bearbeitet werden, SHALL beim Speichern einer
Angabe den Wert mitsenden, den sie beim Öffnen hatte. Hat jemand anderes genau diese Angabe
inzwischen geändert, MUST der Server mit 409 antworten und nichts schreiben. Eine Änderung an einer
anderen Angabe desselben Datensatzes MUST NOT einen Konflikt auslösen. Ein Speichern ohne
mitgesendeten Altwert MUST wie bisher ohne Vergleich schreiben.

#### Scenario: Zwei ändern dieselbe Bemerkung
- **WHEN** A und B die Bemerkung derselben Einheit öffnen, A „Tor 3“ speichert und B danach „Halle 2“ speichert
- **THEN** antwortet der Server B mit 409, die Bemerkung bleibt „Tor 3“, und B sieht die Rückfrage

#### Scenario: Andere Angabe dazwischen
- **WHEN** A die Bemerkung einer Einheit öffnet, B inzwischen deren Funkrufnamen ändert und A speichert
- **THEN** wird die Bemerkung von A gespeichert, ohne Rückfrage, und der Funkrufname von B bleibt

### Requirement: Einheitlicher Dialog „Zwischenzeitlich geändert“
Wird das Speichern einer Einzelangabe oder eines Paneels mit 409 wegen einer fremden Änderung
abgelehnt, SHALL die Ansicht „Zwischenzeitlich geändert“ fragen, den aktuellen Wert nennen und,
soweit bekannt, wer ihn wann gesetzt hat. Sie MUST genau „Meine Änderung übernehmen“ und
„Verwerfen und neu laden“ anbieten. Schließen oder Escape MUST nichts entscheiden: die Eingabe
bleibt offen.

#### Scenario: Meine Änderung übernehmen
- **WHEN** B in der Rückfrage „Meine Änderung übernehmen“ wählt
- **THEN** wird B's Wert ohne Altwert gespeichert, die Angabe zeigt ihn, und der Vermerk nennt B

#### Scenario: Verwerfen und neu laden
- **WHEN** B in der Rückfrage „Verwerfen und neu laden“ wählt
- **THEN** schließt die Angabe, zeigt den Wert von A, und nichts wird gesendet

#### Scenario: Rückfrage nennt Wer und Wann
- **WHEN** A die Bemerkung um 14:05 auf „Tor 3“ gesetzt hat und B's Speichern daran scheitert
- **THEN** nennt die Rückfrage „Bemerkung inzwischen: „Tor 3“ (A, 14:05)“

#### Scenario: Escape lässt die Eingabe offen
- **WHEN** B die Rückfrage mit Escape schließt
- **THEN** steht B's Eingabe weiter im offenen Feld, und nichts wird gesendet

### Requirement: 409 ohne fremde Änderung steht an der Angabe
Lehnt der Server das Speichern einer Einzelangabe mit 409 ab, während ihr Wert seit dem Öffnen
unverändert ist, SHALL die Ansicht keine Rückfrage zeigen: es war kein Feldkonflikt, und der Grund
des Servers MUST an der Angabe stehen.

#### Scenario: Abgeschlossener Einsatz ist kein Feldkonflikt
- **WHEN** B speichert, während der Einsatz inzwischen abgeschlossen wurde, und die Angabe unverändert ist
- **THEN** erscheint keine Rückfrage, und der Grund des Servers steht an der Angabe

### Requirement: Fremder Wert im offenen Feld
Trifft für eine geöffnete Einzelangabe ein anderer Wert ein als beim Öffnen, SHALL das offene Feld
einen Hinweis „Inzwischen geändert“ mit dem neuen Wert zeigen und, soweit bekannt, wer ihn wann
gesetzt hat. Die eigene Eingabe MUST stehen bleiben und MUST NOT durch den fremden Wert ersetzt
werden. Das Speichern danach folgt „Einzelangabe prüft auf zwischenzeitliche Änderung“.

#### Scenario: Wert kommt während der Eingabe
- **WHEN** B die Leitstellen-Nr. bearbeitet und A inzwischen `ILS-4711` speichert
- **THEN** zeigt B's offenes Feld „Inzwischen geändert von A, <Zeit>: ILS-4711“, und B's Eingabe bleibt im Feld

#### Scenario: Wert kehrt zurück
- **WHEN** der eingetroffene Wert wieder dem Wert beim Öffnen entspricht
- **THEN** verschwindet der Hinweis
