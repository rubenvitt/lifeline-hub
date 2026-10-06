# Spec Delta

## MODIFIED Requirements

### Requirement: Live-Ereignisse werden gebündelt abgeglichen

Das Frontend SHALL die Abfragen, die ein Live-Ereignis betrifft, in einem Sammelfenster von
höchstens 500 ms zusammenfassen und jede betroffene Abfrage am Ende des Fensters genau einmal als
veraltet markieren. Das gilt für Einsatz- und Org-Ereignisse in beiden Live-Strömen. Die
Modulzähler des Einsatzes haben ein eigenes Sammelfenster von höchstens 2 s (Spec
`modul-zaehler`).

#### Scenario: Nachlieferung nach einem Funkloch
- **WHEN** ein Tab nach einem Funkloch 50 ETB-Ereignisse innerhalb von 200 ms erhält
- **THEN** ruft er jede betroffene Abfrage höchstens einmal neu ab

#### Scenario: Modulzähler im eigenen Fenster
- **WHEN** ein Tab binnen 500 ms zehn `meldung`-Ereignisse erhält
- **THEN** ruft er die Meldungsliste höchstens zweimal und die Modulzähler genau einmal neu ab
