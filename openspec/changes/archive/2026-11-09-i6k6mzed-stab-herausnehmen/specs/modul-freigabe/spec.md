# Spec Delta

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
- **WHEN** die Organisation das Modul `infotelefon` ausblendet und der Einsatz für `infotelefon` keinen eigenen Wert hat
- **THEN** lautet der Eintrag `infotelefon` für ein Mitglied `sichtbar: false, zugriff: false`

#### Scenario: Organisation blendet aus, Einsatz zeigt
- **WHEN** die Organisation das Modul `infotelefon` ausblendet und der Einsatz `infotelefon` ausdrücklich sichtbar stellt
- **THEN** lautet der Eintrag `infotelefon` `sichtbar: true`

#### Scenario: Organisation ohne Vorgabe, Einsatz blendet aus
- **WHEN** die Organisation für `infotelefon` keine Sichtbarkeit vorgibt und der Einsatz `infotelefon` ausblendet
- **THEN** lautet der Eintrag `infotelefon` `sichtbar: false`

#### Scenario: Override nur mit Rolle
- **WHEN** die Organisation das Modul `infotelefon` ausblendet und der Einsatz für `infotelefon` nur eine benötigte Rolle ohne eigene Sichtbarkeit trägt
- **THEN** lautet der Eintrag `infotelefon` `sichtbar: false`

#### Scenario: Vorgabe wirkt auf laufende Einsätze
- **WHEN** die Organisation das Modul `infotelefon` ausblendet, während ein Einsatz ohne eigenen Wert für `infotelefon` läuft
- **THEN** liefert der nächste Abruf der Freigaben dieses Einsatzes `infotelefon` mit `sichtbar: false`

#### Scenario: Nicht ausblendbares Modul trotz Vorgabe
- **WHEN** in der Datenbank eine Vorgabe der Organisation steht, die `einsatzdaten` ausblendet
- **THEN** lautet der Eintrag `einsatzdaten` `sichtbar: true, zugriff: true`

### Requirement: Eine Einsatz-Vorlage schreibt eigene Einsatzwerte
Wird ein Einsatz mit einer Einsatz-Vorlage angelegt (Spec `einsatz-vorlagen`), MUST das System für
jedes Modul, das die Vorlage ausblendet, beim Anlegen einen eigenen Einsatzwert `sichtbar: false`
ohne benötigte Rolle speichern, so als hätte die Einsatzleitung den Schalter selbst umgelegt.
Module, die die Vorlage nicht ausblendet, MUST ohne eigenen Wert bleiben und der Vorgabe der
Organisation folgen; eine Vorlage blendet nie ein.

#### Scenario: Vorlage beim Anlegen
- **WHEN** ein Einsatz mit einer Vorlage angelegt wird, die `infotelefon` ausblendet
- **THEN** liefert `GET /api/einsaetze/{id}/modul-overrides` für `infotelefon` `sichtbar: false`, und der Eintrag `infotelefon` der Freigaben lautet `sichtbar: false`

### Requirement: Ein Einsatz-Override kann die Sichtbarkeit offen lassen
Der Schreibweg eines Modul-Overrides im Einsatz MUST für `sichtbar` die Werte `true`, `false` und
`null` annehmen. `null` MUST bedeuten, dass der Einsatz die Sichtbarkeit erbt. Das Lesen der
Overrides MUST den gespeicherten eigenen Wert liefern, ohne Wert `null`. `sichtbar: false` für
ein nicht ausblendbares Modul MUST das System mit HTTP 400 abweisen.

#### Scenario: Nur die Rolle setzen
- **WHEN** eine Einsatzleitung den Override des Moduls `schaeden` mit `sichtbar: null, benoetigte_rolle: "einsatzfuehrung"` speichert
- **THEN** antwortet das System mit HTTP 200, der Override trägt `sichtbar: null`, und die Sichtbarkeit von `schaeden` folgt der Vorgabe der Organisation

