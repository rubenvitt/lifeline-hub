# Spec Delta

## MODIFIED Requirements

### Requirement: Zeitpunkte ohne Zonenversatz
Alarmzeit und Nächste Lagebesprechung SHALL in der Zeilenbearbeitung in der Anzeigezone
angezeigt werden, in der die Leseansicht sie zeigt (Fähigkeit `zeiteingabe`), und als
UTC-Zeitpunkt (`YYYY-MM-DD HH:mm:ss`) gesendet werden. Der gesendete Zeitpunkt MUST derselbe
absolute Zeitpunkt sein, den die Person gewählt hat, auch beidseits einer Sommerzeit-Umstellung
und auch dann, wenn die Zone des Browsers von der Anzeigezone abweicht.

#### Scenario: Alarmzeit an der Umstellung im März
- **WHEN** eine Person mit Anzeigezone `Europe/Berlin` die Alarmzeit auf 29.03.2026 03:30 Ortszeit setzt (01:30 UTC, nach der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-03-29 01:30:00"`

#### Scenario: Alarmzeit an der Umstellung im Oktober
- **WHEN** eine Person mit Anzeigezone `Europe/Berlin` die Alarmzeit auf 25.10.2026 01:30 Ortszeit setzt (23:30 UTC am Vortag, vor der Umstellung)
- **THEN** sendet die Seite `begonnen_at: "2026-10-24 23:30:00"`

#### Scenario: Unveränderte Alarmzeit
- **WHEN** eine Person die Alarmzeit-Bearbeitung öffnet und ohne Änderung speichert
- **THEN** geht keine Anfrage hinaus, weil der Wert beim Öffnen ohne Versatz übernommen wurde

#### Scenario: Browser in anderer Zone
- **WHEN** der Browser auf UTC steht, die Anzeigezone `Europe/Berlin` ist und die Leseansicht die Alarmzeit 14.07.2026 12:00 zeigt
- **THEN** zeigt die Zeilenbearbeitung ebenfalls 14.07.2026 12:00, und ein Setzen auf 13:00 sendet `begonnen_at: "2026-07-14 11:00:00"`
