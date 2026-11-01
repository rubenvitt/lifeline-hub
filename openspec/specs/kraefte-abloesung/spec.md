# kraefte-abloesung Specification

## Purpose
Die Führung sieht und steuert, wann welche Einheit im Einsatz abgelöst werden muss. Das
umfasst den Rhythmus je Einheit, Abschnitt oder Einsatz, die Schichtmodelle der Organisation,
Vorwarnung und Überfälligkeit, den Vollzug mit Folgeschicht und seine Rücknahme. Jeder Schritt
ist im Einsatztagebuch nachgewiesen.

LLH-1122 hebt das Non-Goal „Die Vorwarnzeit ist fest auf 30 min gesetzt“ aus LFH-635
(`openspec/changes/archive/2026-09-29-lfh-635-fachmodul-abloesung/design.md`, Non-Goals) auf:
die Vorwarnzeit kommt aus dem Schichtmodell des Einsatzes, 30 min sind nur noch die Vorgabe.

LLH-1131 (Entscheidung LLH-1118 Punkte 3 und 5) ergänzt Hinweise an die Führung: zur geplanten
ablösenden Einheit (alarmiert, eingetroffen, am Bereitstellungsraum eingetroffen, abgerufen,
Planung entfallen), den Planungshinweis als dritte Frist und Warnungen beim Planen. Es bleibt bei
drei Einstufungen.

LLH-1132 (Entscheidung LLH-1118 Punkte 1, 3 und 6) hebt das Non-Goal „Der Vollzug verschiebt die
ablösende Einheit nicht in den Abschnitt“ aus LFH-635 auf: der Vollzug nimmt eine Liste von
Ablösern, übergibt auf Wunsch den Abschnitt, übernimmt die laufende Schicht eines ungeplant
eingetroffenen Ablösers und schreibt die Ablösung an jede erbende Untereinheit.

LLH-1150 (Entscheidung LLH-1118 Punkt 4) hebt das Non-Goal „keine Personal-Ebene“ aus LFH-635
(`openspec/changes/archive/2026-09-29-lfh-635-fachmodul-abloesung/design.md`, Non-Goals) für den
**Besatzungswechsel** auf, und nur für ihn: die Einheit und ihr Fahrzeug bleiben, nur das
Personal wechselt; die Schicht hält fest, wer ging und wer kam. Es bleibt dabei, dass die Ablösung
keine Grenzwerte und keine Ruhezeit je Person rechnet (LFH-860).

## Requirements

### Requirement: Schicht einer Einheit

Das System SHALL je Einheit eines Einsatzes Schichten führen. Eine Schicht trägt Beginn
(Einsatzbeginn der Einheit), Rhythmus in Minuten, die daraus berechnete Fälligkeit
(Beginn + Rhythmus), optional eine geplante ablösende Einheit und einen Status
(`laufend`, `abgeloest` oder `beendet`). `beendet` heißt: ohne Ablösung zu Ende, mit Zeitpunkt,
Person und Grund (`entlassung` oder `aufloesung`); eine beendete Schicht MUST weder Einstufung
noch offene Fristen tragen und lässt sich weder ändern noch vollziehen (422). Die Liste MUST
nach `laufend`, `abgeloest` und `beendet` filtern können. Je Einheit MUST höchstens eine
Schicht `laufend` sein. Fehlt beim
Anlegen der Beginn, MUST das System das nicht gestrichene Eintreffen der offenen Einsatzperiode
der Einheit aus der Kräfte-Zeitachse übernehmen und ohne ein solches den Zeitpunkt der Anlage.

#### Scenario: Schicht beginnen mit eigenem Rhythmus
- **WHEN** eine Person mit Schreibrecht für Einheit „Florian 1“ eine Schicht mit Beginn 09:30 und Rhythmus 360 min anlegt
- **THEN** entsteht eine laufende Schicht mit Fälligkeit 15:30

#### Scenario: Beginn fehlt, Einheit ist eingetroffen
- **WHEN** um 09:00 eine Schicht ohne Beginn für eine Einheit angelegt wird, deren offene Periode ein Eintreffen um 06:40 trägt
- **THEN** beginnt die Schicht um 06:40

#### Scenario: Beginn fehlt
- **WHEN** eine Schicht ohne Beginn für eine Einheit ohne Eintreffen in einer offenen Periode angelegt wird
- **THEN** gilt der Zeitpunkt der Anlage als Beginn

#### Scenario: Zweite laufende Schicht
- **WHEN** für eine Einheit mit laufender Schicht eine weitere angelegt wird
- **THEN** antwortet das System mit 422 und legt nichts an

#### Scenario: Einheit eines anderen Einsatzes
- **WHEN** die angegebene Einheit nicht zum Einsatz gehört
- **THEN** antwortet das System mit 404

#### Scenario: Ungültiger Rhythmus
- **WHEN** der Rhythmus fehlt und weder der Abschnitt der Einheit noch der Einsatz eine Vorgabe hat, oder der Rhythmus ≤ 0 oder > 7 Tage ist
- **THEN** antwortet das System mit 400

### Requirement: Rangfolge des Rhythmus

Das System SHALL den Rhythmus einer neuen Schicht in dieser Rangfolge bestimmen: ein
eigener Wert der Schicht (`rhythmus_quelle = einheit`), sonst die Vorgabe des Abschnitts ihrer
Einheit (`abschnitt`), sonst die Vorgabe des Einsatzes (`einsatz`). Folgt eine Schicht der
Vorgabe des Einsatzes, MUST das System Fälligkeit und Rhythmus aus deren Schichtmodell rechnen;
bei Wechselzeiten ist der gespeicherte Rhythmus die Dauer von Beginn bis Fälligkeit. Das
Einsatztagebuch MUST beim Beginn die Herkunft „Vorgabe Einsatz“ mit der Bezeichnung des Modells
nennen.

#### Scenario: Einsatzvorgabe greift
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit Rhythmus 360 min hat und eine Schicht ohne eigenen Rhythmus für eine Einheit ohne Abschnittsvorgabe um 08:00 beginnt
- **THEN** folgt die Schicht der Vorgabe des Einsatzes und ist um 14:00 fällig
- **AND** das ETB nennt „Rhythmus 6 h (Vorgabe Einsatz «Sanitätsdienst»)“

#### Scenario: Abschnitt vor Einsatz
- **WHEN** der Abschnitt der Einheit eine Vorgabe von 480 min hat und der Einsatz eine von 360 min
- **THEN** folgt die Schicht der Vorgabe des Abschnitts

#### Scenario: Zurück zur Vorgabe ohne jede Vorgabe
- **WHEN** eine Schicht mit eigenem Rhythmus zurück zur Vorgabe soll und weder Abschnitt noch Einsatz eine haben
- **THEN** antwortet das System mit 422

### Requirement: Fälligkeit nach Wechselzeiten

Das System SHALL bei einem Schichtmodell vom Typ `wechselzeiten` die Fälligkeit als den
ersten Wechsel bestimmen, der mindestens die Mindestdauer nach dem Beginn und echt nach dem
Beginn liegt. Die Wechselzeiten MUST als Wanduhrzeit in der wirksamen Zone gelten: die erste
gültige aus der Zone des Einsatzes und der der Organisation, sonst Europe/Berlin. Über eine Zeitumstellung MUST die
echte Dauer zählen; eine Wechselzeit, die es am Umstellungstag nicht gibt, gilt eine Stunde
später, eine doppelte beim ersten Mal. Die Fälligkeit MUST gespeichert werden.

#### Scenario: Wechsel am selben Tag
- **WHEN** eine Schicht um 13:42 beginnt und das Modell Wechsel um 06:00 und 18:00 mit 4 h Mindestdauer vorgibt
- **THEN** ist sie um 18:00 fällig

#### Scenario: Wechsel am Folgetag
- **WHEN** dieselbe Schicht um 15:00 beginnt
- **THEN** ist sie um 06:00 am Folgetag fällig

#### Scenario: Zeitumstellung Ende März
- **WHEN** eine Schicht am 28.03.2026 um 18:00 (Europe/Berlin) beginnt
- **THEN** ist sie am 29.03.2026 um 06:00 Sommerzeit fällig, nach elf echten Stunden

#### Scenario: Zone des Einsatzes vor der Organisation
- **WHEN** die Organisation die Zone UTC hat und der Einsatz Europe/Berlin
- **THEN** gelten die Wechselzeiten in Europe/Berlin

### Requirement: Schichtmodelle der Organisation

Das System SHALL je Organisation Schichtmodelle als Stammdaten führen: Bezeichnung, Typ
(`rhythmus` mit Rhythmus in Minuten oder `wechselzeiten` mit Uhrzeiten und Mindestdauer),
Vorwarnung (Vorgabe 30 min) und Planungsvorlauf (Vorgabe 120 min). Höchstens ein Modell MUST die
Vorgabe der Organisation sein. Lesen darf jedes Mitglied der Organisation, anlegen, ändern und
löschen nur ein Admin; jede Änderung meldet das Org-Ereignis `stammdaten`. Die Bezeichnung MUST je
Organisation ohne Unterschied von Groß- und Kleinschreibung eindeutig sein. Ein Modell der
Demo-Daten MUST `ist_demo` melden.

#### Scenario: Zweite Vorgabe
- **WHEN** ein Admin ein zweites Modell als Vorgabe der Organisation anlegt oder setzt
- **THEN** antwortet das System mit 409, und die bisherige Vorgabe bleibt

#### Scenario: Gleiche Bezeichnung
- **WHEN** ein Admin ein Modell „HOCHWASSER“ anlegt und es „Hochwasser“ schon gibt
- **THEN** antwortet das System mit 409

#### Scenario: Feld des anderen Typs
- **WHEN** ein Modell vom Typ `rhythmus` eine Mindestdauer trägt
- **THEN** antwortet das System mit 422; fehlt der Rhythmus, mit 400

#### Scenario: Kein Admin
- **WHEN** eine Person ohne Admin-Rolle ein Modell anlegt
- **THEN** antwortet das System mit 403

### Requirement: Vorgabe des Einsatzes

Das System SHALL beim Anlegen eines Einsatzes die Vorgabe der Organisation als Kopie zur
Vorgabe des Einsatzes machen, außer die Einsatz-Vorlage gibt ein Schichtmodell vor (Spec
`einsatz-vorlagen`, „Eine Vorlage gibt das Schichtmodell vor“, LLH-1313). Hat weder die Vorlage
noch die Organisation eines, MUST der Einsatz ohne Vorgabe bleiben. Eine spätere Änderung oder das Löschen des Modells in den Stammdaten MUST die Kopie und
damit laufende Fälligkeiten unverändert lassen. Die Vorgabe des Einsatzes MUST mit den Rechten der
Abschnittsvorgabe lesbar und änderbar sein: als Kopie eines Modells der eigenen Organisation, mit
eigenen Werten oder entfernt. Ändert sie sich, MUST das System Rhythmus, Fälligkeit und Fristen
aller laufenden Schichten mit Quelle `einsatz` neu setzen und die Vorwarn-Fristen aller laufenden
Schichten auf die neue Vorwarnzeit legen. Eine Fälligkeitsfrist MUST nur neu gesetzt werden,
wenn sich die Fälligkeit ändert, damit eine überfällige Schicht nicht ein zweites Mal „fällig“
meldet. Eine entfernte Vorgabe lässt Rhythmus und Fälligkeit stehen. Jede Änderung MUST als ETB-Eintrag vom Typ Entscheidung festgehalten werden.

