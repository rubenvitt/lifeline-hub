---
titel: Vorplanung
gruppen: [fuehrung, administration]
reihenfolge: 380
quellen: [frontend/src/planung/PlanungenPage.tsx, frontend/src/planung/PlanungAnlegenDialog.tsx, frontend/src/planung/PlanungPage.tsx, frontend/src/planung/PlanungKopf.tsx, frontend/src/planung/PlanungPostenListe.tsx, frontend/src/planung/PlanungPostenDialog.tsx, frontend/src/planung/PlanungHelferListe.tsx, frontend/src/planung/PlanungSchichtplan.tsx, frontend/src/planung/planungZeilen.ts, frontend/src/planung/planungRegeln.ts, frontend/src/abloesung/schichtplan/SchichtplanRaster.tsx, frontend/src/abloesung/schichtplan/SchichtplanListe.tsx, frontend/src/abloesung/schichtplan/SchichtplanBlockDialog.tsx, frontend/src/abloesung/schichtplan/SchichtenErzeugenDialog.tsx, frontend/src/components/AppLayout.tsx, frontend/src/einsatz/schreibrecht.ts, frontend/src/api/planungen.ts, src/routes/planung.rs, src/planung/mod.rs, src/planung/repo.rs, src/planung/zugriff.rs, src/abloesung/schichtplan/pruefung.rs, openspec/specs/vorplanung/spec.md, frontend/src/planung/PlanungDruckPage.tsx, frontend/src/planung/ausPlanung.ts, frontend/src/abloesung/schichtplan/ausgabe/, src/abloesung/schichtplan/ausgabe/, frontend/src/planung/PlanungUebernahmeDialog.tsx, frontend/src/planung/PlanungAblauf.tsx, src/planung/programm.rs, frontend/src/abloesung/schichtplan/ImportVorschauAnsicht.tsx, src/planung/uebernahme.rs, src/abloesung/schichtplan/uebernahme/repo.rs]
---

## Überblick

Die **Vorplanung** plant einen Dienst, bevor es den Einsatz gibt, etwa einen Sanitätsdienst auf
einem Stadtfest: welche Posten es gibt, wann an jedem Posten Schichten laufen und wer in welcher
Schicht steht. Eine Planung gehört der Organisation, nicht einem Einsatz. Sie steht in keiner
Einsatzliste und auf keinem Lagemonitor und löst keine Benachrichtigung aus.

Planen dürfen der System-Admin und die Führungskräfte der Organisation. Für sie steht
„Planungen“ in der Kopfleiste neben „Verwaltung“.

## Abläufe

### Eine Planung anlegen

1. In der Kopfleiste „Planungen“ öffnen. Die Liste zeigt offene Planungen zuerst, dann nach Beginn,
   mit Zeitraum, Ort und den Zahlen „Soll“, „Ist“, „Offen“ und „Konflikte“.
2. „Planung anlegen“ wählen und „Bezeichnung“, „Einsatzart“, „Ort“ sowie „Beginn“ und „Ende“
   eintragen. Ohne Einsatzart wird es ein Sanitätsdienst. Eine Planung umfasst höchstens 14 Tage,
   und keine zwei Planungen der Organisation tragen dieselbe Bezeichnung.
3. „Planung anlegen“ übernimmt und öffnet die neue Planung.

### Den Kopf einer Planung ändern

1. In der Planung oben im Paneel „Planung“ „Bearbeiten“ wählen.
2. Bezeichnung, Einsatzart, Ort, Zeitraum, „Höchstens im Dienst“ und „Mindestens Ruhe“ ändern. Die
   beiden Grenzwerte nehmen eine Dauer wie „10 h“ oder „45 min“; leer gilt die Vorgabe von 12 h im
   Dienst und 8 h Ruhe, im Feld steht sie mit „(Vorgabe)“.
3. „Speichern“ übernimmt. Hat jemand anderes die Planung inzwischen gespeichert, fragt die Seite,
   ob die eigene Änderung übernommen oder verworfen werden soll.

### Posten anlegen und ordnen

