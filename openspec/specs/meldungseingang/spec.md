# meldungseingang Specification

## Purpose
Ein Meldungsmodell (LLH-1027): Jede Lagemeldung ist eine Meldung. „Lagemeldung“ ist eine Meldungsart, „lagerelevant“ ein Merkmal der Meldung; die Lage-Sicht liest aus dem Meldungseingang, und die Seite Lagemeldungen erfasst dort direkt (LLH-1031). Meldung und Lage aus der ETB-Erfassung legen den Vorgang dort an, sofern nicht „Nur protokollieren“ gewählt ist (LLH-1037).

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

### Requirement: ETB-Erfassung von Meldung und Lage legt den Vorgang im Meldungseingang an
Erfasst eine Person im ETB einen Eintrag vom Typ „Meldung“ oder „Lage“ mit
`in_meldungseingang: true`, SHALL das System in einer Transaktion den ETB-Eintrag und eine Meldung
anlegen, Art „Lagemeldung“ beim Typ „Lage“ und „Sonstige“ beim Typ „Meldung“. Eintrag und Meldung
MUST aufeinander verweisen, und es MUST kein zweiter ETB-Eintrag zur Meldung entstehen.

#### Scenario: Lage aus dem ETB
- **WHEN** eine Person im ETB einen Eintrag vom Typ „Lage“ mit Von „Florian 3“ und An „ELW 1“ erfasst, ohne „Nur protokollieren“
- **THEN** gibt es genau einen ETB-Eintrag und eine Meldung der Art „Lagemeldung“ mit Absender „Florian 3“ und Status „neu“, beide verweisen aufeinander, und die Meldung steht in der Liste der Lagemeldungen

#### Scenario: Meldung aus dem ETB
- **WHEN** eine Person im ETB einen Eintrag vom Typ „Meldung“ ohne „Nur protokollieren“ erfasst
- **THEN** steht eine Meldung der Art „Sonstige“ im Meldungseingang, und der Zähler „Meldungen offen“ steigt um eins

### Requirement: Die Meldung übernimmt die Angaben des Eintrags
Die aus dem ETB angelegte Meldung SHALL Von als Absender, An als Empfänger und Meldeweg, Wortlaut
und Ereigniszeit des Eintrags tragen (ohne Meldeweg „sonstige“), Status „neu“ und Priorität
„normal“; erfasst hat sie, wer den Eintrag erfasst hat. Ohne Ereigniszeit tragen Eintrag und
Meldung denselben Zeitpunkt der Erfassung. Ein automatischer ETB-Eintrag der Meldung MUST auf
diesem Weg nicht entstehen, gleich wie „Automatische ETB-Einträge“ steht.

#### Scenario: Angaben übernommen
- **WHEN** eine Person im ETB einen Eintrag vom Typ „Meldung“ mit Von „Florian 3“, An „ELW 1“, Meldeweg Funk und Ereigniszeit 14:30 erfasst, ohne „Nur protokollieren“
- **THEN** trägt die Meldung den Absender „Florian 3“, den Empfänger „ELW 1“, den Meldeweg Funk und die Ereigniszeit 14:30

### Requirement: Ohne Angabe wird nur protokolliert
Fehlt im ETB-Eintrag das Feld `in_meldungseingang` oder ist es `false`, SHALL nur der ETB-Eintrag
entstehen. `in_meldungseingang: true` bei einem anderen Typ als „Meldung“ oder „Lage“ MUST mit
HTTP 422 abgelehnt werden.

#### Scenario: Nur protokolliert
- **WHEN** eine Person einen Eintrag vom Typ „Lage“ mit „Nur protokollieren“ erfasst
- **THEN** entsteht nur der ETB-Eintrag, keine Meldung

#### Scenario: Älterer Client
- **WHEN** ein Eintrag vom Typ „Meldung“ ohne das Feld `in_meldungseingang` eingeht
- **THEN** entsteht nur der ETB-Eintrag

#### Scenario: Anordnung
- **WHEN** ein Eintrag vom Typ „Anordnung“ mit `in_meldungseingang: true` eingeht
- **THEN** antwortet das System mit HTTP 422, und es entsteht weder Eintrag noch Meldung

### Requirement: Der Weg in den Meldungseingang verlangt das Recht der Meldungen
`in_meldungseingang: true` SHALL zusätzlich zum Schreibrecht im ETB die Freigabe des Moduls
Meldungen verlangen; fehlt sie, MUST das System mit HTTP 403 antworten und weder Eintrag
noch Meldung anlegen. Das System MUST NOT stillschweigend nur protokollieren.

#### Scenario: Ohne Recht für Meldungen
- **WHEN** eine Person, die im ETB schreiben darf, für die das Modul Meldungen aber gesperrt ist, einen Eintrag mit `in_meldungseingang: true` sendet
- **THEN** antwortet das System mit HTTP 403, und weder Eintrag noch Meldung entstehen

### Requirement: Wiederholtes Senden erzeugt nichts doppelt
Die `client_id` eines ETB-Eintrags SHALL auch für die mit ihm angelegte Meldung gelten. Ein
erneutes Senden derselben `client_id` MUST weder einen zweiten ETB-Eintrag noch eine zweite Meldung
anlegen und MUST denselben Eintrag mit demselben Verweis liefern. Ein ohne Netz vorgemerkter
Eintrag MUST beim Abspielen seine Meldung anlegen. Eine Wiederholung derselben `client_id` mit
anderer Kopplung (mit statt ohne Meldung oder umgekehrt) MUST mit HTTP 409 abgelehnt werden.

#### Scenario: Replay nach verlorener Antwort
- **WHEN** derselbe Eintrag mit derselben `client_id` und `in_meldungseingang: true` zweimal eingeht
- **THEN** gibt es genau einen ETB-Eintrag und genau eine Meldung

#### Scenario: Wiederholung mit anderer Kopplung
- **WHEN** ein Eintrag mit „Nur protokollieren“ erfasst ist und dieselbe `client_id` mit `in_meldungseingang: true` erneut eingeht
- **THEN** antwortet das System mit HTTP 409, und es entsteht keine Meldung

#### Scenario: Ohne Netz erfasst
- **WHEN** eine Person ohne Netz einen Eintrag vom Typ „Lage“ erfasst und das Netz zurückkehrt
- **THEN** entsteht beim Abspielen die Meldung der Art „Lagemeldung“, und sie steht in der Liste der Lagemeldungen

### Requirement: Die Meldung aus dem ETB verhält sich wie eine erfasste
Die aus dem ETB angelegte Meldung SHALL dieselben Live-Ereignisse und Benachrichtigungen auslösen
wie eine im Meldungsformular erfasste Meldung, genau einmal je Meldung, auch bei einer
Wiederholung.

#### Scenario: Live-Ereignisse
- **WHEN** eine Person im ETB einen Eintrag vom Typ „Meldung“ ohne „Nur protokollieren“ erfasst
- **THEN** erhalten die verbundenen Clients des Einsatzes das ETB-Ereignis des Eintrags und das Ereignis „meldung“
