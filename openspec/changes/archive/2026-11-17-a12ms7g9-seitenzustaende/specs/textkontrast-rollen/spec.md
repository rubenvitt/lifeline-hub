# Spec Delta

## REMOVED Requirements

### Requirement: Fehlertext außerhalb von Formularen in der Textrolle
**Reason**: Ihr erstes Szenario belegte die Anforderung am roten Text „Befehl nicht gefunden.“. Den
gibt es nicht mehr: Ein Objekt, das es nicht (mehr) gibt, zeigt jetzt die neutrale Form der
Fähigkeit `seiten-zustaende` (LLH-1827). Ein MODIFIED-Block darf kein Szenario fallen lassen.
**Migration**: Die Anforderung steht unverändert, mit einem anderen Beleg, unter „Roter
Fehlertext außerhalb von Formularen in der Textrolle“.

## ADDED Requirements

### Requirement: Roter Fehlertext außerhalb von Formularen in der Textrolle

Roter Text, mit dem die Anwendung außerhalb eines Formulars einen Fehler oder einen Verzug meldet,
MUST die Textrolle `alarm` als Text tragen, nicht deren Füllfarbe. Gemeint ist etwa ein
gescheiterter Abruf, eine ungültige Eingabe, ein Ablehnungsgrund oder „Überfällig“. Er MUST im
Tagmodus ≥ 7 : 1 und im Nachtmodus ≥ 5 : 1 gegen den Grund halten, auf dem er steht. Ist er ein
Link, gilt das auch unter dem Zeiger und beim Drücken. Die Färbung MUST app-weit aus einer Stelle
kommen; keine Seite und kein Baustein MUST dafür eine eigene Farbe setzen. Gefahrknöpfe,
Fehlerränder von Feldern und die Kante einer alarmierten Karte MUST die Füllfarbe behalten.

#### Scenario: Gescheiterter Abruf als roter Text
- **WHEN** die Seite eines Evakuierungsbezirks geöffnet wird und der Abruf seines Gebiets
  scheitert, im Tag- und im Nachtmodus
- **THEN** erscheint „Gebiet konnte nicht geladen werden“
- **AND** der Text hält gegen den Grund, auf dem er steht, im Tag ≥ 7 : 1 und in der Nacht
  ≥ 5 : 1

#### Scenario: Überfällig auf der Karte eines überfälligen Auftrags
- **WHEN** die Auftragsliste eines Einsatzes mit einem offenen Auftrag geöffnet wird, dessen Frist
  abgelaufen ist, im Tag- und im Nachtmodus
- **THEN** trägt seine Karte den Hinweis „Überfällig“
- **AND** der Hinweis hält gegen die Fläche der alarmierten Karte im Tag ≥ 7 : 1 und in der Nacht
  ≥ 5 : 1

#### Scenario: Füllfarbe bleibt, wo sie keine Schrift ist
- **WHEN** die Änderung umgesetzt ist
- **THEN** bleibt das globale Gefahrrot der antd-Tokens die Füllfarbe `alarm`
- **AND** die linke Kante einer alarmierten Karte trägt weiter die Füllfarbe `alarm`
