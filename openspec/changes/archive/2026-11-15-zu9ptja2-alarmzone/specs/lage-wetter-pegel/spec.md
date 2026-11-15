# Spec Delta

## MODIFIED Requirements

### Requirement: Hinweis bei neuer Unwetterwarnung

Erscheint für den Einsatzort eine neue Warnung der Stufe „schwer“ oder „extrem“, gilt sie jetzt
oder ist sie angekündigt, SHALL die Oberfläche genau einen Hinweis in der Alarmzone zeigen.
Der Hinweis nennt Stufenbezeichnung, Ereignis und Zeitraum und springt zur Modulseite. Er MUST in der
Alarmzone stehen (ab zwei gebündelt, Spec `benachrichtigungen`, „Gemeinsames Budget und
Bündelung“), sich ausblenden lassen (ein „Gelesen“ hat er nicht, denn keine Benachrichtigung steht
dahinter), einen dezenten Ton spielen (stummschaltbar) und darf nicht blinken.

#### Scenario: Unwetter angekündigt
- **WHEN** für den Einsatzort erstmals eine Warnung „SCHWERES GEWITTER“ der Stufe „schwer“ ab 17:00 bis 20:00 erscheint
- **THEN** erscheint ein Hinweis „Unwetterwarnung“ mit „Schweres Gewitter, ab 17:00 · bis 20:00“ und einem Sprung zur Modulseite

#### Scenario: Markantes Wetter alarmiert nicht
- **WHEN** eine neue Warnung der Stufe „mäßig“ erscheint
- **THEN** entsteht kein Hinweis

#### Scenario: Ein Platz im Budget
- **WHEN** nacheinander zwei verschiedene Unwetterwarnungen neu erscheinen, ohne dass der erste Hinweis ausgeblendet wurde
- **THEN** steht in der Alarmzone höchstens ein Unwetterhinweis, und er nennt die zuletzt erkannte Warnung
