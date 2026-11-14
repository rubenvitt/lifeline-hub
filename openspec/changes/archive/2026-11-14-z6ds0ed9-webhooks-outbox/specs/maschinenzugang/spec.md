## MODIFIED Requirements

### Requirement: Admin-Spur und Abrufprotokoll

Anlegen, Code ausstellen, Schlüssel gebunden, Ändern und Widerruf eines Zugangs SHALL je einen
Eintrag in der Admin-Spur der Org schreiben, mit Zugang, Name, Scopes, gegebenenfalls
Fingerabdruck und Quell-IP. Das Binden beim Einlösen schreibt ohne handelnde Person. Anlegen,
Ändern, Entfernen und Wiederaufnehmen eines Webhooks sowie das Ein- und Ausschalten seiner
LAN-Ausnahme SHALL je einen Eintrag schreiben, mit Zugang, Name und Host des Ziels. Jede
angenommene Anfrage MUST im Abrufprotokoll je Zugang, Route und Tag zählen. Das Protokoll MUST
365 Tage aufbewahrt werden.

#### Scenario: Anlegen und Widerruf im Audit
- **WHEN** ein Admin einen Zugang anlegt und später widerruft
- **THEN** zeigt das Zugangsprotokoll beide Einträge mit Admin, Zugang und Zeitpunkt in Klartext

#### Scenario: Abrufe zählen
- **WHEN** ein Zugang an einem Tag dreimal `GET /api/v1/me` aufruft
- **THEN** steht im Abrufprotokoll für diesen Zugang, diese Route und diesen Tag die Anzahl 3 mit erstem und letztem Zeitpunkt, und die Seite zeigt „zuletzt genutzt“

#### Scenario: LAN-Ausnahme im Audit
- **WHEN** ein Admin an einem Webhook die LAN-Ausnahme einschaltet
- **THEN** zeigt das Zugangsprotokoll einen eigenen Eintrag mit Admin, Zugang, Host des Ziels und Zeitpunkt, getrennt vom Eintrag für das Ändern des Ziels

#### Scenario: Testzustellung ohne Eintrag
- **WHEN** ein Admin ein Testereignis sendet
- **THEN** entsteht kein Eintrag in der Admin-Spur, weil sich am Zugang nichts ändert

### Requirement: Fremdsysteme kommen mit Kommando, Referenz-Clients und Testvektoren an

Das Projekt SHALL dokumentierte Testvektoren bereitstellen: fester Schlüssel, feste Zeit,
Anfrage, erwartetes JWS und erwarteter Prüfwert. Sie MUST auch Zustellungen von Webhooks samt
ungültiger Fälle abdecken. Der Server, der Rust-Client, das TypeScript-Modul und das
Python-Beispiel MUST gegen dieselben Vektoren geprüft werden. Das Binary SHALL
`lifeline-hub zugang redeem <url> <code>` anbieten. Es erzeugt ein Schlüsselpaar, löst den Code
ein und legt eine nur für den Besitzer lesbare Schlüsseldatei ab.

#### Scenario: Kommando
- **WHEN** ein Betreiber `lifeline-hub zugang redeem https://hub.example ABCD-EFGH-JKMN-PQRS` ausführt
- **THEN** liegt danach eine Schlüsseldatei mit Zugangs-ID, Instanz-UUID, Basis-URL und Schlüsseln vor, und das Kommando nennt den Fingerabdruck, den der Admin an der Seite vergleicht

#### Scenario: Vektoren driften
- **WHEN** jemand das Format der Claims ändert, ohne die Testvektoren neu zu schreiben
- **THEN** schlägt mindestens ein Test im Sammel-Gate fehl

#### Scenario: Webhook-Vektoren driften
- **WHEN** jemand die Claims einer Webhook-Zustellung ändert, ohne die Testvektoren neu zu schreiben
- **THEN** schlägt mindestens ein Test im Sammel-Gate fehl
