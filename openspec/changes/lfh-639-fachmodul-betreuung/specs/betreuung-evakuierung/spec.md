# Spec Delta

## Purpose

Die Einsatzleitung führt je Evakuierungsbezirk, wie viele Menschen evakuiert werden sollen
und wie viele es sind. Sie führt je Betreuungsstelle, wie viele Menschen dort untergebracht
sind. Beides wird als Menge gemeldet, nicht über einzeln erfasste Personen. Jede Meldung
ist im Einsatztagebuch nachgewiesen, wird live verteilt und speist die Kennzahl „Evakuiert
N · von M geplant“ sowie die Kopfzahl „in Betreuung“ für die Verpflegung.

## ADDED Requirements

### Requirement: Evakuierungsbezirk

Das System SHALL je Einsatz Evakuierungsbezirke führen. Ein Bezirk trägt eine Bezeichnung
(Pflicht, eindeutig unter den nicht stornierten Bezirken des Einsatzes), optional einen
Einsatzabschnitt desselben Einsatzes, eine Plangröße in Personen (Pflicht, ganzzahlig
≥ 1), die Erhebungsart der Plangröße (`gezaehlt` oder `geschaetzt`), optional eine
Sammelstelle und eine Notiz sowie einen Räumungszustand (`angeordnet`, `laeuft`,
`geraeumt`, `aufgehoben`; Vorgabe `angeordnet`). Die Anlage MUST als ETB-Eintrag vom Typ
Entscheidung festgehalten werden, der Bezeichnung und Plangröße nennt.

#### Scenario: Bezirk anlegen
- **WHEN** eine Person mit Schreibrecht den Bezirk „Uferstraße 12–40“ mit Plangröße 640, geschätzt, anlegt
- **THEN** entsteht ein Bezirk im Zustand `angeordnet` ohne Standmeldung
- **AND** das ETB enthält einen Entscheidungseintrag mit „Uferstraße 12–40“ und „640“

#### Scenario: Plangröße fehlt oder ist kleiner als 1
- **WHEN** ein Bezirk ohne Plangröße oder mit Plangröße 0 oder negativ angelegt wird
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Leere Bezeichnung
- **WHEN** ein Bezirk mit leerer oder nur aus Leerzeichen bestehender Bezeichnung angelegt wird
- **THEN** antwortet das System mit 400

#### Scenario: Doppelte Bezeichnung
- **WHEN** ein zweiter nicht stornierter Bezirk mit derselben Bezeichnung angelegt wird
- **THEN** antwortet das System mit 409 und legt nichts an

#### Scenario: Abschnitt eines anderen Einsatzes
- **WHEN** der angegebene Einsatzabschnitt nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

### Requirement: Bezirk fortschreiben

Das System SHALL Bezeichnung, Einsatzabschnitt, Plangröße mit Erhebungsart,
Räumungszustand, Sammelstelle und Notiz eines nicht stornierten Bezirks änderbar machen.
Eine Änderung der Plangröße oder ihrer Erhebungsart MUST einen ETB-Eintrag vom Typ
Entscheidung schreiben, der neuen und vorherigen Wert nennt. Ein Wechsel des
Räumungszustands MUST einen ETB-Eintrag schreiben: vom Typ Entscheidung beim Wechsel nach
`angeordnet` oder `aufgehoben`, vom Typ Meldung beim Wechsel nach `laeuft` oder
`geraeumt`. Eine Änderung, die keinen Wert tatsächlich verändert, MUST keinen ETB-Eintrag
erzeugen.

#### Scenario: Plangröße fortschreiben
- **WHEN** die Plangröße von „Uferstraße 12–40“ von 640 auf 820 gesetzt wird
- **THEN** trägt der Bezirk die Plangröße 820
- **AND** das ETB enthält einen Entscheidungseintrag mit „820“ und „vorher 640“

#### Scenario: Bezirk geräumt
- **WHEN** der Räumungszustand auf `geraeumt` gesetzt wird
- **THEN** enthält das ETB einen Meldungseintrag, der Bezirk und Zustand „geräumt“ nennt

#### Scenario: Unveränderte Werte
- **WHEN** ein PATCH dieselben Werte schickt, die der Bezirk bereits trägt
- **THEN** antwortet das System erfolgreich und schreibt keinen ETB-Eintrag

#### Scenario: Unbekannter Räumungszustand
- **WHEN** ein Räumungszustand außerhalb der vier Werte gesendet wird
- **THEN** antwortet das System mit 400

