# vorplanung Specification

## Purpose
Eine Organisation plant einen Dienst, bevor es einen Einsatz gibt: Posten, Schichten und Helfer
einer Planung mit denselben Regeln und Prüfbefunden wie der Schichtplan im Einsatz
(`kraefte-schichtplan`), ohne dass die Planung als Einsatz zählt (LLH-1585). Die Übernahme in
einen Einsatz und die Oberfläche folgen in eigenen Schritten.

## Requirements

### Requirement: Planung der Organisation
Eine Organisation SHALL Planungen ohne Einsatz führen können, mit Bezeichnung, Einsatzart, Ort,
Zeitraum (höchstens 14 Tage), höchstens im Dienst und mindestens Ruhe. Die Bezeichnung MUST je
Organisation ohne Unterschied von Groß- und Kleinschreibung eindeutig sein (409), eine
Organisation MUST höchstens 200 Planungen führen (422). Eine Planung MUST NOT als Einsatz zählen:
Sie erscheint nicht in der Einsatzliste, in Zählern, auf Lagemonitoren und löst keine
Benachrichtigung aus. Lesen und Schreiben MUST das Recht verlangen, Einsätze anzulegen
(System-Admin oder org-weite Führungskraft der Organisation; 403 sonst, auch für eine
Gerätesitzung). Eine Planung einer anderen Organisation MUST wie eine unbekannte behandelt werden
(404). Änderungen am Kopf MUST den gelesenen Stand mitgeben (409 bei veraltetem Stand).

#### Scenario: Ohne Einsatz
- **WHEN** eine Führungskraft die Planung „Stadtfest Musterstadt“ für den 14.11. anlegt
- **THEN** steht sie in der Liste der Planungen und die Einsatzliste bleibt unverändert

#### Scenario: Ohne Recht
- **WHEN** ein Benutzer ohne Org-Rolle die Liste der Planungen abruft
- **THEN** antwortet das System mit 403

#### Scenario: Fremde Organisation
- **WHEN** eine Führungskraft einer anderen Organisation die Planung abruft
- **THEN** antwortet das System mit 404

### Requirement: Posten der Planung
Eine Planung SHALL höchstens 100 Posten mit Bezeichnung, Abschnitt (Freitext), Art (Einheit oder
UHS), Herkunft (frei, Einheitenvorlage oder Stamm-Fahrzeug bei einer Einheit, UHS-Typ bei einer
UHS), Reihenfolge, Schichtlänge, Soll-Anzahl und Qualifikationssoll führen. Ein Posten aus einer
Einheitenvorlage MUST deren Soll als eigenen Wert übernehmen, ein Posten aus einem Stamm-Fahrzeug
dessen Stärke. Die Bezeichnung MUST je Planung eindeutig sein (409). Dazu gehört die Zeile
„Pause“ ohne Soll. Ein Posten, in dessen Blöcken Personen eingeteilt sind, MUST nur samt seinen
Blöcken gelöscht werden (422 sonst).

#### Scenario: Posten aus Vorlage
- **WHEN** jemand den Posten „Streife 2“ aus der Einheitenvorlage „Fußstreife“ (Soll 0/1/1, mind. 1 Sanitäter) anlegt
- **THEN** trägt der Posten Soll-Anzahl 2 und „mind. 1 Sanitäter“

### Requirement: Schichten der Planung
Schichten, Einteilungen und Helfer einer Planung MUST denselben Regeln folgen wie der Schichtplan
im Einsatz (Spec `kraefte-schichtplan`, „Planschicht“, „Soll-Vorgabe vom Posten“): Raster 5 min,
10 min bis 24 h, keine Überschneidung je Posten außer der Pause. Blöcke MAY über den Zeitraum der
Planung hinaus reichen (Aufbau am Vortag). Personen SHALL Stamm-Personal der Organisation oder
Helfer der Planung sein; andere Personen MUST abgelehnt werden. „Schichten erzeugen“ SHALL einen
Zeitraum aus der Schichtlänge des Postens oder einer angegebenen Länge füllen, alles oder nichts;
fehlen beide, MUST das System mit 422 antworten.

#### Scenario: Erzeugen aus der Schichtlänge
- **WHEN** am Posten „Streife 2“ mit Schichtlänge 3 h für 12:00–24:00 Schichten erzeugt werden
- **THEN** entstehen vier Blöcke 12–15, 15–18, 18–21, 21–24 mit dem Soll des Postens

