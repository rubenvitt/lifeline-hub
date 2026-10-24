## MODIFIED Requirements

### Requirement: Rechte, Lebenszyklus, Live
Lesen SHALL jedes Einsatzmitglied mit Leserecht auf die Presse. Erfassen und Statuswechsel MUST
Schreibrecht und die Freigabe des Moduls Presse verlangen. Am abgeschlossenen Einsatz ist das
Protokoll schreibgeschützt. Ein Anruf eines anderen Einsatzes MUST mit 404 beantwortet werden.
Anrufe MUST NOT gelöscht werden können. Neue Anrufe anderer Arbeitsplätze SHALL live erscheinen,
ohne dass die Liste unter dem Cursor springt. Das Informationstelefon steht unter
`/einsaetze/:id/presse/infotelefon` (Fähigkeit `presse-modul`).

#### Scenario: Zwei Telefonplätze
- **WHEN** zwei Personen gleichzeitig Anrufe erfassen
- **THEN** sieht jede die Anrufe der anderen ohne Neuladen, und die Kennzahlen stimmen an beiden
  Plätzen überein

#### Scenario: Ohne Stab
- **WHEN** der Stab im Einsatz ausgeblendet ist und die Presse nicht
- **THEN** erfasst eine Person mit Schreibrecht Anrufe wie bisher
