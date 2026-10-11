# stammdaten-externe-stellen Specification

## Purpose
Führt je Organisation einen Stammdaten-Katalog der externen Stellen, mit denen ein Einsatz zu tun
hat (Leitstellen, Behörden, Polizei, Hilfsorganisationen). Er liefert Vorschläge für die meldende
Stelle und den Adressaten einer Nachforderung und kennt die zuständige Leitstelle der
Organisation. Freitext bleibt an allen Stellen erlaubt.

## Requirements

### Requirement: Katalogeintrag einer externen Stelle
Eine externe Stelle SHALL eine Bezeichnung (Pflicht, höchstens 200 Zeichen), eine Art aus
`leitstelle`, `behoerde`, `polizei`, `hilfsorganisation`, `sonstige` (Pflicht), optional eine
Rufnummer und einen Funkrufnamen (je höchstens 100 Zeichen) sowie die Angaben aktiv und
zuständig tragen. Leere Bezeichnung, unbekannte Art und Überlänge MUST 400 ergeben; eine
Bezeichnung, die in der Organisation schon vergeben ist, MUST 409 ergeben.

#### Scenario: Leitstelle anlegen
- **WHEN** der Admin eine Stelle „ILS Musterkreis“ mit Art `leitstelle` und Rufnummer „112“ anlegt
- **THEN** antwortet der Server mit 201, und die Stelle ist aktiv und nicht zuständig

#### Scenario: Doppelte Bezeichnung
- **WHEN** der Admin eine zweite Stelle „ILS Musterkreis“ in derselben Organisation anlegt
- **THEN** antwortet der Server mit 409, und es entsteht keine Stelle

#### Scenario: Unbekannte Art
- **WHEN** eine Stelle mit Art `feuerwehr` angelegt wird
- **THEN** antwortet der Server mit 400

#### Scenario: Bezeichnung zu lang
- **WHEN** eine Stelle mit einer Bezeichnung von 201 Zeichen angelegt wird
- **THEN** antwortet der Server mit 400, und die Meldung nennt „Bezeichnung“ und 200

### Requirement: Pflege nur durch den Admin, Lesen für die Organisation
Anlegen und Ändern einer externen Stelle SHALL dem Admin vorbehalten sein; andere Angemeldete
MUST 403 erhalten. Die Liste SHALL jedem Angemeldeten der Organisation offenstehen und ohne
Angabe nur aktive Stellen liefern, auf Wunsch auch die inaktiven. Eine Stelle MUST NOT
gelöscht werden können.

#### Scenario: Ohne Admin-Recht
- **WHEN** eine angemeldete Person ohne Admin-Recht eine Stelle anlegen will
- **THEN** antwortet der Server mit 403, und kein Ereignis `stammdaten` wird verteilt

#### Scenario: Liste für die Einsatzerfassung
- **WHEN** eine angemeldete Person ohne Admin-Recht die Liste abruft
- **THEN** erhält sie die aktiven Stellen ihrer Organisation, die inaktiven nicht

#### Scenario: Verwaltung sieht alles
- **WHEN** der Admin die Liste mit inaktiven Stellen abruft
- **THEN** enthält sie aktive und inaktive Stellen, jede mit ihrem Aktiv-Zustand

### Requirement: Org-Grenze
Eine Organisation SHALL nur ihre eigenen externen Stellen sehen und ändern. Ein Zugriff auf
die Stelle einer anderen Organisation MUST 404 ergeben, ohne dass sich etwas ändert. Dieselbe
Bezeichnung MUST in zwei Organisationen nebeneinander bestehen dürfen.

#### Scenario: Fremde Liste
- **WHEN** Organisation A eine Stelle anlegt und eine Person aus Organisation B die Liste abruft
- **THEN** fehlt die Stelle von Organisation A in der Antwort

#### Scenario: Fremde Stelle ändern
- **WHEN** der Admin von Organisation B die Stelle von Organisation A ändern will
- **THEN** antwortet der Server mit 404, und die Stelle bleibt unverändert

#### Scenario: Gleicher Name in zwei Organisationen
- **WHEN** beide Organisationen eine Stelle „Polizei“ anlegen
- **THEN** gelingen beide Anlagen

### Requirement: Deaktivieren und Reaktivieren
Der Admin SHALL eine Stelle deaktivieren und wieder aktivieren können. Eine inaktive Stelle MUST
NOT als Vorschlag erscheinen. Die meldende Stelle schon angelegter Einsätze MUST davon
unberührt bleiben.

#### Scenario: Deaktivierte Stelle verschwindet aus den Vorschlägen
- **WHEN** der Admin „Ordnungsamt“ deaktiviert
- **THEN** schlägt die Einsatzdaten-Seite „Ordnungsamt“ nicht mehr vor, und ein Einsatz mit der meldenden Stelle „Ordnungsamt“ zeigt sie weiter

#### Scenario: Reaktivieren
- **WHEN** der Admin eine inaktive Stelle wieder aktiviert
- **THEN** erscheint sie wieder in den Vorschlägen

