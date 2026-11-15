## ADDED Requirements

### Requirement: Unlesbare Zeit hält das Senden an
Meldet das Feld Zeit der ETB-Erfassung eine unlesbare Eingabe, auch eine beim Verlassen verworfene,
oder eine unlesbare Angabe hinter `/zeit`, MUST die Erfassung das Senden verweigern, über
„Erfassen“ wie über Enter im Inhalt. Der Grund MUST in der Fußzeile stehen und den Ort nennen, der
Fokus MUST dorthin gehen, wo der Fehler steht: ins Feld Zeit bzw. auf die markierte Angabe im Text.
Text, Felder und Anhänge bleiben. Andere Formulare behalten die Spec `zeiteingabe`.

#### Scenario: Unlesbar getippt und direkt erfasst
- **WHEN** im Feld Zeit „14:3x“ getippt und direkt „Erfassen“ geklickt wird
- **THEN** entsteht kein Eintrag, das Feld Zeit nennt den Grund und hat den Fokus, und der Text
  bleibt stehen

#### Scenario: Enter im Inhalt nach verworfener Zeit
- **WHEN** im Feld Zeit „2460“ getippt, das Feld per Klick in den Inhalt verlassen und Enter
  gedrückt wird
- **THEN** entsteht kein Eintrag, und das Feld Zeit nennt „Uhrzeit gibt es nicht“

#### Scenario: Geleertes Feld gibt das Senden frei
- **WHEN** das Feld Zeit 1420 zeigte, nach einem solchen Halt geleert und „Erfassen“ gewählt wird
- **THEN** entsteht der Eintrag mit der Zeit des Erfassens

#### Scenario: Enter oder Escape im Feld bestätigt „jetzt“
- **WHEN** das Feld Zeit leer war, „14:3x“ getippt, „Erfassen“ gewählt und angehalten wurde, und
  danach im Feld Zeit Enter oder Escape gedrückt und „Erfassen“ gewählt wird
- **THEN** entsteht der Eintrag mit der Zeit des Erfassens

#### Scenario: Lesbare Zeit gibt das Senden frei
- **WHEN** nach einem solchen Halt im Feld Zeit „1430“ getippt und „Erfassen“ gewählt wird
- **THEN** entsteht der Eintrag mit der Ereigniszeit 14:30

#### Scenario: Gewählte Zeit gibt das Senden frei
- **WHEN** nach einem solchen Halt im Kalender des Felds Zeit eine Zeit gewählt und „Erfassen“
  gewählt wird
- **THEN** entsteht der Eintrag mit der gewählten Zeit

#### Scenario: Unlesbares `/zeit` markiert die Angabe
- **WHEN** „/zeit 2590 Pumpe“ getippt und „Erfassen“ gewählt wird
- **THEN** entsteht kein Eintrag, die Fußzeile nennt „/zeit im Text: …“, und im Inhalt ist „2590“
  markiert

#### Scenario: Korrigiertes `/zeit` gibt das Senden frei
- **WHEN** „/zeit 2590 Pumpe“ neu als „/zeit 1430 Pumpe“ getippt oder der Befehl gelöscht und
  „Erfassen“ gewählt wird
- **THEN** entsteht der Eintrag, mit 14:30 bzw. der Zeit des Erfassens

#### Scenario: Mitten im Text berichtigtes `/zeit` wird erst sichtbar
- **WHEN** in „/zeit 2590 Pumpe“ nur „2590“ durch „1430“ ersetzt und „Erfassen“ gewählt wird
- **THEN** entsteht noch kein Eintrag; das Feld Zeit zeigt 1430, der Inhalt lautet „Pumpe“, der
  Knopf heißt „Erfassen als 1430“, und ein weiteres „Erfassen“ sendet mit 14:30

#### Scenario: Anderes Formular unverändert
- **WHEN** in einem Zeitfeld außerhalb der ETB-Erfassung „14:3x“ getippt und danach „Speichern“
  geklickt wird
- **THEN** wird der unveränderte Wert gesendet, wie die Spec `zeiteingabe` es verlangt

### Requirement: Ein Grund für die Zeit in der Fußzeile
Die Fußzeile der ETB-Erfassung MUST zur Zeit genau einen Grund nennen, und zwar den, an dem ein Halt
hängt: eine unlesbare Zeit geht einer Zeit in der Zukunft vor, beide gehen dem höflichen Hinweis
„/zeit: …“ beim Tippen vor.

#### Scenario: Unlesbares `/zeit` vor einer Zeit in der Zukunft
- **WHEN** das Feld Zeit 18:20 zeigt, es 14:31 ist, „/zeit 2590 Pumpe“ getippt und „Erfassen“
  gewählt wird
- **THEN** entsteht kein Eintrag, und die Fußzeile nennt nur „/zeit im Text: …“, nicht „liegt in der
  Zukunft“; ist die Angabe berichtigt, gilt wieder die Prüfung auf die Zukunft

## MODIFIED Requirements

### Requirement: Kurzeingabe der Ereigniszeit
Beginnt der Text der ETB-Schnellerfassung (nach einem etwaigen Typbefehl) mit `/zeit` und einer
lesbaren Zeitangabe, SHALL die Erfassung daraus die Ereigniszeit setzen, nach denselben Regeln wie
das Zeitfeld eines Ereignisses (`1420`, `14:20`, `101420`, `-15`), und sie im Feld Zeit zeigen. Der
Rest der Zeile MUST als Inhalt stehen bleiben. Ist die Angabe unlesbar, bleibt sie Text, das Feld
nennt den Grund, und die Erfassung MUST nicht senden („Unlesbare Zeit hält das Senden an“).

#### Scenario: Uhrzeit mit Inhalt
- **WHEN** „/zeit 1420 Pumpe läuft“ getippt wird
- **THEN** zeigt das Feld Zeit 1420, und der Inhalt lautet „Pumpe läuft“

#### Scenario: Relativ
- **WHEN** um 14:31 Serverzeit „/zeit -10 Lage ruhig“ getippt und erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 14:21 und den Hinweis „nachgetragen“

#### Scenario: Unlesbar
- **WHEN** „/zeit 2590 Pumpe“ getippt und „Erfassen“ gewählt wird
- **THEN** bleibt das Feld Zeit bei „jetzt“, der Text bleibt stehen, das Feld nennt den Grund, und
  es entsteht kein Eintrag
