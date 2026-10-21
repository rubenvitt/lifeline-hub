# lagevortrag-uebernahme Specification

## Purpose
Einzelne Abschnitte eines Lagevortrag-Entwurfs lassen sich aus Lagedaten füllen, die das System
ohnehin führt, ohne den Lagevortrag zu verlassen. Die Fähigkeit legt die gemeinsamen Bedienregeln,
die Rechteprüfung je Quelle und die angebundenen Abschnitte fest.

## Requirements

### Requirement: Übernahme in einen Abschnitt des Lagevortrags
Ein Abschnitt der Vorlage „Lagevortrag zur Information“, dem eine Quelle zugeordnet ist, SHALL
im Entwurf einen Übernahme-Knopf tragen. Für die übrigen Abschnitte und für alle anderen Vorlagen
MUST kein Übernahme-Knopf erscheinen. Die Übernahme MUST nur auf Klick geschehen und nur im
Schreibzweig (Entwurf und Schreibrecht) angeboten werden. Die Daten der Quelle MUST erst beim
Klick geladen werden. Die Übernahme setzt den Text so ein:
- Ist der Abschnitt leer, geschieht das ohne Rückfrage.
- Ist er gefüllt, MUST eine Rückfrage das Ersetzen bestätigen lassen; „Abbrechen“ lässt den Text
  unverändert.

Die Übernahme MUST nur das Formular ändern und den Entwurf als geändert melden. Gespeichert wird
mit dem nächsten Speichern oder Autosave.

#### Scenario: Leerer Abschnitt
- **WHEN** die Person im leeren Abschnitt „Eigene Lage“ auf den Übernahme-Knopf tippt
- **THEN** steht der übernommene Text im Abschnitt, und der Entwurf gilt als geändert

#### Scenario: Gefüllter Abschnitt
- **WHEN** der Abschnitt „Eigene Lage“ schon Text enthält und die Person übernimmt
- **THEN** fragt die Oberfläche, ob der Text ersetzt werden soll, und ersetzt ihn erst nach
  Bestätigung

#### Scenario: Freigegebener Bericht
- **WHEN** ein freigegebener Lagevortrag angezeigt wird
- **THEN** steht in keinem Abschnitt ein Übernahme-Knopf

#### Scenario: Lagevortrag zur Entscheidung
- **WHEN** ein Entwurf der Vorlage „Lagevortrag zur Entscheidung“ bearbeitet wird
- **THEN** trägt kein Abschnitt einen Übernahme-Knopf

### Requirement: Rechte je Quelle und Hinweis bei Sperre
Jede Quelle SHALL ihre Freigabe selbst prüfen, bevor sie Daten lädt. Ist keine Quelle eines
Abschnitts für die Person freigegeben, MUST der Knopf fehlen und an seiner Stelle ein Hinweis mit
dem Grund stehen. Solange die Freigaben nicht ermittelt sind, MUST weder Knopf noch Hinweis
stehen; ist die Freigabe nicht ermittelbar, MUST ein Hinweis das sagen. Ist nur ein Teil der
Quellen frei, MUST der Knopf stehen; der gesperrte Teil MUST im übernommenen Text mit „—“ und
Grund erscheinen, nie mit 0. Dasselbe gilt für eine Quelle, die beim Klick nicht geladen werden
kann.

#### Scenario: Alle Quellen gesperrt
- **WHEN** für die Person weder Meldebild noch Führungsorganisation freigegeben sind
- **THEN** zeigt der Abschnitt „Eigene Lage“ keinen Übernahme-Knopf, sondern einen Hinweis, der
  die fehlenden Freigaben nennt

#### Scenario: Teil gesperrt
- **WHEN** das Personal für die Person nicht freigegeben ist, Abschnitte und Einheiten aber schon
- **THEN** steht der Knopf, und der übernommene Text führt das Kräftemeldebild als „—“ mit Grund
  und die Führungsorganisation vollständig