#### Scenario: Eigenen Wert zurücknehmen
- **WHEN** der Einsatz `infotelefon` ausblendet und die Einsatzleitung den Override mit `sichtbar: null` speichert
- **THEN** gilt für `infotelefon` wieder die Vorgabe der Organisation, ohne Vorgabe ist es sichtbar

#### Scenario: Nicht ausblendbares Modul
- **WHEN** jemand den Override von `einsatzdaten` mit `sichtbar: false` speichern will
- **THEN** antwortet das System mit HTTP 400, und es wird nichts gespeichert

#### Scenario: Bestand vor dieser Änderung
- **WHEN** ein Einsatz vor dieser Änderung einen Override `schaeden` mit „sichtbar“ und einer Rolle trug und die Organisation danach `schaeden` ausblendet
- **THEN** ist `schaeden` in diesem Einsatz ausgeblendet, und die Rolle bleibt erhalten

#### Scenario: Ausblendung aus dem Bestand
- **WHEN** ein Einsatz vor dieser Änderung `meldungen` ausgeblendet hatte
- **THEN** bleibt `meldungen` dort ausgeblendet, auch ohne Vorgabe der Organisation

### Requirement: Die Organisation gibt die Sichtbarkeit je Modul vor
Das System MUST je Organisation und ausblendbarem Modul eine Sichtbarkeits-Vorgabe führen:
ausgeblendet oder sichtbar, ohne Eintrag sichtbar. `GET /api/org-modul-einstellungen` MUST sie je
Modul zusammen mit der Rollen-Vorgabe liefern. Ändern MUST nur der System-Admin über
`PUT /api/org-modul-einstellungen/{modul_key}`, andere erhalten HTTP 403.

#### Scenario: Vorgabe setzen
- **WHEN** ein System-Admin die Vorgabe des Moduls `infotelefon` mit `sichtbar: false` speichert
- **THEN** antwortet das System mit HTTP 200, und der nächste Abruf der Vorgaben liefert für `infotelefon` `sichtbar: false`

#### Scenario: Ohne Vorgabe
- **WHEN** die Organisation für `etb` nichts vorgibt
- **THEN** fehlt `etb` in der Antwort der Vorgaben oder trägt `sichtbar: true`

#### Scenario: Führungskraft ohne Admin-Rechte
- **WHEN** eine Führungskraft der Organisation ohne Admin-Rechte die Sichtbarkeits-Vorgabe ändern will
- **THEN** antwortet das System mit HTTP 403, und die Vorgabe bleibt unverändert

#### Scenario: Nur die Rolle ändern
- **WHEN** die Organisation `infotelefon` ausblendet und ein System-Admin die Vorgabe von `infotelefon` nur mit `benoetigte_rolle` ohne das Feld `sichtbar` speichert
- **THEN** bleibt `infotelefon` ausgeblendet

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
- **WHEN** die Organisation `infotelefon` ausblendet, der Einsatz keinen eigenen Wert hat und die Einsatzleitung den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Informationstelefon“ aus, darunter „Vorgabe der Organisation: ausgeblendet“, und „Vorgabe übernehmen“ fehlt

#### Scenario: Überstimmen
- **WHEN** die Einsatzleitung in diesem Zustand den Schalter von „Informationstelefon“ einlegt
- **THEN** speichert der Editor `sichtbar: true` als eigenen Wert, „Informationstelefon“ erscheint in der Navigation, und die Zeile bietet „Vorgabe übernehmen“ an

#### Scenario: Vorgabe übernehmen
- **WHEN** die Einsatzleitung danach „Vorgabe übernehmen“ wählt
- **THEN** speichert der Editor `sichtbar: null`, und der Schalter steht wieder aus

#### Scenario: Einsatzleitung ohne Leserecht auf die Org-Vorgaben
- **WHEN** die Organisation `infotelefon` ausblendet, der Einsatz keinen eigenen Wert hat und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Informationstelefon“ aus, und darunter steht „Vorgabe der Organisation: ausgeblendet“

