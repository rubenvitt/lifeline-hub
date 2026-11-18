# Spec Delta

## ADDED Requirements

### Requirement: Filter nach Auftrag und Rückmeldung

Das Meldebild SHALL im Filter-Menü neben Trägerorganisation und Status zwei Schalter für Einheiten
bieten. „Ohne Auftrag“ MUST die Einheiten treffen, an die kein offener oder laufender Auftrag
gerichtet ist. „Rückmeldung fehlt oder überfällig“ MUST die Einheiten treffen, deren letzte
Rückmeldung überfällig ist oder die nie zurückgemeldet haben, und MUST mit der Seitenuhr
umschlagen. Beide gesetzt MUST beide Bedingungen verlangen. Ein gesetzter Schalter MUST wie die
übrigen Filter als Marke stehen, in „Filter (n)“ zählen und mit „Filter zurücksetzen“ wegfallen.

#### Scenario: Einheiten ohne Auftrag
- **WHEN** von drei Einheiten nur „RTW 1“ einen laufenden Auftrag hat und die Person „ohne Auftrag“
  setzt
- **THEN** zeigt das Meldebild die beiden anderen Einheiten, die Marke „ohne Auftrag“ und den Knopf
  „Filter (1)“

#### Scenario: Rückmeldung fehlt oder überfällig
- **WHEN** „KTW 2“ nie zurückgemeldet hat, die Rückmeldung von „RTW 1“ seit 10 Minuten überfällig
  und die von „GW 1“ in der Frist ist, und die Person „Rückmeldung fehlt oder überfällig“ setzt
- **THEN** zeigt das Meldebild „KTW 2“ und „RTW 1“, nicht „GW 1“

#### Scenario: Frist läuft ab, während der Filter gesetzt ist
- **WHEN** der Schalter „Rückmeldung fehlt oder überfällig“ gesetzt ist und die Frist von „GW 1“
  verstreicht
- **THEN** erscheint „GW 1“ ohne Neuladen in der Auswahl

### Requirement: Einheiten-Filter gilt für die ganze Auswahl

Mit einem wirksamen Schalter aus „Filter nach Auftrag und Rückmeldung“ MUST das Meldebild nur die
zutreffenden Einheiten mit ihren Mitteln zeigen, und „Ohne Einheit“ MUST entfallen. Trifft eine
Untereinheit zu, ihre Obereinheit aber nicht, MUST die Obereinheit als Rahmen ohne eigene Mittel
stehen und MUST NOT als Treffer zählen. Auswahlzeile, Statusband (Einheiten und Personal),
Lagebericht-Text und Druck MUST dieselbe Auswahl zeigen, und der Zulauf MUST entfallen.

#### Scenario: Statusband folgt
- **WHEN** zwei von drei Einheiten ohne Auftrag sind und die Person „ohne Auftrag“ setzt
- **THEN** zählt das Paneel „Einheiten nach FMS-Status“ 2 Einheiten und das Personal-Paneel nur
  deren Kräfte

#### Scenario: Untereinheit trifft
- **WHEN** die Gruppe „Gr 1“ unter „Zug 1“ keinen Auftrag hat, „Zug 1“ selbst aber einen, und die
  Person „ohne Auftrag“ setzt
- **THEN** steht „Gr 1“ eingerückt unter „Zug 1“, „Zug 1“ zeigt keine eigenen Mittel und zählt im
  Statusband nicht mit

### Requirement: Einheiten-Filter ohne lesbare Quelle

Kann die Seite die Aufträge bzw. die Rückmeldungen nicht lesen (keine Freigabe, noch nicht geladen,
Abruf gescheitert), MUST der zugehörige Schalter deaktiviert sein und den Grund nennen. Ein schon
gesetzter Schalter MUST in diesem Zustand nicht filtern und MUST das an seiner Marke sagen; er
MUST NOT jede oder keine Einheit als Treffer werten.

#### Scenario: Aufträge nicht lesbar
- **WHEN** die Rolle das Modul Aufträge nicht lesen darf
- **THEN** ist der Schalter „ohne Auftrag“ deaktiviert und nennt die fehlende Freigabe

#### Scenario: Rückmeldungen fallen während des Filterns aus
- **WHEN** „Rückmeldung fehlt oder überfällig“ gesetzt ist und der Abruf der Rückmeldungen
  scheitert
- **THEN** zeigt das Meldebild die Einheiten ohne diesen Filter, und die Marke sagt, dass er gerade
  nicht wirkt
