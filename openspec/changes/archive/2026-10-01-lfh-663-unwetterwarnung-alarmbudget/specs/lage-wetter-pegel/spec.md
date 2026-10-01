# Spec Delta

## ADDED Requirements

### Requirement: Unwetterwarnung im Modulzähler

Das Modulpanel SHALL am Modul „Wetter & Pegel“ die Zahl der gültigen Warnungen der Stufen
„schwer“ und „extrem“ für den Einsatzort zeigen, gezählt über „gilt jetzt“ und „angekündigt“.
Warnungen der Stufen „gering“ und „mäßig“ MUST NOT zählen. Der Zähler MUST seine Bedeutung als
zweiten Kanal tragen (Tooltip, zugänglicher Name) und neutral bleiben wie jeder Modulzähler. Er
erscheint nur, wenn das Modul für die Person sichtbar und frei ist.

#### Scenario: Zwei Unwetterwarnungen
- **WHEN** für den Einsatzort eine Warnung „schwer“ gilt, eine Warnung „extrem“ angekündigt ist und eine Warnung „mäßig“ gilt
- **THEN** zeigt das Modul „Wetter & Pegel“ die Zahl 2, und sein zugänglicher Name nennt „2 Unwetterwarnungen für den Einsatzort, davon 1 angekündigt“

#### Scenario: Nur markantes Wetter
- **WHEN** für den Einsatzort nur Warnungen der Stufen „gering“ und „mäßig“ gelten
- **THEN** zeigt das Modul keine Zahl

#### Scenario: Stand unbekannt
- **WHEN** der Warnstand „Stand unbekannt“ ist oder der Einsatz keinen Einsatzort hat
- **THEN** zeigt das Modul keine Zahl, auch nicht 0

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul für die Person ausgeblendet oder gesperrt ist
- **THEN** zeigt der Rahmen keinen Zähler und fragt den Wetter-Endpunkt nicht ab

### Requirement: Hinweis bei neuer Unwetterwarnung

Erscheint für den Einsatzort eine neue Warnung der Stufe „schwer“ oder „extrem“, gilt sie jetzt
oder ist sie angekündigt, SHALL die Oberfläche genau einen Hinweis in der AlarmZentrale zeigen.
Der Hinweis nennt Stufenbezeichnung, Ereignis und Zeitraum und springt zur Modulseite. Er MUST dem
Budget der AlarmZentrale unterliegen (höchstens drei sichtbar, der Rest gebündelt), quittierbar
sein, einen dezenten Ton spielen (stummschaltbar) und darf nicht blinken.

#### Scenario: Unwetter angekündigt
- **WHEN** für den Einsatzort erstmals eine Warnung „SCHWERES GEWITTER“ der Stufe „schwer“ ab 17:00 bis 20:00 erscheint
- **THEN** erscheint ein Hinweis „Unwetterwarnung“ mit „Schweres Gewitter, ab 17:00 · bis 20:00“ und einem Sprung zur Modulseite

#### Scenario: Markantes Wetter alarmiert nicht
- **WHEN** eine neue Warnung der Stufe „mäßig“ erscheint
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Platz im Budget
- **WHEN** nacheinander zwei verschiedene Unwetterwarnungen neu erscheinen, ohne dass der erste Hinweis geschlossen wurde
- **THEN** ist in der AlarmZentrale höchstens ein Unwetterhinweis sichtbar, und er nennt die zuletzt erkannte Warnung

### Requirement: Kein Doppelalarm bei Unwetterwarnungen

Eine Unwetterwarnung MUST als neu gelten, wenn das Paar aus Ereignis und Stufe in den letzten 6
Stunden in diesem Browser für diese Person und diesen Einsatz nicht gemeldet wurde und ihre Stufe nicht unter
der höchsten in dieser Zeit gemeldeten liegt. Eine Aktualisierung derselben Warnung, ein
Neuladen der Seite und eine Herabstufung MUST NOT einen weiteren Hinweis auslösen. Ein Stand
„Stand unbekannt“ MUST NOT einen Hinweis auslösen.

#### Scenario: Erstes Öffnen bei gültiger Unwetterwarnung
- **WHEN** eine Person den Einsatz in diesem Browser öffnet, während eine Unwetterwarnung gilt, die ihr noch nicht gemeldet wurde
- **THEN** entsteht genau ein Hinweis

#### Scenario: Aktualisierte Warnung
- **WHEN** der DWD eine gemeldete Warnung mit neuem Ende neu ausgibt und Ereignis und Stufe gleich bleiben
- **THEN** entsteht kein weiterer Hinweis

#### Scenario: Neu geladen
- **WHEN** die Person die Seite neu lädt, während die gemeldete Warnung weiter gilt
- **THEN** entsteht kein weiterer Hinweis

#### Scenario: Hochstufung
- **WHEN** nach einer gemeldeten Warnung der Stufe „schwer“ eine Warnung der Stufe „extrem“ erscheint
- **THEN** entsteht ein neuer Hinweis „Extremes Unwetter“

#### Scenario: Herabstufung
- **WHEN** eine gemeldete Warnung der Stufe „extrem“ durch eine Warnung der Stufe „schwer“ ersetzt wird
- **THEN** entsteht kein Hinweis, und der Modulzähler zählt die neue Warnung

#### Scenario: Wiederkehr nach Ruhe
- **WHEN** ein Paar aus Ereignis und Stufe zuletzt vor mehr als 6 Stunden gesehen wurde und wieder erscheint
- **THEN** entsteht ein Hinweis

### Requirement: Marke für angekündigtes Unwetter im Überblick

Der Überblick SHALL jede angekündigte Warnung der Stufe „schwer“ oder „extrem“ als Marke unter
„Nächste Marken“ zum Zeitpunkt ihres Beginns führen. Die Marke nennt Stufenbezeichnung und
Ereignis und springt zur Modulseite. Sie MUST verschwinden, sobald die Warnung gilt, und wird nie
„überfällig“. Ohne sichtbares und freies Modul gibt es keine Unwettermarke.

#### Scenario: Angekündigtes Unwetter
- **WHEN** eine Warnung „ORKANBÖEN“ der Stufe „schwer“ in 2 Stunden beginnt
- **THEN** zeigt der Überblick eine Marke „Unwetterwarnung: Orkanböen“ zur Beginnzeit mit dem Wort „in 2 h 00 min“

#### Scenario: Warnung beginnt
- **WHEN** der Beginn einer markierten Unwetterwarnung erreicht ist
- **THEN** verschwindet die Marke, und der Modulzähler zählt die Warnung weiter
