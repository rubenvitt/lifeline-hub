# Spec Delta

## ADDED Requirements

### Requirement: Grund einer Problemzeile als Alarm-Etikett
Ist eine Einheitenzeile des Meldebilds wegen Ausfall ihrer Mittel, Ausfall ihres Materials oder
ihrer Rückmeldung getönt, SHALL jeder Grund in der Statusspalte als Etikett in der Alarmrolle stehen
(Fläche und Wort, nicht nur Textfarbe). Eine überfällige Rückmeldung MUST ihre Dauer seit der
Fälligkeit nennen. Die Tönung der Zeile MUST in Tag- und Nachtmodus sichtbar vom Paneelgrund
abweichen.

#### Scenario: Ausfall und Material
- **WHEN** eine Einheit eine Person mit Status nicht verfügbar und einen Materialposten im Ausfall hat
- **THEN** stehen in ihrer Statusspalte die Etiketten „1 Ausfall“ und „1 Ausfall Material“ in der Alarmrolle

#### Scenario: Rückmeldung überfällig
- **WHEN** die Rückmeldung einer Einheit seit 47 Minuten fällig ist
- **THEN** steht in ihrer Statusspalte das Etikett „Rückm. überfällig seit 47 min“ in der Alarmrolle, und die Angabe wächst mit der Seitenuhr

#### Scenario: Nie zurückgemeldet
- **WHEN** von einer Einheit noch keine Rückmeldung vorliegt
- **THEN** steht in ihrer Statusspalte das Etikett „keine Rückm.“ in der Alarmrolle

#### Scenario: Nachtmodus
- **WHEN** das Meldebild im Nachtmodus eine Problemzeile zeigt
- **THEN** ist ihre Tönung gegen den Paneelgrund messbar verschieden, und der Text darauf hält die Kontrastböden der Farbrollen

### Requirement: Überfällige Rückmeldung trägt die Alarmrolle
Eine überfällige Rückmeldung SHALL überall im Meldebild die Rolle „alarm“ tragen, auch in der
Spalte „Rückmeldung“; eine Rückmeldung in der Frist bleibt neutral. Farbe MUST NOT der einzige
Kanal sein: das Wort steht im zugänglichen Namen.

#### Scenario: Spalte Rückmeldung
- **WHEN** die letzte Rückmeldung einer Einheit um 1550 kam und ihre Frist verstrichen ist
- **THEN** steht „1550“ in der Spalte „Rückmeldung“ in der Alarmfarbe, und der zugängliche Name nennt „Rückmeldung überfällig“