#### Scenario: Stornierter Bezirk
- **WHEN** ein stornierter Bezirk geändert werden soll
- **THEN** antwortet das System mit 409

### Requirement: Bezirk stornieren

Das System SHALL einen Bezirk stornieren können (Fehlanlage). Ein stornierter Bezirk MUST
in keiner Summe und keiner Kennzahl mehr zählen und MUST keine Standmeldung mehr annehmen.
Die Stornierung MUST als ETB-Eintrag festgehalten werden. Die Bezeichnung eines
stornierten Bezirks MUST für einen neuen Bezirk wieder frei sein.

#### Scenario: Stornieren
- **WHEN** der Bezirk „Uferstraße 12–40“ storniert wird
- **THEN** erscheint er nicht mehr in der Bezirksliste
- **AND** das ETB enthält einen Eintrag zur Stornierung

#### Scenario: Doppelt stornieren
- **WHEN** ein bereits stornierter Bezirk erneut storniert wird
- **THEN** antwortet das System mit 409

### Requirement: Stand „evakuiert“ melden

Das System SHALL je Bezirk Standmeldungen führen. Eine Standmeldung trägt eine absolute
Anzahl evakuierter Personen (ganzzahlig ≥ 0), die Erhebungsart (`gezaehlt` oder
`geschaetzt`) und einen Zeitpunkt (Vorgabe: jetzt, nicht in der Zukunft). Meldungen MUST
append-only gespeichert werden. Der aktuelle Stand eines Bezirks MUST die nicht
zurückgenommene Meldung mit dem jüngsten Zeitpunkt sein (bei gleichem Zeitpunkt die
zuletzt erfasste). Jede Meldung MUST in derselben Transaktion einen ETB-Eintrag vom Typ
Meldung schreiben, der Bezirk, neue Anzahl, vorherigen aktuellen Stand, Erhebungsart und
Plangröße nennt. Liegt der Zeitpunkt der Meldung vor dem der aktuellen Meldung
(Nachtragung), MUST der Eintrag stattdessen die Meldung als nachgetragen kennzeichnen und
den unverändert bleibenden aktuellen Stand nennen, nicht als vorherigen Wert. Sein
Ereigniszeitpunkt ist der Zeitpunkt der Meldung. Die Anzahl MUST die Plangröße übersteigen
dürfen.

#### Scenario: Erste Meldung
- **WHEN** für „Uferstraße 12–40“ (Plan 640) 212 evakuiert, gezählt, gemeldet wird
- **THEN** ist der aktuelle Stand 212
- **AND** das ETB enthält einen Meldungseintrag mit „212“, „gezählt“ und „640“

#### Scenario: Fortschreibung nennt den Vorwert
- **WHEN** bei aktuellem Stand 212 eine neue Meldung mit 480 eingeht
- **THEN** ist der aktuelle Stand 480
- **AND** der ETB-Eintrag nennt „480“ und „vorher 212“

#### Scenario: Nachgetragene ältere Meldung
- **WHEN** eine Meldung mit einem Zeitpunkt vor der jüngsten vorhandenen Meldung eingeht
- **THEN** bleibt der aktuelle Stand unverändert
- **AND** die Meldung ist gespeichert und im ETB mit ihrem Ereigniszeitpunkt nachgewiesen
- **AND** der ETB-Eintrag nennt „nachgetragen“ und den bleibenden aktuellen Stand, kein „vorher“

#### Scenario: Stand über der Plangröße
- **WHEN** bei Plangröße 640 der Stand 700 gemeldet wird
- **THEN** ist der aktuelle Stand 700 und das System lehnt nicht ab

#### Scenario: Negative Anzahl oder Zeitpunkt in der Zukunft
- **WHEN** eine Meldung mit negativer Anzahl oder mit einem Zeitpunkt in der Zukunft eingeht
- **THEN** antwortet das System mit 400 und speichert nichts

#### Scenario: Meldung an storniertem Bezirk
- **WHEN** für einen stornierten Bezirk ein Stand gemeldet wird
- **THEN** antwortet das System mit 409 und speichert nichts

### Requirement: Standmeldung zurücknehmen

Das System SHALL eine Standmeldung zurücknehmen können. Die Meldung MUST gespeichert
bleiben und als zurückgenommen gekennzeichnet werden. Der aktuelle Stand MUST danach aus
den verbleibenden Meldungen neu bestimmt werden. Die Rücknahme MUST einen ETB-Eintrag vom
Typ Berichtigung schreiben, der auf den ETB-Eintrag der Meldung verweist. War die
zurückgenommene Meldung nicht die aktuelle, MUST der Eintrag sagen, dass der Stand bleibt,
und darf keine Änderung des Stands unterstellen.

