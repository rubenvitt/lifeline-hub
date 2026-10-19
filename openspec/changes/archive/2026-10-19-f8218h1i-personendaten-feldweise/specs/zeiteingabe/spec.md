## ADDED Requirements

### Requirement: Kalenderdatum ohne Uhrzeit und Zone

Ein Kalenderdatum ohne Uhrzeit, etwa das Geburtsdatum einer Person, SHALL nicht als Zeitpunkt
behandelt werden. Es MUST ohne Anzeigezone gelesen, gespeichert (`YYYY-MM-DD`) und angezeigt
(„TT.MM.JJJJ“) werden, ohne Kalender-Schnellwahl und ohne relative Eingabe. Die Regel „Eingabe in
der Anzeigezone“ MUST für ein solches Feld nicht gelten.

#### Scenario: Zone verschiebt den Tag nicht
- **WHEN** die Anzeigezone Pacific/Auckland ist, der Browser auf UTC steht und „14.07.1980“ eingegeben wird
- **THEN** wird `1980-07-14` gespeichert und „14.07.1980“ angezeigt
