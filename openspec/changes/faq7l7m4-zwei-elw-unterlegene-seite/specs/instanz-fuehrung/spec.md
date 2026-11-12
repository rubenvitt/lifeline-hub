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

### Requirement: Die meldende Seite prüft jede Übernahme gegen sie

Erhält die meldende Seite eine Akte, die ihr die Führung nimmt, MUST sie diese nur annehmen, wenn
sie eine reguläre Übergabe von ihr selbst bestätigt oder eine Erklärung trägt, deren Unterschrift
von einem gültigen Unterschriftsschlüssel der zugeordneten Org über genau diese Erklärung stammt
oder deren Code zu ihrem Abgabecode passt. Sonst MUST sie die Akte verwerfen und weiter führen.
Ausgenommen ist eine Akte, an der eine dritte Instanz beteiligt ist (sie führt, oder sie hat die
Epoche vergeben, mit der die erreichte Seite selbst führt): Die MUST die meldende Seite ohne Alarm
offen halten, bis die Einsatzleitung entscheidet.

#### Scenario: Gültige Unterschrift
- **WHEN** der ELW eine Erklärung des Hubs erhält, die Admin A mit einem am ELW gültigen Schlüssel unterschrieben hat
- **THEN** zeigt der ELW über die volle Breite „Führung übernommen von Hub Nord, 14:32, Admin A: ELW ohne Verbindung seit 40 min“ mit „Übernahme bestätigen“ und „Widersprechen“ und schreibt weiter

#### Scenario: Schlüssel wartet auf Bestätigung
- **WHEN** die Unterschrift von einem Schlüssel stammt, der am ELW noch auf Bestätigung wartet
- **THEN** verwirft der ELW die Übernahme als ungültig

#### Scenario: Ungültige Übernahme
- **WHEN** der ELW eine Übernahme ohne gültige Unterschrift und ohne passenden Code erhält
- **THEN** führt der ELW weiter, löst den Alarm „Gegenüber meldet ungültige Übernahme“ an die Einsatzleitung aus und schreibt einen Eintrag in die Admin-Spur

## ADDED Requirements

### Requirement: Die unterlegene meldende Seite hält die Führung des Dritten offen

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite eine Instanz als
Führer, mit der die meldende Seite nicht gekoppelt ist, MUST sie diese Akte als offene Übernahme
halten, gleich welche Epoche größer ist. Sie MUST weiter schreiben lassen, das Hinweisband zeigen
und die Einsatzleitung einmal benachrichtigen. Nennt die erreichte Seite keinen Dritten mehr oder
endet die Kopplung, MUST die offene Übernahme erlöschen.

#### Scenario: ELW 2 erfährt, dass ELW 1 führt
- **WHEN** der Hub die Notübernahme von „ELW 1“ angenommen hat und „ELW 2“ mit eigener Notübernahme sich danach meldet
- **THEN** schreibt „ELW 2“ weiter und zeigt „Deine Notübernahme hat am Hub nicht gegriffen, die Führung liegt bei ELW 1“ ohne Grund und Unterzeichner von „ELW 1“, und die Einsatzleitung von „ELW 2“ bekommt den Hinweis „Führung übernommen“

#### Scenario: Reguläre Übergabe an ELW 1
- **WHEN** der Hub den Einsatz auf Anfrage an „ELW 1“ abgegeben hat und „ELW 2“ ohne Verbindung vom alten Stand eine Notübernahme erklärt hat und sich meldet
- **THEN** hält „ELW 2“ die Führung von „ELW 1“ offen und löst keinen Alarm „Gegenüber meldet ungültige Übernahme“ aus

#### Scenario: Bestätigen
- **WHEN** die Einsatzleitung an „ELW 2“ diese offene Übernahme bestätigt
- **THEN** ist der Einsatz an „ELW 2“ „Nur Ansicht · Führung liegt bei „ELW 1““, und der Verlauf zeigt die Bruchstelle

#### Scenario: Ohne eigene Notübernahme
- **WHEN** „ELW 2“ die Führung per Übergabe bekam und die Akte des Hubs danach „ELW 1“ als Führer nennt
- **THEN** zeigt „ELW 2“ „Die Führung liegt am Hub bei ELW 1, nicht hier“

#### Scenario: Weitere Meldetakte
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und sich „ELW 2“ mehrmals meldet, ohne dass sich am Hub etwas ändert
- **THEN** bleibt es bei einem Hinweis „Führung übernommen“, und keine Seite ändert ihre Akte

#### Scenario: Der Hub nennt keinen Dritten mehr
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und die Akte des Hubs danach wieder den Hub oder „ELW 2“ als Führer nennt
- **THEN** zeigt „ELW 2“ keine Übernahme mit „ELW 1“ mehr

#### Scenario: Kopplung widerrufen
- **WHEN** an „ELW 2“ eine solche Übernahme offen ist und die Kopplung zum Hub widerrufen wird
- **THEN** zeigt „ELW 2“ keine offene Übernahme mehr und führt weiter

### Requirement: Führt die erreichte Seite mit der Epoche eines Dritten, entscheidet ein Mensch der meldenden Seite

Führt die meldende Seite einen Einsatz und nennt die Akte der erreichten Seite diese selbst als
Führer, mit einer größeren Epoche, die eine dritte Instanz vergeben hat, MUST die meldende Seite
die Akte als offene Übernahme halten, ohne Alarm und mit „Übernahme bestätigen“ und
„Widersprechen“. Widerspricht die Einsatzleitung, MUST die erreichte Seite die nächste Epoche der
meldenden Seite bei der nächsten Meldung annehmen.

#### Scenario: Hub hat zwischendurch von ELW 1 zurückbekommen
- **WHEN** „ELW 2“ ohne Verbindung eine Notübernahme mit Epoche (2, ELW 2) erklärt, während „ELW 1“ die Führung mit Epoche (3, ELW 1) an den Hub zurückgegeben hat, und „ELW 2“ sich meldet
- **THEN** zeigt „ELW 2“ „Führung übernommen von Hub“ mit „Übernahme bestätigen“ und „Widersprechen“, ohne Alarm „Gegenüber meldet ungültige Übernahme“, und der Hub führt weiter

#### Scenario: Widersprechen
- **WHEN** die Einsatzleitung an „ELW 2“ dieser Übernahme widerspricht und „ELW 2“ sich meldet
- **THEN** führt „ELW 2“ mit Epoche (4, ELW 2) an beiden Seiten
