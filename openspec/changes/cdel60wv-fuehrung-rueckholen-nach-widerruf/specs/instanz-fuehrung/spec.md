## ADDED Requirements

### Requirement: Einen Spiegel ohne gekoppelte Führung holt ein Mensch zurück

Nennt bei eingeschaltetem Schalter die Akte eines Spiegels eine Installation als Führer, über
deren inzwischen widerrufene Zuordnung einer Standardkopplung der Einsatz gespiegelt wurde, und
hat die Org keine geltende Zuordnung zu ihr, SHALL das Paneel „Führung“ „Führung zurückholen“ anbieten und das Hinweisband die beendete
Kopplung nennen. Bedienen SHALL, wer an dieser Instanz die Führung bedient, mit Grund, ohne
Unterschrift und ohne Code. Danach MUST diese Instanz den Einsatz mit der nächsten Epoche
schreibbar führen; die Akte MUST eine Erklärung ohne Beweis gegen die alte Führung mit dem Grund
tragen, Bruchstelle ist der Widerruf dieser Zuordnung, und Verlauf und Admin-Spur
MUST den Wechsel mit Bediener festhalten.

#### Scenario: Zurückholen nach Widerruf ohne Schalter
- **WHEN** der Hub einen Einsatz mit Epoche (3, Hub) führt, den der ELW spiegelt, der Schalter am ELW aus ist, die Org-Zuordnung zum Hub um 10:00 widerrufen wird, der Schalter wieder eingeschaltet wird und die Einsatzleitung am ELW um 11:30 „Führung zurückholen“ mit dem Grund „Hub abgebaut“ bestätigt
- **THEN** führt der ELW den Einsatz mit Epoche (4, ELW), das Hinweisband „Spiegel von Hub“ verschwindet, der Einsatz ist schreibbar, und der Verlauf zeigt eine Notübernahme von Hub mit dem Grund „Hub abgebaut“, dem Namen der Einsatzleitung und 10:00 als Bruchstelle

#### Scenario: Das Hinweisband nennt die beendete Kopplung
- **WHEN** die Einsatzleitung am ELW einen solchen Spiegel öffnet
- **THEN** zeigt das Hinweisband „Spiegel von Hub“ mit „Kopplung zu Hub beendet“ und „Führung zurückholen“, das zum Paneel „Führung“ führt

#### Scenario: Ohne Grund
- **WHEN** die Einsatzleitung „Führung zurückholen“ ohne Grund absendet
- **THEN** antwortet der Server mit 422 „Ein Grund ist Pflicht.“, und die Akte bleibt unverändert

#### Scenario: Führungspersonal
- **WHEN** ein Konto mit der Rolle Führungspersonal „Führung zurückholen“ auslöst
- **THEN** antwortet der Server mit 403

#### Scenario: Ein dritter ELW hält die Übernahme ohne Alarm offen
- **WHEN** am Hub ein Einsatz, den „ELW 1“ führt, nach Widerruf ohne Schalter zurückgeholt wird und „ELW 2“, der die Akte über den Hub kennt, sich meldet
- **THEN** sieht „ELW 2“ den Wechsel zum Hub ohne Alarm „Ungültige Übernahme der Führung“ und ohne Eintrag in seiner Admin-Spur

### Requirement: Ohne einen Menschen bleibt ein Spiegel ohne gekoppelte Führung Spiegel

Ein Spiegel, dessen Führung nicht mehr gekoppelt ist, MUST Spiegel bleiben, bis ein Mensch ihn
zurückholt, auch über Neustart und Einschalten des Schalters hinweg. Ist die führende Installation
noch gekoppelt oder kam der Spiegel nicht über eine widerrufene Standard-Zuordnung zu ihr, etwa
über einen Hub, MUST der Server das Zurückholen mit 409 ablehnen.

#### Scenario: Ohne Handlung bleibt der Spiegel
- **WHEN** nach Widerruf ohne Schalter die Führung wieder eingeschaltet wird und der ELW neu startet
- **THEN** bleibt der Einsatz Spiegel von Hub, und die Akte nennt weiter den Hub mit Epoche (3, Hub)

#### Scenario: Die Führung ist noch gekoppelt
- **WHEN** die Org-Zuordnung zum Hub gilt und jemand am ELW „Führung zurückholen“ aufruft
- **THEN** antwortet der Server mit 409, und das Paneel bietet dafür nur Anfrage und Notübernahme an

#### Scenario: Führer nie über eine Standardkopplung zugeordnet
- **WHEN** die Akte eine Installation als Führer nennt, mit der die Org nur über eine Direktkopplung vor Ort oder gar nicht gekoppelt war
- **THEN** bietet das Paneel „Führung zurückholen“ nicht an, und der Server antwortet auf den Aufruf mit 409

#### Scenario: Der Spiegel kommt über einen Hub
- **WHEN** „ELW 1“ einen Einsatz führt, den „ELW 2“ über den Hub kennt und spiegelt, und die Org an „ELW 2“ früher einmal direkt mit „ELW 1“ gekoppelt war
- **THEN** bietet „ELW 2“ „Führung zurückholen“ nicht an, und der Server antwortet auf den Aufruf mit 409