1. Den Reiter „Posten“ öffnen und „Posten anlegen“ wählen.
2. Unter „Herkunft“ wählen, woher der Posten kommt: „Frei“, eine „Einheitenvorlage“, ein
   „Stamm-Fahrzeug“ im Dienst oder „UHS“ mit ihrem Typ. Eine Vorlage oder ein Fahrzeug trägt ihren
   Namen in „Bezeichnung“ ein, solange dort noch nichts steht.
3. Optional „Abschnitt“, „Schichtlänge“ (etwa „4 h“), „Soll“ und „Qualifikationssoll“ eintragen.
   Leer übernimmt der Posten das Soll der Vorlage bzw. die Stärke des Fahrzeugs; das Feld nennt es
   mit „(Vorgabe)“.
4. „Posten anlegen“ übernimmt. Über das Menü ⋮ einer Zeile lässt sich ein Posten bearbeiten, „Nach
   oben“ und „Nach unten“ verschieben oder löschen. In dieser Reihenfolge stehen die Zeilen im Plan.

### Helfer erfassen

1. Den Reiter „Helfer“ öffnen und „Helfer anlegen“ wählen.
2. „Name“ eintragen, optional „Organisation“, „Telefon“ und „Qualifikationen“, und „Helfer anlegen“
   wählen.
3. Helfer stehen danach im Plan in der Leiste „Personen“ unter „Helfer“. „Bearbeiten“ und
   „Löschen“ stehen in ihrer Zeile.

### Schichten planen und Personen einteilen

1. Den Reiter „Plan“ öffnen. Je Posten steht eine Zeile, zuletzt die Pause, die Zeit läuft nach
   rechts. Über der Fläche wählt man „Ganze Planung“ oder einen Tag; vorgewählt ist der erste
   Tag. Bei mehr als drei Tagen stehen die Tage in einer Auswahl.
2. Viele Schichten auf einmal: „Schichten erzeugen“, „Posten“, „Beginn“ und „Ende“ wählen. Ohne
   „Länge je Schicht“ teilt die Schichtlänge des Postens den Zeitraum, im Feld steht sie mit
   „(Vorgabe)“; hat der Posten keine, ist die Länge Pflicht.
3. Einzelne Blöcke aufziehen, verschieben, an den Kanten ändern und mit „Strg“ oder „Alt“
   kopieren wie im Schichtplan eines Einsatzes (Kapitel [Ablösung](abloesung.md)).
4. Personen einteilen: aus der Leiste „Personen“ einen Namen auf den Block ziehen. Die Leiste
   führt das Stamm-Personal im Dienst unter „Stamm“ und die Helfer der Planung unter „Helfer“.
5. Einen Block wählen, um im Dialog Posten, Zeit, Personen, Soll, Qualifikationssoll und Notiz zu
   ändern, ihn als nächsten Block zu kopieren oder zu löschen.

Auf dem Handy steht statt des Rasters je Posten eine Liste aller Blöcke nach Beginn, mit Tag und
Uhrzeit. Ein Eintrag öffnet den Dialog des Blocks.

### Den Ablauf der Veranstaltung planen

1. Den Reiter „Ablauf“ öffnen. Der Reiter nennt die Zahl der Programmpunkte.
2. „Programmpunkt“ wählen, „Zeitpunkt“ und „Bezeichnung“ eintragen, etwa „Feuerwerk“ um 22:30,
   und „Anlegen“ wählen.
3. Ändern und Löschen gehen wie im Paneel „Ablauf“ der Einsatzdaten (Kapitel
   [Einsatzdaten](einsatzdaten.md)).

Ein Punkt darf vor oder nach dem Zeitraum der Planung liegen, etwa der Aufbau am Vortag. Eine
Planung hat höchstens 50 Programmpunkte.

### Eine Planung drucken oder als Excel ausgeben

1. Im Reiter „Plan“ „Drucken“ wählen. Die Druckansicht der Planung öffnet sich.
2. Unter „Blätter“ „Je Posten“ für einen Aushang je Posten oder „Je Person“ für einen
   Schichtzettel je Person wählen, unter „Blatt“ einen einzelnen Posten oder eine Person, oder
   alle Blätter lassen.