#### Scenario: Einsatzleitung ohne Org-Rolle bei eigenem Wert
- **WHEN** die Organisation `infotelefon` ausblendet, der Einsatz `infotelefon` mit eigenem Wert einblendet und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht der Schalter von „Informationstelefon“ an, darunter „Vorgabe der Organisation: ausgeblendet“ und „Vorgabe übernehmen“

#### Scenario: Rollen-Hinweis ohne Org-Rolle
- **WHEN** die Organisation für `lagemeldungen` die Rolle „Führung im Einsatz“ vorgibt und eine Einsatzleitung ohne Org-Rolle den Editor „Module“ öffnet
- **THEN** steht in der Zeile „Lagemeldungen“ „Vorgabe der Organisation: Führung im Einsatz“, wie bei einem System-Admin

#### Scenario: Rolle ändern bei geerbter Sichtbarkeit
- **WHEN** die Organisation `infotelefon` ausblendet, der Einsatz keinen eigenen Wert hat und die Einsatzleitung die benötigte Rolle von „Informationstelefon“ ändert
- **THEN** speichert der Editor `sichtbar: null`, und „Informationstelefon“ bleibt ausgeblendet

### Requirement: Die Verwaltung pflegt Module für alle Einsätze
Die Seite „Einsatz-Vorgaben“ der Verwaltung MUST ein Paneel „Module für alle Einsätze“ zeigen, das
je Modul den Schalter „Sichtbar“ und die Rollen-Vorgabe führt. Das Paneel MUST den Hinweis tragen,
dass die Vorgaben auf alle Einsätze ohne eigene Einstellung wirken, auch auf laufende. Bedienen
MUST nur der System-Admin, nicht ausblendbare Module MUST mit gesperrtem Schalter erscheinen.

#### Scenario: Modul ausblenden
- **WHEN** ein System-Admin im Paneel „Module für alle Einsätze“ den Schalter „Sichtbar“ von „Informationstelefon“ auslegt
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
- **WHEN** die Organisation `infotelefon` ausblendet und für `lagemeldungen` die Rolle `einsatzfuehrung` vorgibt und eine Einsatzleitung ohne Org-Rolle die Modul-Vorgaben ihres Einsatzes abruft
- **THEN** antwortet das System mit HTTP 200 und liefert für `infotelefon` `sichtbar: false` und für `lagemeldungen` `benoetigte_rolle: "einsatzfuehrung"`

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

## ADDED Requirements

### Requirement: Das Informationstelefon übernimmt die Freigaben des Stabs
Beim Update MUST das System jede für `stab` gespeicherte Sichtbarkeit und benötigte Rolle, je
Einsatz und je Organisation, als Wert von `infotelefon` übernehmen und danach jeden Wert für `stab`
entfernen. Ohne Wert für `stab` MUST `infotelefon` ohne Wert bleiben. Danach MUST keine Antwort
der Freigaben, Overrides oder Modul-Vorgaben einen Eintrag `stab` enthalten.

#### Scenario: Ausgeblendeter Stab im Einsatz
- **WHEN** ein Einsatz vor dem Update `stab` mit eigenem Wert ausgeblendet hatte
- **THEN** liefert `GET /api/einsaetze/{id}/modul-overrides` danach für `infotelefon` `sichtbar: false`, und die Freigaben des Einsatzes enthalten keinen Eintrag `stab`

#### Scenario: Rollen-Vorgabe der Organisation
- **WHEN** die Organisation vor dem Update `stab` auf `einsatzfuehrung` beschränkt hatte
- **THEN** liefert `GET /api/org-modul-einstellungen` danach für `infotelefon` `benoetigte_rolle: "einsatzfuehrung"` und keinen Eintrag `stab`

#### Scenario: Ohne Wert für den Stab
- **WHEN** weder der Einsatz noch die Organisation vor dem Update einen Wert für `stab` hatten
- **THEN** lautet der Eintrag `infotelefon` der Freigaben für ein Mitglied `sichtbar: true, zugriff: true`

