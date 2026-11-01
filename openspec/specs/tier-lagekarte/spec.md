# tier-lagekarte Specification

## Purpose
Ein Tier hat einen Fundort. Neben dem Freitext trägt es eine optionale Koordinate, die ohne
Tagebucheintrag gesetzt und live verteilt wird und im Lage-Snapshot erscheint, ohne die
Modulfreigabe zu umgehen; die Schwärzung behält sie als Geo-Skelett. Die Lagekarte zeigt offene
und vermisste Tiere als eigene Ebene, verortet sie aus der Detailseite oder aus der Objektliste
und führt zurück zur Detailseite (Gegenstück zu `bereitstellungsraum-lagekarte`).

## Requirements

### Requirement: Fundort-Koordinate eines Tiers

Das System SHALL an einem Tier optional eine Fundort-Koordinate führen, bestehend aus Breite
`antreff_lat` und Länge `antreff_lon`. Beide Werte MUST gemeinsam gesetzt oder gemeinsam leer
sein, geprüft gegen den gespeicherten Stand des Tiers. Die Breite MUST zwischen −90 und 90
liegen, die Länge zwischen −180 und 180; ein Verstoß MUST mit 422 abgelehnt werden, ohne etwas zu
ändern. Die Koordinate MUST beim Anlegen mitgegeben und über denselben Änderungsweg gesetzt,
geändert und entfernt werden können wie die übrigen Stammdaten. Fehlt sie in einer Änderung,
bleibt sie unverändert; ist sie `null`, wird sie entfernt. Die Anzeige eines Tiers MUST die
Koordinate tragen, wenn eine gesetzt ist, und das Feld sonst weglassen. Der Freitext `antreff_ort`
MUST daneben unverändert bestehen bleiben.

#### Scenario: Tier verorten
- **WHEN** eine Person mit Schreibrecht am Tier T-007 `antreff_lat` 52,25 und `antreff_lon` 9,125 setzt
- **THEN** trägt das Tier diese Koordinate, Liste und Detail liefern sie, und der Fundort-Freitext bleibt stehen

#### Scenario: Anlegen mit Koordinate
- **WHEN** ein Tier mit Spezies „Hund“, Fundort „Weide am Deich“ und Koordinate angelegt wird
- **THEN** trägt das neue Tier Fundort und Koordinate

#### Scenario: Nur ein Wert des Paares
- **WHEN** eine Änderung nur `antreff_lat` setzt und das Tier bisher keine Koordinate hat
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Halbes Paar entfernen
- **WHEN** an einem verorteten Tier nur `antreff_lat` auf `null` gesetzt wird
- **THEN** antwortet das System mit 422, und die Koordinate bleibt

#### Scenario: Wert außerhalb des Bereichs
- **WHEN** eine Änderung `antreff_lat` 91 und `antreff_lon` 9 setzt
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Verortung entfernen
- **WHEN** eine Änderung `antreff_lat` und `antreff_lon` jeweils auf `null` setzt
- **THEN** trägt das Tier keine Koordinate mehr, und seine Anzeige enthält keines der beiden Felder

#### Scenario: Verortung ändert keine anderen Angaben
- **WHEN** eine Änderung nur die Koordinate setzt
- **THEN** bleiben Rufname, Fundort, Notiz und Halter unverändert

#### Scenario: Ohne Schreibrecht
- **WHEN** eine Person mit Rolle „Beobachter“ die Koordinate setzen will
- **THEN** antwortet das System mit 403

### Requirement: Verortung ohne Tagebucheintrag, aber live

Eine Änderung der Koordinate eines Tiers MUST keinen ETB-Eintrag schreiben. Sie MUST als Änderung
des Tiers live an alle Personen mit Lesezugriff auf das Modul Tiere verteilt werden (Ereignis
`tier` mit der Kennung des Tiers). ETB-Einträge des Moduls MUST NOT eine Koordinate enthalten.

#### Scenario: Nur Koordinate geändert
- **WHEN** ein Tier verortet wird und sonst nichts geändert wird
- **THEN** entsteht kein ETB-Eintrag
- **AND** Personen mit Lesezugriff auf das Modul Tiere erhalten ein Live-Ereignis zum Tier

### Requirement: Lage-Snapshot und Schwärzung

Ein Lage-Snapshot SHALL die offenen und vermissten, nicht stornierten Tiere des Einsatzes zum
Zeitpunkt der Aufnahme einfrieren, mit Registriernummer, Status, Spezies, Rufname, Fundort und
Koordinate, MUST NOT aber Halter, Kennzeichnung oder Notiz. Beim Abruf, beim Sichern und beim
Ändern eines Standes MUST die Antwort diese Inhalte für Personen ohne Lesezugriff auf das Modul
Tiere weglassen. Ein Snapshot ohne dieses Feld MUST als „keine Tiere“ gelten. Die Schwärzung
eines Einsatzes MUST die Koordinate der Tiere als operatives Geo-Skelett erhalten und den
Fundort-Freitext wie bisher leeren.

