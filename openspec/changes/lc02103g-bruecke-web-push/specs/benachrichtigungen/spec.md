# Spec Delta

## ADDED Requirements

### Requirement: Hinweise zu einem Einsatz des ELW entstehen auch am Hub

Führt ein gekoppelter ELW einen Einsatz, den ein Hub spiegelt und der Hinweise annimmt, SHALL
jeder Anlass einer Benachrichtigung dort auch am Hub ankommen. Der Hub MUST die Empfänger nach
denselben Regeln wie für eigene Einsätze aus seinem Spiegel bestimmen und eigene
Benachrichtigungen anlegen, mit Live-Ereignis und Web Push. Der Auslöser MUST NOT einen Hinweis
erhalten, ein Konto, das nur am ELW besteht, MUST NOT einen am Hub erhalten. Hinweise und
Live-Ereignisse am ELW MUST bleiben, wie sie sind.

#### Scenario: Sofortmeldung am ELW
- **WHEN** am ELW eine Sofortmeldung an die Einsatzleitung eingeht und Person A am Hub als Einsatzleitung Mitglied des gespiegelten Einsatzes ist
- **THEN** erhält A am Hub den Alarm „Sofortmeldung“, und ein Tipp darauf öffnet die Meldung im Spiegel am Hub

#### Scenario: Neuer Einsatz am ELW
- **WHEN** am ELW ein Einsatz der gekoppelten Org angelegt wird und Führungskraft F der Org am Hub ihn lesen darf
- **THEN** erhält F am Hub den Hinweis „Neuer Einsatz“, sobald der Einsatz am Hub gespiegelt ist

#### Scenario: Eigene Aktion
- **WHEN** Person A am ELW einen Auftrag an S4 erteilt und A am Hub S4 besetzt
- **THEN** erhält A weder am ELW noch am Hub einen Hinweis dafür

#### Scenario: Ohne Verbindung
- **WHEN** der ELW 30 Minuten ohne Verbindung zum Hub ist und in dieser Zeit ein Auftrag an S4 erteilt wird
- **THEN** erhält S4 am Hub den Hinweis nach dem nächsten Abgleich

#### Scenario: Ungekoppelte Instanz
- **WHEN** eine Instanz ohne Kopplung eine Sofortmeldung erhält
- **THEN** verhält sie sich wie vor dieser Änderung

### Requirement: Ein Hinweis kommt am Hub einmal und höchstens 12 Stunden spät an

Ein Anlass MUST am Hub höchstens einmal zu Benachrichtigungen führen, auch wenn der Abgleich ihn
mehrfach überträgt. Kommt ein Anlass erst an, wenn sein Objekt am Hub noch fehlt, MUST der Hub
ihn zurückstellen, bis das Objekt da ist; das gilt auch für „für alle erledigt“. Ist ein Anlass älter als 12 Stunden, wenn der Hub ihn
annehmen könnte, MUST der Hub ihn verwerfen.

#### Scenario: Abgleich wiederholt
- **WHEN** die Antwort des Hubs auf einen Abgleich verloren geht und der ELW denselben Anlass erneut sendet
- **THEN** hat jeder Empfänger am Hub genau eine Benachrichtigung dazu

#### Scenario: Objekt noch nicht gespiegelt
- **WHEN** ein Anlass zu einer Meldung ankommt, deren Zeile im selben Abgleich nicht mehr ins Paket passte
- **THEN** legt der Hub die Benachrichtigung an, sobald die Meldung im Spiegel steht

#### Scenario: Zwei Tage ohne Netz
- **WHEN** der ELW zwei Tage ohne Verbindung war und dann abgleicht
- **THEN** entstehen am Hub keine Benachrichtigungen für Anlässe, die älter als 12 Stunden sind

### Requirement: Für alle erledigt gilt auch am Hub

Quittiert der ELW die offenen Hinweise eines Bezugs für alle Empfänger (Anforderung „Sichten räumt
den Hinweis bei allen“), SHALL der Hub die offenen Hinweise desselben Bezugs ebenso für alle
quittieren. Ein Alarm MUST davon unberührt bleiben.

#### Scenario: Gesichtet am ELW
- **WHEN** Person C am ELW eine Meldung sichtet, zu der Person A am Hub den Hinweis „Neue Meldung“ hat
- **THEN** ist der Hinweis bei A am Hub nach dem nächsten Abgleich quittiert und verschwindet in ihren Tabs

### Requirement: Benachrichtigungen an Spiegeln werden aufgeräumt

Der Server SHALL Benachrichtigungen an einem Spiegel-Einsatz nach denselben Fristen aufräumen wie
an einem eigenen (Anforderung „Verlauf der Benachrichtigungen“).

#### Scenario: Hinweis am Hub nach 24 Stunden
- **WHEN** Person A am Hub einen Hinweis zu einem Einsatz des ELW vor 25 Stunden erhalten und nie gelesen hat
- **THEN** ist er aus ihrem Verlauf verschwunden
