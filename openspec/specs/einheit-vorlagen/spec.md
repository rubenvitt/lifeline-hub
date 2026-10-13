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
