# Spec Delta

## MODIFIED Requirements

### Requirement: Medienlage ohne Personenbezug
Das System SHALL aus den geladenen Medienkontakten, Pressemitteilungen und Anrufen eine Medienlage
ableiten:
- Medienkontakte gesamt, davon offen, aufgegliedert nach Art
- die Namen der anfragenden Medien, jedes einmal
- die freigegebenen Pressemitteilungen mit Titel, Version und Zeitpunkt der Freigabe
- Anrufe am Informationstelefon gesamt, nach Anliegen, und offene Rückrufe

Die Anrufzahlen MUST aus der Zählung des Informationstelefons über den ganzen Bestand stammen,
nicht aus einer geladenen Anrufliste. Die Medienlage MUST NOT Ansprechpersonen, Erreichbarkeiten,
Anrufernamen, Rückrufnummern, Notizen oder Themen enthalten. Ist eine Quelle nicht geladen oder
gesperrt, MUST ihr Teil mit „—“ und Grund erscheinen, nie mit 0.

#### Scenario: Kein Personenbezug
- **WHEN** die Medienlage aus Kontakten mit Ansprechperson und Anrufen mit Rückrufnummer
  abgeleitet wird
- **THEN** enthält ihr Text weder die Namen noch die Nummern noch die Notizen

#### Scenario: Quelle fehlt
- **WHEN** die Zählung des Informationstelefons nicht geladen werden konnte
- **THEN** steht beim Informationstelefon „—“ mit Grund, und die übrigen Teile erscheinen

#### Scenario: Mehr Anrufe als eine Seite
- **WHEN** der Einsatz 2 000 Anrufe hat
- **THEN** nennt die Medienlage 2 000 Anrufe, nicht die Zahl einer geladenen Seite
