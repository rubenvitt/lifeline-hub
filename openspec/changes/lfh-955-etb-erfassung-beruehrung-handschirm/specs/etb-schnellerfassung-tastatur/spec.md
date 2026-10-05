## ADDED Requirements

### Requirement: Return sendet auf Berührungsgeräten nicht

Ist der primäre Zeiger grob (`(pointer: coarse)`), MUST die Enter-Taste ohne Strg oder ⌘ in der
ETB-Schnellerfassung keinen Eintrag anlegen; sie fügt einen Zeilenumbruch ein. Strg+Enter und
⌘+Enter SHALL einen nicht leeren Text senden. Das Textfeld SHALL `enterKeyHint="enter"` tragen.
Ist der primäre Zeiger fein, SHALL der bisherige Vertrag gelten: Enter sendet einen einzeiligen,
nicht leeren Text, Shift+Enter fügt einen Zeilenumbruch ein, Strg/⌘+Enter sendet auch einen
mehrzeiligen Text.

#### Scenario: Mehrzeiler auf dem Tablet
- **WHEN** bei grobem Zeiger „Pegel 3,20 m“, Return und „steigend“ getippt werden und danach „Erfassen“ gewählt wird
- **THEN** entsteht genau ein Eintrag mit beiden Zeilen, und das Return allein hat keinen Eintrag angelegt

#### Scenario: Hardware-Tastatur am Tablet
- **WHEN** bei grobem Zeiger ein Text getippt und Strg+Enter gedrückt wird
- **THEN** wird der Eintrag gesendet

#### Scenario: Fükw unverändert
- **WHEN** bei feinem Zeiger ein einzeiliger Text getippt und Enter gedrückt wird
- **THEN** wird der Eintrag gesendet

### Requirement: Hinweis und Platzhalter nennen nur, was das Gerät kann

Die Hinweiszeile der ETB-Schnellerfassung MUST bei grobem Zeiger keine Tastenkombination nennen
(weder „Shift+Enter“ noch „Cmd/Strg+Enter“) und SHALL sagen, dass Return eine neue Zeile
beginnt und „Erfassen“ sendet. Bei feinem Zeiger SHALL sie den Tastaturvertrag nennen, genau
einmal. Kein Platzhalter der ETB-Schnellerfassung MUST das Wort „Befehle“ enthalten.

#### Scenario: Touch-Tablet quer
- **WHEN** die Erfassung bei 1180 px Breite und grobem Zeiger steht
- **THEN** nennt die Hinweiszeile „Return neue Zeile“ und „Erfassen“ und keine Tastenkombination

#### Scenario: Kurzplatzhalter auf dem Handschirm
- **WHEN** die Erfassung bei 390 px Breite leer steht
- **THEN** lautet der Platzhalter „Inhalt … ( / für Typ & Felder · @ für Einheit )“
