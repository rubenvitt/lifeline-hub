## REMOVED Requirements

### Requirement: Eine Zuordnung lösen
**Reason**: Das Szenario „Bekannte Lücke bei Material am Ort“ ist durch LLH-1924 geschlossen; ein MODIFIED dürfte es nicht streichen.
**Migration**: Ersetzt durch „Lösen einer Zuordnung“ mit gleichem Text und dem Szenario „Verbrauchsgut am Ort“.

### Requirement: Eine gelöste Zeile hält ihre Stelle
**Reason**: Das Szenario „Bekannte Lücke bei Abziehen und Besatzung“ ist durch LLH-1924 geschlossen.
**Migration**: Ersetzt durch „Gelöste Zeile hält ihre Stelle“ mit gleichem Text und den Szenarien für UHS und Fahrzeugliste.

## ADDED Requirements

### Requirement: Lösen einer Zuordnung

Das Lösen einer Zuordnung (aus einer Einheit, vom Fahrzeug, von einem Ort, von einer
Nachforderung) SHALL „Aus <Ziel> lösen“ oder „Vom <Ziel> lösen“ heißen, ohne Rückfrage wirken und
einen Rückgängig-Hinweis zeigen. Es MUST im ⋮ der Zeile stehen. Als sichtbarer Knopf MUST es nur
stehen, wenn es die einzige Handlung der Zeile ist. „Abziehen“ (UHS) und „Austragen“
(Bereitstellungsraum) bleiben als Fachwörter.

#### Scenario: Fahrzeug in der Einheit
- **WHEN** jemand im Einheit-Detail die Zeile eines Fahrzeugs ansieht
- **THEN** steht „Aus Einheit lösen“ in ihrem ⋮ und nicht als Knopf in der Zeile

#### Scenario: Posten am Ort
- **WHEN** jemand an einer UHS die Zeile eines Materialpostens ansieht, die nur das Lösen anbietet
- **THEN** steht „Lösen“ als Knopf in der Zeile

#### Scenario: Verbrauchsgut am Ort
- **WHEN** die Zeile eines Verbrauchsguts am Ort „Ausgeben“ und „Lösen“ anbietet
- **THEN** steht „Ausgeben“ als Knopf in der Zeile und „Lösen“ in ihrem ⋮

### Requirement: Gelöste Zeile hält ihre Stelle

Fällt ein selbst gelöster Datensatz durch das Lösen aus der Ansicht, MUST seine Zeile mit allen
Teilen an Stelle und Höhe als „Gelöst“ mit „Rückgängig“ stehen bleiben, bis Zeiger und Fokus den
Bereich verlassen haben und einige Sekunden vergangen sind. An der Stelle des Auslösers MUST dann
nichts auslösen. Wandert der Datensatz nur in der Ansicht oder löst eine Person über ihr ⋮ aus der
Einheit, genügt der Hinweis.

#### Scenario: Zwei schnelle Tipps lösen ein Fahrzeug
- **WHEN** jemand im Einheit-Detail mit den Fahrzeugen 83-1 und 83-2 „Aus Einheit lösen“ für 83-1 wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** ist nur 83-1 gelöst, 83-2 bleibt in der Einheit, und an der Stelle von 83-1 steht „Gelöst“

#### Scenario: Rückgängig in der Zeile
- **WHEN** jemand in der gehaltenen Zeile „Rückgängig“ wählt
- **THEN** steht der Datensatz wieder an diesem Ort, und seine Zeile zeigt wieder ihre Handlungen

#### Scenario: Person aus der Einheit lösen
- **WHEN** jemand im Einheit-Detail bei einer Person „Aus Einheit lösen“ wählt
- **THEN** verschwindet ihre Zeile, und der Hinweis bietet „Rückgängig“

#### Scenario: Zwei schnelle Tipps beim Abziehen
- **WHEN** jemand an einer UHS mit den Kräften Anna und Ben bei Anna „Abziehen“ wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** ist nur Anna abgezogen, Ben bleibt an der UHS, an der Stelle des Knopfs steht „Gelöst“, und an der Stelle ihrer Funktion steht „Rückgängig“

