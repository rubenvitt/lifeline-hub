# Spec Delta

## ADDED Requirements

### Requirement: Offline-Erfassung von Stand- und Belegungsmeldungen

Eine Standmeldung und eine Belegungsmeldung SHALL optional einen Idempotenzschlüssel
`client_id` tragen (Zeichenkette, höchstens 64 Zeichen; leer oder nur Leerraum zählt als
fehlend). Eine `client_id` MUST je Einsatz und Meldereihe höchstens eine Meldung
bezeichnen. Trifft eine Meldung mit einer `client_id` ein, zu der im Einsatz schon eine
Meldung derselben Reihe gespeichert ist, MUST das System diese bestehende Meldung mit dem
aktuellen Zustand ihres Bezirks bzw. ihrer Stelle zurückliefern (201). Es MUST dabei weder
eine weitere Meldung noch einen weiteren ETB-Eintrag speichern, und es MUST kein weiteres
Live-Ereignis auslösen. Diese Prüfung MUST vor den Prüfungen auf stornierten Bezirk,
stornierte oder geschlossene Stelle und aktiven Einsatz laufen, aber nach den Prüfungen auf
Schreibrecht und Modulzugang. Gehört die gespeicherte Meldung zu einem anderen Bezirk bzw.
einer anderen Stelle als der aufgerufene Pfad, MUST das System mit 422 antworten und nichts
speichern. Meldungen ohne `client_id` MUST sich wie bisher verhalten.

Die Oberfläche MUST eine Stand- oder Belegungsmeldung, die mangels Verbindung nicht gesendet
werden kann, auf dem Gerät vormerken und bei wiederhergestellter Verbindung senden. Die
vorgemerkte Meldung MUST den Zeitpunkt der Erfassung tragen, nicht den des Sendens. Eine
vom Server fachlich abgelehnte vorgemerkte Meldung MUST mit Grund und vollständigem Inhalt
sichtbar bleiben, bis sie verworfen oder erneut versucht wird.

#### Scenario: Wiederholte Standmeldung
- **WHEN** eine Standmeldung „480 evakuiert“ mit `client_id` „a1“ gespeichert ist und dieselbe Meldung mit „a1“ erneut eintrifft
- **THEN** antwortet das System mit 201 und derselben Meldungskennung
- **AND** der Bezirk hat genau eine Standmeldung mit „a1“ und das ETB genau einen zugehörigen Meldungseintrag
- **AND** der aktuelle Stand ist unverändert 480

#### Scenario: Wiederholte Belegungsmeldung
- **WHEN** eine Belegungsmeldung „37 belegt“ mit `client_id` „b1“ gespeichert ist und dieselbe Meldung mit „b1“ erneut eintrifft
- **THEN** antwortet das System mit 201 und derselben Meldungskennung
- **AND** es entsteht weder eine zweite Belegungsmeldung noch ein zweiter ETB-Eintrag

#### Scenario: Replay nach Zustandswechsel
- **WHEN** eine Belegungsmeldung mit `client_id` „b2“ gespeichert ist, die Stelle danach geschlossen wird und dieselbe Meldung mit „b2“ erneut eintrifft
- **THEN** antwortet das System mit 201 und der bestehenden Meldung, nicht mit 422

#### Scenario: Replay an storniertem Bezirk
- **WHEN** eine Standmeldung mit `client_id` „a2“ gespeichert ist, der Bezirk danach storniert wird und dieselbe Meldung erneut eintrifft
- **THEN** antwortet das System mit 201 und der bestehenden Meldung, nicht mit 409

#### Scenario: Neue Meldung an geschlossener Stelle bleibt abgelehnt
- **WHEN** an eine geschlossene Stelle eine Belegungsmeldung mit einer unbekannten `client_id` eintrifft
- **THEN** antwortet das System mit 422 und speichert nichts

#### Scenario: Schlüssel eines anderen Bezirks
- **WHEN** zu `client_id` „a3“ eine Standmeldung an Bezirk A gespeichert ist und eine Standmeldung mit „a3“ an Bezirk B eintrifft
- **THEN** antwortet das System mit 422 und speichert nichts

#### Scenario: Schlüssel eines anderen Einsatzes
- **WHEN** in Einsatz 1 eine Standmeldung mit `client_id` „a4“ gespeichert ist und in Einsatz 2 eine Standmeldung mit „a4“ eintrifft
- **THEN** speichert das System in Einsatz 2 eine neue Meldung und gibt keine Daten aus Einsatz 1 zurück

#### Scenario: Zu langer Schlüssel
- **WHEN** eine Meldung mit einer `client_id` von mehr als 64 Zeichen eintrifft
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Verspätet gesendete ältere Meldung
- **WHEN** eine offline vorgemerkte Standmeldung „200“ mit Erfassungszeitpunkt 10:00 erst gesendet wird, nachdem online „480“ mit Zeitpunkt 10:15 gemeldet wurde
- **THEN** bleibt der aktuelle Stand 480
- **AND** die Meldung „200“ ist gespeichert und im ETB als nachgetragen nachgewiesen

#### Scenario: Meldung ohne Verbindung
- **WHEN** ein Benutzer ohne Netzverbindung im Dialog „Belegung melden“ 37 meldet
- **THEN** zeigt die Oberfläche, dass die Meldung vorgemerkt ist
- **AND** nach wiederhergestellter Verbindung ist die Belegung 37 mit dem Erfassungszeitpunkt gespeichert

#### Scenario: Vorgemerkte Meldung wird abgelehnt
- **WHEN** eine vorgemerkte Standmeldung beim Senden abgelehnt wird, weil der Bezirk inzwischen storniert ist
- **THEN** steht sie im Wiederherstellungsbereich als abgelehnte Standmeldung mit Grund und vollständigem Inhalt
