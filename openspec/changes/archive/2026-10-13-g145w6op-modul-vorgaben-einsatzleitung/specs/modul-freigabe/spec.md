# Spec Delta

## ADDED Requirements

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

## MODIFIED Requirements

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