#### Scenario: Anlage übernimmt die Org-Vorgabe
- **WHEN** die Organisation die Vorgabe „12-h-Schicht“ führt und ein Einsatz angelegt wird
- **THEN** hat der Einsatz eine Kopie von „12-h-Schicht“ als Vorgabe

#### Scenario: Gelöschtes Modell
- **WHEN** das Modell danach in den Stammdaten geändert und gelöscht wird
- **THEN** ist die Vorgabe des Einsatzes unverändert

#### Scenario: Einsatzvorgabe verkürzt
- **WHEN** die Vorgabe des Einsatzes von 360 auf 240 min mit 45 min Vorwarnung gesetzt wird und eine laufende Schicht ihr folgt
- **THEN** ist diese Schicht 120 min früher fällig, ihre Fristen stehen auf der neuen Fälligkeit und 45 min davor
- **AND** Schichten mit eigenem Rhythmus oder nach der Abschnittsvorgabe behalten ihre Fälligkeit

#### Scenario: Nur die Vorwarnung ändert sich
- **WHEN** eine Schicht seit 10:30 überfällig ist, „fällig“ schon gemeldet hat und um 10:33 eine Vorgabe mit 45 min Vorwarnung gesetzt wird
- **THEN** meldet der Scheduler für diese Schicht kein zweites „fällig“

#### Scenario: Weder Modell noch Werte
- **WHEN** die Vorgabe ohne `schichtmodell_id` und ohne `schichtmodell` gesetzt werden soll
- **THEN** antwortet das System mit 400; mit beiden Angaben mit 422; mit einem fremden Modell mit 404

### Requirement: Rhythmus-Vorgabe am Abschnitt

Das System SHALL am Einsatzabschnitt eine optionale Rhythmus-Vorgabe führen. Eine neue
Schicht ohne eigenen Rhythmus MUST die Vorgabe des Abschnitts ihrer Einheit übernehmen und
ihr folgen. Ändert sich die Vorgabe, MUST das System Rhythmus und Fälligkeit aller laufenden
Schichten neu berechnen, die ihr folgen. Schichten mit eigenem Rhythmus bleiben unverändert.
Jede Änderung der Vorgabe MUST als ETB-Eintrag vom Typ Entscheidung festgehalten werden.

#### Scenario: Vorgabe verkürzt
- **WHEN** die Vorgabe von Abschnitt „Deichwache Nord“ von 480 auf 360 min gesetzt wird und dort zwei laufende Schichten der Vorgabe folgen
- **THEN** sind beide Schichten 120 min früher fällig
- **AND** das ETB enthält einen Entscheidungseintrag, der Abschnitt und neuen Rhythmus nennt

#### Scenario: Eigener Rhythmus bleibt
- **WHEN** die Vorgabe geändert wird und eine Schicht im Abschnitt einen eigenen Rhythmus trägt
- **THEN** bleibt deren Fälligkeit unverändert

#### Scenario: Vorgabe entfernen
- **WHEN** die Vorgabe entfernt wird
- **THEN** behalten laufende Schichten ihren zuletzt gültigen Rhythmus

### Requirement: Schicht bearbeiten

Das System SHALL an einer laufenden Schicht Beginn, Rhythmus (eigener Wert oder zurück zur
Vorgabe des Abschnitts, sonst des Einsatzes) und die geplanten Ablöser änderbar machen.
Eine Änderung von Beginn
oder Rhythmus MUST die Fälligkeit und die zugehörigen Fristen neu setzen. Eine abgelöste
Schicht MUST NOT änderbar sein. Die Ablöser sind eine geordnete Liste
(`einsatz_abloesung_abloeser`, LLH-1132) von höchstens `ABLOESER_MAX = 8` Einheiten (mehr → 400,
gezählt vor dem Entdoppeln); die Liste ersetzt die bisherige, eine leere hebt die Planung auf.
`abloesende_einheit_id` MUST der erste Eintrag sein (Spiegel für bestehende Leser); die
Einzelangabe bleibt als Bestand, beide zugleich → 422.

#### Scenario: Ablösende Einheit planen
- **WHEN** an der laufenden Schicht von „Florian 1“ die Einheit „Florian 2“ als ablösende Einheit gesetzt wird
- **THEN** zeigt die Schicht „Florian 2“ als geplante Ablösung

#### Scenario: Mehrere Ablöser planen
- **WHEN** an der Schicht von „Florian 1“ die Ablöser „Florian 3“ und „Florian 2“ geplant werden
- **THEN** nennt die Schicht beide in dieser Reihenfolge, `abloesende_einheit_id` ist „Florian 3“, und das ETB nennt „ablösende Einheiten «Florian 3», «Florian 2» geplant“

#### Scenario: Neun Ablöser
- **WHEN** neun Einheiten als Ablöser gesendet werden
- **THEN** antwortet das System mit 400 und ändert nichts

#### Scenario: Ablösende Einheit ist dieselbe Einheit
- **WHEN** die Einheit der Schicht als ihre eigene ablösende Einheit gesetzt wird
- **THEN** antwortet das System mit 422

#### Scenario: Abgelöste Schicht ändern
- **WHEN** eine abgelöste Schicht geändert werden soll
- **THEN** antwortet das System mit 422

### Requirement: Fälligkeit, Vorwarnung und Überfälligkeit

Das System SHALL eine laufende Schicht als `vorwarnung` einstufen, wenn ihre Fälligkeit
höchstens die Vorwarnzeit entfernt ist, und als `ueberfaellig`, wenn sie erreicht oder
überschritten ist. Andernfalls ist sie `planmaessig`. Die Vorwarnzeit MUST aus dem
Schichtmodell des Einsatzes kommen, ohne eines gilt 30 min; jede Schicht MUST sie als
`vorwarnung_minuten` melden. Die Einstufung MUST bei jedem Lesen gegen die aktuelle Zeit
berechnet werden und darf nicht davon abhängen, ob ein Hintergrundlauf stattgefunden hat.

#### Scenario: Überfällig
- **WHEN** eine laufende Schicht um 15:30 fällig ist und um 15:31 gelesen wird
- **THEN** trägt sie die Einstufung `ueberfaellig`

#### Scenario: Vorwarnzeit
- **WHEN** dieselbe Schicht um 15:05 gelesen wird
- **THEN** trägt sie die Einstufung `vorwarnung`

#### Scenario: Vorwarnung aus dem Schichtmodell
- **WHEN** das Schichtmodell des Einsatzes 45 min Vorwarnung vorgibt und die Schicht um 14:45 gelesen wird
- **THEN** trägt sie die Einstufung `vorwarnung` und meldet `vorwarnung_minuten: 45`

### Requirement: Kopplung an den Erinnerungs-Scheduler

Das System SHALL für jede laufende Schicht eine offene Auto-Frist zur Fälligkeit führen und,
solange die Vorwarnzeit noch in der Zukunft liegt, eine zweite um die Vorwarnzeit vor
Fälligkeit.
Beim Anlegen einer Schicht und bei Änderungen von Beginn oder Rhythmus MUST das System diese
Fristen anlegen oder verschieben. Bei Vollzug und beim Ende einer Schicht (`beendet`) MUST es sie
schließen. Erreicht der Scheduler
eine dieser Fristen, MUST er genau einmal ein Live-Ereignis an alle Leser des Moduls
Ablösung senden, das die Schicht und die Art (`vorwarnung` oder `faellig`) nennt.

#### Scenario: Fristen beim Anlegen
- **WHEN** um 09:30 eine Schicht mit Fälligkeit 15:30 angelegt wird
- **THEN** gibt es für sie je eine offene Frist zu 15:00 und zu 15:30

#### Scenario: Vorwarnzeit schon vorbei
- **WHEN** eine Schicht angelegt wird, deren Fälligkeit weniger als 30 min entfernt ist
- **THEN** wird nur die Frist zur Fälligkeit angelegt

#### Scenario: Frist wandert mit
- **WHEN** der Rhythmus einer laufenden Schicht geändert wird
- **THEN** stehen ihre offenen Fristen auf den neuen Zeitpunkten, und eine schon ausgelöste Frist wird zum neuen Zeitpunkt erneut ausgelöst

#### Scenario: Einmaliges Auslösen
- **WHEN** der Scheduler die Fälligkeit einer Schicht erreicht und danach weiterläuft
- **THEN** geht genau ein Live-Ereignis `abloesung` mit Art `faellig` an die Leser des Moduls, und es wiederholt sich nicht

#### Scenario: Einheit wird aufgelöst
- **WHEN** eine Einheit mit laufender Schicht aufgelöst wird
- **THEN** sind Schicht und offene Fristen danach nicht mehr offen, und der Scheduler löst für sie nichts mehr aus

### Requirement: Vollzug mit Folgeschicht

Das System SHALL eine laufende Schicht mit Zeitpunkt (Vorgabe: jetzt) und einer Liste von
Ablösern (höchstens `ABLOESER_MAX = 8`, leer = ohne ablösende Einheit) vollziehen; die Liste
wird die der Schicht. Beim Vollzug MUST die Schicht `abgeloest` werden, ihre offenen
Fristen MUST geschlossen werden, und ein ETB-Eintrag MUST Einheit, alle Ablöser und
Zeitpunkt nennen. Je Ablöser, dessen Vorfahr nicht ebenfalls in der Liste steht (der Knoten,
LLH-1118 Punkt 3), MUST in derselben Transaktion eine laufende Folgeschicht mit Beginn =
Vollzugszeitpunkt und dem Rhythmus der abgelösten Schicht entstehen, samt eigener Fristen; folgt
die abgelöste Schicht der Vorgabe des Einsatzes, rechnet deren Schichtmodell die Folgeschicht
ab dem Vollzug. Untereinheiten eines Knotens in der Liste bekommen keine eigene, sie erben seine.
Hat ein Ablöser schon eine eigene laufende Schicht ohne Vorgänger (ungeplant eingetroffen,
Nachtrag 17.10.), MUST der Vollzug sie als Folgeschicht übernehmen (Beginn, Fälligkeit und
Fristen bleiben, Marke `uebernommen_bei_vollzug`), und das ETB nennt die Übernahme. Ist seine
laufende Schicht selbst schon eine Folgeschicht, MUST der Vollzug mit 422 scheitern und nichts
ändern. Die abgelöste Schicht MUST alle Folgeschichten nennen (`folgeschichten`).

