# Spec Delta

## MODIFIED Requirements

### Requirement: Aktive Warnung

Das System SHALL eine Warnung als aktiv werten, solange im geöffneten Einsatz mindestens eines
der folgenden Merkmale gilt:
(a) Die höchste Warnstufe der Gefahrengebiete ist eine Stufe, die der Statusvertrag
`warnstufeKennzahl` auf die Rolle `alarm` legt.
(b) Mindestens eine Meldung hat eine überfällige Bestätigungspflicht (pflichtig, unbestätigt
und Frist abgelaufen oder eskaliert).
(c) Für den Einsatzort gilt jetzt eine amtliche Wetterwarnung, deren Stufe der Statusvertrag
`dwdWarnstufe` auf die Rolle `alarm` legt, aus einem verwertbaren Stand (aktuell oder
veraltet). Angekündigte Warnungen zählen nicht.
Außerhalb eines Einsatzes MUST keine Warnung aktiv sein. Ein Lade- oder Fehlerzustand einer
Quelle MUST NOT als Warnung zählen. Fehlt das Recht auf ein Modul, MUST die zugehörige Quelle
nichts beitragen.

#### Scenario: Warnstufe akut
- **WHEN** im geöffneten Einsatz ein Gefahrengebiet die Warnstufe `akut` hat
- **THEN** ist eine Warnung aktiv

#### Scenario: Warnstufe mittel
- **WHEN** die höchste Warnstufe `mittel` ist und keine Bestätigung überfällig ist
- **THEN** ist keine Warnung aktiv

#### Scenario: Bestätigung überfällig
- **WHEN** eine bestätigungspflichtige Meldung ihre Frist ohne Bestätigung überschritten hat
- **THEN** meldet der Modulzähler `meldungen.bestaetigung_ueberfaellig ≥ 1`
- **AND** eine Warnung ist aktiv

#### Scenario: Bestätigt
- **WHEN** diese Meldung bestätigt wird
- **THEN** sinkt `bestaetigung_ueberfaellig` live
- **AND** ohne weiteres Merkmal ist keine Warnung mehr aktiv

#### Scenario: Einsatz verlassen
- **WHEN** der Einsatz mit aktiver Warnung verlassen und die Einsatzauswahl geöffnet wird
- **THEN** ist keine Warnung mehr aktiv

#### Scenario: Unwetter gilt jetzt
- **WHEN** für den Einsatzort eine Warnung der Stufe `schwer` gilt, deren Beginn erreicht und deren Ende nicht verstrichen ist
- **THEN** ist eine Warnung aktiv

#### Scenario: Markantes Wetter
- **WHEN** für den Einsatzort nur Warnungen der Stufen `gering` oder `maessig` gelten und kein anderes Merkmal zutrifft
- **THEN** ist keine Warnung aktiv

#### Scenario: Unwetter angekündigt
- **WHEN** eine Warnung der Stufe `extrem` erst in zwei Stunden beginnt und kein anderes Merkmal zutrifft
- **THEN** ist keine Warnung aktiv
- **AND** mit Erreichen des Beginns wird die Warnung aktiv, ohne dass ein neuer Abruf nötig ist

#### Scenario: Unwetter endet
- **WHEN** das Ende der einzigen geltenden Unwetterwarnung verstreicht und kein anderes Merkmal zutrifft
- **THEN** ist keine Warnung mehr aktiv, ohne dass ein neuer Abruf nötig ist

#### Scenario: Wetterquelle ausgefallen
- **WHEN** der Wetterdienst ausgefallen ist, der Abruf scheitert oder kein Netz besteht
- **THEN** trägt das Wetter nichts zur aktiven Warnung bei

#### Scenario: Wettermodul ausgeblendet
- **WHEN** das Modul „Wetter & Pegel“ für den Einsatz ausgeblendet oder gesperrt ist
- **THEN** wird das Wetter für die Warnung nicht abgefragt
- **AND** eine Unwetterwarnung trägt nichts zur aktiven Warnung bei