3. „Drucken / als PDF“ wählen. Jedes Blatt beginnt auf einer neuen Seite; der Druckkopf nennt
   die Planung.
4. Für die Excel-Mappe im Reiter „Plan“ „Excel“ wählen. Die Datei heißt etwa
   `schichtplan-stadtfest-2027-06-26.xlsx`, nach der Planung und dem Tag des Abrufs.

Die Druckansicht ist ein fester Stand: Änderungen an der Planung holt „Neu laden“. „Zurück zur
Planung“ führt zur Planung zurück.

### Eine Planung in einen Einsatz übernehmen

1. In der Planung oben rechts „In Einsatz übernehmen“ wählen.
2. Das Ziel wählen: „Neuer Einsatz“, wahlweise mit einer Einsatz-Vorlage, oder „Laufender
   Einsatz“ und darunter den Einsatz. Ein neuer Einsatz trägt Bezeichnung, Einsatzart und Ort der
   Planung, beginnt mit der Übernahme und wird von der Person geleitet, die übernimmt. Zur Wahl
   stehen nur laufende Einsätze, in denen man schreiben darf.
3. Die Vorschau zeigt, was entsteht („1 Einheit neu“, „4 Schichten neu“ …), je Posten und Person
   das Ziel mit „Gefunden“, „Unsicher“ oder „Neu“ und darunter Fehler und Hinweise. Über die
   Auswahl einer Zeile lässt sich ein Posten einer anderen Einheit oder UHS zuordnen oder neu
   anlegen und eine Person einer anderen zuordnen; die Vorschau rechnet danach neu.
4. „Übernehmen“ schreibt alles auf einmal. Bei Fehlern in der Vorschau, in einem laufenden Einsatz
   auch ohne jede Änderung, bleibt der Knopf gesperrt und nennt den Grund.
5. Nach der Übernahme führt „Zum Schichtplan des Einsatzes“ in die Ablösung des Einsatzes, Ansicht
   „Schichtplan“.

### Eine Planung löschen

1. In der Planung oben rechts das Menü ⋮ öffnen und „Planung löschen“ wählen.
2. Die Rückfrage mit „Planung löschen“ bestätigen. Posten, Blöcke, Helfer und Ablauf gehen mit.

## Hintergrund

### Ampel und Befunde

Jeder Block nennt seinen Stand wie im Schichtplan eines Einsatzes: „besetzt“, offene Plätze oder
das Wort eines Befunds. In einer Planung gibt es „doppelt verplant“, „Qualifikation fehlt“, „zu
lange im Dienst“ und „nicht verfügbar“; „nicht am Posten“ gibt es nicht, weil noch niemand im
Einsatz ist. Blöcke einer Person, zwischen denen weniger als die Mindestruhe liegt, zählen als ein
Dienst; wird er länger als „Höchstens im Dienst“, steht „zu lange im Dienst“. „Nicht verfügbar“
trägt auch ein Posten, dessen Stamm-Fahrzeug außer Dienst ist oder dessen Einheitenvorlage es
nicht mehr gibt. Die Zahlen im Kopf rechnet der Server: „Soll“ und „Ist“ über alle Blöcke an
Posten, „Offen“ als Summe der offenen Plätze, „Konflikte“ als Zahl der Befunde.

### Posten und ihre Blöcke

Ein neuer Block ohne eigenes Soll übernimmt das Soll und das Qualifikationssoll seines Postens.
Ändert sich später das Soll des Postens, bleibt das der vorhandenen Blöcke. Wer einen Posten
löscht, löscht seine Blöcke mit; die Rückfrage nennt, wie viele es sind. Ein gelöschter Helfer
verschwindet aus allen Blöcken.

### Blätter und Mappe

Aushang, Schichtzettel und Mappe sind dieselben wie beim Schichtplan eines Einsatzes (Kapitel
[Ablösung](abloesung.md)); die Pause steht nur auf dem Schichtzettel und zählt nicht zu den
Stunden. Die Zeiten stehen in der Zone der Organisation, die Übersicht der Mappe nennt Ort und
Zeitraum der Planung. Das Blatt „Austausch“ lässt sich in einen Einsatz einlesen; ein zweites
Einlesen derselben Mappe ändert dort nichts mehr.