#### Scenario: Vollzug mit ablösender Einheit
- **WHEN** die Schicht von „Florian 1“ (Rhythmus 360 min) um 15:40 durch „Florian 2“ vollzogen wird
- **THEN** ist die Schicht von „Florian 1“ abgelöst
- **AND** „Florian 2“ hat eine laufende Schicht mit Beginn 15:40 und Fälligkeit 21:40
- **AND** das ETB enthält einen Eintrag „Ablösung vollzogen“ mit beiden Einheiten und der Uhrzeit

#### Scenario: Vollzug ohne ablösende Einheit
- **WHEN** eine Schicht ohne ablösende Einheit vollzogen wird
- **THEN** ist sie abgelöst, und es entsteht keine Folgeschicht

#### Scenario: Zwei Ablöser
- **WHEN** die Schicht von „Florian 1“ um 15:40 durch „Florian 3“ und „Florian 2“ vollzogen wird
- **THEN** haben beide eine laufende Folgeschicht ab 15:40, die abgelöste Schicht nennt beide Folgeschichten, und das ETB nennt „«Florian 1» durch «Florian 3», «Florian 2»“

#### Scenario: Verband löst ab
- **WHEN** „Zug 2“ und sein „Trupp 2“ als Ablöser genannt werden
- **THEN** bekommt nur „Zug 2“ eine Folgeschicht, und „Trupp 2“ erbt sie

#### Scenario: Ungeplanter Ablöser
- **WHEN** „Florian 2“ ungeplant eingetroffen ist, seit 14:00 eine eigene Schicht ohne Vorgänger hat und als Ablöser von „Florian 1“ vollzogen wird
- **THEN** wird diese Schicht die Folgeschicht, mit Beginn 14:00 und unveränderter Fälligkeit, und das ETB nennt „Laufende Schicht übernommen: «Florian 2»“

#### Scenario: Ablöser führt schon eine Folgeschicht
- **WHEN** die ablösende Einheit bereits eine laufende Folgeschicht aus einer anderen Ablösung hat
- **THEN** antwortet das System mit 422, und die ursprüngliche Schicht bleibt laufend

#### Scenario: Doppelter Vollzug
- **WHEN** eine bereits abgelöste Schicht erneut vollzogen werden soll
- **THEN** antwortet das System mit 422

### Requirement: Rücknahme eines Vollzugs

Das System SHALL einen Vollzug zurücknehmen, solange jede daraus entstandene Folgeschicht
unberührt ist, also noch laufend und ohne eigenen Vollzug. Bei der Rücknahme MUST jede neu
angelegte Folgeschicht samt ihrer Fristen entfernt werden; eine übernommene MUST nur vom
Vorgänger gelöst werden und samt Fristen weiterlaufen. Die Liste der Ablöser bleibt als
Planung stehen. Die abgelöste Schicht MUST wieder laufend
sein, ihre Fristen MUST wieder offen sein, ohne dass eine schon erfolgte Auslösung
wiederholt wird. Die Vorwarn-Frist MUST dabei der aktuellen Vorwarnzeit folgen; folgt die
Schicht der Vorgabe des Einsatzes und rechnet deren Regel inzwischen anders, MUST die neue
Fälligkeit samt neuer Fristen gelten. Ein ETB-Eintrag vom Typ Berichtigung MUST auf den Vollzugseintrag
verweisen.

Die Rücknahme MUST die Folgen des Verbleibs und des Abrufs
zurücklegen, solange sie noch den Stand des Vollzugs tragen: die Entlassung an Einheit und Erben
samt Fan-out streichen (Grund „Ablösung zurückgenommen“), für die abgelöste Einheit einen
`austritt` buchen, wenn die Eintrittsbuchung des Vollzugs noch ihr jüngstes Ereignis ist, und
für jeden abgerufenen Ablöser samt Mitgenommenen einen `eintritt` in den Raum buchen, wenn er in
keinem Raum steht und der Austritt des Vollzugs sein jüngstes Ereignis ist. Jede dieser
Gegenbuchungen MUST außerdem einen noch aktiven, nicht stornierten Raum und eine nicht
aufgelöste Einheit voraussetzen; sonst bleibt die Belegung unverändert. Die Berichtigung im
ETB MUST nennen, was zurückgelegt wurde. Danach MUST der Verbleib wieder `ruhe` sein.

#### Scenario: Rücknahme direkt nach Vollzug
- **WHEN** ein Vollzug von „Florian 1“ durch „Florian 2“ zurückgenommen wird
- **THEN** ist die Schicht von „Florian 1“ wieder laufend mit ihrer alten Fälligkeit
- **AND** „Florian 2“ hat keine laufende Schicht mehr
- **AND** das ETB enthält eine Berichtigung zum Vollzugseintrag

#### Scenario: Folgeschicht schon vollzogen
- **WHEN** die Folgeschicht ihrerseits schon vollzogen ist
- **THEN** antwortet das System mit 422 und ändert nichts

#### Scenario: Eine von zwei Folgeschichten vollzogen
- **WHEN** von zwei Folgeschichten die ältere schon vollzogen ist
- **THEN** ist der Vollzug nicht mehr zurücknehmbar (`ruecknehmbar: false`), und die Rücknahme antwortet mit 422

#### Scenario: Übernommene Schicht
- **WHEN** ein Vollzug zurückgenommen wird, der die laufende Schicht von „Florian 2“ übernommen hat
- **THEN** läuft die Schicht von „Florian 2“ weiter, ohne Vorgänger und mit ihren Fristen

#### Scenario: Schicht ohne Vollzug
- **WHEN** eine laufende Schicht zurückgenommen werden soll
- **THEN** antwortet das System mit 422

#### Scenario: Zurück aus dem Raum
- **WHEN** der Vollzug „Florian 1 → BR Schule“ zurückgenommen wird und „Florian 1“ dort noch steht
- **THEN** steht „Florian 1“ in keinem Raum, seine Schicht läuft, und die Berichtigung nennt „«Florian 1» verlässt Bereitstellungsraum Schule wieder“

#### Scenario: Inzwischen abgerufen
- **WHEN** „Florian 1“ nach dem Vollzug aus dem BR Schule abgerufen wurde und der Vollzug zurückgenommen wird
- **THEN** bleibt die Belegung des BR Schule unverändert

#### Scenario: Entlassung zurück
- **WHEN** ein Vollzug mit Verbleib „entlassen“ zurückgenommen wird
- **THEN** sind die Entlassungen gestrichen, die Perioden wieder offen und die Schicht läuft

### Requirement: Rechte und Modulsichtbarkeit

Lesende Endpunkte MUST Lesezugriff auf den Einsatz und das Modul Ablösung verlangen,
schreibende Endpunkte Schreibrecht im Einsatz, einen aktiven Einsatz und das Modul. Ist das
Modul im Einsatz ausgeblendet, MUST das System 403 liefern. Live-Ereignisse `abloesung` MUST
nur Abonnenten mit Zugriff auf das Modul erreichen.

#### Scenario: Beobachter liest
- **WHEN** eine Person ohne Schreibrecht die Schichten abruft
- **THEN** erhält sie die Liste

#### Scenario: Beobachter vollzieht
- **WHEN** eine Person ohne Schreibrecht einen Vollzug absendet
- **THEN** antwortet das System mit 403

#### Scenario: Modul ausgeblendet
- **WHEN** das Modul Ablösung im Einsatz ausgeblendet ist und die Schichten abgerufen werden
- **THEN** antwortet das System mit 403

### Requirement: Anzeige im Modul

Die Seite des Moduls SHALL die laufenden Schichten nach Fälligkeit geordnet zeigen, jeweils
mit Einheit, Abschnitt, Beginn, Rhythmus (mit Kennzeichnung Vorgabe oder eigener Wert),
Fälligkeit als Uhrzeit, Einstufung als Wort und Farbe sowie der geplanten ablösenden
Einheit. Die Einstufung MUST einen zweiten Kanal neben der Farbe tragen (Wort), und nichts
davon darf blinken. Ohne Schreibrecht MUST die Seite den Grund nennen und die Aktionen
gesperrt statt entfernt zeigen. Abgelöste und beendete Schichten MUST in der Ansicht
„Vergangen“ nachlesbar sein, getrennt nach Status („Abgelöst“, „Beendet“, LLH-1128). Eine
beendete Schicht MUST als „beendet“ mit ihrem Grund erscheinen („beendet · entlassen“ mit
Uhrzeit, „beendet · aufgelöst“), nie als „abgelöst“; ihre Zeitspalte trägt das Ende.

#### Scenario: Überfällige Schicht in der Liste
- **WHEN** eine Schicht überfällig ist
- **THEN** zeigt ihre Zeile die Fälligkeitsuhrzeit, das Wort „überfällig“ und die Alarmfarbe am Rand, ohne Animation

#### Scenario: Vollzug mit Rückgängig
- **WHEN** eine Person eine Ablösung über den Dialog vollzieht
- **THEN** zeigt die Seite einen Hinweis mit der Aktion „Rückgängig“, die die Rücknahme auslöst

#### Scenario: Mit der Entlassung beendet
- **WHEN** die Schicht von „Florian 1“ mit seiner Entlassung um 14:12 endete und jemand „Vergangen“ → „Beendet“ wählt
- **THEN** lädt die Seite die Schichten mit Status `beendet` und zeigt die Karte mit „beendet · entlassen 1412“, ohne Aktion und ohne „abgelöst“

### Requirement: Kartenhöhe unabhängig von Uhrzeit und fremder Rhythmusänderung

Die Karte einer Schicht SHALL die Fälligkeit in einer Zeitspalte zeigen, die das breiteste
Zeitformat (Tag und Uhrzeit) fasst, sodass Tageszeit und Tageswechsel weder Spaltenbreite noch
Umbruch ändern. Der Rhythmus MUST in einer eigenen, einzeiligen Zeile stehen, als Dauer mit der
Quelle „eigen“, „Vorgabe“ (des Abschnitts) oder „Vorgabe Einsatz“; reicht der Platz nicht, kürzt
sie nur das Quellenwort mit „…“. Ändert eine andere Person den Rhythmus einer gezeigten
Schicht, MUST die Karte ihre Höhe behalten, solange die Zeile mindestens 226 px Platz für Text
hat.

#### Scenario: Fremde Rhythmusänderung kurz vor Mitternacht, mobil
- **WHEN** um 23:40 (Anzeigezone Europe/Berlin) auf 390 px Breite in der Dichte `komfortabel` drei Schichten mit 6 h gezeigt werden und eine andere Person den Rhythmus der mittleren auf 30 min setzt
- **THEN** behalten alle drei Karten ihre Oberkante (Abweichung höchstens 0,5 px), und die mittlere Karte zeigt ihre neue Einstufung

