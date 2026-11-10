## ADDED Requirements

### Requirement: Kontextmenü zeigt die Aktionen der Knopfreihe

Stehen die Aktionen eines Datensatzes auf breitem Schirm als Knöpfe in der Zeile und nur auf
schmalem Schirm hinter einem ⋮, SHALL das Kontextmenü auf jeder Breite dieselben Aktionen in
derselben Reihenfolge, mit demselben Sperrzustand und derselben Wirkung zeigen wie Knöpfe und ⋮.
Was als Knopf rot steht, MUST im Kontextmenü rot hinter einem Trenner stehen.

#### Scenario: Externe Stelle am breiten Schirm
- **WHEN** eine Person mit Verwaltungsrecht in den Stammdaten bei 1280 px Breite mit der rechten Maustaste auf die Zeile der aktiven externen Stelle „Leitstelle Nord“ klickt, die die Knöpfe „Bearbeiten“ und rot „Deaktivieren“ trägt
- **THEN** öffnet am Zeiger ein Menü mit „Bearbeiten“, einem Trenner und rot „Deaktivieren“, und das Browsermenü erscheint nicht

#### Scenario: Statuswechsel läuft
- **WHEN** ein Fahrzeug in den Stammdaten gerade außer Dienst genommen wird und jemand vor der Serverantwort das Kontextmenü dieser Zeile öffnet
- **THEN** stehen „Bearbeiten“ und „Außer Dienst nehmen“ gesperrt im Menü, wie die Knöpfe der Zeile

#### Scenario: Vom Hub verwaltet
- **WHEN** eine Person mit der rechten Maustaste auf die Zeile eines Fahrzeugs klickt, das der Hub verwaltet und das deshalb keine Aktion trägt
- **THEN** erscheint das Browsermenü und kein eigenes Menü

### Requirement: Gesperrte Primäraktion steht gesperrt im Kontextmenü

Ist die Primäraktion eines Datensatzes als Knopf gesperrt (etwa ohne Netz), SHALL sie im
Kontextmenü an ihrer Stelle gesperrt stehen und nicht auslösen.

#### Scenario: Kommunikationsplan ohne Netz
- **WHEN** der Kommunikationsplan ohne Netz geöffnet ist und eine Person mit Schreibrecht das Kontextmenü einer gepflegten Stelle öffnet
- **THEN** stehen „+ Verbindung“ und alle Einträge des ⋮ gesperrt im Menü

#### Scenario: Kommunikationsplan mit Netz
- **WHEN** eine Person mit Schreibrecht das Kontextmenü der gepflegten Stelle „Fernmeldezentrale“ mit einer Rufnummer öffnet
- **THEN** stehen oben „+ Verbindung“, danach die Einträge des ⋮ in dessen Reihenfolge und rot hinter einem Trenner „Stelle entfernen“

### Requirement: Zeilen mit Reglern tragen das Kontextmenü an ihrer Bezeichnung

Trägt die Zeile eines Datensatzes Bedienelemente, die auf Drücken und Halten reagieren (Regler,
Schalter, Auswahlfelder), SHALL nur der Teil mit Bezeichnung und ⋮ das Kontextmenü öffnen. Auf
den Bedienelementen MUST weder Rechtsklick noch langer Druck das Kontextmenü öffnen.

#### Scenario: Deckkraft eines Bild-Hintergrunds
- **WHEN** eine Person am Tablet in den Bild-Hintergründen der Lagekarte 600 ms auf den Deckkraft-Regler eines Bildes drückt, ohne den Finger zu bewegen
- **THEN** öffnet kein Kontextmenü, und der Regler bleibt bedienbar

#### Scenario: Sichtbarkeitsschalter eines Bild-Hintergrunds
- **WHEN** eine Person mit Schreibrecht mit der rechten Maustaste auf den Sichtbarkeitsschalter eines Bildes klickt
- **THEN** öffnet kein eigenes Kontextmenü

#### Scenario: Name eines Bild-Hintergrunds
- **WHEN** eine Person mit Schreibrecht mit der rechten Maustaste auf den Namen des Bild-Hintergrunds „Gelände Nord“ klickt
- **THEN** öffnet am Zeiger ein Menü mit „Auf Bild zentrieren“, „Auf der Karte platzieren“, einem Trenner und rot „Bild entfernen …“
