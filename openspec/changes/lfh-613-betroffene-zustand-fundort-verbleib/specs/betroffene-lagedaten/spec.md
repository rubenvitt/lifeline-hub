# Spec Delta

## Purpose

Hält an einer Person im Einsatz fest, in welchem Zustand sie ist, wo sie angetroffen wurde
(als Koordinate), wohin sie verbracht wurde (strukturiert nach Art) und seit wann sie
vermisst wird. Diese Angaben tragen die Betroffenen-Erfassung und das Lage-Dashboard.

## ADDED Requirements

### Requirement: Zustand einer Person
Das System SHALL an jeder Person einen optionalen Freitext „Zustand“ führen, der den aktuellen
Zustand in Kurzform beschreibt (z. B. „gehfähig, unterkühlt“). Der Zustand MUST beim Anlegen
(`POST …/personen`) und beim Bearbeiten (`PATCH …/personen/{pid}`) setzbar sein. Beim
Bearbeiten MUST er mit `null` oder einem leeren Text wieder leerbar sein. Führende und
folgende Leerzeichen MUST entfernt werden, ein danach leerer Text MUST als „kein Zustand“
gespeichert werden.

#### Scenario: Zustand beim Anlegen
- **WHEN** eine Person mit `zustand: "  Beinfraktur "` angelegt wird
- **THEN** antwortet der Server mit 201 und die Person trägt `zustand: "Beinfraktur"`

#### Scenario: Zustand leeren
- **WHEN** eine Person mit Zustand per PATCH `{ "zustand": null }` bearbeitet wird
- **THEN** trägt sie keinen Zustand mehr, und andere Felder bleiben unverändert

#### Scenario: Zustand in der Liste bearbeiten
- **WHEN** eine schreibberechtigte Person in der Betroffenenliste den leeren Zustand einer Zeile anklickt, einen Text eingibt und das Feld verlässt
- **THEN** wird der Zustand gespeichert und in der Spalte „Zustand“ angezeigt

### Requirement: Fundort als Koordinate
Das System SHALL an jeder Person ein optionales Koordinatenpaar für den Fundort führen
(Breite, Länge in WGS84-Dezimalgrad), zusätzlich zum bestehenden Fundort-Freitext. Beide
Werte MUST gemeinsam gesetzt oder gemeinsam leer sein. Die Breite MUST zwischen -90 und 90
liegen, die Länge zwischen -180 und 180. Beim Bearbeiten MUST die Paarregel gegen den Zustand
NACH der Änderung geprüft werden, nicht gegen die Anfrage allein.

#### Scenario: Koordinate beim Anlegen
- **WHEN** eine Person mit `antreff_lat: 52.2691, antreff_lon: 9.1342` angelegt wird
- **THEN** trägt sie beide Werte

#### Scenario: Halbe Koordinate
- **WHEN** eine Person nur mit `antreff_lat` angelegt wird
- **THEN** antwortet der Server mit 422 und legt keine Person an

#### Scenario: Halbe Koordinate im PATCH gegen den Bestand
- **WHEN** eine Person mit Koordinate per PATCH `{ "antreff_lon": null }` bearbeitet wird
- **THEN** antwortet der Server mit 422, und die Koordinate bleibt unverändert

#### Scenario: Koordinate außerhalb des Wertebereichs
- **WHEN** eine Person mit `antreff_lat: 95, antreff_lon: 9` angelegt oder bearbeitet wird
- **THEN** antwortet der Server mit 422

#### Scenario: Koordinate in der Schnellerfassung
- **WHEN** in die Schnellerfassungszeile `Kowalski, Anna w 34 sk3 #52.2691/9.1342` eingegeben und abgesendet wird
- **THEN** wird die Person mit Sichtung SK III und der Koordinate 52.2691/9.1342 im selben Anlege-Request angelegt

#### Scenario: Unbrauchbare Koordinate in der Schnellerfassung
- **WHEN** die Zeile ein `#…`-Wort enthält, das keine gültige Koordinate ist (z. B. `#52.2691` oder `#95/9`)
- **THEN** meldet die Zeile ein Problem und sendet nicht ab, und das Wort wird nicht als Namensteil übernommen

