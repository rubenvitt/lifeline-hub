# meldungseingang Specification

## Purpose
Ein Meldungsmodell (LLH-1027): Jede Lagemeldung ist eine Meldung. „Lagemeldung“ ist eine Meldungsart, „lagerelevant“ ein Merkmal der Meldung; die Lage-Sicht liest aus dem Meldungseingang, und die Seite Lagemeldungen erfasst dort direkt (LLH-1031).

## Requirements

### Requirement: Jede Lagemeldung ist eine Meldung
Das System SHALL Lagemeldungen nur als Meldungen führen: „Lagemeldung“ ist eine Meldungsart,
„lagerelevant“ ein Merkmal der Meldung. Es MUST keinen Bestand an Lagemeldungen neben den
Meldungen geben. `GET /api/einsaetze/{id}/lage/meldungen` SHALL genau die lagerelevanten Meldungen
des Einsatzes liefern, je Eintrag mit der Kennung der Meldung (`id` und `meldung_id` gleich).

#### Scenario: Erfasste Lagemeldung steht in der Lage
- **WHEN** eine Person im Meldungsformular eine Meldung der Art „Lagemeldung“ erfasst
- **THEN** liefert die Liste der Lagemeldungen sie ohne weiteren Schritt, mit der Kennung der Meldung und ihrem Wortlaut als Lage-Text

#### Scenario: Andere Art ohne Übernahme
- **WHEN** eine Meldung der Art „Rückmeldung“ erfasst und nicht in die Lage übernommen wird
- **THEN** fehlt sie in der Liste der Lagemeldungen

#### Scenario: Bestand nach der Umstellung
- **WHEN** ein Einsatz vor der Umstellung drei an die Lage übergebene Meldungen hatte, eine davon gesehen und verortet
- **THEN** liefert die Liste danach dieselben drei mit unverändertem Lage-Text, Ort, Übergabezeitpunkt und Kenntnisnahme

### Requirement: Die Liste der Lagemeldungen trägt die Merkmale der Meldung
Jeder Eintrag von `GET …/lage/meldungen` SHALL laufende Nummer, Absender, Meldungsart, Priorität,
Status, Richtung und Ereigniszeit der Meldung tragen, dazu den Lage-Text (eigener Lage-Text, sonst
der Wortlaut), die Verortung, Zeitpunkt und Person der Übernahme in die Lage und die
Kenntnisnahme. Die Herkunft von einem gekoppelten Gerät MUST erkennbar sein.

#### Scenario: Merkmale einer Gerätemeldung
- **WHEN** ein gekoppeltes Abschnittsgerät eine dringende Lagemeldung sendet
- **THEN** trägt ihr Eintrag in der Liste die Art „Lagemeldung“, die Priorität „dringend“, den Status „neu“ und die Herkunft von einem Gerät

### Requirement: Art „Lagemeldung“ ist immer lagerelevant
Eine Meldung der Art „Lagemeldung“ SHALL ab ihrer Anlage lagerelevant sein, gleich auf welchem Weg
sie entsteht (Meldungsformular, gekoppeltes Gerät, ETB-Erfassung) und gleich in welche Richtung sie
geht. Zeitpunkt der Übernahme ist ihr Eingang, übernommen hat ihr Erfasser. Solange eine Meldung
die Art „Lagemeldung“ trägt, MUST sich ihre Lagerelevanz nicht zurücknehmen lassen.

#### Scenario: Lagemeldung vom Gerät
- **WHEN** ein gekoppeltes UHS-Gerät eine Meldung der Art „Lagemeldung“ sendet
- **THEN** antwortet das System mit HTTP 201, die Meldung ist lagerelevant und steht in der Liste der Lagemeldungen als Meldung eines Geräts

#### Scenario: Lagemeldung nach außen
- **WHEN** eine Lagemeldung mit Richtung „extern“ an die übergeordnete Stelle erfasst wird
- **THEN** ist sie lagerelevant und steht mit ihrer Richtung in der Liste der Lagemeldungen

### Requirement: Andere Meldungsarten werden in die Lage übernommen
Eine Meldung einer anderen Art SHALL sich mit Schreibrecht am Modul Meldungen in die Lage
übernehmen lassen, wahlweise mit eigenem Lage-Text und Verortung. Die Übernahme MUST den Wortlaut
der Meldung unverändert lassen und MUST idempotent sein: eine zweite Übernahme legt nichts Neues an.

#### Scenario: Rückmeldung mit Lageinhalt
- **WHEN** eine Rückmeldung mit Lage-Text „Brand unter Kontrolle“ und einer Koordinate in die Lage übernommen wird
- **THEN** steht sie in der Liste der Lagemeldungen mit diesem Lage-Text und als Marker auf der Lagekarte, und ihr Wortlaut ist unverändert

