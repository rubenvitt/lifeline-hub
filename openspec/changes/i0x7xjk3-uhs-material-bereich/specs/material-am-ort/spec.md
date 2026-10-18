## MODIFIED Requirements

### Requirement: Material am Ort zeigen

Die Einheit-Ansicht, der Aufklapper einer Fahrzeugzeile (Block „Beladung“), der UHS-Bereich
„Material“ und die Ansicht eines Bereitstellungsraums SHALL das Material zeigen, dessen Ort sie
sind, jeweils mit demselben Baustein: Bezeichnung, Menge (bei teilweise ausgegebenem Verbrauchsgut
„30 von 50 übrig“) und Status, dazu im Kopf „n Posten“ und bei Ausfall „k Ausfall“. Ein Posten MUST
genau an dem einen Ort erscheinen, an dem er steht.

#### Scenario: Beladung eines Fahrzeugs
- **WHEN** der Stromerzeuger dem Fahrzeug „Florian 1/83-1“ zugeordnet ist und die Person dessen Zeile aufklappt
- **THEN** steht er im Block „Beladung“ und an keiner Einheit, UHS oder in keinem Bereitstellungsraum

#### Scenario: Ausfall im Kopf
- **WHEN** an der UHS „Turnhalle“ drei Posten liegen, einer davon defekt
- **THEN** zeigt der Bereich „Material“ und die Kopfzeile der UHS „3 Posten · 1 Ausfall“

### Requirement: Material am Ort zuordnen

An jedem Ort SHALL eine Auswahl „Material zuordnen …“ Posten ohne Ort und Posten an anderen Orten
anbieten, getrennt in „Ohne Ort“ und „An anderem Ort“, mit dem bisherigen Ort im Etikett. Die Wahl
MUST den Posten an diesen Ort setzen und den bisherigen Ort lösen. Ist nichts anzubieten, MUST die
Ansicht das sagen und in das Modul Material springen lassen. Eine Ablehnung MUST unter der Auswahl
stehen.

#### Scenario: Von der Einheit an die UHS
- **WHEN** die Person im Bereich „Material“ der UHS „Turnhalle“ den Posten „Wolldecke · Staffel A“ wählt
- **THEN** liegt die Wolldecke an der UHS „Turnhalle“, die Einheit-Ansicht von „Staffel A“ zeigt sie nicht mehr, und das ETB nennt „Einheit «Staffel A» → UHS «Turnhalle»“

#### Scenario: Nichts anzubieten
- **WHEN** jeder Posten des Einsatzes schon an diesem Ort liegt
- **THEN** steht neben der Auswahl, dass kein Material ohne Ort da ist, mit einem Sprung in das Modul Material

### Requirement: Material am Ort ausgeben

An jedem Ort SHALL ein Verbrauchsgut mit Rest „Ausgeben“ anbieten, mit demselben Dialog wie die
Materialliste. Der Rest MUST danach an diesem Ort und in der Materialliste stehen.

#### Scenario: Decken an der UHS ausgeben
- **WHEN** die Person an der UHS „Turnhalle“ bei 50 Wolldecken 20 ausgibt
- **THEN** zeigt die Zeile „30 von 50 übrig“, im Reiter und in der Materialliste

### Requirement: Ein Schreibweg für den Ort

Jeder Ortswechsel und jedes Lösen aus der Materialliste, der Einheit-Ansicht, der Fahrzeugliste, dem
UHS-Bereich „Material“ und der Ansicht eines Bereitstellungsraums SHALL dieselbe Änderung der
Material-Disposition senden: das Ort-Feld des Ziels mit seinem Wert, beim Lösen das Ort-Feld des
bisherigen Orts leer. Die Zuordnungswege des Moduls Einheiten MUST NOT für Material genutzt werden.

#### Scenario: Gleicher Wechsel aus zwei Ansichten
- **WHEN** derselbe Posten einmal aus der Materialliste und einmal aus der Einheit-Ansicht der Einheit „Staffel B“ zugeordnet wird
- **THEN** senden beide dieselbe Änderung an die Material-Disposition

### Requirement: Rechte für Material am Ort

Zuordnen, Lösen und Ausgeben am Ort SHALL Schreibrecht im Einsatz und die Freigabe des Moduls
Material verlangen, nicht das Recht des Moduls, das den Ort führt. Einheit-Ansicht und UHS-Bereich „Material“
MUST ihr Material auch ohne Freigabe Material zeigen, die Auswahl dann gesperrt mit dem Grund
„Modul Material gesperrt“. Fahrzeugliste und Bereitstellungsraum MUST ohne Freigabe Material keinen
Material-Block zeigen und das Material nicht abfragen.

