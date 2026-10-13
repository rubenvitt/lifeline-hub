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
`sichtbar` MUST für ein ausblendbares Modul aus dem eigenen Wert des Einsatzes folgen, fehlt er,
aus der Sichtbarkeits-Vorgabe der Organisation, fehlt auch sie, `true`. Für nicht ausblendbare
Module MUST `sichtbar` immer `true` sein. Für System-Admins gilt dieselbe Sichtbarkeit. Ein
ausgeblendetes Modul bleibt für sie erreichbar (`zugriff: true`), erscheint aber in keiner
Navigation.

#### Scenario: Ausgeblendetes Modul für ein Mitglied
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein Mitglied ohne Admin-Rechte anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: false`

#### Scenario: Ausgeblendetes Modul für einen System-Admin
- **WHEN** der Einsatz das Modul `meldungen` ausblendet und ein System-Admin anfragt
- **THEN** lautet der Eintrag `meldungen` `sichtbar: false, zugriff: true`

#### Scenario: Organisation blendet aus, Einsatz ohne eigenen Wert
- **WHEN** die Organisation das Modul `stab` ausblendet und der Einsatz für `stab` keinen eigenen Wert hat
- **THEN** lautet der Eintrag `stab` für ein Mitglied `sichtbar: false, zugriff: false`

#### Scenario: Organisation blendet aus, Einsatz zeigt
- **WHEN** die Organisation das Modul `stab` ausblendet und der Einsatz `stab` ausdrücklich sichtbar stellt
- **THEN** lautet der Eintrag `stab` `sichtbar: true`

#### Scenario: Organisation ohne Vorgabe, Einsatz blendet aus
- **WHEN** die Organisation für `stab` keine Sichtbarkeit vorgibt und der Einsatz `stab` ausblendet
- **THEN** lautet der Eintrag `stab` `sichtbar: false`

#### Scenario: Override nur mit Rolle
- **WHEN** die Organisation das Modul `stab` ausblendet und der Einsatz für `stab` nur eine benötigte Rolle ohne eigene Sichtbarkeit trägt
- **THEN** lautet der Eintrag `stab` `sichtbar: false`

#### Scenario: Vorgabe wirkt auf laufende Einsätze
- **WHEN** die Organisation das Modul `stab` ausblendet, während ein Einsatz ohne eigenen Wert für `stab` läuft
- **THEN** liefert der nächste Abruf der Freigaben dieses Einsatzes `stab` mit `sichtbar: false`

#### Scenario: Nicht ausblendbares Modul trotz Vorgabe
- **WHEN** in der Datenbank eine Vorgabe der Organisation steht, die `einsatzdaten` ausblendet
- **THEN** lautet der Eintrag `einsatzdaten` `sichtbar: true, zugriff: true`

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

#### Scenario: Sichtbarkeits-Vorgabe gesetzt
- **WHEN** ein System-Admin in der Verwaltung ein Modul für alle Einsätze ausblendet und danach einen Einsatz ohne eigenen Wert dafür öffnet
- **THEN** fehlt das Modul in der Navigation dieses Einsatzes, ohne dass er die Seite neu lädt

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

### Requirement: Die Rollensperre „Führung im Einsatz“ bezieht die Einsatzrolle ein
Steht die effektive benötigte Rolle eines Moduls auf `einsatzfuehrung`, MUST `zugriff` genau dann
`true` sein, wenn der Benutzer System-Admin ist, org-weite Führungskraft ist oder im Einsatz die
Rolle Einsatzleitung oder Führungspersonal trägt. Beobachter und Benutzer ohne Rolle im Einsatz
MUST keinen Zugriff erhalten. Die Stufe `fuehrungskraft` MUST unverändert nur die Org-Rolle prüfen.

#### Scenario: Einsatzleitung ohne Org-Rolle
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und eine Einsatzleitung ohne Org-Rolle „Führungskraft“ die Freigaben abruft
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`, und der Listen-Endpunkt der Schäden antwortet ihr mit HTTP 200