### Requirement: Alte Adressen des Stabs führen in den Einsatz
Die Adressen `/einsaetze/:id/stab`, `/einsaetze/:id/stab/presse` und
`/einsaetze/:id/stab/presse/mitteilungen/:mid` MUST auf den Einsatz (`/einsaetze/:id`) umleiten,
ohne eigene Hinweisseite. Die Altadressen des Fernmeldewesens und des Informationstelefons leiten
weiter auf ihr Modul.

#### Scenario: Lesezeichen auf die Pressearbeit
- **WHEN** eine Person mit Lesezugriff `/einsaetze/7/stab/presse` aufruft
- **THEN** zeigt die App den Einsatz 7 und nicht die Einsatzliste

### Requirement: Modulroute, Unterroute und Altadresse ohne Zugriff zeigen einen einheitlichen Hinweis

Öffnet ein Benutzer eine Route, die zu einem Modul gehört, oder eine ihrer Unterrouten, und
melden die Freigaben des Servers für dieses Modul `zugriff: false`, MUST der Einsatzrahmen statt
der Modulseite einen einheitlichen Hinweis zeigen. Die Modulseite MUST dabei nicht gerendert
werden und MUST keine Anfrage an den Listen-Endpunkt des Moduls stellen. Die Navigation des
Einsatzes bleibt bedienbar.

#### Scenario: Deeplink in ein gesperrtes Modul
- **WHEN** die Org-Vorgabe das Modul `lagemeldungen` auf Führungskräfte beschränkt und ein normales Mitglied `/einsaetze/:id/lagemeldungen` direkt aufruft
- **THEN** zeigt der Inhaltsbereich den Hinweis mit „Lagemeldungen“ und „Keine Berechtigung“, es geht keine Anfrage an die Liste der Lagemeldungen, und die Navigation steht daneben

#### Scenario: Unterroute eines gesperrten Moduls
- **WHEN** das Modul `fernmeldewesen` für den Benutzer `zugriff: false` hat und er `/einsaetze/:id/fernmeldewesen/kommunikationsplan` aufruft
- **THEN** zeigt der Rahmen denselben Hinweis für „Fernmeldewesen“

#### Scenario: Altadresse eines gesperrten Moduls
- **WHEN** das Modul `infotelefon` für den Benutzer `zugriff: false` hat und er `/einsaetze/:id/stab/infotelefon` aufruft
- **THEN** zeigt der Rahmen denselben Hinweis für „Informationstelefon“

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

#### Scenario: Grund im Hinweis
- **WHEN** der Hinweis für ein Modul erscheint, das sichtbar, aber für die Rolle des Benutzers gesperrt ist
- **THEN** nennt er das Modul und als Grund „für deine Rolle nicht freigegeben“; bei `sichtbar: false` lautet der Grund „ausgeblendet“

#### Scenario: Einsatzdaten und Einsatzeinstellungen ohne Ladezustand
- **WHEN** ein Benutzer `einsatzdaten` oder `einsatz-einstellungen` öffnet und die Freigaben noch nicht geantwortet haben
- **THEN** zeigt der Rahmen für sie keinen Ladezustand

#### Scenario: Freigaben ruhen ohne Netz
- **WHEN** der Abruf der Freigaben ohne Netz ruht
- **THEN** rendert der Rahmen die Modulseite unverändert

## REMOVED Requirements

### Requirement: Eine Modulroute ohne Zugriff zeigt einen einheitlichen Hinweis
**Reason**: Das Modul Stab samt Presse und Medienarbeit (S5) entfällt (LLH-722, Entscheidung 08.11.2026; design.md D1). Das Szenario „Unterroute eines gesperrten Stabs“ setzt den Modul-Key `stab` voraus; an seine Stelle tritt die Altadresse des Informationstelefons (design.md D3, D8). OpenSpec erlaubt nicht, das Szenario in einem MODIFIED-Block wegzulassen oder umzubenennen.
**Migration**: Das Verhalten gilt unverändert unter „Modulroute, Unterroute und Altadresse ohne Zugriff zeigen einen einheitlichen Hinweis“. Die Beschreibung ist gekürzt; Grund, Rückweg, Ladezustand und Rückfall stehen dort als Szenarien.
