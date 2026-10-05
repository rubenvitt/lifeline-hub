# modul-freigabe Specification

## Purpose
Die effektive Modulfreigabe eines Benutzers in einem Einsatz hat genau eine Quelle: den Server.
Der Client zeigt Module und lädt ihre Daten nach dieser Auskunft und rechnet die Regel nicht nach.

## Requirements

### Requirement: Der Server liefert die Modulfreigaben je Benutzer und Einsatz
Das System SHALL unter `GET /api/einsaetze/{id}/modul-freigaben` für jeden Modul-Key der Registry
einen Eintrag `{ sichtbar, zugriff }` für den anfragenden Benutzer liefern. Der Endpunkt MUST
Lesezugriff auf den Einsatz verlangen und gehört selbst keinem Modul. Er antwortet für einen
unbekannten Einsatz mit HTTP 404 und ohne Lesezugriff mit HTTP 403.

#### Scenario: Alle Module erscheinen
- **WHEN** ein Mitglied den Endpunkt für einen Einsatz ohne Overrides und ohne Org-Vorgaben aufruft
- **THEN** antwortet das System mit HTTP 200, enthält einen Eintrag je Modul-Key, und jeder Eintrag lautet `sichtbar: true, zugriff: true`

#### Scenario: Kein Lesezugriff
- **WHEN** ein Benutzer ohne Lesezugriff auf den Einsatz anfragt
- **THEN** antwortet das System mit HTTP 403

### Requirement: Zugriff folgt derselben Regel wie die Listen-Endpunkte
`zugriff` MUST für jedes Modul genau dann `true` sein, wenn der Benutzer den Listen-Endpunkt des
Moduls ohne Modulsperre aufrufen darf. Es gelten dieselben Regeln: Sichtbarkeit, Rollensperre aus
dem Einsatz-Override, sonst aus der Org-Vorgabe, die Ausnahme für System-Admins und die nicht
ausblendbaren Module.

#### Scenario: Org-Vorgabe sperrt ein Modul
- **WHEN** die Org-Vorgabe das Modul `schaeden` auf Führungskräfte beschränkt, der Einsatz keinen Override dafür hat und ein Mitglied ohne diese Berechtigung anfragt
- **THEN** lautet der Eintrag `schaeden` `sichtbar: true, zugriff: false`, und der Listen-Endpunkt der Schäden antwortet demselben Benutzer mit HTTP 403

#### Scenario: Einsatz-Override geht der Org-Vorgabe vor
- **WHEN** die Org-Vorgabe `schaeden` auf Führungskräfte beschränkt und der Einsatz-Override es auf System-Admins beschränkt
- **THEN** lautet der Eintrag `schaeden` für eine org-weite Führungskraft ohne Admin-Rechte `zugriff: false`

#### Scenario: Führungskraft
- **WHEN** die Org-Vorgabe `schaeden` auf Führungskräfte beschränkt und eine org-weite Führungskraft anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Nicht ausblendbares Modul
- **WHEN** ein Mitglied anfragt
- **THEN** lauten die Einträge `einsatzdaten` und `einsatz-einstellungen` `sichtbar: true, zugriff: true`, unabhängig von Overrides und Org-Vorgaben

### Requirement: Sichtbarkeit ist eigene Angabe
`sichtbar` MUST `false` sein, wenn der Einsatz das Modul ausblendet und das Modul ausblendbar ist,
sonst `true`. Für System-Admins gilt das ebenso. Ein ausgeblendetes Modul bleibt für sie
erreichbar (`zugriff: true`), erscheint aber in keiner Navigation.

#### Scenario: Ausgeblendetes Modul für ein Mitglied
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein Mitglied ohne Admin-Rechte anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: false`

#### Scenario: Ausgeblendetes Modul für einen System-Admin
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein System-Admin anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: true`

### Requirement: Die Navigation folgt den Freigaben des Servers
Die Navigation des Einsatzes MUST ein Modul mit `sichtbar: false` nicht zeigen. Ein Modul mit
`sichtbar: true, zugriff: false` MUST sie gesperrt zeigen, mit dem Grund „Keine Berechtigung“ und
ohne dass ein Klick dorthin führt. Rail-Sprünge in eine Kategorie und die Sprungpalette MUST
dieselbe Auskunft verwenden.

#### Scenario: Org-Vorgabe in der Navigation
- **WHEN** die Org-Vorgabe ein Modul auf Führungskräfte beschränkt und ein normales Mitglied den Einsatz öffnet
- **THEN** zeigt die Navigation das Modul gesperrt mit „Keine Berechtigung“, und der Rail-Sprung der Kategorie führt nicht dorthin

#### Scenario: Sprungpalette
- **WHEN** dasselbe Mitglied die Sprungpalette öffnet
- **THEN** bietet sie weder das Modul noch Datensätze daraus an

### Requirement: Keine Anfrage an ein nicht freigegebenes Modul
Eine Seite oder ein Rahmen, die Daten eines fremden Moduls laden, MUST dessen Listen-Endpunkt nur
abfragen, wenn die Freigaben vorliegen und das Modul `sichtbar` und `zugriff` hat. Solange die
Freigaben laden oder ihr Abruf fehlgeschlagen ist, MUST keine solche Anfrage ausgehen. Ein nicht
freigegebenes Modul MUST NOT als Ausfall einer Datenquelle gemeldet werden.