### Requirement: Eine Meldung lässt sich nachträglich korrigieren
Mit Schreibrecht am Modul Meldungen SHALL sich an einer Meldung nachträglich Meldungsart,
Priorität, Richtung, Empfänger und der Bezug auf Einheit oder Abschnitt ändern lassen
(`PATCH /api/einsaetze/{id}/meldungen/{mid}`). Jede wirksame Korrektur MUST in derselben
Transaktion einen Systemeintrag im ETB mit Verweis auf die Meldung schreiben, der die Änderung
nennt; eine Korrektur ohne wirksame Änderung MUST nichts schreiben. Ohne Schreibrecht MUST das
System mit HTTP 403 antworten, für eine Meldung eines anderen Einsatzes mit HTTP 404. Gekoppelte
Geräte MUST NOT korrigieren. Eine Korrektur, die eine Meldung erst zur Sofortmeldung macht, MUST
mit HTTP 422 abgelehnt werden.

#### Scenario: Priorität berichtigt
- **WHEN** eine Person die Priorität von Meldung #3 von „normal“ auf „dringend“ ändert
- **THEN** trägt die Meldung die Priorität „dringend“, und das ETB enthält einen Systemeintrag „Meldung #3: Priorität Normal → Dringend“ mit Verweis auf die Meldung

#### Scenario: Von-Bezug nachgetragen
- **WHEN** eine Person einer ohne Bezug erfassten Meldung die Einheit „Florian Nord 1“ zuordnet
- **THEN** nennt die letzte Rückmeldung dieser Einheit die Meldung

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** eine Person einer Meldung eine Einheit eines anderen Einsatzes zuordnen will
- **THEN** antwortet das System mit HTTP 422, und der Bezug bleibt

#### Scenario: Gerät korrigiert
- **WHEN** ein gekoppeltes Gerät die Art seiner eigenen Meldung ändern will
- **THEN** antwortet das System mit HTTP 403

#### Scenario: Zur Sofortmeldung heraufstufen
- **WHEN** eine Person eine Meldung der Priorität „normal“ auf „sofort“ setzen will
- **THEN** antwortet das System mit HTTP 422, und die Meldung bleibt unverändert

### Requirement: Der Eingang bleibt unverändert
Wortlaut, Absender, Meldeweg, Ereigniszeit und Eingang einer Meldung SHALL unveränderlich bleiben;
ein PATCH, der eines davon ändern will, MUST mit HTTP 422 abgelehnt werden. Der ETB-Eintrag der
Meldung MUST seinen Typ behalten; die Korrektur steht als eigener Systemeintrag im ETB.

#### Scenario: Wortlaut ändern
- **WHEN** eine Person den Wortlaut einer Meldung per PATCH ändern will
- **THEN** antwortet das System mit HTTP 422, und der Wortlaut bleibt

#### Scenario: Typ des ETB-Eintrags
- **WHEN** eine Person die Art einer Meldung von „Sonstige“ auf „Lagemeldung“ ändert
- **THEN** behält ihr ETB-Eintrag den Typ „Meldung“, und ein Systemeintrag nennt die Änderung

### Requirement: Eine Korrektur der Art hält die Lagerelevanz
Ändert eine Person die Art einer Meldung nachträglich auf „Lagemeldung“, SHALL die Meldung im
selben Schritt lagerelevant werden, mit dem Zeitpunkt der Änderung als Übernahme und neu für die
Kenntnisnahme. Ändert sie die Art von „Lagemeldung“ weg, MUST die Lagerelevanz bestehen bleiben,
bis sie ausdrücklich zurückgenommen wird. Die Lagerelevanz einer Meldung der Art „Lagemeldung“
zurückzunehmen MUST mit HTTP 422 abgelehnt werden.

#### Scenario: Sonstige wird Lagemeldung
- **WHEN** eine Person die Art einer Meldung von „Sonstige“ auf „Lagemeldung“ ändert
- **THEN** steht die Meldung in der Liste der Lagemeldungen als neu

#### Scenario: Lagemeldung wird Rückmeldung
- **WHEN** eine Person die Art einer Lagemeldung auf „Rückmeldung“ ändert
- **THEN** bleibt die Meldung in der Liste der Lagemeldungen, mit der Art „Rückmeldung“

#### Scenario: Lagemeldung zurücknehmen
- **WHEN** eine Person für eine Meldung der Art „Lagemeldung“ die Lagerelevanz zurücknehmen will
- **THEN** antwortet das System mit HTTP 422, und die Meldung bleibt in der Lage