#### Scenario: Stand sichern
- **WHEN** ein Stand gesichert wird, während ein verortetes offenes Tier, ein vermisstes ohne Koordinate und ein abgeschlossenes Tier bestehen
- **THEN** trägt der Stand die beiden ersten, das verortete mit Koordinate, und keinen Halterkontakt

#### Scenario: Snapshot ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Tiere einen Snapshot abruft
- **THEN** enthält die Antwort keine Tiere

#### Scenario: Schwärzung
- **WHEN** ein Einsatz geschwärzt wird
- **THEN** bleibt die Koordinate der Tiere erhalten, während der Fundort-Freitext geleert wird

### Requirement: Tiere als Marker

Die Lagekarte SHALL jedes verortete Tier im Status „aktiv“ (offen) oder „vermisst“ als Marker an
seiner Koordinate zeigen. Die Marker MUST eine eigene, schaltbare Ebene „Tiere“ bilden, die in
der Gruppe „Betroffene & Versorgung“ des Ebenenbaums nach den Betreuungsstellen mit der Anzahl
ihrer Marker steht und ohne gespeicherte Wahl eingeschaltet ist. Der Marker MUST das Zeichen
„Tier ohne Zustand“ aus `@einsatzzeichen` tragen (`{ kind: 'animal-state' }`): die Tiersilhouette
der Tierzustände aus DV 102 (5.8.6) ohne Strich und Kreuz. Kein Original zeigt ein Tier ohne
Zustand; die Bibliothek leitet es aus den drei Tierzuständen ab und kennzeichnet es als abgeleitet,
so wie die Person ohne Zustand die Raute ohne Verletzungsstrich ist. Zeichnet die Bibliothek das
Zeichen nicht, MUST der Marker auf einen Kreis mit dem Kurzzeichen „T“ zurückfallen. Die
Beschriftung MUST Registriernummer und Spezies tragen („T-007 (Hund)“), ohne Rufname. Ein
vermisstes Tier MUST dasselbe Zeichen, die Farbrolle „Achtung“ und in der Beschriftung das Wort
„vermisst“ tragen; damit es auch unterhalb des Mindestzooms der Beschriftung unterscheidbar bleibt,
MUST hinter seinem Zeichen eine Scheibe in der Farbe der Rolle „Achtung“ liegen.
Zustände eines Tiers nach 5.8.6 (erkrankt, kontaminiert, tot) MUST NOT auf der Karte erscheinen:
das Tier führt keinen Gesundheitszustand, nur die Status offen, vermisst und abgeschlossen
(Entscheidung LLH-1343 vom 01.11.2026).
Abgeschlossene und stornierte Tiere MUST weder als Marker noch in einer Liste der Karte
erscheinen. Die Auswahl eines Markers MUST Status, Spezies, Rufname und Fundort zeigen und einen
Sprung zur Detailseite des Tiers anbieten. Jeder Marker MUST eine Trefferzone in der Steuerhöhe
der aktiven Dichtestufe tragen. Die Ort-Vorschau MUST Tiere nicht als Bezugspunkte kennen.

#### Scenario: Verortetes offenes Tier
- **WHEN** der Hund T-007 im Status „aktiv“ verortet ist
- **THEN** zeigt die Karte an seiner Koordinate das Zeichen „Tier ohne Zustand“ mit der Beschriftung „T-007 (Hund)“, ohne Scheibe dahinter

#### Scenario: Vermisstes Tier
- **WHEN** die Katze T-002 im Status „vermisst“ verortet ist
- **THEN** trägt ihr Marker dasselbe Zeichen mit einer Scheibe in der Achtung-Farbe dahinter, die Farbrolle „Achtung“ und die Beschriftung „T-002 (Katze) · vermisst“

#### Scenario: Bibliothek zeichnet das Tier nicht
- **WHEN** `@einsatzzeichen` das Zeichen „Tier ohne Zustand“ nicht zeichnet
- **THEN** zeigt die Karte das Tier als Kreis mit dem Kurzzeichen „T“

#### Scenario: Abgeschlossenes Tier
- **WHEN** für ein verortetes Tier der Verbleib erfasst wird
- **THEN** verschwindet sein Marker von der Karte

#### Scenario: Sprung zur Detailseite
- **WHEN** der Marker ausgewählt und „Im Fachmodul öffnen“ gewählt wird
- **THEN** öffnet sich die Detailseite dieses Tiers

#### Scenario: Ebene ausblenden
- **WHEN** die Ebene „Tiere“ ausgeschaltet wird
- **THEN** zeigt die Karte keinen Tier-Marker

### Requirement: Nicht verortete Tiere platzieren

