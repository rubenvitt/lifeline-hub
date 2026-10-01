# Spec Delta

## ADDED Requirements

### Requirement: Idempotente Erfassung einer Ausgabe

Eine Ausgabe SHALL optional einen Idempotenzschlüssel `client_id` tragen (höchstens 64 Zeichen,
leer zählt als fehlend). Je Einsatz MUST eine `client_id` höchstens eine Ausgabe bezeichnen. Ist
die `client_id` schon gespeichert, MUST das System diese Ausgabe mit dem aktuellen Zeitfenster
zurückliefern (201), ohne zweite Ausgabe und ohne weiteres Live-Ereignis. Ausgaben ohne
`client_id` MUST sich wie bisher verhalten.

#### Scenario: Wiederholte Ausgabe
- **WHEN** eine Ausgabe „120 EP“ mit `client_id` „v1“ zum Zeitfenster „Mittag“ gespeichert ist und dieselbe Ausgabe mit „v1“ erneut eintrifft
- **THEN** antwortet das System mit 201 und derselben Ausgabekennung
- **AND** das Zeitfenster hat genau eine Ausgabe mit „v1“, und die ausgegebene Menge steigt nicht

#### Scenario: Kein zweites Live-Ereignis beim Replay
- **WHEN** eine schon gespeicherte Ausgabe mit ihrer `client_id` erneut eintrifft
- **THEN** löst das System kein Live-Ereignis `verpflegung` aus

#### Scenario: Schlüssel eines anderen Zeitfensters
- **WHEN** zu `client_id` „v2“ eine Ausgabe am Zeitfenster „Mittag“ gespeichert ist und eine Ausgabe mit „v2“ am Zeitfenster „Abend“ eintrifft
- **THEN** antwortet das System mit 422 und speichert nichts

#### Scenario: Schlüssel eines anderen Einsatzes
- **WHEN** in Einsatz 1 eine Ausgabe mit `client_id` „v3“ gespeichert ist und in Einsatz 2 eine Ausgabe mit „v3“ eintrifft
- **THEN** speichert das System in Einsatz 2 eine neue Ausgabe und gibt keine Daten aus Einsatz 1 zurück

#### Scenario: Zu langer Schlüssel
- **WHEN** eine Ausgabe mit einer `client_id` von mehr als 64 Zeichen eintrifft
- **THEN** antwortet das System mit 400 und speichert nichts

### Requirement: Replay vor der Zustandsprüfung

Die Suche nach einer gespeicherten Ausgabe zur `client_id` MUST nach den Prüfungen auf
Schreibrecht und Modulzugang laufen, aber vor der Prüfung auf einen aktiven Einsatz. Ein Replay
MUST die gespeicherte Ausgabe auch dann liefern, wenn sie inzwischen zurückgenommen ist. Eine
neue Ausgabe an einem abgeschlossenen Einsatz MUST weiter mit 409 abgelehnt werden.

#### Scenario: Replay nach Einsatzende
- **WHEN** eine Ausgabe mit `client_id` „v4“ gespeichert ist, der Einsatz danach abgeschlossen wird und dieselbe Ausgabe erneut eintrifft
- **THEN** antwortet das System mit 201 und der bestehenden Ausgabe, nicht mit 409

#### Scenario: Neue Ausgabe nach Einsatzende
- **WHEN** an einem abgeschlossenen Einsatz eine Ausgabe mit einer unbekannten `client_id` eintrifft
- **THEN** antwortet das System mit 409 und speichert nichts

#### Scenario: Replay einer zurückgenommenen Ausgabe
- **WHEN** eine Ausgabe mit `client_id` „v5“ gespeichert und danach zurückgenommen ist und dieselbe Ausgabe erneut eintrifft
- **THEN** antwortet das System mit 201 und der zurückgenommenen Ausgabe
- **AND** es entsteht keine neue Ausgabe, und die ausgegebene Menge bleibt ohne sie

#### Scenario: Beobachter ohne Schreibrecht
- **WHEN** ein Beobachter eine Ausgabe mit einer schon gespeicherten `client_id` sendet
- **THEN** antwortet das System mit 403 und gibt die Ausgabe nicht heraus

### Requirement: Ausgabe ohne Verbindung vormerken

Die Oberfläche MUST eine Ausgabe, die mangels Verbindung nicht gesendet werden kann, auf dem
Gerät vormerken und bei wiederhergestellter Verbindung senden. Die vorgemerkte Ausgabe MUST den
Zeitpunkt der Erfassung tragen, wenn keiner eingetragen ist. Der Hinweis nach dem Vormerken MUST
ohne „Rückgängig“ erscheinen. Eine fachlich abgelehnte Ausgabe MUST mit Grund und Inhalt sichtbar
bleiben, bis sie verworfen oder erneut versucht wird.

#### Scenario: Ausgabe ohne Verbindung
- **WHEN** eine Person ohne Netzverbindung im Dialog „Ausgabe erfassen“ 120 EP zu „Mittag“ erfasst
- **THEN** zeigt die Seite einen Hinweis, dass die Ausgabe vorgemerkt ist, und bietet kein „Rückgängig“ an
- **AND** nach wiederhergestellter Verbindung ist die Ausgabe genau einmal gespeichert, mit dem Zeitpunkt der Erfassung

#### Scenario: Online bleibt Rückgängig
- **WHEN** eine Person mit Verbindung eine Ausgabe erfasst
- **THEN** zeigt die Seite wie bisher einen Hinweis mit der Aktion „Rückgängig“

#### Scenario: Vorgemerkte Ausgabe wird abgelehnt
- **WHEN** eine vorgemerkte Ausgabe beim Senden abgelehnt wird, weil ihr Zeitfenster inzwischen gelöscht ist
- **THEN** steht sie im Wiederherstellungsbereich als abgelehnte Verpflegungsausgabe mit der Bezeichnung des Zeitfensters, dem Grund und dem vollständigen Inhalt

### Requirement: Ausstehende Ausgaben außerhalb der Deckung

Eine auf diesem Gerät vorgemerkte Ausgabe MUST an ihrem Zeitfenster als „ausstehend“
gekennzeichnet erscheinen, solange der Server sie nicht bestätigt hat. Sie MUST bis dahin weder
in die ausgegebene Menge noch in Fehlmenge oder Einstufung zählen, und sie MUST keine Aktion
„Zurücknehmen“ anbieten.

#### Scenario: Ausstehend sichtbar, nicht gezählt
- **WHEN** zum Zeitfenster „Mittag“ (Bedarf 250, ausgegeben 100) offline eine Ausgabe von 120 EP vorgemerkt ist
- **THEN** zeigt die Karte die Ausgabe 120 EP als „ausstehend“ ohne „Zurücknehmen“
- **AND** sie zeigt weiter ausgegeben 100 und Fehlmenge 150

#### Scenario: Nach der Bestätigung gezählt
- **WHEN** die vorgemerkte Ausgabe von 120 EP gesendet und vom Server gespeichert ist
- **THEN** steht sie als gewöhnliche Ausgabe in der Liste, die Kennzeichnung „ausstehend“ entfällt, und die Karte zeigt ausgegeben 220 und Fehlmenge 30