### Requirement: Eine übernommene Meldung lässt sich aus der Lage nehmen
Eine in die Lage übernommene Meldung einer anderen Art als „Lagemeldung“ SHALL sich mit
Schreibrecht am Modul Meldungen aus der Lage nehmen lassen. Danach MUST sie in der Liste der
Lagemeldungen und auf der Lagekarte fehlen, ihr Lage-Text, ihre Verortung, ihre Übernahme und ihre
Kenntnisnahme MUST leer sein, und der Wortlaut MUST bleiben. Das ETB MUST die Rücknahme als
Systemeintrag nennen. Die Karte der Meldung SHALL dafür „Aus der Lage nehmen“ mit Rückfrage anbieten.

#### Scenario: Übernommene Rückmeldung aus der Lage nehmen
- **WHEN** eine Person an einer übernommenen, verorteten Rückmeldung „Aus der Lage nehmen“ wählt und bestätigt
- **THEN** fehlt sie in der Liste der Lagemeldungen und auf der Lagekarte, und das ETB nennt „aus der Lage genommen“

### Requirement: Lage-Angaben sind korrigierbar
Lage-Text und Verortung einer lagerelevanten Meldung SHALL sich mit Schreibrecht am Modul Meldungen
nachträglich setzen, ändern und leeren lassen, in der Zeile der Seite Lagemeldungen und im
Inspector der Lagekarte. Ein geänderter Lage-Text MUST die Lagemeldung wieder neu machen; eine
neue oder geänderte Verortung MUST den Marker der Lagekarte setzen oder versetzen. Lage-Angaben an
einer Meldung, die nicht in der Lage steht, MUST mit HTTP 422 abgelehnt werden. Der Dialog „In die
Lage übernehmen“ MUST NOT mehr sagen, dass die Verortung später nicht änderbar ist.

#### Scenario: Verortung nachgetragen
- **WHEN** eine Person für eine lagerelevante Meldung ohne Ort eine Koordinate setzt
- **THEN** steht sie als Marker in der Ebene „Lagemeldungen“ der Lagekarte

#### Scenario: Lage-Text geändert
- **WHEN** eine Person den Lage-Text einer schon gesehenen Lagemeldung ändert
- **THEN** steht sie mit dem neuen Text und der Marke „Neu“ in der Liste der Lagemeldungen

### Requirement: Eine Lagemeldung protokolliert als Lage
Schreibt das System zu einer Meldung automatisch einen ETB-Eintrag, SHALL dieser bei der Art
„Lagemeldung“ den Typ „Lage“ tragen, bei jeder anderen Art den Typ „Meldung“.

#### Scenario: Auto-ETB einer Lagemeldung
- **WHEN** bei eingeschalteten automatischen ETB-Einträgen eine Lagemeldung erfasst wird
- **THEN** entsteht genau ein ETB-Eintrag vom Typ „Lage“ mit Verweis auf die Meldung, und der ETB-Filter „Lage“ zeigt ihn

#### Scenario: Auto-ETB einer Rückmeldung
- **WHEN** eine Rückmeldung erfasst wird
- **THEN** trägt ihr ETB-Eintrag den Typ „Meldung“

### Requirement: Die Seite Lagemeldungen erfasst Lagemeldungen
Die Seite Lagemeldungen SHALL im Seitenkopf „Lagemeldung erfassen“ anbieten, das das
Meldungsformular mit der Art „Lagemeldung“ vorbelegt öffnet; ein zweites Formular MUST es nicht
geben. Ohne Schreibrecht oder Freigabe im Modul Meldungen MUST der Knopf fehlen und die Seite
„Nur Ansicht“ mit Grund zeigen. Ohne Netz MUST die Erfassung wie im Meldungsformular vorgemerkt
werden.

#### Scenario: Erfassen auf der Seite
- **WHEN** eine Person mit Schreibrecht auf der Seite Lagemeldungen „Lagemeldung erfassen“ wählt, Absender und Wortlaut eingibt und erfasst
- **THEN** steht die neue Lagemeldung in der Zeitachse der Seite mit der Marke „Neu“ und dem Sprung „Meldung #n ↗“

#### Scenario: Ohne Schreibrecht für Meldungen
- **WHEN** eine Person die Lagemeldungen lesen, aber im Modul Meldungen nicht schreiben darf
- **THEN** fehlt „Lagemeldung erfassen“, und die Seite zeigt „Nur Ansicht“ mit dem Grund

#### Scenario: Ohne Netz erfasst
- **WHEN** eine Person ohne Netz auf der Seite eine Lagemeldung erfasst und das Netz zurückkehrt
- **THEN** legt der Server genau eine Meldung der Art „Lagemeldung“ an, und sie steht in der Zeitachse