Die Lagekarte SHALL offene und vermisste Tiere ohne Koordinate in der Objektliste als nicht verortet
führen (Filter „Nicht verortet“, Spec `lagekarte-kartenleiste`). Eine Person mit Schreibrecht MUST
ein solches Tier von dort aus durch einen Klick in die Karte verorten können. Die Adresse
`/einsaetze/<id>/lagekarte?platzieren=tier:<tier-id>` MUST die Karte in den Platziermodus für dieses
Tier schicken und den Parameter danach aus der Adresse entfernen; ohne Schreibrecht oder ohne
Lesezugriff auf das Modul Tiere MUST der Platziermodus nicht betreten werden. Die Detailseite eines
Tiers MUST ein Feld „Verortung“ zeigen, mit der Koordinate oder „nicht verortet“, und daneben einen
Einstieg zu dieser Adresse, „Auf Karte verorten“ bzw. bei einem verorteten Tier „Auf Karte
versetzen“, sofern die Person schreiben darf und das Tier weder storniert noch abgeschlossen ist;
ist die Lagekarte für sie gesperrt, MUST der Einstieg gesperrt mit Grund im sichtbaren Text stehen.
Im Bearbeiten-Modus der Detailseite MUST sich die Koordinate eingeben und leeren lassen; eine
unlesbare Eingabe MUST das Speichern mit Meldung am Feld sperren. Das Verorten MUST keinen
ETB-Eintrag schreiben. „Verortung löschen“ am ausgewählten Marker MUST die Koordinate ohne Rückfrage
entfernen.

#### Scenario: Aus der Detailseite verorten
- **WHEN** eine Person mit Schreibrecht an T-001 „Auf Karte verorten“ wählt und in die Karte klickt
- **THEN** trägt das Tier die Koordinate des Klickpunkts, erscheint als Marker, und die Adresse enthält kein `platzieren` mehr
- **AND** es entsteht kein ETB-Eintrag
- **AND** „Zurück zu T-001 (Hund)“ führt auf die Detailseite, die nun „Auf Karte versetzen“ anbietet

#### Scenario: Aus der Liste platzieren
- **WHEN** eine Person mit Schreibrecht in der Objektliste am nicht verorteten Tier „T-004 (Hund)“ „Platzieren“ wählt und in die Karte klickt
- **THEN** trägt das Tier die Koordinate des Klickpunkts und zählt nicht mehr als nicht verortet

#### Scenario: Ohne Modulrecht
- **WHEN** eine Person ohne Lesezugriff auf das Modul Tiere die Platzieren-Adresse aufruft
- **THEN** betritt die Karte keinen Platziermodus, und der Parameter verschwindet aus der Adresse

#### Scenario: Abgeschlossenes oder storniertes Tier
- **WHEN** die Detailseite eines abgeschlossenen oder stornierten Tiers geöffnet wird
- **THEN** steht „nicht verortet“ bzw. die Koordinate ohne Einstieg zur Karte

#### Scenario: Verortung entfernen
- **WHEN** eine Person mit Schreibrecht am ausgewählten Marker „Verortung löschen“ wählt
- **THEN** verliert das Tier seine Koordinate und steht in der Objektliste wieder als nicht verortet

### Requirement: Modulfreigabe, gesicherter Stand und Betrieb ohne Netz

Die Lagekarte MUST die Tiere nur anfragen, wenn der Server das Modul Tiere für die Person freigibt;
ohne bekannte Freigaben MUST sie nicht anfragen. Ein gesperrtes Modul MUST in der Ebenenliste als
gesperrte Zeile mit Grund und ohne Zahl stehen, ein im Einsatz ausgeblendetes Modul ohne Zeile;
beides MUST NOT als Ausfall einer Lagebild-Quelle gemeldet werden, auch nicht eine trotz Freigabe
mit 403 abgelehnte Liste. Die Objektsuche der Karte MUST ohne Freigabe kein Tier finden.
Änderungen an Koordinate und Status MUST die Karte ohne Neuladen erreichen. Im gesicherten Stand
MUST die Karte die eingefrorenen Tiere zeigen; ein Stand ohne Tiere MUST keinen Fehler melden.
Die Tierliste MUST NOT in das Lagebild für den Betrieb ohne Netz aufgenommen werden, weil sie
Halterkontakt und Kennzeichnung trägt; ohne Netz zeigt die Karte keine Tiere.

#### Scenario: Ohne Freigabe
- **WHEN** der Server einer Person das Modul Tiere verweigert
- **THEN** fragt die Karte keine Tiere an, zeigt die Ebene gesperrt mit Grund und meldet keinen Ausfall

#### Scenario: Echter Ausfall
- **WHEN** die Tierliste bei freiem Modul mit einem Serverfehler scheitert
- **THEN** nennt der Ausfallhinweis der Karte „Tiere“

#### Scenario: Historienansicht
- **WHEN** ein gesicherter Stand mit einem verorteten Tier aufgerufen wird
- **THEN** zeigt die Karte das Tier an der eingefrorenen Koordinate
