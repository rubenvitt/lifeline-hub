# Spec Delta

## MODIFIED Requirements

### Requirement: Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung

Die Einsatzleitung eines aktiven Einsatzes SHALL diesen Einsatz für einen Maschinenzugang der Org
des Einsatzes freigeben und die Freigabe wieder beenden können, sofern der Zugang nicht
widerrufen oder abgelaufen ist und einen Lese-Scope mit Einsatzbezug trägt (`lage:read`,
`einsaetze:read`). Die
Seite „Geräte“ des Einsatzes MUST diese Zugänge im Paneel „Anbindungen“ mit Name, Rechten und
Zustand zeigen. Freigabe und Ende MUST im Einsatztagebuch stehen.

#### Scenario: Freigeben
- **WHEN** die Einsatzleitung im Paneel „Anbindungen“ den Schalter des Zugangs „FüKW Monitor“ einschaltet
- **THEN** zeigt die Zeile „liest diesen Einsatz“, und das Einsatztagebuch nennt die Freigabe mit dem Namen des Zugangs und der handelnden Person

#### Scenario: Freigabe beenden
- **WHEN** die Einsatzleitung den Schalter wieder ausschaltet
- **THEN** liest der Zugang den Einsatz nicht mehr, und das Einsatztagebuch nennt das Ende der Freigabe

#### Scenario: Zugang ohne Leserecht mit Einsatzbezug
- **WHEN** ein Zugang nur `alarmmeldungen:write` trägt
- **THEN** steht er nicht im Paneel „Anbindungen“, und eine Freigabe für ihn antwortet 404

#### Scenario: Nicht die Einsatzleitung
- **WHEN** ein Mitglied ohne die Rolle Einsatzleitung oder ein System-Admin ohne Rolle im Einsatz freigeben will
- **THEN** antwortet der Server mit 403

#### Scenario: Instanz meldet sich bei einem Hub
- **WHEN** die Instanz sich für die Org bei einem Hub meldet und kein Zugang den Einsatz liest
- **THEN** zeigt das Paneel „Anbindungen“ keinen Zugang, und eine Freigabe antwortet 404

#### Scenario: Abgelehntes Umschalten an einer überholten Zeile
- **WHEN** ein Admin den einzigen Zugang des Paneels widerruft und die Einsatzleitung ihn einschaltet, bevor das Paneel nachgefragt hat
- **THEN** bleibt das Paneel mit dem Grund der Ablehnung und dem Namen des Zugangs stehen, bis die Einsatzleitung den Hinweis schließt

#### Scenario: Ohne Verbindung
- **WHEN** die Einsatzleitung ohne Verbindung zum Server ist
- **THEN** sind die Schalter gesperrt, daneben steht „Ohne Verbindung nicht änderbar“, und keine Freigabe wird vorgemerkt

#### Scenario: Zugang einer fremden Org
- **WHEN** die Einsatzleitung einen Zugang einer anderen Org freigeben will
- **THEN** antwortet der Server mit 404

#### Scenario: Abgeschlossener Einsatz
- **WHEN** jemand an einem abgeschlossenen Einsatz freigeben will
- **THEN** antwortet der Server mit 409, und die Schalter des Paneels sind gesperrt

#### Scenario: Zugang nur mit Ereignissen
- **WHEN** ein Zugang nur `events:read` trägt
- **THEN** steht er nicht im Paneel „Anbindungen“, denn allein öffnet dieses Recht keinen Einsatz

### Requirement: Die Freigabe endet mit Einsatz, Zugang oder Recht

Eine Freigabe SHALL enden, sobald der Einsatz abgeschlossen ist, der Zugang widerrufen wird, sein
„gültig bis“ verstrichen ist oder sich seine Lese-Scopes mit Einsatzbezug ändern, durch Entzug wie
durch Hinzufügen. Nach dem Ende MUST der Zugang den Einsatz nicht mehr lesen, bis die
Einsatzleitung erneut freigibt. Führt die Instanz den Einsatz, MUST dessen Einsatztagebuch
Widerruf und Änderung der Rechte nennen.

#### Scenario: Einsatzabschluss
- **WHEN** die Einsatzleitung einen freigegebenen Einsatz abschließt
- **THEN** ist für den Zugang kein Einsatz mehr freigegeben

#### Scenario: Widerruf des Zugangs
- **WHEN** ein Admin den Zugang widerruft, während er einen Einsatz liest
- **THEN** antwortet der Server dem Zugang mit 401, und das Einsatztagebuch des Einsatzes nennt den Widerruf

#### Scenario: Abgelaufen und verlängert
- **WHEN** das „gültig bis“ eines Zugangs verstreicht, während er einen Einsatz liest, und ein Admin es danach verlängert
- **THEN** ist kein Einsatz freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht entzogen und wieder erteilt
- **WHEN** ein Admin dem Zugang `lage:read` entzieht und es ihm später wieder gibt
- **THEN** ist kein Einsatz freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht mit Einsatzbezug hinzugefügt
- **WHEN** ein Admin einem Zugang, der einen Einsatz mit `einsaetze:read` liest, zusätzlich `lage:read` gibt
- **THEN** ist kein Einsatz mehr freigegeben, `GET /api/v1/lage` antwortet mit `einsatz: null`, und das Einsatztagebuch nennt die Änderung der Rechte

#### Scenario: Eines von zwei Rechten entzogen
- **WHEN** ein Admin einem Zugang mit `lage:read` und `einsaetze:read` eines der beiden nimmt
- **THEN** ist kein Einsatz mehr freigegeben, bis die Einsatzleitung erneut freigibt

#### Scenario: Recht ohne Einsatzbezug geändert
- **WHEN** ein Admin einem Zugang, der einen Einsatz liest, `rechner:use` gibt oder nimmt
- **THEN** bleibt die Freigabe bestehen