#### Scenario: Gleiche Lage am Tag und in der Nacht
- **WHEN** dieselbe Liste einmal um 12:00 und einmal um 23:40 gezeigt wird
- **THEN** ist die Zeitspalte der Karten in beiden Fällen gleich breit

#### Scenario: Längster zulässiger Rhythmus bleibt einzeilig
- **WHEN** eine Schicht einen Rhythmus von 167 h 59 min als Vorgabe des Einsatzes trägt und die Karte auf 390 px Breite in der Dichte `komfortabel` oder `handschuh` steht
- **THEN** steht die Zeile „Rhythmus 167:59 h (Vorgabe Einsatz)“ einzeilig, der Wert „Rhythmus 167:59 h“ ganz sichtbar und der ganze Text im Titel

### Requirement: Schichtmodelle in der Verwaltung

Die Verwaltung SHALL unter „Stammdaten“ einen Bereich „Schichtmodelle“ führen: eine Tabelle mit
Bezeichnung, Regel, Vorwarnung und Planungsvorlauf, Vorgabe- und Demo-Marke. Ein Admin MUST Modelle anlegen, ändern, nach Rückfrage löschen und mit
einem Handgriff zur Vorgabe der Organisation machen oder deren Vorgabe aufheben können. Ohne
Admin-Recht MUST der Bereich den Grund nennen und das Anlegen gesperrt zeigen. Er MUST über das
Org-Ereignis `stammdaten` live bleiben.

#### Scenario: Vorgabe der Organisation wechseln
- **WHEN** „Sanitätsdienst“ die Vorgabe der Organisation ist und ein Admin bei „Hochwasser“ „Als Vorgabe setzen“ wählt
- **THEN** sendet die Oberfläche zuerst „Sanitätsdienst“ ohne Vorgabe und dann „Hochwasser“ als Vorgabe, jeweils mit dem ganzen Satz

#### Scenario: Zweiter Schritt scheitert
- **WHEN** beim Wechsel das Setzen der neuen Vorgabe abgelehnt wird
- **THEN** stellt die Oberfläche die bisherige Vorgabe wieder her und nennt den Grund

### Requirement: Schichtmodell in der Einsatzanlage

Der Dialog „Neuen Einsatz anlegen“ SHALL das Schichtmodell, das der neue Einsatz bekommt, als
Zeile nennen, ohne eigenes Feld: „Schichtmodell: <Bezeichnung> (Vorgabe Vorlage)“, wenn die
gewählte Einsatz-Vorlage eines vorgibt, sonst „Schichtmodell: <Bezeichnung> (Vorgabe)“ für die
Vorgabe der Organisation. Gibt weder die Vorlage noch die Organisation eines vor, MUST die Zeile
fehlen. Die Zeile MUST einem Wechsel der Vorlage folgen.

#### Scenario: Zeile in der Einsatzanlage
- **WHEN** die Organisation „12-h-Schicht“ als Vorgabe führt und jemand „Neuen Einsatz anlegen“ öffnet
- **THEN** steht im Dialog „Schichtmodell: 12-h-Schicht (Vorgabe)“, und der Dialog hat weiter fünf Felder

#### Scenario: Vorlage gibt das Modell vor
- **WHEN** die Vorlage „Sanitätsdienst“ auf „Sanitätsdienst 6 h“ zeigt und jemand sie im Dialog wählt
- **THEN** steht im Dialog „Schichtmodell: Sanitätsdienst 6 h (Vorgabe Vorlage)“

### Requirement: Vorgabe des Einsatzes in den Einstellungen

Die Einsatz-Einstellungen SHALL einen Reiter „Ablösung“ führen, der die Vorgabe des Einsatzes
zeigt (Bezeichnung, Regel, Vorwarnung, Planungsvorlauf, laufende Schichten). Mit den Rechten der
Abschnittsvorgabe MUST er ein Modell der Organisation übernehmen, eigene Werte setzen und die
Vorgabe entfernen lassen; Entfernen MUST über „Rückgängig“ mit den alten Werten umkehrbar sein.
Ohne Freigabe des Moduls Ablösung MUST der Reiter das sagen, statt die Vorgabe abzufragen.

#### Scenario: Modell übernehmen
- **WHEN** die Einsatzleitung im Reiter „Ablösung“ „Sanitätsdienst“ wählt und „Übernehmen“ wählt
- **THEN** sendet die Oberfläche `schichtmodell_id` und zeigt danach „Rhythmus 6 h“

#### Scenario: Entfernen und zurücknehmen
- **WHEN** die Einsatzleitung „Vorgabe entfernen“ wählt und danach im Hinweis „Rückgängig“
- **THEN** ist die alte Vorgabe mit denselben Werten wieder gesetzt

### Requirement: Dauern und Einsatzvorgabe auf der Seite Ablösung

Dauern SHALL als „8 h“, „7:30 h“ oder „45 min“ erscheinen und so vorbelegt werden, nie mit
Dezimalpunkt; Wechselzeiten taktisch („0600/1800“). Die Seite Ablösung MUST die Vorgabe des
Einsatzes zeigen und sie in „Schicht beginnen“ und „Rhythmus ändern“ als letzte Stufe der
Rangfolge nennen: ohne Vorgabe des Abschnitts als Platzhalter, und das Rhythmusfeld darf leer
bleiben. Die Einstufung im Client MUST mit `vorwarnung_minuten` der Schicht rechnen.

#### Scenario: Einsatzvorgabe als Platzhalter
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit 12 h hat und eine Schicht für eine Einheit ohne Abschnittsvorgabe beginnen soll
- **THEN** zeigt das Rhythmusfeld „12 h (Vorgabe Einsatz)“, ist kein Pflichtfeld und sendet leer keinen Rhythmus

#### Scenario: Dauer statt Dezimalzahl
- **WHEN** eine Schicht einen eigenen Rhythmus von 450 min hat und jemand „Rhythmus ändern“ öffnet
- **THEN** steht im Feld „7:30 h“

#### Scenario: Eingabe einer Dauer
- **WHEN** jemand „8“, „7:30“, „7,5“ oder „90 min“ einträgt
- **THEN** gelten 480, 450, 450 bzw. 90 Minuten, und Unlesbares lehnt das Feld ab, ohne zu senden

#### Scenario: Vorwarnung aus der Schicht
- **WHEN** eine laufende Schicht in 50 min fällig ist und `vorwarnung_minuten: 60` meldet
- **THEN** zählt der Modulzähler sie als fällig, ohne neuen Abruf

### Requirement: Hinweis in der AlarmZentrale

Die Oberfläche SHALL zur Vorwarnung und zur Fälligkeit einer Schicht genau einen Toast zeigen,
mit Einheit, Uhrzeit und einem Sprung zu dieser Schicht auf der Seite Ablösung (`?schicht=<id>`,
Requirement „Sprung zur Schicht“). Er kommt als Benachrichtigung
(`abloesung_vorwarnung` als Hinweis, `abloesung_faellig` als Alarm, Spec `benachrichtigungen`)
an alle mit dem Modul Ablösung; das Live-Ereignis `abloesung` frischt nur die Liste auf. Der
Toast MUST dem gemeinsamen Budget der Benachrichtigungen unterliegen (höchstens drei sichtbar, der
Rest gebündelt) und quittierbar sein. Dieselbe Fälligkeit darf nicht zusätzlich als allgemeine
Erinnerung alarmieren. Der Planungshinweis und die Hinweise zur ablösenden Einheit (LLH-1131)
SHALL auf demselben Weg ankommen: als Hinweis mit dezentem Ton, Toast und Sprung zu ihrer
Schicht, ohne dass etwas blinkt. Der Sprungpfad jeder Benachrichtigung mit einem Bezug der
Ablösung MUST `/einsaetze/<id>/abloesung?schicht=<schicht>` sein, auch der Ersatz, wenn der Text
nicht zu holen war; der Sammeltoast springt zur Seite.

#### Scenario: Fälligkeit erreicht
- **WHEN** die Schicht von „Florian 1“ um 15:30 fällig wird
- **THEN** erscheint der Alarm „Ablösung fällig“ mit „Florian 1, 1530“ (Darstellung taktisch, Spec `zeitdarstellung`) und Sprung zu ihrer Schicht auf der Seite Ablösung

#### Scenario: Kein Doppelalarm
- **WHEN** zur selben Fälligkeit auch eine Erinnerung mit Bezug Ablösung fällig wird
- **THEN** entsteht dafür keine zweite Benachrichtigung

### Requirement: Marke im Überblick und Modulzähler

Der Überblick SHALL laufende Schichten als Marken unter „Nächste Marken“ führen. Schichten
desselben Abschnitts mit gleicher Fälligkeit (minutengenau) MUST zu einer Marke
„Ablösung <Abschnitt>, <n> Einheiten“ zusammengefasst werden, eine einzelne Schicht als
„Ablösung <Einheit>“. Das Modulpanel SHALL am Modul Ablösung die Zahl der Schichten mit
Einstufung `vorwarnung` oder `ueberfaellig` zeigen. Die Marken und der Zähler MUST nur
erscheinen, wenn das Modul für die Person sichtbar ist.

#### Scenario: Zusammengefasste Marke
- **WHEN** zwei Einheiten im Abschnitt „Deichwache Nord“ beide um 15:30 fällig sind
- **THEN** zeigt der Überblick eine Marke „15:30 Ablösung Deichwache Nord, 2 Einheiten“

#### Scenario: Zähler
- **WHEN** eine Schicht überfällig ist, eine in 20 min fällig und eine in 3 h
- **THEN** zeigt das Modulpanel am Modul Ablösung die Zahl 2

### Requirement: Auflösen beendet die laufende Schicht mit Spur

Wird eine Einheit aufgelöst, SHALL das System ihre laufende Schicht als `beendet` mit Grund
`aufloesung`, Zeitpunkt und Person behalten und ihre offenen Fristen schließen, statt sie zu
löschen (LLH-1128, Entscheidung vom 15.10.2026; ändert die Fassung aus LLH-1079). Abgelöste
Schichten MUST samt Vollzug bleiben. Verweist eine Schicht einer anderen Einheit auf die
aufgelöste als ablösende Einheit, MUST dieser Verweis geleert werden; an einer laufenden Schicht
mit Hinweis und ETB-Eintrag (Requirement „Planung entfällt“).

#### Scenario: Historie bleibt
- **WHEN** eine Einheit mit zwei abgelösten und einer laufenden Schicht aufgelöst wird
- **THEN** zeigt die Ablösung die beiden abgelösten Schichten weiter, die laufende ist nicht mehr laufend, sondern `beendet` mit Grund `aufloesung`

