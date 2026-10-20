# betroffene-lagedaten Specification

## Purpose
Hält an einer Person im Einsatz fest, in welchem Zustand sie ist, wo sie angetroffen wurde
(als Koordinate), wohin sie verbracht wurde (strukturiert nach Art) und seit wann sie
vermisst wird. Diese Angaben tragen die Betroffenen-Erfassung und das Lage-Dashboard.

## Requirements

### Requirement: Zustand einer Person
Das System SHALL an jeder Person einen optionalen Freitext „Zustand“ führen, der den aktuellen
Zustand oder eine Verdachtsdiagnose in Kurzform beschreibt (z. B. „gehfähig, unterkühlt“ oder
„Verdacht auf Hüftfraktur“). Die Oberfläche MUST das Feld überall „Zustand / Verdacht“ nennen
(Erfassung, Liste, Detail, Schnellansicht, Druck); der Feldname der Schnittstelle bleibt
`zustand`. Der Zustand MUST beim Anlegen (`POST …/personen`) und beim Bearbeiten
(`PATCH …/personen/{pid}`) setzbar sein. Beim Bearbeiten MUST er mit `null` oder einem leeren
Text wieder leerbar sein. Führende und folgende Leerzeichen MUST entfernt werden, ein danach
leerer Text MUST als „kein Zustand“ gespeichert werden.

#### Scenario: Zustand beim Anlegen
- **WHEN** eine Person mit `zustand: "  Beinfraktur "` angelegt wird
- **THEN** antwortet der Server mit 201 und die Person trägt `zustand: "Beinfraktur"`

#### Scenario: Zustand leeren
- **WHEN** eine Person mit Zustand per PATCH `{ "zustand": null }` bearbeitet wird
- **THEN** trägt sie keinen Zustand mehr, und andere Felder bleiben unverändert

#### Scenario: Zustand in der Liste bearbeiten
- **WHEN** eine schreibberechtigte Person in der Betroffenenliste den leeren Zustand einer Zeile anklickt, einen Text eingibt und das Feld verlässt
- **THEN** wird der Zustand gespeichert und in der Spalte „Zustand / Verdacht“ angezeigt

#### Scenario: Ein Wort für das Feld
- **WHEN** die Erfassungsmaske, die Betroffenenliste, das Detail und die Schnellansicht einer Person angezeigt werden
- **THEN** heißt das Feld an allen vier Stellen „Zustand / Verdacht“

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
betroffen oder verstorben) nach Art zählen. Unterwegs (Eigentransport ohne quittierte
Übergabe), Transport (fremdes Rettungsmittel oder quittierte Übergabe), Notunterkunft,
entlassen, vor Ort und verstorben MUST je ein Posten sein. Eine Person ohne Verbleib-Art in
einer Unfallhilfsstelle MUST unter dem Namen dieser Stelle zählen. Eine Person ohne beides MUST
unter „offen“ zählen. „offen“ MUST immer erscheinen, auch mit 0. Die Zählung MUST alle
angetroffenen Personen erfassen, unabhängig vom Schalter „Abgeschlossene zeigen“.

#### Scenario: Zählung nach Art
- **WHEN** zwei angetroffene Personen mit Verbleib `transport` durch ein fremdes Rettungsmittel, eine im Eigentransport, eine mit `notunterkunft`, eine in der UHS „Weserstadion“ ohne Verbleib und eine ohne jede Angabe erfasst sind
- **THEN** zeigt die Zählung Unterwegs 1, Transport 2, Notunterkunft 1, Weserstadion 1, offen 1

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
Das Lage-Dashboard SHALL im Sichtungspaneel die Zeile „Unterwegs / offen / abgeschlossen“
zeigen. Der erste Wert MUST die angetroffenen Personen mit `versorgung: "unterwegs"` zählen, der
zweite die angetroffenen Personen ohne Verbleib und ohne Unfallhilfsstelle, der dritte die
angetroffenen Personen mit `versorgung: "abgeschlossen"`. Die Patientenzahl (Notiz der Kennzahl
„Betroffene“) MUST nur Nicht-Abgeschlossene zählen und, wenn es Abgeschlossene gibt, „· n
abgeschlossen“ anfügen. Die Notiz der Kennzahl „Verbleib offen“ MUST „n unterwegs“ lauten. Die Kennzahl „Vermisste“ SHALL als Notiz „n seit über 4 h“ tragen, wenn mindestens eine
vermisste Person seit mehr als vier Stunden vermisst wird. Die Notiz MUST mit der Zeit
fortschreiben, ohne dass neue Daten eintreffen.

