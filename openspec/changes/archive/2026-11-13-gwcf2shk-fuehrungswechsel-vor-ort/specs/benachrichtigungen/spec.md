## ADDED Requirements

### Requirement: Führung angefragt

Fragt die Gegenstelle einer Direktkopplung die Führung eines Einsatzes an, den diese Instanz führt,
SHALL die Einsatzleitung des Einsatzes einen Hinweis „Führung angefragt“ mit Sprung zu den
Einsatzdaten mit dem Paneel „Führung“ erhalten. Dieselbe Anfrage MUST höchstens einen Hinweis auslösen, auch wenn sie mit
mehreren Meldungen wiederkommt.

#### Scenario: ELW 2 fragt an
- **WHEN** ELW 1 einen Einsatz führt und ELW 2 über die Direktkopplung die Führung anfragt
- **THEN** erhält die Einsatzleitung an ELW 1 einen Hinweis „Führung angefragt“, und die nächsten Meldungen derselben Anfrage lösen keinen weiteren aus
