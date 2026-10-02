# bedien-helligkeit Specification

## Purpose
Ein app-weiter Helligkeitsregler mit Warnsperre (Kriterium 8 der Prüfliste
Einsatztauglichkeit): ein Regler, eine Sperre. Solange eine Warnung aktiv ist, lässt sich die
Anzeige nicht unter eine Untergrenze dimmen.

## Requirements

### Requirement: Helligkeitsstufen

Das System SHALL genau einen Helligkeitsregler mit den Stufen 100, 80, 60, 40 und 20 %
anbieten. Eine Stufe „aus“ (0 %) MUST NOT wählbar sein. Einen getrennten Kontrastregler
MUST es nicht geben.

#### Scenario: Stufen im Benutzermenü
- **WHEN** das Benutzermenü geöffnet wird
- **THEN** enthält die Gruppe „Helligkeit“ genau die Stufen 100, 80, 60, 40 und 20 %
- **AND** die gewählte Stufe trägt „✓“ im Text

#### Scenario: Stufen in der Sprungpalette
- **WHEN** in der Sprungpalette „Helligkeit“ gesucht wird
- **THEN** erscheinen fünf Schnelleinstellungen „Helligkeit: N %“, die die Wahl setzen

### Requirement: Gespeicherte Wahl gewinnt

Das System SHALL die gewählte Stufe im Browser speichern und beim Neuladen wiederherstellen.
Ohne gespeicherte Wahl MUST die Stufe 100 % gelten. Ein unbekannter gespeicherter Wert MUST
als „keine Wahl“ gelten (100 %). Keine Heuristik MUST eine gespeicherte Wahl überstimmen.

#### Scenario: Neuladen
- **WHEN** die Stufe 40 % gewählt und die Seite neu geladen wird
- **THEN** ist die Anzeige vor dem ersten React-Render auf 40 % abgedunkelt
- **AND** die Wahl im Benutzermenü steht auf 40 %

#### Scenario: Unbrauchbarer Speicherwert
- **WHEN** im Speicher ein Wert steht, der keine Stufe ist
- **THEN** gilt 100 %

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

### Requirement: Warnsperre

Solange eine Warnung aktiv ist, SHALL die wirksame Stufe `max(Wahl, Boden)` sein. Der Boden
MUST die kleinste Stufe sein, bei der `alarmText` auf `grund` in beiden Paletten einen
Kontrast von mindestens 4,5 : 1 hält. Ohne aktive Warnung MUST die wirksame Stufe gleich der
Wahl sein. Die Sperre MUST NOT die gespeicherte Wahl ändern.

#### Scenario: Sperre greift
- **WHEN** die Wahl 40 % ist und eine Warnung aktiv wird
- **THEN** ist die wirksame Stufe der Boden (80 %)
- **AND** die gespeicherte Wahl bleibt 40 %

#### Scenario: Sperre greift nicht ohne Warnung
- **WHEN** die Wahl 40 % ist und keine Warnung aktiv ist
- **THEN** ist die wirksame Stufe 40 %

#### Scenario: Wahl über dem Boden
- **WHEN** die Wahl 100 % ist und eine Warnung aktiv ist
- **THEN** ist die wirksame Stufe 100 %

#### Scenario: Warnung endet
- **WHEN** die Warnung endet
- **THEN** gilt wieder die gewählte Stufe, ohne Nutzereingriff

#### Scenario: Erklärung im Menü
- **WHEN** eine Warnung aktiv ist und das Benutzermenü geöffnet wird
- **THEN** nennt die Gruppe „Helligkeit“ den Boden und den Grund
- **AND** die Stufen unter dem Boden sind gesperrt
- **AND** eine Wahl unter dem Boden trägt den Hinweis auf die wirksame Stufe

### Requirement: Darstellung der Abdunklung

Die Abdunklung SHALL die ganze Bildschirmdarstellung erfassen, einschließlich Overlays und
Portalen. Sie MUST Zeigereingaben durchlassen. Der Druck MUST NOT abgedunkelt werden.
Farbpaletten und Theme-Tokens MUST unverändert bleiben.

#### Scenario: Klick durch die Abdunklung
- **WHEN** die Stufe 40 % gilt und ein Knopf angeklickt wird
- **THEN** löst der Knopf aus

#### Scenario: Volle Helligkeit
- **WHEN** die wirksame Stufe 100 % ist
- **THEN** wird keine Abdunklungsschicht dargestellt

#### Scenario: Drucken
- **WHEN** bei 40 % gedruckt wird
- **THEN** ist der Ausdruck nicht abgedunkelt