#### Scenario: Führungspersonal
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und ein Mitglied mit der Einsatzrolle Führungspersonal anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Beobachter
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und ein Beobachter ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: false`, und der Listen-Endpunkt der Schäden antwortet ihm mit HTTP 403

#### Scenario: Org-Führungskraft ohne Mitgliedschaft
- **WHEN** der Einsatz das Modul `schaeden` auf `einsatzfuehrung` beschränkt und eine org-weite Führungskraft der Einsatz-Org ohne Mitgliedschaft anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Org-Vorgabe mit der neuen Stufe
- **WHEN** die Org-Vorgabe `schaeden` auf `einsatzfuehrung` beschränkt, der Einsatz keinen Override dafür hat und eine Einsatzleitung ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: true`

#### Scenario: Bestehende Stufe bleibt
- **WHEN** der Einsatz das Modul `schaeden` auf `fuehrungskraft` beschränkt und eine Einsatzleitung ohne Org-Rolle anfragt
- **THEN** lautet der Eintrag `schaeden` `zugriff: false` wie bisher

### Requirement: Ein gekoppeltes Gerät zählt nicht als Führung im Einsatz
Ein gekoppeltes Gerät MUST die Stufe `einsatzfuehrung` nicht passieren, auch wenn seine
Funktionsansicht im Einsatz schreiben darf. Die Modulsperren, die die Geräteverwaltung je
Funktionsansicht nennt, MUST ein auf `einsatzfuehrung` beschränktes Modul als gesperrt führen.

#### Scenario: UHS-Tablet
- **WHEN** der Einsatz das Modul `personen` auf `einsatzfuehrung` beschränkt und ein als UHS-Tablet gekoppeltes Gerät die Personenliste abruft
- **THEN** antwortet das System mit HTTP 403

#### Scenario: Geräteverwaltung nennt die Sperre
- **WHEN** der Einsatz das Modul `personen` auf `einsatzfuehrung` beschränkt und die Einsatzleitung die Geräteliste abruft
- **THEN** führt die Sperrliste jeder Ansicht, die `personen` liest, das Modul `personen`

### Requirement: Der Server nimmt genau die bekannten Rollenwerte an
Der Schreibweg eines Modul-Overrides im Einsatz und der Schreibweg der Org-Vorgabe MUST als
benötigte Rolle genau `admin`, `fuehrungskraft`, `einsatzfuehrung` oder keinen Wert (frei)
annehmen. Jeden anderen Wert MUST das System mit HTTP 400 abweisen, ohne etwas zu speichern.

#### Scenario: Neue Stufe im Einsatz setzen
- **WHEN** eine Einsatzleitung den Override des Moduls `schaeden` mit `benoetigte_rolle: "einsatzfuehrung"` speichert
- **THEN** antwortet das System mit HTTP 200, und der Override trägt `einsatzfuehrung`

#### Scenario: Neue Stufe als Org-Vorgabe
- **WHEN** ein System-Admin die Org-Vorgabe des Moduls `schaeden` auf `einsatzfuehrung` setzt
- **THEN** antwortet das System mit HTTP 200, und die Vorgabe trägt `einsatzfuehrung`

#### Scenario: Unbekannter Wert
- **WHEN** jemand einen Override mit `benoetigte_rolle: "einsatzleitung"` speichern will
- **THEN** antwortet das System mit HTTP 400, und der bisherige Override bleibt unverändert

### Requirement: Die Einstellungsseiten benennen die Rollenstufen eindeutig
Die Auswahl der benötigten Rolle im Editor „Module“ des Einsatzes und im Paneel „Module für alle
Einsätze“ der Organisation MUST die Stufen in dieser Reihenfolge anbieten: „Frei (alle)“,
„Führung im Einsatz“, „Führungskraft der Organisation“, „Admin“. Der Hinweis auf eine
Org-Vorgabe im Editor des Einsatzes MUST dieselben Namen verwenden. Kein Name MUST in der
Rollenspalte abgeschnitten erscheinen.