#### Scenario: Transportiert / offen
- **WHEN** eine angetroffene Person im Eigentransport, zwei ohne Verbleib und drei mit fremdem Transport erfasst sind
- **THEN** zeigt das Paneel „Unterwegs / offen / abgeschlossen 1 / 2 / 3“

#### Scenario: Patienten ohne Abgeschlossene
- **WHEN** fünf Personen in SK I bis SK IV erfasst sind und zwei davon vor Ort entlassen wurden
- **THEN** trägt die Kennzahl „Betroffene“ die Notiz „3 Patienten · 2 abgeschlossen“

#### Scenario: Vermisste seit über 4 h
- **WHEN** drei Personen vermisst werden, zwei davon seit mehr als vier Stunden
- **THEN** zeigt die Kennzahl „Vermisste“ den Wert 3 mit der Notiz „2 seit über 4 h“

### Requirement: Kartenansicht der Betroffenen
Die Betroffenen-Seite SHALL neben „Zeilen“ und „Sichtungsraster“ eine Ansicht „Karte“ bieten.
Sie zeigt jede nicht stornierte, angetroffene Person (Status erfasst, betroffen oder
verstorben) mit Fundort-Koordinate als Marker auf der Einsatzkarte. Eine vermisste Person hat
keinen Fundort: sie erscheint weder als Marker noch in der Zählung „ohne Koordinate“, und
Zustand und Koordinate werden ihr in keiner Eingabe angeboten. Der Marker MUST die Sichtungskategorie über Farbe UND Beschriftung zeigen
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

### Requirement: Kartenansicht hält Menge und Lage, solange jemand mit ihr arbeitet
Solange der Mauszeiger oder ein Stift über der Kartenansicht der Betroffenen liegt, der
Tastaturfokus in ihr steht oder ein Bündel aufgefächert ist, SHALL die Kartenansicht Menge und Lage ihrer
Personen-Marker halten. Zugänge, verlegte und entfallene Personen MUST warten. Sichtung und
Beschriftung der gezeigten Marker MUST weiter live aktualisieren.

#### Scenario: Zugang neben dem Marker unter dem Zeiger
- **WHEN** der Mauszeiger auf einem Personen-Marker liegt und live eine Person wenige Meter daneben verortet wird
- **THEN** bleibt der Marker unter dem Zeiger als Einzelmarker stehen, und es entsteht kein Bündel

#### Scenario: Sichtung ändert sich während des Zeigens
- **WHEN** der Mauszeiger über der Karte liegt und live die Sichtung einer gezeigten Person von SK III auf SK I wechselt
- **THEN** zeigt ihr Marker sofort Farbe und Kurzzeichen von SK I an derselben Stelle

#### Scenario: Entfallene Person bleibt stehen, bis der Stand angewandt wird
- **WHEN** der Mauszeiger über der Karte liegt und live eine gezeigte Person storniert wird
- **THEN** bleibt ihr Marker stehen, und der Sammelbanner nennt sie als entfallen

#### Scenario: Ein Klick oder Tipp auf die Karte hält nicht über den Fokus
- **WHEN** der Mensch auf die Karte klickt oder tippt, die Karte dabei den Fokus bekommt und Zeiger oder Finger die Ansicht danach verlassen
- **THEN** gilt der Live-Stand, und eine live verortete Person erscheint sofort

#### Scenario: Ohne Zeiger, Fokus und Auffächerung gilt der Live-Stand sofort
- **WHEN** weder Zeiger noch Fokus in der Kartenansicht liegen, kein Bündel aufgefächert ist und live eine Person verortet wird
- **THEN** erscheint ihr Marker sofort, und es steht kein Sammelbanner

### Requirement: Sammelbanner der Kartenansicht
Wartet bei geschlossener Schleuse mindestens eine Änderung, SHALL die Kopfzeile der Kartenansicht
einen Sammelbanner zeigen. Er MUST nennen, wie viele Personen neu, verlegt oder entfallen sind,
und eine Aktion „anzeigen“ bieten, die den Live-Stand anwendet. Sein Erscheinen und Verschwinden
MUST die Karte nicht verschieben.

#### Scenario: Banner nennt das Wartende
- **WHEN** bei geschlossener Schleuse live zwei Personen verortet werden und eine gezeigte Person eine andere Koordinate bekommt
- **THEN** nennt der Sammelbanner zwei neue und eine verlegte Person und bietet „anzeigen“ an

