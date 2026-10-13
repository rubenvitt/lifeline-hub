## MODIFIED Requirements

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

## ADDED Requirements

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
stehen; ohne Leserecht auf die Org-Vorgaben nur, solange der Einsatz keinen eigenen Wert trägt.
Umlegen MUST einen eigenen Wert speichern, „Vorgabe übernehmen“ (bei eigenem Wert) ihn
zurücknehmen. Eine Rollenänderung MUST den eigenen Wert unverändert lassen.

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
