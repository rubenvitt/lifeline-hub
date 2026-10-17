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

### Requirement: Kurzeingabe der Ereigniszeit
Beginnt der Text der ETB-Schnellerfassung (nach einem etwaigen Typbefehl) mit `/zeit` und einer
lesbaren Zeitangabe, SHALL die Erfassung daraus die Ereigniszeit setzen, nach denselben Regeln wie
das Zeitfeld eines Ereignisses (`1420`, `14:20`, `101420`, `-15`). Der Rest der Zeile MUST als
Inhalt stehen bleiben. Ist die Angabe unlesbar, bleibt sie Text, und das Feld nennt den Grund.

#### Scenario: Uhrzeit mit Inhalt
- **WHEN** „/zeit 1420 Pumpe läuft“ getippt wird
- **THEN** zeigt die Erfassung den Chip „Ereigniszeit“ mit 1420, und der Inhalt lautet „Pumpe läuft“

#### Scenario: Relativ
- **WHEN** um 14:31 Serverzeit „/zeit -10 Lage ruhig“ getippt und erfasst wird
- **THEN** trägt der Eintrag die Ereigniszeit 14:21 und den Hinweis „nachgetragen“

#### Scenario: Unlesbar
- **WHEN** „/zeit 2590 Pumpe“ getippt wird
- **THEN** wird kein Chip gesetzt, der Text bleibt stehen, und das Feld nennt den Grund

### Requirement: Keine Ereigniszeit in der Zukunft
Liegt die Ereigniszeit eines ETB-Entwurfs mehr als 60 Sekunden nach jetzt (Serveruhr, soweit der
Versatz bekannt ist), MUST die Erfassung das Senden verweigern, am Zeit-Chip den Grund „liegt in
der Zukunft“ nennen und Text und Felder stehen lassen. Der Server begrenzt die Ereigniszeit
weiterhin nicht.

#### Scenario: Tippfehler in die Zukunft
- **WHEN** um 14:20 Serverzeit eine Ereigniszeit 18:20 desselben Tages im Chip steht und „Erfassen“ gewählt wird
- **THEN** entsteht kein Eintrag, der Chip nennt „liegt in der Zukunft“, und der Text bleibt

#### Scenario: Vorgemerkter Eintrag
- **WHEN** ein offline vorgemerkter Eintrag mit vergangener Ereigniszeit später gesendet wird
- **THEN** nimmt der Server ihn an

### Requirement: Typwort statt Slash-Präfix
Der Typwähler der ETB-Erfassung SHALL das Typwort des gewählten Typs zeigen (z. B. „Meldung“,
„Berichtigung“) mit einer Kante in der Typfarbe, nicht die Slash-Schreibweise. Sein zugänglicher
Name MUST „Eintragstyp <Typwort> ändern“ lauten. Die Typwahl im Menü SHALL je Typ einen Farbpunkt
tragen. Der Slash-Befehl am Zeilenanfang wechselt den Typ weiterhin.

#### Scenario: Wechsel per Slash-Befehl
- **WHEN** „/anordnung Abschnitt Nord räumen“ getippt wird
- **THEN** zeigt der Typwähler „Anordnung“ mit der Kante der Anordnung, und sein Name lautet „Eintragstyp Anordnung ändern“

### Requirement: Werte behalten nimmt den Typ mit
Ist „Werte behalten“ an, SHALL der Folgeentwurf nach erfolgreichem Erfassen neben Von, An und
Meldeweg auch den Eintragstyp übernehmen. Ist der Schalter aus, MUST der Folgeentwurf als
„Meldung“ beginnen. Die Vorgabe des Schalters bleibt aus; eine Ereigniszeit wird nie übernommen.

#### Scenario: Serie von Anordnungen
- **WHEN** „Werte behalten“ an ist und eine Anordnung erfasst wird
- **THEN** beginnt der nächste Entwurf als Anordnung mit denselben Von, An und Meldeweg

#### Scenario: Schalter aus
- **WHEN** „Werte behalten“ aus ist und eine Anordnung erfasst wird
- **THEN** beginnt der nächste Entwurf als Meldung