### Requirement: Schicht mit dem Eintreffen

Schreibt die Kräfte-Zeitachse das Eintreffen der offenen Periode einer Einheit, die weder eine
eigene noch eine geerbte laufende Schicht hat, SHALL das System in derselben Transaktion eine
Schicht mit Beginn = Eintreffen anlegen, sofern der Abschnitt der Einheit oder der Einsatz eine
Vorgabe hat (LLH-1128). Rhythmus und Quelle MUST der Rangfolge des Beginnens von Hand folgen
(Abschnitt vor Einsatz), samt Fristen, ETB-Eintrag mit der Herkunft („mit dem Eintreffen
begonnen“) und Live-Ereignis `abloesung`. Ohne Vorgabe MUST keine Schicht entstehen, ebenso
wenig für eine Einheit, die eine laufende Schicht als Ablöser plant (Einzelplanung oder Eintrag
der Liste, LLH-1132), oder deren Vorfahr so geplant ist (ein Verband löst als Knoten ab): ihre
Schicht entsteht mit dem Vollzug als Folgeschicht. Das gilt
für jeden Weg des Eintreffens (Statuswechsel, Nachtrag, Bereitstellungsraum). Ein Fehler beim
Anlegen MUST nur das Anlegen zurücknehmen; Statuswechsel und Eintreffen gelingen trotzdem.

#### Scenario: Einsatzvorgabe 6 h
- **WHEN** der Einsatz die Vorgabe „Sanitätsdienst“ mit 6 h hat und „Florian 1“ um 08:00 per Status eintrifft
- **THEN** läuft eine Schicht ab 08:00, fällig um 14:00, mit Fristen zu 13:30 und 14:00, und das ETB nennt „mit dem Eintreffen begonnen … (Vorgabe Einsatz «Sanitätsdienst»)“

#### Scenario: Ohne Vorgabe
- **WHEN** weder Abschnitt noch Einsatz eine Vorgabe haben und eine Einheit eintrifft
- **THEN** entsteht keine Schicht

#### Scenario: Zweites Eintreffen
- **WHEN** eine Einheit mit laufender Schicht ein weiteres Eintreffen bekommt
- **THEN** entsteht keine zweite Schicht

#### Scenario: Geplanter Ablöser trifft ein
- **WHEN** „Florian 2“ als ablösende Einheit von „Florian 1“ geplant ist und eintrifft
- **THEN** bekommt „Florian 2“ keine eigene Schicht, und der spätere Vollzug legt seine Folgeschicht ab dem Vollzug an

#### Scenario: Geplanter Verband trifft ein
- **WHEN** „Zug 2“ als einer von drei Ablösern von „Florian 1“ geplant ist und sein „Trupp 2“ eintrifft
- **THEN** bekommt „Trupp 2“ keine eigene Schicht; eine ungeplante Einheit, die zugleich eintrifft, bekommt ihre

#### Scenario: Fehler im Autostart
- **WHEN** das Anlegen der Schicht scheitert
- **THEN** gelingt der Statuswechsel, das Eintreffen steht, und von der Schicht bleibt nichts zurück

### Requirement: Ende mit der Entlassung

Schreibt die Kräfte-Zeitachse eine Entlassung, nach der die Einheit keine offene Periode mehr
hat, SHALL das System ihre laufende Schicht in derselben Transaktion als `beendet` mit Grund
`entlassung`, Zeitpunkt der Entlassung und Person beenden, ihre Fristen schließen und einen
ETB-Eintrag schreiben. Eine entlassene Einheit MUST danach keinen Hinweis „fällig“ mehr
auslösen. Wird genau diese Entlassung gestrichen, MUST die Schicht wieder laufen, samt Fristen
wie bei der Rücknahme eines Vollzugs, sofern die Einheit inzwischen keine neue laufende Schicht
hat.

#### Scenario: Entlassen vor der Fälligkeit
- **WHEN** „Florian 1“ mit einer um 14:00 fälligen Schicht um 12:00 entlassen wird
- **THEN** ist die Schicht `beendet` mit Grund `entlassung` und Ende 12:00, und der Scheduler löst um 14:01 nichts aus

#### Scenario: Entlassung gestrichen
- **WHEN** diese Entlassung gestrichen wird
- **THEN** läuft die Schicht wieder, mit Fristen zu 13:30 und 14:00

#### Scenario: Entlassung einer früheren Periode
- **WHEN** eine Entlassung nachgetragen wird, die eine frühere Periode schließt, während eine spätere offen bleibt
- **THEN** bleibt die laufende Schicht unberührt

### Requirement: Knoten-Vererbung der Schicht

Eine Untereinheit ohne eigene laufende Schicht SHALL die laufende Schicht ihres nächsten
Vorfahren mit einer erben (über die übergeordnete Einheit, LLH-1118 Punkt 1). Die Vererbung MUST
beim Lesen ermittelt und nicht gespeichert werden; die tragende Schicht MUST ihre erbenden
Untereinheiten nennen (`erbende_einheiten`). Mit ihrem Eintreffen MUST eine erbende
Untereinheit keine eigene Schicht bekommen. Eine von Hand begonnene Schicht an einer
Untereinheit SHALL möglich bleiben und übersteuert die Vererbung für sie und ihren Teilbaum.

#### Scenario: Gruppe erbt vom Zug
- **WHEN** „Zug 1“ eine laufende Schicht hat und seine „Gruppe 1“ eintrifft
- **THEN** bekommt die Gruppe keine eigene Schicht, und die Schicht des Zugs nennt „Gruppe 1“ als erbend

#### Scenario: Eigene Schicht übersteuert
- **WHEN** an „Gruppe 1“ von Hand eine Schicht begonnen wird
- **THEN** erbt deren „Trupp 1“ von der Gruppe, und der Zug nennt beide nicht mehr

#### Scenario: Erben auf der Karte
- **WHEN** die laufende Schicht von „Zug 1“ an „1. Trupp“ und „2. Trupp“ vererbt
- **THEN** nennt ihre Karte in einer einzeiligen Zeile „gilt auch für: 1. Trupp, 2. Trupp“, den ganzen Text im Titel, und der Client rechnet die Vererbung nicht selbst nach

### Requirement: Einheiten ohne Schicht

Die Seite Ablösung SHALL eine Ansicht „Ohne Schicht“ mit Zahl führen (LLH-1128): die Einheiten
mit offener Einsatzperiode (letzte Periode ohne Ende, alarmiert oder eingetroffen), die weder
eine eigene laufende Schicht haben noch über `erbende_einheiten` eine erben, die am längsten im
Einsatz zuerst. Jede Zeile MUST Eintreffen (ohne es die Alarmierung) und Abschnitt zeigen und
mit Schreibrecht „Schicht beginnen“ anbieten, das den Dialog mit der Einheit vorbelegt. Ein
geplanter Ablöser MUST in der Ansicht stehen, mit der Einheit, die er ablösen soll, aber ohne
„Schicht beginnen“. Der Überblick SHALL im Abschnitt „Ablösungen“ der offenen Vorgänge den
Sprung „<n> ohne Schicht ↗“ auf diese Ansicht führen, nur bei bekannter Zahl über null, mit
derselben Menge wie das Segment (LLH-1312). Die Sprungpalette SHALL die Ansicht als „Ohne
Schicht“ unter „Ansichten“ führen.

#### Scenario: Zug, Trupp und eine einzelne Einheit
- **WHEN** „Zug Nord“ eine laufende Schicht hat, sein „Trupp Nord“ und „Florian Süd“ eingetroffen sind und keine eigene haben
- **THEN** zeigt das Segment „Ohne Schicht (1)“ und die Ansicht nur „Florian Süd“

#### Scenario: Schicht aus der Zeile beginnen
- **WHEN** jemand an der Zeile „Florian Süd“ „Schicht beginnen“ wählt und mit Rhythmus 6 h absendet
- **THEN** ist „Florian Süd“ im Dialog vorbelegt, „Im Einsatz seit“ nennt das Eintreffen, die Schicht läuft, und die Zeile fällt weg

#### Scenario: Zahl im Überblick
- **WHEN** zwei Einheiten im Einsatz keine Schicht haben
- **THEN** nennt der Überblick unter „Ablösungen“ „2 ohne Schicht ↗“, und die Zahl am Abschnitt bleibt die der fälligen Schichten

#### Scenario: Ohne Freigabe der Einheiten
- **WHEN** der Person die Freigabe des Moduls Einheiten fehlt
- **THEN** steht im Überblick kein Sprung „ohne Schicht“, und der Überblick fragt die Zeitachse nicht ab

### Requirement: Zufluss und Sperre der Ansicht „Ohne Schicht“

Neue Einheiten ohne Schicht MUST hinter dem Sammelbanner warten, eine Einheit, die eine Schicht
bekommt, MUST sofort wegfallen, und Zahl wie Kopf MUST mit der vollen Menge rechnen (Regeln wie
bei den laufenden Schichten). Ohne Freigabe des Moduls Einheiten MUST das Segment gesperrt mit
Grund stehen, ohne Zahl und ohne Anfrage an die Kräfte-Zeitachse. Auf 390 px MUST die
Ansichtsleiste mit dem Banner in jeder Dichte ungekürzt im Fenster stehen; schmal trägt dann der
Kopf die Zahlen.

#### Scenario: Fremd eingetroffen
- **WHEN** eine andere Einheit ohne Schicht eintrifft, während die Ansicht gezeigt wird
- **THEN** zählt das Segment sie sofort mit, die gezeigten Zeilen bleiben, wo sie sind, und das Banner nennt „1 neue Einheit ohne Schicht“

#### Scenario: Modul Einheiten gesperrt
- **WHEN** der Person die Freigabe des Moduls Einheiten fehlt
- **THEN** steht „Ohne Schicht“ gesperrt mit dem Grund „Modul Einheiten gesperrt“, und die Seite fragt die Zeitachse nicht ab

### Requirement: Planungshinweis

Das System SHALL für jede laufende Schicht ohne geplante ablösende Einheit eine dritte Auto-Frist
führen, den Planungsvorlauf vor der Fälligkeit (aus dem Schichtmodell des Einsatzes, ohne eines
2 h; LLH-1118 Punkt 5). Erreicht der Scheduler sie, MUST er genau einmal die Benachrichtigung
`abloesung_planung` („Keine ablösende Einheit geplant“, Hinweis) an alle Leser des Moduls Ablösung
melden. Die Frist MUST mit der Fälligkeit und mit dem Planungsvorlauf wandern, beim Planen einer
ablösenden Einheit (auch über die Ablöser-Liste) schließen und mit einer aufgehobenen oder
entfallenen Planung wieder entstehen, solange ihr Zeitpunkt noch vor uns liegt; ein Zeitpunkt in
der Vergangenheit MUST keine Frist ergeben. Der Planungshinweis MUST NOT eine Einstufung sein:
es bleibt bei `planmaessig`, `vorwarnung` und `ueberfaellig`.

