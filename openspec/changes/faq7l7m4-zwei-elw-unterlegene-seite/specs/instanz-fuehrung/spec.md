## MODIFIED Requirements

### Requirement: Die größere Epoche gilt

Eine Epoche SHALL ein Paar aus Zähler und Kennung der Instanz sein, die sie vergeben hat. Ein
Paar ist größer, wenn sein Zähler größer ist oder bei gleichem Zähler seine Instanzkennung.
Erhält eine Instanz eine Akte mit größerer Epoche, MUST diese gelten; verliert die Instanz dadurch
die Führung, MUST sie denselben Ablauf durchlaufen wie bei jeder Übernahme gegen sie. Ausnahme:
Liegt die Führung bei einer anderen meldenden Seite, MUST die erreichte Seite die Epoche einer
meldenden Seite ablehnen, auch wenn sie größer ist; dann gilt die zuerst angenommene.

#### Scenario: Höhere Epoche
- **WHEN** der Hub eine Akte mit Epoche (3, Hub) hat und der ELW (4, ELW) meldet
- **THEN** gilt am Hub die Epoche (4, ELW) mit dem ELW als Führer

#### Scenario: Gleichstand zweier Notübernahmen
- **WHEN** der Hub einen Einsatz mit Epoche (1, Hub) führt, „ELW 1“ und „ELW 2“ ohne Verbindung beide eine Notübernahme erklären und „ELW 1“ sich zuerst meldet
- **THEN** führt am Hub „ELW 1“, und die Übernahme von „ELW 2“ lehnt der Hub mit einem Hinweis an der Kopplung ab, gleich welche der beiden Epochen größer ist

### Requirement: Widersprechen heißt Rückübernahme

Widerspricht die Einsatzleitung an der meldenden Seite einer gültigen Notübernahme, SHALL die
meldende Seite mit der nächsten Epoche selbst weiter führen. Die erreichte Seite MUST die höhere
Epoche bei der nächsten Meldung annehmen und den Widerspruch in der Kopplung und in der Admin-Spur
zeigen. Einer offenen Übernahme, in der die erreichte Seite einen Dritten als Führer nennt, MUST
die meldende Seite nicht widersprechen lassen und mit 422 antworten.

#### Scenario: Widerspruch
- **WHEN** der Hub mit Epoche (3, Hub) übernommen hat und die Einsatzleitung am ELW widerspricht
- **THEN** führt der ELW mit Epoche (4, ELW), und nach der Meldung zeigt der Hub „ELW hat der Notübernahme widersprochen“

#### Scenario: Kein Widerspruch gegen den Dritten
- **WHEN** an „ELW 2“ die Führung von „ELW 1“ offen ist und die Einsatzleitung widersprechen will
- **THEN** antwortet der Server mit 422, und das Hinweisband bietet nur „Übernahme bestätigen“

## ADDED Requirements

### Requirement: Die unterlegene meldende Seite hält die Führung des Dritten offen

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite eine dritte Instanz
als Führer, MUST die meldende Seite diese Akte als offene Übernahme halten, gleich welche Epoche
größer ist. Sie MUST weiter schreiben lassen, das Hinweisband zeigen und die Einsatzleitung
benachrichtigen. Nennt die erreichte Seite keinen Dritten mehr, MUST die offene Übernahme erlöschen.

#### Scenario: ELW 2 erfährt, dass ELW 1 führt
- **WHEN** der Hub die Notübernahme von „ELW 1“ angenommen hat und „ELW 2“ mit eigener Notübernahme sich danach meldet
- **THEN** schreibt „ELW 2“ weiter und zeigt „Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ELW 1“, und die Einsatzleitung von „ELW 2“ bekommt den Hinweis „Führung übernommen“

#### Scenario: Reguläre Übergabe an ELW 1
- **WHEN** der Hub den Einsatz auf Anfrage an „ELW 1“ abgegeben hat und „ELW 2“ ohne Verbindung vom alten Stand eine Notübernahme erklärt hat und sich meldet
- **THEN** hält „ELW 2“ die Führung von „ELW 1“ offen und löst keinen Alarm „Gegenüber meldet ungültige Übernahme“ aus

#### Scenario: Bestätigen
- **WHEN** die Einsatzleitung an „ELW 2“ diese offene Übernahme bestätigt
- **THEN** ist der Einsatz an „ELW 2“ „Nur Ansicht · Führung liegt bei „ELW 1““, und der Verlauf zeigt die Bruchstelle

#### Scenario: Der Hub nennt keinen Dritten mehr
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und die Akte des Hubs danach wieder den Hub oder „ELW 2“ als Führer nennt
- **THEN** zeigt „ELW 2“ keine offene Übernahme mehr

### Requirement: Die meldende Seite zieht eine überholte Übernahme gegen die erreichte Seite nach

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite diese selbst als
Führer, mit einer größeren Epoche, die eine dritte Instanz vergeben hat, MUST die meldende Seite
mit der nächsten Epoche weiter führen, ohne Alarm und mit einem Eintrag im Verlauf. Die erreichte
Seite MUST diese Epoche bei der nächsten Meldung annehmen.

#### Scenario: Hub hat zwischendurch von ELW 1 zurückbekommen
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) erklärt, während „ELW 1“ die Führung mit Epoche (3, ELW 1) an den Hub zurückgegeben hat, und „ELW 2“ sich meldet
- **THEN** führt nach dem nächsten Meldetakt „ELW 2“ mit Epoche (4, ELW 2) an beiden Seiten, ohne Alarm „Gegenüber meldet ungültige Übernahme“, und der Verlauf an „ELW 2“ zeigt „Notübernahme gegen Hub mit neuem Stand erneuert“
