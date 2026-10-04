## ADDED Requirements

### Requirement: Eine Modulroute ohne Zugriff zeigt einen einheitlichen Hinweis
Öffnet ein Benutzer eine Route, die zu einem Modul gehört, und melden die Freigaben des Servers
für dieses Modul `zugriff: false`, MUST der Einsatzrahmen statt der Modulseite einen
einheitlichen Hinweis zeigen. Das gilt für die Modulroute und für jede ihrer Unterrouten. Der
Hinweis MUST das Modul nennen und den Grund angeben. Bei `sichtbar: false` lautet er
„ausgeblendet“, sonst „für deine Rolle nicht freigegeben“. Er MUST einen Rückweg in ein Modul
anbieten, das für den Benutzer frei ist. Die Modulseite MUST dabei nicht gerendert werden und
MUST keine Anfrage an den Listen-Endpunkt des Moduls stellen. Die Navigation des Einsatzes bleibt
bedienbar. Solange die Freigaben laden oder ihr Abruf gescheitert ist, MUST der Rahmen die
Modulseite unverändert rendern.

#### Scenario: Deeplink in ein gesperrtes Modul
- **WHEN** die Org-Vorgabe das Modul `lagemeldungen` auf Führungskräfte beschränkt und ein normales Mitglied `/einsaetze/:id/lagemeldungen` direkt aufruft
- **THEN** zeigt der Inhaltsbereich den Hinweis mit „Lagemeldungen“ und „Keine Berechtigung“, es geht keine Anfrage an die Liste der Lagemeldungen, und die Navigation steht daneben

#### Scenario: Unterroute eines gesperrten Moduls
- **WHEN** das Modul `stab` für den Benutzer `zugriff: false` hat und er `/einsaetze/:id/stab/funkplan` aufruft
- **THEN** zeigt der Rahmen denselben Hinweis für „Stab“

#### Scenario: Ausgeblendetes Modul
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein Mitglied ohne Admin-Rechte dessen Route aufruft
- **THEN** nennt der Hinweis das Modul als ausgeblendet

#### Scenario: System-Admin in einem ausgeblendeten Modul
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein System-Admin dessen Route aufruft
- **THEN** rendert der Rahmen die Modulseite, weil `zugriff: true` gilt

#### Scenario: Freigaben laden noch
- **WHEN** ein Benutzer eine Modulroute öffnet und die Freigaben noch nicht geantwortet haben
- **THEN** rendert der Rahmen die Modulseite wie bisher und zeigt keinen Hinweis

#### Scenario: Rückweg
- **WHEN** der Hinweis erscheint
- **THEN** führt sein Rückweg in ein Modul, für das der Benutzer `zugriff: true` hat, notfalls in die Einsatzdaten

### Requirement: Bedienelemente in ein gesperrtes Modul sind gesperrt oder ohne Ziel
Ein Bedienelement einer Seite, das in ein anderes Modul springt, MUST die Freigaben des Servers
für das Zielmodul beachten. Gemeint sind Kopfaktionen, Paneel-, Leer- und Inspector-Aktionen,
Kennzahl-Ziele und eigenständige Verweise. Melden die Freigaben für das Zielmodul
`zugriff: false`, MUST ein Knopf gesperrt erscheinen, mit dem Grund „Keine Berechtigung“. Ein
Link oder ein Kennzahl-Ziel MUST entfallen, und die Beschriftung bzw. der Wert MUST stehen
bleiben. Solange die Freigaben unbekannt sind, MUST das Bedienelement so erscheinen wie bisher.
Verweise in Datenzeilen (etwa Backlinks eines ETB-Eintrags) sind davon ausgenommen. Für sie gilt
der Hinweis des Rahmens.

#### Scenario: Kopfaktion im Überblick
- **WHEN** das Modul `etb` für den Benutzer `zugriff: false` hat und er den Führungsüberblick öffnet
- **THEN** steht die Kopfaktion „Eintrag“ gesperrt da, mit „Keine Berechtigung“ als Grund, und ein Klick wechselt die Seite nicht

#### Scenario: Kennzahl-Ziel
- **WHEN** das Modul `kraefteuebersicht` für den Benutzer `zugriff: false` hat und die Kennzahl „Kräfte im Einsatz“ einen Wert trägt
- **THEN** zeigt die Kennzahl den Wert ohne Link

#### Scenario: Freies Zielmodul
- **WHEN** das Zielmodul für den Benutzer frei ist
- **THEN** springt das Bedienelement wie bisher