#### Scenario: Quelle scheitert beim Klick
- **WHEN** die Abschnitte beim Klick nicht geladen werden können
- **THEN** steht für die betroffenen Teile „—“ mit Grund im Text, und der Abschnitt bleibt
  bearbeitbar

### Requirement: Eigene Lage aus Meldebild und Führungsorganisation
Der Abschnitt „Eigene Lage“ des Lagevortrags zur Information SHALL das Kräftemeldebild und die
Führungsorganisation des ganzen Einsatzes übernehmen können, in dieser Reihenfolge. Jeder Teil
MUST denselben Text tragen wie die Fassung, die „In Lagebericht übernehmen“ im Meldebild (ohne
Filter) bzw. im Organigramm erzeugt, mit derselben Zahl an jeder Stelle. Jeder Teil MUST seinen
Stand (DTG) im Text tragen; der Stand ist der älteste Abruf der Listen, aus denen der Teil
gerechnet wurde. Die Übernahme MUST keine zweite Verdichtung rechnen.

#### Scenario: Gleicher Text wie die Einzelübernahme
- **WHEN** die Person „Eigene Lage“ übernimmt und im selben Datenstand das Meldebild und das
  Organigramm in einen Lagebericht übernimmt
- **THEN** stimmen die beiden Teile in „Eigene Lage“ wörtlich mit den Texten der beiden neuen
  Freitext-Berichte überein, bis auf den Stand

#### Scenario: Stand im Text
- **WHEN** die Person „Eigene Lage“ übernimmt
- **THEN** nennt jeder Teil eine Zeile „Stand:“ mit einer taktischen DTG

### Requirement: Weitere Abschnitte des Lagevortrags zur Information
Im Lagevortrag zur Information SHALL je eine Übernahme in den Abschnitten „Besondere
(Führungs-)Probleme“, „Gefahren-/Schadenlage“ und „Lageentwicklung“ stehen. Die Abschnitte
„Auftrag“, „Anträge und Vorschläge“ und „Zusammenfassung“ MUST ohne Übernahme bleiben.

#### Scenario: Knopf in der Gefahren-/Schadenlage
- **WHEN** eine Person mit Schreibrecht einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** steht im Abschnitt „Gefahren-/Schadenlage“ ein Übernahme-Knopf mit einem Nebentext,
  der die Herkunft nennt

#### Scenario: Kein Knopf im Auftrag
- **WHEN** eine Person einen Entwurf „Lagevortrag zur Information“ öffnet
- **THEN** zeigt der Abschnitt „Auftrag“ keinen Übernahme-Knopf

### Requirement: Stand und kein Freitext in den weiteren Abschnitten
Der übernommene Text dieser Abschnitte MUST mit dem Stand als taktische DTG beginnen; der Stand
MUST der älteste Datenstand der gelesenen Quellen sein. Der Text MUST keinen Freitext aus
Auftrags-, Meldungs-, ETB-, Personen- oder Schadensfeldern und keine Angaben zu Betroffenen außer
Zahlen enthalten.

#### Scenario: Stand aus dem Zwischenspeicher
- **WHEN** die Listen seit 10 Minuten im Zwischenspeicher liegen und die Person die
  Gefahren-/Schadenlage übernimmt
- **THEN** nennt die erste Zeile den Stand dieser Listen, nicht die Uhrzeit des Klicks

#### Scenario: Auftragstext bleibt draußen
- **WHEN** ein überfälliger Auftrag den Text „Familie Müller evakuieren“ trägt
- **THEN** nennt die Übernahme den Auftrag mit Nummer und Frist, und der Text kommt nicht vor

### Requirement: Zahlen wie Dashboard, Vorbereitung und Funkplan
Jede Zahl in diesen Abschnitten MUST nach derselben Regel entstehen wie die gleichnamige Angabe im
Lage-Dashboard, in der Vorbereitung der Lagebesprechung bzw. im Funkplan; aus denselben Daten MUST
derselbe Wert folgen. Eine gesperrte oder nicht geladene Quelle MUST als „—“ mit Grund stehen, nie
als 0.

