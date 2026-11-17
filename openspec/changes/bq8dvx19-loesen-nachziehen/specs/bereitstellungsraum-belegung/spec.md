## MODIFIED Requirements

### Requirement: Wartezeit je Kraft im Raum
Das Detail eines Bereitstellungsraums SHALL für jede Einheit und jedes einheitenlose Fahrzeug,
das im Raum steht, den Zeitpunkt nennen, seit dem es dort steht („seit“). „Seit“ MUST der
Zeitpunkt des jüngsten Eintritts, Wechsels oder Austritts des Objekts sein, gemessen an der
Erfassungsreihenfolge; Abrufe und ihre Rücknahmen MUST dabei übergangen werden, ebenso ein
zurückgenommener Austritt samt seiner Rücknahme. „Seit“ MUST nur
dann gesetzt sein, wenn dieses Ereignis ein Eintritt oder ein Wechsel in genau diesen Raum ist;
sonst MUST „seit“ fehlen. Ein früherer Eintritt in einen anderen Raum MUST „seit“ nicht
bestimmen. Zeitpunkte MUST als UTC ohne Zonenkennung (`YYYY-MM-DD HH:MM:SS`) übertragen werden.

#### Scenario: Eintritt
- **WHEN** die Einheit „1. Zug“ um 13:42 in den BR Sportplatz eintritt
- **THEN** nennt das Detail des BR Sportplatz für „1. Zug“ „seit“ 13:42

#### Scenario: Wechsel zwischen zwei Räumen
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt und um 14:10 in den BR Schule wechselt
- **THEN** nennt das Detail des BR Schule für „1. Zug“ „seit“ 14:10, nicht 13:42
- **AND** das Detail des BR Sportplatz führt „1. Zug“ nicht mehr

#### Scenario: Belegung ohne Ereignis
- **WHEN** eine Einheit im Raum steht, für die kein Eintritt oder Wechsel in diesen Raum als
  jüngstes Ereignis vorliegt
- **THEN** führt das Detail die Einheit ohne „seit“

#### Scenario: Abruf ändert die Wartezeit nicht
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt, um 14:30 abgerufen wird und der
  Abruf um 14:35 zurückgenommen wird
- **THEN** nennt das Detail für „1. Zug“ „seit“ 13:42

#### Scenario: Zurückgenommenes Austragen ändert die Wartezeit nicht
- **WHEN** „1. Zug“ um 13:42 in den BR Sportplatz eintritt, um 14:30 ausgetragen wird und das
  Austragen um 14:31 zurückgenommen wird
- **THEN** nennt das Detail für „1. Zug“ „seit“ 13:42, und die längste Wartezeit des Raums
  rechnet ab 13:42

## ADDED Requirements

### Requirement: Austritt zurücknehmen
Das System SHALL einen Austritt zurücknehmen, den die Belegungsroute gebucht hat. Die Rücknahme
MUST ein neues Ereignis sein, das die Kraft in denselben Raum zurückbringt und den Austritt
nennt, den es zurücknimmt. Sie MUST abgelehnt werden (409 mit Grund, ohne Ereignis, ETB-Eintrag
und Änderung), wenn der Austritt nicht das jüngste Belegungsereignis der Kraft ist, älter als
zehn Minuten ist, schon zurückgenommen ist, ein Ausrücken war oder einen eigenen Anlass trägt
(Austritt eines Systemwegs wie Storno einer Übernahme oder Rückweg einer Ablösung).

#### Scenario: Rücknahme gleich nach dem Austragen
- **WHEN** „HLF 20“ aus dem BR Sportplatz ausgetragen wird und die Rücknahme dieses Austritts eine Minute später eingeht
- **THEN** steht „HLF 20“ wieder im BR Sportplatz, und das ETB nennt, dass das Austragen zurückgenommen ist

#### Scenario: Kraft inzwischen woanders gebucht
- **WHEN** „HLF 20“ ausgetragen und danach in den BR Schule eingetragen wurde und die Rücknahme des Austritts eingeht
- **THEN** lehnt der Server mit 409 ab, und „HLF 20“ bleibt im BR Schule

#### Scenario: Zu spät
- **WHEN** die Rücknahme eines Austritts elf Minuten nach dem Austragen eingeht
- **THEN** lehnt der Server mit 409 ab, und die Kraft bleibt ausgetragen

#### Scenario: Austritt eines Systemwegs
- **WHEN** der Storno einer Übernahme „1. Zug“ aus dem Raum ausgebucht hat und die Rücknahme dieses Austritts eingeht
- **THEN** lehnt der Server mit 409 ab, und „1. Zug“ bleibt ausgetragen

#### Scenario: Raum inzwischen aufgelöst
- **WHEN** der Raum nach dem Austragen aufgelöst wurde und die Rücknahme eingeht
- **THEN** lehnt der Server ab, und die Kraft bleibt ausgetragen

### Requirement: Rechte der Rücknahme
Die Rücknahme eines Austritts MUST dieselben Rechte verlangen wie das Austragen selbst, am
Einsatz wie am gekoppelten Gerät des Raums.

#### Scenario: Einweiser am Tablet
- **WHEN** der Einweiser am Tablet des BR Sportplatz „HLF 20“ austrägt und „Rückgängig“ wählt
- **THEN** steht „HLF 20“ wieder im BR Sportplatz

### Requirement: Rücknahme im Verlauf
Der Verlauf eines Raums SHALL den zurückgenommenen Austritt und seine Rücknahme als zwei Zeilen
zeigen; die Rücknahme MUST als „Austragen zurückgenommen“ erkennbar sein, nicht als neuer
Eintritt.

#### Scenario: Verlauf nach Rücknahme
- **WHEN** „HLF 20“ um 14:30 ausgetragen und um 14:31 die Rücknahme gebucht wurde
- **THEN** zeigt der Verlauf des BR Sportplatz „Austritt“ und danach „Austragen zurückgenommen“

### Requirement: Austragen rückgängig in der Oberfläche
Nach „Austragen“ im Aktionsmenü einer bereitgestellten Kraft SHALL der Hinweis „<Art> „<Name>“
aus dem BR ausgetragen“ mit „Rückgängig“ stehen. „Rückgängig“ MUST die Rücknahme des eben
gebuchten Austritts senden. Eine Ablehnung MUST im Seitenhinweis mit dem Grund des Servers
stehen, ohne Fehler-Toast. „Abrufen und austragen“ und „Ausrücken“ MUST kein Rückgängig zeigen.

#### Scenario: Austragen rückgängig
- **WHEN** die Führung im BR Sportplatz bei „HLF 20“ „Austragen“ wählt und im Hinweis „Rückgängig“ wählt
- **THEN** steht „HLF 20“ wieder in der Belegung mit seiner bisherigen Wartezeit

#### Scenario: Ablehnung
- **WHEN** die Rücknahme abgelehnt wird, weil „HLF 20“ inzwischen im BR Schule steht
- **THEN** nennt der Seitenhinweis den Grund, und es erscheint kein Fehler-Toast
