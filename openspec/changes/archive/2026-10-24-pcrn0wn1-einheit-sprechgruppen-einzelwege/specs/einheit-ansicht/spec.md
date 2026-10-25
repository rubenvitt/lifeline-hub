# Spec Delta

## MODIFIED Requirements

### Requirement: Ein Speichern schickt genau die geänderte Angabe
Das Speichern einer Angabe SHALL genau dieses eine Feld an
`PATCH /api/einsaetze/{id}/einheiten/{eid}` senden; die Soll-Stärke MUST als ihre drei Felder in
einer Anfrage gehen. Ist der Wert unverändert, MUST keine Anfrage entstehen. Leert jemand eine
optionale Angabe, MUST das Feld als `null` gesendet werden. Die Sprechgruppen gehen nicht über
diesen Weg, sondern einzeln (Anforderung „Sprechgruppen einzeln zuordnen und lösen“).
Eine Änderung, die ein anderer Arbeitsplatz an einer anderen Angabe gemacht hat, MUST dabei
erhalten bleiben.

#### Scenario: Zwei Arbeitsplätze, zwei Angaben
- **WHEN** die Ansicht eine Einheit mit Abschnitt „Nord“ zeigt, an einem anderen Arbeitsplatz der
  Abschnitt auf „Süd“ gesetzt wird und hier danach nur der Funkrufname gespeichert wird
- **THEN** enthält die gesendete Änderung nur den Funkrufnamen, und der Abschnitt bleibt „Süd“

#### Scenario: Einheitsführer wechseln
- **WHEN** eine Person mit Schreibrecht eine andere Person der Einheit als Einheitsführer setzt
- **THEN** enthält die gesendete Änderung nur `fuehrer_id`, und das ETB erhält wie bisher einen
  System-Eintrag zum Wechsel

#### Scenario: Unverändert gespeichert
- **WHEN** jemand eine Angabe öffnet und ohne Änderung speichert
- **THEN** wird keine Anfrage gesendet, und die Zeile kehrt in die Ansicht zurück

## ADDED Requirements

### Requirement: Sprechgruppen einzeln zuordnen und lösen
Das Speichern der Sprechgruppen SHALL je hinzugefügter Sprechgruppe eine Zuordnung
(`PUT …/einheiten/{eid}/sprechgruppen/{sg}`) und je entfernter eine Lösung (`DELETE`, derselbe
Pfad) senden, berechnet gegen den Stand beim Öffnen der Zeile. Die ganze Menge MUST nicht
gesendet werden. Sprechgruppen, die hier nicht geändert wurden, MUST unberührt bleiben, auch
wenn ein anderer Arbeitsplatz sie inzwischen zugeordnet oder gelöst hat.

#### Scenario: Eine Sprechgruppe hinzufügen
- **WHEN** die Einheit die Sprechgruppe „311“ hat und jemand „505“ hinzufügt und speichert
- **THEN** geht genau eine Zuordnung für „505“ hinaus, keine Anfrage für „311“ und kein PATCH

#### Scenario: Zwei Arbeitsplätze zugleich
- **WHEN** zwei Arbeitsplätze dieselbe Einheit ohne Sprechgruppe öffnen, der eine „311“ und der
  andere danach „505“ hinzufügt und beide speichern
- **THEN** hat die Einheit beide Sprechgruppen „311“ und „505“

#### Scenario: Entfernen lässt fremde Zuordnung stehen
- **WHEN** die Ansicht die Zeile mit „311“ öffnet, ein anderer Arbeitsplatz danach „505“ zuordnet
  und hier „311“ entfernt und gespeichert wird
- **THEN** geht genau eine Lösung für „311“ hinaus, und die Einheit behält „505“

#### Scenario: Teilweise abgelehnt
- **WHEN** von zwei Änderungen die zweite abgelehnt wird
- **THEN** bleibt die Zeile mit dem Entwurf offen, der Grund steht darunter, und die Ansicht zeigt
  den gespeicherten Stand mit der ersten Änderung

### Requirement: ETB-Eintrag je Sprechgruppen-Änderung
Jede wirksame Zuordnung oder Lösung einer Sprechgruppe an einer Einheit über die Einzelwege
SHALL einen System-Eintrag im ETB erzeugen, der Einheit und Sprechgruppe mit Betriebsart nennt.
Eine wiederholte Anfrage ohne Wirkung MUST keinen Eintrag erzeugen. Das gilt für jede Quelle
dieser Wege, auch die Fernmeldeskizze.

#### Scenario: Zuordnen und Lösen
- **WHEN** jemand der Einheit „1. Zug“ die Sprechgruppe „311“ (TMO) zuordnet und sie danach löst
- **THEN** erhält das ETB zwei System-Einträge: „Einheit «1. Zug»: Sprechgruppe «311» (TMO)
  zugeordnet“ und „Einheit «1. Zug»: Sprechgruppe «311» (TMO) entfernt“

#### Scenario: Wiederholte Zuordnung
- **WHEN** dieselbe Sprechgruppe der Einheit ein zweites Mal zugeordnet wird
- **THEN** entsteht kein weiterer ETB-Eintrag
