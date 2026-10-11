## MODIFIED Requirements

### Requirement: Bedienoberfläche
Die Einsatzdaten-Bearbeitung SHALL kein Eingabefeld für die Einsatznummer anbieten. Die
Einsatznummer SHALL in den Einsatzdaten als Text angezeigt werden, im Seitenkopf und im Paneel
„Einsatz“. Die Einsatz-Vorgaben der
Administration SHALL das Feld „Präfix Einsatznummer“ neben den übrigen Nummernkreis-Präfixen
anbieten. Ein Speichern der Einsatz-Vorgaben MUST das Feld im Vollersatz mitschicken, sonst
würde ein Speichern in einer anderen Sektion es leeren.

#### Scenario: Keine Eingabe in den Einsatzdaten
- **WHEN** jemand mit Schreibrecht die Einsatzdaten öffnet und die Leitstellen-Nr. an ihrer Zeile speichert
- **THEN** trägt die Einsatznummer keine Bearbeiten-Aufforderung, die Zeile „Leitstellen-Nr.“ ist bearbeitbar, und der Request enthält kein `einsatznummer_intern`

#### Scenario: Präfix in den Einsatz-Vorgaben
- **WHEN** ein Admin unter den Einsatz-Vorgaben „Präfix Einsatznummer“ auf `WF-` setzt und speichert
- **THEN** enthält der PUT `einsatz_nummer_praefix: "WF-"` und alle übrigen Felder mit ihrem Bestandswert
