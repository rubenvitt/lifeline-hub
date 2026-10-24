## ADDED Requirements

### Requirement: Ein Modul ohne Navigationsziel
Ein Modul SHALL als Freigabe ohne eigenes Navigationsziel bestehen können; heute gilt das für
`stab`. Ein solches Modul MUST in Icon-Rail, Modulmenü, Navigations-Drawer, Sprungpalette,
„Zuletzt besucht“ und der Wahl der Startseite fehlen, auch wenn es sichtbar und frei ist. Der
Rail-Sprung einer Kategorie und der Rückweg aus einem gesperrten Modul MUST es überspringen.
Seine Freigabe MUST unverändert für die Endpunkte und die Abnehmer seiner Daten gelten, und die
Modul-Einstellungen von Einsatz, Organisation und Vorlage MUST es weiter führen.

#### Scenario: Stab frei, aber nicht in der Navigation
- **WHEN** der Stab im Einsatz sichtbar und für die Person frei ist
- **THEN** fehlt „Stab“ im Modulmenü und in der Sprungpalette, und `GET /api/einsaetze/{id}/stab`
  antwortet 200

#### Scenario: Rückweg
- **WHEN** eine Person ein gesperrtes Modul aufruft und der Stab das erste freie Modul der Registry
  wäre
- **THEN** führt der Rückweg in ein anderes freies Modul, nicht in den Stab

## MODIFIED Requirements

### Requirement: Eine Modulroute ohne Zugriff zeigt einen einheitlichen Hinweis
Öffnet ein Benutzer eine Route, die zu einem Modul gehört, und melden die Freigaben des Servers
für dieses Modul `zugriff: false`, MUST der Einsatzrahmen statt der Modulseite einen
einheitlichen Hinweis zeigen. Das gilt für die Modulroute und für jede ihrer Unterrouten. Der
Hinweis MUST das Modul nennen und den Grund angeben. Bei `sichtbar: false` lautet er
„ausgeblendet“, sonst „für deine Rolle nicht freigegeben“. Er MUST einen Rückweg in ein Modul
anbieten, das für den Benutzer frei ist. Die Modulseite MUST dabei nicht gerendert werden und
MUST keine Anfrage an den Listen-Endpunkt des Moduls stellen. Die Navigation des Einsatzes bleibt
bedienbar. Solange die Freigaben laden, MUST der Rahmen statt der Modulseite einen Ladezustand
zeigen; für `einsatzdaten` und `einsatz-einstellungen` gilt das nicht. Ist ihr Abruf gescheitert
oder ruht er ohne Netz, MUST der Rahmen die Modulseite unverändert rendern.

#### Scenario: Deeplink in ein gesperrtes Modul
- **WHEN** die Org-Vorgabe das Modul `lagemeldungen` auf Führungskräfte beschränkt und ein normales Mitglied `/einsaetze/:id/lagemeldungen` direkt aufruft
- **THEN** zeigt der Inhaltsbereich den Hinweis mit „Lagemeldungen“ und „Keine Berechtigung“, es geht keine Anfrage an die Liste der Lagemeldungen, und die Navigation steht daneben

#### Scenario: Unterroute eines gesperrten Moduls
- **WHEN** das Modul `fernmeldewesen` für den Benutzer `zugriff: false` hat und er `/einsaetze/:id/fernmeldewesen/kommunikationsplan` aufruft
- **THEN** zeigt der Rahmen denselben Hinweis für „Fernmeldewesen“

#### Scenario: Unterroute eines gesperrten Stabs
- **WHEN** das Modul `presse` für den Benutzer `zugriff: false` hat und er `/einsaetze/:id/presse/infotelefon` aufruft
- **THEN** zeigt der Rahmen denselben Hinweis für „Presse“; Unterrouten des Stabs gibt es nicht mehr

#### Scenario: Ausgeblendetes Modul
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein Mitglied ohne Admin-Rechte dessen Route aufruft
- **THEN** nennt der Hinweis das Modul als ausgeblendet

#### Scenario: System-Admin in einem ausgeblendeten Modul
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein System-Admin dessen Route aufruft
- **THEN** rendert der Rahmen die Modulseite, weil `zugriff: true` gilt

#### Scenario: Freigaben laden noch
- **WHEN** ein Benutzer eine Modulroute öffnet und die Freigaben noch nicht geantwortet haben
- **THEN** zeigt der Rahmen einen Ladezustand, rendert die Modulseite noch nicht und zeigt keinen Hinweis

#### Scenario: Freigaben gescheitert
- **WHEN** der Abruf der Freigaben scheitert
- **THEN** rendert der Rahmen die Modulseite wie bisher

#### Scenario: Rückweg
- **WHEN** der Hinweis erscheint
- **THEN** führt sein Rückweg in ein Modul, für das der Benutzer `zugriff: true` hat, notfalls in die Einsatzdaten