#### Scenario: Überfällige Aufträge
- **WHEN** die Vorbereitung „3 überfällig“ an den offenen Aufträgen zeigt
- **THEN** nennt die Übernahme der Führungsprobleme 3 überfällige Aufträge und listet genau diese
  drei

#### Scenario: Betroffene gesperrt
- **WHEN** das Modul Personen für die Person gesperrt ist und sie die Gefahren-/Schadenlage
  übernimmt
- **THEN** stehen Betroffene, Vermisste und Sichtung als „— (nicht freigegeben)“, und es wurde
  keine Personenliste angefragt

### Requirement: Inhalt der Besonderen (Führungs-)Probleme
Die Übernahme SHALL überfällige offene Aufträge (Zahl und je Auftrag Nummer und Frist), Meldungen
mit überfälliger Bestätigung (Zahl und je Meldung Nummer, Art und Frist), die Zahl noch nicht
gesichteter Meldungen und die Lücken des Funkplans enthalten. Ein Teil ohne Befund MUST „keine“
sagen.

#### Scenario: Keine Probleme
- **WHEN** kein Auftrag überfällig ist, keine Bestätigung aussteht und der Funkplan keine Lücke
  hat
- **THEN** sagt jeder der drei Teile „keine“

#### Scenario: Funkplan-Lücke
- **WHEN** der Einheit „ELW 1“ keine Sprechgruppe zugeordnet ist
- **THEN** nennt der Teil Funkplan „Einheiten ohne Sprechgruppe: 1 (ELW 1)“ wie der Funkplan im
  Lagebericht

### Requirement: Inhalt der Gefahren-/Schadenlage
Die Übernahme SHALL Betroffene, Vermisste, Sichtung nach Kategorien, offene Schäden, die höchste
Warnstufe mit der Zahl der Gebiete, die Gefahren je Gebiet, geltende und angekündigte
Wetterwarnungen, die aktuellen Bedingungen am Einsatzort und je maßgeblichem Pegel Stand und Trend
enthalten. Fehlt ein Einsatzort, MUST der Text das sagen statt einer leeren Zeile. Das Wetter MUST
vor den Pegeln stehen. Einen Teil „Pegel“ MUST der Text nur enthalten, wenn am Einsatz ein
maßgeblicher Pegel festgelegt ist (die Entscheidung, die auch die Pegel-Kennzahl im Lagebild trägt);
ohne diese Entscheidung MUST der Teil ganz entfallen. Ist der Einsatz nicht abrufbar, MUST der Teil
mit dem Grund stehen bleiben.

#### Scenario: Ohne Einsatzort
- **WHEN** der Einsatz keinen Ort hat und die Person die Gefahren-/Schadenlage übernimmt
- **THEN** sagt der Teil Wetter „kein Einsatzort“, und die übrigen Teile tragen ihre Werte

#### Scenario: Pegel
- **WHEN** zwei maßgebliche Pegel festgelegt sind
- **THEN** nennt der Text beide mit Gewässer, Stand, Trend und Messzeit in der festgelegten
  Reihenfolge

#### Scenario: Kein Pegel festgelegt
- **WHEN** am Einsatz kein maßgeblicher Pegel festgelegt ist und die Person die
  Gefahren-/Schadenlage übernimmt
- **THEN** enthält der Text keinen Teil „Pegel“, und die Teile Betroffene, Schäden und Gefahren
  sowie Wetter tragen ihre Werte

#### Scenario: Wetter vor Pegel
- **WHEN** ein maßgeblicher Pegel festgelegt ist
- **THEN** steht der Teil „Wetter“ vor dem Teil „Pegel“

