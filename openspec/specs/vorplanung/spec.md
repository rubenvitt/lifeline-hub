# vorplanung Specification

## Purpose
Eine Organisation plant einen Dienst, bevor es einen Einsatz gibt: Posten, Schichten und Helfer
einer Planung mit denselben Regeln und Prüfbefunden wie der Schichtplan im Einsatz
(`kraefte-schichtplan`), ohne dass die Planung als Einsatz zählt (LLH-1585), mit Oberfläche
(LLH-1586) und Übernahme in einen neuen oder laufenden Einsatz (LLH-1587).

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

### Requirement: Programmpunkte der Planung
Eine Planung SHALL das Programm der Veranstaltung als Programmpunkte führen (Bezeichnung höchstens
100 Zeichen, Zeitpunkt), höchstens 50 je Planung, in einem Reiter „Ablauf“ mit demselben Paneel wie
der Ablauf eines Einsatzes. Ein Zeitpunkt MAY außerhalb des Zeitraums der Planung liegen. Anlegen,
Ändern und Löschen MUST das Schreibrecht der Planung verlangen; eine fremde oder unbekannte Planung
MUST 404 ergeben, eine übernommene 409, ein 51. Punkt 422. Das Löschen der Planung MUST ihre
Programmpunkte mitnehmen.

#### Scenario: Programmpunkt anlegen
- **WHEN** jemand in der Planung „Feuerwerk“ um 22:30 anlegt
- **THEN** steht der Punkt im Reiter „Ablauf“, nach Zeitpunkt sortiert

#### Scenario: Grenze
- **WHEN** eine Planung schon 50 Programmpunkte hat und jemand einen weiteren anlegt
- **THEN** antwortet das System mit 422 und legt nichts an

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
Sanitätswache Bühne und den Demo-KTW, zwei Helfer, eine Einteilung mit einem doppelt
verplanten Menschen und das Programm Festbeginn 12:00, Einlass Bühne 18:00, Bühnenprogramm 19:00
und Feuerwerk 22:30. Besteht schon eine Planung dieser Bezeichnung, MUST sie unberührt bleiben.
Das Entfernen der Lage MUST die markierte Planung löschen, bevor es das Demo-Personal löscht.

#### Scenario: Demo-Planung
- **WHEN** der Admin die Lage „Stadtfest“ importiert
- **THEN** steht die Planung „Stadtfest Musterstadt“ in der Liste mit Soll 26, Ist 24, Offen 2 und Konflikte 2

### Requirement: Übernahme in einen Einsatz
Eine Planung SHALL sich mit Vorschau in einen neuen oder einen laufenden Einsatz übernehmen lassen,
über denselben Abgleich wie das Einlesen einer Schichtplan-Datei (Spec `kraefte-schichtplan`,
„Schichtplan einlesen“): ein Posten wird eine Einheit (frei, aus seiner Einheitenvorlage, mit
seinem Stamm-Fahrzeug ohne Disposition) oder eine UHS seines Typs, Stamm-Personal kommt mit festem
Bezug, ein Helfer der Planung als Helfer des Plans mit der Herkunft `vorplanung` und einer Kennung
je Helfer. Die Vorschau MUST nichts schreiben; für einen neuen Einsatz MUST sie dieselbe Rechnung
sehen wie das Übernehmen. Das Übernehmen MUST in EINER Transaktion laufen, ein neuer Einsatz
(Bezeichnung, Einsatzart und Ort der Planung, wahlweise mit Einsatz-Vorlage, Ersteller als
Einsatzleitung) eingeschlossen. Die Programmpunkte der Planung MUST als Programmpunkte des Einsatzes
kommen, auch vergangene; einen Punkt mit gleicher Bezeichnung (ohne Groß- und Kleinschreibung) und
gleichem Zeitpunkt, den der Einsatz schon hat, MUST die Übernahme auslassen. Hätte der Einsatz
danach mehr als 50 Programmpunkte, MUST die Vorschau das als Fehler nennen, ohne zu kürzen. Fehler des Abgleichs MUST es mit 422 ablehnen, ohne etwas zu
schreiben, ebenso eine Übernahme in einen laufenden Einsatz ohne jede Änderung. Jeder Posten MUST
eine Einheit oder UHS werden oder einer vorhandenen zugeordnet sein, auch ohne Block. Ein laufender Einsatz MUST zur eigenen Organisation gehören (404 sonst) und verlangt
Schreibrecht und die Module Ablösung und Personal (403), aktiv (409). Niemand wird alarmiert oder
disponiert. Danach MUST die Planung schreibgeschützt sein: jeder Schreibweg und eine zweite
Übernahme antworten mit 409, Lesen und Löschen bleiben. Kopf und Liste MUST Zeitpunkt, Einsatz und
Einsatznummer der Übernahme nennen und die Kennzahlen vom Zeitpunkt der Übernahme zeigen.
Die Vorschau MUST den Stand der Planung nennen, auf dem sie beruht, und jede Änderung der Planung
(Kopf, Posten, Reihenfolge, Blöcke mit Personen, Helfer, Programmpunkte) MUST diesen Stand
erhöhen. Das Übernehmen MUST den Stand der Vorschau mitschicken (400 ohne) und MUST mit 409
ablehnen, ohne etwas zu schreiben, wenn sich die Planung seitdem geändert hat; die Planung bleibt
dann beschreibbar, und der Dialog MUST die Vorschau mit demselben Ziel und derselben Wahl neu holen
und sagen, dass sich die Planung geändert hat (LLH-1610).