#### Scenario: Letzte Meldung zurücknehmen
- **WHEN** bei den Meldungen 212 und 480 die Meldung 480 zurückgenommen wird
- **THEN** ist der aktuelle Stand wieder 212
- **AND** das ETB enthält eine Berichtigung zum Eintrag der Meldung 480

#### Scenario: Einzige Meldung zurücknehmen
- **WHEN** die einzige Meldung eines Bezirks zurückgenommen wird
- **THEN** hat der Bezirk keinen aktuellen Stand mehr

#### Scenario: Nicht aktuelle Meldung zurücknehmen
- **WHEN** bei aktuellem Stand 480 eine ältere oder nachgetragene Meldung zurückgenommen wird
- **THEN** bleibt der aktuelle Stand 480
- **AND** die Berichtigung nennt „bleibt 480“, kein „wieder“

#### Scenario: Doppelt zurücknehmen
- **WHEN** eine bereits zurückgenommene Meldung erneut zurückgenommen wird
- **THEN** antwortet das System mit 422 und ändert nichts

### Requirement: Betreuungsstelle

Das System SHALL je Einsatz Betreuungsstellen führen. Eine Stelle trägt eine Bezeichnung
(Pflicht, eindeutig unter den nicht stornierten Stellen des Einsatzes), eine Art
(`anlaufstelle`, `betreuungsstelle`, `betreuungsplatz`, `notunterkunft`), optional einen
Einsatzabschnitt desselben Einsatzes, optional eine Kapazität in Personen (ganzzahlig ≥ 1),
optional Standort und Notiz sowie einen Status (`vorbereitet`, `in_betrieb`,
`geschlossen`; Vorgabe `vorbereitet`). Anlage, Änderung, Statuswechsel und Stornierung
MUST je einen ETB-Eintrag schreiben, sofern sich ein Wert tatsächlich ändert. Eine Stelle
MUST nur dann in den Status `geschlossen` wechseln können, wenn ihre aktuelle Belegung 0 ist
oder sie keine Belegungsmeldung hat.

#### Scenario: Stelle anlegen
- **WHEN** die Notunterkunft „Turnhalle Ost“ mit Kapazität 150 angelegt wird
- **THEN** entsteht eine Stelle im Status `vorbereitet` ohne Belegung

#### Scenario: Stelle ohne Kapazität
- **WHEN** eine Stelle ohne Kapazität angelegt wird
- **THEN** wird sie angelegt, und für sie wird keine Zahl freier Plätze ausgewiesen

#### Scenario: Schließen mit Belegung
- **WHEN** eine Stelle mit aktueller Belegung 40 auf `geschlossen` gesetzt wird
- **THEN** antwortet das System mit 422 und ändert den Status nicht

#### Scenario: Schließen nach Leermeldung
- **WHEN** für eine Stelle zuerst Belegung 0 gemeldet und sie danach auf `geschlossen` gesetzt wird
- **THEN** ist sie geschlossen

#### Scenario: Unbekannte Art oder Kapazität kleiner als 1
- **WHEN** eine Stelle mit unbekannter Art oder Kapazität 0 angelegt wird
- **THEN** antwortet das System mit 400

#### Scenario: Stornierte Stelle
- **WHEN** eine stornierte Stelle geändert, erneut storniert oder mit einer Belegung gemeldet werden soll
- **THEN** antwortet das System mit 409

#### Scenario: Geschlossene Stelle wieder öffnen
- **WHEN** eine geschlossene Stelle auf `in_betrieb` gesetzt wird
- **THEN** ist sie wieder in Betrieb und nimmt Belegungsmeldungen an

### Requirement: Belegung melden

Das System SHALL je Betreuungsstelle Belegungsmeldungen führen. Eine Belegungsmeldung trägt
eine absolute Anzahl untergebrachter Personen (ganzzahlig ≥ 0) und einen Zeitpunkt
(Vorgabe: jetzt, nicht in der Zukunft). Meldungen MUST append-only gespeichert werden. Die
aktuelle Belegung MUST die nicht zurückgenommene Meldung mit dem jüngsten Zeitpunkt sein.
Jede Meldung MUST in derselben Transaktion einen ETB-Eintrag vom Typ Meldung schreiben, der
Stelle, neue Anzahl, vorherige aktuelle Belegung und, falls gesetzt, die Kapazität nennt;
eine nachgetragene Meldung nennt wie beim Stand „nachgetragen“ und die bleibende aktuelle
Belegung statt eines vorherigen Werts.
Eine Meldung an eine Stelle im Status `geschlossen` MUST abgelehnt werden. Die Anzahl MUST
die Kapazität übersteigen dürfen. Belegungsmeldungen MUST sich wie Standmeldungen
zurücknehmen lassen.