#### Scenario: Einheitenrecht ohne Material
- **WHEN** eine Person mit Schreibrecht auf Einheiten, aber ohne Freigabe Material die Einheit-Ansicht öffnet
- **THEN** sieht sie das Material der Einheit ohne Lösen-Knöpfe, und „Material zuordnen …“ steht gesperrt mit „Modul Material gesperrt“

#### Scenario: Fahrzeugliste ohne Material
- **WHEN** eine Person ohne Freigabe Material eine Fahrzeugzeile aufklappt
- **THEN** steht dort kein Block „Beladung“, und die Materialliste wird nicht abgefragt

### Requirement: Beendeter Ort

Ist der Ort beendet (Einheit aufgelöst, Fahrzeug entlassen, UHS oder Bereitstellungsraum
aufgelöst), SHALL das Zuordnen gesperrt mit dem Grund in wenigen Wörtern stehen; das Lösen der
Posten, die dort liegen, MUST möglich bleiben.

#### Scenario: Aufgelöste UHS
- **WHEN** die Person den Bereich „Material“ einer aufgelösten UHS öffnet
- **THEN** steht „Material zuordnen …“ gesperrt mit „UHS aufgelöst“, und „Lösen“ ist bedienbar

### Requirement: Material am Ort auf Geräten

Ein UHS-Laptop SHALL das Material seiner UHS nur lesen: ohne Auswahl, ohne Lösen, ohne Ausgeben. Ein
Gerät des Bereitstellungsraums MUST keinen Material-Block zeigen und kein Material abfragen.

#### Scenario: UHS-Laptop
- **WHEN** der UHS-Laptop den Bereich „Material“ seiner UHS zeigt
- **THEN** stehen die Posten mit Menge und Status da, ohne Bedienelemente

#### Scenario: Gerät im Bereitstellungsraum
- **WHEN** das Gerät des Bereitstellungsraums „BR Nord“ seinen Raum zeigt
- **THEN** fehlt die Sektion „Material“

## ADDED Requirements

### Requirement: Status am Ort setzen

An jedem Ort, der sein Material mit dem gemeinsamen Baustein zeigt, SHALL die Statusanzeige
eines Postens der Auslöser sein, um den Status zu setzen (im Einsatz, defekt, verbraucht). Es
gelten dieselben Rechte wie beim Zuordnen. Die Änderung MUST über denselben Schreibweg gehen
wie im Modul Material. Eine Ablehnung MUST an der Zeile des Postens stehen.

#### Scenario: Trage an der UHS defekt melden
- **WHEN** jemand mit Schreibrecht und Freigabe Material im Bereich „Material“ der UHS
  „Turnhalle“ den Status der „Trage 2“ auf „defekt“ setzt
- **THEN** zeigt die Zeile „defekt“, und der Kopf der UHS zählt einen Ausfall mehr

#### Scenario: Ohne Freigabe Material
- **WHEN** jemand ohne Freigabe Material den Bereich öffnet
- **THEN** ist die Statusanzeige keine Bedienung

### Requirement: Material am Ort erfassen

An jedem Ort mit Schreibrecht und Freigabe Material SHALL „Material erfassen“ Ad-hoc-Material
ohne Stamm anlegen und es in **einem** Schritt diesem Ort zuordnen. Für das Erfassen MUST kein
Sprung in das Modul Material nötig sein. Ein beendeter Ort MUST das Erfassen sperren und den
Grund nennen.

#### Scenario: Sauerstoff an der UHS erfassen
- **WHEN** jemand im Bereich „Material“ der UHS „Turnhalle“ „Material erfassen“ wählt,
  „Sauerstoff 2 l“ mit Menge 4 einträgt und speichert
- **THEN** liegt der neue Posten an der UHS „Turnhalle“, ohne dass ein zweiter Schritt nötig war

### Requirement: Fehlmenge vom Ort melden

Der Bereich „Material“ einer UHS SHALL „Fehlmenge melden“ anbieten. Die Handlung MUST die
Erfassung einer Nachforderung öffnen, vorbelegt mit der Art Material und dem Ort in der
Begründung. Ohne Freigabe des Moduls Nachforderungen MUST die Handlung fehlen.

#### Scenario: Fehlmenge aus der UHS
- **WHEN** jemand im Bereich „Material“ der UHS „Turnhalle“ „Fehlmenge melden“ wählt
- **THEN** öffnet die Erfassung einer Nachforderung mit Art Material und einer Begründung, die
  die UHS „Turnhalle“ nennt
