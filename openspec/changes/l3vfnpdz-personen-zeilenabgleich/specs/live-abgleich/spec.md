# Spec Delta

## ADDED Requirements

### Requirement: Ereignisse zu Personen gleichen zeilenweise ab

Trägt ein Ereignis zu einer betroffenen Person ihre Kennung, SHALL ein Tab nur diese Person
abrufen und sie in die geladene Personenliste, die Personenauswahl und die Betroffenen je
Betreuungsstelle einsortieren, statt diese Listen ganz neu zu laden. Für fehlende Kennung,
gescheiterten Abruf, nicht geladene Liste, zu viele Personen je Fenster, verdeckte Tabs und
laufende Abrufe gelten dieselben Ausnahmen wie bei Schäden.

#### Scenario: Person gesichtet
- **WHEN** an einem Sichtungsplatz eine Person gesichtet wird, während ein zweiter Tab die
  Personenliste mit 2 000 Personen offen hat
- **THEN** ruft der zweite Tab nur diese Person ab, und ihre Zeile zeigt die neue Sichtung an
  derselben Stelle der Liste

#### Scenario: Person neu erfasst
- **WHEN** eine Person neu erfasst oder an einer Betreuungsstelle registriert wird
- **THEN** erscheint sie in der Personenliste und der Personenauswahl der anderen Tabs an der
  Stelle, die ihre Registriernummer vorgibt, ohne dass ein Tab die Liste ganz neu lädt

#### Scenario: Person storniert
- **WHEN** eine Person storniert wird
- **THEN** verschwindet sie aus Personenliste, Personenauswahl und den Betroffenen ihrer
  Betreuungsstelle

#### Scenario: Betroffene einer Betreuungsstelle
- **WHEN** der Verbleib einer Person auf „Notunterkunft“ an einer Betreuungsstelle wechselt oder
  von dort weg
- **THEN** erscheint sie in den Betroffenen dieser Stelle bzw. verschwindet daraus, ohne dass die
  Liste der Stelle ganz neu lädt

#### Scenario: Nachforderung für eine Person
- **WHEN** zu einer Person ein Rettungsmittel nachgefordert oder der Stand dieser Nachforderung
  geändert wird
- **THEN** trägt das Ereignis die Kennung der Person, und die anderen Tabs laden nur ihre Zeile

#### Scenario: Versorgende Einheit umbenannt
- **WHEN** eine Einheit, die Personen versorgt, umbenannt oder einem anderen Abschnitt zugeordnet
  wird, oder ihr Abschnitt umbenannt oder aufgelöst wird
- **THEN** zeigen die Personenlisten der anderen Tabs bei diesen Personen den neuen Namen bzw.
  Abschnitt, ohne dass jemand die Seite neu lädt; bis zehn Personen nur über ihre Zeilen

#### Scenario: Abruf oder Ablösung wechselt den Abschnitt
- **WHEN** eine Einheit mit versorgten Personen aus dem Bereitstellungsraum in einen Abschnitt
  abgerufen wird oder bei einer Ablösung ihren Abschnitt übergibt oder zurückbekommt
- **THEN** zeigen die Personenlisten der anderen Tabs bei diesen Personen den neuen Abschnitt

#### Scenario: Viele Personen auf einmal
- **WHEN** nach einem Funkloch Ereignisse zu 40 Personen in einem Sammelfenster eintreffen
- **THEN** ruft der Tab die Personenliste einmal ganz ab statt 40 Personen einzeln

### Requirement: Der Zeilenabruf einer Person ist nicht protokolliert

Der Zeilenabruf einer Person SHALL genau die Zeile der Personenliste derselben Sitzung liefern,
mit demselben Recht, und MUST ohne Eintrag im Zugriffsprotokoll bleiben. Für eine Person, die die
Liste nicht zeigt (storniert, nicht sichtbar), MUST er mit einem als „nicht in der Liste“
gekennzeichneten 404 antworten; der Tab MUST sie dann ohne Listenabruf aus seinen Listen nehmen.

#### Scenario: Live-Abgleich schreibt kein Protokoll
- **WHEN** zehn Tabs eine Änderung an einer Person zeilenweise abgleichen
- **THEN** steht im Zugriffsprotokoll dieser Person kein neuer Eintrag

#### Scenario: Stornierte Person
- **WHEN** eine Person storniert wird und ein Tab ihre Zeile abruft
- **THEN** antwortet der Server mit 404 ohne Personalien, und der Tab nimmt sie aus seinen
  Listen

#### Scenario: Gerät einer anderen Stelle
- **WHEN** ein gekoppeltes Gerät ein Ereignis zu einer Person erhält, die es in seiner
  Personenliste nicht sähe
- **THEN** antwortet der Server auf den Zeilenabruf mit 404, und das Gerät lädt seine
  Personenliste nicht neu

#### Scenario: 404 einer unbekannten Route
- **WHEN** der Zeilenabruf mit einem 404 endet, der nicht als „nicht in der Liste“ gekennzeichnet
  ist (etwa weil der Server die Route nicht kennt)
- **THEN** behält der Tab die Person und gleicht seine Listen als Ganzes ab

#### Scenario: Einheitengerät
- **WHEN** ein Einheitengerät eine von seiner Einheit versorgte Person abruft
- **THEN** fehlen die Personalien wie in seiner Personenliste

### Requirement: Der Zeilenabgleich überschreibt keine lokale Änderung

Ändert sich eine abgerufene Zeile im Tab, während ihr Zeilenabruf läuft (etwa durch eine
optimistische Änderung), MUST der Zeilenabgleich diese Zeile nicht mit dem abgerufenen Stand
überschreiben, sondern sie im nächsten Sammelfenster erneut abrufen. Die übrigen abgerufenen
Zeilen SHALL er einsetzen. Das gilt für Schäden und Personen.

#### Scenario: Person im Grundriss gezogen
- **WHEN** jemand eine Person im Grundriss auf einen Platz zieht, während ihr Zeilenabruf aus
  einem fremden Ereignis läuft
- **THEN** springt sie nicht auf den alten Platz zurück, und ihre Zeile wird im nächsten Fenster
  erneut abgerufen

#### Scenario: Andere Zeile geändert
- **WHEN** während des Zeilenabrufs einer Person eine andere Person der Liste lokal geändert wird
- **THEN** behält die andere Person ihre Änderung, und die abgerufene Zeile geht ein, ohne dass
  der Tab die Liste ganz neu lädt
