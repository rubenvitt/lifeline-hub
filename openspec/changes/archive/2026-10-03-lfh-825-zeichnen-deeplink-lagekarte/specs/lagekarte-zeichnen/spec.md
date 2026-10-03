## ADDED Requirements

### Requirement: Zeichnen per Link
Die Lagekarte SHALL einen Link mit dem Auftrag `zeichnen=<zonentyp>` annehmen und dann den
Zeichenmodus dieses Zonentyps betreten, genau so, als wäre der Knopf des Typs im Zeichnen-Paneel
gedrückt worden. Angenommen MUST jeder Zonentyp werden, den das Zeichnen-Paneel anbietet. Für einen
Typ, der Fläche und Linie erlaubt, MUST der Auftrag die Form als `:flaeche` oder `:linie`
annehmen; fehlt sie, MUST die Fläche gelten. Für einen Typ mit fester Geometrie MUST eine abweichende Form den
Auftrag ungültig machen.

Der Modus MUST nur betreten werden, wenn die Person im Einsatz schreiben darf und die Karte keinen
eingefrorenen Stand zeigt. Solange Einsatz und Rechte noch laden, MUST der Auftrag stehen bleiben.
Danach MUST der Auftrag aus der Adresse entfernt werden, auch wenn er ungültig war oder mangels
Schreibrecht nicht ausgeführt wurde, damit ein Neuladen die Karte nicht erneut in den Modus schickt.
Das Zeichnen per Link MUST denselben Regeln folgen wie das Zeichnen über das Paneel, insbesondere
dem zweistufigen Esc.

#### Scenario: Gefahrengebiet per Link
- **WHEN** eine Person mit Schreibrecht die Lagekarte mit dem Auftrag `zeichnen=gefahrengebiet` öffnet
- **THEN** steht die Karte im Zeichenmodus für ein Gefahrengebiet als Fläche, die Zeichnen-Steuerung ist sichtbar, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Neuladen nach dem Auftrag
- **WHEN** die Seite danach neu geladen wird
- **THEN** startet kein Zeichenmodus

#### Scenario: Freie Skizze als Linie
- **WHEN** der Auftrag `zeichnen=freie_skizze:linie` lautet
- **THEN** startet das Zeichnen einer freien Skizze als Linie

#### Scenario: Unpassende Form
- **WHEN** der Auftrag `zeichnen=absperrgrenze:flaeche` lautet
- **THEN** startet kein Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Unbekannter Typ
- **WHEN** der Auftrag einen Typ nennt, den das Zeichnen-Paneel nicht kennt
- **THEN** startet kein Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person ohne Schreibrecht im Einsatz den Link öffnet
- **THEN** zeigt die Karte die reine Ansicht ohne Zeichenmodus, und der Auftrag ist aus der Adresse verschwunden

#### Scenario: Kaltstart über den Link
- **WHEN** der Link in einem neuen Tab geöffnet wird und der Einsatz erst nach dem ersten Bild geladen ist
- **THEN** startet der Zeichenmodus, sobald Einsatz und Rechte feststehen, und der Auftrag wird nicht vorher verworfen

#### Scenario: Esc nach dem Link
- **WHEN** der Zeichenmodus per Link gestartet ist, noch kein Punkt gesetzt ist und Esc gedrückt wird
- **THEN** endet der Zeichenmodus