#### Scenario: Auswahl im Einsatz
- **WHEN** eine Einsatzleitung im Editor „Module“ die Auswahl der benötigten Rolle eines Moduls öffnet
- **THEN** stehen dort „Frei (alle)“, „Führung im Einsatz“, „Führungskraft der Organisation“ und „Admin“ in dieser Reihenfolge

#### Scenario: Hinweis auf die Org-Vorgabe
- **WHEN** die Org-Vorgabe ein Modul auf `einsatzfuehrung` beschränkt und der Einsatz keinen Override dafür hat
- **THEN** nennt der Editor „Module“ beim Modul „Vorgabe der Organisation: Führung im Einsatz“

#### Scenario: Gespeicherte Altwerte
- **WHEN** ein Override aus der Zeit vor dieser Änderung `fuehrungskraft` trägt
- **THEN** zeigt die Auswahl „Führungskraft der Organisation“

### Requirement: Ein Einsatz-Override kann die Sichtbarkeit offen lassen
Der Schreibweg eines Modul-Overrides im Einsatz MUST für `sichtbar` die Werte `true`, `false` und
`null` annehmen. `null` MUST bedeuten, dass der Einsatz die Sichtbarkeit erbt. Das Lesen der
Overrides MUST den gespeicherten eigenen Wert liefern, ohne Wert `null`. `sichtbar: false` für
ein nicht ausblendbares Modul MUST das System mit HTTP 400 abweisen.

#### Scenario: Nur die Rolle setzen
- **WHEN** eine Einsatzleitung den Override des Moduls `schaeden` mit `sichtbar: null, benoetigte_rolle: "einsatzfuehrung"` speichert
- **THEN** antwortet das System mit HTTP 200, der Override trägt `sichtbar: null`, und die Sichtbarkeit von `schaeden` folgt der Vorgabe der Organisation

#### Scenario: Eigenen Wert zurücknehmen
- **WHEN** der Einsatz `stab` ausblendet und die Einsatzleitung den Override mit `sichtbar: null` speichert
- **THEN** gilt für `stab` wieder die Vorgabe der Organisation, ohne Vorgabe ist es sichtbar

#### Scenario: Nicht ausblendbares Modul
- **WHEN** jemand den Override von `einsatzdaten` mit `sichtbar: false` speichern will
- **THEN** antwortet das System mit HTTP 400, und es wird nichts gespeichert

#### Scenario: Bestand vor dieser Änderung
- **WHEN** ein Einsatz vor dieser Änderung einen Override `stab` mit „sichtbar“ und einer Rolle trug und die Organisation danach `stab` ausblendet
- **THEN** ist `stab` in diesem Einsatz ausgeblendet, und die Rolle bleibt erhalten

#### Scenario: Ausblendung aus dem Bestand
- **WHEN** ein Einsatz vor dieser Änderung `meldungen` ausgeblendet hatte
- **THEN** bleibt `meldungen` dort ausgeblendet, auch ohne Vorgabe der Organisation

### Requirement: Die Organisation gibt die Sichtbarkeit je Modul vor
Das System MUST je Organisation und ausblendbarem Modul eine Sichtbarkeits-Vorgabe führen:
ausgeblendet oder sichtbar, ohne Eintrag sichtbar. `GET /api/org-modul-einstellungen` MUST sie je
Modul zusammen mit der Rollen-Vorgabe liefern. Ändern MUST nur der System-Admin über
`PUT /api/org-modul-einstellungen/{modul_key}`, andere erhalten HTTP 403.

#### Scenario: Vorgabe setzen
- **WHEN** ein System-Admin die Vorgabe des Moduls `stab` mit `sichtbar: false` speichert
- **THEN** antwortet das System mit HTTP 200, und der nächste Abruf der Vorgaben liefert für `stab` `sichtbar: false`

