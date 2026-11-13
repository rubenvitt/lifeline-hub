# Spec Delta

## MODIFIED Requirements

### Requirement: Widerruf beendet den Abgleich, nicht den Spiegel

Wird die Org-Zuordnung einer Kopplung widerrufen, MUST der Abgleich ihrer Einsätze enden. Die
vorhandenen Spiegel SHALL lesbar und schreibgeschützt bleiben. Ausstehende Anträge an diesen
Spiegeln MUST als abgelehnt mit dem Grund „Kopplung widerrufen“ erscheinen. Ausgenommen ist bei
eingeschalteter Führung je Einsatz ein Spiegel, dessen Akte das widerrufene Gegenüber als Führer nennt; ihn führt die Instanz danach
selbst (Spec `instanz-fuehrung`). Liefert das Gegenüber einen solchen Spiegel später über eine
neue Zuordnung, MUST er nur dann wieder abgeglichen werden, wenn die neue Zuordnung derselben
eigenen Org gehört wie der Spiegel. Gehört sie einer anderen Org, MUST die Lieferung verworfen
werden; der Spiegel bleibt unverändert bei seiner Org, und weder seine Org noch seine
Mitgliedschaften ändern sich.

#### Scenario: Widerruf am Hub
- **WHEN** der Admin am Hub die Org-Zuordnung zu einem ELW widerruft und die Führung je Einsatz ausgeschaltet ist
- **THEN** bleibt der Spiegel am Hub lesbar und zeigt „Abgleich beendet“, und der ELW liefert nichts mehr

#### Scenario: Widerruf mit Führung je Einsatz
- **WHEN** der Admin am Hub die Org-Zuordnung zu einem ELW widerruft, die Führung je Einsatz eingeschaltet ist und der Hub einen Einsatz spiegelt, den laut Akte der ELW führt
- **THEN** führt der Hub den Einsatz danach selbst und schreibbar, ausstehende Anträge daran sind mit „Kopplung widerrufen.“ abgelehnt, und der ELW liefert nichts mehr

#### Scenario: Neue Zuordnung an dieselbe Org
- **WHEN** der Hub die Zuordnung seiner Org X zu einem ELW widerrufen hat, Org X danach erneut mit derselben Org des ELW gekoppelt wird und der ELW den Einsatz weiter ändert
- **THEN** wird der beendete Spiegel der Org X wieder abgeglichen und zeigt die neuen Änderungen

#### Scenario: Neue Zuordnung an eine andere Org
- **WHEN** der Hub die Zuordnung seiner Org X zu einem ELW widerrufen hat, dieselbe Org des ELW danach einer anderen Org Y des Hubs zugeordnet wird und der ELW den Einsatz weiter ändert
- **THEN** bleibt der Spiegel bei Org X beendet und unverändert, Konten der Org X behalten nur ihren bisherigen Lesezugriff, und der Einsatz erscheint weder in der Einsatzliste der Org Y noch mit Änderungen aus der Zeit nach dem Widerruf
