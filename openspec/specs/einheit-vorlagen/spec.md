# einheit-vorlagen Specification

## Purpose
Stehende Einheiten einer Organisation (etwa ein Sanitätszug mit seinen Staffeln) werden als
Einheiten-Vorlagen in den Stammdaten gepflegt: Name, Einheitstyp, taktisches Zeichen, Soll-Stärke,
Unterstellung, Stamm-Fahrzeuge und Stammbesetzung. Die Spec legt Katalog, Rechte, Baumregeln,
Zuordnungen und die Pflege in der Verwaltung fest (LLH-1042).

## Requirements

### Requirement: Katalog der Einheiten-Vorlagen
Das System SHALL je Organisation einen Katalog von Einheiten-Vorlagen führen. Eine Vorlage MUST
einen Namen und einen Einheitstyp der eigenen Organisation tragen und MAY Funkrufname, taktisches
Zeichen (Fachaufgabe, Organisation), Soll-Stärke F/UF/M, Bemerkung und Sortierung tragen. Die
Soll-Stärke MUST entweder in allen drei Werten oder in keinem gesetzt sein; ohne eigenes Soll
MUST die Antwort das Soll des Einheitstyps als wirksames Soll melden. Unter den aktiven Vorlagen
einer Organisation MUST der Name eindeutig sein (409 bei Dublette). Eine Vorlage MUST NOT gelöscht
werden; sie wird deaktiviert und kann wieder aktiviert werden.

#### Scenario: Vorlage anlegen
- **WHEN** der Admin eine Vorlage „Sanitätszug Musterstadt“ mit Typ „Zug“ ohne eigenes Soll anlegt
- **THEN** antwortet das System mit 201, und die Liste meldet als Soll das Soll des Typs „Zug“

#### Scenario: Unvollständiges Soll
- **WHEN** der Admin nur Führer und Mannschaft als Soll schickt
- **THEN** antwortet das System mit 400 und legt nichts an

#### Scenario: Name doppelt
- **WHEN** der Admin eine zweite aktive Vorlage mit demselben Namen anlegt
- **THEN** antwortet das System mit 409

#### Scenario: Deaktivierte Vorlage
- **WHEN** der Admin eine Vorlage deaktiviert
- **THEN** fehlt sie in der Liste ohne `nur_aktive=false` und erscheint mit ihr als inaktiv

### Requirement: Rechte und Organisationsgrenze
Lesen SHALL jedem angemeldeten Mitglied der Organisation offenstehen; Anlegen, Ändern und
Zuordnen MUST dem Admin vorbehalten sein (403 sonst). Jede Anfrage MUST auf die eigene
Organisation begrenzt sein: Vorlagen, Typen, Fahrzeuge und Personen anderer Organisationen MUST
wie nicht vorhanden behandelt werden (404 für die Vorlage, 422 für einen Verweis).

#### Scenario: Einsatzkraft liest
- **WHEN** ein Mitglied ohne Admin-Recht die Vorlagen abfragt
- **THEN** erhält es die aktiven Vorlagen seiner Organisation

#### Scenario: Einsatzkraft schreibt
- **WHEN** ein Mitglied ohne Admin-Recht eine Vorlage ändert
- **THEN** antwortet das System mit 403

#### Scenario: Fremdes Fahrzeug
- **WHEN** der Admin einer Vorlage ein Fahrzeug einer anderen Organisation zuordnet
- **THEN** antwortet das System mit 422 und ändert nichts

### Requirement: Untereinheiten
Eine Vorlage SHALL einer anderen Vorlage derselben Organisation unterstellt werden können, in
beliebiger Tiefe. Eine Unterstellung, die einen Zyklus bildet, MUST mit 422 abgelehnt werden.

#### Scenario: Zug mit Staffel
- **WHEN** der Admin „Rettungsstaffel“ unter „Sanitätszug Musterstadt“ stellt
- **THEN** meldet die Liste „Rettungsstaffel“ mit dem Verweis auf den Zug

#### Scenario: Zyklus
- **WHEN** der Admin den Zug unter seine eigene Staffel stellen will
- **THEN** antwortet das System mit 422 und die Unterstellung bleibt unverändert

### Requirement: Fahrzeuge und Stammbesetzung der Vorlage
Das System SHALL je Vorlage eine Liste von Stamm-Fahrzeugen und eine Stammbesetzung aus dem
Personalstamm führen; je Person MAY ein Fahrzeug derselben Vorlage und eine Position F/UF/M
stehen. Beide Listen MUST als Ganzes ersetzt werden. Ein Fahrzeug oder eine Person MUST im selben
Vorlagen-Baum höchstens einmal vorkommen (422). Neu zugeordnet werden MUST NOT Fahrzeuge oder
Personen, die außer Dienst stehen (422). Entfernt eine Änderung ein Fahrzeug aus der Vorlage, MUST
die Fahrzeugbindung der Personen darauf in derselben Änderung entfallen. Jeder Eintrag MUST in der
Antwort seinen Dienststatus und die anderen aktiven Vorlagen nennen, in denen er ebenfalls steht.

#### Scenario: Fahrzeug in zwei Zügen
- **WHEN** das Fahrzeug „Musterstadt 83-1“ in zwei verschiedenen Vorlagen-Bäumen steht
- **THEN** sind beide Zuordnungen gespeichert, und jede Antwort nennt die andere Vorlage unter „auch in“