#### Scenario: Zwei Stunden vorher
- **WHEN** eine Schicht ohne Schichtmodell um 15:30 fällig ist und keine ablösende Einheit geplant ist
- **THEN** erhalten alle mit dem Modul Ablösung um 13:30 genau einmal den Hinweis „Keine ablösende Einheit geplant“ mit „Florian 1, 1530“

#### Scenario: Geplant
- **WHEN** vor 13:30 eine ablösende Einheit geplant wird
- **THEN** kommt kein Planungshinweis

#### Scenario: Fälligkeit verschoben
- **WHEN** der Beginn der Schicht um eine Stunde später gesetzt wird
- **THEN** kommt der Planungshinweis um 14:30

### Requirement: Hinweise zur ablösenden Einheit

Wird die geplante ablösende Einheit einer laufenden Schicht alarmiert, trifft sie ein, trifft sie
am Bereitstellungsraum ein oder wird sie dort abgerufen, SHALL das System je Ereignis und Schicht
genau eine Benachrichtigung `abloesung_abloeser` (Hinweis) an alle Leser des Moduls Ablösung
melden, mit der Schicht als Bezug und dem Ereignis im Bezugstyp (`abloeser_alarmiert`,
`abloeser_eingetroffen`, `abloeser_br_eingetroffen`, `abloeser_abgerufen`). Geplant heißt: als
`abloesende_einheit_id` oder in der Ablöser-Liste der Schicht. Alarmierung und Eintreffen MUST nur
als Beginn der offenen Periode zählen, aus der Kräfte-Zeitachse in derselben Transaktion; das
Eintreffen am Bereitstellungsraum meldet dessen Buchung, auch wenn die Zeitachse es auslässt, und
nicht zusätzlich als „eingetroffen“. Bei einem Verband zählt nur die geplante Einheit, nicht ihre
mitgenommenen Untereinheiten. Gemeldet wird nach dem Commit; ein Fehler dabei MUST den
Statuswechsel nicht brechen. Andere Leser und die auslösende Person MUST NOT einen Hinweis
erhalten.

#### Scenario: Eingetroffen
- **WHEN** „2. Rettungsstaffel“ als ablösende Einheit von „Rettungsstaffel“ geplant ist und per Status eintrifft
- **THEN** erhält jeder Leser des Moduls Ablösung genau einen Hinweis „Ablösende Einheit eingetroffen“ mit „Ablösung für Rettungsstaffel: 2. Rettungsstaffel“ und Sprung zur Schicht der Rettungsstaffel, und Mitglieder ohne das Modul erhalten nichts

#### Scenario: Am Bereitstellungsraum
- **WHEN** dieselbe Einheit am Bereitstellungsraum eingebucht und später abgerufen wird
- **THEN** gehen je ein Hinweis „im Bereitstellungsraum eingetroffen“ und „abgerufen“ an die Leser

#### Scenario: Nicht geplant
- **WHEN** eine Einheit ohne Planung alarmiert wird
- **THEN** entsteht kein Hinweis

### Requirement: Planung entfällt

Wird die geplante ablösende Einheit einer laufenden Schicht aufgelöst oder entlassen (Entlassung
ohne offene Periode danach), SHALL das System die Planung selbst aufheben, bevor ein
Fremdschlüssel sie still leeren könnte: Einzelplanung leeren und den Eintrag der Ablöser-Liste
entfernen, je Schicht ein ETB-Eintrag „Ablösung «…»: Planung der ablösenden Einheit entfallen,
«…» aufgelöst“ bzw. „… entlassen“ und ein Hinweis `abloesung_abloeser` mit Bezugstyp
`abloeser_entfallen` an die Leser des Moduls. Ohne verbleibende Planung MUST der Planungshinweis
wieder anstehen. Die Schicht MUST sich Zeitpunkt, Grund und Namen der Einheit der zuletzt
entfallenen Planung merken (LLH-1309); jede Änderung der Ablöser-Liste MUST diesen Vermerk
räumen. Eine laufende Schicht ohne Ablöser MUST ihn als `planung_entfallen` tragen, und ihre
Karte MUST dezent in der Rolle Achtung „Planung entfallen · 2. Rettungsstaffel aufgelöst“ bzw.
„… entlassen“ zeigen, ohne Einstufung, Kante oder Fläche zu ändern.

#### Scenario: Geplante Einheit aufgelöst
- **WHEN** „2. Rettungsstaffel“ als ablösende Einheit von „Rettungsstaffel“ geplant ist und aufgelöst wird
- **THEN** trägt die Schicht keine Planung mehr, das ETB nennt „Planung der ablösenden Einheit entfallen“, und die Leser erhalten den Hinweis „Planung der ablösenden Einheit entfallen“

#### Scenario: Vermerk an der Karte
- **WHEN** die Planung von „2. Rettungsstaffel“ für „Rettungsstaffel“ entfallen ist, weil sie aufgelöst wurde
- **THEN** zeigt die Karte der Rettungsstaffel „Planung entfallen · 2. Rettungsstaffel aufgelöst“, und ihre Einstufung bleibt unverändert

#### Scenario: Neue Planung räumt den Vermerk
- **WHEN** nach der entfallenen Planung „3. Rettungsstaffel“ geplant wird
- **THEN** trägt die Schicht keinen Vermerk mehr, und die Karte zeigt „Ablösung geplant durch 3. Rettungsstaffel“

#### Scenario: Weiterer Ablöser bleibt
- **WHEN** zwei Ablöser geplant sind und einer entlassen wird
- **THEN** trägt die Schicht keinen sichtbaren Vermerk, und die Karte nennt den verbleibenden Ablöser

### Requirement: Plausibilität beim Planen

Das System SHALL beim Planen einer ablösenden Einheit warnen, aber nicht ablehnen: jede laufende
Schicht trägt `planung_warnungen`, beim Lesen ermittelt, für ihre Einzelplanung und die Einträge
ihrer Ablöser-Liste. `schon_geplant` MUST erscheinen, wenn dieselbe Einheit auch eine andere
laufende Schicht plant (mit dieser Schicht und ihrer Einheit), `im_einsatz`, wenn die Einheit
selbst eine eigene oder geerbte laufende Schicht hat (mit deren Beginn). Die Oberfläche zeigt
die Warnungen nach dem Speichern der Planung als Meldung und, solange sie gelten, an der Karte der
laufenden Schicht (LLH-1131 Teil II): dezent in einer Zeile im Wortlaut der Meldung, in der Rolle
Achtung, nie in Rot und ohne Einstufung, Kante oder Fläche der Karte zu ändern; mehrere Warnungen
stehen mit „ · “ in derselben Zeile, der ganze Text im Titel.

#### Scenario: Schon geplant
- **WHEN** „Florian 3“ für die Schicht von „Florian 1“ geplant ist und auch für „Florian 2“ geplant wird
- **THEN** gelingt die Planung, und die Antwort warnt „Florian 3 schon für Schicht Florian 1 geplant“

#### Scenario: Selbst im Einsatz
- **WHEN** eine Einheit mit eigener laufender Schicht seit 13:40 als ablösende Einheit geplant wird
- **THEN** gelingt die Planung, und die Antwort warnt „steht selbst im Einsatz seit 1340“

#### Scenario: Warnung an der Karte
- **WHEN** „Florian 3“ für die Schichten von „Florian 1“ und „Florian 2“ geplant ist
- **THEN** zeigt die Karte von „Florian 2“ dezent „Florian 3 schon für Schicht Florian 1 geplant“, und ihre Einstufung bleibt „planmäßig“

### Requirement: Stand der ablösenden Einheit an der Karte

Die Karte einer laufenden Schicht SHALL zu ihren geplanten Ablösern (Ablöser-Liste, ohne Liste
die Einzelplanung) den Stand aus der Kräfte-Zeitachse zeigen (LLH-1131 Teil II): „Ablösung:
2. Rettungsstaffel · alarmiert 1340 · eingetroffen 1412 (BR Sportplatz)“. Alarmiert MUST der
Beginn der offenen Periode des Ablösers sein, wenn sie mit der Alarmierung begann, eingetroffen ihr
Eintreffen; eine beendete Periode MUST NOT zählen. Steht der Ablöser abgerufen in einem
Bereitstellungsraum, MUST die Zeile den Zeitpunkt des Abrufs aus der Raumliste nennen
(„· abgerufen 1405“, LLH-1309); nach dem Ausrücken entfällt er. Der Raum MUST in Klammern stehen,
solange der Ablöser in einem Bereitstellungsraum steht; ohne Freigabe des Moduls
Bereitstellungsräume fehlen Klammer und Abruf, und die Raumliste wird nicht abgefragt. Ohne
Freigabe des Moduls Einheiten fehlt der Stand. Trägt kein Ablöser ein Ereignis, bleibt die Zeile
„Ablösung geplant durch …“. Die Zeile MUST einzeilig bleiben, auch bei mehreren Ablösern (mit „; “
getrennt), der ganze Text im Titel, und MUST sich über die bestehenden Live-Ereignisse
aktualisieren (`einheit`, `fahrzeug`, `abloesung`, `bereitstellungsraum`), ohne eigenen Abruf.

#### Scenario: Alarmiert und eingetroffen
- **WHEN** „2. Rettungsstaffel“ als Ablöser von „Rettungsstaffel“ geplant ist, um 13:40 alarmiert wurde und um 14:12 am Bereitstellungsraum „BR Sportplatz“ eingetroffen ist
- **THEN** zeigt die Karte der Rettungsstaffel in einer Zeile „Ablösung: 2. Rettungsstaffel · alarmiert 1340 · eingetroffen 1412 (BR Sportplatz)“

#### Scenario: Abgerufen
- **WHEN** derselbe Ablöser um 14:25 aus dem „BR Sportplatz“ abgerufen wird
- **THEN** zeigt die Zeile „Ablösung: 2. Rettungsstaffel · alarmiert 1340 · eingetroffen 1412 · abgerufen 1425 (BR Sportplatz)“

#### Scenario: Noch kein Ereignis
- **WHEN** der geplante Ablöser weder alarmiert noch eingetroffen ist
- **THEN** zeigt die Karte „Ablösung geplant durch 2. Rettungsstaffel“

#### Scenario: Live
- **WHEN** eine andere Person den geplanten Ablöser alarmiert, während die Seite offen ist
- **THEN** wechselt die Zeile ohne Neuladen auf „Ablösung: 2. Rettungsstaffel · alarmiert …“, und die Karte behält ihre Höhe

### Requirement: Sprung zur Schicht

