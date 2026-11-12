# Spec Delta

## Purpose

Lifeline-Hub-Instanzen im selben lokalen Netz finden einander ohne eingetippte Adresse, etwa zwei
ELW am Schadensort ohne Internet. Die Entdeckung liefert nur Kandidaten; Vertrauen entsteht
weiter allein über Kopplungscode, Prüfwert und signierte Aussagen.

## ADDED Requirements

### Requirement: Entdeckung nur mit Schalter

Das System SHALL sich im lokalen Netz nur ankündigen und nur nach anderen Instanzen suchen, wenn
der Betreiber `LIFELINE_LAN_ENTDECKUNG` eingeschaltet hat; die Vorgabe ist aus. Ohne Schalter
MUST die Instanz kein Multicast senden. Der Schalter MUST nur zusammen mit TLS des Servers
wirken; lauscht der Server nur auf Loopback, MUST er sich nicht ankündigen.

#### Scenario: Schalter aus
- **WHEN** eine Instanz ohne `LIFELINE_LAN_ENTDECKUNG` einen Tag im LAN läuft
- **THEN** sendet sie keine mDNS-Ankündigung und keine mDNS-Anfrage

#### Scenario: Schalter ohne TLS
- **WHEN** eine Instanz mit `LIFELINE_LAN_ENTDECKUNG`, aber ohne `--tls` startet
- **THEN** kündigt sie sich nicht an, und das Startprotokoll nennt „LAN-Entdeckung braucht --tls“

#### Scenario: Nur Loopback
- **WHEN** eine Instanz mit Schalter und TLS auf `127.0.0.1` lauscht
- **THEN** kündigt sie sich nicht an

### Requirement: Ankündigung mit Kennung, Name, Fingerabdruck und Protokollversion

Mit eingeschaltetem Schalter SHALL die Instanz sich als Dienst `_lifeline-hub._tcp` mit ihrem
HTTPS-Port ankündigen. Die Ankündigung MUST die Instanzkennung, den Instanznamen, den
Fingerabdruck des Instanzschlüssels und die Protokollversion tragen und MUST NOT Daten einer
Org, eines Kontos oder eines Einsatzes enthalten.

#### Scenario: Zwei ELW im selben Netz
- **WHEN** „ELW 1“ und „ELW 2“ mit Schalter im selben LAN laufen
- **THEN** sieht jeder den anderen mit Name, Kennung, Fingerabdruck und Adresse

### Requirement: Liste „Im Netz gefunden“ beim Einlösen

Ein Admin SHALL beim Einlösen eines Kopplungscodes die angekündigten Instanzen des lokalen Netzes
abrufen können, ohne die eigene. Je Instanz MUST die Liste Name, Fingerabdruck, Adresse und
Protokollversion zeigen und eine schon gekoppelte Gegenstelle kennzeichnen. Wählt der Admin
einen Eintrag, MUST die Adresse übernommen werden; geprüft wird wie bei einer eingetippten.

#### Scenario: Gegenstelle wählen
- **WHEN** der Admin an ELW 2 „Code einlösen“ öffnet und „ELW 1“ aus „Im Netz gefunden“ wählt
- **THEN** steht die Adresse von ELW 1 im Feld, und nach Eingabe des Codes entsteht die Kopplung wie bei eingetippter Adresse

#### Scenario: Schalter aus
- **WHEN** der Admin an einer Instanz ohne Schalter „Im Netz gefunden“ abruft
- **THEN** zeigt die Liste „LAN-Entdeckung ist aus“ und keine Einträge

#### Scenario: Nicht-Admin
- **WHEN** ein Konto ohne Admin-Rolle die Liste abruft
- **THEN** antwortet der Server mit 403

### Requirement: Eine Ankündigung begründet kein Vertrauen

Das System MUST eine Ankündigung als unbestätigten Hinweis behandeln. Weder Kennung noch
Fingerabdruck einer Ankündigung MUST eine Kopplung begründen oder einen gespeicherten Schlüssel
ersetzen; Vertrauen entsteht nur über Kopplungscode und Prüfwert (Spec `instanz-kopplung`).

#### Scenario: Gefälschte Ankündigung
- **WHEN** ein Gerät im LAN sich mit Kennung und Name von „ELW 1“ ankündigt und der Admin an ELW 2 es wählt und den Code von ELW 1 eingibt
- **THEN** scheitert das Einlösen am Prüfwert, und es entsteht keine Kopplung

### Requirement: Eine Direktkopplung findet ihre Gegenstelle neu

Scheitert die Meldung einer Direktkopplung an der Verbindung und ist der Schalter an, SHALL die
meldende Seite die Gegenstelle über ihre Instanzkennung im lokalen Netz suchen. Findet sie eine
andere Adresse, MUST sie diese versuchen und erst nach einer signierten Antwort der Gegenstelle
speichern; die Änderung MUST in der Admin-Spur stehen.

#### Scenario: Neue IP per DHCP
- **WHEN** ELW 1 nach einem Neustart eine andere IP bekommt und ELW 2 sich als Direktkopplung bei ELW 1 meldet
- **THEN** findet ELW 2 die neue Adresse, meldet sich dort, und die Admin-Spur zeigt „Adresse der Gegenstelle geändert“

#### Scenario: Antwort nicht signiert
- **WHEN** unter der neu gefundenen Adresse ein Gerät ohne gültige Signatur von ELW 1 antwortet
- **THEN** behält ELW 2 die alte Adresse und zeigt die Kopplung als „Antwort ungültig“