#### Scenario: Gesperrte Kartenquelle
- **WHEN** die Org-Vorgabe das Modul `schaeden` auf Führungskräfte beschränkt und ein normales Mitglied die Lagekarte öffnet
- **THEN** geht keine Anfrage an die Schadensliste, die Karte zeigt keine Schäden, und es erscheint kein Ausfallhinweis

#### Scenario: Freigaben laden noch
- **WHEN** die Lagekarte öffnet und die Freigaben noch nicht geantwortet haben
- **THEN** geht keine Anfrage an die Listen modulgebundener Kartenquellen, bis die Freigaben vorliegen

#### Scenario: Abruf der Freigaben scheitert
- **WHEN** die Lagekarte öffnet und der Abruf der Freigaben fehlschlägt
- **THEN** geht keine Anfrage an die Listen modulgebundener Kartenquellen, und der Ausfallhinweis nennt „Berechtigungen“

#### Scenario: Freie Kartenquelle
- **WHEN** das Modul `schaeden` für den Benutzer frei ist und der Abruf der Schadensliste scheitert
- **THEN** meldet die Lagekarte „Schäden“ im Ausfallhinweis wie bisher

### Requirement: Änderungen an Overrides und Org-Vorgaben wirken ohne Neuladen
Ändert ein Benutzer im Client einen Modul-Override eines Einsatzes oder eine Org-Vorgabe, MUST
der Client die Freigaben neu laden, die davon betroffen sind. Für den ändernden Benutzer zeigt die
Navigation die neue Freigabe dann ohne Neuladen der Seite.

#### Scenario: Override gesetzt
- **WHEN** eine Einsatzleitung ohne Admin-Rechte im Editor „Module“ ein Modul ausblendet
- **THEN** verschwindet das Modul aus ihrer Navigation, ohne dass sie die Seite neu lädt

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
- **THEN** zeigt der Rahmen einen Ladezustand, rendert die Modulseite noch nicht und zeigt keinen Hinweis

#### Scenario: Freigaben gescheitert
- **WHEN** der Abruf der Freigaben scheitert
- **THEN** rendert der Rahmen die Modulseite wie bisher

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

### Requirement: Das Heraufstufen aus dem Chat verlangt die Freigabe des Zielmoduls
Das Heraufstufen einer Chat-Nachricht MUST außer dem Schreibrecht im Chat die Freigabe des
Zielmoduls verlangen: ins ETB die des Moduls `etb`, zum Auftrag die des Moduls `auftraege`, nach
derselben Regel wie der Listen-Endpunkt des Zielmoduls. Fehlt sie, MUST das System mit HTTP 403
antworten, ohne dass Eintrag, Auftrag, Dateikopie oder Rückverweis entstehen. Der Weg zum Auftrag
MUST die Freigabe des ETB nicht zusätzlich verlangen.

#### Scenario: ETB für die Rolle gesperrt
- **WHEN** das Modul `etb` im Einsatz auf System-Admins beschränkt ist und eine Führungsperson ohne Admin-Rechte eine Chat-Nachricht ins ETB heraufstuft
- **THEN** antwortet das System mit HTTP 403
- **AND** es entsteht kein ETB-Eintrag, und die Nachricht trägt keinen Verweis auf einen Eintrag

#### Scenario: ETB frei
- **WHEN** das Modul `etb` für die Führungsperson frei ist und sie dieselbe Nachricht heraufstuft
- **THEN** entsteht der Eintrag wie bisher

#### Scenario: Aufträge für die Rolle gesperrt
- **WHEN** das Modul `auftraege` im Einsatz auf System-Admins beschränkt ist und eine Führungsperson ohne Admin-Rechte eine Chat-Nachricht zum Auftrag heraufstuft
- **THEN** antwortet das System mit HTTP 403
- **AND** es entstehen weder Auftrag noch ETB-Anordnung, und die Nachricht trägt keinen Verweis auf einen Auftrag

#### Scenario: Auftrag bei gesperrtem ETB
- **WHEN** das Modul `etb` für die Führungsperson gesperrt, `auftraege` aber frei ist und sie eine Nachricht zum Auftrag heraufstuft
- **THEN** entsteht der Auftrag wie über die Auftragsliste

### Requirement: Das Chat-Menü sperrt das Heraufstufen in ein gesperrtes Modul
Im Chat MUST der Menüeintrag „Zu ETB“ bzw. „Zu Auftrag“ einer Nachricht gesperrt erscheinen, wenn
die Freigaben des Servers für das Zielmodul `zugriff: false` melden, mit dem Grund „Keine
Berechtigung“ im Eintrag. Ein gesperrter Eintrag MUST NOT den Dialog öffnen. Solange die Freigaben
unbekannt sind, MUST der Eintrag wie bisher erscheinen.

#### Scenario: Menüeintrag ohne Freigabe
- **WHEN** die Freigaben des Servers für `etb` `zugriff: false` melden und eine schreibberechtigte Person das Menü einer Nachricht öffnet
- **THEN** steht „Zu ETB (Keine Berechtigung)“ gesperrt im Menü, und ein Klick öffnet keinen Dialog

#### Scenario: Auftrag frei, ETB gesperrt
- **WHEN** dieselbe Person für `auftraege` `zugriff: true` hat
- **THEN** steht „Zu Auftrag“ im selben Menü bedienbar da

#### Scenario: Freigaben unbekannt
- **WHEN** die Freigaben noch laden
- **THEN** stehen „Zu ETB“ und „Zu Auftrag“ wie bisher bedienbar im Menü