Die Seite Ablösung SHALL den Deeplink `?schicht=<id>` annehmen (LLH-1131 Teil II, Muster
Query-Param aus `frontend/AGENTS.md`): Steht die Schicht unter den laufenden, wählt sie „Laufend“,
gibt zurückgehaltene Schichten frei (wie ein Ansichtswechsel), rollt die Karte ins Bild und hebt
sie kurz hervor; sonst sucht sie die Schicht unter den abgelösten und beendeten und wählt
„Vergangen“ mit dem passenden Status. Die Hervorhebung MUST der Form aus der Spec
`deeplink-hervorhebung` folgen, nach acht Sekunden ohne Übergang enden und MUST NOT blinken. Der
Parameter MUST danach geräumt sein; eine unbekannte Kennung MUST nichts ändern.

#### Scenario: Toast „Ablösung fällig“
- **WHEN** jemand im Toast „Ablösung fällig“ zur Schicht von „Florian 1“ springt
- **THEN** steht „Laufend“, die Karte von „Florian 1“ ist im Bild und hervorgehoben, und die Adresse trägt keinen Parameter mehr

#### Scenario: Zurückgehaltene Schicht
- **WHEN** die Schicht hinter dem Sammelbanner wartet und jemand zu ihr springt
- **THEN** reiht die Seite die zurückgehaltenen Schichten ein und hebt die angesprungene hervor

#### Scenario: Schon abgelöst
- **WHEN** jemand zu einer inzwischen abgelösten Schicht springt
- **THEN** wechselt die Seite nach „Vergangen“ → „Abgelöst“ und hebt deren Karte hervor

### Requirement: Abschnitt übergeben beim Vollzug

Mit der Option „Abschnitt übergeben“ (LLH-1132, Entscheidung LLH-1118 Punkt 6) SHALL der Vollzug
jeden Knoten-Ablöser dem Abschnitt der abgelösten Einheit unterstellen und den Abschnitt der
abgelösten Einheit leeren, in derselben Transaktion; Untereinheiten eines Knotens in der Liste
behalten ihren Abschnitt. Hat die abgelöste Einheit keinen Abschnitt oder gibt es keinen
Ablöser, MUST nichts übergeben werden. Die alten Werte MUST an der Schicht
(`abgeloest_abschnitt_vorher_id`) und an der Liste (`abschnitt_vorher_id`) stehen; die
Rücknahme MUST jeden auf seinen alten Wert legen, solange er noch den Stand trägt, den der
Vollzug hinterlassen hat (eine Änderung von Hand danach bleibt). ETB von Vollzug und Rücknahme
nennen den Abschnitt. Die Option MUST die Freigabe des Moduls Einheiten verlangen (403 ohne);
der Vollzug ohne Option nicht.

#### Scenario: Übergabe und Rücknahme
- **WHEN** „Florian 1“ (Abschnitt „Deichwache Nord“) durch „Florian 2“ (ohne Abschnitt) und „Zug 2“ (Abschnitt „Süd“) mit „Abschnitt übergeben“ vollzogen wird
- **THEN** stehen „Florian 2“ und „Zug 2“ in „Deichwache Nord“, „Florian 1“ ohne Abschnitt, und das ETB nennt „Abschnitt «Deichwache Nord» an «Florian 2», «Zug 2» übergeben“
- **AND** nach der Rücknahme steht „Florian 1“ wieder in „Deichwache Nord“, „Florian 2“ ohne und „Zug 2“ in „Süd“

#### Scenario: Von Hand umgehängt
- **WHEN** „Florian 2“ nach dem Vollzug von Hand einem anderen Abschnitt unterstellt wurde
- **THEN** lässt die Rücknahme ihn dort

#### Scenario: Ohne Freigabe des Moduls Einheiten
- **WHEN** eine Person ohne Freigabe des Moduls Einheiten mit „Abschnitt übergeben“ vollzieht
- **THEN** antwortet das System mit 403 und ändert nichts

### Requirement: Ablösung der erbenden Untereinheiten

Der Vollzug SHALL das Ereignis `abloesung` der Kräfte-Zeitachse auch an jede Untereinheit
schreiben, die die abgelöste Schicht erbt (Knoten-Vererbung beim Lesen, LLH-1118 Punkt 1), je
samt Fan-out auf ihre Personen; eine ohne offene Periode bleibt unberührt. Die Rücknahme MUST
diese Ereignisse an der Einheit und an jeder Untereinheit streichen, die die wieder laufende
Schicht erbt.

#### Scenario: Zug mit Gruppe und Trupp
- **WHEN** die Schicht von „Florian 1“ vollzogen wird, deren „Gruppe 1“ und „Trupp 1“ sie erben
- **THEN** endet die Periode aller drei mit der Ablösung, auch die des Truppführers, und die Rücknahme öffnet sie wieder

### Requirement: Verbleib der abgelösten Einheit

Der Vollzug als „Ganze Einheit“ SHALL die Angabe `verbleib` annehmen: `ruhe` (Vorgabe, fehlt =
`ruhe`), `bereitstellungsraum` mit `verbleib_br_id` oder `entlassen`. Bei `ruhe` und
`bereitstellungsraum` MUST die Periode der abgelösten Einheit und ihrer erbenden Untereinheiten
mit dem Ereignis `abloesung` enden; bei `bereitstellungsraum` MUST die abgelöste Einheit in
derselben Transaktion in den gewählten Raum eintreten (Belegung `eintritt`). Bei `entlassen` MUST
statt `abloesung` das Ereignis `entlassung` (Quelle `abloesung`) an der Einheit und jeder
erbenden Untereinheit stehen, je samt Fan-out; die Schicht MUST `abgeloest` bleiben und darf
nicht zusätzlich mit Grund `entlassung` beendet werden. Beide Ende-Ereignisse MUST nur an einer
Einheit mit offener Periode stehen; ohne offene Periode bleibt ihre Zeitachse unberührt. Ist der Raum fremd oder unbekannt (404),
nicht aktiv oder storniert (422) oder steht die Einheit schon in einem Raum (422), MUST der
Vollzug scheitern und nichts schreiben. `verbleib_br_id` ohne `bereitstellungsraum` und
`bereitstellungsraum` ohne Raum MUST 422 sein, ein unbekannter `verbleib` 400, ein `verbleib`
außer `ruhe` beim Besatzungswechsel 422. `bereitstellungsraum` MUST die Freigabe des Moduls
Bereitstellungsräume verlangen (403 ohne). Der ETB-Eintrag des Vollzugs MUST den Verbleib nennen;
es entsteht kein zweiter Eintrag. Die Schicht MUST den Verbleib tragen (`verbleib`,
`verbleib_br_bezeichnung`).

#### Scenario: In den Bereitstellungsraum
- **WHEN** „Florian 1“ um 15:40 durch „Florian 2“ abgelöst wird, danach „Bereitstellungsraum Schule“
- **THEN** endet die Periode von „Florian 1“ um 15:40 mit der Ablösung, „Florian 1“ steht im BR Schule
- **AND** das ETB enthält genau einen neuen Eintrag „Ablösung vollzogen: «Florian 1» durch «Florian 2». «Florian 1» danach in Bereitstellungsraum Schule.“

#### Scenario: Raum inaktiv
- **WHEN** der gewählte Raum inzwischen aufgelöst ist
- **THEN** antwortet das System mit 422 und dem Grund, die Schicht läuft weiter, und es gibt weder Folgeschicht noch Belegung noch ETB-Eintrag

#### Scenario: Entlassen
- **WHEN** „Florian 1“ (mit „Gruppe 1“, die die Schicht erbt) abgelöst wird, danach „entlassen“
- **THEN** endet die Periode von „Florian 1“, „Gruppe 1“ und ihren Personen mit der Entlassung, keine trägt ein Ereignis `abloesung`
- **AND** die Schicht ist `abgeloest`, nicht `beendet`, und das ETB enthält keinen Eintrag „mit der Entlassung beendet“

#### Scenario: Ohne Freigabe der Bereitstellungsräume
- **WHEN** eine Person ohne Freigabe des Moduls Bereitstellungsräume mit Verbleib im Raum vollzieht
- **THEN** antwortet das System mit 403 und ändert nichts

### Requirement: Abruf des Ablösers aus dem Bereitstellungsraum

Steht ein Ablöser beim Vollzug in einem Bereitstellungsraum, SHALL der Vollzug ihn in derselben
Transaktion abrufen und austreten lassen (Abruf mit `ausgerueckt`, ohne Abschnitt und ohne
Auftrag, Verband nach `bereitstellungsraum-belegung`); ist er dort schon abgerufen, MUST nur der
Austritt gebucht werden. Das verlangt keine Freigabe des Moduls Bereitstellungsräume. Der
ETB-Eintrag des Vollzugs MUST den Abruf nennen; einen eigenen Eintrag MUST es nicht geben.

#### Scenario: Ablöser wartet im Raum
- **WHEN** „Florian 2“ im BR Sportplatz steht und als Ablöser von „Florian 1“ vollzogen wird
- **THEN** steht „Florian 2“ in keinem Raum mehr, der Verlauf des BR Sportplatz zeigt Abruf und Ausrücken
- **AND** das ETB-Eintrag des Vollzugs nennt „«Florian 2» aus Bereitstellungsraum Sportplatz abgerufen und ausgerückt“

### Requirement: Vollzug-Dialog mit Ablöser-Liste

Der Vollzug-Dialog SHALL die Ablöser als Liste wählen lassen (höchstens `ABLOESUNG_ABLOESER_MAX`,
vorbelegt mit der Planung), dazu Zeitpunkt, „Abschnitt übergeben“ und „Danach“; mehr Felder hat er nicht.
Wählbar MUST jede andere Einheit sein, deren laufende Schicht keine Folgeschicht ist; eine mit
eigener laufender Schicht steht mit „· Schicht läuft“ in der Liste. „Abschnitt übergeben“ MUST
mit dem Abschnitt der abgelösten Einheit beschriftet und vorbelegt sein, sobald sie einen hat;
ohne Freigabe des Moduls Einheiten steht die Option gesperrt mit dem Grund „Modul Einheiten
gesperrt“. Die Planung wählt die Liste ebenso. Die Karte MUST alle Ablöser nennen (eine
übernommene Schicht mit „(Schicht übernommen)“) und an der abgelösten Schicht den übergebenen
Abschnitt.

Bei „Ganze Einheit“ SHALL der Dialog das Feld „Danach“ zeigen,
vorbelegt mit „In Ruhe“, mit je aktivem Raum „Bereitstellungsraum «Bezeichnung»“ und
„Entlassen“. Ohne Freigabe des Moduls Bereitstellungsräume MUST unter dem Feld „Modul
Bereitstellungsräume gesperrt“ stehen und keine Raum-Option wählbar sein. Beim
Besatzungswechsel fehlt das Feld. Lehnt der Server den Raum ab, MUST der Dialog offen bleiben
und den Grund zeigen.