#### Scenario: Ohne Vorgabe
- **WHEN** die Organisation für `etb` nichts vorgibt
- **THEN** fehlt `etb` in der Antwort der Vorgaben oder trägt `sichtbar: true`

#### Scenario: Führungskraft ohne Admin-Rechte
- **WHEN** eine Führungskraft der Organisation ohne Admin-Rechte die Sichtbarkeits-Vorgabe ändern will
- **THEN** antwortet das System mit HTTP 403, und die Vorgabe bleibt unverändert

#### Scenario: Nur die Rolle ändern
- **WHEN** die Organisation `stab` ausblendet und ein System-Admin die Vorgabe von `stab` nur mit `benoetigte_rolle` ohne das Feld `sichtbar` speichert
- **THEN** bleibt `stab` ausgeblendet

#### Scenario: Ungültiger Wert
- **WHEN** ein System-Admin die Vorgabe mit `sichtbar: "nein"` speichern will
- **THEN** antwortet das System mit HTTP 400, und die Vorgabe bleibt unverändert

#### Scenario: Nicht ausblendbares Modul
- **WHEN** ein System-Admin die Vorgabe von `einsatz-einstellungen` mit `sichtbar: false` speichern will
- **THEN** antwortet das System mit HTTP 400, und es wird nichts gespeichert

### Requirement: Der Editor „Module“ zeigt den wirksamen Wert und seine Herkunft
Der Schalter „Sichtbar“ im Editor „Module“ des Einsatzes MUST den wirksamen Wert zeigen. Blendet
die Organisation ein Modul aus, MUST darunter gedämpft „Vorgabe der Organisation: ausgeblendet“
stehen, auch wenn der Einsatz einen eigenen Wert trägt und unabhängig von der Org-Rolle der
Person, die den Editor öffnet. Umlegen MUST einen eigenen Wert speichern, „Vorgabe übernehmen“
(bei eigenem Wert) ihn zurücknehmen. Eine Rollenänderung MUST den eigenen Wert unverändert lassen.

#### Scenario: Geerbte Ausblendung
- **WHEN** die Organisation `stab` ausblendet, der Einsatz keinen eigenen Wert hat und die Einsatzleitung den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Stab“ aus, darunter „Vorgabe der Organisation: ausgeblendet“, und „Vorgabe übernehmen“ fehlt

#### Scenario: Überstimmen
- **WHEN** die Einsatzleitung in diesem Zustand den Schalter von „Stab“ einlegt
- **THEN** speichert der Editor `sichtbar: true` als eigenen Wert, „Stab“ erscheint in der Navigation, und die Zeile bietet „Vorgabe übernehmen“ an

#### Scenario: Vorgabe übernehmen
- **WHEN** die Einsatzleitung danach „Vorgabe übernehmen“ wählt
- **THEN** speichert der Editor `sichtbar: null`, und der Schalter steht wieder aus

#### Scenario: Einsatzleitung ohne Leserecht auf die Org-Vorgaben
- **WHEN** die Organisation `stab` ausblendet, der Einsatz keinen eigenen Wert hat und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Stab“ aus, und darunter steht „Vorgabe der Organisation: ausgeblendet“

#### Scenario: Einsatzleitung ohne Org-Rolle bei eigenem Wert
- **WHEN** die Organisation `stab` ausblendet, der Einsatz `stab` mit eigenem Wert einblendet und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Stab“ an, darunter „Vorgabe der Organisation: ausgeblendet“ und „Vorgabe übernehmen“

#### Scenario: Rollen-Hinweis ohne Org-Rolle
- **WHEN** die Organisation für `lagemeldungen` die Rolle „Führung im Einsatz“ vorgibt und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht in der Zeile „Lagemeldungen“ „Vorgabe der Organisation: Führung im Einsatz“, wie bei einem System-Admin

#### Scenario: Rolle ändern bei geerbter Sichtbarkeit
- **WHEN** die Organisation `stab` ausblendet, der Einsatz keinen eigenen Wert hat und die Einsatzleitung die benötigte Rolle von „Stab“ ändert
- **THEN** speichert der Editor `sichtbar: null`, und „Stab“ bleibt ausgeblendet