### Was die Übernahme anlegt

Jeder Posten wird eine Einheit oder eine UHS im Einsatz, auch einer ohne Block; in einem laufenden Einsatz schlägt die
Vorschau eine vorhandene Einheit oder UHS gleichen Namens vor. Ein Posten aus einer
Einheitenvorlage wird eine Einheit nach dieser Vorlage, ein Posten mit Stamm-Fahrzeug eine Einheit
ohne das Fahrzeug: disponiert wird es nicht, die Vorschau nennt es als Hinweis „Stamm-Fahrzeug
nicht disponiert“. Ein Abschnitt der
Planung, den es im Einsatz nicht gibt, bleibt als Hinweis stehen, die Einheit kommt ohne Abschnitt.
Stamm-Personal kommt als feste Zuordnung in den Plan; wer inzwischen außer Dienst ist, macht die
Übernahme mit einem Fehler unmöglich, bis er aus der Planung genommen ist. Helfer der Planung
werden Helfer im Plan des Einsatzes mit der Herkunft „vorplanung“. Jeder Block nimmt sein Soll
und Qualifikationssoll aus der Planung mit; ein Block ohne Soll bleibt auch im Einsatz ohne. Die
Grenzwerte der Planung gelten im Einsatz, solange er keine eigenen
hat. Die Programmpunkte der Planung kommen in den Ablauf des Einsatzes, auch solche, deren Zeit
schon vorbei ist. Hat ein laufender Einsatz schon einen Punkt mit derselben Bezeichnung zur
selben Zeit, zählt die Vorschau ihn als „vorhanden“ und legt ihn nicht noch einmal an. Hätte der
Einsatz danach mehr als 50 Programmpunkte, nennt die Vorschau das als Fehler. Niemand wird alarmiert oder disponiert, und niemand ist damit schon im Einsatz: wer im Plan
steht, kommt wie bei jeder Schicht erst mit dem Wechsel in den Einsatz (Kapitel
[Ablösung](abloesung.md)). Das ETB des Einsatzes vermerkt „Planung „…“ übernommen“ mit der
Zählung.

### Nach der Übernahme

Eine übernommene Planung ist schreibgeschützt: oben steht, wann und in welchen Einsatz sie ging,
mit einem Link dorthin. Kopf, Posten, Helfer, Blöcke und Ablauf lassen sich nur noch ansehen, und eine
zweite Übernahme gibt es nicht. „Soll“, „Ist“, „Offen“ und „Konflikte“ bleiben auf dem Stand der
Übernahme, auch in der Liste, die „übernommen in …“ mit der Einsatznummer nennt. Löschen geht
weiter, und die Löschfrist bleibt dieselbe. Wird der Einsatz später endgültig gelöscht, führt der
Link ins Leere.

### Aufbewahrung

Eine Planung wird 90 Tage nach ihrem Ende gelöscht. Ab 14 Tagen vorher nennt die Liste den Tag:
„wird am … gelöscht“. Wer das Ende verschiebt, verschiebt auch das Löschen.

### Rechte, Live-Stand und ohne Netz

Lesen und schreiben dürfen nur der System-Admin und die Führungskräfte der Organisation; allen
anderen fehlt „Planungen“ in der Kopfleiste, und der Server lehnt ab. Übernehmen in einen
laufenden Einsatz verlangt dort zusätzlich das Schreibrecht (Einsatzleitung oder
Führungspersonal) und die Module Ablösung und Personal; neue Einheiten und UHS verlangen ihre
Module. Sind Ablösung oder Personal im neuen Einsatz nicht freigegeben, etwa weil die gewählte
Einsatz-Vorlage oder die Organisation sie ausblendet, lehnt der Server die Übernahme ab. Planungen einer anderen
Organisation gibt es für niemanden. Was jemand an einer Planung ändert, sehen alle, die sie offen
haben, ohne neu zu laden. Die Vorplanung gehört nicht zu dem, was die App für die Arbeit ohne Netz
vorhält (Kapitel [Ohne Netz](ohne-netz.md)).
