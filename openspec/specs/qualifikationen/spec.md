# qualifikationen Specification

## Purpose
Der Qualifikations-Katalog einer Organisation kennt, welche Qualifikation welche andere
einschließt. Einheitentyp, Einheiten-Vorlage, Einheit und UHS können ein Soll an Qualifikationen
tragen. Eine Rechenregel sagt, welche geforderten Qualifikationen eine Gruppe von Personen deckt
(LLH-1553, Konzept LLH-1523).

## Requirements

### Requirement: Einschluss im Katalog
Eine Qualifikation SHALL höchstens eine andere Qualifikation derselben Organisation direkt
einschließen können (`schliesst_ein_id`). Der Einschluss MUST transitiv gelten. Ein Verweis auf
sich selbst, auf eine fremde Organisation oder einer, der einen Kreis bildete, MUST mit 422
abgelehnt werden. Pflegen MUST dem Admin vorbehalten sein.

#### Scenario: Kette
- **WHEN** Notfallsanitäter Rettungssanitäter einschließt und Rettungssanitäter Sanitäter
- **THEN** deckt eine Person mit „Notfallsanitäter“ die Anforderung „Sanitäter“

#### Scenario: Kreis
- **WHEN** der Admin bei Sanitäter „schließt ein: Notfallsanitäter“ setzt, während die Kette oben besteht
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Ohne Einschluss
- **WHEN** eine Qualifikation nichts einschließt
- **THEN** deckt sie nur sich selbst

### Requirement: Startliste mit Ketten
Die Startliste neuer Organisationen SHALL die Ketten Notfallsanitäter → Rettungssanitäter →
Sanitäter und Zugführer → Gruppenführer → Truppführer enthalten. Notarzt MUST nichts
einschließen. Bei bestehenden Organisationen MUST die Migration dieselben Ketten nur setzen, wo
beide Labels exakt der Startliste gleichen und noch kein Einschluss gesetzt ist.

#### Scenario: Eigenes Label
- **WHEN** eine Organisation „Rettungssanitäter/in“ statt „Rettungssanitäter“ führt
- **THEN** bekommt diese Qualifikation durch die Migration keinen Einschluss

### Requirement: Qualifikationssoll
Einheitentyp, Einheiten-Vorlage, Einheit im Einsatz und UHS SHALL ein Qualifikationssoll tragen
können: eine Liste aus Qualifikation und Anzahl, höchstens 10 Einträge, Anzahl 1 bis 50, jede
Qualifikation höchstens einmal, nur Qualifikationen der eigenen Organisation (422 sonst). Eine
leere Liste MUST als „kein Soll“ gespeichert werden. Die UHS SHALL zusätzlich eine Soll-Anzahl
(1 bis 200) tragen können.

#### Scenario: Fremde Qualifikation
- **WHEN** ein Qualifikationssoll eine Qualifikation einer anderen Organisation nennt
- **THEN** antwortet das System mit 422

#### Scenario: Doppelte Qualifikation
- **WHEN** ein Qualifikationssoll dieselbe Qualifikation zweimal nennt
- **THEN** antwortet das System mit 400

### Requirement: Wirksames Qualifikationssoll einer Einheit
Das wirksame Qualifikationssoll einer Einheit MUST ihr eigener Wert sein, ohne eigenen Wert das
des Einheitentyps, sonst keins. Die Anzeige MUST melden, ob der Wert eigen ist. Wird eine
Einheit aus einer Vorlage mit eigenem Qualifikationssoll gebildet, MUST es als eigener Wert der
Einheit übernommen werden. Eine spätere Änderung an Vorlage oder Typ MUST den eigenen Wert einer
bestehenden Einheit nicht ändern.

#### Scenario: Erbt vom Typ
- **WHEN** eine Einheit ohne eigenes Qualifikationssoll den Typ „RTW“ mit „mind. 1 Rettungssanitäter“ hat
- **THEN** meldet die Einheit „mind. 1 Rettungssanitäter“ als wirksam, nicht eigen

#### Scenario: Aus Vorlage
- **WHEN** eine Einheit aus einer Vorlage mit eigenem Qualifikationssoll gebildet wird und danach die Vorlage geändert wird
- **THEN** behält die Einheit das Qualifikationssoll vom Zeitpunkt des Bildens

### Requirement: Deckungsregel
Welche Anforderungen einer Gruppe von Personen offen bleiben, MUST so gerechnet werden: Jede
geforderte Person ist ein Platz; eine Person deckt höchstens einen Platz; sie deckt ihn, wenn sie
die Qualifikation hat oder eine, die sie einschließt; die Zuteilung MUST maximal sein (keine
vielseitige Person verbaut eine Stelle, die nur sie decken könnte). Server und Oberfläche MUST
dieselben Fälle gleich rechnen.

#### Scenario: Vielseitige Person
- **WHEN** gefordert sind 1 Rettungssanitäter und 1 Sanitäter, und eingeteilt sind eine Rettungssanitäterin und ein Sanitäter
- **THEN** bleibt nichts offen

#### Scenario: Falsche Reihenfolge wäre zu streng
- **WHEN** gefordert sind 1 Sanitäter und 1 Rettungssanitäter, und eingeteilt sind ein Notfallsanitäter und eine Rettungssanitäterin
- **THEN** bleibt nichts offen

#### Scenario: Fehlt
- **WHEN** gefordert ist 1 Rettungssanitäter, und eingeteilt sind zwei Sanitäter
- **THEN** bleibt „1 Rettungssanitäter“ offen
