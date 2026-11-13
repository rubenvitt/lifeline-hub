## MODIFIED Requirements

### Requirement: Tastatur
↓ SHALL die Liste öffnen. Zeigt die offene Liste Vorschläge zum getippten Text, SHALL der oberste
passende Vorschlag markiert sein; ↓ und ↑ verschieben die Markierung. Enter und Tab MUST den
markierten Vorschlag übernehmen und die Liste schließen; Tab springt danach ins nächste Feld. Zeigt
die Liste keinen passenden Vorschlag, übernehmen Enter und Tab den getippten Text als Freitext.
Freitext trotz passender Vorschläge SHALL ein eigener, letzter Listeneintrag „„<Text>“ als
Freitext übernehmen“ ermöglichen. Enter bei offener Liste MUST das umgebende Formular nicht
absenden; bei geschlossener Liste gilt die Erfassungs-Norm. Escape SHALL eine offene Liste
schließen und den getippten Text stehen lassen; erst bei geschlossener Liste darf der Aufrufer
Escape als Abbruch deuten.

#### Scenario: Enter nach dem Tippen
- **WHEN** jemand in einer Meldung „Flo“ tippt, die Liste „Florian 1“ zeigt und Enter drückt
- **THEN** ist „Florian 1“ übernommen, die Liste zu und die Meldung nicht abgesendet

#### Scenario: Tab nach dem Tippen
- **WHEN** jemand „San“ tippt, die Liste „Sanitätsgruppe UHS“ zuoberst zeigt und Tab drückt
- **THEN** ist „Sanitätsgruppe UHS“ übernommen, und der Fokus steht im nächsten Feld

#### Scenario: Freitext trotz Vorschlag
- **WHEN** jemand „Flo“ tippt und den Eintrag „„Flo“ als Freitext übernehmen“ wählt
- **THEN** ist „Flo“ als freier Wert übernommen und trägt „frei“

#### Scenario: Kein Vorschlag passt
- **WHEN** jemand „Abschnitt Nord“ tippt, zu dem kein Vorschlag passt, und Enter drückt
- **THEN** ist „Abschnitt Nord“ als freier Wert übernommen

#### Scenario: Vorschlag per Tastatur
- **WHEN** jemand ↓, ↓ und Enter drückt
- **THEN** ist der zweite Vorschlag übernommen und nichts abgesendet
