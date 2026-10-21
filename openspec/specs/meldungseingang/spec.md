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
