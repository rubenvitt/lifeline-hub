# Spec Delta

## ADDED Requirements

### Requirement: Modulsperre per Override ist eine eigene Achse

Ist ein Modul eines Einsatzes per Override einer Rolle vorbehalten, die der Benutzer nicht hat,
MUST der Navigationsrahmen (Drawer auf 390 px, Rail und Modulpanel auf 1024 px) für diesen
Benutzer ohne waagerechten Überlauf rendern. Dasselbe MUST für das Lage-Dashboard auf seinen
Prüfbreiten gelten, und zwar mit denselben Zusicherungen wie für den Administrator. Der
Nachweis MUST vor der Messung zusichern, dass der Sperrzweig steht.

#### Scenario: Gesperrte Zeile im Navigations-Drawer
- **WHEN** ein Beobachter auf 390 px den Navigations-Drawer eines Einsatzes öffnet, in dem ein Modul per Override nur Administratoren freisteht
- **THEN** steht die Zeile dieses Moduls gesperrt mit dem Grund „Keine Berechtigung“ da, und weder der geschlossene noch der offene Drawer erzeugt waagerechten Überlauf

#### Scenario: Gesperrte Zeile in Rail und Modulpanel
- **WHEN** derselbe Beobachter den Einsatz auf 1024 px öffnet
- **THEN** steht die Navigation inline, die gesperrte Zeile ist gesperrt, und der Navigationsrahmen läuft nicht waagerecht über

#### Scenario: Gesperrte Kennzahlen im Lage-Dashboard
- **WHEN** ein Beobachter das Lage-Dashboard eines Einsatzes öffnet, dessen Personen-, Gefahren- und ETB-Modul per Override nur Administratoren freistehen
- **THEN** zeigen die betroffenen Kennzahlplätze „—“ mit dem Grund „nicht freigegeben“ statt einer Zahl, die Paneele tragen ihren Sperrsatz, Band und Paneele haben die Spaltenzahl der Prüfbreite, und keine Kennzahl läuft aus ihrer Zelle

#### Scenario: Mutationsprobe am Sperrzweig
- **WHEN** für die Probe nur der gesperrte Zweig der Modulzeile bzw. des Kennzahlplatzes eine Mindestbreite über der Prüfbreite bekommt
- **THEN** wird der Durchgang mit Modulsperre rot, und der Administrator-Durchgang derselben Spec und Breite bleibt grün
