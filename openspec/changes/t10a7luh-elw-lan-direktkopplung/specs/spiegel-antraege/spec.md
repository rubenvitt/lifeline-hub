# Spec Delta

## ADDED Requirements

### Requirement: Das Konto eines Antrags wird über die Ursprungskennung erkannt

Ein Antrag SHALL die Ursprungskennung seines Kontos tragen. Kann der Führer das Konto nicht über
die Stammdaten der Kopplung abbilden, MUST er es über die Ursprungskennung abbilden: das eigene
aktive Konto der Org des Einsatzes mit derselben Ursprungskennung. Ein Stellvertreter MUST dabei
nie gewählt werden. Gibt es kein solches Konto, MUST der Antrag wie bisher mit „Konto am Führer
unbekannt“ abgelehnt werden.

#### Scenario: ETB-Eintrag vom ELW vor Ort
- **WHEN** „Anna Berg“, vom Hub an ELW 1 und ELW 2 geliefert, an ELW 2 im Spiegel eines Einsatzes von ELW 1 einen ETB-Eintrag erfasst
- **THEN** übernimmt ELW 1 den Antrag als Eintrag von „Anna Berg“, und nach dem nächsten Abgleich steht er im Spiegel an ELW 2

#### Scenario: Konto nur an ELW 2
- **WHEN** ein Konto, das nur an ELW 2 angelegt wurde, an ELW 2 einen Antrag in einem Einsatz von ELW 1 stellt
- **THEN** lehnt ELW 1 den Antrag mit „Konto am Führer unbekannt“ ab

### Requirement: Verweise eines Antrags auf Stammdaten folgen der Ursprungskennung

Verweist ein Antrag auf eine Stammdatenzeile, SHALL er ihre Ursprungskennung tragen, und der
Führer MUST den Verweis auf seine Zeile derselben Ursprungskennung abbilden, wenn die Stammdaten
der Kopplung es nicht tun. Gibt es keine, MUST der Verweis leer bleiben, wie bei der Übernahme
eines Spiegels.

#### Scenario: Belegungsmeldung mit Einheitsvorlage vom Hub
- **WHEN** an ELW 2 im Spiegel eines Einsatzes von ELW 1 eine Belegung eines Bereitstellungsraums mit der Einheitsvorlage „Sanitätstrupp“ vom Hub beantragt wird
- **THEN** führt ELW 1 die Belegung mit seiner Einheitsvorlage derselben Ursprungskennung aus