#### Scenario: Zwei schnelle Tipps in der Besatzung der Fahrzeugliste
- **WHEN** jemand in der Fahrzeugliste im Besatzungsblock von 83-1 bei Anna „Vom Fahrzeug lösen“ wählt und danach zweimal schnell an dieselbe Stelle tippt
- **THEN** geht genau eine Anfrage zum Lösen hinaus, Ben sitzt weiter auf 83-1, an der Stelle des Knopfs steht „Gelöst“, und an der Stelle ihrer Position steht „Rückgängig“

#### Scenario: Person wandert in der Ansicht
- **WHEN** jemand bei einer Person „Vom Fahrzeug lösen“ wählt
- **THEN** steht sie unter „Ohne Fahrzeug“, keine gehaltene Zeile bleibt zurück, und der Hinweis bietet „Rückgängig“

### Requirement: Rückgängig nimmt nichts woanders weg

Das Rückgängig einer gelösten Zuordnung MUST den Datensatz nur dann an seinen Ort zurückbringen,
wenn er inzwischen nicht anders gebunden ist (anderer Ort, anderes Fahrzeug, andere UHS, andere
Einheit). Sonst MUST es ohne Änderung abgelehnt werden, und die Ablehnung MUST den Ort nennen,
an dem der Datensatz jetzt steht. Das bewusste Zuordnen über Auswahl oder Einteilung MUST
weiter verschieben.

#### Scenario: Person sitzt inzwischen auf einem anderen Fahrzeug
- **WHEN** Anna von 83-1 gelöst wurde, inzwischen auf 83-2 sitzt und jemand beim Lösen von 83-1 „Rückgängig“ wählt
- **THEN** sitzt Anna weiter auf 83-2, und die Ablehnung nennt „Anna sitzt inzwischen auf «83-2»“

#### Scenario: Kraft steht inzwischen an einer anderen UHS
- **WHEN** Ben an der UHS Turnhalle abgezogen wurde, inzwischen an der UHS Zelt Nord steht und jemand „Rückgängig“ wählt
- **THEN** bleibt Ben an der UHS Zelt Nord, und die Ablehnung nennt die UHS Zelt Nord

#### Scenario: Posten liegt inzwischen an einem anderen Ort
- **WHEN** die Trage an der UHS gelöst wurde, inzwischen auf 83-1 geladen ist und jemand „Rückgängig“ wählt
- **THEN** bleibt die Trage auf 83-1, und die Ablehnung nennt das Fahrzeug 83-1

#### Scenario: Bewusstes Umsetzen bleibt
- **WHEN** jemand Anna über die Auswahl der Besatzung von 83-2 auf 83-1 setzt
- **THEN** sitzt Anna auf 83-1 und nicht mehr auf 83-2, ohne Ablehnung

### Requirement: Austragen zurücknehmen

„Austragen“ am Bereitstellungsraum und an der UHS SHALL einen Rückgängig-Hinweis zeigen. Sein
Rückweg MUST den Zustand davor herstellen: denselben Raum bzw. dieselbe UHS und die laufende
Wartezeit ohne Neubeginn. Er MUST nur gelingen, solange das Austragen der jüngste Schritt der
Kraft bzw. Person ist und höchstens zehn Minuten zurückliegt. Sonst MUST er mit Grund abgelehnt
werden. „Ausrücken“ nach dem Abruf MUST ohne Rückgängig bleiben.

#### Scenario: Fehltipp am Bereitstellungsraum
- **WHEN** „HLF 20“ seit 13:42 im BR Sportplatz steht, um 14:30 ausgetragen wird und jemand gleich danach „Rückgängig“ wählt
- **THEN** steht „HLF 20“ wieder im BR Sportplatz mit „seit 13:42“

#### Scenario: Inzwischen weiter gebucht
- **WHEN** „HLF 20“ ausgetragen und danach in den BR Schule eingetragen wurde und jemand „Rückgängig“ wählt
- **THEN** bleibt „HLF 20“ im BR Schule, und die Ablehnung nennt den Grund

#### Scenario: Ausrücken bleibt ohne Rückgängig
- **WHEN** eine abgerufene Kraft ausrückt
- **THEN** zeigt der Hinweis kein „Rückgängig“