#### Scenario: Vorbelegt aus der Planung
- **WHEN** an der Schicht von „Florian 1“ (Abschnitt „Deichwache Nord“) „Florian 3“ und „Florian 2“ geplant sind und jemand „Ablösung vollziehen“ wählt
- **THEN** stehen beide im Feld „Ablösende Einheiten“, und „Abschnitt übergeben (Deichwache Nord)“ ist angehakt

#### Scenario: Danach im Dialog
- **WHEN** jemand an der Schicht von „Florian 1“ „Ablösung vollziehen“ wählt und unter „Danach“ „Bereitstellungsraum Schule“ wählt
- **THEN** steht „Florian 1“ nach dem Vollziehen im BR Schule, und die Karte der abgelösten Schicht nennt „danach Bereitstellungsraum Schule“

### Requirement: Besatzungswechsel

Das System SHALL eine laufende Schicht als Besatzungswechsel vollziehen (Art `besatzung`,
gespeichert an der Schicht; ohne Angabe gilt `einheit`): die Einheit, ihr Fahrzeug und ihr
Abschnitt bleiben, die Folgeschicht MUST an derselben Einheit entstehen (Beginn =
Vollzugszeitpunkt, Rhythmus und Einsatzstelle der abgelösten Schicht, eigene Fristen). Die alte
Besatzung MUST die Personalzuordnung der Einheit und jeder Untereinheit sein, die die Schicht erbt
(Knoten-Vererbung, dieselbe Menge wie der Fan-out der ganzen Einheit); jede ihrer Personen MUST
ihre Einheit, ein Fahrzeug dieser Einheiten und deren Führung verlassen. Die neue Besatzung
(Pflicht, höchstens `BESATZUNG_MAX = 50` Personen des Einsatzes) MUST der Einheit zugeordnet
werden. Die Schicht MUST beide Besatzungen nennen (`besatzung`, Rolle `alt`/`neu`, Tabelle
`einsatz_abloesung_besatzung`), und ein ETB-Eintrag MUST Einheit, alte und neue Besatzung nennen.
Abgelehnt werden MUST, ohne etwas zu ändern: eine unbekannte oder fremde Person (404), eine
entlassene oder stornierte (409), eine aus der alten Besatzung oder die Führung einer anderen
Einheit (422), ablösende Einheiten oder „Abschnitt übergeben“ beim Besatzungswechsel (422). Leere
oder zu lange Liste und eine unbekannte Art MUST 400 sein. Der Besatzungswechsel MUST die Freigabe
des Moduls Einheiten verlangen (403 ohne). Grenzwerte und Ruhezeiten je Person rechnet er nicht
(LFH-860).

#### Scenario: Mannschaft wechselt, Fahrzeug bleibt
- **WHEN** die Schicht von „Florian 1“ (mit „Anna Alt“, Führerin auf „Florian 1-44“, und „Gruppe 1“ mit „Bernd Alt“, die die Schicht erbt) um 15:40 als Besatzungswechsel mit „Cora Neu“ und „Dirk Neu“ vollzogen wird
- **THEN** ist die Schicht abgelöst mit Art `besatzung`, „Florian 1“ hat eine Folgeschicht ab 15:40, „Gruppe 1“ erbt sie
- **AND** „Anna Alt“ und „Bernd Alt“ gehören keiner Einheit und keinem Fahrzeug mehr an, „Florian 1“ hat keine Führung, „Cora Neu“ und „Dirk Neu“ gehören zu „Florian 1“, das Fahrzeug und der Abschnitt bleiben
- **AND** das ETB enthält „Ablösung vollzogen: Besatzungswechsel «Florian 1», Einheit und Fahrzeug bleiben. Alte Besatzung: «Anna Alt», «Bernd Alt». Neue Besatzung: «Cora Neu», «Dirk Neu».“

#### Scenario: Person der alten Besatzung als neue
- **WHEN** „Bernd Alt“ aus der erbenden „Gruppe 1“ als neue Besatzung genannt wird
- **THEN** antwortet das System mit 422, und die Schicht bleibt laufend

#### Scenario: Ohne neue Besatzung
- **WHEN** ein Besatzungswechsel ohne `besatzung_ids` abgeschickt wird
- **THEN** antwortet das System mit 400

### Requirement: Rücknahme eines Besatzungswechsels

Die Rücknahme eines Besatzungswechsels SHALL wie jede Rücknahme gelten (Folgeschicht unberührt,
Berichtigung im ETB); die eigene Folgeschicht derselben Einheit MUST die Rücknahme dabei nicht
sperren (`ruecknehmbar`). Sie MUST die Personen-Ereignisse des Vollzugs streichen und jede Person
zurücklegen, solange sie noch so steht, wie der Vollzug sie hinterlassen hat: die neue Besatzung
in ihre bisherige Einheit (solange sie noch in der Einheit steht), die alte in ihre Einheit, auf
ihr Fahrzeug und in ihre Führung (solange sie ohne Einheit, ohne Fahrzeug bzw. die Einheit ohne
Führung ist). Danach MUST die Schicht wieder Art `einheit` tragen und keine Besatzung nennen.
Bräche die Streichung die Folge einer Person, MUST die Rücknahme mit 422 scheitern, die Person
nennen und nichts ändern.

#### Scenario: Zurück wie vorher
- **WHEN** der Besatzungswechsel von „Florian 1“ zurückgenommen wird
- **THEN** stehen „Anna Alt“ (wieder Führerin, auf „Florian 1-44“) und „Bernd Alt“ wieder in ihren Einheiten, „Cora Neu“ ohne und „Dirk Neu“ wieder in „Florian 2“, und die Folgeschicht ist entfernt

#### Scenario: Von Hand umgehängt
- **WHEN** „Cora Neu“ nach dem Wechsel von Hand „Florian 3“ zugeordnet wurde
- **THEN** lässt die Rücknahme sie dort

### Requirement: Vollzug-Dialog mit Besatzungswechsel

Der Vollzug-Dialog SHALL die Art wählen lassen: „Ganze Einheit“ (Vorgabe) oder
„Besatzungswechsel“. Beim Besatzungswechsel MUST er statt der ablösenden Einheiten die bisherige
Besatzung sichtbar vorbelegt zeigen (kein Feld) und die neue Besatzung als Pflichtliste von
Personen wählen lassen; nicht wählbar ist, wer zur bisherigen gehört, wer eine andere Einheit
führt, steht gesperrt mit Grund in der Liste. Ohne Freigabe der Module Einheiten oder Personal
MUST „Besatzungswechsel“ gesperrt sein, mit dem Grund daneben. Mehr als Art, Kräfte und Zeitpunkt
hat er nicht („Abschnitt übergeben“ gehört als Option zu den Ablösern). Die abgelöste Karte MUST
„Besatzungswechsel · neu: …“ mit der neuen Besatzung zeigen.

#### Scenario: Wechsel aus dem Dialog
- **WHEN** jemand an der Schicht von „Florian 1“ „Ablösung vollziehen“ → „Besatzungswechsel“ wählt
- **THEN** zeigt der Dialog „Bisherige Besatzung: Anna Alt, Bernd Alt“ und das Feld „Neue Besatzung“, ohne „Ablösende Einheiten“ und ohne „Abschnitt übergeben“

#### Scenario: Modul Personal gesperrt
- **WHEN** der Person die Freigabe des Moduls Personal fehlt
- **THEN** ist „Besatzungswechsel“ gesperrt, daneben steht „Modul Personal gesperrt“

### Requirement: Herkunft des Beginns

Jede Schicht SHALL ihre Herkunft `beginn_quelle` tragen (LLH-1312): `hand` (von Hand begonnen,
auch mit dem übernommenen Eintreffen als Zeitpunkt), `eintreffen` (mit dem Eintreffen begonnen,
Requirement „Schicht mit dem Eintreffen“) oder `vollzug` (vom Vollzug neu angelegte Folgeschicht,
ganze Einheit wie Besatzungswechsel). Eine beim Vollzug übernommene Schicht MUST ihre Herkunft
behalten; die Rücknahme MUST sie nicht ändern. Ändert jemand den Beginn einer Schicht mit
Herkunft `eintreffen`, MUST sie danach `hand` tragen; eine Folgeschicht MUST `vollzug` behalten.
Die Karte MUST die Herkunft im Beginn nennen: „im Einsatz seit <Zeit>“ (`hand`), „seit Eintreffen
<Zeit>“ (`eintreffen`), „Folgeschicht seit <Zeit>“ (`vollzug`), in derselben Zeile wie heute.

#### Scenario: Autostart
- **WHEN** „Florian 1“ um 06:40 eintrifft und der Einsatz eine Vorgabe hat
- **THEN** trägt die neue Schicht `beginn_quelle` `eintreffen`, und ihre Karte zeigt „seit Eintreffen 0640“

#### Scenario: Folgeschicht
- **WHEN** die Schicht von „Florian 1“ um 15:40 durch „Florian 2“ abgelöst wird
- **THEN** trägt die Folgeschicht von „Florian 2“ `beginn_quelle` `vollzug`, und ihre Karte zeigt „Folgeschicht seit 1540“

#### Scenario: Beginn korrigiert
- **WHEN** jemand den Beginn einer mit dem Eintreffen begonnenen Schicht von 06:40 auf 07:10 ändert
- **THEN** trägt sie `beginn_quelle` `hand`, und die Karte zeigt „im Einsatz seit 0710“

#### Scenario: Bestand
- **WHEN** die Migration auf eine Datenbank mit einer Folgeschicht und einer Auto-Schicht aus der Zeit davor läuft
- **THEN** trägt die Folgeschicht `vollzug` und die Auto-Schicht `hand`

### Requirement: Ansicht in der Adresse

Die Seite Ablösung SHALL ihre Ansicht in der Adresse führen (LLH-1312, Muster Query-Param aus
`frontend/AGENTS.md`): `?ansicht=ohne-schicht` oder `?ansicht=vergangen`, „Laufend“ ohne
Parameter. Ein Wechsel des Segments MUST die Adresse ersetzen, nicht ergänzen; ein unbekannter
Wert MUST als „Laufend“ gelten. Ohne Freigabe des Moduls Einheiten MUST `ohne-schicht` „Laufend“
zeigen. Der Sprung `?schicht=` MUST die Ansicht seiner Schicht in die Adresse schreiben.

#### Scenario: Aus dem Überblick
- **WHEN** jemand im Überblick „2 ohne Schicht ↗“ wählt
- **THEN** öffnet die Seite Ablösung mit der Ansicht „Ohne Schicht“, und die Adresse trägt `?ansicht=ohne-schicht`

#### Scenario: Zurück
- **WHEN** jemand in „Ohne Schicht“ eine Einheit öffnet und mit dem Browser zurückgeht
- **THEN** steht wieder „Ohne Schicht“
