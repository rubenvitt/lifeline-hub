# Spec Delta

## MODIFIED Requirements

### Requirement: Gelöscht meldet eine Instanz nur mit Beleg

Eine Instanz MUST eine genannte Kennung nur dann als gelöscht melden, wenn sie das Ende des
Einsatzes festgehalten hat und weder einen Einsatz noch eine Akte mit dieser Kennung hält. Das
gilt gleich, ob das Gegenüber die Kennung als Stand eines Spiegels oder als Akte ohne Spiegel
nennt, und unabhängig davon, mit welcher Instanzkennung sie beginnt. Den Beleg SHALL sie
festhalten, wenn sie einen Einsatz mit Kennung endgültig löscht oder zur Verwahrung abgibt und
wenn sie eine Akte auf eine solche Meldung hin löscht. Das Abräumen eines Spiegels nach der
Nachbereitung MUST NOT als Beleg gelten. Eine Kennung, die sie nicht kennt, MUST sie übergehen.

#### Scenario: Rückkehr aus einer Sicherung
- **WHEN** der Hub aus einer Sicherung zurückkehrt, die einen Einsatz noch nicht kannte, und der ELW dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub nichts, und die Akte bleibt am ELW stehen

#### Scenario: Rückkehr aus einer Sicherung mit Spiegel
- **WHEN** der Hub einen übernommenen Einsatz des ELW endgültig gelöscht hat, danach aus einer Sicherung von vor der Löschung zurückkehrt und der ELW den Stand seines Spiegels nennt
- **THEN** meldet der Hub nichts, und der Spiegel bleibt am ELW stehen

#### Scenario: Verwahrter Einsatz mit der Kennung des ELW
- **WHEN** der Hub einen zur Verwahrung übernommenen Einsatz des ELW 1 endgültig löscht und ELW 2 dessen Akte ohne Spiegel nennt
- **THEN** meldet der Hub ihn als gelöscht, obwohl die Kennung mit der des ELW 1 beginnt

#### Scenario: Übernommener Einsatz mit der Kennung des ELW
- **WHEN** der Hub einen Einsatz übernommen hat, dessen Kennung mit der des ELW beginnt, ihn endgültig löscht und der ELW den Stand seines Spiegels nennt
- **THEN** meldet der Hub ihn als gelöscht

#### Scenario: Die Akte kommt wieder
- **WHEN** eine Instanz das Ende einer Kennung festgehalten hat und danach wieder eine Akte mit dieser Kennung bekommt
- **THEN** meldet sie die Kennung nicht als gelöscht, solange sie die Akte hält

#### Scenario: Spiegel nach der Nachbereitung abgeräumt
- **WHEN** der ELW den Spiegel eines Einsatzes nach der Nachbereitung abräumt, den der Hub weiter hält
- **THEN** hält der ELW kein Ende fest und meldet den Einsatz niemandem als gelöscht

#### Scenario: Eigener Einsatz abgegeben und als Spiegel abgeräumt
- **WHEN** der ELW die Führung eines eigenen Einsatzes an den Hub abgegeben hat, seinen Spiegel davon nach der Nachbereitung abräumt und ein Gegenüber danach den Stand dieser Kennung nennt
- **THEN** meldet der ELW den Einsatz nicht als gelöscht, obwohl die Kennung mit seiner beginnt

#### Scenario: Einsatz einer anderen Organisation
- **WHEN** ein Gegenüber eine Kennung nennt, deren Einsatz hier gelöscht wurde, aber zu einer Org gehörte, die dieser Kopplung nicht zugeordnet ist
- **THEN** meldet die Instanz nichts

## ADDED Requirements

### Requirement: Ein Spiegel endet nur auf Meldung seines Führers

Eine Instanz MUST einen Spiegel auf die Meldung, der Einsatz sei gelöscht, nur abräumen, wenn
der Spiegel zu der Kopplung gehört, über die die Meldung kommt, und der Absender sein Führer
ist. Führer ist bei eingeschalteter Führung je Einsatz, wen die Akte des Einsatzes nennt, auch
wenn die Kennung mit einer anderen Instanz beginnt. Ohne Schalter oder ohne Akte ist es die
Instanz, mit deren Kennung die Kennung des Einsatzes beginnt.

#### Scenario: Der Hub löscht einen übernommenen Einsatz
- **WHEN** der Hub einen Einsatz des ELW übernommen hat, den der ELW seitdem als Spiegel hält, und der Hub ihn endgültig löscht
- **THEN** räumt der ELW den Spiegel mit dem nächsten Abgleich ab

#### Scenario: Der ELW löscht einen übernommenen Einsatz
- **WHEN** der ELW einen Einsatz des Hubs übernommen hat, den der Hub seitdem als Spiegel hält, und der ELW ihn endgültig löscht
- **THEN** räumt der Hub den Spiegel mit dem nächsten Abgleich des ELW ab

#### Scenario: Ein ELW meldet den Einsatz eines anderen
- **WHEN** der Hub einen Einsatz spiegelt, dessen Kennung mit der von „ELW 1“ beginnt, den laut Akte aber „ELW 2“ führt, und „ELW 1“ ihn als gelöscht meldet
- **THEN** bleibt der Spiegel am Hub stehen

#### Scenario: Die Akte nennt den Absender nicht
- **WHEN** die Akte eines Spiegels am ELW den Hub als Führer nennt und eine andere Instanz, mit deren Kennung die Kennung des Einsatzes beginnt, ihn über eine eigene Kopplung als gelöscht meldet
- **THEN** bleibt der Spiegel am ELW stehen

#### Scenario: Ohne Führung je Einsatz
- **WHEN** die Führung je Einsatz ausgeschaltet ist und der ELW einen eigenen Einsatz endgültig löscht, den der Hub spiegelt
- **THEN** räumt der Hub den Spiegel mit dem nächsten Abgleich des ELW ab, wie bisher