### Requirement: Die Verwaltung pflegt Module für alle Einsätze
Die Seite „Einsatz-Vorgaben“ der Verwaltung MUST ein Paneel „Module für alle Einsätze“ zeigen, das
je Modul den Schalter „Sichtbar“ und die Rollen-Vorgabe führt. Das Paneel MUST den Hinweis tragen,
dass die Vorgaben auf alle Einsätze ohne eigene Einstellung wirken, auch auf laufende. Bedienen
MUST nur der System-Admin, nicht ausblendbare Module MUST mit gesperrtem Schalter erscheinen.

#### Scenario: Modul ausblenden
- **WHEN** ein System-Admin im Paneel „Module für alle Einsätze“ den Schalter „Sichtbar“ von „Stab“ auslegt
- **THEN** speichert die Seite die Vorgabe sofort, meldet „Modul-Vorgabe gespeichert“, und der Schalter steht aus

#### Scenario: Hinweis
- **WHEN** jemand das Paneel öffnet
- **THEN** steht dort, dass die Vorgaben auf alle Einsätze ohne eigene Einstellung wirken, auch auf laufende

#### Scenario: Führungskraft liest nur
- **WHEN** eine Führungskraft der Organisation ohne Admin-Rechte das Paneel öffnet
- **THEN** sind Schalter und Auswahl gesperrt

### Requirement: Der Einsatz liefert die Modul-Vorgaben seiner Organisation
`GET /api/einsaetze/{id}/modul-vorgaben` MUST die Modul-Vorgaben der Organisation des Einsatzes
liefern, je Modul `{ benoetigte_rolle, sichtbar }` wie `GET /api/org-modul-einstellungen`. Lesen
MUST dürfen, wer den Einsatz lesen darf und Mitglied des Einsatzes oder Angehöriger seiner
Organisation ist; andere und ein gekoppeltes Gerät MUST HTTP 403 erhalten. Ein Leserecht auf
andere Org-Einstellungen MUST daraus nicht folgen.

#### Scenario: Einsatzleitung ohne Org-Rolle
- **WHEN** die Organisation `stab` ausblendet und für `lagemeldungen` die Rolle `einsatzfuehrung` vorgibt und eine Einsatzleitung ohne Org-Rolle die Modul-Vorgaben ihres Einsatzes abruft
- **THEN** antwortet das System mit HTTP 200 und liefert für `stab` `sichtbar: false` und für `lagemeldungen` `benoetigte_rolle: "einsatzfuehrung"`

#### Scenario: Org-Endpunkt bleibt verschlossen
- **WHEN** dieselbe Einsatzleitung `GET /api/org-modul-einstellungen` oder `GET /api/org-einstellungen` abruft
- **THEN** antwortet das System mit HTTP 403

#### Scenario: Ohne Zugang zum Einsatz
- **WHEN** ein Benutzer ohne Lesezugang zum Einsatz dessen Modul-Vorgaben abruft
- **THEN** antwortet das System mit HTTP 403

#### Scenario: System-Admin einer fremden Organisation
- **WHEN** ein System-Admin einer anderen Organisation, der nicht Mitglied des Einsatzes ist, dessen Modul-Vorgaben abruft
- **THEN** antwortet das System mit HTTP 403, obwohl er die Modul-Overrides des Einsatzes lesen darf

#### Scenario: Mitglied aus einer fremden Organisation
- **WHEN** ein Benutzer einer anderen Organisation als Einsatzleitung Mitglied des Einsatzes ist und dessen Modul-Vorgaben abruft
- **THEN** antwortet das System mit HTTP 200 und liefert die Vorgaben der Organisation des Einsatzes

#### Scenario: Gekoppeltes Gerät
- **WHEN** ein gekoppeltes Gerät die Modul-Vorgaben seines Einsatzes abruft
- **THEN** antwortet das System mit HTTP 403