### Requirement: Prüfbefunde der Planung
Eine Planung MUST die Prüfbefunde mit derselben Rechnung liefern wie der Schichtplan im Einsatz:
doppelt verplant, Qualifikation fehlt, Dienst ohne Ruhe nach den Werten der Planung (Vorgabe
12 h / 8 h), nicht verfügbar (Person oder Stamm-Fahrzeug außer Dienst). Der Befund „weicht vom Ist
ab“ MUST in einer Planung entfallen. Befunde MUST NOT blockieren.

#### Scenario: Doppelt
- **WHEN** Mia Muster in „Streife 2“ 14–17 Uhr und in „UHS Marktplatz“ 16–20 Uhr eingeteilt ist
- **THEN** zeigen beide Blöcke an ihr den Befund „doppelt“ und beide Einteilungen bleiben bestehen

### Requirement: Liste der Planungen
Die Liste SHALL je Planung Soll, Ist, Offen und Konflikte zeigen, gerechnet aus denselben Befunden
wie die Planung selbst. Die Pause MUST NOT zum Soll zählen, und Ist MUST je Block höchstens das
Soll zählen. Kommende und laufende Planungen MUST vor vergangenen stehen; eine Planung, deren
Ende mehr als sieben Tage zurückliegt, MAY ohne Kennzahlen erscheinen. Jede Änderung an einer
Planung MUST das Org-Ereignis `planung` auslösen, das nur Benutzer mit dem Recht zu planen in
derselben Organisation erhalten.

#### Scenario: Kennzahlen
- **WHEN** eine Planung zwei Blöcke mit Soll 2 hat, in denen drei Personen eingeteilt sind, eine davon doppelt
- **THEN** zeigt die Liste Soll 4, Ist 3, Offen 1 und Konflikte 2

### Requirement: Aufbewahrung der Planung
Eine Planung MUST spätestens 90 Tage nach dem Ende ihres Zeitraums samt Posten, Blöcken und
Helfern gelöscht werden. Kopf und Liste MUST den Löschzeitpunkt nennen.

#### Scenario: Frist
- **WHEN** der Zeitraum einer Planung vor 91 Tagen endete
- **THEN** löscht der nächste Aufbewahrungslauf die Planung mit Posten, Blöcken und Helfern

### Requirement: Demo-Planung der Lage „Stadtfest“
Der Import der Lage „Stadtfest“ SHALL die Planung „Stadtfest Musterstadt“ für den Samstag nach
dem Importtag mit Demo-Marke anlegen: die Posten UHS Marktplatz, Streife 1, Streife 2,
Sanitätswache Bühne und den Demo-KTW, zwei Helfer und eine Einteilung mit einem doppelt
verplanten Menschen. Besteht schon eine Planung dieser Bezeichnung, MUST sie unberührt bleiben.
Das Entfernen der Lage MUST die markierte Planung löschen, bevor es das Demo-Personal löscht.

#### Scenario: Demo-Planung
- **WHEN** der Admin die Lage „Stadtfest“ importiert
- **THEN** steht die Planung „Stadtfest Musterstadt“ in der Liste mit Soll 26, Ist 24, Offen 2 und Konflikte 2

### Requirement: Raster der Planung ohne Sprung
Raster und Handy-Liste einer Planung MUST dieselbe Zeilenschleuse tragen wie der Schichtplan im
Einsatz (Spec `kraefte-schichtplan`, „Zeilen ohne Sprung“): neue Posten warten hinter dem
Sammelbanner, entfallene bleiben als leere Zeile „(entfallen)“ stehen, umsortierte bleiben an
ihrem Platz, Blöcke erscheinen sofort.

#### Scenario: Fremder Posten vorn einsortiert
- **WHEN** der Zeiger über einem Block der letzten Postenzeile steht und eine andere Sitzung einen Posten anlegt und an die erste Stelle der Reihenfolge setzt
- **THEN** bleibt der Block an seiner Stelle und das Banner zeigt „1 neuer Posten“; nach „anzeigen“ steht der neue Posten als erste Zeile

#### Scenario: Fremde Umsortierung
- **WHEN** der Fokus im Raster steht und eine andere Sitzung die Reihenfolge der Posten umkehrt
- **THEN** bleiben die Zeilen in der gezeigten Folge und das Banner zeigt „Reihenfolge geändert“