#### Scenario: „anzeigen“ wendet den Stand an
- **WHEN** der Mensch im Sammelbanner „anzeigen“ wählt
- **THEN** zeigt die Karte den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Banner verschiebt die Karte nicht
- **WHEN** der Sammelbanner bei 390 px oder 1366 px Breite erscheint oder verschwindet
- **THEN** bleibt die Oberkante der Karte auf derselben Höhe, und der CLS-Beitrag ist 0

### Requirement: Schleuse öffnet beim Verlassen
Verlassen Zeiger und Fokus die Kartenansicht und ist kein Bündel aufgefächert, SHALL die
Kartenansicht den Live-Stand anwenden. Der Weg vom Marker zum Sammelbanner MUST die Schleuse
nicht öffnen, weil Banner und Karte in derselben Kartenansicht liegen.

#### Scenario: Zeiger verlässt die Karte
- **WHEN** Änderungen warten und der Mauszeiger die Kartenansicht verlässt, ohne dass ein Bündel aufgefächert ist
- **THEN** zeigt die Karte den Live-Stand, und der Sammelbanner verschwindet

#### Scenario: Zeiger geht zum Banner
- **WHEN** Änderungen warten und der Mauszeiger von der Karte auf den Sammelbanner wandert
- **THEN** bleibt der gehaltene Stand stehen, bis der Mensch „anzeigen“ wählt oder die Kartenansicht verlässt

#### Scenario: Bedienung außerhalb bei aufgefächertem Bündel
- **WHEN** ein Bündel aufgefächert ist und der Mensch außerhalb der Kartenansicht drückt oder tippt, etwa auf einen Statusfilter
- **THEN** klappt das Bündel zu, und die Kartenansicht zeigt den Live-Stand, sodass der Filter sofort wirkt

#### Scenario: „anzeigen“ hinterlässt keine gehaltene Karte
- **WHEN** der Mensch im Sammelbanner „anzeigen“ wählt und die Kartenansicht danach verlässt
- **THEN** gilt der Live-Stand

#### Scenario: Touch mit aufgefächertem Bündel
- **WHEN** auf einem Touch-Gerät ein Bündel aufgefächert ist und live eine Person nahe dem Bündel verortet wird
- **THEN** bleibt die Auffächerung stehen, und der Zugang wartet, bis das Bündel zugeklappt ist

### Requirement: Hinweiszeile behauptet keine Vollständigkeit, solange Zugänge warten
Die Hinweiszeile der Kartenansicht SHALL „Alle angetroffenen Personen dieser Auswahl stehen auf
der Karte“ nur sagen, wenn kein Zugang wartet. Wartet einer und fehlt keiner Person die
Koordinate, MUST sie stattdessen sagen, dass keine Person ohne Koordinate ist.

#### Scenario: Letzte Lücke schließt sich bei geschlossener Schleuse
- **WHEN** bei geschlossener Schleuse die letzte Person ohne Koordinate live verortet wird
- **THEN** sagt die Hinweiszeile „Keine Person ohne Koordinate“, und der Sammelbanner nennt eine neue Person

### Requirement: Sichtung und Verbleib aus der Betroffenenliste

Die Betroffenenliste SHALL Nachsichten, Verbleib erfassen und einen Verortungsauftrag direkt aus
der Zeile anbieten, ohne Umweg über die Detailseite.
- Die Sichtungszelle MUST der Auslöser der Nachsichtung sein: Zelle, Fläche, „Übernehmen“,
  höchstens drei Tipps. Ihr zugänglicher Name nennt die Kennung der Person.
- Bei offenem Verbleib MUST die Verbleib-Zelle „Verbleib erfassen“ anbieten.
- Ein Zeilenmenü MUST „Sichten“, „Verbleib erfassen“ und „Auf Lagekarte verorten“ tragen.
- Der Zeilenklick MUST weiter die Detailseite öffnen. Eine Bedienung in Zelle, Popover oder Menü
  MUST NOT den Zeilenklick auslösen.
- Ein abgelehnter Schreibversuch MUST an seiner Zeile stehen.
- Solange ein Popover oder Menü einer Zeile offen ist, MUST die Liste Menge und Folge halten.
- Ohne Schreibrecht MUST über der Liste „Nur Ansicht“ mit Grund stehen, und die Bedienelemente
  MUST fehlen.
- Am UHS-Gerät ohne Netz MUST eine Nachsichtung oder ein Verbleib vorgemerkt werden. Die Zeile MUST
  dann „Offline vorgemerkt“ zeigen.

#### Scenario: Nachsichtung aus der Liste
- **WHEN** jemand mit Schreibrecht in der Zeile von R-007 auf die Sichtung tippt, „SK I“ wählt und
  „Übernehmen“ drückt
