## MODIFIED Requirements

### Requirement: Kein Einspielen an einer erreichten Instanz

Das Einspielen über die Verwaltung SHALL nur an einer Instanz bestehen, bei der sich keine andere
meldet. Hat die Instanz eine angebahnte oder aktive Kopplung, in der sie die erreichte Seite ist,
egal für welche Organisation, MUST der Server mit 422 ablehnen. Er MUST das tun, bevor er
Block oder Schlüssel liest, und die Oberfläche MUST die Aktion dann nicht anbieten. Eine
widerrufene Kopplung sperrt nicht. Eine Direktkopplung vor Ort MUST NOT sperren, gleich in
welcher Richtung; jede andere Art einer Kopplung sperrt.

#### Scenario: Hub
- **WHEN** eine andere Instanz an dieser Instanz gekoppelt ist und sich hier meldet
- **THEN** antwortet das Hochladen mit 422
- **AND** fehlt die Aktion „Archiv einspielen“ in der Verwaltung

#### Scenario: Kopplung einer anderen Organisation
- **WHEN** nur eine andere Organisation dieser Instanz eine solche Kopplung hat
- **THEN** antwortet das Hochladen ebenfalls mit 422

#### Scenario: Früher eingespielter Block
- **WHEN** an der Instanz schon ein Block eingespielt wurde und keine Kopplung angebahnt oder aktiv ist
- **THEN** bietet die Verwaltung die Aktion weiter an

#### Scenario: Meldende Seite
- **WHEN** diese Instanz sich nur selbst bei einer anderen meldet
- **THEN** steht das Einspielen zur Verfügung

#### Scenario: Direktkopplung vor Ort
- **WHEN** diese Instanz einer anderen einen Code für die Direktkopplung vor Ort ausgestellt hat und die Kopplung angebahnt oder aktiv ist
- **AND** sonst keine Kopplung sie zur erreichten Seite macht
- **THEN** bietet die Verwaltung die Aktion „Archiv einspielen“ an
- **AND** spielt das Hochladen den Block ein

#### Scenario: Hub mit zusätzlicher Direktkopplung
- **WHEN** sich bei dieser Instanz ein ELW über eine Standardkopplung meldet und sie zugleich eine Direktkopplung vor Ort hat
- **THEN** antwortet das Hochladen weiter mit 422
