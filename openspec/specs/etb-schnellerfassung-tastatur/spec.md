# etb-schnellerfassung-tastatur Specification

## Purpose
Tastaturvertrag der ETB-Schnellerfassung je Zeigerart: wann Enter einen Eintrag sendet und wann
es eine neue Zeile beginnt, welche Taste die Bildschirmtastatur anzeigt, und wo der Vertrag
sichtbar wird (Tastenkappe am Knopf, kein erklärender Text; LFH-1078).

## Requirements

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

### Requirement: Der Vertrag steht am Knopf, nicht im Text

Die ETB-Schnellerfassung MUST den Tastaturvertrag nicht in einer Hinweiszeile oder im Platzhalter
erklären (Bedien-Leitlinie „Text erklärt nie die Bedienung“, LFH-1078). Bei feinem Zeiger SHALL
der Knopf „Erfassen“ ab Breite `lg` eine Tastenkappe ↵ tragen; schmaler entfällt sie, damit das
Textfeld seinen Anteil an der Zeile behält. Bei grobem Zeiger MUST keine Tastenkappe und keine
Tastenkombination sichtbar sein. Der Knopf SHALL die gültigen Kürzel auf jeder Breite in
`aria-keyshortcuts` nennen.
Kein Platzhalter der ETB-Schnellerfassung MUST eine Taste, ein Kürzel oder das Wort „Befehle“
enthalten.

#### Scenario: Touch-Tablet quer
- **WHEN** die Erfassung bei 1180 px Breite und grobem Zeiger steht
- **THEN** steht unter dem Feld keine Hinweiszeile zur Tastatur, und der Knopf „Erfassen“ trägt keine Tastenkappe

#### Scenario: Platzhalter auf dem Handschirm
- **WHEN** die Erfassung bei 390 px Breite leer steht
- **THEN** lautet der Platzhalter „Inhalt …“
