# Spec Delta

## ADDED Requirements

### Requirement: Einsatzbezogenes Lesen braucht die Freigabe der Einsatzleitung

Die Einsatzleitung eines aktiven Einsatzes SHALL diesen Einsatz für einen Maschinenzugang der Org
des Einsatzes freigeben und die Freigabe wieder beenden können, sofern der Zugang nicht
widerrufen oder abgelaufen ist und einen Lese-Scope mit Einsatzbezug trägt (`lage:read`). Die
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

### Requirement: Ein Zugang liest höchstens einen Einsatz

Für einen Maschinenzugang MUST höchstens ein Einsatz freigegeben sein. Gibt die Einsatzleitung
einen zweiten Einsatz für denselben Zugang frei, SHALL die frühere Freigabe enden. Das
Einsatztagebuch des neuen Einsatzes MUST die Freigabe nennen, das des früheren die Umstellung,
sofern die Instanz ihn führt oder die handelnde Person dort zur Führung gehört. Ein Einsatz kann
für mehrere Zugänge freigegeben sein.

#### Scenario: Umstellen
- **WHEN** der Zugang den Einsatz A liest und die Einsatzleitung des Einsatzes B ihn dort einschaltet
- **THEN** liest der Zugang nur noch den Einsatz B, im Paneel des Einsatzes A steht „liest einen anderen Einsatz“, und beide Einsatztagebücher nennen die Umstellung

#### Scenario: Früherer Einsatz ist ein Spiegel ohne Rolle der Person
- **WHEN** der Zugang einen gespiegelten Einsatz liest und eine Einsatzleitung ohne Rolle in diesem Einsatz ihn an ihrem eigenen Einsatz einschaltet
- **THEN** liest der Zugang den neuen Einsatz, und für den früheren entsteht kein Antrag

#### Scenario: Zwei Zugänge an einem Einsatz
- **WHEN** die Einsatzleitung denselben Einsatz für zwei Zugänge freigibt
- **THEN** lesen beide Zugänge diesen Einsatz

### Requirement: Eine Freigabe ruht, solange die Instanz sich bei einem Hub meldet

Liest ein Zugang einen Einsatz und meldet sich die Instanz danach für die Org bei einem Hub,
SHALL die Freigabe bestehen bleiben und nach dem Ende der Kopplung wieder gelten. Solange die
Kopplung besteht, MUST das Paneel „Anbindungen“ des Einsatzes diesen Zugang mit „Freigabe ruht:
Instanz meldet sich bei einem Hub“ zeigen, und die Einsatzleitung MUST die Freigabe dort beenden
können. Eine neue Freigabe MUST NOT möglich sein, solange die Kopplung besteht.

#### Scenario: Kopplung bei bestehender Freigabe
- **WHEN** der Zugang „FüKW Monitor“ den Einsatz liest und die Instanz sich danach für die Org bei einem Hub meldet
- **THEN** antwortet der Server dem Zugang mit 401, und das Paneel des Einsatzes zeigt nur diesen Zugang, mit „Freigabe ruht: Instanz meldet sich bei einem Hub“

#### Scenario: Ruhende Freigabe beenden
- **WHEN** die Einsatzleitung den Schalter der ruhenden Freigabe ausschaltet
- **THEN** endet die Freigabe, das Einsatztagebuch nennt das Ende, und der Zugang liest den Einsatz auch nach dem Ende der Kopplung nicht

#### Scenario: Kopplung endet
- **WHEN** die Kopplung endet, der Einsatz noch läuft und niemand die Freigabe beendet hat
- **THEN** liest der Zugang den Einsatz wieder

### Requirement: Die Freigabe geht auch an einem Spiegel

Hält die Instanz einen aktiven Einsatz als Spiegel, SHALL die Einsatzleitung ihn dort ebenso für
einen Maschinenzugang freigeben und die Freigabe beenden können. Der Eintrag im Einsatztagebuch
MUST dann als Antrag an die führende Instanz gehen. Die Freigabe selbst MUST an der Instanz
bleiben, an der der Zugang angelegt ist, und wird nicht gespiegelt.

#### Scenario: Freigabe am Hub für einen vom ELW geführten Einsatz
- **WHEN** ein ELW den Einsatz führt, der Hub ihn als Spiegel hält und die Einsatzleitung am Hub einen Zugang einschaltet
- **THEN** liest der Zugang am Hub den gespiegelten Einsatz, und der Eintrag zur Freigabe geht als Antrag an den ELW

#### Scenario: Ende ohne laufenden Abgleich
- **WHEN** der Abgleich des Spiegels beendet ist und die Einsatzleitung die Freigabe beendet
- **THEN** endet die Freigabe, auch ohne dass ein Antrag entsteht

### Requirement: Die Freigabe endet mit Einsatz, Zugang oder Recht

Eine Freigabe SHALL enden, sobald der Einsatz abgeschlossen ist, der Zugang widerrufen wird, sein
„gültig bis“ verstrichen ist oder ihm der letzte Lese-Scope mit Einsatzbezug entzogen wird. Nach
dem Ende MUST der Zugang den Einsatz nicht mehr lesen, auch wenn er später wieder ein solches
Recht bekommt. Führt die Instanz den Einsatz, MUST dessen Einsatztagebuch Widerruf und Entzug
nennen.

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

### Requirement: Die Anbindung zeigt den gelesenen Einsatz

Die Seite „Anbindungen“ SHALL an jedem Zugang, für den sich ein Einsatz freigeben lässt (nicht
widerrufen, nicht abgelaufen, mit einem Lese-Scope mit Einsatzbezug), zeigen, welchen Einsatz er
gerade liest, oder dass keiner freigegeben ist. An einer Instanz, die sich für die Org bei einem
Hub meldet, MUST die Seite an keinem Zugang einen gelesenen Einsatz nennen.

#### Scenario: Zugang liest einen Einsatz
- **WHEN** die Einsatzleitung den Einsatz „Stadtfest“ für den Zugang freigegeben hat und ein Admin die Seite „Anbindungen“ öffnet
- **THEN** steht an der Zeile des Zugangs „liest Stadtfest“

#### Scenario: Keine Freigabe
- **WHEN** der Zugang `lage:read` trägt und kein Einsatz für ihn freigegeben ist
- **THEN** steht an seiner Zeile „kein Einsatz freigegeben“

#### Scenario: Widerrufener Zugang
- **WHEN** der Zugang widerrufen ist
- **THEN** nennt seine Zeile weder einen Einsatz noch „kein Einsatz freigegeben“

## MODIFIED Requirements

### Requirement: Kein Bearer-Token und keine Sitzung unter /api/v1/

Eine Route unter `/api/v1/` MUST NOT ein Bearer-Token, ein Sitzungs-Cookie oder ein geteiltes
Geheimnis als Anmeldung annehmen. Eine Anmelderoute der eigenen Oberfläche MUST NOT
`Authorization: Machine` annehmen.

#### Scenario: Bearer
- **WHEN** eine Anfrage an `GET /api/v1/me` oder `GET /api/v1/lage` `Authorization: Bearer …` trägt, auch mit einem früher ausgegebenen Lagemonitor-Schlüssel
- **THEN** antwortet der Server mit 401

#### Scenario: Sitzung
- **WHEN** ein angemeldeter Admin `GET /api/v1/me` mit seinem Sitzungs-Cookie aufruft
- **THEN** antwortet der Server mit 401