#### Scenario: Fahrzeug doppelt im selben Baum
- **WHEN** der Admin der Staffel ein Fahrzeug zuordnet, das schon am übergeordneten Zug steht
- **THEN** antwortet das System mit 422

#### Scenario: Person auf fremdem Fahrzeug
- **WHEN** der Admin eine Person der Stammbesetzung an ein Fahrzeug bindet, das nicht zur Vorlage gehört
- **THEN** antwortet das System mit 422

#### Scenario: Später außer Dienst
- **WHEN** ein Fahrzeug einer Vorlage im Stamm außer Dienst gestellt wird
- **THEN** bleibt es in der Vorlage, und die Antwort meldet seinen Dienststatus „außer Dienst“

### Requirement: Pflege in der Verwaltung
Die Verwaltung SHALL unter Stammdaten eine Sektion „Einheiten-Vorlagen“ mit einer Liste (Name,
Typ, Unterstellung, Fahrzeuge, Soll, Demo-Marke) und eine Detailseite je Vorlage zeigen, auf der
Kopfdaten, Untereinheiten, Fahrzeuge und Stammbesetzung gepflegt werden. Warnungen („auch in …“,
„außer Dienst“) MUST als Wort sichtbar sein, nicht nur als Farbe. Ohne Admin-Recht MUST die Seite
nur lesen lassen und das benennen.

#### Scenario: Warnung sichtbar
- **WHEN** ein Fahrzeug der Vorlage auch in einer anderen Vorlage steht
- **THEN** zeigt die Detailseite am Fahrzeug „auch in <Vorlage>“

### Requirement: Vorschau im Einsatz
Das System SHALL zu einer Vorlage im Einsatz eine Vorschau liefern: die aktiven Einheiten des
Baums und je Fahrzeug und Person der Vorlage den Zustand im Einsatz als einen von „neu“, „frei“,
„gebunden“ (mit Einheit oder Fahrzeug), „außer Dienst“, „entlassen“. Eine stornierte Kraft MUST
als „neu“ gelten. Die Vorschau MUST NOT etwas schreiben; maßgeblich bleibt die Prüfung beim
Bilden.

#### Scenario: Fahrzeug in anderer Einheit
- **WHEN** RTW 2 im Einsatz dem „2. Zug“ angehört
- **THEN** meldet die Vorschau RTW 2 als gebunden mit „2. Zug“

### Requirement: Vorschau achtet die Modulfreigabe
Fahrzeug- und Personenzeilen der Vorschau MUST nur erscheinen, wenn das jeweilige Modul für die
Rolle freigegeben ist; sonst MUST die Vorschau den Teil als gesperrt melden.

#### Scenario: Personal gesperrt
- **WHEN** die Rolle das Modul Personal nicht freigegeben hat
- **THEN** enthält die Vorschau keine Personen und meldet das Personal als gesperrt

### Requirement: Vorlage im Dialog „Einheit bilden“
Der Dialog „Einheit bilden“ SHALL als erstes Feld „Vorlage“ zeigen, wenn es aktive Vorlagen gibt.
Ohne Vorlage MUST er unverändert Name und Typ erfragen, mit Vorlage MUST er auf eine eigene Seite
führen.

#### Scenario: Ohne Vorlage
- **WHEN** die Führung im Dialog keine Vorlage wählt
- **THEN** bildet sie die Einheit wie bisher mit Name und Typ

### Requirement: Seite zum Bilden aus der Vorlage
Die Seite SHALL den Namen der obersten Einheit (vorbelegt, änderbar), den Abschnitt und den Baum
der Vorlage mit einem Häkchen je Fahrzeug (Vorgabe an) und je Person (Vorgabe aus) zeigen. Jede
Zeile MUST ihren Zustand als Wort tragen; eine gebundene Kraft MUST nur über ein Häkchen
„umhängen“ wählbar sein, eine außer Dienst stehende MUST gesperrt sein. Eine Person, deren
Fahrzeug nicht mitkommt, MUST „ohne Fahrzeug“ zeigen.

#### Scenario: Vorgaben der Häkchen
- **WHEN** die Führung „Sanitätszug Musterstadt“ wählt und keine Kraft im Einsatz ist
- **THEN** sind alle Fahrzeuge angehakt, keine Person, und die Zusammenfassung nennt „1 Zug, 1 Staffel, 3 Fahrzeuge, 0 Kräfte“

#### Scenario: Fahrzeug abgewählt
- **WHEN** die Führung RTW 1 abwählt und eine Person der Vorlage auf RTW 1 anhakt
- **THEN** zeigt die Person „ohne Fahrzeug“

### Requirement: Rückmeldung der Seite
Ein gleichnamiger aktiver Name MUST als Warnung am Feld stehen, ohne zu sperren. Gründe einer
Ablehnung MUST an der Zeile stehen, nicht als Toast. Nach dem Bilden MUST das Meldebild mit der
neuen Einheit öffnen, ohne Freigabe des Meldebilds die Ansicht der Einheit.

#### Scenario: Gleicher Name
- **WHEN** im Einsatz schon eine aktive Einheit „Sanitätszug Musterstadt“ besteht
- **THEN** zeigt das Namensfeld „Name schon vergeben“, und „Einheit bilden“ bleibt wählbar

#### Scenario: Grund an der Zeile
- **WHEN** das Bilden mit 422 abgelehnt wird, weil RTW 2 inzwischen dem „2. Zug“ angehört
- **THEN** steht der Grund an der Zeile von RTW 2, und es erscheint kein Toast