#### Scenario: Belegung melden
- **WHEN** für „Turnhalle Ost“ (Kapazität 150) eine Belegung von 89 gemeldet wird
- **THEN** ist die aktuelle Belegung 89
- **AND** das ETB enthält einen Meldungseintrag mit „89“ und „150“

#### Scenario: Überbelegung
- **WHEN** bei Kapazität 150 eine Belegung von 170 gemeldet wird
- **THEN** ist die aktuelle Belegung 170 und das System lehnt nicht ab

#### Scenario: Geschlossene Stelle
- **WHEN** für eine geschlossene Stelle eine Belegung gemeldet oder eine Belegungsmeldung zurückgenommen wird
- **THEN** antwortet das System mit 422 und ändert nichts

### Requirement: Kopfzahl in Betreuung zu einem Zeitpunkt

Das System SHALL für einen Einsatz und einen Zeitpunkt t (Vorgabe: jetzt) die Kopfzahl „in
Betreuung“ liefern: je nicht stornierter Stelle die Anzahl der nicht zurückgenommenen
Belegungsmeldung mit dem jüngsten Zeitpunkt ≤ t samt diesem Meldezeitpunkt, dazu die Summe
über alle Stellen. Stellen ohne Meldung ≤ t MUST ohne Anzahl ausgewiesen und nicht als 0
summiert werden. Die Antwort MUST keinen Personenbezug enthalten.

Als Stelle ohne Meldung MUST nur eine Stelle gelten, die zu t betrieben sein konnte (LFH-679):
Eine nach t angelegte Stelle MUST fehlen, ebenso eine Stelle, die jetzt geschlossen oder
vorbereitet ist und nie eine nicht zurückgenommene Meldung hatte. Eine Stelle mit Meldung ≤ t
MUST unabhängig davon mitzählen, auch wenn die Meldung vor ihrer Anlage liegt.

#### Scenario: Kopfzahl zum Schichtbeginn
- **WHEN** „Turnhalle Ost“ um 12:00 mit 60 und um 14:00 mit 89 gemeldet ist und „Weserstadion“ um 13:00 mit 84, und die Kopfzahl für 13:30 abgefragt wird
- **THEN** liefert das System 60 für „Turnhalle Ost“, 84 für „Weserstadion“ und die Summe 144

#### Scenario: Stelle ohne Meldung
- **WHEN** eine Stelle in Betrieb vor t angelegt ist und vor t keine Belegungsmeldung hat
- **THEN** ist sie ohne Anzahl ausgewiesen und die Summe enthält sie nicht

#### Scenario: Stelle nach dem Stichtag angelegt
- **WHEN** eine Stelle ohne Meldung ≤ t erst nach t angelegt wurde
- **THEN** fehlt sie in der Antwort und zählt nicht als Stelle ohne Meldung

#### Scenario: Nie belegte geschlossene oder vorbereitete Stelle
- **WHEN** eine Stelle jetzt geschlossen oder vorbereitet ist und nie eine nicht zurückgenommene Meldung hatte
- **THEN** fehlt sie in der Antwort und zählt nicht als Stelle ohne Meldung

#### Scenario: Geschlossene Stelle mit späterer Meldung
- **WHEN** eine jetzt geschlossene Stelle erst nach t gemeldet hat
- **THEN** zählt sie als Stelle ohne Meldung, weil ohne Statushistorie offen ist, ob sie zu t schon betrieben wurde

#### Scenario: Ungültiger Zeitpunkt
- **WHEN** der Zeitpunkt nicht als Datum mit Uhrzeit lesbar ist
- **THEN** antwortet das System mit 400

### Requirement: Kennzahl „Evakuiert N · von M geplant“