### Requirement: Strukturierter Verbleib
Das System SHALL zu jeder Person neben der Kurzform `aktueller_verbleib` die Art, das Ziel und
den Status des jüngsten Verbleib-Ereignisses als eigene Felder ausliefern
(`aktuelle_verbleib_art`, `aktuelles_verbleib_ziel`, `aktueller_verbleib_status`). Die
Verbleib-Arten MUST `transport`, `entlassung`, `vor_ort`, `verstorben` und `notunterkunft`
umfassen. Die Felder MUST in derselben Transaktion wie das Verbleib-Ereignis gepflegt werden.
Für bereits vorhandene Verbleib-Ereignisse MUST die Migration sie aus dem jüngsten Ereignis
je Person nachtragen.

#### Scenario: Verbleib Notunterkunft
- **WHEN** für eine Person ein Verbleib `{ "art": "notunterkunft", "ziel": "Turnhalle Ost" }` erfasst wird
- **THEN** trägt die Person `aktuelle_verbleib_art: "notunterkunft"`, `aktuelles_verbleib_ziel: "Turnhalle Ost"` und die Kurzform „Notunterkunft → Turnhalle Ost“

#### Scenario: Notunterkunft beendet den UHS-Aufenthalt
- **WHEN** eine Person im UHS-Wartebereich den Verbleib `notunterkunft` erhält
- **THEN** tritt sie aus der Unfallhilfsstelle aus, wie bei `transport` und `entlassung`

#### Scenario: Unbekannte Verbleib-Art
- **WHEN** ein Verbleib mit `art: "teleportation"` erfasst wird
- **THEN** antwortet der Server mit 400

#### Scenario: Bestandsdaten nach der Migration
- **WHEN** eine Datenbank mit Personen und Verbleib-Ereignissen migriert wird
- **THEN** trägt jede Person Art, Ziel und Status ihres jüngsten Verbleib-Ereignisses, und kein Verbleib-Ereignis geht verloren

### Requirement: Verbleib-Zählung der Betroffenen
Die Betroffenen-Seite SHALL den Verbleib der angetroffenen Personen (Status erfasst,
betroffen oder verstorben) nach Art zählen. Transport, Notunterkunft, entlassen, vor Ort und
verstorben MUST je ein Posten sein. Eine Person ohne Verbleib-Art in einer Unfallhilfsstelle
MUST unter dem Namen dieser Stelle zählen. Eine Person ohne beides MUST unter „offen“ zählen.
„offen“ MUST immer erscheinen, auch mit 0.

#### Scenario: Zählung nach Art
- **WHEN** zwei angetroffene Personen mit Verbleib `transport`, eine mit `notunterkunft`, eine in der UHS „Weserstadion“ ohne Verbleib und eine ohne jede Angabe erfasst sind
- **THEN** zeigt die Zählung Transport 2, Notunterkunft 1, Weserstadion 1, offen 1

### Requirement: Vermisst seit
Das System SHALL an jeder Person einen Zeitpunkt „vermisst seit“ führen. Legt man eine Person
mit Status `vermisst` an, MUST ein mitgeschickter Zeitpunkt übernommen werden. Fehlt er, MUST
der Server den Zeitpunkt der Anlage setzen. Wechselt eine Person in den Status `vermisst`,
MUST der Server den Zeitpunkt des Wechsels setzen. Per PATCH MUST der Zeitpunkt nur bei einer
Person mit Status `vermisst` änderbar sein. Ein Zeitpunkt mehr als fünf Minuten in der Zukunft
MUST abgewiesen werden. Wer einen Zeitpunkt ohne Status `vermisst` mitschickt, MUST abgewiesen
werden. Eine Offline-Wiederholung desselben Anlege-Requests (`client_id`) MUST den Zeitpunkt
nicht verändern.

#### Scenario: Angabe beim Anlegen
- **WHEN** eine Person mit `status: "vermisst"` und `vermisst_seit: "2026-09-22 06:00:00"` angelegt wird
- **THEN** trägt sie genau diesen Zeitpunkt

#### Scenario: Ersatzweise die Meldezeit
- **WHEN** eine Person mit `status: "vermisst"` ohne `vermisst_seit` angelegt wird
- **THEN** trägt sie als `vermisst_seit` den Zeitpunkt der Anlage