- **THEN** zeigt die Zeile „SK I“, die Detailseite wurde nicht geöffnet, und es waren drei Tipps

#### Scenario: Verbleib-Lücke schließen
- **WHEN** „Nur Lücken zeigen“ aktiv ist und jemand in der leeren Verbleib-Zelle „Verbleib
  erfassen“ wählt und einen Transport speichert
- **THEN** trägt die Zeile den Verbleib, und die Lückenzahl sinkt um eins

#### Scenario: Liste springt nicht unter dem Popover
- **WHEN** das Sichtungs-Popover einer Zeile offen ist und live eine neue Person hinzukommt
- **THEN** bleiben Menge und Folge der Liste, bis das Popover geschlossen ist

#### Scenario: Ohne Schreibrecht
- **WHEN** ein Beobachter die Betroffenenliste öffnet
- **THEN** steht über der Liste „Nur Ansicht“ mit Grund, und die Zeilen tragen weder
  Sichtungsauslöser noch „Verbleib erfassen“ noch Zeilenmenü

#### Scenario: Zeilen-Sichtung am Tablet ohne Netz
- **WHEN** am UHS-Tablet ohne Netz in der Patientenliste bei R-007 „SK I“ übernommen wird
- **THEN** zeigt die Zeile „Offline vorgemerkt“, und die Sichtung wird bei Verbindung übertragen

### Requirement: PAT-Nummer und Kontamination an der Person

Eine Person SHALL eine PAT-Nummer tragen können, also die Nummer der Papier-Patientenanhängetasche.
Sie dient dem Abgleich. Sie ist ein kurzer Freitext mit fester Höchstlänge und MUST NOT eindeutig
sein müssen. Eine Person SHALL außerdem eine Kontamination tragen können, mit den Werten „ja“,
„nein“ oder „keine Angabe“. Beide Felder MUST sich einzeln ändern und leeren lassen, ohne andere
Felder zu berühren. Die Suche der Betroffenenliste MUST eine Person über ihre PAT-Nummer finden.
Eine Kontamination „ja“ MUST in Liste und Patientenkopf als Marke „kontaminiert“ mit Wort stehen.

#### Scenario: Suche nach der PAT-Nummer
- **WHEN** an R-012 die PAT-Nummer „A-4711“ eingetragen ist und jemand in der Betroffenenliste
  „4711“ sucht
- **THEN** steht R-012 in der Trefferliste

#### Scenario: Kontamination nicht geprüft
- **WHEN** an einer Person keine Kontamination angegeben ist
- **THEN** trägt sie keine Marke, und die Angabe gilt nicht als „nein“

#### Scenario: Über der Grenze
- **WHEN** eine PAT-Nummer über der Höchstlänge geschickt wird
- **THEN** antwortet der Server mit 400, und das Feld zeigt den Fehler

### Requirement: Abgeschlossene stehen nicht in den Standardansichten
Die Betroffenenseite SHALL Personen mit `versorgung: "abgeschlossen"` in Zeilen, Sichtungsraster
und Kartenansicht nur zeigen, wenn „Abgeschlossene zeigen“ an ist. Der Schalter MUST aus als
Vorgabe stehen und die Zahl der Abgeschlossenen nennen; ohne Abgeschlossene MUST er fehlen,
solange er aus ist; ein Link mit `?abgeschlossen=1` MUST die
Seite mit eingeschaltetem Schalter öffnen. Sichtungszeile und Sichtungsbild der Seitenleiste MUST nur
Nicht-Abgeschlossene zählen. Detailseite, Sprungpalette, Druck und CSV MUST alle Personen finden.

#### Scenario: Entlassener verschwindet aus der Liste
- **WHEN** für R-004 der Verbleib „Entlassung vor Ort“ gespeichert wird
- **THEN** verlässt R-004 die Zeilen, sobald niemand mehr mit der Liste arbeitet, und der Schalter nennt „Abgeschlossene zeigen (1)“

#### Scenario: Abgeschlossene zurückholen
- **WHEN** jemand „Abgeschlossene zeigen“ einschaltet oder die Seite mit `?abgeschlossen=1` öffnet
- **THEN** steht R-004 wieder in den Zeilen

#### Scenario: Unterwegs bleibt sichtbar
- **WHEN** R-008 im Eigentransport unterwegs ist
- **THEN** steht R-008 in Zeilen, Raster und Sichtungszeile, auch mit ausgeschaltetem Schalter

#### Scenario: Sprungpalette findet Abgeschlossene
- **WHEN** jemand in der Sprungpalette „R-004“ sucht
- **THEN** findet die Palette R-004 und öffnet die Detailseite mit vollständigem Verlauf