Das System SHALL aus den Bezirken eines Einsatzes eine Kennzahl ableiten. Maßgeblich sind die
nicht stornierten Bezirke, deren Räumungszustand nicht `aufgehoben` ist. N ist die Summe
ihrer aktuellen Stände, M die Summe ihrer Plangrößen. Gibt es keinen solchen Bezirk, MUST
keine Kennzahl entstehen. Ein Bezirk ohne Standmeldung MUST nicht als 0 in N eingehen,
sondern als „ohne Meldung“ ausgewiesen werden. Ist ein beteiligter Stand oder eine
beteiligte Plangröße geschätzt, MUST die Kennzahl als geschätzt gekennzeichnet sein.
N MUST nicht auf M gedeckelt werden. Ein fehlgeschlagener Abruf MUST als Fehler gelten und
nie als „keine Kennzahl“.

#### Scenario: Zwei Bezirke
- **WHEN** Bezirk A (Plan 640, Stand 600, gezählt) und Bezirk B (Plan 1 210, Stand 720, gezählt) aktiv sind
- **THEN** lautet die Kennzahl „1 320 · von 1 850 geplant“, nicht als geschätzt gekennzeichnet

#### Scenario: Keine geplante Evakuierung
- **WHEN** der Einsatz keinen Bezirk hat oder alle Bezirke storniert oder aufgehoben sind
- **THEN** entsteht keine Kennzahl

#### Scenario: Bezirk ohne Meldung
- **WHEN** Bezirk A (Plan 640, Stand 600) und Bezirk B (Plan 1 210, ohne Meldung) aktiv sind
- **THEN** lautet N 600 und M 1 850, und die Kennzahl weist einen Bezirk ohne Meldung aus

#### Scenario: Geschätzter Anteil
- **WHEN** ein beteiligter Stand als geschätzt gemeldet ist
- **THEN** ist die Kennzahl als geschätzt gekennzeichnet

### Requirement: Live-Verteilung

Jede Änderung an Bezirken, Standmeldungen, Stellen oder Belegungen MUST nach dem Commit ein
Live-Ereignis `betreuung` an alle verbundenen Clients des Einsatzes auslösen, die das Modul
Betreuung lesen dürfen. Die Nutzlast MUST nur Kennungen tragen, keine Anzahlen,
Bezeichnungen oder Freitexte. Der zugehörige ETB-Eintrag MUST zusätzlich als ETB-Ereignis
verteilt werden.

#### Scenario: Zweiter Client sieht den neuen Stand
- **WHEN** Client A einen Stand meldet, während Client B die Betreuungsseite desselben Einsatzes geöffnet hat
- **THEN** zeigt Client B den neuen Stand ohne Neuladen

#### Scenario: Leser ohne Modulrecht
- **WHEN** einem verbundenen Benutzer das Modul Betreuung ausgeblendet ist
- **THEN** erhält er das Ereignis `betreuung` nicht

### Requirement: Rechte

Lesende Endpunkte des Moduls MUST Lesezugriff auf den Einsatz und das Modul Betreuung
verlangen. Schreibende Endpunkte MUST zusätzlich Schreibrecht und einen aktiven Einsatz
verlangen. Die Oberfläche MUST ohne Schreibrecht einen Hinweis mit Grund zeigen und die
Primäraktion gesperrt stehen lassen.

#### Scenario: Beobachter schreibt
- **WHEN** ein Benutzer ohne Schreibrecht einen Stand meldet
- **THEN** antwortet das System mit 403

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Betreuung für den Einsatz ausgeblendet ist und ein Nicht-Admin die Bezirke abruft
- **THEN** antwortet das System mit 403

#### Scenario: Fremde Organisation
- **WHEN** ein Benutzer einer anderen Organisation die Bezirke eines Einsatzes abruft
- **THEN** antwortet das System mit 403 oder 404 und gibt keine Daten des Einsatzes preis

### Requirement: Schwärzung

Beim Schwärzen eines Einsatzes MUST das System Freitexte mit möglichem Personen- oder
Adressbezug entfernen: Bezeichnungen von Bezirken und Stellen durch Platzhalter ersetzen,
Sammelstelle, Standort und Notiz leeren. Anzahlen, Plangrößen, Kapazitäten, Zustände,
Arten und Zeitpunkte MUST erhalten bleiben.

#### Scenario: Einsatz schwärzen
- **WHEN** ein Einsatz mit Bezirk „Uferstraße 12–40“ und Stelle „Turnhalle Ost, Ostring 5“ geschwärzt wird
- **THEN** tragen Bezirk und Stelle Platzhalter-Bezeichnungen, Sammelstelle, Standort und Notiz sind leer
- **AND** Plangröße, Stände, Kapazität und Belegungen sind unverändert