#### Scenario: Neuer Einsatz
- **WHEN** eine Führungskraft die Demo-Planung „Stadtfest Musterstadt“ in einen neuen Einsatz übernimmt
- **THEN** entsteht der Einsatz „Stadtfest Musterstadt“ mit ihr als Einsatzleitung, vier neuen Einheiten, einer UHS, zwei Helfern und jedem Block der Planung im Schichtplan

#### Scenario: Zweiter Aufruf
- **WHEN** jemand dieselbe Planung danach noch einmal übernimmt oder einen Posten anlegt
- **THEN** antwortet das System mit 409 und legt keinen Einsatz an

#### Scenario: Planung seit der Vorschau geändert
- **WHEN** jemand einen Block der Planung ändert, nachdem die Vorschau geholt ist, und dann „Übernehmen“ gewählt wird
- **THEN** antwortet das System mit 409, legt keinen Einsatz an, die Planung bleibt beschreibbar, und der Dialog zeigt die neu geholte Vorschau mit „Planung geändert, Vorschau neu geladen“

#### Scenario: Laufender Einsatz
- **WHEN** eine Planung mit dem Posten „Streife 2“ in einen laufenden Einsatz mit der Einheit „Streife 2“ übernommen wird
- **THEN** schlägt die Vorschau diese Einheit vor, und ihre Blöcke kommen an sie, ohne neue Einheit

#### Scenario: Programm der Planung
- **WHEN** die Demo-Planung „Stadtfest Musterstadt“ in einen neuen Einsatz übernommen wird
- **THEN** nennt die Vorschau „4 Programmpunkte neu“, und der Ablauf des Einsatzes zeigt Festbeginn, Einlass Bühne, Bühnenprogramm und Feuerwerk

#### Scenario: Programmpunkt schon im Einsatz
- **WHEN** ein laufender Einsatz schon „feuerwerk“ zur selben Zeit wie der Punkt „Feuerwerk“ der Planung hat
- **THEN** nennt die Vorschau ihn als vorhanden, und die Übernahme legt ihn nicht ein zweites Mal an

### Requirement: Planung als Excel-Mappe
Eine Planung SHALL dieselbe Excel-Mappe wie der Schichtplan eines Einsatzes ausgeben
(`GET /api/planungen/{id}/export`), mit Ort und Zeitraum der Planung in der Übersicht und den
Zeiten in der Zone der Organisation. Der Abruf MUST das Leserecht der Planung verlangen; eine
fremde oder unbekannte Planung MUST 404 ergeben.

#### Scenario: Planung in einen Einsatz einlesen
- **WHEN** jemand die Mappe der Demo-Planung „Stadtfest Musterstadt“ exportiert und in einen
  leeren Einsatz einliest
- **THEN** stehen dort dieselben Schichten mit Soll und Personen, und ein zweiter Lauf ergibt nur
  „unverändert“

### Requirement: Planung drucken
Eine Planung SHALL dieselben Druckblätter wie der Schichtplan eines Einsatzes ausgeben
(`/planungen/{id}/druck?sicht=posten|person&auswahl=…`): einen Aushang je Posten in der
Reihenfolge der Planung ohne die Pause und einen Schichtzettel je eingeteilter Person mit der Pause.
Der Druckkopf MUST die Planung statt eines Einsatzes nennen, die Zeiten MUST in der Zone der
Organisation stehen. Die Druckansicht MUST ein Schnappschuss sein, den eine Änderung an der Planung
nicht still ändert. Der Reiter „Plan“ der Planungsseite MUST „Drucken“ und „Excel“ anbieten.

#### Scenario: Aushang aus der Planungsseite
- **WHEN** jemand im Reiter „Plan“ einer Planung mit zwei Posten „Drucken“ wählt
- **THEN** stehen zwei Aushänge in der Reihenfolge der Posten da, jeder auf eigener Seite, und der
  Druckkopf nennt „Planung“ mit ihrer Bezeichnung

### Requirement: Raster der Planung ohne Sprung
Raster und Handy-Liste einer Planung MUST dieselbe Zeilenschleuse tragen wie der Schichtplan im
Einsatz (Spec `kraefte-schichtplan`, „Zeilen ohne Sprung“): neue Posten warten hinter dem
Sammelbanner, entfallene bleiben als leere Zeile „(entfallen)“ stehen, umsortierte bleiben an
ihrem Platz, Blöcke in gezeigten Zeilen erscheinen sofort.

#### Scenario: Fremder Posten vorn einsortiert
- **WHEN** der Zeiger über einem Block der letzten Postenzeile steht und eine andere Sitzung einen Posten anlegt und an die erste Stelle der Reihenfolge setzt
- **THEN** bleibt der Block an seiner Stelle und das Banner zeigt „1 neuer Posten“; nach „anzeigen“ steht der neue Posten als erste Zeile

#### Scenario: Fremde Umsortierung
- **WHEN** der Fokus im Raster steht und eine andere Sitzung die Reihenfolge der Posten umkehrt
- **THEN** bleiben die Zeilen in der gezeigten Folge und das Banner zeigt „Reihenfolge geändert“