### Requirement: Gefahren je Gebiet in der Gefahren-/Schadenlage
Die Übernahme der Gefahren-/Schadenlage SHALL einen Teil „Gefahrengebiete“ enthalten: je Gebiet
den Namen, bei einem nicht beurteilten „nicht beurteilt“, und darunter jede gesetzte Gefahr (Stufe
über „keine“ oder mit Erläuterung) mit Stufe und Erläuterung in der Folge der Matrix. Die
Erläuterung und der Gebietsname sind Beurteilung der eigenen Führung, kein Freitext Dritter, und
SHALL übernommen werden; „gemeldet von“ und der Name der letzten Änderung MUST draußen bleiben.

#### Scenario: Gefahren je Gebiet
- **WHEN** das Gebiet „Überflutung Unterstadt“ Elektrizität × Menschen auf „hoch“ mit der Erläuterung „Stromführende Kellerverteilungen unter Wasser“ trägt
- **THEN** nennt der Teil „Gefahrengebiete“ das Gebiet und darunter „Elektrizität × Menschen: hoch · Stromführende Kellerverteilungen unter Wasser“

#### Scenario: Meldeweg einer Gefahr bleibt draußen
- **WHEN** eine Gefahrenbewertung die Erläuterung „Keller unter Wasser“ und „gemeldet von Herr Schmidt“ trägt
- **THEN** enthält die Gefahren-/Schadenlage „Keller unter Wasser“, aber nicht „Herr Schmidt“

#### Scenario: Gefahren gesperrt
- **WHEN** das Modul Gefahren für die Person gesperrt ist und sie die Gefahren-/Schadenlage übernimmt
- **THEN** steht der Teil „Gefahrengebiete“ als „— (nicht freigegeben)“, und weder Gebiete noch Matrizen wurden angefragt

### Requirement: Inhalt der Lageentwicklung
Die Übernahme SHALL die ETB-Einträge seit dem Eintrag der letzten abgehaltenen Lagebesprechung
zusammenfassen, gemessen an der laufenden Nummer. System-Einträge und die Einträge freigegebener
Lageberichte MUST ausgenommen sein. Der Text SHALL die Zahl der neuen Einträge je Typ und die neuen
Entscheidungen mit Nummer und Zeit nennen, ohne Wortlaut. Ohne abgehaltene Lagebesprechung MUST er
„seit Einsatzbeginn“ sagen.

#### Scenario: Nachgetragener Eintrag
- **WHEN** nach der Lagebesprechung ein Eintrag mit einer früheren Ereigniszeit erfasst wird
- **THEN** zählt er zu den Neuerungen

#### Scenario: Früherer Lagevortrag
- **WHEN** seit der Lagebesprechung ein Lagevortrag freigegeben wurde
- **THEN** zählt sein ETB-Eintrag nicht zu den Neuerungen

#### Scenario: Noch keine Lagebesprechung
- **WHEN** im Einsatz noch keine Lagebesprechung abgehalten wurde
- **THEN** beginnt die Zusammenfassung mit „seit Einsatzbeginn“

### Requirement: Neuer Lagevortrag startet mit dem Lagebild
„Neuer Lagevortrag“ SHALL den Lagevortrag zur Information mit allen Abschnitten anlegen, denen
eine Quelle zugeordnet ist, als Startinhalt in genau einer anlegenden Anfrage. Die Daten der
Quellen MUST erst mit diesem Klick geladen werden. Jeder Text MUST derselbe sein, den die
Übernahme im Abschnitt aus demselben Datenstand erzeugt. Lehnt der Server das Anlegen ab, MUST
kein Entwurf entstehen und MUST der Grund an der Seite stehen.

#### Scenario: Anlegen mit Startinhalt
- **WHEN** eine Person mit Schreibrecht „Neuer Lagevortrag“ wählt
- **THEN** sendet der Client genau eine anlegende Anfrage mit Texten für Gefahren-/Schadenlage,
  Eigene Lage, Lageentwicklung, Besondere (Führungs-)Probleme und Medienlage, und der Entwurf
  öffnet sich

