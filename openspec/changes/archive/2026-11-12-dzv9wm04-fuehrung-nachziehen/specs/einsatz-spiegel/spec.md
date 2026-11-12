## MODIFIED Requirements

### Requirement: Wer einen Einsatz anlegt, führt ihn, die anderen spiegeln

Ein Einsatz SHALL von der Instanz geführt werden, an der er angelegt wurde, mit Führung je
Einsatz von der, die seine Akte nennt (Spec `instanz-fuehrung`). Ist seine Org einer aktiven
Kopplung zugeordnet, MUST das Gegenüber ihn als Spiegel erhalten, gleich welche Seite sich meldet.
Ein Spiegel MUST mit der Org des Gegenübers verbunden sein, die über die Kopplung zugeordnet ist.
Ein Einsatz SHALL eine Kennung tragen, die über Instanzen hinweg gleich bleibt.

#### Scenario: ELW führt, Hub spiegelt
- **WHEN** am gekoppelten ELW ein Einsatz der zugeordneten Org angelegt wird
- **THEN** erscheint er nach dem nächsten Abgleich am Hub in der Einsatzliste der zugeordneten Org, gekennzeichnet als „Spiegel von <ELW>“

#### Scenario: Hub führt, ELW spiegelt
- **WHEN** am Hub ein Einsatz der zugeordneten Org angelegt wird
- **THEN** erscheint er nach dem nächsten Abgleich am ELW als „Spiegel von <Hub>“

#### Scenario: Org nicht zugeordnet
- **WHEN** ein Einsatz einer Org angelegt wird, die keiner Kopplung zugeordnet ist
- **THEN** verlässt er die Instanz nicht

#### Scenario: Führung gewechselt
- **WHEN** bei eingeschalteter Führung je Einsatz der ELW die Führung eines dort angelegten Einsatzes an den Hub übergeben hat
- **THEN** ist der Einsatz am ELW ein „Spiegel von <Hub>“ und am Hub ein eigener Einsatz

### Requirement: Widerruf beendet den Abgleich, nicht den Spiegel

Wird die Org-Zuordnung einer Kopplung widerrufen, MUST der Abgleich ihrer Einsätze enden. Die
vorhandenen Spiegel SHALL lesbar und schreibgeschützt bleiben. Ausstehende Anträge an diesen
Spiegeln MUST als abgelehnt mit dem Grund „Kopplung widerrufen“ erscheinen. Ausgenommen ist bei
eingeschalteter Führung je Einsatz ein Spiegel, dessen Akte das widerrufene Gegenüber als Führer nennt; ihn führt die Instanz danach
selbst (Spec `instanz-fuehrung`).

#### Scenario: Widerruf am Hub
- **WHEN** der Admin am Hub die Org-Zuordnung zu einem ELW widerruft und die Führung je Einsatz ausgeschaltet ist
- **THEN** bleibt der Spiegel am Hub lesbar und zeigt „Abgleich beendet“, und der ELW liefert nichts mehr

#### Scenario: Widerruf mit Führung je Einsatz
- **WHEN** der Admin am Hub die Org-Zuordnung zu einem ELW widerruft, die Führung je Einsatz eingeschaltet ist und der Hub einen Einsatz spiegelt, den laut Akte der ELW führt
- **THEN** führt der Hub den Einsatz danach selbst und schreibbar, ausstehende Anträge daran sind mit „Kopplung widerrufen.“ abgelehnt, und der ELW liefert nichts mehr