#### Scenario: Wechsel nach vermisst
- **WHEN** eine betroffene Person per Statuswechsel auf `vermisst` gesetzt wird
- **THEN** trägt sie als `vermisst_seit` den Zeitpunkt des Wechsels

#### Scenario: Zeitpunkt in der Zukunft
- **WHEN** `vermisst_seit` eine Stunde in der Zukunft liegt
- **THEN** antwortet der Server mit 400

#### Scenario: Zeitpunkt ohne Status vermisst
- **WHEN** eine Person mit `status: "betroffen"` und `vermisst_seit` angelegt wird, oder eine nicht vermisste Person per PATCH ein `vermisst_seit` bekommt
- **THEN** antwortet der Server mit 422

#### Scenario: Leeren ist nicht vorgesehen
- **WHEN** eine vermisste Person per PATCH `{ "vermisst_seit": null }` bekommt
- **THEN** antwortet der Server mit 400, und der Zeitpunkt bleibt unverändert

### Requirement: Lage-Dashboard zeigt Transport und Vermisstendauer
Das Lage-Dashboard SHALL im Sichtungspaneel die Zeile „Transportiert / offen“ zeigen. Der erste
Wert MUST die angetroffenen Personen mit Verbleib-Art `transport` zählen, deren Status nicht
`angemeldet` ist. Der zweite Wert MUST die angetroffenen Personen ohne Verbleib und ohne
Unfallhilfsstelle zählen. Die Kennzahl „Vermisste“ SHALL als Notiz „n seit über 4 h“ tragen,
wenn mindestens eine vermisste Person seit mehr als vier Stunden vermisst wird. Die Notiz MUST
mit der Zeit fortschreiben, ohne dass neue Daten eintreffen.

#### Scenario: Transportiert / offen
- **WHEN** drei angetroffene Personen mit Transport (davon einer nur `angemeldet`) und zwei ohne Verbleib erfasst sind
- **THEN** zeigt das Paneel „Transportiert / offen 2 / 2“

#### Scenario: Vermisste seit über 4 h
- **WHEN** drei Personen vermisst werden, zwei davon seit mehr als vier Stunden
- **THEN** zeigt die Kennzahl „Vermisste“ den Wert 3 mit der Notiz „2 seit über 4 h“

### Requirement: Kartenansicht der Betroffenen
Die Betroffenen-Seite SHALL neben „Zeilen“ und „Sichtungsraster“ eine Ansicht „Karte“ bieten.
Sie zeigt jede nicht stornierte Person mit Fundort-Koordinate als Marker auf der
Einsatzkarte. Der Marker MUST die Sichtungskategorie über Farbe UND Beschriftung zeigen
(zweiter Kanal, WCAG 1.4.1). Er MUST zur Detailseite der Person führen. Wie viele Personen
ohne Koordinate nicht auf der Karte stehen, MUST sichtbar genannt werden.

#### Scenario: Personen auf der Karte
- **WHEN** die Ansicht „Karte“ gewählt ist und zwei von fünf Personen eine Koordinate tragen
- **THEN** zeigt die Karte zwei Marker mit Registriernummer und Sichtung und nennt „3 ohne Koordinate“

#### Scenario: Marker öffnet die Person
- **WHEN** ein Marker angeklickt wird
- **THEN** führt die Seite zur Detailseite dieser Person

### Requirement: Schwärzung der neuen Angaben
Beim Schwärzen eines Einsatzes SHALL das System Zustand, Fundort-Koordinate und Verbleib-Ziel
jeder Person auf leer setzen. Verbleib-Art, Verbleib-Status und „vermisst seit“ MUST erhalten
bleiben, weil sie keinen Personenbezug tragen.

#### Scenario: Geschwärzter Einsatz
- **WHEN** ein Einsatz mit einer Person mit Zustand, Koordinate und Verbleib-Ziel geschwärzt wird
- **THEN** sind `zustand`, `antreff_lat`, `antreff_lon` und `aktuelles_verbleib_ziel` leer, und `aktuelle_verbleib_art` ist unverändert