#### Scenario: Anlegen abgelehnt
- **WHEN** der Server das Anlegen mit 400 ablehnt
- **THEN** steht der Grund an der Seite, es folgt keine weitere Anfrage, und kein Entwurf öffnet
  sich

### Requirement: Ausfall im Startinhalt
Ist eine Quelle für die Person nicht freigegeben, MUST ihr Abschnitt im Startinhalt „—“ mit dem
Grund tragen, und die Daten dieser Quelle MUST NOT angefragt werden. Dasselbe MUST gelten, wenn
die Freigaben nicht ermittelbar sind oder eine Quelle ihren Text nicht erzeugen kann. Kein
Abschnitt mit Quelle MUST leer bleiben oder für Fehlendes eine 0 tragen.

#### Scenario: Gesperrte Quelle
- **WHEN** der Stab für die Person nicht freigegeben ist und sie „Neuer Lagevortrag“ wählt
- **THEN** trägt die Medienlage „— (Stab nicht freigegeben)“ ohne Zahl, und keine Liste der
  Medienlage wurde angefragt

#### Scenario: Freigaben nicht ermittelbar
- **WHEN** die Modulfreigaben beim Klick nicht geladen werden können
- **THEN** trägt jeder Abschnitt mit Quelle „— (Freigaben nicht ermittelbar)“

### Requirement: Leerer Lagevortrag
Ein Menüeintrag „Leerer Lagevortrag“ am Knopf „Neuer Lagevortrag“ SHALL den Lagevortrag zur
Information ohne Startinhalt anlegen. Die übrigen Vorlagen MUST ohne Startinhalt angelegt werden.

#### Scenario: Leerer Lagevortrag
- **WHEN** die Person am Pfeil „Leerer Lagevortrag“ wählt
- **THEN** entsteht der Lagevortrag zur Information ohne Startinhalt, und keine Quelle wurde
  angefragt

### Requirement: Leere Abschnitte aus dem Lagebild füllen
Im Entwurf des Lagevortrags zur Information SHALL im Schreibzweig im Kopf der Gliederung ein Knopf
„Leere Abschnitte aus dem Lagebild füllen“ stehen, solange mindestens ein Abschnitt mit Quelle
leer ist. Der Klick MUST nur die Quellen der leeren Abschnitte laden und nur Abschnitte füllen,
die beim Eintreffen der Texte noch leer sind; eine Rückfrage MUST NOT erscheinen. Der Text MUST
derselbe sein wie bei der Übernahme im Abschnitt.

#### Scenario: Gemischter Entwurf
- **WHEN** „Eigene Lage“ schon Text enthält, die übrigen Abschnitte mit Quelle leer sind und die
  Person „Leere Abschnitte aus dem Lagebild füllen“ wählt
- **THEN** bleibt „Eigene Lage“ unverändert, die übrigen Abschnitte mit Quelle tragen den
  übernommenen Text, und der Entwurf gilt als geändert

#### Scenario: Nichts zu füllen
- **WHEN** alle Abschnitte mit Quelle Text enthalten
- **THEN** steht der Knopf nicht

#### Scenario: Lagevortrag zur Entscheidung
- **WHEN** ein Entwurf der Vorlage „Lagevortrag zur Entscheidung“ bearbeitet wird
- **THEN** steht der Knopf nicht

### Requirement: Sammelfüllung meldet sich beim Verlustschutz
Die Füllung leerer Abschnitte MUST nur das Formular ändern und den Entwurf als geändert melden;
gespeichert wird mit dem nächsten Speichern oder Autosave.

#### Scenario: Ungespeichert nach der Füllung
- **WHEN** die Person „Leere Abschnitte aus dem Lagebild füllen“ wählt und mindestens ein
  Abschnitt gefüllt wird
- **THEN** zeigt der Entwurf „ungespeicherte Änderungen“