### Requirement: Höchstens eine zuständige Leitstelle
Je Organisation SHALL höchstens eine Stelle als zuständig markiert sein, und nur eine aktive
Stelle der Art `leitstelle`. Wird eine Stelle als zuständig markiert, MUST die bisherige
Markierung in derselben Anfrage entfallen. Eine Markierung an einer anderen Art oder an einer
inaktiven Stelle MUST 422 ergeben. Deaktivieren der zuständigen Stelle MUST die Markierung
entfernen.

#### Scenario: Markierung wechselt
- **WHEN** „ILS Nord“ zuständig ist und der Admin „ILS Süd“ als zuständig markiert
- **THEN** ist danach nur „ILS Süd“ zuständig

#### Scenario: Polizei als zuständig
- **WHEN** der Admin eine Stelle der Art `polizei` als zuständig markieren will
- **THEN** antwortet der Server mit 422, und keine Markierung ändert sich

#### Scenario: Art der zuständigen Stelle ändern
- **WHEN** der Admin die Art der zuständigen Leitstelle auf `behoerde` ändern will, ohne die Markierung zu entfernen
- **THEN** antwortet der Server mit 422, und die Stelle bleibt unverändert

#### Scenario: Zuständige Stelle deaktivieren
- **WHEN** der Admin die zuständige Leitstelle deaktiviert
- **THEN** ist die Stelle inaktiv, und die Organisation hat keine zuständige Leitstelle mehr

### Requirement: Pflege unter Stammdaten
Die Verwaltung SHALL unter Stammdaten einen Katalog „Externe Stellen“ zeigen: eine Tabelle mit
Bezeichnung, Art, Rufnummer, Funkrufname, Zustand und der Marke „zuständig“, filterbar nach Art
und nach aktiv/inaktiv. Ohne Admin-Recht MUST die Seite die Pflege mit Grund gesperrt zeigen.

#### Scenario: Katalog pflegen
- **WHEN** der Admin unter Verwaltung → Stammdaten → Externe Stellen eine Stelle anlegt
- **THEN** steht sie ohne Neuladen in der Tabelle, und ein zweiter Tab derselben Organisation zeigt sie ebenfalls

#### Scenario: Ohne Recht
- **WHEN** eine Person ohne Admin-Recht den Katalog öffnet
- **THEN** sieht sie die Tabelle, aber Anlegen und Bearbeiten sind gesperrt und nennen den Grund

### Requirement: Meldende Stelle mit Vorschlägen aus dem Katalog
Die Seite Einsatzdaten SHALL bei der meldenden Stelle, in der Zeile der Leseansicht wie im
Vollformular, die aktiven externen Stellen als Vorschläge zeigen, nach Art gruppiert und mit
Teilwortsuche. Ein frei eingegebener Text MUST weiter gespeichert werden. Gespeichert MUST
genau der Text werden, ohne Verweis auf den Katalogeintrag.

#### Scenario: Stelle aus dem Katalog wählen
- **WHEN** eine schreibberechtigte Person in der Zeile „Meldende Stelle“ „mus“ tippt und „ILS Musterkreis“ aus der Gruppe „Leitstelle“ wählt
- **THEN** sendet die Seite `{ "meldende_stelle": "ILS Musterkreis" }`

#### Scenario: Freitext bleibt
- **WHEN** eine Person „Polizei vor Ort, Streife 12/3“ eingibt, das nicht im Katalog steht
- **THEN** wird genau dieser Text gespeichert

#### Scenario: Umbenennung im Katalog
- **WHEN** der Admin „ILS Musterkreis“ in „ILS Musterkreis-Nord“ umbenennt
- **THEN** zeigt ein Einsatz, dessen meldende Stelle „ILS Musterkreis“ ist, weiter „ILS Musterkreis“

### Requirement: Adressat einer Nachforderung mit Vorschlägen und zuständiger Leitstelle
Das Nachforderungsformular SHALL bei der Adressat-Bezeichnung die aktiven externen Stellen
vorschlagen; Freitext bleibt erlaubt. Ist die Kategorie „Leitstelle“ gewählt, die
Adressat-Bezeichnung leer und eine zuständige Leitstelle markiert, MUST das Feld mit deren
Bezeichnung vorbelegt sein. Ein eingegebener Wert MUST NOT überschrieben werden.

#### Scenario: Neues Formular
- **WHEN** „ILS Musterkreis“ zuständig ist und eine Person das Nachforderungsformular öffnet (Kategorie „Leitstelle“ ist Vorgabe)
- **THEN** steht in der Adressat-Bezeichnung „ILS Musterkreis“

#### Scenario: Eigene Eingabe bleibt
- **WHEN** eine Person „Leitstelle Nachbarkreis“ eingetragen hat und die Kategorie wechselt und wieder auf „Leitstelle“ stellt
- **THEN** steht weiter „Leitstelle Nachbarkreis“ im Feld

#### Scenario: Keine zuständige Leitstelle
- **WHEN** keine Stelle als zuständig markiert ist
- **THEN** bleibt die Adressat-Bezeichnung leer, und die Vorschläge bieten die aktiven Stellen an
