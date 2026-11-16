# Spec Delta

## ADDED Requirements

### Requirement: Aktionen je Fahrzeug über ein Menü
Jedes Fahrzeug der Einheit SHALL seine lösende Aktion über genau einen Menü-Auslöser anbieten, der
seinen Funkrufnamen trägt, mit dem neutralen Eintrag „Aus Einheit lösen“. Die FMS-Statuswahl und
„Personal der Einheit übernehmen“ MUST an der Zeile bleiben. Ein roter Lösen-Knopf in der Zeile
MUST NOT erscheinen.

#### Scenario: Fahrzeug lösen
- **WHEN** eine Person mit Schreibrecht im Menü von 83-1 „Aus Einheit lösen“ wählt
- **THEN** gehört 83-1 keiner Einheit mehr an, seine Zeile steht als „Gelöst · Rückgängig“ an ihrer Stelle, die Besatzung steht gedämpft darunter, und ein Hinweis bietet „Rückgängig“

### Requirement: Lösen in der Einheit zurücknehmen
„Rückgängig“ nach „Aus Einheit lösen“ SHALL das Fahrzeug oder die Person wieder dieser Einheit
zuordnen, eine Person auch wieder auf ihr Fahrzeug und, wenn sie es war, als Einheitsführer.
Steht der Datensatz inzwischen in einer anderen Einheit, MUST das Rückgängig scheitern und den
Grund an der Einheit zeigen, statt ihn der anderen Einheit zu nehmen.

#### Scenario: Fahrzeug zurück
- **WHEN** jemand 83-1 aus der Einheit löst und in der gehaltenen Zeile „Rückgängig“ wählt
- **THEN** steht 83-1 wieder mit seiner Besatzung in der Einheit

#### Scenario: Einheitsführer zurück
- **WHEN** jemand den Einheitsführer aus der Einheit löst und im Hinweis „Rückgängig“ wählt
- **THEN** gehört die Person wieder der Einheit an und ist wieder ihr Einheitsführer

#### Scenario: Fahrzeug inzwischen in anderer Einheit
- **WHEN** 83-1 gelöst und vor dem Rückgängig einer anderen Einheit zugeordnet wird
- **THEN** bleibt 83-1 in der anderen Einheit, und an der Einheit steht, dass es inzwischen dort steht

## MODIFIED Requirements

### Requirement: Aktionen je Person über ein Menü
Jede Person der Einheit SHALL ihre Aktionen über genau einen Menü-Auslöser anbieten, der ihren
Namen trägt: „Als Einheitsführer“ (nicht beim Einheitsführer selbst), je anderem Fahrzeug der
Einheit „Auf <Funkrufname>“, dann neutral „Vom Fahrzeug lösen“ (nur wer auf einem Fahrzeug sitzt)
und neutral „Aus Einheit lösen“. Lösen MUST ohne Rückfrage wirken und einen Rückgängig-Hinweis
zeigen, und „Aus Einheit lösen“ MUST die Person im Einsatz lassen.

#### Scenario: Person auf ein Fahrzeug setzen
- **WHEN** eine Person mit Schreibrecht im Menü einer Person ohne Fahrzeug „Auf 83-1“ wählt
- **THEN** steht die Person danach unter 83-1, und das ETB erhält wie bisher einen
  Besatzungs-Eintrag

#### Scenario: Person vom Fahrzeug lösen
- **WHEN** eine Person mit Schreibrecht bei einer Person auf 83-1 „Vom Fahrzeug lösen“ wählt und danach im Hinweis „Rückgängig“
- **THEN** steht die Person wieder unter 83-1

### Requirement: Menüeinträge nach Modulrecht
Die Einträge „Auf <Funkrufname>“ und „Vom Fahrzeug lösen“ MUST nur mit Schreibrecht im Modul
Fahrzeuge und sichtbarer Besatzung erscheinen, „Als Einheitsführer“ und „Aus Einheit lösen“ (an
Person und Fahrzeug) nur mit Schreibrecht im Modul Einheiten. Bleibt kein Eintrag, MUST der
Auslöser fehlen.

#### Scenario: Ohne Recht auf Fahrzeuge
- **WHEN** eine Rolle ohne Zugriff auf das Modul Fahrzeuge das Menü einer Person öffnet
- **THEN** fehlen „Auf …“ und „Vom Fahrzeug lösen“, und „Als Einheitsführer“ und „Aus Einheit
  lösen“ stehen da

#### Scenario: Fahrzeug ohne Recht auf Einheiten
- **WHEN** eine Rolle ohne Schreibrecht im Modul Einheiten die Einheit ansieht
- **THEN** trägt kein Fahrzeug einen Menü-Auslöser
