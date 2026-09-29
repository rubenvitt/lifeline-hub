# Spec Delta

## Purpose

Sorgt dafür, dass ein Browser-Tab nur unter dem Benutzer schreibt, den er anzeigt, obwohl sich
alle Tabs eines Browsers eine Sitzung teilen, und dass Tabs An-, Abmeldung und
Benutzerwechsel voneinander erfahren, ohne neu geladen zu werden.

## ADDED Requirements

### Requirement: Schreibende Anfragen sind an den angezeigten Benutzer gebunden
Ein angemeldeter Tab SHALL bei jeder schreibenden Anfrage (POST, PUT, PATCH, DELETE) die
Kennung des Benutzers mitsenden, den er anzeigt. Der Server MUST eine solche Anfrage mit
HTTP 412 ablehnen, wenn die Sitzung des Cookies einem anderen Benutzer gehört; er MUST dabei
weder schreiben noch einen idempotenten Replay ausliefern. Fehlt die Kennung, SHALL der Server
die Anfrage wie bisher behandeln. Ist die Sitzung ungültig, MUST die Antwort weiterhin 401
sein, nicht 412. Lesende Anfragen sind nicht gebunden.

#### Scenario: Veralteter Tab schreibt nach Benutzerwechsel
- **WHEN** Tab 1 zeigt Benutzer A, in Tab 2 meldet sich Benutzer B an, und Tab 1 sendet einen ETB-Eintrag, bevor er vom Wechsel erfährt
- **THEN** antwortet der Server 412, und es entsteht kein ETB-Eintrag

#### Scenario: Passende Kennung
- **WHEN** Tab 1 zeigt Benutzer A und die Sitzung gehört A
- **THEN** wird die Schreibanfrage normal verarbeitet

#### Scenario: Anfrage ohne Kennung
- **WHEN** ein Werkzeug ohne Kennung mit gültiger Sitzung schreibt
- **THEN** wird die Anfrage wie bisher verarbeitet

#### Scenario: Abgelaufene Sitzung mit Kennung
- **WHEN** ein Tab mit Kennung schreibt und die Sitzung abgelaufen ist
- **THEN** antwortet der Server 401

### Requirement: Abmelden beendet keine fremde Sitzung
Der Server MUST ein Abmelden mit Kennung ablehnen (HTTP 412), wenn die gültige Sitzung einem
anderen Benutzer gehört, und dabei Sitzung und Cookie unverändert lassen. Ein Tab SHALL nach
einer solchen Ablehnung nicht lokal abmelden, sondern den Benutzerkonflikt anzeigen.

#### Scenario: Abmelden im veralteten Tab
- **WHEN** Tab 1 zeigt A, die Sitzung gehört B, und in Tab 1 wird „Abmelden“ gewählt
- **THEN** bleibt B angemeldet, und Tab 1 zeigt den Benutzerkonflikt

#### Scenario: Abmelden mit passender Kennung
- **WHEN** Tab 1 zeigt A, die Sitzung gehört A, und in Tab 1 wird „Abmelden“ gewählt
- **THEN** ist die Sitzung beendet und Tab 1 zeigt die Anmeldung

### Requirement: Tabs erfahren An-, Abmeldung und Benutzerwechsel
Anmelden (Passwort, Passkey, Zweitfaktor) und Abmelden in einem Tab SHALL allen anderen Tabs
desselben Browsers gemeldet werden. Ein Tab MUST daraufhin seinen Benutzer gegen den Server
prüfen, ebenso wenn er wieder sichtbar wird und wenn eine seiner Schreibanfragen mit 412
abgelehnt wurde. Das Ergebnis der Prüfung MUST ohne manuelles Neuladen wirken:
- gleicher Benutzer: keine Änderung;
- Tab ohne Benutzer, Sitzung vorhanden: der Tab übernimmt den Benutzer;
- Tab mit Benutzer, Sitzung eines anderen Benutzers: Benutzerkonflikt;
- keine gültige Sitzung: der Tab meldet lokal ab und zeigt die Anmeldung mit Rückkehrziel;
- Server nicht erreichbar: keine Änderung.

#### Scenario: Abmelden in einem anderen Tab
- **WHEN** Tab 1 und Tab 2 zeigen A und in Tab 2 wird abgemeldet
- **THEN** zeigt Tab 1 ohne Neuladen die Anmeldung

#### Scenario: Anmelden in einem anderen Tab
- **WHEN** Tab 1 steht auf der Anmeldung und in Tab 2 meldet sich A an
- **THEN** zeigt Tab 1 ohne Neuladen A als angemeldet

#### Scenario: Offline bleibt der Tab stehen
- **WHEN** Tab 1 zeigt A, ist offline und erhält eine Wechselmeldung
- **THEN** bleibt Tab 1 bei A, und die Offline-Queue bleibt unberührt

### Requirement: Benutzerkonflikt ist eine eigene, bedienbare Situation
Erkennt ein Tab, dass die Sitzung einem anderen Benutzer gehört als dem angezeigten, SHALL er
einen blockierenden Dialog zeigen, der beide Benutzer mit Anzeigenamen nennt und erklärt, dass
aus diesem Tab nichts mehr unter dem bisherigen Benutzer gespeichert wird. Der Dialog MUST
genau eine Primäraktion „Als <neuer Benutzer> weiterarbeiten“ tragen; sie übernimmt den neuen
Benutzer, verwirft die zwischengespeicherten Daten des bisherigen Benutzers und führt zur
Startseite. Der Dialog MUST sich nicht per Escape, Kreuz oder Maske schließen lassen. Solange
er steht, MUST jede Schreibanfrage des Tabs weiter die Kennung des bisherigen Benutzers tragen.
Eine Ablehnung mit 412 MUST NOT zur Abmeldung führen.

#### Scenario: Konflikt nach schnellem Wechsel
- **WHEN** Tab 1 zeigt A und in Tab 2 wird schnell von A auf B gewechselt
- **THEN** zeigt Tab 1 ohne Neuladen den Konfliktdialog mit A und B

#### Scenario: Weiterarbeiten als neuer Benutzer
- **WHEN** im Konfliktdialog „Als B weiterarbeiten“ gewählt wird
- **THEN** zeigt Tab 1 die Startseite als B, ohne Daten, die unter A geladen wurden

#### Scenario: 412 meldet nicht ab
- **WHEN** eine Schreibanfrage von Tab 1 mit 412 abgelehnt wird
- **THEN** bleibt die Sitzung von B gültig und Tab 2 bleibt angemeldet

### Requirement: Sitzungsablauf meldet nur lokal ab
Erkennt ein Tab eine abgelaufene Sitzung (401), MUST er lokal abmelden, ohne den Server-Logout
aufzurufen, SHALL den Ablauf den anderen Tabs melden und MUST wie bisher zur Anmeldung mit
vollständiger Rückkehr-URL führen. Offlinefähige Schreibvorgänge MUST bei 401 und 412 in der
Offline-Queue bleiben.

#### Scenario: Ablauf in einem Tab
- **WHEN** die Sitzung serverseitig endet und Tab 1 eine Schreibanfrage sendet
- **THEN** zeigt Tab 1 die Anmeldung mit Rückkehrziel, und Tab 2 zeigt ohne Neuladen ebenfalls die Anmeldung

#### Scenario: Neue Sitzung zwischen 401 und Abmeldung
- **WHEN** Tab 1 erhält 401 und währenddessen meldet sich in Tab 2 B an
- **THEN** bleibt die Sitzung von B gültig
